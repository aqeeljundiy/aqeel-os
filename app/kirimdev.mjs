// WhatsApp through Kirimdev, as an aqeelOS channel (audit, 5 Nov 2026). It replaces the bridge script Donna ran in the
// background (wa-agent/bridge/bridge.py): that one polled Kirimdev every 15 seconds, stopped at every engine restart,
// once ran twice (double replies), and kept its numbers, testers and Telegram topics in code.
//
// Each agent may have one Kirimdev line (a WhatsApp number at Kirimdev): settings in DATA/kirimdev.json, its webhook
// secret in DATA/kirimdev-secrets.json (mode 600, made by Kirimdev when aqeelOS connects the webhook). Kirimdev posts
// every customer message to https://<aqeelOS>/kirimdev/<agent>, signed (X-Kirim-Signature: t=<unix>,v1=<hex>...; the
// hex HMAC-SHA256 of "<t>.<raw body>"; 5 minutes either way). aqeelOS answers at once, keeps the event (deduped on
// X-Kirim-Event-Id, which Kirimdev keeps across its retries), waits for the customer to finish typing, then runs the
// agent once with the conversation so far and sends what it wrote: text in parts ("---"), [FOTO: file] and
// [TEMPLATE: name] as real pictures, and HANDOFF: <why> as a question in the Questions topic of the agent's team group
// (team-group.mjs). One run per conversation at a time, two at once in all.
//
// Modes: Test answers only its testers; Draft writes the reply for every customer but posts it in the Questions topic
// for a person to approve (nothing reaches the customer until then; whatsapp_draft or the Channels page sends it);
// Live answers everyone.
// Finished 5 Nov 2026:
// - the customer hears "passed on to the team" only after Telegram confirmed the handoff post; a failed post tells the
//   customer nothing, tells the owner (bell) and is tried again (1, 5, 15, 30 minutes, then hourly, for a day)
// - a team member who replies in a conversation (Kirimdev message.sent from the dashboard or the phone app, or an API
//   send aqeelOS did not make) pauses the agent there for the line's quiet time (pauseMin, 15 by default)
// - brands never mix: a line takes only events for its own phoneNumberId, and whatsapp_reply refuses a number that
//   wrote to another line and not to this one
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import path from 'node:path';

export const TOLERANCE=300,MAX_BODY=1024*1024,API='https://api.kirimdev.com/v1';
export const FOOTER=/\n*\(Answered with [^)]*\)\s*$/;
export const MODES=['test','draft','live'],EVENTS=['message.received','message.sent'];
export const RETRY_MIN=[1,5,15,30,60];
const AGENT=/^[a-z0-9][a-z0-9_-]{0,63}$/;

// the signature over the raw body: any v1 from any active secret, t within 5 minutes
export function verifySignature(raw,header,secrets,nowS=Date.now()/1000,tol=TOLERANCE){
 if(typeof header!=='string'||!header||header.length>2048||!/^[\x20-\x7e]+$/.test(header))return false;
 let t=null;const v1=[];
 for(const p of header.split(',').map(x=>x.trim()).filter(Boolean)){const i=p.indexOf('=');if(i<1)return false;const k=p.slice(0,i),v=p.slice(i+1);
  if(k==='t'){if(t!==null||!/^\d{1,12}$/.test(v))return false;t=v}else if(k==='v1')v1.push(v.toLowerCase())}
 if(t===null||!v1.length||v1.length>8||Math.abs(nowS-Number(t))>tol)return false;
 const body=Buffer.isBuffer(raw)?raw:Buffer.from(String(raw));let ok=false;
 for(const s of secrets||[]){if(typeof s!=='string'||!s)continue;const want=Buffer.from(createHmac('sha256',s).update(Buffer.concat([Buffer.from(t+'.'),body])).digest('hex'));
  for(const g of v1){const b=Buffer.from(g);if(b.length===want.length&&timingSafeEqual(b,want))ok=true}}
 return ok}

