// Labels for a confirmed payment (8 Nov 2026, LABEL_SOP.md: "Customer completes payment: remove Checkout, add Customer;
// payment confirmed: add S-(product)"). Code, no AI: every minute, each payment a customer run made in the last 3 hours
// (DATA/payments.jsonl, written by customer-tools.mjs create_payment) is looked up with the payment provider. Once every
// part of it is PAID, the chat's contact gets Customer plus the order's S- labels and loses Checkout (kirimdev.mjs
// labelContact, source 'payment'). Each payment is done once (DATA/paid-labels.json), so a restart or a second tick never
// labels twice; a Kirimdev error is tried again on the next tick, five times at most.
// Provider: Tripay (the agents' .tools/qris and .tools/pay), its key read from the agent's own .secrets/TRIPAY_API_KEY.
// A QRIS helper prints our order ref (BM-…); the Tripay reference for it is in the agent's tmp/last_qris.json or
// tmp/payments.jsonl, where the helpers write it. Card payments (8 Nov 2026) are Xendit invoices, valid 24 hours: their
// status comes from Xendit with the agent's own .secrets/XENDIT_SECRET_KEY.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';

const WINDOW=3*3600e3,CARD_WINDOW=25*3600e3,TRIES=5,NOREF=15*60e3,CARD_SLOW=3600e3,CARD_EVERY=10*60e3;
export const TRIPAY='https://tripay.co.id/api',XENDIT='https://api.xendit.co';
const HEX=/^[0-9a-f]{24}$/;

export function createPaidLabels({DATA,WORK,label,fetchImpl=fetch,now=()=>Date.now(),log=m=>console.log(m),base=TRIPAY,xendit=XENDIT}){
 const F=path.join(DATA,'paid-labels.json');
 const readJson=async(f,d)=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return d}};
 const put=async v=>{await mkdir(DATA,{recursive:true});const t=F+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(v,null,1),{mode:0o600});await rename(t,F)};
 const lines=async f=>(await readFile(f,'utf8').catch(()=>'')).split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
 // our order refs (BM-…) to Tripay references, from what the agent's helpers wrote down
 async function references(agent,p){const out=new Set(p.refs||[]);if(!(p.orders||[]).length)return [...out];
  const W=path.join(WORK,agent,'tmp'),known=[...await lines(path.join(W,'last_qris.json')),...await lines(path.join(W,'payments.jsonl'))];
  for(const o of p.orders){const k=known.find(x=>x.ref===o&&x.reference);if(k)out.add(String(k.reference))}return [...out]}
 // a card payment's Xendit invoice ids: logged with it, or found from our CC-… ref in tmp/last_card.json
 async function invoices(agent,p){const out=new Set([...(p.invoices||[]),...(p.orders||[]).filter(x=>HEX.test(x))]);if(out.size)return [...out];
  const known=await lines(path.join(WORK,agent,'tmp','last_card.json'));for(const o of p.orders||[]){const k=known.find(x=>x.ref===o&&x.invoice);if(k)out.add(String(k.invoice))}return [...out]}
 async function cardStatus(agent,id){const key=(await readFile(path.join(WORK,agent,'.secrets','XENDIT_SECRET_KEY'),'utf8').catch(()=>'')).trim();if(!key)throw Error('no Xendit key for '+agent);
  const r=await fetchImpl(xendit+'/v2/invoices/'+encodeURIComponent(id),{headers:{authorization:'Basic '+Buffer.from(key+':').toString('base64')},signal:AbortSignal.timeout(30000)});
  const j=await r.json().catch(()=>({}));if(!r.ok||!j.status)throw Error('Xendit '+r.status+' '+String(j.message||'').slice(0,80));const s=String(j.status).toUpperCase();return s==='SETTLED'?'PAID':s==='PENDING'?'UNPAID':s}
 const lastLook=new Map();
 async function status(agent,ref){const key=(await readFile(path.join(WORK,agent,'.secrets','TRIPAY_API_KEY'),'utf8').catch(()=>'')).trim();if(!key)throw Error('no Tripay key for '+agent);
  const r=await fetchImpl(base+'/transaction/detail?'+new URLSearchParams({reference:ref}),{headers:{authorization:'Bearer '+key,'user-agent':'curl/8.5.0'},signal:AbortSignal.timeout(30000)});
  const j=await r.json().catch(()=>({}));if(!r.ok||!j.success)throw Error('Tripay '+r.status+' '+String(j.message||'').slice(0,80));return String(j.data?.status||'').toUpperCase()}
 let running=false;
 async function tick(){if(running)return {skipped:true};running=true;try{
  const db=await readJson(F,{done:{}});db.done||={};let changed=false;const t=now(),res=[];
  for(const p of await lines(path.join(DATA,'payments.jsonl'))){
   const at=Date.parse(p.at),key=p.agent+'|'+p.at+'|'+p.total;
   const card=p.kind==='card';
   if(!p.ok||!p.agent||!p.conversation||!(t-at<(card?CARD_WINDOW:WINDOW))||db.done[key]?.state==='labelled'||db.done[key]?.state==='closed')continue;
   const d=db.done[key]||{tries:0};
   // an old unpaid card link is asked about every 10 minutes, not every minute
   if(card&&t-at>CARD_SLOW&&t-(lastLook.get(key)||0)<CARD_EVERY)continue;if(card)lastLook.set(key,t);
   const refs=card?await invoices(p.agent,p):await references(p.agent,p);
   if(!refs.length){if(t-at>NOREF){db.done[key]={state:'closed',why:'no provider reference',at:t};changed=true;log('paid labels: '+p.agent+' payment of '+p.total+' at '+p.at+' has no provider reference; not followed')}continue}
   let st;try{st=await Promise.all(refs.map(r=>(card?cardStatus:status)(p.agent,r)))}catch(e){log('paid labels: '+p.agent+' '+e.message);continue}
   if(st.some(s=>['EXPIRED','FAILED','REFUND'].includes(s))&&!st.some(s=>s==='UNPAID')){db.done[key]={state:'closed',why:st.join(','),at:t};changed=true;
    if(st.some(s=>s==='PAID'))log('paid labels: '+p.agent+' payment of '+p.total+' only partly paid ('+st.join(', ')+'); no labels, the team checks it');continue}
   if(!st.length||!st.every(s=>s==='PAID'))continue;
   try{const r=await label(p.agent,{conversationId:p.conversation,phone:p.phone,add:['Customer',...(p.products||[])],remove:['Checkout'],source:'payment',run:p.run||'pay'});
    db.done[key]={state:'labelled',at:t,refs,changed:r?.changed||[],...(r?.set===false?{why:r.why}:{})};res.push({agent:p.agent,total:p.total,...r})}
   catch(e){d.tries++;d.error=e.message;db.done[key]=d.tries>=TRIES?{state:'closed',why:'labels failed: '+e.message,at:t}:d;log('paid labels: '+p.agent+' labelling failed (try '+d.tries+'): '+e.message)}
   changed=true}
  for(const [k,v] of Object.entries(db.done))if(t-(v.at||0)>7*86400e3)delete db.done[k],changed=true;
  if(changed)await put(db);return {labelled:res}}finally{running=false}}
 return {tick}}
