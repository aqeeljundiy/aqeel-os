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
// [TEMPLATE: name] as real pictures, and HANDOFF: <why> as a question in the line's Telegram topic (the customer is
// told it was passed on). One run per conversation at a time, two at once in all. A line in Test answers only its
// testers; Live answers everyone. The agent can answer a customer later (a team answer to a handoff) with the
// whatsapp_reply tool, only to someone who wrote to that line within 24 hours (WhatsApp's own window).
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import path from 'node:path';

export const TOLERANCE=300,MAX_BODY=1024*1024,API='https://api.kirimdev.com/v1';
export const FOOTER=/\n*\(Answered with [^)]*\)\s*$/;
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

// what the agent wrote, as the parts to send: its notes about backup models are never sent
export function splitReply(out){const t=String(out||'').replace(FOOTER,'').trim();const parts=[];
 for(const x of t.split(/\n-{3,}\n/))for(const y of x.split(/(\[(?:FOTO|TEMPLATE):[^\]]+\])/))if(y.trim())parts.push(y.trim());
 return parts.slice(0,8)}

const RESET=/^(reset|\/reset|mulai baru)$/i;

export function createKirimdev({DATA,WORK,apiKey,runAgent,telegram,tell=async()=>{},log=m=>console.log(m),fetchImpl=fetch,now=()=>Date.now(),PUBLIC_URL,wait=ms=>new Promise(r=>setTimeout(r,ms)),maxRuns=2}){
 const CONF=path.join(DATA,'kirimdev.json'),SEC=path.join(DATA,'kirimdev-secrets.json'),ST=path.join(DATA,'kirimdev-state.json');
 const readJson=async(f,d)=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return d}};
 const put=async(f,v,mode=0o600)=>{await mkdir(DATA,{recursive:true});const t=f+'.'+process.pid+'.'+randomUUID().slice(0,8)+'.tmp';await writeFile(t,JSON.stringify(v,null,1),{mode});await rename(t,f)};
 let st=null,chain=Promise.resolve();const queue=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p};
 const state=async()=>st||=Object.assign({seen:[],cut:{},recent:{},pending:{},last:{},testerNums:{}},await readJson(ST,{}));
 const saveState=()=>queue(async()=>{await state();st.seen=st.seen.slice(-3000);for(const [k,t] of Object.entries(st.recent))if(now()-t>48*3600e3)delete st.recent[k];await put(ST,st)});
 const lines=async()=>(await readJson(CONF,{lines:{}})).lines||{};
 const lineOf=async agent=>AGENT.test(agent)?(await lines())[agent]||null:null;
 const secretsOf=async agent=>((await readJson(SEC,{}))[agent]?.secrets)||[];

 async function api(p,body,{idem}={}){const key=await apiKey();if(!key)throw Error('No Kirimdev API key is saved (KIRIMDEV_API_KEY).');
  const r=await fetchImpl(API+'/'+p,{method:body?'POST':'GET',headers:{authorization:'Bearer '+key,'content-type':'application/json','user-agent':'aqeelOS/1.0',...(body?{'idempotency-key':idem||randomUUID()}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(40000)});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error('Kirimdev answered '+r.status+(j?.error?.code?' '+j.error.code:'')),{status:r.status,code:j?.error?.code});return j}

 const isTester=(line,m)=>(line.testers||[]).some(t=>t.conversationId&&t.conversationId===m.conversationId||t.phone&&String(t.phone).replace(/\D/g,'')===m.from);
 const testerName=(line,m)=>(line.testers||[]).find(t=>t.conversationId===m.conversationId||String(t.phone||'').replace(/\D/g,'')===m.from)?.who||m.name||'customer';

 // POST /kirimdev/<agent>: verified, recorded and answered at once (Kirimdev waits 10 s at most)
 async function receive(agent,headers,raw){const line=await lineOf(agent);if(!line)return {status:404,body:{error:'Unknown line'}};
  if(raw.length>MAX_BODY)return {status:413,body:{error:'Too large'}};
  if(!verifySignature(raw,headers['x-kirim-signature'],await secretsOf(agent),now()/1000))return {status:401,body:{error:'Invalid signature'}};
  const event=String(headers['x-kirim-event']||'');if(event&&event!=='message.received')return {status:200,body:{ignored:event}};
  let j;try{j=JSON.parse(raw.toString('utf8'))}catch{return {status:400,body:{error:'Bad JSON'}}}
  const id=String(headers['x-kirim-event-id']||'');await state();
  if(id&&st.seen.includes(id))return {status:200,body:{duplicate:id}};if(id)st.seen.push(id);
  const ms=parseInbound(j).filter(m=>!m.pid||m.pid===String(line.phoneNumberId));
  st.last[agent]={at:now(),from:ms[0]?.from||''};
  for(const m of ms){st.recent[agent+'|'+m.from]=now();
   if(isTester(line,m))st.testerNums[agent+'|'+m.from]=true;
   if(line.mode!=='live'&&!isTester(line,m)){log('kirimdev '+agent+': a message from a number that is not a tester (Test mode), not answered');continue}
   const key=agent+'|'+(m.conversationId||m.from);
   if(RESET.test(m.text.trim())){st.cut[key]=new Date((m.ts||now()/1000)*1000+1000).toISOString();delete st.pending[key];
    send(agent,line,m.from,'✅ Test reset. Chat dari awal ya, anggap kamu customer baru.').catch(e=>log('kirimdev reset reply: '+e.message));continue}
   st.pending[key]={agent,from:m.from,conversationId:m.conversationId,name:testerName(line,m),at:now()};schedule(key,line)}
  await saveState();return {status:200,body:{ok:true}}}

 // a burst of messages is answered once: the run starts a few seconds after the last one
 const timers=new Map(),running=new Set();let active=0;
 function schedule(key,line){clearTimeout(timers.get(key));timers.set(key,setTimeout(()=>{timers.delete(key);run(key).catch(e=>log('kirimdev '+key+': '+e.message))},(line.debounceSec??8)*1000))}
 async function run(key){if(running.has(key)){schedule(key,{debounceSec:5});return}
  while(active>=maxRuns)await wait(1000);
  await state();const p=st.pending[key];if(!p)return;const line=await lineOf(p.agent);if(!line)return;
  running.add(key);active++;delete st.pending[key];await saveState();
  try{await answer(p.agent,line,p,key)}finally{running.delete(key);active--}}

 async function history(line,p,key){if(!p.conversationId)return '';const q=new URLSearchParams({conversation_id:p.conversationId,limit:'30'});
  const l=((await api(line.phoneNumberId+'/messages?'+q)).data||[]).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).filter(m=>String(m.created_at)>(st.cut[key]||''));
  return l.slice(-20).map(m=>(m.direction==='inbound'?'CUSTOMER':String(line.persona||'AGENT').toUpperCase())+': '+(String(m.content||'').replace(FOOTER,'').trim()||'['+m.type+']')).join('\n')}

 async function answer(agent,line,p,key){const hist=await history(line,p,key);
  const who=line.mode==='live'?'WHATSAPP CHAT with a customer.':'WHATSAPP TEST CHAT (customer = a team tester, treat them exactly like a real customer).';
  const q=who+' You are '+line.persona+' for '+line.business+'. Read your knowledge sheet tabs + decisions file first. Conversation so far (oldest first):\n\n'+hist+
   '\n\nWrite ONLY the WhatsApp reply text to send next (Indonesian, WhatsApp formatting with *bold*, short paragraphs). Do NOT send anything yourself. '+
   'If several messages are needed, separate them with a line containing only ---. If this must go to a human (handoff rules), reply exactly: HANDOFF: <reason>';
  log('kirimdev '+agent+': answering '+p.name);let out=String(await runAgent(agent,q)||'').replace(FOOTER,'').trim();
  if(!out){log('kirimdev '+agent+': the agent wrote nothing');return}
  if(/^HANDOFF\b/.test(out)){const why=out.replace(/^HANDOFF:?\s*/,'').trim();const lastQ=hist.split('\n').filter(l=>l.startsWith('CUSTOMER: ')).pop()?.slice(10)||'-';
   const post='❓ HANDOFF ('+line.persona+', '+p.name+', +'+p.from+')\nCustomer asked: '+lastQ+'\n\nWhy: '+why+'\n\n'+(line.handoff?.mention?line.handoff.mention+' ':'')+'reply here with the answer and '+line.persona+' sends it to the customer.';
   const ok=line.handoff?.chatId?await telegram(agent,line.handoff.chatId,line.handoff.threadId,post).catch(()=>false):false;
   if(!ok){await tell(line.persona+' could not post a handoff in Telegram',post.slice(0,600)).catch(()=>{});log('kirimdev '+agent+': handoff not posted; the owner was told in the bell')}
   out=line.handoff?.customerText||'Baik kak, untuk pertanyaan ini saya bantu teruskan ke tim kami dulu ya 🙏 Mohon ditunggu sebentar.'}
  // pictures the agent should send with a recommendation, when it forgets the tags
  if(line.autoPhotos?.pattern&&new RegExp(line.autoPhotos.pattern,'i').test(out)&&!/\[(FOTO|TEMPLATE):/.test(out))out+='\n'+(line.autoPhotos.tags||[]).join('\n');
  for(const part of splitReply(out)){try{await send(agent,line,p.from,part)}catch(e){log('kirimdev '+agent+': sending failed: '+e.message)}await wait(2500)}}

 // one part: text, or a picture from the agent's media/staff (urls.txt for [FOTO], templates.json for [TEMPLATE])
 async function send(agent,line,to,part){const base={messaging_product:'whatsapp',recipient_type:'individual',to};let body;
  const tm=/^\[TEMPLATE:\s*([\w-]+)\s*\]$/.exec(part),fm=/^\[FOTO:\s*(?:media\/staff\/)?([^\]]+?)\s*\]$/.exec(part);
  if(tm){const tp=(await readJson(path.join(WORK,agent,'media','staff','templates.json'),{}))[tm[1]];if(!tp){log('kirimdev '+agent+': no picture for template '+tm[1]);return null}body={...base,type:'image',image:tp}}
  else if(fm){const urls=(await readFile(path.join(WORK,agent,'media','staff','urls.txt'),'utf8').catch(()=>'')).split(/\s+/);const u=urls.find(x=>x.split('/').pop()===fm[1].trim());
   if(!u){log('kirimdev '+agent+': no picture called '+fm[1]);return null}body={...base,type:'image',image:{link:u}}}
  else{const text=part.replace(FOOTER,'').trim().slice(0,4096);if(!text)return null;body={...base,type:'text',text:{body:text,preview_url:false}}}
  const r=await api(line.phoneNumberId+'/messages',body);log('kirimdev '+agent+': sent '+(r?.data?.id||'?')+' ('+(r?.data?.status||'?')+')');return r?.data||null}

 // the agent's whatsapp_reply tool: only to someone who wrote to its line in the last 24 hours (a tester in Test)
 async function reply(agent,to,text){const line=await lineOf(agent);if(!line)throw Error('This agent has no WhatsApp line through Kirimdev.');
  const num=String(to||'').replace(/\D/g,'');await state();const seen=st.recent[agent+'|'+num];
  if(!num||!seen||now()-seen>24*3600e3)throw Error('That number has not written to this WhatsApp line in the last 24 hours, so WhatsApp does not allow a reply. Ask the team to contact them another way.');
  if(line.mode!=='live'&&!isTester(line,{from:num,conversationId:''})&&!st.testerNums[agent+'|'+num])throw Error('This line is in Test, so it only answers its testers.');
  const parts=splitReply(text);if(!parts.length)throw Error('Write the text to send.');const sent=[];
  for(const p of parts){sent.push(await send(agent,line,num,p));await wait(1500)}return sent.filter(Boolean)}

 // connect: one Kirimdev webhook for this line (Kirimdev makes the secret and shows it once)
 async function connect(agent){const line=await lineOf(agent);if(!line)throw Error('No line for '+agent+'.');
  const url=PUBLIC_URL+'/kirimdev/'+agent;const sec=await readJson(SEC,{});
  const r=await api('webhook_subscriptions',{url,events:['message.received'],phone_number_ids:[String(line.phoneNumberId)],description:'aqeelOS · '+agent},{idem:'aqeelos-'+agent+'-'+url});
  const s=r?.data?.initial_secret;if(!s)throw Error('Kirimdev did not return a webhook secret.');
  sec[agent]={id:r.data.id,url,secrets:[s],at:now()};await put(SEC,sec);return {id:r.data.id,status:r.data.status}}
 async function webhook(agent){const id=(await readJson(SEC,{}))[agent]?.id;if(!id)return null;try{return (await api('webhook_subscriptions/'+id)).data}catch(e){return {error:e.message}}}

 async function status(){const L=await lines(),sec=await readJson(SEC,{});await state();
  return Object.entries(L).map(([agent,l])=>({agent,persona:l.persona,business:l.business,mode:l.mode==='live'?'live':'test',testers:(l.testers||[]).map(t=>t.who),connected:!!sec[agent]?.secrets?.length,last:st.last[agent]?.at||null}))}
 async function setMode(agent,mode){if(!['test','live'].includes(mode))throw Error('Mode is test or live.');const c=await readJson(CONF,{lines:{}});if(!c.lines?.[agent])throw Error('No line for '+agent+'.');c.lines[agent].mode=mode;await put(CONF,c,0o644);return true}
 // after a restart: conversations that were waiting are answered
 async function resume(){await state();for(const [k,p] of Object.entries(st.pending)){const l=await lineOf(p.agent);if(l)schedule(k,l)}}
 return {receive,reply,connect,webhook,status,setMode,resume,lines,_api:api}}