// Meta's WhatsApp body (Kirimdev passes it on): the customer messages in it, with Kirimdev's conversation id
export function parseInbound(j){const out=[];const kc=j?.kirim||{};
 for(const e of Array.isArray(j?.entry)?j.entry:[])for(const c of Array.isArray(e?.changes)?e.changes:[]){const v=c?.value||{};
  const pid=String(v.metadata?.phone_number_id||kc.phone_number_id||'');const names=Object.fromEntries((v.contacts||[]).map(x=>[String(x.wa_id||''),x.profile?.name||'']));
  for(const m of Array.isArray(v.messages)?v.messages:[]){const from=String(m.from||'');if(!/^\d{6,16}$/.test(from))continue;
   const text=m.type==='text'?String(m.text?.body||''):m.type==='button'?String(m.button?.text||''):m.type==='interactive'?String(m.interactive?.button_reply?.title||m.interactive?.list_reply?.title||''):String(m[m.type]?.caption||'');
   out.push({pid,from,name:names[from]||kc.contact?.name||'',id:String(m.id||''),ts:Number(m.timestamp)||0,type:String(m.type||''),text,conversationId:String(kc.conversation_id||'')})}}
 return out}

// Kirimdev's message.sent (its own envelope): an outbound message on a line, whoever sent it
export function parseSent(j){const d=j?.data||{},m=d.message||{};
 return {pid:String(d.session||d.meta?.phone_number_id||''),id:String(m.id||''),source:String(m.source||''),to:String(m.to||d.contact?.phone_number||'').replace(/\D/g,''),conversationId:String(d.conversation?.id||''),name:String(d.contact?.name||'')}}

// what the agent wrote, as the parts to send: its notes about backup models are never sent
export function splitReply(out){const t=String(out||'').replace(FOOTER,'').trim();const parts=[];
 for(const x of t.split(/\n-{3,}\n/))for(const y of x.split(/(\[(?:FOTO|TEMPLATE):[^\]]+\])/))if(y.trim())parts.push(y.trim());
 return parts.slice(0,8)}

// aqeelos:kirim-guard: the last check before anything reaches a customer, for every agent on every line.
// Lines meant for the team (notes, image descriptions, test-mode remarks, file names) never go out, and a
// reply that promises a payment QR without the picture in the same reply is held for a person instead.
const INTERNAL=[/^\s*\[(?!FOTO:|TEMPLATE:)(gambar|image|foto|photo|picture|img)\b[^\]]*\]\s*$/i,
 /(catatan|note)s?\s+(untuk|buat|for)\s+(tim|team)/i,/tidak\s+dikirim\s+ke\s+customer|not\s+(to\s+be\s+)?sent\s+to\s+(the\s+)?customer/i,
 /\b(test\s*mode|mode\s*test|internal\s+note|draft\s+reply|as an ai|language model|LLM)\b/i,/^\s*\(?\s*(answered with|dijawab (dengan|oleh))\b/i,
 /^\s*\S+\.(jpe?g|png|webp|pdf)\s*$/i];
