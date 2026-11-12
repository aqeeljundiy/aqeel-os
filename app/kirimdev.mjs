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
import {readFile,writeFile,rename,mkdir,unlink,stat,appendFile,readdir} from 'node:fs/promises';
import {publicUrl} from './install.mjs';   // Your address (System › Settings), read at the moment a webhook is made
import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import path from 'node:path';
import {homedir} from 'node:os';

const IMAGE_MAX=8*1024*1024;
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
// loose picture tags the model sometimes writes ('[kirim foto X]', '[foto X]', '[send photo X]') become real ones: a file name
// becomes [FOTO: X], a bare name [TEMPLATE: X]; an unknown one is dropped when sending, never sent as text
// (11 Nov 2026, taken into git from fixer issue ie54d1284)
const LOOSE=/\[\s*(?:(?:kirim(?:kan)?|send|kasih|attach)\s+)?(?:foto|gambar|photo|image|picture|img)\s*[:\-]?\s+([\w./-]+)\s*\]/gi;
export const normalizeTags=t=>String(t||'').replace(LOOSE,(_,x)=>/^[\w-]+$/.test(x)?'[TEMPLATE: '+x+']':'[FOTO: '+x+']');
// a text longer than one WhatsApp message (4,096) is cut at a paragraph or line end into several, never dropped (audit L1)
const TEXT_MAX=3900;
export function chunkText(t,max=TEXT_MAX){const out=[];let r=String(t||'');
 while(r.length>max){let i=r.lastIndexOf('\n\n',max);if(i<max/2)i=r.lastIndexOf('\n',max);if(i<max/2)i=r.lastIndexOf(' ',max);if(i<max/2)i=max;out.push(r.slice(0,i).trim());r=r.slice(i).trim()}
 if(r)out.push(r);return out}
