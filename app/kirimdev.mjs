// Kirimdev lines (audit, 5 Nov 2026). Kirimdev is the team's WhatsApp CRM: aqeelOS talks to it with one API key, and a
// webhook per line is the optional extra that lets an agent answer at once. It is not the agents' own WhatsApp channel
// (the engine's WhatsApp platform, Channels page); the owner, 7 Nov 2026: "Kirimdev is WhatsApp CRM. Kirimdev we only use
// API key". Health and the UI call these "Kirimdev line (<persona>)", never "WhatsApp". It replaces the bridge script the main agent ran in the
// background (wa-agent/bridge/bridge.py): that one polled Kirimdev every 15 seconds, stopped at every engine restart,
// once ran twice (double replies), and kept its numbers, testers and Telegram topics in code.
//
// Each agent may have one Kirimdev line (a business number in Kirimdev): settings in DATA/kirimdev.json, its webhook
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
import {publicUrl} from './install.mjs';   // Your address (System › Settings), read at the moment a webhook is made
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import path from 'node:path';

export const TOLERANCE=300,MAX_BODY=1024*1024,API=(process.env.KIRIMDEV_API||'https://api.kirimdev.com/v1').replace(/\/+$/,'');   // KIRIMDEV_API: a stand-in for tests
export const FOOTER=/\n*\(Answered with [^)]*\)\s*$/;
export const MODES=['test','draft','live'],EVENTS=['message.received','message.sent'];
export const RETRY_MIN=[1,5,15,30,60],DEFAULT_PAUSE=15;
// Kirimdev contact labels (8 Nov 2026, LABEL_SOP.md): the agent may set only the line's allowed labels (lines.<agent>.labels.allowed);
// these never: who someone is (Internal, Boss, Influencer) and what they paid for (Customer, S-…), which only a confirmed
// payment sets (paid-labels.mjs). At most LABEL_MAX changes in one call or one run.
export const LABEL_NEVER=/^(internal|boss|influencer|customer)$|^s-/i,LABEL_MAX=6;
// can Kirimdev reach this address from the internet? Not localhost, a private or link-local address, or a test name
export function publicReach(u){let x;try{x=new URL(String(u||''))}catch{return {ok:false,why:'aqeelOS has no public address (set Your address on System › Settings), so Kirimdev cannot send it messages. It reads new messages every 20 seconds instead.'}}
 const h=x.hostname.replace(/^\[|\]$/g,'').toLowerCase(),priv=/^(localhost|.*\.(localhost|local|test|internal|lan|home)|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|0\.0\.0\.0|::1?|f[cd][0-9a-f]*:.*|fe80:.*)$/;
 if(priv.test(h)||!/\./.test(h)&&!h.includes(':'))return {ok:false,why:'aqeelOS runs at '+x.origin+', which Kirimdev cannot reach from the internet, so there is no webhook. It reads new messages every 20 seconds instead.'};
 if(x.protocol!=='https:')return {ok:false,why:'aqeelOS’s address ('+x.origin+') is not https, and Kirimdev only sends to https. It reads new messages every 20 seconds instead.'};
 return {ok:true}}
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
 return {pid:String(d.session||d.meta?.phone_number_id||''),id:String(m.id||''),source:String(m.source||''),to:String(m.to||d.contact?.phone_number||'').replace(/\D/g,''),conversationId:String(d.conversation?.id||''),name:String(d.contact?.name||''),text:String(m.content??m.body??m.text?.body??m.text??'').trim()}}

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
// signs that the agent's own reasoning or files leaked into the reply: the whole reply is held for a person
const LEAK=[/\b(rules?\s+tab|decisions?\s+(file|log|tab)|knowledge\s+(sheet|base|file)|hand-?offs?|briefing|soul\.md|\w*_decisions|past_chats|system\s+prompt|my\s+instructions|the\s+customer)\b/i,
 /^\s*(I|I'm|I've|I'll|I\s+will|Let\s+me|Okay|Sure|Based\s+on|Here\s+is|Here's|Now|First|Reply|Draft|Note|Thinking)\b[\s,:']/,
 /\b[\w-]+\.(md|json|txt|py|csv|ya?ml|jpe?g|png|webp|pdf)\b/i];
// paid: whether the payment tool made a payment in this run (null = unknown, the old QR-picture check only)
// a reply that says a payment (QRIS, VA, link, invoice) is sent, attached or below needs a real payment from this run
// (audit 6 Nov: "link Xendit tadi" was never sent; three "Berikut QRIS" had no QRIS)
const PAY_CLAIM=/\b(qris|virtual account|nomor va|va\s+(bca|bni|bri|mandiri)|link (pembayaran|bayar|xendit|invoice)|payment link|invoice)\b[^\n]{0,60}\b(sudah|telah|udah)?\s*(saya |kami )?(kirim(kan)?|terkirim|berikut|terlampir|di ?bawah|sent|attached|below)\b|\b(berikut|terlampir)\b[^\n]{0,25}\b(qris|va|virtual account|link (pembayaran|bayar)|invoice)\b|\b(sudah|telah|udah)\s+(saya |kami )?(kirim(kan)?|buat(kan)?)\b[^\n]{0,40}\b(qris|va|virtual account|link|invoice)\b/i;
export function guardReply(parts,{paid=null}={}){const removed=[];const keep=[];
 for(const p of parts){if(/^\[(FOTO|TEMPLATE):/.test(p)){keep.push(p);continue}
  for(const l of p.split('\n'))if(INTERNAL.some(r=>r.test(l))||LEAK.some(r=>r.test(l)))removed.push(l.trim());keep.push(p)}
 if(removed.length)return {parts:keep,removed,hold:'The reply had text meant for the team, not the customer: '+removed.join(' | ').slice(0,300)};
 // a QR is promised only when the text says the QRIS itself is here/attached; QRIS listed as a payment option
 // (order form, 'pilih metode') is not a promise (false hold, 6 Nov)
 const QR_PROMISE=/(berikut|ini|terlampir|di ?bawah|kami kirim(kan)?|saya kirim(kan)?|here is|attached)[^\n]{0,25}\bQRIS\b|\bQRIS(-?nya)?\b[^\n]{0,15}(terlampir|di ?bawah|berikut|attached)/i;
 const promisesQr=keep.some(p=>QR_PROMISE.test(p)&&!/metode pembayaran|pilih (salah satu|metode)|payment method/i.test(p));
 const hasPic=keep.some(p=>/^\[FOTO:/i.test(p));
 if(promisesQr&&!hasPic)return {parts:keep,removed,hold:'The reply says a QRIS is attached, but no QR picture was made. Create the QRIS with the payment tool, then send it.'};
 const claims=keep.some(p=>!/^\[(FOTO|TEMPLATE):/.test(p)&&PAY_CLAIM.test(p)&&!/metode pembayaran|pilih (salah satu|metode)|payment method/i.test(p));
 return {parts:keep,removed,hold:paid===false&&claims?'The reply says a payment (QRIS, VA, link or invoice) was sent, but no payment was made in this run. Make it with create_payment first, or hand off.':null}}

import {conversationSession} from './kirimdev-agent.mjs';

const RESET=/^(reset|\/reset|mulai baru)$/i;
// a tester's reset: the usual words, or the line's own (Connect dialog)
const isReset=(line,t)=>RESET.test(t)||(line.resetWords||[]).some(w=>w&&String(t).toLowerCase()===String(w).trim().toLowerCase());
const tail=n=>'…'+String(n||'').slice(-4);

export function createKirimdev({DATA,WORK,apiKey,saveKey=null,checkEvery=10*60e3,pollEvery=20e3,runAgent,paidSince=null,telegram,teamGroup=async()=>null,tell=async()=>{},problem=null,solved=async()=>{},log=m=>console.log(m),activity=async()=>{},fetchImpl=fetch,now=()=>Date.now(),PUBLIC_URL,wait=ms=>new Promise(r=>setTimeout(r,ms)),maxRuns=2,echoWait=4000,setTimer=setTimeout,clearTimer=clearTimeout}){
 const pub=()=>String(PUBLIC_URL??publicUrl()).replace(/\/+$/,'');   // the address given (tests) or the install's current one
 const ASK_MIN=30;   // minutes a handoff may wait for the team's answer before Health shows it
 const CONF=path.join(DATA,'kirimdev.json'),SEC=path.join(DATA,'kirimdev-secrets.json'),ST=path.join(DATA,'kirimdev-state.json');
 const readJson=async(f,d)=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return d}};
 const put=async(f,v,mode=0o600)=>{await mkdir(DATA,{recursive:true});const t=f+'.'+process.pid+'.'+randomUUID().slice(0,8)+'.tmp';await writeFile(t,JSON.stringify(v,null,1),{mode});await rename(t,f)};
 let st=null,loading=null,chain=Promise.resolve();const queue=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p};
 const state=async()=>st||(loading||=readState());
 const readState=async()=>st=Object.assign({seen:[],cut:{},recent:{},pending:{},turns:{},outbox:{},last:{},testerNums:{},ours:{},paused:{},human:{},proposed:{},drafts:{},handoffs:{},asked:{},seq:0},await readJson(ST,{}));
 const saveState=()=>queue(async()=>{await state();st.seen=st.seen.slice(-3000);const t=now();
  for(const [k,v] of Object.entries(st.recent))if(t-v>48*3600e3)delete st.recent[k];
  for(const [k,v] of Object.entries(st.ours))if(t-v>48*3600e3)delete st.ours[k];
  for(const [k,v] of Object.entries(st.paused))if(v<t)delete st.paused[k];
  for(const [k,v] of Object.entries(st.human))if(t-v>48*3600e3)delete st.human[k];
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

 // Kirimdev API health (7 Nov 2026). A raw GET that tells the ways Kirimdev can fail apart: no answer, the key refused,
 // an empty or non-JSON body (the Baylabs unanswered chat check crashed 30 times on 7 Nov, 04:09 to 11:07 WIB, on
 // conversations?limit=50 answering that way), or another HTTP error. Never throws.
 async function probe(p,key){if(!key)return {ok:false,why:'nokey',status:0,text:'No Kirimdev API key is saved.'};let r;
  try{r=await fetchImpl(API+'/'+p,{method:'GET',headers:{authorization:'Bearer '+key,'user-agent':'aqeelOS/1.0'},signal:AbortSignal.timeout(30000)})}
  catch(e){return {ok:false,why:'down',status:0,text:'Kirimdev did not answer ('+(e?.name==='TimeoutError'?'nothing within 30 seconds':String(e?.message||e))+').'}}
  let raw='';try{raw=typeof r.text==='function'?await r.text():JSON.stringify(await r.json())}catch{}
  let j=null;try{j=String(raw).trim()?JSON.parse(raw):null}catch{}
  if(r.status===401||r.status===403)return {ok:false,why:'key',status:r.status,text:'Kirimdev refused the API key (HTTP '+r.status+').'};
  if(!j||typeof j!=='object')return {ok:false,why:'empty',status:r.status,text:'Kirimdev answered HTTP '+r.status+' with '+(String(raw).trim()?'a reply that is not JSON':'an empty reply')+'.'};
  if(!r.ok)return {ok:false,why:'http',status:r.status,text:'Kirimdev answered HTTP '+r.status+(j.error?.code?' ('+j.error.code+')':'')+'.'};
  return {ok:true,status:r.status,json:j}}
 // what the key is: Kirimdev's GET me (the organisation and the key's label and last 4 characters, never the key)
 async function account(key){const r=await probe('me',key);if(!r.ok)return {ok:false,why:r.why,text:r.text};const d=r.json.data||{};
  return {ok:true,org:String(d.organization?.name||''),label:String(d.api_key?.label||''),last4:String(d.api_key?.last4||'')}}
 // one check of every line: the key works, the line's conversations endpoint gives JSON, and, when the line has a webhook
 // (optional), Kirimdev keeps it on and its newest customer message reached aqeelOS. Saved in the state (the Kirimdev page
 // shows it); a problem goes to System › Health as "Kirimdev line (<persona>): …" after two checks in a row, and goes away
 // by itself at the first good check.
 const LATE=10*60e3,HEALTH_TOPICS=['kirimdev|key','kirimdev|api','kirimdev|webhook'];
 let checking=null;
 function check(){return checking||=doCheck().finally(()=>{checking=null})}
 async function doCheck(){await state();const key=await apiKey().catch(()=>null);const acc=key?await account(key):{ok:false,why:'nokey',text:'No Kirimdev API key is saved.'};
  const L=await lines(),sec=await readJson(SEC,{}),t=now(),H=st.health||={lines:{}};H.lines||={};H.account={...acc,at:t};
  for(const [agent,l] of Object.entries(L)){const pid=String(l.phoneNumberId||''),who=l.persona||agent,h={at:t};
   if(!acc.ok){h.api={ok:false,why:acc.why,text:acc.text}}
   else{const c=await probe(encodeURIComponent(pid)+'/conversations?limit=50',key);
    h.api=c.ok?{ok:true,text:'The conversations list answers.'}:{ok:false,why:c.why,text:c.text};
    const w=sec[agent];
    if(!w?.id)h.webhook={state:'none',text:'No webhook: aqeelOS reads new messages from Kirimdev every 20 seconds instead.'};
    else{const ws=await probe('webhook_subscriptions/'+encodeURIComponent(w.id),key),d=ws.json?.data||{};
     const newest=c.ok?Math.max(0,...(c.json.data||[]).map(x=>Date.parse(x.last_inbound_at)||0)):0,heard=st.last[agent]?.at||0;
     if(!ws.ok)h.webhook={state:'unknown',text:'Could not read the webhook: '+ws.text};
     else if(d.status&&d.status!=='active')h.webhook={state:'off',text:'Kirimdev switched the webhook off'+(d.disabled_reason?' ('+d.disabled_reason+')':'')+'.'};
     else if(newest>heard+LATE&&newest>(w.at||0)&&t-newest>LATE/2)h.webhook={state:'late',text:'Kirimdev has a customer message from '+new Date(newest).toISOString().slice(0,16).replace('T',' ')+' UTC that never reached aqeelOS.'};
     else if(Number(d.consecutive_failures)>=3)h.webhook={state:'failing',text:'Kirimdev could not deliver the last '+d.consecutive_failures+' events to aqeelOS.'};
     else h.webhook={state:'ok',text:'Delivering.'}}}
   const was=H.lines[agent]||{},fails={...(was.fails||{})},told={...(was.told||{})};
   const issue={'kirimdev|key':!acc.ok&&(acc.why==='key'||acc.why==='nokey')?(acc.why==='nokey'?['no Kirimdev API key is saved','Save the key on the Kirimdev page (Channels › Kirimdev). Without it the agent cannot read or answer customer chats.']:['the Kirimdev API key does not work',acc.text+' Save a working key on the Kirimdev page (Channels › Kirimdev).']):null,
    'kirimdev|api':acc.ok||!['key','nokey'].includes(acc.why)?(!h.api.ok?['the Kirimdev API gives no usable answer','The conversations list for this line: '+h.api.text+' The agent cannot read its chats, and checks that read Kirimdev (like the unanswered chat check) skip their run. This is Kirimdev or the network, not the agent; it clears by itself when Kirimdev answers again.']:null):null,
    'kirimdev|webhook':['off','late','failing'].includes(h.webhook?.state)?['customer messages are not reaching the agent',h.webhook.text+' Open Channels › Kirimdev and connect the webhook again. Until then customers are not answered at once.']:null};
   for(const k of HEALTH_TOPICS){if(issue[k]){fails[k]=(fails[k]||0)+1;if(fails[k]>=2&&!told[k]&&problem){await problem(agent,k,'Kirimdev line ('+who+'): '+issue[k][0],issue[k][1]).catch(()=>{});told[k]=t}}
    else{fails[k]=0;if(told[k]){await solved(agent,k).catch(()=>{});delete told[k]}}}
   H.lines[agent]={...h,fails,told}}
  for(const a of Object.keys(H.lines))if(!L[a])delete H.lines[a];
  await saveState();return health()}
 const health=()=>({account:st?.health?.account||null,lines:Object.fromEntries(Object.entries(st?.health?.lines||{}).map(([a,h])=>[a,{at:h.at,api:h.api,webhook:h.webhook}]))});
 // a new key: checked with Kirimdev before it is saved, so a typo never replaces a working key
 async function setKey(key){key=String(key||'').trim();if(!/^[\x21-\x7e]{8,200}$/.test(key))throw Error('That does not look like a Kirimdev API key.');
  if(!saveKey)throw Error('Keys cannot be saved here.');const a=await account(key);
  if(!a.ok)throw Error(a.why==='key'?'Kirimdev refused this key. Copy it again from Kirimdev (Settings, API keys).':'Could not check the key: '+a.text);
  await saveKey(key,Object.keys(await lines()));return check()}

 const isTester=(line,m)=>(line.testers||[]).some(t=>t.conversationId&&t.conversationId===m.conversationId||t.phone&&String(t.phone).replace(/\D/g,'')===m.from);
 const testerName=(line,m)=>(line.testers||[]).find(t=>t.conversationId===m.conversationId||String(t.phone||'').replace(/\D/g,'')===m.from)?.who||m.name||'customer';
 const within24h=(agent,num)=>{const s=st.recent[agent+'|'+num];return !!s&&now()-s<=24*3600e3};
 const pausedUntil=(agent,cnv,num)=>Math.max(cnv&&st.paused[agent+'|'+cnv]||0,num&&st.paused[agent+'|'+num]||0);
 // when a person last wrote in a chat (any chat, a tester's too): a reply the agent was writing before that is not sent
 const humanAt=(agent,cnv,num)=>Math.max(cnv&&st.human[agent+'|'+cnv]||0,num&&st.human[agent+'|'+num]||0);
 // where handoffs and drafts go: the Questions topic of the agent's team group
 async function target(agent){const g=await teamGroup(agent).catch(()=>null);return g?.chatId?{chatId:g.chatId,threadId:g.topics?.questions||null,mention:g.mention||''}:null}

 // POST /kirimdev/<agent>: verified, recorded and answered at once (Kirimdev waits 10 s at most)
 async function receive(agent,headers,raw){const line=await lineOf(agent);if(!line)return {status:404,body:{error:'Unknown line'}};
  if(raw.length>MAX_BODY)return {status:413,body:{error:'Too large'}};
  if(!verifySignature(raw,headers['x-kirim-signature'],await secretsOf(agent),now()/1000))return {status:401,body:{error:'Invalid signature'}};
  const event=String(headers['x-kirim-event']||'');if(event&&!EVENTS.includes(event))return {status:200,body:{ignored:event}};
  let j;try{j=JSON.parse(raw.toString('utf8'))}catch{return {status:400,body:{error:'Bad JSON'}}}
  const id=String(headers['x-kirim-event-id']||'');await state();
  const eventKey=id&&agent+'|'+line.phoneNumberId+'|'+id;
  if(eventKey&&st.seen.includes(eventKey))return {status:200,body:{duplicate:id}};if(eventKey)st.seen.push(eventKey);
  if(event==='message.sent'||j?.type==='message.sent'){const r=await teamSent(agent,line,parseSent(j));await saveState();return {status:200,body:r}}
  const all=parseInbound(j),pid=String(line.phoneNumberId);const ms=all.filter(m=>m.pid===pid);
  if(all.length>ms.length)log('kirimdev '+agent+': '+(all.length-ms.length)+' message(s) for another Kirimdev line, not answered');
  await ingest(agent,line,ms);
  await saveState();return {status:200,body:{ok:true}}}
 // customer messages on a line, from the webhook or from polling: recorded, deduped, and answered after the burst
 async function ingest(agent,line,ms){if(ms.length)st.last[agent]={at:now(),from:ms[0].from};
  const mode=modeOf(line);
  for(const m of ms){st.recent[agent+'|'+m.from]=now();const tester=isTester(line,m);
   if(tester)st.testerNums[agent+'|'+m.from]=true;
   if(mode==='test'&&!tester){log('kirimdev '+agent+': a message from a number that is not a tester (Test mode), not answered');continue}
   const key=agent+'|'+line.phoneNumberId+'|'+(m.conversationId||m.from);
   const mid=m.id&&'message|'+agent+'|'+line.phoneNumberId+'|'+m.id;
   if(mid&&st.seen.includes(mid))continue;if(mid)st.seen.push(mid);
   // the same message seen by the webhook and by polling (their ids differ): its chat, second and text
   const same=m.conversationId&&m.ts?'in|'+agent+'|'+m.conversationId+'|'+m.ts+'|'+String(m.text||'').slice(0,40):'';
   if(same&&st.seen.includes(same))continue;if(same)st.seen.push(same);
   if(tester&&isReset(line,m.text.trim())){st.cut[key]=new Date((m.ts||now()/1000)*1000+1000).toISOString();delete st.pending[key];delete st.turns[key];cancelOutbound(agent,m.from);
    // a reset starts the test over: no pause left from earlier test traffic may hold the confirmation or the next question (7 Nov 2026)
    delete st.paused[agent+'|'+m.from];if(m.conversationId)delete st.paused[agent+'|'+m.conversationId];
    await send(agent,line,m.from,line.resetText||'✅ Test reset. Start again as a new customer.').catch(e=>log('kirimdev reset reply: '+e.message));continue}
   const until=pausedUntil(agent,m.conversationId,m.from);
   // a message during a team member's pause is kept, not dropped (audit 6 Nov: "mau pakai CC" was never answered): it waits
   // for the pause to end, and is answered then unless the team answered it meanwhile
   const paused=until>now();if(paused)log('kirimdev '+agent+': '+tail(m.from)+' wrote while a team member is answering; kept until '+new Date(until).toISOString());
   st.pending[key]={agent,from:m.from,conversationId:m.conversationId,name:testerName(line,m),at:st.pending[key]?.at||now(),token:randomUUID(),messages:[...(st.pending[key]?.messages||[]),m.text],...(paused||st.pending[key]?.waited?{waited:true}:{})};
   schedule(key,paused?{debounceSec:Math.ceil((until-now())/1000)+5}:line)}}

 // an outbound message on this line: ours (aqeelOS sent it) or a person's, which pauses the agent in that conversation
 const inflight=new Map();
 const bodyText=b=>String(b?.text?.body||b?.image?.caption||'').trim();
 const isOurText=(agent,s)=>!!s.text&&Object.values(st.outbox).some(o=>o.agent===agent&&o.to===s.to&&o.pid===s.pid&&now()-o.at<3600e3&&bodyText(o.body)===s.text);
 async function teamSent(agent,line,s){if(s.pid!==String(line.phoneNumberId)){log('kirimdev '+agent+': a sent message for another Kirimdev line, ignored');return {ignored:'other line'}}
  if(s.source==='broadcast')return {ignored:'broadcast'};if(s.id&&st.ours[s.id])return {ours:true};
  // an API send of ours may echo before its id is written down: wait for sends in flight, then look again
  if(s.source==='api'||!s.source){await (inflight.get(s.pid+'|'+s.to)||Promise.resolve()).catch(()=>{});await wait(echoWait);if(s.id&&st.ours[s.id])return {ours:true};
   // still unknown: the same text to the same person that aqeelOS queued in the last hour is ours too (a reset confirmation or a
   // reply whose receipt was lost); only a send aqeelOS never made counts as a person's (7 Nov 2026: reset replies paused testers)
  }
  if(isOurText(agent,s)){if(s.id)st.ours[s.id]=now();return {ours:true}}
  // a person wrote: whatever the agent is writing for this chat right now is not sent (a tester's chat too)
  if(s.conversationId)st.human[agent+'|'+s.conversationId]=now();if(s.to)st.human[agent+'|'+s.to]=now();
  // a tester's chat is test traffic: it never pauses, so the tester's next test message is answered at once
  // (only customer chats wait the quiet time for a person); a handoff there still counts as answered
  if(isTester(line,{from:s.to,conversationId:s.conversationId})||st.testerNums[agent+'|'+s.to]){log('kirimdev '+agent+': a person wrote to the tester '+tail(s.to)+' ('+(s.source||'?')+'); test chats do not pause');if(s.to)await answered(agent,s.to);return {tester:true}}
  const min=Math.max(0,Number(line.pauseMin??DEFAULT_PAUSE));if(!min)return {paused:false};const until=now()+min*60e3;
  if(s.conversationId)st.paused[agent+'|'+s.conversationId]=until;if(s.to)st.paused[agent+'|'+s.to]=until;
  cancelOutbound(agent,s.to);
  for(const [k,p] of Object.entries(st.pending))if(p.agent===agent&&(p.conversationId===s.conversationId||p.from===s.to)){delete st.pending[k];delete st.turns[k];clearTimer(timers.get(k));timers.delete(k)}
  log('kirimdev '+agent+': a team member replied to '+tail(s.to)+' ('+(s.source||'?')+'); the agent waits '+min+' min');if(s.to)await answered(agent,s.to);return {paused:until}}

 // a burst of messages is answered once: the run starts a few seconds after the last one
 const timers=new Map(),running=new Set();let active=0;
 // setTimer/clearTimer are injectable so tests drive the burst window themselves instead of racing a 0 s timer
 function schedule(key,line){clearTimer(timers.get(key));timers.set(key,setTimer(()=>{timers.delete(key);return run(key).catch(e=>log('kirimdev '+key+': '+e.message))},(line.debounceSec??8)*1000))}
 async function run(key){if(running.has(key))return;
  running.add(key);let acquired=false,later=false;
  try{while(active>=maxRuns)await wait(1000);active++;acquired=true;
   await state();const p=st.turns[key]||st.pending[key];if(!p)return;st.turns[key]=p;const line=await lineOf(p.agent);if(!line)return;
   const pu=pausedUntil(p.agent,p.conversationId,p.from);if(pu>now()){later=true;delete st.turns[key];schedule(key,{debounceSec:Math.ceil((pu-now())/1000)+5});return}
   // kept during a pause: the team may have answered it since; then it is done
   if(p.waited&&p.conversationId){const l=((await api(line.phoneNumberId+'/messages?'+new URLSearchParams({conversation_id:p.conversationId,limit:'5'}))).data||[]).filter(m=>m.type!=='reaction').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
    if(l[0]?.direction==='outbound'&&Date.parse(l[0].created_at)>p.at){log('kirimdev '+p.agent+': the team answered '+tail(p.from)+' during the pause; nothing more to send');if(st.pending[key]?.token===p.token)delete st.pending[key];delete st.turns[key];await saveState();return}}
   const epoch=st.cut[key]||'';await answer(p.agent,line,p,key);
   // Only consume the snapshot we answered, never a newer arrival.
   if(st.pending[key]?.token===p.token)delete st.pending[key];
   else if(st.pending[key]&&(st.cut[key]||'')===epoch)st.pending[key].messages=st.pending[key].messages.slice((p.messages||[]).length);
   delete st.turns[key];await saveState();
  }finally{running.delete(key);if(acquired)active--;
   if(st?.pending[key]&&!later)schedule(key,{debounceSec:5})}}

 async function history(line,p,key){if(!p.conversationId)return '';const q=new URLSearchParams({conversation_id:p.conversationId,limit:'30'});
  const l=((await api(line.phoneNumberId+'/messages?'+q)).data||[]).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).filter(m=>String(m.created_at)>(st.cut[key]||''));
  return l.map(m=>(m.direction==='inbound'?'CUSTOMER':String(line.persona||'AGENT').toUpperCase())+': '+(String(m.content||'').replace(FOOTER,'').trim()||'['+m.type+']')).join('\n')}

 async function answer(agent,line,p,key){if(p.outbound){for(const id of p.outbound)await deliver(id);return}const epoch=st.cut[key]||'';const hist=await history(line,p,key);const mode=modeOf(line);
  const who=mode==='test'?'WHATSAPP TEST CHAT (customer = a team tester, treat them exactly like a real customer).':'WHATSAPP CHAT with a customer.';
  const q=who+' You are '+line.persona+' for '+line.business+'. Customer WhatsApp number: '+((line.localPrefix?String(p.from||'').replace(new RegExp('^'+String(line.localPrefix.country||'').replace(/\D/g,'')),String(line.localPrefix.local??'')):String(p.from||''))||'unknown')+' (use it for the phone field of the order form; never ask the customer for it). In customer chats you have no shell and no files: read your knowledge sheet with read_sheet and your decisions, briefing and template files with read_file (list_files shows them), this chat with conversation, and make a payment only with create_payment (never .tools/sheet, cat, .tools/kirim, .tools/qris or .tools/pay here). Read your knowledge sheet tabs + decisions file first; for anything they do not cover (product facts, how something works), search your own line\'s past chats with past_chats before you hand off. Conversation so far (oldest first):\n\n'+hist+
   '\n\nNew inbound messages (authoritative even if provider history is delayed):\n'+(p.messages||[]).map(t=>'CUSTOMER: '+t).join('\n')+
   '\n\nWrite ONLY the WhatsApp reply text to send next ('+(line.language?'in '+line.language:'in the customer\'s own language')+', WhatsApp formatting with *bold*, short paragraphs). Do NOT send anything yourself. '+
   'If several messages are needed, separate them with a line containing only ---. If this must go to a human (handoff rules), reply exactly: HANDOFF: <reason, and what you already checked (sheet, past chats) and found>';
  log('kirimdev '+agent+': answering '+p.name);const runAt=now();let out=String(await runAgent(agent,q,{session:conversationSession(agent,line.phoneNumberId,p.conversationId||p.from,epoch),run:{line:line.phoneNumberId,conversation:p.conversationId||'',phone:p.from,mode}})||'').replace(FOOTER,'').trim();
  if(!out){log('kirimdev '+agent+': the agent wrote nothing');return}
  // a team member replied while the agent was thinking: theirs stands
  await state();if((st.cut[key]||'')!==epoch||pausedUntil(agent,p.conversationId,p.from)>now()||humanAt(agent,p.conversationId,p.from)>=runAt){log('kirimdev '+agent+': conversation reset or a team member answered meanwhile; the agent\'s reply was not sent');return}
  if(/^HANDOFF\b/.test(out)){const why=out.replace(/^HANDOFF:?\s*/,'').trim();const lastQ=hist.split('\n').filter(l=>l.startsWith('CUSTOMER: ')).pop()?.slice(10)||'-';
   const h={id:'h'+(++st.seq),agent,from:p.from,conversationId:p.conversationId,name:p.name,lastQ,why,notify:mode!=='draft',tries:0,at:now()};
   await postHandoff(h,line);return}
  // pictures the agent should send with a recommendation, when it forgets the tags
  if(line.autoPhotos?.pattern&&new RegExp(line.autoPhotos.pattern,'i').test(out)&&!/\[(FOTO|TEMPLATE):/.test(out))out+='\n'+(line.autoPhotos.tags||[]).join('\n');
  const g=guardReply(splitReply(out),{paid:paidSince?await paidSince(agent,p.from,runAt).catch(()=>null):null});
  // a leak: nothing goes to the customer; the reply waits in the Questions topic as a draft (ok / changed text / no)
  if(g.removed.length){log('kirimdev '+agent+': reply HELD, it had '+g.removed.length+' line(s) meant for the team: '+g.removed.join(' | ').slice(0,200));
   return makeDraft(agent,line,p,g.parts,'🛑 HELD: this reply was NOT sent because it had text meant for the team ('+g.removed.join(' | ').slice(0,300)+'). Fix it and reply with the clean text, or \"no\".')}
  if(g.hold){log('kirimdev '+agent+': reply held: '+g.hold);const lastQ=hist.split('\n').filter(l=>l.startsWith('CUSTOMER: ')).pop()?.slice(10)||'-';
   await postHandoff({id:'h'+(++st.seq),agent,from:p.from,conversationId:p.conversationId,name:p.name,lastQ,why:g.hold,notify:false,tries:0,at:now()},line);return}
  if(mode==='draft')return makeDraft(agent,line,p,g.parts);
  p.outbound=[];for(const part of g.parts)p.outbound.push(await prepare(agent,line,p.from,part));await saveState();
  for(const id of p.outbound){await deliver(id);await wait(2500)}}

 // a handoff is posted first; the customer hears it was passed on only once Telegram confirmed the post
 async function postHandoff(h,line){const t=await target(h.agent);
  const post='❓ HANDOFF ('+line.persona+', '+h.name+', +'+h.from+')\nCustomer asked: '+h.lastQ+'\n\nWhy: '+h.why+'\n\n'+(t?.mention?t.mention+' ':'')+'reply here with the answer and '+line.persona+' sends it to the customer.';
  const mid=t?await telegram(h.agent,t.chatId,t.threadId,post).catch(()=>false):false;h.tries++;
  if(mid){delete st.handoffs[h.id];log('kirimdev '+h.agent+': handoff posted'+(h.tries>1?' (try '+h.tries+')':''));if(h.tries>1)await solved(h.agent,'handoff|'+h.id).catch(()=>{});
   if(h.notify&&within24h(h.agent,h.from)&&pausedUntil(h.agent,h.conversationId,h.from)<=now())
    await send(h.agent,line,h.from,line.handoff?.customerText||'Thanks, I am passing this question to our team. They will get back to you shortly.').catch(e=>log('kirimdev '+h.agent+': sending failed: '+e.message));
   // waiting for the team's answer: System › Health shows it when nobody answered within ASK_MIN minutes
   st.asked[h.id]={agent:h.agent,from:h.from,name:h.name,lastQ:h.lastQ,at:now()};
   await saveState();return true}
  if(now()-h.at>24*3600e3){delete st.handoffs[h.id];await tell(line.persona+' gave up posting a handoff in Telegram','After a day of tries. The customer (+'+h.from+') was not told anything. Their question: '+h.lastQ).catch(()=>{});await saveState();return false}
  h.next=now()+RETRY_MIN[Math.min(h.tries-1,RETRY_MIN.length-1)]*60e3;st.handoffs[h.id]=h;
  if(h.tries===1){const title=line.persona+' could not post a handoff in Telegram',detail=(t?'':'No team group is set for '+line.persona+' (Channels › Kirimdev, Team group). ')+'The customer (+'+h.from+') was not told it was passed on. aqeelOS tries again in 1, 5, 15 and 30 minutes, then hourly.\n\n'+post.slice(0,500);
   // System › Health and one Telegram alert to the owner (agent-health.mjs) when that is there; the bell otherwise
   await (problem?problem(h.agent,'handoff|'+h.id,'Kirimdev line ('+line.persona+'): '+title.replace(line.persona+' ',''),detail):tell(title,detail)).catch(()=>{});log('kirimdev '+h.agent+': handoff not posted; the owner was told')}
  await saveState();return false}
 // handoffs waiting for another try (every 30 seconds on the live box)
 let ticking=false;
 async function tick(){if(ticking)return;ticking=true;try{await state();for(const h of Object.values(st.handoffs)){if((h.next||0)>now())continue;const line=await lineOf(h.agent);if(!line){delete st.handoffs[h.id];continue}await postHandoff(h,line)}
  await drainOutbox();await unanswered()}finally{ticking=false}}
 // a handoff the team has not answered after ASK_MIN minutes: one Health problem (and one alert); after a day it is let go
 async function unanswered(){let ch=false;for(const [id,a] of Object.entries(st.asked||{})){const age=now()-a.at;
   if(age>24*3600e3){delete st.asked[id];ch=true;if(a.told)await solved?.(a.agent,'unanswered|'+id).catch(()=>{});continue}
   if(a.told||age<ASK_MIN*60e3)continue;const line=await lineOf(a.agent);const who=line?.persona||a.agent;
   await (problem?problem(a.agent,'unanswered|'+id,'Kirimdev line ('+who+'): a handoff has no answer after '+ASK_MIN+' minutes','Customer '+a.name+' (+'+a.from+') asked: '+String(a.lastQ||'').slice(0,300)+'\n\nReply to the HANDOFF post in the team group, or answer the customer in Kirimdev; this goes away by itself then.'):tell('A handoff from '+who+' has no answer',String(a.lastQ||''))).catch(()=>{});
   a.told=now();ch=true}
  if(ch)await saveState()}

 // Draft: the reply waits in the Questions topic (and on the Channels page) for a person to approve it
 async function makeDraft(agent,line,p,parts,why=''){if(!parts.length)return;const id=++st.seq;
  const d={id,agent,from:p.from,conversationId:p.conversationId,name:p.name,parts,at:now(),status:'waiting',held:!!why};st.drafts[id]=d;
  // labels the agent asked for in Draft are not set: they ride with the draft and are set when a person sends it
  const pk=agent+'|'+p.conversationId,pl=st.proposed[pk];if(pl){delete st.proposed[pk];if(pl.add.length||pl.remove.length)d.labels=pl}
  const t=await target(agent);
  const post=(why?why+'\n\n':'')+'📝 DRAFT #'+id+' ('+line.persona+', '+p.name+', +'+p.from+')\n\n'+parts.join('\n---\n')+(d.labels?'\n\n🏷 Labels, set when it is sent: '+labelWords(d.labels):'')+'\n\n'+(t?.mention?t.mention+' ':'')+'reply "ok" to send it to the customer, reply with the changed text to send that instead, or "no" to drop it.';
  const mid=t?await telegram(agent,t.chatId,t.threadId,post).catch(()=>false):false;d.posted=!!mid;
  if(!mid)await tell(line.persona+' wrote a draft that could not be posted in Telegram',(t?'':'No team group is set (Channels page, Team group). ')+'It waits on the Channels page, where you can send or drop it.').catch(()=>{});
  log('kirimdev '+agent+': draft #'+id+' for '+p.name+(mid?' posted':' kept on the Channels page'));await saveState();return d}
 // send (as written or changed) or drop a draft: whatsapp_draft for the agent, the Channels page for a person
 async function draft(agent,id,action,text,by){await state();const d=st.drafts[Number(id)];
  if(!d||d.agent!==agent)throw Error('There is no draft #'+id+' for this agent.');
  if(d.status!=='waiting')throw Error('Draft #'+id+' was already '+(d.status==='sent'?'sent':'dropped')+'.');
  if(action==='discard'||action==='drop'){d.status='dropped';d.doneAt=now();d.by=String(by||'');await saveState();return {dropped:true}}
  if(action!=='send')throw Error('The action is send or discard.');
  const line=await lineOf(agent);if(!line)throw Error('This agent has no Kirimdev line.');
  if(!within24h(agent,d.from))throw Error('The customer last wrote more than 24 hours ago, so WhatsApp does not allow a reply.');
  if(d.held&&!(text&&String(text).trim()))throw Error('Draft #'+id+' was held because it had text meant for the team. Reply with the clean text to send instead.');
  const parts=text&&String(text).trim()?splitReply(text):d.parts;if(!parts.length)throw Error('Write the text to send.');
  d.by=String(by||'');d.edited=!!(text&&String(text).trim());
  if(!d.outbound){d.outbound=[];for(const p of parts){const op=await prepare(agent,line,d.from,p);if(op)st.outbox[op].approved=true;d.outbound.push(op)}await saveState()}
  const sent=[];for(const id of d.outbound){sent.push(await deliver(id));await wait(1500)}d.status='sent';d.doneAt=now();await saveState();
  let labels=null;if(d.labels&&!d.labelsSet){labels=await labelContact(agent,{conversationId:d.conversationId,phone:d.from,...d.labels,source:'approved',run:'draft'+d.id}).catch(e=>({set:false,why:e.message}));if(labels.set){d.labelsSet=true;await saveState()}}
  return {sent:sent.filter(Boolean).length,...(labels?{labels}:{})}}

 // one part: text, or a picture from the agent's media/staff (urls.txt for [FOTO], templates.json for [TEMPLATE])
 async function send(agent,line,to,part){const id=await prepare(agent,line,to,part);await saveState();return deliver(id)}
 async function prepare(agent,line,to,part){await state();const base={messaging_product:'whatsapp',recipient_type:'individual',to};let body;
  const tm=/^\[TEMPLATE:\s*([\w-]+)\s*\]$/.exec(part),fm=/^\[FOTO:\s*(?:media\/staff\/)?([^\]]+?)\s*\]$/.exec(part);
  if(tm){const tp=(await readJson(path.join(WORK,agent,'media','staff','templates.json'),{}))[tm[1]];if(!tp){log('kirimdev '+agent+': no picture for template '+tm[1]);return null}body={...base,type:'image',image:tp}}
  else if(fm){const urls=(await readFile(path.join(WORK,agent,'media','staff','urls.txt'),'utf8').catch(()=>'')).split(/\s+/);const u=urls.find(x=>x.split('/').pop()===fm[1].trim());
   if(!u){log('kirimdev '+agent+': no picture called '+fm[1]);return null}body={...base,type:'image',image:{link:u}}}
  else{const text=part.replace(FOOTER,'').trim().slice(0,4096);if(!text)return null;body={...base,type:'text',text:{body:text,preview_url:false}}}
  const id=randomUUID();st.outbox[id]={id,agent,pid:String(line.phoneNumberId),to,body,at:now(),status:'pending'};return id}
 // Persist intent before I/O; never replay beyond the provider's bounded idempotency cache.
 function cancelOutbound(agent,to){for(const o of Object.values(st.outbox))if(o.agent===agent&&o.to===to&&!o.receipt)o.status='cancelled'}
 const delivering=new Map();
 async function deliver(id){if(!id)return null;if(delivering.has(id))return delivering.get(id);
  const task=(async()=>{const o=st.outbox[id];if(!o)throw Error('Missing outbound operation');if(o.receipt?.id)return o.receipt;if(o.status==='cancelled'||o.status==='held')throw Error('Outbound '+o.status);
   const line=await lineOf(o.agent);
   if(!line||String(line.phoneNumberId)!==o.pid||!within24h(o.agent,o.to)||pausedUntil(o.agent,'',o.to)>now()||modeOf(line)==='draft'&&!o.approved||modeOf(line)==='test'&&!isTester(line,{from:o.to})&&!st.testerNums[o.agent+'|'+o.to])throw Error('Outbound held by current line policy');
   if(o.firstAttempt&&now()-o.firstAttempt>=23*3600e3){o.status='held';await saveState();await tell('Kirimdev line: a send needs checking by hand',o.agent+': ambiguous send older than safe replay window; not resent').catch(()=>{});throw Error('Outbound ambiguous beyond safe idempotency window; reconcile manually')}
   o.firstAttempt||=now();o.status='sending';o.tries=(o.tries||0)+1;await saveState();
   const go=api(o.pid+'/messages',o.body,{idem:id}),fk=o.pid+'|'+o.to;inflight.set(fk,go);
   try{const r=await go;if(!r?.data?.id)throw Error('Kirimdev returned no message receipt');o.receipt=r.data;o.status='accepted';st.ours[r.data.id]=now();await saveState();await answered(o.agent,o.to);return o.receipt}
   catch(e){o.error=e.message;o.status='retry';await saveState();await tell('Kirimdev line: a send needs a retry',o.agent+': '+e.message).catch(()=>{});throw e}
   finally{if(inflight.get(fk)===go)inflight.delete(fk)}
  })();delivering.set(id,task);try{return await task}finally{delivering.delete(id)}}
 async function drainOutbox(){const blocked=new Set();for(const o of Object.values(st.outbox)){if(o.receipt?.id){if(!['delivered','read','failed'].includes(o.receipt.status)&&now()-o.at<48*3600e3){try{const r=await api(o.pid+'/messages/'+encodeURIComponent(o.receipt.id));if(r?.data?.id===o.receipt.id){o.receipt=r.data;o.checkedAt=now();await saveState();if(r.data.status==='failed'&&!o.failureTold){o.failureTold=true;await saveState();await tell('WhatsApp delivery failed',o.agent+': '+(r.data.error?.code||'provider failed')).catch(()=>{})}}}catch(e){log('kirimdev receipt reconciliation: '+e.message)}}continue}if(blocked.has(o.agent+'|'+o.to))continue;try{await deliver(o.id)}catch{blocked.add(o.agent+'|'+o.to)}}}
 // a handoff counts as answered once anything else reaches that customer on this line
 async function answered(agent,to){await state();for(const [id,a] of Object.entries(st.asked||{}))if(a.agent===agent&&a.from===String(to)&&now()-a.at>5000){delete st.asked[id];if(a.told)await solved?.(agent,'unanswered|'+id).catch(()=>{})}}

 // the agent's whatsapp_reply tool: only to someone who wrote to its own line in the last 24 hours (a tester in Test)
 async function reply(agent,to,text){const line=await lineOf(agent);if(!line)throw Error('This agent has no Kirimdev line.');
  const num=String(to||'').replace(/\D/g,'');await state();
  if(num&&!within24h(agent,num)){const other=Object.keys(st.recent).find(k=>k.endsWith('|'+num)&&k.split('|')[0]!==agent&&now()-st.recent[k]<=24*3600e3);
   if(other)throw Error('That number wrote to another Kirimdev line ('+other.split('|')[0]+'), not to yours. Never answer another brand\'s customers; that agent answers them.')}
  if(!num||!within24h(agent,num))throw Error('That number has not written to this Kirimdev line in the last 24 hours, so WhatsApp does not allow a reply. Ask the team to contact them another way.');
  if(modeOf(line)==='test'&&!isTester(line,{from:num,conversationId:''})&&!st.testerNums[agent+'|'+num])throw Error('This line is in Test, so it only answers its testers.');
  const parts=splitReply(text);if(!parts.length)throw Error('Write the text to send.');const sent=[];
  const ops=[];for(const p of parts){const id=await prepare(agent,line,num,p);if(id)st.outbox[id].approved=true;ops.push(id)}await saveState();
  for(const id of ops){sent.push(await deliver(id));await wait(1500)}return sent.filter(Boolean)}

 // connect: one Kirimdev webhook for this line (Kirimdev makes the secret and shows it once)
 async function connect(agent){const line=await lineOf(agent);if(!line)throw Error('No line for '+agent+'.');
  const url=pub()+'/kirimdev/'+agent;const sec=await readJson(SEC,{});
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
    handoffsWaiting:Object.values(st.handoffs).filter(h=>h.agent===agent).length,phoneNumberId:String(l.phoneNumberId||''),health:health().lines[agent]||null,
    delivery:pollsNow(agent,l,sec)?'poll':'webhook',polledAt:st.poll?.[agent]?.at||null,pollError:st.poll?.[agent]?.error||null,
    settings:{persona:l.persona||'',business:l.business||'',language:l.language||'',pauseMin:Number(l.pauseMin??DEFAULT_PAUSE),resetWords:l.resetWords||['reset'],resetText:l.resetText||'',
     testers:(l.testers||[]).map(t=>({who:t.who||'',phone:String(t.phone||''),chat:!!t.conversationId})),payment:l.payment||null,labels:l.labels?.allowed||[]}}}))}
 async function setMode(agent,mode){if(!MODES.includes(mode))throw Error('Mode is test, draft or live.');const c=await readJson(CONF,{lines:{}});if(!c.lines?.[agent])throw Error('No line for '+agent+'.');c.lines[agent].mode=mode;await put(CONF,c,0o644);return true}
 async function setPause(agent,min){const n=Number(min);if(!Number.isInteger(n)||n<0||n>1440)throw Error('The quiet time is a whole number of minutes, 0 to 1440.');const c=await readJson(CONF,{lines:{}});if(!c.lines?.[agent])throw Error('No line for '+agent+'.');c.lines[agent].pauseMin=n;await put(CONF,c,0o644);return n}

 // ---- Plug and play (7 Nov 2026, the owner: "If it's a clean OS, the user inserts the key, then how does the number
 // show up?"). The numbers come from Kirimdev (GET accounts); Connect makes a line from one with a dialog (agent,
 // testers, team group, language, quiet time, reset, payment), creates the webhook when aqeelOS can be reached from the
 // internet and otherwise reads new messages every 20 seconds (polling). Everything is editable later, so kirimdev.json
 // never needs a hand edit.
 let accCache=null;
 async function numbers({fresh=false}={}){const key=await apiKey().catch(()=>null);if(!key)return {ok:false,why:'nokey',text:'No Kirimdev API key is saved.',list:[]};
  if(!fresh&&accCache&&now()-accCache.at<60e3)return accCache.v;
  const r=await probe('accounts',key),L=await lines();let v;
  if(!r.ok)v={ok:false,why:r.why,text:r.text,list:Object.entries(L).map(([a,l])=>({phoneNumberId:String(l.phoneNumberId||''),phone:'',name:l.business||'',status:'unknown',agent:a}))};
  else{const by=Object.fromEntries(Object.entries(L).map(([a,l])=>[String(l.phoneNumberId),a]));
   const list=(Array.isArray(r.json.data)?r.json.data:[]).filter(x=>/^\d{6,20}$/.test(String(x?.phone_number_id||''))).map(x=>({phoneNumberId:String(x.phone_number_id),phone:String(x.phone_number||''),name:String(x.name||''),status:String(x.status||''),agent:by[String(x.phone_number_id)]||null}));
   const known=new Set(list.map(x=>x.phoneNumberId));
   for(const [a,l] of Object.entries(L))if(!known.has(String(l.phoneNumberId)))list.push({phoneNumberId:String(l.phoneNumberId||''),phone:'',name:l.business||'',status:'gone',agent:a,gone:true});
   v={ok:true,list}}
  accCache={at:now(),v};return v}

 // the settings a person gives in the Connect dialog (or edits later), checked; fields the dialog does not show are kept
 function cleanLine(cur,b,pid){const l={mode:'test',debounceSec:8,...(cur||{})};l.phoneNumberId=pid;const str=(v,n)=>String(v??'').trim().slice(0,n);
  if('persona' in b||!cur){l.persona=str(b.persona,40);if(!l.persona)throw Error('Give the agent’s name as customers see it.')}
  if('business' in b||!cur)l.business=str(b.business,80)||l.business||'';
  if('language' in b){const v=str(b.language,30);if(v&&!/^[\p{L} ()-]+$/u.test(v))throw Error('The language is a word, like Indonesian or English.');if(v)l.language=v;else delete l.language}
  if('pauseMin' in b||!cur){const n=b.pauseMin===''||b.pauseMin==null?DEFAULT_PAUSE:Number(b.pauseMin);if(!Number.isInteger(n)||n<0||n>1440)throw Error('The quiet time is a whole number of minutes, 0 to 1440.');l.pauseMin=n}
  if('testers' in b){const T=Array.isArray(b.testers)?b.testers:[];if(T.length>10)throw Error('Ten testers at most.');const old=cur?.testers||[];
   l.testers=T.map(t=>{const who=str(t?.who,40),phone=String(t?.phone??'').replace(/\D/g,'');if(!who&&!phone)return null;
    if(!who)throw Error('Give each tester a name.');if(!/^\d{6,16}$/.test(phone))throw Error('The number for '+who+' is not a phone number (country code first, like 6281234567890).');
    const was=old.find(o=>String(o.phone||'').replace(/\D/g,'')===phone)||old.find(o=>o.who===who&&!o.phone);return {who,phone,...(was?.conversationId?{conversationId:was.conversationId}:{})}}).filter(Boolean)}
  if('resetWords' in b){const W=(Array.isArray(b.resetWords)?b.resetWords:String(b.resetWords||'').split(',')).map(w=>str(w,30)).filter(Boolean).slice(0,5);l.resetWords=W.length?W:['reset']}
  if('resetText' in b){const v=str(b.resetText,300);if(v)l.resetText=v;else delete l.resetText}
  if('payment' in b){const p=b.payment;if(!p||p.helper==null&&!p.currency&&!p.min&&!p.max)delete l.payment;else{const o={};
    if(p.helper?.path){const hp=str(p.helper.path,120);if(!/^[\w.\/-]+$/.test(hp)||hp.split('/').includes('..')||hp.startsWith('/'))throw Error('The payment helper is a file in the agent’s folder, like .tools/qris.');o.helper={path:hp,style:p.helper.style==='send'?'send':'picture'}}
    if(p.currency)o.currency=str(p.currency,6);for(const k of ['min','max'])if(p[k]!==''&&p[k]!=null){const n=Number(p[k]);if(!Number.isInteger(n)||n<0)throw Error('Payment amounts are whole numbers.');o[k]=n}
    if(o.min!=null&&o.max!=null&&o.min>o.max)throw Error('The lowest payment is above the highest.');l.payment=o}}
  if('labels' in b){const A=[...new Set((Array.isArray(b.labels)?b.labels:[]).map(x=>str(x,50)).filter(Boolean))];if(A.length>120)throw Error('120 labels at most.');
   const bad=A.filter(x=>LABEL_NEVER.test(x));if(bad.length)throw Error(bad.join(', ')+': only a person or a confirmed payment sets '+(bad.length>1?'these':'this')+', never the agent.');
   if(A.length)l.labels={...(l.labels||{}),allowed:A};else delete l.labels}
  return l}
 // ---- contact labels (8 Nov 2026). Kirimdev's labels are the account's (GET labels, cached 10 minutes); a contact's are
 // read before each change, so adding one it has or removing one it lacks does nothing (safe to repeat).
 let labelCache=null;
 async function labelList({fresh=false}={}){if(!fresh&&labelCache&&now()-labelCache.at<10*60e3)return labelCache.v;const v=[];let cur='';
  for(let i=0;i<20;i++){const j=await api('labels?'+new URLSearchParams({limit:'100',...(cur?{cursor:cur}:{})}));for(const x of j.data||[])if(x?.id&&x?.name)v.push({id:String(x.id),name:String(x.name)});
   cur=j.has_more&&j.next_cursor?String(j.next_cursor):'';if(!cur)break}
  labelCache={at:now(),v};return v}
 const labelWords=o=>[...(o.add||[]).map(x=>'+'+x),...(o.remove||[]).map(x=>'−'+x)].join(', ');
 const contactIds=new Map();
 async function contactOf(line,conversationId){const k=line.phoneNumberId+'|'+conversationId;if(contactIds.has(k))return contactIds.get(k);
  const j=await api(line.phoneNumberId+'/conversations/'+encodeURIComponent(conversationId));const id=String(j?.data?.contact?.id||'');if(!/^ctc_\w+$/.test(id))throw Error('Kirimdev gave no contact for this chat.');contactIds.set(k,id);return id}
 // add/remove labels on the contact of ONE chat (the caller's run decides which; a model never gives a contact id).
 // source: 'agent' (the label_contact tool: allowed labels only, never LABEL_NEVER; Draft proposes, nothing is set),
 // 'approved' (a person sent the draft that proposed them: same rules, set now), 'payment' (a confirmed payment: Customer
 // and S- labels added, Checkout removed, nothing else). Test sets labels on testers only. Every change is logged.
 async function labelContact(agent,{conversationId,phone='',add=[],remove=[],source='agent',run=''}={}){await state();const line=await lineOf(agent);if(!line)throw Error('This agent has no Kirimdev line.');
  if(!conversationId)throw Error('This chat has no Kirimdev conversation.');const norm=a=>[...new Set([].concat(a||[]).map(x=>String(x??'').trim()).filter(Boolean))];
  add=norm(add);remove=norm(remove).filter(x=>!add.includes(x));if(!add.length&&!remove.length)throw Error('Give the labels to add or remove.');
  if(add.length+remove.length>LABEL_MAX)throw Error(LABEL_MAX+' label changes at most at once.');
  const all=await labelList(),id=new Map(all.map(x=>[x.name,x.id])),allowed=new Set(line.labels?.allowed||[]);
  for(const n of [...add,...remove]){if(!id.has(n))throw Error('Kirimdev has no label called "'+n+'". Use an exact name.');
   if(source==='payment'){if(!(add.includes(n)&&(n==='Customer'||/^S-/.test(n))||remove.includes(n)&&n==='Checkout'))throw Error('A payment sets Customer and S- labels and removes Checkout only, not '+n+'.')}
   else{if(LABEL_NEVER.test(n))throw Error('"'+n+'" is never yours to set: '+(/^s-|^customer$/i.test(n)?'aqeelOS sets Customer and S- labels itself once a payment is confirmed.':'only a person sets it.'));
    if(!allowed.has(n))throw Error('"'+n+'" is not one of the labels you may set'+(allowed.size?': '+[...allowed].join(', '):' (this line allows none yet)')+'.')}}
  const mode=modeOf(line),tester=isTester(line,{from:phone,conversationId})||!!(phone&&st.testerNums[agent+'|'+phone]),who=phone?tail(phone):conversationId;
  if(mode==='test'&&!tester){log('kirimdev '+agent+': labels '+labelWords({add,remove})+' for '+who+' not set (Test: testers only)');return {set:false,why:'The line is in Test: labels are set on the testers only.'}}
  if(mode==='draft'&&source==='agent'){const k=agent+'|'+conversationId,pr=st.proposed[k]||{add:[],remove:[]};
   pr.add=[...new Set([...pr.add.filter(x=>!remove.includes(x)),...add])];pr.remove=[...new Set([...pr.remove.filter(x=>!add.includes(x)),...remove])];st.proposed[k]=pr;await saveState();
   log('kirimdev '+agent+': labels '+labelWords({add,remove})+' for '+who+' proposed with the draft'+(run?' (run '+run+')':''));return {set:false,proposed:true,why:'The line is in Draft: the labels go with your draft and are set when a person sends it.'}}
  const cid=await contactOf(line,conversationId),c=await api(line.phoneNumberId+'/contacts/'+encodeURIComponent(cid));
  const have=new Set((c?.data?.labels||[]).map(x=>String(typeof x==='string'?x:x?.id||'')));const done=[];
  for(const n of add){const lid=id.get(n);if(have.has(lid))continue;await api(line.phoneNumberId+'/contacts/'+encodeURIComponent(cid)+'/labels',{label_id:lid},{idem:'aqeelos-label-'+cid+'-'+lid+'-'+(run||now())});done.push('+'+n)}
  for(const n of remove){const lid=id.get(n);if(!have.has(lid))continue;await api(line.phoneNumberId+'/contacts/'+encodeURIComponent(cid)+'/labels/'+encodeURIComponent(lid),null,{method:'DELETE'});done.push('−'+n)}
  log('kirimdev '+agent+': labels on '+who+': '+(done.join(', ')||'already so')+' ('+source+(run?', run '+run:'')+')');
  if(done.length)await activity(agent,(line.persona||agent)+' labelled '+(phone?'+'+phone:'a contact')+': '+done.join(', '),(source==='payment'?'A confirmed payment':source==='approved'?'A sent draft':'The agent in a customer chat')+(run?' (run '+run+')':'')+'. Kirimdev contact '+cid+'.').catch(()=>{});
  return {set:true,changed:done}}
 // the line for an agent: a new one (Connect: Test mode, delivery set up, first check) or changes to its settings
 async function saveLine(agent,b={}){if(!AGENT.test(String(agent||'')))throw Error('Pick the agent that answers this number.');
  const c=await readJson(CONF,{lines:{}});c.lines||={};const cur=c.lines[agent]||null,isNew=!cur;
  const pid=String(b.phoneNumberId||cur?.phoneNumberId||'');if(!/^\d{6,20}$/.test(pid))throw Error('Pick a number from Kirimdev.');
  if(cur&&String(cur.phoneNumberId)!==pid)throw Error((cur.persona||agent)+' already answers another number. Disconnect that one first, or pick another agent.');
  const other=Object.entries(c.lines).find(([a,l])=>a!==agent&&String(l.phoneNumberId)===pid);if(other)throw Error('This number is already answered by '+(other[1].persona||other[0])+'.');
  if(isNew){const n=await numbers({fresh:true});if(!n.ok)throw Error('Could not read the numbers from Kirimdev: '+n.text);if(!n.list.some(x=>x.phoneNumberId===pid&&!x.gone))throw Error('Kirimdev does not have this number.')}
  const before=c.disconnected?.[agent];const base=cur||(before&&String(before.phoneNumberId)===pid?(({at,...x})=>({...x,mode:'test'}))(before):null);
  const line=cleanLine(base,b,pid);if(isNew){line.mode='test';delete line.delivery}c.lines[agent]=line;if(c.disconnected)delete c.disconnected[agent];
  await put(CONF,c,0o644);accCache=null;let delivery=null;
  if(isNew){delivery=await startDelivery(agent);check().catch(e=>log('kirimdev check: '+e.message))}
  return {agent,isNew,delivery}}
 const setDelivery=async(agent,how)=>{const c=await readJson(CONF,{lines:{}});if(!c.lines?.[agent])return;if(how)c.lines[agent].delivery=how;else delete c.lines[agent].delivery;await put(CONF,c,0o644)};
 // a webhook when Kirimdev can reach aqeelOS; otherwise polling, said plainly
 async function startDelivery(agent){const pu=publicReach(pub());
  if(!pu.ok){await setDelivery(agent,'poll');return {how:'poll',why:pu.why}}
  try{await connect(agent);await setDelivery(agent,null);return {how:'webhook'}}
  catch(e){await setDelivery(agent,'poll');return {how:'poll',why:'Kirimdev could not set up the webhook ('+e.message+'), so aqeelOS reads new messages every 20 seconds instead.'}}}
 // Connect webhook (the page's button or menu): the line uses it from now on instead of polling
 async function connectWebhook(agent){const r=await connect(agent);await setDelivery(agent,null);return r}
 // Disconnect: the webhook is deleted in Kirimdev and the line stops; its chats, drafts and history stay, and its
 // settings are kept so connecting the number again starts from them
 async function disconnect(agent){const c=await readJson(CONF,{lines:{}});const line=c.lines?.[agent];if(!line)throw Error('No line for '+agent+'.');
  const sec=await readJson(SEC,{}),w=sec[agent];let webhook='none';
  if(w?.id){try{await api('webhook_subscriptions/'+encodeURIComponent(w.id),null,{method:'DELETE'});webhook='deleted'}
   catch(e){if(e.status===404)webhook='gone';else throw Error('Kirimdev did not delete the webhook ('+e.message+'). Nothing changed; try again.')}}
  delete sec[agent];await put(SEC,sec);c.disconnected={...(c.disconnected||{}),[agent]:{...line,at:now()}};delete c.lines[agent];await put(CONF,c,0o644);accCache=null;
  await state();if(st.poll)delete st.poll[agent];const h=st.health?.lines?.[agent];for(const k of Object.keys(h?.told||{}))await solved(agent,k).catch(()=>{});if(st.health?.lines)delete st.health.lines[agent];
  await saveState();log('kirimdev '+agent+': disconnected (webhook '+webhook+'), history kept');return {webhook}}
 // Renew webhook secret: Kirimdev makes a new one, aqeelOS keeps it, then the old ones are revoked in Kirimdev
 async function renewSecret(agent){const w=(await readJson(SEC,{}))[agent];if(!w?.id)throw Error('This line has no webhook, so there is no secret to renew.');
  const r=await api('webhook_subscriptions/'+encodeURIComponent(w.id)+'/secrets',{},{idem:'aqeelos-renew-'+agent+'-'+randomUUID()});const s=r?.data?.secret;if(!s)throw Error('Kirimdev did not return a new secret.');
  const s1=await readJson(SEC,{});s1[agent]={...s1[agent],secrets:[s,...(s1[agent]?.secrets||[])].slice(0,6),renewedAt:now()};await put(SEC,s1);let revoked=0;
  try{const sub=(await api('webhook_subscriptions/'+encodeURIComponent(w.id))).data||{};for(const x of sub.secrets||[])if(x.id&&x.id!==r.data.id){await api('webhook_subscriptions/'+encodeURIComponent(w.id)+'/secrets/'+encodeURIComponent(x.id),null,{method:'DELETE'});revoked++}}
  catch(e){log('kirimdev '+agent+': new secret saved, an old one was not revoked: '+e.message);return {renewed:true,revoked,note:'The new secret works. An old one could not be revoked yet ('+e.message+'); both are accepted until then.'}}
  const s2=await readJson(SEC,{});s2[agent]={...s2[agent],secrets:[s]};await put(SEC,s2);return {renewed:true,revoked}}
 // Send test message: one plain text to a tester, straight through Kirimdev (not a customer reply)
 async function testSend(agent,idx){const line=await lineOf(agent);if(!line)throw Error('This agent has no Kirimdev line.');const t=(line.testers||[])[Number(idx)];
  const to=String(t?.phone||'').replace(/\D/g,'');if(!/^\d{6,16}$/.test(to))throw Error('Pick a tester with a phone number.');await state();let r;
  try{r=await api(encodeURIComponent(line.phoneNumberId)+'/messages',{messaging_product:'whatsapp',recipient_type:'individual',to,type:'text',text:{body:'Test from aqeelOS: '+(line.persona||agent)+'’s Kirimdev line can send. No need to answer.',preview_url:false}})}
  catch(e){throw Error(e.status>=400&&e.status<500&&e.status!==401&&e.status!==403?'Kirimdev did not send it ('+e.message+'). WhatsApp allows a free message only within 24 hours of the tester’s last message: send “hi” from '+t.who+'’s phone to this number first, then try again.':e.message)}
  if(r?.data?.id){st.ours[r.data.id]=now();await saveState()}return {to:t.who,id:r?.data?.id||null,status:r?.data?.status||'queued'}}

 // Polling: a line without a webhook (or with one Kirimdev switched off or cannot deliver) has its new messages read every
 // 20 seconds: the conversations that changed since the last look, then their messages after it. Customer messages go
 // the same way as the webhook's; a message a person sent from Kirimdev pauses the agent there, as message.sent does.
 const pollsNow=(agent,line,sec)=>line?.delivery==='poll'||!sec[agent]?.id||['off','failing'].includes(st?.health?.lines?.[agent]?.webhook?.state);
 async function pollLine(agent,line){await state();const pid=String(line.phoneNumberId),P=st.poll||={},cur=P[agent];
  // the first look only marks where reading starts: older chats are history, not new messages
  if(!cur||cur.pid!==pid){P[agent]={pid,since:new Date(now()).toISOString(),at:now()};await saveState();return {started:true,messages:0}}
  let n=0,max=cur.since;
  try{const conv=await api(encodeURIComponent(pid)+'/conversations?limit=25');
   const fresh=(Array.isArray(conv?.data)?conv.data:[]).filter(c=>c?.id&&String(c.last_message_at||'')>cur.since).reverse();
   for(const c of fresh){const r=await api(encodeURIComponent(pid)+'/messages?'+new URLSearchParams({conversation_id:String(c.id),created_after:cur.since,limit:'50'}));
    const phone=String(c.contact?.phone_number||'').replace(/\D/g,'');
    const ms=(Array.isArray(r?.data)?r.data:[]).filter(m=>m&&m.type!=='reaction'&&String(m.created_at||'')>cur.since).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
    for(const m of ms){if(String(m.created_at)>max)max=String(m.created_at);
     if(m.direction==='inbound'){if(!/^\d{6,16}$/.test(phone))continue;n++;
      await ingest(agent,line,[{pid,from:phone,name:String(c.contact?.name||''),id:'',ts:Math.floor(Date.parse(m.created_at)/1000)||0,type:String(m.type||''),text:String(m.content||''),conversationId:String(c.id)}])}
     else if(m.direction==='outbound'){const k='out|'+agent+'|'+m.id;if(!m.id||st.ours[m.id]||st.seen.includes(k))continue;st.seen.push(k);
      const to=String(m.to||phone).replace(/\D/g,'');await teamSent(agent,line,{pid,id:String(m.id),source:inflight.has(pid+'|'+to)?'':'poll',to,text:String(m.content??m.text?.body??'').trim(),conversationId:String(c.id),name:String(c.contact?.name||'')})}}}
   cur.since=max;cur.at=now();delete cur.error}
  catch(e){cur.error=e.message;cur.at=now();await saveState();throw e}
  await saveState();return {messages:n}}
 let polling=false;
 async function poll(){if(polling)return {};polling=true;try{await state();const L=await lines(),sec=await readJson(SEC,{}),out={};
   for(const [a,l] of Object.entries(L)){if(!pollsNow(a,l,sec)){if(st.poll?.[a]){delete st.poll[a];await saveState()}continue}
    try{out[a]=await pollLine(a,l)}catch(e){out[a]={error:e.message};log('kirimdev '+a+': polling: '+e.message)}}
   return out}finally{polling=false}}
 // after a restart: conversations that were waiting are answered, handoffs are tried again, webhooks hear team replies
 let iv=null,civ=null,piv=null;
 // once: a quiet time of 0 meant the agent kept answering right after a team member (Gino's line until 7 Nov); new lines get 15
 async function fixQuiet(){await state();if(st.fixedQuiet)return;const c=await readJson(CONF,{lines:{}});let n=0;
  for(const l of Object.values(c.lines||{}))if(Number(l.pauseMin)===0){l.pauseMin=DEFAULT_PAUSE;n++}
  if(n)await put(CONF,c,0o644);st.fixedQuiet=now();await saveState();if(n)log('kirimdev: quiet time 0 set to '+DEFAULT_PAUSE+' min on '+n+' line(s)')}
 async function resume(){await state();for(const [k,p] of Object.entries(st.pending)){const l=await lineOf(p.agent);if(l)schedule(k,l)}
  if(!iv){iv=setInterval(()=>tick().catch(e=>log('kirimdev retry: '+e.message)),30000);iv.unref?.()}
  // the Kirimdev API check: a minute after start, then every 10 minutes
  if(!piv){piv=setInterval(()=>poll().catch(e=>log('kirimdev poll: '+e.message)),pollEvery);piv.unref?.()}
  await fixQuiet().catch(e=>log('kirimdev quiet time: '+e.message));
  if(!civ){civ=setInterval(()=>check().catch(e=>log('kirimdev check: '+e.message)),checkEvery);civ.unref?.();setTimer(()=>check().catch(e=>log('kirimdev check: '+e.message)),60e3)?.unref?.()}
  for(const a of Object.keys(await lines()))await ensureEvents(a).catch(e=>log('kirimdev '+a+': could not add message.sent to the webhook: '+e.message))}
 return {receive,reply,draft,labelContact,labelList,connect,webhook,ensureEvents,status,check,health,setKey,numbers,saveLine,connectWebhook,disconnect,renewSecret,testSend,poll,fixQuiet,account:async()=>{await state();return health().account},setMode,setPause,resume,lines,_api:api,_tick:tick,_state:state}}