export function guardReply(parts){const removed=[];const keep=[];
 for(const p of parts){if(/^\[(FOTO|TEMPLATE):/.test(p)){keep.push(p);continue}
  const lines=p.split('\n'),ok=lines.filter(l=>!INTERNAL.some(r=>r.test(l)));
  if(ok.length<lines.length)removed.push(...lines.filter(l=>!ok.includes(l)));const t=ok.join('\n').trim();if(t)keep.push(t)}
 const promisesQr=keep.some(p=>/\bQRIS\b/i.test(p)&&/(berikut|terlampir|kami kirim|saya kirim|here is|attached)/i.test(p));
 const hasPic=keep.some(p=>/^\[FOTO:/i.test(p));
 return {parts:keep,removed,hold:promisesQr&&!hasPic?'The reply says a QRIS is attached, but no QR picture was made. Create the QRIS with the payment tool, then send it.':null}}

const RESET=/^(reset|\/reset|mulai baru)$/i;
const tail=n=>'…'+String(n||'').slice(-4);

export function createKirimdev({DATA,WORK,apiKey,runAgent,telegram,teamGroup=async()=>null,tell=async()=>{},problem=null,solved=async()=>{},log=m=>console.log(m),fetchImpl=fetch,now=()=>Date.now(),PUBLIC_URL,wait=ms=>new Promise(r=>setTimeout(r,ms)),maxRuns=2,echoWait=4000}){
 const CONF=path.join(DATA,'kirimdev.json'),SEC=path.join(DATA,'kirimdev-secrets.json'),ST=path.join(DATA,'kirimdev-state.json');
 const readJson=async(f,d)=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return d}};
 const put=async(f,v,mode=0o600)=>{await mkdir(DATA,{recursive:true});const t=f+'.'+process.pid+'.'+randomUUID().slice(0,8)+'.tmp';await writeFile(t,JSON.stringify(v,null,1),{mode});await rename(t,f)};
 let st=null,chain=Promise.resolve();const queue=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p};
 const state=async()=>st||=Object.assign({seen:[],cut:{},recent:{},pending:{},last:{},testerNums:{},ours:{},paused:{},drafts:{},handoffs:{},seq:0},await readJson(ST,{}));
 const saveState=()=>queue(async()=>{await state();st.seen=st.seen.slice(-3000);const t=now();
  for(const [k,v] of Object.entries(st.recent))if(t-v>48*3600e3)delete st.recent[k];
  for(const [k,v] of Object.entries(st.ours))if(t-v>48*3600e3)delete st.ours[k];
  for(const [k,v] of Object.entries(st.paused))if(v<t)delete st.paused[k];
  for(const [k,d] of Object.entries(st.drafts))if(d.status!=='waiting'&&t-(d.doneAt||d.at)>7*86400e3||t-d.at>3*86400e3)delete st.drafts[k];
  await put(ST,st)});
 const lines=async()=>(await readJson(CONF,{lines:{}})).lines||{};
 const lineOf=async agent=>AGENT.test(agent)?(await lines())[agent]||null:null;
 const secretsOf=async agent=>((await readJson(SEC,{}))[agent]?.secrets)||[];
 const modeOf=line=>MODES.includes(line?.mode)?line.mode:'test';

 async function api(p,body,{idem,method}={}){const key=await apiKey();if(!key)throw Error('No Kirimdev API key is saved (KIRIMDEV_API_KEY).');
  const m=method||(body?'POST':'GET');
  const r=await fetchImpl(API+'/'+p,{method:m,headers:{authorization:'Bearer '+key,'content-type':'application/json','user-agent':'aqeelOS/1.0',...(m==='POST'?{'idempotency-key':idem||randomUUID()}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(40000)});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error('Kirimdev answered '+r.status+(j?.error?.code?' '+j.error.code:'')),{status:r.status,code:j?.error?.code});return j}

 const isTester=(line,m)=>(line.testers||[]).some(t=>t.conversationId&&t.conversationId===m.conversationId||t.phone&&String(t.phone).replace(/\D/g,'')===m.from);
 const testerName=(line,m)=>(line.testers||[]).find(t=>t.conversationId===m.conversationId||String(t.phone||'').replace(/\D/g,'')===m.from)?.who||m.name||'customer';
 const within24h=(agent,num)=>{const s=st.recent[agent+'|'+num];return !!s&&now()-s<=24*3600e3};
 const pausedUntil=(agent,cnv,num)=>Math.max(cnv&&st.paused[agent+'|'+cnv]||0,num&&st.paused[agent+'|'+num]||0);
 // where handoffs and drafts go: the Questions topic of the agent's team group
 async function target(agent){const g=await teamGroup(agent).catch(()=>null);return g?.chatId?{chatId:g.chatId,threadId:g.topics?.questions||null,mention:g.mention||''}:null}

 // POST /kirimdev/<agent>: verified, recorded and answered at once (Kirimdev waits 10 s at most)
 async function receive(agent,headers,raw){const line=await lineOf(agent);if(!line)return {status:404,body:{error:'Unknown line'}};
  if(raw.length>MAX_BODY)return {status:413,body:{error:'Too large'}};
  if(!verifySignature(raw,headers['x-kirim-signature'],await secretsOf(agent),now()/1000))return {status:401,body:{error:'Invalid signature'}};
  const event=String(headers['x-kirim-event']||'');if(event&&!EVENTS.includes(event))return {status:200,body:{ignored:event}};
  let j;try{j=JSON.parse(raw.toString('utf8'))}catch{return {status:400,body:{error:'Bad JSON'}}}
  const id=String(headers['x-kirim-event-id']||'');await state();
  if(id&&st.seen.includes(id))return {status:200,body:{duplicate:id}};if(id)st.seen.push(id);
  if(event==='message.sent'||j?.type==='message.sent'){const r=await teamSent(agent,line,parseSent(j));await saveState();return {status:200,body:r}}
  const all=parseInbound(j),pid=String(line.phoneNumberId);const ms=all.filter(m=>m.pid===pid);
  if(all.length>ms.length)log('kirimdev '+agent+': '+(all.length-ms.length)+' message(s) for another WhatsApp number, not answered');
  if(ms.length)st.last[agent]={at:now(),from:ms[0].from};
  const mode=modeOf(line);
  for(const m of ms){st.recent[agent+'|'+m.from]=now();const tester=isTester(line,m);
   if(tester)st.testerNums[agent+'|'+m.from]=true;
   if(mode==='test'&&!tester){log('kirimdev '+agent+': a message from a number that is not a tester (Test mode), not answered');continue}
   const key=agent+'|'+(m.conversationId||m.from);
   if(tester&&RESET.test(m.text.trim())){st.cut[key]=new Date((m.ts||now()/1000)*1000+1000).toISOString();delete st.pending[key];
    send(agent,line,m.from,'✅ Test reset. Chat dari awal ya, anggap kamu customer baru.').catch(e=>log('kirimdev reset reply: '+e.message));continue}
   const until=pausedUntil(agent,m.conversationId,m.from);
   if(until>now()){log('kirimdev '+agent+': '+tail(m.from)+' wrote while a team member is answering; the agent waits until '+new Date(until).toISOString());continue}
   st.pending[key]={agent,from:m.from,conversationId:m.conversationId,name:testerName(line,m),at:now()};schedule(key,line)}
  await saveState();return {status:200,body:{ok:true}}}

 // an outbound message on this line: ours (aqeelOS sent it) or a person's, which pauses the agent in that conversation
 const inflight=new Map();
 async function teamSent(agent,line,s){if(s.pid!==String(line.phoneNumberId)){log('kirimdev '+agent+': a sent message for another WhatsApp number, ignored');return {ignored:'other line'}}
  if(s.source==='broadcast')return {ignored:'broadcast'};if(s.id&&st.ours[s.id])return {ours:true};
  // an API send of ours may echo before its id is written down: wait for sends in flight, then look again
  if(s.source==='api'||!s.source){await (inflight.get(s.to)||Promise.resolve()).catch(()=>{});await wait(echoWait);if(s.id&&st.ours[s.id])return {ours:true}}
  const min=Math.max(0,Number(line.pauseMin??15));if(!min)return {paused:false};const until=now()+min*60e3;
  if(s.conversationId)st.paused[agent+'|'+s.conversationId]=until;if(s.to)st.paused[agent+'|'+s.to]=until;
  for(const k of [agent+'|'+s.conversationId,agent+'|'+s.to])if(st.pending[k]){delete st.pending[k];clearTimeout(timers.get(k));timers.delete(k)}
  log('kirimdev '+agent+': a team member replied to '+tail(s.to)+' ('+(s.source||'?')+'); the agent waits '+min+' min');return {paused:until}}

 // a burst of messages is answered once: the run starts a few seconds after the last one
 const timers=new Map(),running=new Set();let active=0;
 function schedule(key,line){clearTimeout(timers.get(key));timers.set(key,setTimeout(()=>{timers.delete(key);run(key).catch(e=>log('kirimdev '+key+': '+e.message))},(line.debounceSec??8)*1000))}
 async function run(key){if(running.has(key)){schedule(key,{debounceSec:5});return}
  while(active>=maxRuns)await wait(1000);
  await state();const p=st.pending[key];if(!p)return;const line=await lineOf(p.agent);if(!line)return;
  running.add(key);active++;delete st.pending[key];await saveState();
  try{if(pausedUntil(p.agent,p.conversationId,p.from)>now())return;await answer(p.agent,line,p,key)}finally{running.delete(key);active--}}

 async function history(line,p,key){if(!p.conversationId)return '';const q=new URLSearchParams({conversation_id:p.conversationId,limit:'30'});
  const l=((await api(line.phoneNumberId+'/messages?'+q)).data||[]).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).filter(m=>String(m.created_at)>(st.cut[key]||''));
  return l.slice(-20).map(m=>(m.direction==='inbound'?'CUSTOMER':String(line.persona||'AGENT').toUpperCase())+': '+(String(m.content||'').replace(FOOTER,'').trim()||'['+m.type+']')).join('\n')}

 async function answer(agent,line,p,key){const hist=await history(line,p,key);const mode=modeOf(line);
  const who=mode==='test'?'WHATSAPP TEST CHAT (customer = a team tester, treat them exactly like a real customer).':'WHATSAPP CHAT with a customer.';
  const q=who+' You are '+line.persona+' for '+line.business+'. Read your knowledge sheet tabs + decisions file first; for anything they do not cover (product facts, how something works), search your own line\'s past chats with past_chats before you hand off. Conversation so far (oldest first):\n\n'+hist+
   '\n\nWrite ONLY the WhatsApp reply text to send next (Indonesian, WhatsApp formatting with *bold*, short paragraphs). Do NOT send anything yourself. '+
   'If several messages are needed, separate them with a line containing only ---. If this must go to a human (handoff rules), reply exactly: HANDOFF: <reason, and what you already checked (sheet, past chats) and found>';
  log('kirimdev '+agent+': answering '+p.name);let out=String(await runAgent(agent,q)||'').replace(FOOTER,'').trim();
  if(!out){log('kirimdev '+agent+': the agent wrote nothing');return}
  // a team member replied while the agent was thinking: theirs stands
  await state();if(pausedUntil(agent,p.conversationId,p.from)>now()){log('kirimdev '+agent+': a team member answered meanwhile; the agent\'s reply was not sent');return}
  if(/^HANDOFF\b/.test(out)){const why=out.replace(/^HANDOFF:?\s*/,'').trim();const lastQ=hist.split('\n').filter(l=>l.startsWith('CUSTOMER: ')).pop()?.slice(10)||'-';
   const h={id:'h'+(++st.seq),agent,from:p.from,conversationId:p.conversationId,name:p.name,lastQ,why,notify:mode!=='draft',tries:0,at:now()};
   await postHandoff(h,line);return}
  // pictures the agent should send with a recommendation, when it forgets the tags
  if(line.autoPhotos?.pattern&&new RegExp(line.autoPhotos.pattern,'i').test(out)&&!/\[(FOTO|TEMPLATE):/.test(out))out+='\n'+(line.autoPhotos.tags||[]).join('\n');
  const g=guardReply(splitReply(out));
  if(g.removed.length)log('kirimdev '+agent+': held back '+g.removed.length+' line(s) meant for the team: '+g.removed.join(' | ').slice(0,200));
  if(g.hold){log('kirimdev '+agent+': reply held: '+g.hold);const lastQ=hist.split('\n').filter(l=>l.startsWith('CUSTOMER: ')).pop()?.slice(10)||'-';
   await postHandoff({id:'h'+(++st.seq),agent,from:p.from,conversationId:p.conversationId,name:p.name,lastQ,why:g.hold,notify:false,tries:0,at:now()},line);return}
  if(mode==='draft')return makeDraft(agent,line,p,g.parts);
  for(const part of g.parts){try{await send(agent,line,p.from,part)}catch(e){log('kirimdev '+agent+': sending failed: '+e.message)}await wait(2500)}}

 // a handoff is posted first; the customer hears it was passed on only once Telegram confirmed the post
 async function postHandoff(h,line){const t=await target(h.agent);
  const post='❓ HANDOFF ('+line.persona+', '+h.name+', +'+h.from+')\nCustomer asked: '+h.lastQ+'\n\nWhy: '+h.why+'\n\n'+(t?.mention?t.mention+' ':'')+'reply here with the answer and '+line.persona+' sends it to the customer.';
  const mid=t?await telegram(h.agent,t.chatId,t.threadId,post).catch(()=>false):false;h.tries++;
  if(mid){delete st.handoffs[h.id];log('kirimdev '+h.agent+': handoff posted'+(h.tries>1?' (try '+h.tries+')':''));if(h.tries>1)await solved(h.agent,'handoff|'+h.id).catch(()=>{});
   if(h.notify&&within24h(h.agent,h.from)&&pausedUntil(h.agent,h.conversationId,h.from)<=now())
    await send(h.agent,line,h.from,line.handoff?.customerText||'Baik kak, untuk pertanyaan ini saya bantu teruskan ke tim kami dulu ya 🙏 Mohon ditunggu sebentar.').catch(e=>log('kirimdev '+h.agent+': sending failed: '+e.message));
   await saveState();return true}
  if(now()-h.at>24*3600e3){delete st.handoffs[h.id];await tell(line.persona+' gave up posting a handoff in Telegram','After a day of tries. The customer (+'+h.from+') was not told anything. Their question: '+h.lastQ).catch(()=>{});await saveState();return false}
  h.next=now()+RETRY_MIN[Math.min(h.tries-1,RETRY_MIN.length-1)]*60e3;st.handoffs[h.id]=h;
  if(h.tries===1){const title=line.persona+' could not post a handoff in Telegram',detail=(t?'':'No team group is set for '+line.persona+' (Channels page, Team group). ')+'The customer (+'+h.from+') was not told it was passed on. aqeelOS tries again in 1, 5, 15 and 30 minutes, then hourly.\n\n'+post.slice(0,500);
   // System › Health and one Telegram alert to the owner (agent-health.mjs) when that is there; the bell otherwise
   await (problem?problem(h.agent,'handoff|'+h.id,title,detail):tell(title,detail)).catch(()=>{});log('kirimdev '+h.agent+': handoff not posted; the owner was told')}
  await saveState();return false}
 // handoffs waiting for another try (every 30 seconds on the live box)
 let ticking=false;
 async function tick(){if(ticking)return;ticking=true;try{await state();for(const h of Object.values(st.handoffs)){if((h.next||0)>now())continue;const line=await lineOf(h.agent);if(!line){delete st.handoffs[h.id];continue}await postHandoff(h,line)}}finally{ticking=false}}

 // Draft: the reply waits in the Questions topic (and on the Channels page) for a person to approve it
 async function makeDraft(agent,line,p,parts){if(!parts.length)return;const id=++st.seq;
  const d={id,agent,from:p.from,conversationId:p.conversationId,name:p.name,parts,at:now(),status:'waiting'};st.drafts[id]=d;
  const t=await target(agent);
  const post='📝 DRAFT #'+id+' ('+line.persona+', '+p.name+', +'+p.from+')\n\n'+parts.join('\n---\n')+'\n\n'+(t?.mention?t.mention+' ':'')+'reply "ok" to send it to the customer, reply with the changed text to send that instead, or "no" to drop it.';
  const mid=t?await telegram(agent,t.chatId,t.threadId,post).catch(()=>false):false;d.posted=!!mid;
  if(!mid)await tell(line.persona+' wrote a draft that could not be posted in Telegram',(t?'':'No team group is set (Channels page, Team group). ')+'It waits on the Channels page, where you can send or drop it.').catch(()=>{});
  log('kirimdev '+agent+': draft #'+id+' for '+p.name+(mid?' posted':' kept on the Channels page'));await saveState();return d}
 // send (as written or changed) or drop a draft: whatsapp_draft for the agent, the Channels page for a person
 async function draft(agent,id,action,text,by){await state();const d=st.drafts[Number(id)];
  if(!d||d.agent!==agent)throw Error('There is no draft #'+id+' for this agent.');
  if(d.status!=='waiting')throw Error('Draft #'+id+' was already '+(d.status==='sent'?'sent':'dropped')+'.');
  if(action==='discard'||action==='drop'){d.status='dropped';d.doneAt=now();d.by=String(by||'');await saveState();return {dropped:true}}
  if(action!=='send')throw Error('The action is send or discard.');
  const line=await lineOf(agent);if(!line)throw Error('This agent has no WhatsApp line through Kirimdev.');
  if(!within24h(agent,d.from))throw Error('The customer last wrote more than 24 hours ago, so WhatsApp does not allow a reply.');
  const parts=text&&String(text).trim()?splitReply(text):d.parts;if(!parts.length)throw Error('Write the text to send.');
  d.status='sent';d.doneAt=now();d.by=String(by||'');d.edited=!!(text&&String(text).trim());await saveState();const sent=[];
  for(const p of parts){sent.push(await send(agent,line,d.from,p));await wait(1500)}return {sent:sent.filter(Boolean).length}}

 // one part: text, or a picture from the agent's media/staff (urls.txt for [FOTO], templates.json for [TEMPLATE])
 async function send(agent,line,to,part){const base={messaging_product:'whatsapp',recipient_type:'individual',to};let body;
  const tm=/^\[TEMPLATE:\s*([\w-]+)\s*\]$/.exec(part),fm=/^\[FOTO:\s*(?:media\/staff\/)?([^\]]+?)\s*\]$/.exec(part);
  if(tm){const tp=(await readJson(path.join(WORK,agent,'media','staff','templates.json'),{}))[tm[1]];if(!tp){log('kirimdev '+agent+': no picture for template '+tm[1]);return null}body={...base,type:'image',image:tp}}
  else if(fm){const urls=(await readFile(path.join(WORK,agent,'media','staff','urls.txt'),'utf8').catch(()=>'')).split(/\s+/);const u=urls.find(x=>x.split('/').pop()===fm[1].trim());
   if(!u){log('kirimdev '+agent+': no picture called '+fm[1]);return null}body={...base,type:'image',image:{link:u}}}
  else{const text=part.replace(FOOTER,'').trim().slice(0,4096);if(!text)return null;body={...base,type:'text',text:{body:text,preview_url:false}}}
  const go=api(line.phoneNumberId+'/messages',body).then(async r=>{await state();if(r?.data?.id)st.ours[r.data.id]=now();return r});
  inflight.set(to,go);let r;try{r=await go}finally{if(inflight.get(to)===go)inflight.delete(to)}
  log('kirimdev '+agent+': sent '+(r?.data?.id||'?')+' ('+(r?.data?.status||'?')+')');return r?.data||null}

 // the agent's whatsapp_reply tool: only to someone who wrote to its own line in the last 24 hours (a tester in Test)
 async function reply(agent,to,text){const line=await lineOf(agent);if(!line)throw Error('This agent has no WhatsApp line through Kirimdev.');
  const num=String(to||'').replace(/\D/g,'');await state();
  if(num&&!within24h(agent,num)){const other=Object.keys(st.recent).find(k=>k.endsWith('|'+num)&&k.split('|')[0]!==agent&&now()-st.recent[k]<=24*3600e3);
   if(other)throw Error('That number wrote to another WhatsApp line ('+other.split('|')[0]+'), not to yours. Never answer another brand\'s customers; that agent answers them.')}
  if(!num||!within24h(agent,num))throw Error('That number has not written to this WhatsApp line in the last 24 hours, so WhatsApp does not allow a reply. Ask the team to contact them another way.');
  if(modeOf(line)==='test'&&!isTester(line,{from:num,conversationId:''})&&!st.testerNums[agent+'|'+num])throw Error('This line is in Test, so it only answers its testers.');
  const parts=splitReply(text);if(!parts.length)throw Error('Write the text to send.');const sent=[];
  for(const p of parts){sent.push(await send(agent,line,num,p));await wait(1500)}return sent.filter(Boolean)}

 // connect: one Kirimdev webhook for this line (Kirimdev makes the secret and shows it once)
 async function connect(agent){const line=await lineOf(agent);if(!line)throw Error('No line for '+agent+'.');
  const url=PUBLIC_URL+'/kirimdev/'+agent;const sec=await readJson(SEC,{});
  const r=await api('webhook_subscriptions',{url,events:EVENTS,phone_number_ids:[String(line.phoneNumberId)],description:'aqeelOS · '+agent},{idem:'aqeelos-'+agent+'-'+url+'-2'});
  const s=r?.data?.initial_secret;if(!s)throw Error('Kirimdev did not return a webhook secret.');
  sec[agent]={id:r.data.id,url,secrets:[s],events:EVENTS,at:now()};await put(SEC,sec);return {id:r.data.id,status:r.data.status}}
 // a webhook made before message.sent was used gets it added (Kirimdev keeps the same secret)
 async function ensureEvents(agent){const sec=await readJson(SEC,{}),w=sec[agent];if(!w?.id)return null;if(EVENTS.every(e=>(w.events||[]).includes(e)))return w.events;
  const line=await lineOf(agent);const r=await api('webhook_subscriptions/'+w.id,{events:EVENTS,phone_number_ids:[String(line?.phoneNumberId||'')]},{method:'PATCH'});
  const ev=Array.isArray(r?.data?.events)?r.data.events:EVENTS;const s2=await readJson(SEC,{});s2[agent]={...s2[agent],events:ev};await put(SEC,s2);log('kirimdev '+agent+': webhook now sends '+ev.join(', '));return ev}
 async function webhook(agent){const id=(await readJson(SEC,{}))[agent]?.id;if(!id)return null;try{return (await api('webhook_subscriptions/'+id)).data}catch(e){return {error:e.message}}}

 async function status(){const L=await lines(),sec=await readJson(SEC,{});await state();const t=now();
  return Promise.all(Object.entries(L).map(async([agent,l])=>{const tg=await target(agent);const seen=new Set();
   return {agent,persona:l.persona,business:l.business,mode:modeOf(l),testers:(l.testers||[]).map(t=>t.who),connected:!!sec[agent]?.secrets?.length,
    hearsTeam:EVENTS.every(e=>(sec[agent]?.events||[]).includes(e)),last:st.last[agent]?.at||null,pauseMin:Number(l.pauseMin??15),
    team:tg?{chatId:tg.chatId,questions:tg.threadId}:null,
    paused:Object.entries(st.paused).filter(([k,v])=>k.startsWith(agent+'|')&&v>t&&/^\d+$/.test(k.split('|')[1])).map(([k,v])=>({who:tail(k.split('|')[1]),until:v})).filter(x=>!seen.has(x.who)&&seen.add(x.who)),
    drafts:Object.values(st.drafts).filter(d=>d.agent===agent&&d.status==='waiting').sort((a,b)=>a.id-b.id).map(d=>({id:d.id,name:d.name,who:tail(d.from),text:d.parts.join('\n\n'),at:d.at,posted:!!d.posted,canSend:within24h(agent,d.from)})),
    handoffsWaiting:Object.values(st.handoffs).filter(h=>h.agent===agent).length}}))}
 async function setMode(agent,mode){if(!MODES.includes(mode))throw Error('Mode is test, draft or live.');const c=await readJson(CONF,{lines:{}});if(!c.lines?.[agent])throw Error('No line for '+agent+'.');c.lines[agent].mode=mode;await put(CONF,c,0o644);return true}
 async function setPause(agent,min){const n=Number(min);if(!Number.isInteger(n)||n<0||n>1440)throw Error('The quiet time is a whole number of minutes, 0 to 1440.');const c=await readJson(CONF,{lines:{}});if(!c.lines?.[agent])throw Error('No line for '+agent+'.');c.lines[agent].pauseMin=n;await put(CONF,c,0o644);return n}
 // after a restart: conversations that were waiting are answered, handoffs are tried again, webhooks hear team replies
 let iv=null;
 async function resume(){await state();for(const [k,p] of Object.entries(st.pending)){const l=await lineOf(p.agent);if(l)schedule(k,l)}
  if(!iv){iv=setInterval(()=>tick().catch(e=>log('kirimdev retry: '+e.message)),30000);iv.unref?.()}
  for(const a of Object.keys(await lines()))await ensureEvents(a).catch(e=>log('kirimdev '+a+': could not add message.sent to the webhook: '+e.message))}
 return {receive,reply,draft,connect,webhook,ensureEvents,status,setMode,setPause,resume,lines,_api:api,_tick:tick,_state:state}}