// at most PARTS_MAX messages for one reply: text beyond that is joined into the last message instead of being dropped
export const PARTS_MAX=8;
export function splitReply(out){const t=normalizeTags(String(out||'').replace(FOOTER,'').trim());const parts=[];
 for(const x of t.split(/\n-{3,}\n/))for(const y of x.split(/(\[(?:FOTO|TEMPLATE|VIDEO):[^\]]+\])/))if(y.trim())parts.push(...(/^\[(?:FOTO|TEMPLATE|VIDEO):/.test(y.trim())?[y.trim()]:chunkText(y.trim())));
 if(parts.length<=PARTS_MAX)return parts;
 const head=parts.slice(0,PARTS_MAX-1),rest=parts.slice(PARTS_MAX-1),text=rest.filter(p=>!/^\[(?:FOTO|TEMPLATE|VIDEO):/.test(p)).join('\n\n');
 return [...head,text?text.slice(0,4096):rest[0]]}
// a bare picture followed by text goes out as ONE message, the picture with that text as its caption (11 Nov 2026, if734729a):
// Randy's QRIS went as text, picture, text in the same second and the picture never showed on the customer's phone, while
// Gilang's helper sends the same Tripay QR as one picture with a caption and it arrives. Run after the reply guard, so the
// guard still checks the text on its own.
export function withCaptions(parts){const out=[];for(let i=0;i<parts.length;i++){const p=parts[i],n=parts[i+1],m=/^\[FOTO:\s*([^\]|]+?)\s*\]$/.exec(p);
  if(m&&typeof n==='string'&&n.trim()&&!/^\[(?:FOTO|TEMPLATE|VIDEO):/.test(n)&&n.length<=1024){out.push('[FOTO: '+m[1]+' | '+n.trim()+']');i++}else out.push(p)}
 return out}

// the exit guard (kirim-guard.mjs): what may never reach a customer. guardReply checks what the agent wrote for a turn, leaks() every text in deliver()
import {guardReply,leaks,leakWords,internalLine,internalText,langOf} from './kirim-guard.mjs';
export {guardReply,leaks,internalLine,internalText};

// What a team member's Telegram message says about a draft (audit H5). Only these count: "ok" (also oke, okay, ya, yes, kirim, send, setuju,
// approve, 👍, ✅), "no" (tidak, jangan, drop, batal, discard, ❌, 👎), or a text to send instead, which must be marked: "kirim: <text>"
// (send:, edit:, ganti:). "ok nanti saya cek" is none of them and sends nothing. The draft's number comes from "#12" in the message or from
// the post it answers (the engine quotes it as [Replying to …: "…DRAFT #12…"]). cut: the hook's 500 characters were used up, so the end is unknown.
export function parseApproval(raw){const full=String(raw||''),cut=full.length>=500;let t=full,id=null;
 const q=/^\[Replying to[^\n]*?:\s*"([\s\S]*?)"\]\s*\n\n?/.exec(t);if(q){const m=/DRAFT\s*#(\d+)/.exec(q[1]);if(m)id=Number(m[1]);t=t.slice(q[0].length)}
 else if(/^\[Replying to/.test(t))return cut?{action:'send',id:(/DRAFT\s*#(\d+)/.exec(t)||[])[1]?Number(/DRAFT\s*#(\d+)/.exec(t)[1]):null,cut:true}:null;
 t=t.replace(/^@\w+\s+/,'').trim();
 const num=/(?:^|\s)#(\d{1,9})\b/.exec(t);if(num){id=Number(num[1]);t=(t.slice(0,num.index)+' '+t.slice(num.index+num[0].length)).trim()}
 const tx=/^(?:kirim|send|edit|ganti|ubah)\s*:\s*([\s\S]+)$/i.exec(t);if(tx){const text=tx[1].trim();return text.length>=2?{action:'text',text,id,...(cut?{cut:true}:{})}:null}
 const w=t.replace(/[.!,\s]+$/,'').toLowerCase();
 if(/^(ok|oke|okay|okey|ya|iya|yes|y|kirim|send|setuju|approve|approved|acc|👍|✅)$/.test(w))return {action:'send',id};
 if(/^(no|tidak|nggak|jangan|drop|batal|discard|skip|hapus|❌|👎)$/.test(w))return {action:'discard',id};
 return null}

import {conversationSession} from './kirimdev-agent.mjs';
import {providerUnavailable,retryAt} from './provider-limits.mjs';

const RESET=/^(reset|\/reset|mulai baru)$/i;
// a tester's reset: the usual words, or the line's own (Connect dialog)
const isReset=(line,t)=>RESET.test(t)||(line.resetWords||[]).some(w=>w&&String(t).toLowerCase()===String(w).trim().toLowerCase());
const tail=n=>'…'+String(n||'').slice(-4);

// Delivery checks (11 Nov 2026, if734729a): the main agent's own WhatsApp (the engine's bridge) gets a picture from the line,
// marked "aqeelos-probe:<id>", and the bridge records whether it downloaded (probe_watch.js, engine/patches). So "did the
// customer's phone get the picture?" has an answer without a person looking at a phone.
// a tiny valid PDF for the document delivery check
export const SAMPLE_PDF=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 14 Tf 20 50 Td (aqeelOS delivery check) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n');
export const PROBE=/aqeelos-probe:([a-z0-9]{6,32})/;
const HH=()=>(process.env.HERMES_HOME||path.join(homedir(),'.hermes')).replace(/^~(?=\/|$)/,homedir());
export const BRIDGE={url:process.env.WHATSAPP_BRIDGE_URL||'http://127.0.0.1:3000',
 async self(){try{const c=JSON.parse(await readFile(path.join(HH(),'platforms','whatsapp','session','creds.json'),'utf8'));return String(c.me?.id||'').replace(/[:@].*/,'')}catch{return ''}},
 async send(num,text){const r=await fetch(BRIDGE.url+'/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chatId:num+'@s.whatsapp.net',message:text})});if(!r.ok)throw Error('the main WhatsApp could not send ('+r.status+')')},
  // the running bridge loaded probe_watch.js: the file is there and the bridge started after it was written
 async ready(){try{const f=await stat(path.join(HH(),'hermes-agent','scripts','whatsapp-bridge','probe_watch.js'));const h=await (await fetch(BRIDGE.url+'/health',{signal:AbortSignal.timeout(5000)})).json();return Date.now()-Number(h.uptime||0)*1000>f.mtimeMs}catch{return false}},
 async result(id){try{return JSON.parse(await readFile(path.join(HH(),'platforms','whatsapp','probes',id+'.json'),'utf8'))}catch{return null}}};
export function createKirimdev({onEvent=()=>{},DATA,WORK,apiKey,saveKey=null,bridge=BRIDGE,checkEvery=10*60e3,pollEvery=20e3,runAgent,describeImage=null,paidSince=null,qrSince=null,telegram,teamGroup=async()=>null,tell=async()=>{},problem=null,solved=async()=>{},log=m=>console.log(m),activity=async()=>{},fetchImpl=fetch,now=()=>Date.now(),PUBLIC_URL,wait=ms=>new Promise(r=>setTimeout(r,ms)),maxRuns=2,docLinks=null,mediaLink=null,receiptFinal=()=>{},echoWait=4000,setTimer=setTimeout,clearTimer=clearTimeout}){
 const pub=()=>String(PUBLIC_URL??publicUrl()).replace(/\/+$/,'');   // the address given (tests) or the install's current one
 const ASK_MIN=30;   // minutes a handoff may wait for the team's answer before Health shows it
 const CONF=path.join(DATA,'kirimdev.json'),SEC=path.join(DATA,'kirimdev-secrets.json'),ST=path.join(DATA,'kirimdev-state.json');
 const readJson=async(f,d)=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return d}};
 const put=async(f,v,mode=0o600)=>{await mkdir(DATA,{recursive:true});const t=f+'.'+process.pid+'.'+randomUUID().slice(0,8)+'.tmp';await writeFile(t,JSON.stringify(v,null,1),{mode});await rename(t,f)};
 let st=null,loading=null,chain=Promise.resolve();const queue=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p};
 const state=async()=>st||(loading||=readState());
 const readState=async()=>st=Object.assign({seen:[],cut:{},recent:{},pending:{},turns:{},outbox:{},last:{},testerNums:{},ours:{},paused:{},human:{},proposed:{},drafts:{},handoffs:{},asked:{},images:{},waits:{},known:{},holds:{},alerts:{},modes:{},noreply:{},lastReply:{},seq:0},await readJson(ST,{}));
 const saveState=()=>queue(async()=>{await state();st.seen=st.seen.slice(-3000);const t=now();
  for(const [k,v] of Object.entries(st.recent))if(t-v>48*3600e3)delete st.recent[k];
  for(const [k,v] of Object.entries(st.ours))if(t-v>48*3600e3)delete st.ours[k];
  for(const [k,v] of Object.entries(st.paused))if(v<t)delete st.paused[k];
  for(const [k,v] of Object.entries(st.human))if(t-v>48*3600e3)delete st.human[k];
  // a send that is finished (delivered, read, failed, cancelled, held) is kept 48 hours, anything else a week (audit M3: 1,840 entries, never pruned)
  for(const [k,o] of Object.entries(st.outbox)){const age=t-(o.at||0),done=['delivered','read','failed'].includes(o.receipt?.status)||['cancelled','held'].includes(o.status);if(done&&age>48*3600e3||age>7*86400e3)delete st.outbox[k]}
  for(const [k,v] of Object.entries(st.known))if(t-(v.at||0)>7*86400e3)delete st.known[k];
  for(const [k,v] of Object.entries(st.alerts))if(t-v>24*3600e3)delete st.alerts[k];
  for(const [k,v] of Object.entries(st.holds))if((v.until||0)<t)delete st.holds[k];
  for(const [k,v] of Object.entries(st.lastReply))if(t-(v.at||0)>3600e3)delete st.lastReply[k];
  for(const [k,d] of Object.entries(st.drafts))if(d.status!=='waiting'&&t-(d.doneAt||d.at)>7*86400e3||t-d.at>3*86400e3)delete st.drafts[k];
  await put(ST,st)});
 // The mode is what a person set on the Kirimdev page (setMode, written down in the state with who and when). A kirimdev.json whose mode
 // was changed any other way (a hand edit, the fixer, an agent) is not believed: the stricter of the two applies and Health says so (audit M6).
 const STRICT={test:0,draft:1,live:2};const modeTold=new Set();
 const lines=async()=>{const L=(await readJson(CONF,{lines:{}})).lines||{};await state();
  for(const [a,l] of Object.entries(L)){const file=MODES.includes(l?.mode)?l.mode:'test',rec=st.modes[a]?.mode;
   if(!rec){st.modes[a]={mode:file,at:now(),by:'as found'};continue}
   if(rec!==file){l.mode=STRICT[rec]<STRICT[file]?rec:file;
    if(!modeTold.has(a+'|'+file)){modeTold.add(a+'|'+file);log('kirimdev '+a+': kirimdev.json says mode '+file+' but the page last set '+rec+'; '+l.mode+' applies');
     Promise.resolve(problem?.(a,'kirimdev|mode','Kirimdev line ('+(l.persona||a)+'): its mode was changed outside the Kirimdev page','The settings file says '+file+', the page last set '+rec+' ('+(st.modes[a].by||'?')+'). The stricter one, '+l.mode+', applies until a person sets the mode on Channels › Kirimdev.')).catch(()=>{})}}
   else if(modeTold.size){for(const k of [...modeTold])if(k.startsWith(a+'|')){modeTold.delete(k);Promise.resolve(solved?.(a,'kirimdev|mode')).catch(()=>{})}}}
  return L};
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
 // who is a tester NOW (audit C2): the line's list, every time. testerNums only remembers which number a tester known by their chat writes
 // from (its value is that chat's id) and counts only while the line still lists that chat; a removed tester is a customer again.
 const testerNow=(agent,line,num,conv='')=>{if(isTester(line,{from:String(num||''),conversationId:conv}))return true;const v=st.testerNums[agent+'|'+num];return typeof v==='string'&&!!v&&(line.testers||[]).some(t=>t.conversationId===v)};
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
 // onEvent (design-guard.mjs EVENTS): 'whatsapp.received' once per batch of customer messages, 'whatsapp.unanswered' when a handoff waited ASK_MIN minutes.
 // Told after the fact and never awaited: an event hook or an event-started run must not hold up or break the line.
 const emit=(agent,type)=>{Promise.resolve().then(()=>onEvent(agent,{type,data:{}})).catch(()=>{})};
 const holdOf=(agent,num)=>{const h=st.holds[agent+'|'+num];return h&&h.until>now()?h:null};
 async function ingest(agent,line,ms){let told=false;if(ms.length)st.last[agent]={at:now(),from:ms[0].from};
  const mode=modeOf(line);
  for(const m of ms){const rk=agent+'|'+m.from;
   // WhatsApp's 24-hour window opens when the customer wrote, not when aqeelOS heard of it, and never for a made-up test event
   // (scripts/kirimdev-test-message.mjs, ids "wamid.aqtest-…"): 41 sends were refused as outside the window after such events (audit M8)
   if(!/^wamid\.aqtest-/.test(String(m.id||''))){const at=Math.min(now(),m.ts?m.ts*1000:now());if(at>(st.recent[rk]||0))st.recent[rk]=at}
   st.known[rk]={name:String(m.name||'').slice(0,80),conv:m.conversationId||st.known[rk]?.conv||'',at:now()};
   // a delivery check's own message (it only opens WhatsApp's 24-hour window): never answered
   if(PROBE.test(String(m.text||''))){log('kirimdev '+agent+': delivery check message from '+tail(m.from)+' (not answered)');continue}
   const tester=isTester(line,m);
   if(tester&&m.conversationId&&(line.testers||[]).some(t=>t.conversationId===m.conversationId))st.testerNums[rk]=m.conversationId;else if(!tester)delete st.testerNums[rk];
   if(mode==='test'&&!tester){log('kirimdev '+agent+': a message from a number that is not a tester (Test mode), not answered');continue}
   if(!told){told=true;emit(agent,'whatsapp.received')}
   const key=agent+'|'+line.phoneNumberId+'|'+(m.conversationId||m.from);
   const mid=m.id&&'message|'+agent+'|'+line.phoneNumberId+'|'+m.id;
   if(mid&&st.seen.includes(mid))continue;if(mid)st.seen.push(mid);
   // the same message seen by the webhook and by polling (their ids differ): its chat, second and text
   const same=m.conversationId&&m.ts?'in|'+agent+'|'+m.conversationId+'|'+m.ts+'|'+String(m.text||'').slice(0,40):'';
   if(same&&st.seen.includes(same))continue;if(same)st.seen.push(same);
   if(tester&&isReset(line,m.text.trim())){st.cut[key]=new Date((m.ts||now()/1000)*1000+1000).toISOString();delete st.pending[key];delete st.turns[key];cancelOutbound(agent,m.from);
    // a reset starts the test over: no pause or handoff left from earlier test traffic may hold the confirmation or the next question (7 Nov 2026)
    delete st.paused[agent+'|'+m.from];if(m.conversationId)delete st.paused[agent+'|'+m.conversationId];release(agent,m.from,'reset');
    await send(agent,line,m.from,line.resetText||'✅ Test reset. Start again as a new customer.').catch(e=>log('kirimdev reset reply: '+e.message));continue}
   const until=pausedUntil(agent,m.conversationId,m.from),hold=holdOf(agent,m.from);
   // a message during a team member's pause is kept, not dropped (audit 6 Nov: "mau pakai CC" was never answered): it waits
   // for the pause to end, and is answered then unless the team answered it meanwhile
   const paused=until>now();if(paused)log('kirimdev '+agent+': '+tail(m.from)+' wrote while a team member is answering; kept until '+new Date(until).toISOString());
   st.pending[key]={agent,from:m.from,conversationId:m.conversationId,name:testerName(line,m),at:st.pending[key]?.at||now(),token:randomUUID(),messages:[...(st.pending[key]?.messages||[]),m.text],...(paused||hold||st.pending[key]?.waited?{waited:true}:{})};
   // handed to the team (audit H4): the agent stays silent in this chat. The message is kept, the team's alert is refreshed, and the
   // customer gets the line's wait text at most once an hour. A person's reply, a release on the page or the long timeout ends it.
   if(hold){log('kirimdev '+agent+': '+tail(m.from)+' wrote while the chat is with the team; the agent stays silent');await nudgeHold(agent,line,hold,m.text);schedule(key,{debounceSec:Math.ceil((Math.max(hold.until,until)-now())/1000)+5});continue}
   schedule(key,paused?{debounceSec:Math.ceil((until-now())/1000)+5}:line)}}
 // the chat is the team's again → the agent's: a person answered, the team's answer was relayed, a tester reset, a release on the page
 function release(agent,num,why=''){const k=agent+'|'+num,h=st.holds[k];if(!h)return false;delete st.holds[k];for(const [id,w] of Object.entries(st.waits||{}))if(w.agent===agent&&w.from===String(num))delete st.waits[id];
  log('kirimdev '+agent+': the chat with '+tail(num)+' is no longer held for the team'+(why?' ('+why+')':''));return true}
 async function nudgeHold(agent,line,h,text){h.n=(h.n||0)+1;const mins=Math.round((now()-h.at)/60e3);
  if(now()-(h.nudged||0)>=10*60e3){h.nudged=now();const t=await target(agent);
   if(t)await telegram(agent,t.chatId,t.threadId,'🔁 STILL WAITING ('+line.persona+', '+(h.name||'customer')+', +'+h.from+')\nThe customer wrote again: '+String(text||'(a photo or file)').slice(0,300)+'\n\nHanded to the team '+mins+' min ago. '+line.persona+' stays silent in this chat until a person answers.\nChat: '+chatLink(line,h)+(t.mention?'\n'+t.mention:'')).catch(()=>false)}
  if(line.humanWaitText&&modeOf(line)!=='draft'&&now()-(h.wait||0)>=3600e3&&within24h(agent,h.from)&&pausedUntil(agent,h.conversationId,h.from)<=now()){h.wait=now();
   await send(agent,line,h.from,line.humanWaitText).catch(e=>log('kirimdev '+agent+': the wait text was not sent: '+e.message))}}

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
  // a real team reply ends the wait after a handoff: the agent does not resume on its own (11 Nov 2026, taken into git from fixer issue i87fbcb7b)
  for(const [id,w] of Object.entries(st.waits||{}))if(w.agent===agent&&(w.from===String(s.to)||s.conversationId&&w.conversationId===s.conversationId))delete st.waits[id];
  const freed=s.to?release(agent,s.to,'a person answered'):false;
  // a tester's chat is test traffic: it never pauses, so the tester's next test message is answered at once
  // (only customer chats wait the quiet time for a person); a handoff there still counts as answered
  if(testerNow(agent,line,s.to,s.conversationId)){log('kirimdev '+agent+': a person wrote to the tester '+tail(s.to)+' ('+(s.source||'?')+'); test chats do not pause');if(s.to)await answered(agent,s.to);
   // what the tester wrote while the chat was held is answered now
   if(freed)for(const [k,p] of Object.entries(st.pending))if(p.agent===agent&&p.from===s.to)schedule(k,{debounceSec:5});
   return {tester:true}}
  const min=Math.max(0,Number(line.pauseMin??DEFAULT_PAUSE));if(!min)return {paused:false};const until=now()+min*60e3;
  if(s.conversationId)st.paused[agent+'|'+s.conversationId]=until;if(s.to)st.paused[agent+'|'+s.to]=until;
  cancelOutbound(agent,s.to);
  for(const [k,p] of Object.entries(st.pending))if(p.agent===agent&&(p.conversationId===s.conversationId||p.from===s.to)){delete st.pending[k];delete st.turns[k];clearTimer(timers.get(k));timers.delete(k)}
  log('kirimdev '+agent+': a team member replied to '+tail(s.to)+' ('+(s.source||'?')+'); the agent waits '+min+' min');if(s.to)await answered(agent,s.to);return {paused:until}}

 // a burst of messages is answered once: the run starts a few seconds after the last one
 const FAIL_MAX=3,FAIL_WAIT=[60,300],FAIL_WINDOW=30*60e3,PROV_WAIT=[120,300,600,900],TURN_MAX=2*3600e3;
 const timers=new Map(),running=new Set();let active=0;
 // setTimer/clearTimer are injectable so tests drive the burst window themselves instead of racing a 0 s timer
 function schedule(key,line){clearTimer(timers.get(key));timers.set(key,setTimer(()=>{timers.delete(key);return run(key).catch(e=>log('kirimdev '+key+': '+e.message))},(line.debounceSec??8)*1000))}
 async function run(key){if(running.has(key))return;
  running.add(key);let acquired=false,later=false;
  try{while(active>=maxRuns)await wait(1000);active++;acquired=true;
   await state();const p=st.turns[key]||st.pending[key];if(!p)return;st.turns[key]=p;const line=await lineOf(p.agent);if(!line)return;
   const pu=pausedUntil(p.agent,p.conversationId,p.from);if(pu>now()){later=true;delete st.turns[key];schedule(key,{debounceSec:Math.ceil((pu-now())/1000)+5});return}
   const hd=holdOf(p.agent,p.from);if(hd&&!p.outbound){later=true;delete st.turns[key];schedule(key,{debounceSec:Math.ceil((hd.until-now())/1000)+5});return}
   // waited so long that an answer would come out of the blue (a provider outage, a long hold): past WhatsApp's 24 hours it is let go,
   // past 2 hours a person gets it instead of a late answer from the agent (audit M7)
   if(!p.outbound&&now()-p.at>24*3600e3){log('kirimdev '+p.agent+': a message from '+tail(p.from)+' waited more than 24 hours; let go');if(st.pending[key]?.token===p.token)delete st.pending[key];delete st.turns[key];await saveState();return}
   if(!p.outbound&&now()-p.at>TURN_MAX&&!p.late){p.late=true;const lastQ=(p.messages||[]).slice(-1)[0]||'-';if(st.pending[key]?.token===p.token)delete st.pending[key];delete st.turns[key];
    log('kirimdev '+p.agent+': a message from '+tail(p.from)+' waited '+Math.round((now()-p.at)/60e3)+' min; handed to the team instead of a late answer');
    await postHandoff({id:'h'+(++st.seq),agent:p.agent,from:p.from,conversationId:p.conversationId,name:p.name,lastQ,why:'This message waited '+Math.round((now()-p.at)/60e3)+' minutes without an answer (the agent could not run, or the chat was paused), so the agent did not answer it late. A person needs to.',notify:false,kind:'late',hold:false,tries:0,at:now()},line);await saveState();return}
   // kept during a pause: the team may have answered it since; then it is done
   if(p.waited&&p.conversationId){const l=((await api(line.phoneNumberId+'/messages?'+new URLSearchParams({conversation_id:p.conversationId,limit:'5'}))).data||[]).filter(m=>m.type!=='reaction').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
    if(l[0]?.direction==='outbound'&&Date.parse(l[0].created_at)>p.at){log('kirimdev '+p.agent+': the team answered '+tail(p.from)+' during the pause; nothing more to send');if(st.pending[key]?.token===p.token)delete st.pending[key];delete st.turns[key];await saveState();return}}
   // the provider is used up or throttled (hold set by a run that said so): nothing is started until its reset time, not even a try that cannot work (12 Nov 2026)
   const ph=st.provider?.[p.agent];if(ph&&ph.until>now()){later=true;delete st.turns[key];schedule(key,{debounceSec:Math.ceil((ph.until-now())/1000)});return}
   const epoch=st.cut[key]||'';
   try{await answer(p.agent,line,p,key)}
   catch(e){const lim=providerUnavailable(e.message,{now:now()});
    // ROOT CAUSE of the 'agent stopped' loops (12 Nov 2026): the engine run exits 1 because the Claude/GPT account is used up or throttled (HTTP 429 'session limit'), for every chat of the line at once; the two
    // always-active tester chats showed it. That is not the chat's fault: it waits for the reset time (30 min at most, else 2/5/10/15 min), the customer's message stays, ONE Health problem names the reason, and the first good answer clears it
    if(lim){const h=(st.provider||={})[p.agent],n=(h?.n||0)+1,until=retryAt(lim,{now:now(),fallback:PROV_WAIT[Math.min(n,PROV_WAIT.length)-1]*1000,max:30*60e3,pad:30e3});st.provider[p.agent]={n,until,why:lim.why,kind:lim.kind,since:h?.since||now()};later=true;await saveState();
     log('kirimdev '+p.agent+': the AI provider is not available ('+lim.kind+': '+lim.why.slice(0,120)+'); '+tail(p.from)+' waits until '+new Date(until).toISOString().slice(11,16)+' UTC');schedule(key,{debounceSec:Math.ceil((until-now())/1000)});
     if(!h)await problem?.(p.agent,'kirimdev|provider','Kirimdev line ('+line.persona+'): the AI provider is not available','Customers are not answered while it is down; their messages wait and are answered by themselves when it works. Reason from the engine: '+lim.why+(lim.resetAt?' It resets at '+new Date(lim.resetAt).toISOString().slice(11,16)+' UTC.':'')+' Fix: use another account for this agent (Accounts), or wait.').catch(()=>{});return}
    const f=(st.fails||={})[key],n=(f&&now()-f.at<FAIL_WINDOW?f.n:0)+1;st.fails[key]={n,at:now()};
    if(n<FAIL_MAX){later=true;await saveState();log('kirimdev '+p.agent+': the agent stopped on '+tail(p.from)+' ('+n+'/'+FAIL_MAX+'): '+e.message+'; trying again in '+FAIL_WAIT[n-1]+' s');schedule(key,{debounceSec:FAIL_WAIT[n-1]});return}
    // the loop breaker (12 Nov 2026: two chats retried every few seconds, about 290 times a day): nothing is retried any more; a person gets the chat once
    delete st.fails[key];if(st.pending[key]?.token===p.token)delete st.pending[key];delete st.turns[key];(st.stopped||={})[key]=1;
    const lastQ=(p.messages||[]).slice(-1)[0]||'-';log('kirimdev '+p.agent+': the agent stopped '+n+' times on '+tail(p.from)+'; the chat was handed to the team');
    await postHandoff({id:'h'+(++st.seq),agent:p.agent,from:p.from,conversationId:p.conversationId,name:p.name,lastQ,why:'The agent stopped '+n+' times in a row on this chat ('+e.message+'). Nothing was sent to the customer, so a person needs to answer.',notify:false,kind:'stopped',hold:false,tries:0,at:now()},line);
    await problem?.(p.agent,'stopped|'+key,'Kirimdev line ('+line.persona+'): the agent keeps stopping on one chat','The agent stopped '+n+' times in a row on the chat with …'+String(p.from).slice(-4)+' ('+e.message+'). It is not tried again by itself; the chat is in the Questions topic. Its next message from the customer starts a fresh try.').catch(()=>{});await saveState();return}
   if(st.provider?.[p.agent]){delete st.provider[p.agent];await solved?.(p.agent,'kirimdev|provider').catch(()=>{})}
   if(st.stopped?.[key]){delete st.stopped[key];await solved?.(p.agent,'stopped|'+key).catch(()=>{})}
   delete st.fails?.[key];
   // Only consume the snapshot we answered, never a newer arrival.
   if(st.pending[key]?.token===p.token)delete st.pending[key];
   else if(st.pending[key]&&(st.cut[key]||'')===epoch)st.pending[key].messages=st.pending[key].messages.slice((p.messages||[]).length);
   delete st.turns[key];await saveState();
  }finally{running.delete(key);if(acquired)active--;
   if(st?.pending[key]&&!later)schedule(key,{debounceSec:5})}}

 // a customer's photo: read once by the agent's own model (no tools, kirimdev-agent.mjs createImageReader), and the short description
 // kept, so the run knows a receipt or product photo arrived (8 Nov 2026: it only saw "[image]" and asked for the receipt twice). At most
 // three new photos per reply; a photo that cannot be opened stays "[image]". A photo never confirms a payment: check_payment does.
 const msgText=m=>{const t=String(m.content||'').replace(FOOTER,'').trim(),d=m.type==='image'&&m.direction==='inbound'&&st?.images?.[m.id]?.d;return d?'[customer photo: '+d+']'+(t?' '+t:''):(t||'['+m.type+']')};
 async function noteImages(agent,l){if(!describeImage)return;
  const todo=l.filter(m=>m.type==='image'&&m.direction==='inbound'&&m.id&&/^https:\/\//.test(m.media_url||'')&&!st.images[m.id]).slice(-3);
  for(const m of todo){let f=null;try{const r=await fetchImpl(m.media_url,{signal:AbortSignal.timeout(30000)});const type=String(r.headers?.get?.('content-type')||''),ext=(/image\/(jpeg|png|webp)/.exec(type)||[])[1];
    if(!r.ok||!ext)throw Error('answered '+r.status+' '+type.slice(0,30));const b=Buffer.from(await r.arrayBuffer());if(b.length>IMAGE_MAX)throw Error('too large');
    await mkdir(DATA,{recursive:true});f=path.join(DATA,'kirimdev-image-'+randomUUID()+'.'+ext);await writeFile(f,b,{mode:0o600});
    const d=String(await describeImage(agent,f)||'').replace(/[\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,400);if(d)st.images[m.id]={d,at:now()}}
   catch(e){log('kirimdev '+agent+': a customer photo could not be read: '+e.message)}
   finally{if(f)await unlink(f).catch(()=>{})}}
  const old=Object.entries(st.images).sort((a,b)=>a[1].at-b[1].at).slice(0,-300);for(const [k] of old)delete st.images[k]}
 async function history(agent,line,p,key){if(!p.conversationId)return '';const q=new URLSearchParams({conversation_id:p.conversationId,limit:'30'});
  const l=((await api(line.phoneNumberId+'/messages?'+q)).data||[]).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).filter(m=>String(m.created_at)>(st.cut[key]||''));
  await noteImages(agent,l);
  return l.map(m=>(m.direction==='inbound'?'CUSTOMER':String(line.persona||'AGENT').toUpperCase())+': '+msgText(m)).join('\n')}

 async function answer(agent,line,p,key){if(p.outbound){for(const id of p.outbound)await deliver(id);return}const epoch=st.cut[key]||'';const hist=await history(agent,line,p,key);const mode=modeOf(line);
  const who=mode==='test'?'WHATSAPP TEST CHAT (customer = a team tester, treat them exactly like a real customer).':'WHATSAPP CHAT with a customer.';
  const q=who+' You are '+line.persona+' for '+line.business+'. Customer WhatsApp number: '+((line.localPrefix?String(p.from||'').replace(new RegExp('^'+String(line.localPrefix.country||'').replace(/\D/g,'')),String(line.localPrefix.local??'')):String(p.from||''))||'unknown')+' (use it for the phone field of the order form; never ask the customer for it). In customer chats you have no shell and no files: read your knowledge sheet with read_sheet and your decisions, briefing and template files with read_file (list_files shows them), this chat with conversation, and make a payment only with create_payment (never .tools/sheet, cat, .tools/kirim, .tools/qris or .tools/pay here). Prices are never yours to set: quote_order gives the total of an order from the price list aqeelOS holds, and create_payment charges that total. When the customer says they paid, asks if it arrived, or sends a receipt, use check_payment and answer from it: PAID means confirmed, anything else means the team is still checking; never hand that off and never ask for the receipt again. A line like [customer photo: …] is a description of a picture they sent, and a picture never proves a payment. Read your knowledge sheet tabs + decisions file first; for anything they do not cover (product facts, how something works), look up how the team answered it before with past_chats (scope answers) before you hand off. Never give one customer another person\'s name, number, address or order. Conversation so far (oldest first):\n\n'+hist+
   '\n\nNew inbound messages (authoritative even if provider history is delayed):\n'+(p.messages||[]).map(t=>'CUSTOMER: '+(t||'(a photo or file, shown in the conversation above)')).join('\n')+
   '\n\nWrite ONLY the WhatsApp reply text to send next ('+(line.language?'in '+line.language+', or in the customer\'s own language when they write another':'in the customer\'s own language')+', WhatsApp formatting with *bold*, short paragraphs). Do NOT send anything yourself. Output only the message addressed to the customer, never an operator preface, draft commentary, or a statement that you have not sent it. Never only ask the customer to wait: nothing brings you back to this chat later, so answer now or hand off. '+
   'If several messages are needed, separate them with a line containing only ---. If this must go to a human (handoff rules), reply exactly: HANDOFF: <reason, and what you already checked (sheet, past chats) and found>';
  const ctxRun={session:conversationSession(agent,line.phoneNumberId,p.conversationId||p.from,epoch),run:{since:epoch,line:line.phoneNumberId,conversation:p.conversationId||'',phone:p.from,mode,tester:testerNow(agent,line,p.from,p.conversationId||'')}};
  const ask=async note=>String(await runAgent(agent,note?q+note:q,ctxRun)||'').replace(FOOTER,'').trim();
  // the log is readable on the box: the chat is named by its last four digits, never by the customer's name (audit M2)
  log('kirimdev '+agent+': answering '+tail(p.from));const runAt=now();let out=await ask('');
  const lastQ=hist.split('\n').filter(l=>l.startsWith('CUSTOMER: ')).pop()?.slice(10)||(p.messages||[]).slice(-1)[0]||'-';
  const handoff=(why,o={})=>postHandoff({id:'h'+(++st.seq),agent,from:p.from,conversationId:p.conversationId,name:p.name,lastQ,why,notify:mode!=='draft',tries:0,at:now(),...o},line);
  // a team member replied while the agent was thinking: theirs stands (no alert: a person answered)
  const stale=async()=>{await state();if((st.cut[key]||'')!==epoch||pausedUntil(agent,p.conversationId,p.from)>now()||humanAt(agent,p.conversationId,p.from)>=runAt){log('kirimdev '+agent+': conversation reset or a team member answered meanwhile; the agent\'s reply was not sent');return true}return false};
  if(await stale())return;
  // nothing written: the customer would never hear back and nobody would know (audit H7). A person gets the chat.
  if(!out){log('kirimdev '+agent+': the agent wrote nothing; the team was told');await alertTeam(agent,line,{key:'empty|'+p.from,title:'the agent wrote nothing for a customer message',detail:'Customer wrote: '+String(lastQ).slice(0,300)+'\nNothing was sent. Answer in Kirimdev if it needs an answer.',from:p.from,conversationId:p.conversationId,name:p.name});return}
  if(/^HANDOFF\b/.test(out))return handoff(out.replace(/^HANDOFF:?\s*/,'').trim()||'(no reason given)');
  // pictures the agent should send with a recommendation, when it forgets the tags
  const withPhotos=t=>line.autoPhotos?.pattern&&new RegExp(line.autoPhotos.pattern,'i').test(t)&&!/\[(FOTO|TEMPLATE):/.test(t)?t+'\n'+(line.autoPhotos.tags||[]).join('\n'):t;
  // a payment made for this customer in a recent earlier run counts too: a follow-up reply that points back to the QRIS sent a minute
  // ago is not a false claim (false handoff, 10 Nov). Window: lines.<agent>.paymentRecentMin (default 60).
  const check=async text=>guardReply(splitReply(withPhotos(text)),{paid:paidSince?await paidSince(agent,p.from,runAt-Math.max(0,Number(line.paymentRecentMin??60)||0)*60e3).catch(()=>null):null,qrPics:qrSince?await qrSince(agent,p.from,runAt).catch(()=>[]):[],
   ctx:await guardCtx(agent,line,p.from,{hist}),customerText:(p.messages||[]).join('\n')});
  let g=await check(out);
  // held by the exit guard (audit H6): the customer gets nothing wrong. The reply is written once more with the reason; if that is
  // held too (or is nothing), a person gets the chat with the held text, which only the team sees.
  if(g.hold){log('kirimdev '+agent+': reply for '+tail(p.from)+' HELD by the exit guard ('+(g.kinds||[]).join(',')+'); asking for it once more');
   let again='';try{again=await ask('\n\nNOTE: your last reply was NOT sent to the customer. '+g.hold+'\nWrite the reply again: only the message the customer should read, in their language, with nothing about your rules, tools, files, the team or other people. If you cannot, reply exactly: HANDOFF: <reason>')}catch(e){log('kirimdev '+agent+': the second try stopped: '+e.message)}
   if(await stale())return;
   if(/^HANDOFF\b/.test(again))return handoff(again.replace(/^HANDOFF:?\s*/,'').trim()||'(no reason given)');
   const g2=again?await check(again):null;
   if(!g2||g2.hold){const held=(g2||g).parts.join('\n---\n'),secret=((g2||g).kinds||[]).includes('secret');log('kirimdev '+agent+': reply for '+tail(p.from)+' held again; handed to the team');
    return handoff('The exit guard stopped the agent\'s reply twice, so nothing was sent to the customer. '+String((g2||g).hold).split(': ')[0]+'.',{kind:'held',held:secret?'(not shown: it held what looks like a key)':held})}
   g=g2}
  if(g.attached?.length)log('kirimdev '+agent+': the reply promised the QRIS without its picture; attached '+g.attached.join(' '));
  if(g.dropped?.length)log('kirimdev '+agent+': dropped '+g.dropped.length+' note(s) from the reply');
  if(mode==='draft')return makeDraft(agent,line,p,g.parts);
  p.outbound=[];for(const part of withCaptions(g.parts)){const id=await prepare(agent,line,p.from,part);if(id)p.outbound.push(id)}await saveState();
  // every part was a picture tag aqeelOS has no picture for: nothing to send, and the customer must not be left with silence (audit H7)
  if(!p.outbound.length){delete p.outbound;await alertTeam(agent,line,{key:'empty|'+p.from,title:'the agent\'s reply was only pictures aqeelOS does not have',detail:'Customer wrote: '+String(lastQ).slice(0,300)+'\nThe reply: '+g.parts.join(' ').slice(0,200)+'\nNothing was sent.',from:p.from,conversationId:p.conversationId,name:p.name});return}
  for(const id of p.outbound){await deliver(id);await wait(2500)}}

 // where the team opens the chat: the line's own link (lines.<agent>.chatLink with {phone} and {conversation}), else WhatsApp itself
 const chatLink=(line,h)=>line?.chatLink?String(line.chatLink).replace('{phone}',h.from||'').replace('{conversation}',h.conversationId||''):'https://wa.me/'+String(h.from||'');
 // the same text accepted for the same number in the last 10 minutes is not sent again (audit M5: the handoff line went out again 18 times)
 const sentLately=(agent,to,text,ms=10*60e3)=>Object.values(st.outbox).some(o=>o.agent===agent&&o.to===to&&o.receipt?.id&&now()-o.at<ms&&bodyText(o.body)===String(text).trim());
 // counted for System › Health: customer messages that ended with no reply from the agent
 const countNoReply=agent=>{const c=(st.noreply||={})[agent]||={n:0,day:''},day=new Date(now()).toISOString().slice(0,10);if(c.day!==day){c.day=day;c.n=0}c.n++;c.total=(c.total||0)+1;c.last=now()};
 // ONE alert for the team, in the line's Questions topic, with the chat link (audit H7): every case where a customer's message ends with no
 // delivered reply and no handoff post covers it. Also one Health line of kind "customer": shown and counted on System › Health, never
 // given to the agent or the code fixer (neither can answer a customer). The bell only when Telegram did not take the post.
 async function alertTeam(agent,line,{key,topic,title,detail='',from='',conversationId='',name=''}){await state();const k=agent+'|'+key;if(st.alerts[k]&&now()-st.alerts[k]<6*3600e3)return false;st.alerts[k]=now();countNoReply(agent);
  const who=line?.persona||agent,t=await target(agent);
  const post='⚠️ NO REPLY SENT ('+who+(name?', '+name:'')+(from?', +'+from:'')+')\n'+title+(detail?'\n'+detail:'')+(from?'\n\nChat: '+chatLink(line,{from,conversationId}):'')+(t?.mention?'\n'+t.mention:'');
  const mid=t?await telegram(agent,t.chatId,t.threadId,post).catch(()=>false):false;
  await Promise.resolve(problem?.(agent,topic||'customer|'+key,'Kirimdev line ('+who+'): '+title,(from?'Chat with …'+String(from).slice(-4)+'. ':'')+(mid?'The team was told in their Questions topic.':'The team could NOT be told in Telegram (no team group, or the post failed): tell them.'))).catch(()=>{});
  if(!mid)await tell('Kirimdev line ('+who+'): '+title,(from?'Chat with …'+String(from).slice(-4)+'. ':'')+'The team could not be told in Telegram.').catch(()=>{});
  await saveState();return !!mid}
 // a handoff is posted first; the customer hears it was passed on only once Telegram confirmed the post.
 // One open handoff per chat (audit H4, M5): a second request refreshes the team's alert and is never dropped; the customer is not told twice.
 async function postHandoff(h,line){const t=await target(h.agent),hk=h.agent+'|'+h.from;
  const open=Object.entries(st.asked||{}).find(([,a])=>a.agent===h.agent&&a.from===h.from),again=!!open&&!h.tries;
  const post=(again?'🔁 HANDOFF AGAIN (':'❓ HANDOFF (')+line.persona+', '+h.name+', +'+h.from+')\nCustomer asked: '+h.lastQ+'\n\nWhy: '+h.why+(h.held?'\n\nHeld text (NOT sent to the customer):\n'+String(h.held).slice(0,1200):'')+'\n\nChat: '+chatLink(line,h)+'\n\n'+(t?.mention?t.mention+' ':'')+(again?'still waiting for a person: answer the customer in Kirimdev, or reply here with the answer. '+line.persona+' stays silent in this chat until then.':'reply here with the answer and '+line.persona+' sends it to the customer.');
  const mid=t?await telegram(h.agent,t.chatId,t.threadId,post).catch(()=>false):false;h.tries++;
  if(mid){delete st.handoffs[h.id];log('kirimdev '+h.agent+': handoff '+(again?'refreshed':'posted')+(h.tries>1?' (try '+h.tries+')':''));if(h.tries>1)await solved(h.agent,'handoff|'+h.id).catch(()=>{});
   if(h.kind)countNoReply(h.agent);
   // nothing else the agent queued goes to this chat any more: a send still waiting for a retry would arrive after "passed to the team" (audit M7)
   cancelOutbound(h.agent,h.from);
   const text=line.handoff?.customerText||'Thanks, I am passing this question to our team. They will get back to you shortly.';
   const tellIt=!again&&h.notify&&within24h(h.agent,h.from)&&pausedUntil(h.agent,h.conversationId,h.from)<=now()&&!sentLately(h.agent,h.from,text);
   if(tellIt)await send(h.agent,line,h.from,text).catch(e=>log('kirimdev '+h.agent+': sending failed: '+e.message));
   // waiting for the team's answer: the team is told again when nobody answered within ASK_MIN minutes
   if(again){const a=open[1];a.again=(a.again||0)+1;a.lastQ=h.lastQ}
   else st.asked[h.id]={agent:h.agent,from:h.from,conversationId:h.conversationId,name:h.name,lastQ:h.lastQ,at:now()};
   // the agent stays silent in this chat (audit H4) until a person answers, someone releases it on the Kirimdev page, or
   // lines.<agent>.handoff.releaseMin minutes pass (default 720 = 12 hours)
   const rel=Math.max(5,Number(line.handoff?.releaseMin??720)||720),old=holdOf(h.agent,h.from);
   if(h.hold!==false)st.holds[hk]={id:old?.id||h.id,agent:h.agent,from:h.from,conversationId:h.conversationId,name:h.name,at:old?.at||now(),until:now()+rel*60e3,wait:old?.wait||0,nudged:now(),n:old?.n||0};
   // no team reply within lines.<agent>.humanWaitMin minutes (default 5, 0 = never): the customer gets humanWaitText once; the agent does NOT take the chat back
   const wm=Math.max(0,Number(line.humanWaitMin??5)||0);if(tellIt&&wm&&line.humanWaitText)(st.waits||={})[h.id]={agent:h.agent,from:h.from,conversationId:h.conversationId,name:h.name,at:now(),due:now()+wm*60e3};
   await saveState();return true}
  if(now()-h.at>24*3600e3){delete st.handoffs[h.id];await tell(line.persona+' gave up posting a handoff in Telegram','After a day of tries. The customer (…'+String(h.from).slice(-4)+') was not told anything.').catch(()=>{});await saveState();return false}
  h.next=now()+RETRY_MIN[Math.min(h.tries-1,RETRY_MIN.length-1)]*60e3;st.handoffs[h.id]=h;
  if(h.tries===1){const title=line.persona+' could not post a handoff in Telegram',detail=(t?'':'No team group is set for '+line.persona+' (Channels › Kirimdev, Team group). ')+'The customer (…'+String(h.from).slice(-4)+') was not told it was passed on. aqeelOS tries again in 1, 5, 15 and 30 minutes, then hourly.';
   // System › Health and one Telegram alert to the owner (agent-health.mjs) when that is there; the bell otherwise
   await (problem?problem(h.agent,'handoff|'+h.id,'Kirimdev line ('+line.persona+'): '+title.replace(line.persona+' ',''),detail):tell(title,detail)).catch(()=>{});log('kirimdev '+h.agent+': handoff not posted; the owner was told')}
  await saveState();return false}
 // handoffs waiting for another try (every 30 seconds on the live box)
 let ticking=false;
 async function tick(){if(ticking)return;ticking=true;try{await state();for(const h of Object.values(st.handoffs)){if((h.next||0)>now())continue;const line=await lineOf(h.agent);if(!line){delete st.handoffs[h.id];continue}await postHandoff(h,line)}
  await resumeWaits();await drainOutbox();await unanswered();checks().catch(e=>log('kirimdev delivery check: '+e.message))}finally{ticking=false}}
 // ---- delivery checks (see PROBE above). One at a time, in the background so handoffs never wait for one. Asked for by a
 // file in DATA/delivery-checks (scripts/delivery-check.mjs: the fixer's proof, a person), and once a day for every line.
 let probing=null;const CHK=path.join(DATA,'delivery-checks');
 async function checks(){if(probing)return;
  const reqs=(await import('node:fs/promises').then(f=>f.readdir(CHK)).catch(()=>[])).filter(f=>/^[\w-]+\.req\.json$/.test(f)).sort();
  let job=null;for(const f of reqs){const r=await readJson(path.join(CHK,f),null);await unlink(path.join(CHK,f)).catch(()=>{});if(r?.agent){job={...r,file:f.replace(/\.req\.json$/,'')};break}}
  if(!job){const L=await lines().catch(()=>({}));const a=Object.keys(L).find(a=>now()-(st.probes?.[a]?.at||0)>24*3600e3&&now()-(st.probeTried?.[a]||0)>24*3600e3);
   if(!a||!await bridge.self())return;(st.probeTried||={})[a]=now();await saveState();job={agent:a}}
  const step=async t=>{if(job.file)await appendFile(path.join(CHK,job.file+'.steps.log'),new Date().toISOString().slice(11,19)+' '+t+'\n').catch(()=>{})};await step('The app picked up the request.');
  probing=deliveryCheck(job.agent,{link:job.link,document:!!job.document,step}).then(async r=>{if(job.file){await mkdir(CHK,{recursive:true});await put(path.join(CHK,job.file+'.result.json'),r,0o644)}
   if(job.document){const t='delivery-pdf|'+job.agent;if(r.sent&&!r.document)await problem?.(job.agent,t,'Kirimdev line: a PDF did not reach a phone in a delivery check',r.why||'Sent, but no PDF arrived.').catch(()=>{});else if(r.document)await solved?.(job.agent,t).catch(()=>{})}
   else if(!r.picture&&r.sent)await problem?.(job.agent,'delivery|'+job.agent,'Kirimdev line: pictures did not reach a phone in a delivery check',r.why||'Sent, but no picture arrived.').catch(()=>{});
   else if(r.picture)await solved?.(job.agent,'delivery|'+job.agent).catch(()=>{})},
   async e=>{log('kirimdev '+job.agent+': delivery check failed: '+e.message);if(job.file){await mkdir(CHK,{recursive:true}).catch(()=>{});await put(path.join(CHK,job.file+'.result.json'),{agent:job.agent,picture:false,...(job.document?{document:false}:{}),why:'The check failed before anything was sent: '+e.message},0o644).catch(()=>{})}}).finally(()=>{probing=null})}
 async function deliveryCheck(agent,{link,document=false,step=async()=>{}}={}){await state();const line=await lineOf(agent);if(!line)throw Error('No Kirimdev line for '+agent+'.');
  const out={at:now(),agent,sent:false,arrived:false,picture:false,...(document?{document:false}:{})};const done=async why=>{if(why)out.why=why;(st.probes||={})[agent]=out;await saveState();log('kirimdev '+agent+': delivery check: '+(out.document?'the PDF arrived ('+out.bytes+' bytes)':out.picture?'the picture arrived ('+out.bytes+' bytes)':out.why||'no picture'));return out};
  await step('Looking for the main WhatsApp and the line.');const me=String(await bridge.self()||'').replace(/\D/g,'');if(!me)return done('The main WhatsApp is not connected on this server, so there is no phone to check on.');
  if(bridge.ready&&!await bridge.ready())return done('The main WhatsApp has not restarted since delivery checks were installed. They start after the next engine restart.');
  const acc=await probe('accounts',await apiKey().catch(()=>null)),ln=String((acc.ok&&Array.isArray(acc.json?.data)?acc.json.data:[]).find(x=>String(x?.phone_number_id)===String(line.phoneNumberId))?.phone_number||'').replace(/\D/g,'');if(!ln)return done('Kirimdev did not give this line\'s phone number.');
  const id=randomUUID().replace(/-/g,'').slice(0,12);out.id=id;
  if(!within24h(agent,me)){await step('Opening the line'+String.fromCharCode(39)+'s 24-hour window: the main WhatsApp writes to the line (up to 90 s).');await bridge.send(ln,'aqeelOS delivery check, please ignore. aqeelos-probe:'+id+'w');
   for(let i=0;i<30&&!within24h(agent,me);i++){await wait(3000);await state()}
   if(!within24h(agent,me))return done('The line never received the check message from the main WhatsApp (webhook or polling not running?).')}
  // a PDF check goes the whole real way: the app's own one-purpose link (public address, Cloudflare), Kirimdev's document message, WhatsApp, the main phone downloads and reads it
  if(document){if(!docLinks)return done('This install has no file links.');let dl;try{dl=await docLinks.put({buffer:SAMPLE_PDF,name:'aqeelOS delivery check.pdf',agent,ttl:10*60e3})}catch(e){return done('Could not make the PDF link: '+e.message)}
   try{await step('The file link is made; asking Kirimdev to send the PDF.');out.link=dl.url.replace(/\/doc\/[^/]+\//,'/doc/…/');
    const r=await api(line.phoneNumberId+'/messages',{messaging_product:'whatsapp',recipient_type:'individual',to:me,type:'document',document:{link:dl.url,filename:'aqeelOS delivery check.pdf',caption:'aqeelOS delivery check, please ignore. aqeelos-probe:'+id}},{idem:'probe-'+id}).catch(e=>({error:e.message}));
    if(!r?.data?.id)return done('Kirimdev did not take the PDF: '+(r?.error||'no receipt'));out.sent=true;st.ours[r.data.id]=now();await step('Kirimdev took the PDF; waiting up to 3 minutes for the main WhatsApp to report it.');
    let res=null;for(let i=0;i<36&&!res;i++){await wait(5000);res=await bridge.result(id)}
    if(!res)return done('Sent and accepted by Kirimdev, but nothing reached the main WhatsApp within 3 minutes.');
    out.arrived=true;out.bytes=res.bytes||0;out.document=!!res.ok&&res.type==='document';return done(out.document?null:'A message arrived but its PDF did not download'+(res.error?' ('+res.error+')':'')+'.')}
   finally{await dl.revoke()}}
  const urls=(await readFile(path.join(WORK,agent,'media','staff','urls.txt'),'utf8').catch(()=>'')).split(/\s+/).filter(Boolean);
  const pic=String(link||urls.filter(u=>/qris/i.test(u)).pop()||urls[0]||'').replace(/([?&])f=\/[^&#]*(&|$)/,(m,a,b)=>b?a:'').replace(/[?&]$/,'');if(!/^https:\/\//.test(pic))return done('No picture to send: media/staff/urls.txt is empty.');
  out.link=pic;await step('Asking Kirimdev to send the picture.');
  const r=await api(line.phoneNumberId+'/messages',{messaging_product:'whatsapp',recipient_type:'individual',to:me,type:'image',image:{link:pic,caption:'aqeelOS delivery check, please ignore. aqeelos-probe:'+id}},{idem:'probe-'+id}).catch(e=>({error:e.message}));
  if(!r?.data?.id)return done('Kirimdev did not take the picture: '+(r?.error||'no receipt'));out.sent=true;st.ours[r.data.id]=now();await step('Kirimdev took the picture; waiting up to 3 minutes for the main WhatsApp to report it.');
  let res=null;for(let i=0;i<36&&!res;i++){await wait(5000);res=await bridge.result(id)}
  if(!res)return done('Sent and accepted by Kirimdev, but nothing reached the main WhatsApp within 3 minutes.');
  out.arrived=true;out.picture=!!res.ok;out.bytes=res.bytes||0;return done(res.ok?null:'A message arrived but its picture did not download'+(res.error?' ('+res.error+')':'')+'.')}
 // a handoff the customer was told about, past its humanWaitMin with no team reply: the customer gets the line's humanWaitText, once, and
 // the chat stays with the team. The agent is never asked to answer the handed-off question itself (audit H4: it did, 13 times, among them
 // medical questions at night). Skipped in Draft, during a team member's pause, or when a person wrote there since.
 async function resumeWaits(){for(const [id,w] of Object.entries(st.waits||{})){if(w.due>now())continue;delete st.waits[id];const line=await lineOf(w.agent);if(!line||modeOf(line)==='draft'||!line.humanWaitText)continue;
   const h=holdOf(w.agent,w.from);if(!h||humanAt(w.agent,w.conversationId,w.from)>(w.at||0)||pausedUntil(w.agent,w.conversationId,w.from)>now()||!within24h(w.agent,w.from))continue;
   h.wait=now();log('kirimdev '+w.agent+': no team reply to '+tail(w.from)+' after the handoff; the customer gets the wait text, the agent stays silent');
   await send(w.agent,line,w.from,line.humanWaitText).catch(e=>log('kirimdev '+w.agent+': the wait text was not sent: '+e.message));await saveState()}}
 // a handoff the team has not answered after ASK_MIN minutes: the team is told once more in their topic, and Health shows it (kind
 // "customer": for people, never for the agent or the code fixer); after a day it is let go
 async function unanswered(){let ch=false;for(const [id,a] of Object.entries(st.asked||{})){const age=now()-a.at;
   if(age>24*3600e3){delete st.asked[id];ch=true;if(a.told)await solved?.(a.agent,'unanswered|'+id).catch(()=>{});continue}
   if(a.told||age<ASK_MIN*60e3)continue;const line=await lineOf(a.agent);
   await alertTeam(a.agent,line,{key:'unanswered|'+id,topic:'unanswered|'+id,title:'a handoff has no answer after '+ASK_MIN+' minutes',detail:'Customer asked: '+String(a.lastQ||'').slice(0,300)+'\nAnswer the customer in Kirimdev, or reply to the HANDOFF post.',from:a.from,conversationId:a.conversationId,name:a.name});
   a.told=now();ch=true;emit(a.agent,'whatsapp.unanswered')}
  if(ch)await saveState()}

 // Draft: the reply waits in the Questions topic (and on the Channels page) for a PERSON to approve it (audit H5). The draft is one post; a
 // short second post is the one to answer ("ok", "no", "kirim: <your text>"), so the engine's hook sees the whole answer (teamMessage below).
 async function makeDraft(agent,line,p,parts,why=''){if(!parts.length)return;const id=++st.seq;
  const d={id,agent,from:p.from,conversationId:p.conversationId,name:p.name,parts,at:now(),status:'waiting',held:!!why};st.drafts[id]=d;
  // labels the agent asked for in Draft are not set: they ride with the draft and are set when a person sends it
  const pk=agent+'|'+p.conversationId,pl=st.proposed[pk];if(pl){delete st.proposed[pk];if(pl.add.length||pl.remove.length)d.labels=pl}
  const t=await target(agent);
  const post='📝 DRAFT #'+id+' ('+line.persona+', '+p.name+', +'+p.from+')'+(why?'\n'+why:'')+'\n\n'+parts.join('\n---\n')+(d.labels?'\n\n🏷 Labels, set when it is sent: '+labelWords(d.labels):'');
  const mid=t?await telegram(agent,t.chatId,t.threadId,post).catch(()=>false):false;d.posted=!!mid;
  if(mid){d.mid=mid;const ask=await telegram(agent,t.chatId,t.threadId,'✋ DRAFT #'+id+' waits for a person. '+(t.mention?t.mention+' ':'')+'Reply to THIS message: "ok" sends it, "kirim: <your text>" sends your text instead, "no" drops it. Or open '+pub()+'/channels/kirimdev').catch(()=>false);if(ask)d.ask=ask}
  if(!mid)await tell(line.persona+' wrote a draft that could not be posted in Telegram',(t?'':'No team group is set (Channels page, Team group). ')+'It waits on the Channels page, where you can send or drop it.').catch(()=>{});
  log('kirimdev '+agent+': draft #'+id+' for '+tail(p.from)+(mid?' posted':' kept on the Channels page'));await saveState();return d}
 // send (as written or changed) or drop a draft. approval {human:true, via, …} is given only by the Channels page (a signed-in admin) and by
 // teamMessage (a Telegram message from someone on the line's approvers list). No agent tool can give it: an agent never approves its own draft.
 async function draft(agent,id,action,text,by,approval=null){await state();const d=st.drafts[Number(id)];
  if(!d||d.agent!==agent)throw Error('There is no draft #'+id+' for this agent.');
  if(approval?.human!==true)throw Error('Only a person on the team sends or drops a draft: they answer the "DRAFT #'+id+' waits" message in the team topic, or use the Channels page. Nothing was sent.');
  if(d.status!=='waiting')throw Error('Draft #'+id+' was already '+(d.status==='sent'?'sent':'dropped')+'.');
  if(action==='discard'||action==='drop'){d.status='dropped';d.doneAt=now();d.by=String(by||'');d.via=approval.via||'';await saveState();log('kirimdev '+agent+': draft #'+id+' dropped by '+d.by);return {dropped:true}}
  if(action!=='send')throw Error('The action is send or discard.');
  const line=await lineOf(agent);if(!line)throw Error('This agent has no Kirimdev line.');
  if(!within24h(agent,d.from))throw Error('The customer last wrote more than 24 hours ago, so WhatsApp does not allow a reply.');
  if(d.held&&!(text&&String(text).trim()))throw Error('Draft #'+id+' was held because it had text meant for the team. Send the clean text instead.');
  const parts=text&&String(text).trim()?splitReply(text):d.parts;if(!parts.length)throw Error('Write the text to send.');
  d.by=String(by||'');d.via=approval.via||'';d.edited=!!(text&&String(text).trim());
  if(!d.outbound){d.outbound=[];for(const p of withCaptions(parts)){const op=await prepare(agent,line,d.from,p);if(op){st.outbox[op].approved=true;st.outbox[op].human=d.by||'a person';d.outbound.push(op)}}await saveState()}
  const sent=[];for(const id of d.outbound){sent.push(await deliver(id));await wait(1500)}d.status='sent';d.doneAt=now();release(agent,d.from,'a person sent a draft');await saveState();log('kirimdev '+agent+': draft #'+id+' sent, approved by '+d.by);
  let labels=null;if(d.labels&&!d.labelsSet){labels=await labelContact(agent,{conversationId:d.conversationId,phone:d.from,...d.labels,source:'approved',run:'draft'+d.id}).catch(e=>({set:false,why:e.message}));if(labels.set){d.labelsSet=true;await saveState()}}
  return {sent:sent.filter(Boolean).length,...(labels?{labels}:{})}}
 // A message a PERSON wrote in the team's topic, handed over by the engine's gateway hook (engine/hooks/aqeelos-team) with the sender's
 // Telegram id. Checked here in code: it is the line's own team group, the sender is on the line's approvers list
 // (lines.<agent>.approvers: [{who, telegramId}]), and the text is exactly an approval for one waiting draft. Anything else changes nothing.
 async function teamMessage(agent,{chatId,threadId,userId,text}={}){await state();const line=await lineOf(agent);if(!line)return {handled:false,why:'no line'};
  const t=await target(agent);if(!t||String(t.chatId)!==String(chatId))return {handled:false,why:'not the team group'};
  if(t.threadId&&threadId&&String(t.threadId)!==String(threadId))return {handled:false,why:'not the Questions topic'};
  const waiting=Object.values(st.drafts).filter(d=>d.agent===agent&&d.status==='waiting');if(!waiting.length)return {handled:false,why:'no draft is waiting'};
  const a=parseApproval(text);if(!a)return {handled:false,why:'not an approval'};
  const ap=(line.approvers||[]).find(x=>String(x?.telegramId||'')===String(userId||'')&&String(userId||''));
  const say=m=>telegram(agent,t.chatId,t.threadId,m).catch(()=>false);
  if(!ap){log('kirimdev '+agent+': an approval in the team topic from someone who is not on the approvers list; nothing sent');await say('✋ Not sent: this Telegram account is not on '+line.persona+'’s approvers list. An admin adds it on Channels › Kirimdev, or approves the draft there.');return {handled:false,why:'not an approver'}}
  const d=a.id?waiting.find(x=>x.id===a.id):waiting.length===1?waiting[0]:null;
  if(!d){await say(a.id?'✋ There is no waiting draft #'+a.id+'.':'✋ '+waiting.length+' drafts are waiting ('+waiting.map(x=>'#'+x.id).join(', ')+'): say which, like "ok #'+waiting[0].id+'".');return {handled:false,why:'which draft'}}
  if(a.cut){await say('✋ Draft #'+d.id+' not sent: your text is too long to be checked here. Send it from the Channels page.');return {handled:false,why:'too long'}}
  const by=(ap.who||'a team member')+' (Telegram '+userId+')';
  try{const r=await draft(agent,d.id,a.action==='discard'?'discard':'send',a.action==='text'?a.text:'',by,{human:true,via:'telegram',userId:String(userId)});
   await say(r.dropped?'🗑 Draft #'+d.id+' dropped by '+(ap.who||'the team')+'. Nothing was sent.':'✅ Draft #'+d.id+' sent to the customer ('+r.sent+' message'+(r.sent===1?'':'s')+'), approved by '+(ap.who||'the team')+'.');return {handled:true,draft:d.id,...r}}
  catch(e){await say('⚠️ Draft #'+d.id+' was not sent: '+e.message);return {handled:false,why:e.message,draft:d.id}}}
 // one part: text, or a picture from the agent's media/staff (urls.txt for [FOTO], templates.json for [TEMPLATE])
 // a document (the member's protocol PDF) to the chat's own number: same rules as a reply (24 hours, Test only testers); Draft lines never send by themselves (12 Nov 2026, issue i19b649d9). link: a public https link, which Kirimdev's document message needs (never bytes)
 async function sendDocument(agent,to,{link,filename,caption}={}){const line=await lineOf(agent);if(!line)throw Error('This agent has no Kirimdev line.');await state();
  const num=String(to||'').replace(/\D/g,'');if(!num||!within24h(agent,num))throw Error('That number has not written to this Kirimdev line in the last 24 hours, so WhatsApp does not allow a file.');
  if(modeOf(line)==='draft')throw Error('This line is in Draft: the team sends files.');
  if(modeOf(line)==='test'&&!testerNow(agent,line,num))throw Error('This line is in Test, so it only answers its testers.');
  if(!/^https:\/\//.test(String(link||'')))throw Error('The file needs a public https link.');
  const id=randomUUID();st.outbox[id]={id,agent,pid:String(line.phoneNumberId),to:num,body:{messaging_product:'whatsapp',recipient_type:'individual',to:num,type:'document',document:{link,filename:String(filename||'file.pdf').slice(0,200),...(caption?{caption:String(caption).slice(0,1024)}:{})}},at:now(),status:'pending'};await saveState();
  return deliver(id)}
 async function send(agent,line,to,part){const id=await prepare(agent,line,to,part);await saveState();return deliver(id)}
 async function prepare(agent,line,to,part){await state();const base={messaging_product:'whatsapp',recipient_type:'individual',to};let body;
  const tm=/^\[TEMPLATE:\s*([\w-]+)\s*\]$/.exec(part),fm=/^\[FOTO:\s*(?:media\/staff\/)?([^\]|]+?)\s*(?:\|\s*([\s\S]*?)\s*)?\]$/.exec(part);
  if(tm){const tp=(await readJson(path.join(WORK,agent,'media','staff','templates.json'),{}))[tm[1]];if(!tp){log('kirimdev '+agent+': no picture for template '+tm[1]);return null}body={...base,type:'image',image:tp}}
  const vm=/^\[VIDEO:\s*(?:media\/staff\/)?([^\]|]+?)\s*(?:\|\s*([^\]]*?)\s*)?\]$/.exec(part);
  if(tm){}else if(fm||vm){const name=(fm||vm)[1].trim(),own=mediaLink?await Promise.resolve(mediaLink(agent,name)).catch(()=>null):null,urls=((own?own+'\n':'')+(await readFile(path.join(WORK,agent,'media','staff','urls.txt'),'utf8').catch(()=>''))).split(/\s+/).filter(Boolean);
   // [VIDEO: name] may omit the extension; any .mp4/.mov file is sent as a video, never as a picture
   const u=(own&&/^https:\/\//.test(own)?own:null)||urls.find(x=>x.split('/').pop()===name)||urls.find(x=>decodeURIComponent(x.split('?')[0].split('/').pop())===name)||(vm&&urls.find(x=>/\.(mp4|mov)$/i.test(x.split('?')[0])&&decodeURIComponent(x.split('?')[0].split('/').pop()).replace(/\.(mp4|mov)$/i,'')===name));
   if(!u){log('kirimdev '+agent+': no '+(vm?'video':'picture')+' called '+name+' in media/staff/urls.txt; tag dropped');return null}
   if(vm||/\.(mp4|mov)$/i.test(u.split('?')[0])){const cap=vm?.[2]?.trim();body={...base,type:'video',video:{link:u,...(cap?{caption:cap.slice(0,1024)}:{})}}}
   // the "f=/<name>" marker only lets urls.txt match the tag; WhatsApp gets the provider's own link (if734729a)
   else{const link=u.replace(/([?&])f=\/[^&#]*(&|$)/,(m,a,b)=>b?a:'').replace(/[?&]$/,'');if(link!==u)log('kirimdev '+agent+': picture '+name+' sent as its plain link');const cap=fm?.[2]?.trim();body={...base,type:'image',image:{link,...(cap?{caption:cap.slice(0,1024)}:{})}}}}
  else{const text=part.replace(FOOTER,'').trim().slice(0,4096);if(!text)return null;body={...base,type:'text',text:{body:text,preview_url:false}}}
  const id=randomUUID();st.outbox[id]={id,agent,pid:String(line.phoneNumberId),to,body,at:now(),status:'pending'};return id}
 // what this chat itself holds: the exit guard lets a number, name or address through only when it is the customer's own (audit C1)
 const ownCache=new Map();
 async function ownText(agent,line,num){const k=agent+'|'+num,c=ownCache.get(k);if(c&&now()-c.at<20e3)return c.t;const conv=st.known[k]?.conv;let t='';
  if(conv){try{t=((await api(line.phoneNumberId+'/messages?'+new URLSearchParams({conversation_id:conv,limit:'60'}))).data||[]).map(m=>String(m.content||'')).join('\n')}catch(e){log('kirimdev '+agent+': the chat\'s own text could not be read for the exit guard ('+e.message+'); it checks without')}}
  for(const p of Object.values(st.pending))if(p.agent===agent&&p.from===num)t+='\n'+(p.messages||[]).join('\n');
  ownCache.set(k,{at:now(),t});if(ownCache.size>300)ownCache.delete(ownCache.keys().next().value);return t}
 const secretList=async agent=>[await apiKey().catch(()=>null),...await secretsOf(agent).catch(()=>[])].filter(Boolean);
 // settings a line may add (kirimdev.json lines.<agent>.guard): allow [phrases that are fine, e.g. the shop's own address], phones [the team's
 // own numbers customers may be given], names [people customers may be told about], blockedHosts [more internal sites]
 async function guardCtx(agent,line,num,{hist=null}={}){const g=line.guard||{},kn=st.known[agent+'|'+num]||{};
  return {appHost:pub(),blockedHosts:g.blockedHosts||[],allow:g.allow||[],secrets:await secretList(agent),
   own:{phones:[num,line.phone,...(g.phones||[])].filter(Boolean),names:[kn.name,line.persona,line.business,...(g.names||[])].filter(Boolean),text:(hist||'')+'\n'+await ownText(agent,line,num)+'\n'+(g.allow||[]).join('\n')}}}
 // Persist intent before I/O; never replay beyond the provider's bounded idempotency cache.
 function cancelOutbound(agent,to){for(const o of Object.values(st.outbox))if(o.agent===agent&&o.to===to&&!o.receipt)o.status='cancelled'}
 const delivering=new Map();
 async function deliver(id){if(!id)return null;if(delivering.has(id))return delivering.get(id);
  const task=(async()=>{const o=st.outbox[id];if(!o)throw Error('Missing outbound operation');if(o.receipt?.id)return o.receipt;if(o.status==='cancelled'||o.status==='held')throw Error('Outbound '+o.status);
   const line=await lineOf(o.agent);
   if(!line||String(line.phoneNumberId)!==o.pid||!within24h(o.agent,o.to)||pausedUntil(o.agent,'',o.to)>now()||modeOf(line)==='draft'&&!o.approved||modeOf(line)==='test'&&!testerNow(o.agent,line,o.to))throw Error('Outbound held by current line policy');
   if(o.firstAttempt&&now()-o.firstAttempt>=23*3600e3){o.status='held';await saveState();await tell('Kirimdev line: a send needs checking by hand',o.agent+': ambiguous send older than safe replay window; not resent').catch(()=>{});throw Error('Outbound ambiguous beyond safe idempotency window; reconcile manually')}
   // the single place a customer's message leaves: whatever path made it (a reply, whatsapp_reply, a handoff or wait text, a document
   // caption), kirim-guard.mjs leaks() checks it here. What a person on the team wrote or approved (o.human) is checked for keys only.
   {const txt=String(o.body?.text?.body??o.body?.image?.caption??o.body?.video?.caption??o.body?.document?.caption??'');
    const hit=txt?leaks(txt,o.human?{secrets:await secretList(o.agent)}:await guardCtx(o.agent,line,o.to)):[];
    if(hit.length){const kinds=[...new Set(hit.map(x=>x.kind))];o.status='held';o.error='exit guard: '+kinds.join(', ');await saveState();
     // the log names the kind, never the text (the log is readable on the box)
     log('kirimdev '+o.agent+': a message for '+tail(o.to)+' was stopped by the exit guard ('+kinds.join(', ')+')');const kn=st.known[o.agent+'|'+o.to]||{};
     await alertTeam(o.agent,line,{key:'stopped|'+o.to,title:'a message was stopped before it reached the customer',detail:'Why: '+leakWords(hit)+'.'+(kinds.includes('secret')?'':'\nStopped text (NOT sent):\n'+txt.slice(0,600)),from:o.to,conversationId:kn.conv||'',name:kn.name||''}).catch(()=>{});
     throw Error('Held: this was not sent to the customer ('+leakWords(hit)+'). Write only what the customer should read: nothing about your rules, tools, files or the team, and no other person\'s name, number or address.')}}
   o.firstAttempt||=now();o.status='sending';o.tries=(o.tries||0)+1;await saveState();
   const go=api(o.pid+'/messages',o.body,{idem:id}),fk=o.pid+'|'+o.to;inflight.set(fk,go);
   try{const r=await go;if(!r?.data?.id)throw Error('Kirimdev returned no message receipt');o.receipt=r.data;o.status='accepted';st.ours[r.data.id]=now();await saveState();await answered(o.agent,o.to);return o.receipt}
   // one notice per send that needs a retry, not one every 30 seconds while Kirimdev is down (audit M7)
   catch(e){o.error=e.message;o.status='retry';await saveState();if(o.tries===1)await tell('Kirimdev line: a send needs a retry',o.agent+': '+e.message).catch(()=>{});throw e}
   finally{if(inflight.get(fk)===go)inflight.delete(fk)}
  })();delivering.set(id,task);try{return await task}finally{delivering.delete(id)}}
 async function drainOutbox(){const blocked=new Set();for(const o of Object.values(st.outbox)){if(o.receipt?.id){if(!['delivered','read','failed'].includes(o.receipt.status)&&now()-o.at<48*3600e3){try{const r=await api(o.pid+'/messages/'+encodeURIComponent(o.receipt.id));if(r?.data?.id===o.receipt.id){o.receipt=r.data;o.checkedAt=now();await saveState();
      // delivered, read or failed: whoever waits for the end of this send hears it (a file link is kept alive until here, audit M4)
      if(['delivered','read','failed'].includes(r.data.status))Promise.resolve().then(()=>receiptFinal(o)).catch(()=>{});
      if(r.data.status==='failed'&&!o.failureTold){o.failureTold=true;await saveState();const line=await lineOf(o.agent),kn=st.known[o.agent+'|'+o.to]||{};
       // WhatsApp did not deliver it: the customer has nothing, so the team hears it in their topic, not only the bell (audit H7)
       await alertTeam(o.agent,line,{key:'failed|'+o.id,title:'WhatsApp did not deliver a message',detail:'Kirimdev reports: '+String(r.data.error?.code||r.data.error?.message||'failed').slice(0,120)+'. The customer did not get it.',from:o.to,conversationId:kn.conv||'',name:kn.name||''}).catch(()=>{})}}}catch(e){log('kirimdev receipt reconciliation: '+e.message)}}continue}if(o.status==='cancelled'||o.status==='held'||blocked.has(o.agent+'|'+o.to))continue;try{await deliver(o.id)}catch{blocked.add(o.agent+'|'+o.to)}}}
 // a handoff counts as answered once anything else reaches that customer on this line
 async function answered(agent,to){await state();for(const k of ['stopped|'+to])if(st.alerts[agent+'|'+k]){delete st.alerts[agent+'|'+k];await solved?.(agent,'customer|'+k).catch(()=>{})}for(const [id,a] of Object.entries(st.asked||{}))if(a.agent===agent&&a.from===String(to)&&now()-a.at>5000){delete st.asked[id];if(a.told)await solved?.(agent,'unanswered|'+id).catch(()=>{})}}

 // the agent's whatsapp_reply tool: only to someone who wrote to its own line in the last 24 hours (a tester in Test). Never in Draft
 // (audit H5): there only a person sends. The same text is not sent twice within 10 minutes (audit M5: a turn run again after a restart).
 async function reply(agent,to,text){const line=await lineOf(agent);if(!line)throw Error('This agent has no Kirimdev line.');
  const num=String(to||'').replace(/\D/g,'');await state();
  if(modeOf(line)==='draft')throw Error('This line is in Draft: only a person on the team sends messages to customers (they approve your DRAFT posts, or write in Kirimdev). Nothing was sent.');
  if(num&&!within24h(agent,num)){const other=Object.keys(st.recent).find(k=>k.endsWith('|'+num)&&k.split('|')[0]!==agent&&now()-st.recent[k]<=24*3600e3);
   if(other)throw Error('That number wrote to another Kirimdev line ('+other.split('|')[0]+'), not to yours. Never answer another brand\'s customers; that agent answers them.')}
  if(!num||!within24h(agent,num))throw Error('That number has not written to this Kirimdev line in the last 24 hours, so WhatsApp does not allow a reply. Ask the team to contact them another way.');
  if(modeOf(line)==='test'&&!testerNow(agent,line,num))throw Error('This line is in Test, so it only answers its testers.');
  const parts=splitReply(text);if(!parts.length)throw Error('Write the text to send.');const sent=[];
  const sig=parts.join('\n---\n'),last=st.lastReply[agent+'|'+num];
  if(last&&last.text===sig&&now()-last.at<10*60e3)throw Error('That exact message was already sent to this customer '+Math.max(1,Math.round((now()-last.at)/60e3))+' minute(s) ago. It was not sent again.');
  const ops=[];for(const p of withCaptions(parts)){const id=await prepare(agent,line,num,p);if(id)ops.push(id)}await saveState();
  if(!ops.length)throw Error('Nothing to send: aqeelOS has no picture for those tags.');
  for(const id of ops){sent.push(await deliver(id));await wait(1500)}
  st.lastReply[agent+'|'+num]={text:sig,at:now()};
  // the team's answer relayed from the Questions topic ends the wait after a handoff: the chat is the agent's again
  if(release(agent,num,'the team\'s answer was sent'))for(const [k,p] of Object.entries(st.pending))if(p.agent===agent&&p.from===num){delete st.pending[k];delete st.turns[k];clearTimer(timers.get(k));timers.delete(k)}
  for(const [id,w] of Object.entries(st.waits||{}))if(w.agent===agent&&w.from===num)delete st.waits[id];
  await saveState();return sent.filter(Boolean)}
 // a send aqeelOS did not make itself but knows about (a payment helper that sends its own QR, Test only): while it runs, its echo from
 // Kirimdev waits, and the message ids it reports are ours, so the echo is not taken for a team member's reply (audit H2: 31 of 38 replies dropped)
 async function external(agent,to,promise){const line=await lineOf(agent);if(!line)return promise;await state();const fk=String(line.phoneNumberId)+'|'+String(to||'').replace(/\D/g,'');
  const p=Promise.resolve(promise).then(async r=>{for(const id of r?.ids||[])st.ours[id]=now();if(r?.ids?.length)await saveState();return r});inflight.set(fk,p);
  try{return await p}finally{if(inflight.get(fk)===p)inflight.delete(fk)}}

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
    holds:Object.values(st.holds).filter(h=>h.agent===agent&&h.until>t).map(h=>({who:tail(h.from),since:h.at,until:h.until,wrote:h.n||0})),noReply:{today:st.noreply?.[agent]?.day===new Date(t).toISOString().slice(0,10)?st.noreply[agent].n:0,last:st.noreply?.[agent]?.last||null},modeSet:st.modes[agent]||null,
    delivery:pollsNow(agent,l,sec)?'poll':'webhook',polledAt:st.poll?.[agent]?.at||null,pollError:st.poll?.[agent]?.error||null,
    settings:{persona:l.persona||'',business:l.business||'',language:l.language||'',pauseMin:Number(l.pauseMin??DEFAULT_PAUSE),resetWords:l.resetWords||['reset'],resetText:l.resetText||'',
     testers:(l.testers||[]).map(t=>({who:t.who||'',phone:String(t.phone||''),chat:!!t.conversationId})),payment:l.payment||null,orders:l.orders||null,labels:l.labels?.allowed||[],approvers:(l.approvers||[]).map(a=>({who:a.who||'',telegramId:String(a.telegramId||'')}))}}}))}
 // a mode change is always a person's, on the page: written down with who and when, shown in the bell, logged (audit M6)
 async function setMode(agent,mode,by=''){if(!MODES.includes(mode))throw Error('Mode is test, draft or live.');const c=await readJson(CONF,{lines:{}});if(!c.lines?.[agent])throw Error('No line for '+agent+'.');await state();
  const was=st.modes[agent]?.mode||c.lines[agent].mode||'test';c.lines[agent].mode=mode;await put(CONF,c,0o644);st.modes[agent]={mode,at:now(),by:String(by||'an admin'),was};await saveState();
  log('kirimdev '+agent+': mode '+was+' → '+mode+' by '+(by||'an admin'));
  await activity(agent,(c.lines[agent].persona||agent)+'’s Kirimdev line is now '+mode[0].toUpperCase()+mode.slice(1),'Was '+was+'. Changed by '+(by||'an admin')+'. '+(mode==='live'?'It answers every customer by itself.':mode==='draft'?'It writes replies; a person approves each one.':'It answers only its testers.')).catch(()=>{});
  await solved?.(agent,'kirimdev|mode').catch(()=>{});return true}
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
    if(!who)throw Error('Give each tester a name.');
    // a tester known by their chat only (no number, 8 Nov 2026: Aqeel on Randy's and Gilang's lines) stays as they are
    const chat=!phone&&old.find(o=>o.who===who&&!o.phone&&o.conversationId);if(chat)return {who,conversationId:chat.conversationId};if(!/^\d{6,16}$/.test(phone))throw Error('The number for '+who+' is not a phone number (country code first, like 6281234567890).');
    const was=old.find(o=>String(o.phone||'').replace(/\D/g,'')===phone)||old.find(o=>o.who===who&&!o.phone);return {who,phone,...(was?.conversationId?{conversationId:was.conversationId}:{})}}).filter(Boolean)}
  // who may approve drafts from Telegram (audit H5): a name and the person's Telegram user id (a number)
  if('approvers' in b){const A=Array.isArray(b.approvers)?b.approvers:[];if(A.length>20)throw Error('Twenty approvers at most.');
   l.approvers=A.map(a=>{const who=str(a?.who,40),id=String(a?.telegramId??'').trim();if(!who&&!id)return null;if(!/^\d{4,15}$/.test(id))throw Error('The Telegram id of '+(who||'an approver')+' is a number (their user id, not their @name).');return {who:who||id,telegramId:id}}).filter(Boolean);if(!l.approvers.length)delete l.approvers}
  if('resetWords' in b){const W=(Array.isArray(b.resetWords)?b.resetWords:String(b.resetWords||'').split(',')).map(w=>str(w,30)).filter(Boolean).slice(0,5);l.resetWords=W.length?W:['reset']}
  if('resetText' in b){const v=str(b.resetText,300);if(v)l.resetText=v;else delete l.resetText}
  if('payment' in b){const p=b.payment;if(!p||p.helper==null&&!p.card&&!p.currency&&!p.min&&!p.max)delete l.payment;else{const o={};
    if(p.helper?.path){const hp=str(p.helper.path,120);if(!/^[\w.\/-]+$/.test(hp)||hp.split('/').includes('..')||hp.startsWith('/'))throw Error('The payment helper is a file in the agent’s folder, like .tools/qris.');o.helper={path:hp,style:p.helper.style==='send'?'send':'picture'}}
    // the card helper: a file in the agent's folder; empty = Automatic (.tools/card); a save that does not mention it keeps it
    const card='card' in p?str(p.card,120):str(cur?.payment?.card,120);if(card){if(!/^[\w.\/-]+$/.test(card)||card.split('/').includes('..')||card.startsWith('/'))throw Error('The card helper is a file in the agent’s folder, like .tools/card.');o.card=card}
    if(p.currency)o.currency=str(p.currency,6);for(const k of ['min','max'])if(p[k]!==''&&p[k]!=null){const n=Number(p[k]);if(!Number.isInteger(n)||n<0)throw Error('Payment amounts are whole numbers.');o[k]=n}
    if(o.min!=null&&o.max!=null&&o.min>o.max)throw Error('The lowest payment is above the highest.');
    for(const k of ['testAmount','orderContext'])if(cur?.payment?.[k]!=null)o[k]=cur.payment[k];   // set in kirimdev.json; the page's save keeps them
    // the highest card link: empty = the default (customer-tools.mjs); a save that does not mention it keeps it
    const cm='cardMax' in p?p.cardMax:cur?.payment?.cardMax;if(cm!==''&&cm!=null){const n=Number(cm);if(!Number.isInteger(n)||n<=0)throw Error('The highest card amount is a whole number.');if(o.min!=null&&n<o.min)throw Error('The highest card amount is below the lowest payment.');o.cardMax=n}
    // the highest virtual account, one VA for the whole total: same rules
    const vm='vaMax' in p?p.vaMax:cur?.payment?.vaMax;if(vm!==''&&vm!=null){const n=Number(vm);if(!Number.isInteger(n)||n<=0)throw Error('The highest VA amount is a whole number.');if(o.min!=null&&n<o.min)throw Error('The highest VA amount is below the lowest payment.');o.vaMax=n}
    l.payment=o}}
  // where paid orders are posted (paid-labels.mjs): the team group's id and its Orders topic; both empty = not posted
  if('orders' in b){const c=String(b.orders?.chatId??'').trim(),t=String(b.orders?.threadId??'').trim();if(!c&&!t)delete l.orders;else{if(!/^-?\d{5,20}$/.test(c))throw Error('The Orders group is a Telegram chat id, like -1001234567890.');if(t&&!/^\d{1,10}$/.test(t))throw Error('The Orders topic is a number, the last part of the topic\u2019s link.');l.orders={chatId:Number(c),...(t?{threadId:Number(t)}:{})}}}
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
  const mode=modeOf(line),tester=testerNow(agent,line,phone,conversationId),who=phone?tail(phone):conversationId;
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
  await state();if(st.poll)delete st.poll[agent];delete st.modes[agent];const h=st.health?.lines?.[agent];for(const k of Object.keys(h?.told||{}))await solved(agent,k).catch(()=>{});if(st.health?.lines)delete st.health.lines[agent];
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
 // a run's query file (the whole prompt: the conversation and the run key) is deleted when the run ends; one left by a killed run is
 // removed here once it is 15 minutes old (audit M3: about 30 were left since 7 Nov)
 async function sweepQueries(){let n=0;for(const f of await readdir(DATA).catch(()=>[])){if(!/^kirimdev-(query|q)-[\w-]+\.txt$/.test(f)&&!/^kirimdev-state\.json\.\d+\.[\w-]+\.tmp$/.test(f))continue;const p=path.join(DATA,f),s=await stat(p).catch(()=>null);if(s&&now()-s.mtimeMs>15*60e3){await unlink(p).catch(()=>{});n++}}
  if(n)log('kirimdev: removed '+n+' left-over run file(s)');return n}
 async function resume(){await state();for(const [k,p] of Object.entries(st.pending)){const l=await lineOf(p.agent);if(l)schedule(k,l)}
  await sweepQueries().catch(e=>log('kirimdev sweep: '+e.message));
  if(!iv){iv=setInterval(()=>tick().catch(e=>log('kirimdev retry: '+e.message)),30000);iv.unref?.()}
  // the Kirimdev API check: a minute after start, then every 10 minutes
  if(!piv){piv=setInterval(()=>poll().catch(e=>log('kirimdev poll: '+e.message)),pollEvery);piv.unref?.()}
  await fixQuiet().catch(e=>log('kirimdev quiet time: '+e.message));
  if(!civ){civ=setInterval(()=>check().catch(e=>log('kirimdev check: '+e.message)),checkEvery);civ.unref?.();setTimer(()=>check().catch(e=>log('kirimdev check: '+e.message)),60e3)?.unref?.()}
  for(const a of Object.keys(await lines()))await ensureEvents(a).catch(e=>log('kirimdev '+a+': could not add message.sent to the webhook: '+e.message))}
 return {msgText,teamPost:telegram,receive,reply,teamMessage,external,alertTeam,sweepQueries,release:async(agent,num,by='')=>{await state();const r=release(agent,String(num||'').replace(/\D/g,''),'released by '+(by||'an admin'));if(r){for(const [k,p] of Object.entries(st.pending))if(p.agent===agent&&p.from===String(num).replace(/\D/g,''))schedule(k,{debounceSec:5});await saveState()}return r},sendDocument,deliveryCheck,draft,labelContact,labelList,connect,webhook,ensureEvents,status,check,health,setKey,numbers,saveLine,connectWebhook,disconnect,renewSecret,testSend,poll,fixQuiet,account:async()=>{await state();return health().account},setMode,setPause,resume,lines,_api:api,_tick:tick,_state:state}}
