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
// Paid orders (8 Nov 2026): the same moment a payment is confirmed, its order form is posted once to the line's Orders topic (kirimdev.json
// lines.<agent>.orders), code, no AI. statusFor answers the customer tool check_payment; postOrder is the customer tool post_order.
// Payments labelled before this existed have no order mark and are never posted by themselves.
// Events (12 Nov 2026, event-hooks.mjs): the provider is polled, nothing calls us when a payment succeeds, so this is the moment aqeelOS learns it.
// onEvent(agent,{type,data:{kind}}) is told 'payment.paid' (a payment of the agent's is now confirmed PAID) and 'order.posted' (its order
// form went to the Orders topic, now or on a retry), once the state is saved; never an amount, a name or a number. A failing listener changes nothing.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';

const WINDOW=3*3600e3,CARD_WINDOW=25*3600e3,TRIES=5,NOREF=15*60e3,CARD_SLOW=3600e3,CARD_EVERY=10*60e3;
export const TRIPAY='https://tripay.co.id/api',XENDIT='https://api.xendit.co';
const HEX=/^[0-9a-f]{24}$/;

// Details a line wants on every paid order besides the form (kirimdev.json lines.<agent>.payment.orderContext: {title, missing, fields:[{key,label,ask}]}).
// None by default; each install sets its own questions and wording.
const RESERVED=new Set(['kind','amounts','bank','name','order_form','order_total','expired','products','run','run_key']);
export function orderContextOf(pr){const c=pr?.orderContext||{};return {title:String(c.title||'Buyer details').slice(0,60),missing:String(c.missing||'not asked').slice(0,40),
 fields:(Array.isArray(c.fields)?c.fields:[]).filter(f=>/^[a-z][a-z0-9_]{0,30}$/.test(String(f?.key||''))&&!RESERVED.has(f.key)&&f.label).slice(0,6).map(f=>({key:f.key,label:String(f.label).slice(0,60),ask:String(f.ask||f.label).slice(0,300)}))}}

export function createPaidLabels({DATA,WORK,label,orders=async()=>null,post=async()=>false,failed=async()=>{},onEvent=()=>{},fetchImpl=fetch,now=()=>Date.now(),log=m=>console.log(m),base=TRIPAY,xendit=XENDIT}){
 const F=path.join(DATA,'paid-labels.json');
 const tell=list=>{for(const k of new Set(list.map(e=>e.agent+'|'+e.type+'|'+e.kind))){const [agent,type,kind]=k.split('|');Promise.resolve().then(()=>onEvent(agent,{type,data:{kind}})).catch(()=>{})}};
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
 // one writer of paid-labels.json at a time: the minute tick and post_order
 let chain=Promise.resolve();const serial=f=>{const x=chain.then(f,f);chain=x.catch(()=>{});return x};
 const money=(n,c)=>(c?c+' ':'')+Number(n).toLocaleString('en-US');
 // the line's own order details (orderContextOf): from post_order, else from the payment; rows logged before the setting keep them at the top level
 const contextOf=t=>orderContextOf({orderContext:t?.context}),filled=(c,o)=>{const s=o?.context||o||{};return Object.fromEntries(c.fields.map(f=>[f.key,String(s[f.key]||'').trim()]))};
 const buyerContext=(c,v)=>'*'+c.title+'*\n'+c.fields.map(f=>'- '+f.label+': '+(v[f.key]||c.missing)).join('\n');
 const orderText=(p,refs,form,t,ctx)=>(p.mode==='test'?'🧪 TEST ':'')+'🧾 PAID ORDER ('+t.persona+', '+(p.name||'customer')+', +'+p.phone+')\n'+money(p.total,t.currency)+', '+String(p.kind||'qris').toUpperCase()+(refs.length?', ref '+refs.join(' '):'')+((p.products||[]).length?'\nProducts: '+p.products.join(', '):'')+'\n\n'+(form||p.form||'The order form was not recorded with this payment; it is in the customer\'s chat.')+(contextOf(t).fields.length?'\n\n'+buyerContext(contextOf(t),filled(contextOf(t),ctx||p)):'');
 async function sendOrder(p,refs,form,prev={tries:0},ctx=null){const t=await orders(p.agent).catch(()=>null);if(!t?.chatId)return {state:'none'};
  const mid=await post(p.agent,t,orderText(p,refs,form,t,ctx)).catch(()=>false);if(mid){log('paid orders: '+p.agent+' order of '+p.total+' posted');
   const c=contextOf(t),v=filled(c,ctx||p),gap=c.fields.filter(f=>!v[f.key]);if(gap.length)await failed(p.agent,'order-context|'+p.at,'A paid order went to the Orders topic without buyer context','Order of '+money(p.total,t.currency)+' from +'+p.phone+': '+gap.map(f=>f.label).join(' and ')+' not asked. Ask the customer and send it to the team, then always pass them to create_payment.').catch(()=>{});
   return {state:'posted',at:now()}}
  const tries=(prev.tries||0)+1;log('paid orders: '+p.agent+' could not post an order (try '+tries+')');
  if(tries>=TRIES){await failed(p.agent,'paid-order|'+p.at,'A paid order could not be posted to the Orders topic','Payment of '+money(p.total,t.currency)+' from +'+p.phone+'. Check that the agent\'s bot is in the Orders group and may post in that topic.').catch(()=>{});return {state:'gave-up',tries}}
  return {state:'failed',tries}}
 // the provider's answer for each part of a payment, as one word
 const overall=s=>!s.length?'UNKNOWN':s.every(x=>x==='PAID')?'PAID':s.some(x=>x==='PAID')?'PARTLY_PAID':s.some(x=>x==='UNPAID')?'UNPAID':s[0];
 const paymentsOf=async(agent,phone,limit)=>{const ph=String(phone||'').replace(/\D/g,''),t=now();return (await lines(path.join(DATA,'payments.jsonl'))).filter(p=>p.agent===agent&&p.phone===ph&&p.ok&&t-Date.parse(p.at)<7*86400e3).slice(-limit).reverse()};
 const look=async p=>{const card=p.kind==='card',refs=card?await invoices(p.agent,p):await references(p.agent,p);return {refs,states:await Promise.all(refs.map(r=>(card?cardStatus:status)(p.agent,r)))}};
 async function statusFor(agent,phone,scope=null){return serial(async()=>{
  let mine=await paymentsOf(agent,phone,Number.MAX_SAFE_INTEGER);const db=await readJson(F,{done:{}});db.confirmed||={};
  if(scope){
   if(!scope.conversation||!scope.line||!scope.run)return [];
   mine=mine.filter(p=>p.conversation===scope.conversation&&String(p.line)===String(scope.line)&&(!scope.since||Date.parse(p.at)>=Date.parse(scope.since))).slice(0,1);
   mine=mine.filter(p=>!db.confirmed[p.agent+'|'+p.at+'|'+p.total]||db.confirmed[p.agent+'|'+p.at+'|'+p.total]===scope.run);
  }else mine=mine.slice(0,3);
  let changed=false;const result=[];
  for(const p of mine){let st='CHECK_FAILED';try{st=overall((await look(p)).states)}catch(e){log('paid check: '+agent+' '+e.message)}
   if(scope&&st==='PAID'){db.confirmed[p.agent+'|'+p.at+'|'+p.total]=scope.run;changed=true}
   result.push({at:p.at,kind:p.kind||'qris',total:p.total,status:st,...(p.testAmount?{testAmount:true,orderTotal:p.orderTotal}:{})});
  }
  if(changed)await put(db);return result;
 })}
 // post_order: the newest paid payment of this customer that has no post yet
 const postOrder=(agent,phone,form,ctx=null)=>serial(async()=>{const mine=await paymentsOf(agent,phone,3);if(!mine.length)return {posted:false,why:'No payment was made through you for this customer.'};
  const db=await readJson(F,{done:{}});db.done||={};let seen=false;
  for(const p of mine){let x;try{x=await look(p)}catch(e){log('paid check: '+agent+' '+e.message);continue}if(overall(x.states)!=='PAID')continue;
   const key=p.agent+'|'+p.at+'|'+p.total,d=db.done[key]||{tries:0};if(d.order?.state==='posted'){seen=true;continue}
   const o=await sendOrder(p,x.refs,form,d.order,ctx);if(o.state==='none')return {posted:false,why:'No Orders topic is set for this line.'};db.done[key]={...d,order:o};await put(db);if(o.state==='posted')tell([{agent:p.agent,type:'order.posted',kind:p.kind||'qris'}]);
   return o.state==='posted'?{posted:true}:{posted:false,why:'Telegram did not take the post. Tell the team.'}}
  return seen?{posted:false,already:true,why:'This order is already in the Orders topic.'}:{posted:false,why:'No payment of this customer is PAID yet.'}});
 let running=false;
 async function tick(){if(running)return {skipped:true};running=true;return serial(async()=>{try{
  const db=await readJson(F,{done:{}});db.done||={};let changed=false;const t=now(),res=[],evs=[];
  for(const p of await lines(path.join(DATA,'payments.jsonl'))){
   const at=Date.parse(p.at),key=p.agent+'|'+p.at+'|'+p.total;
   const card=p.kind==='card';
   // a paid order whose post did not go through: tried again each minute, a few times
   if(db.done[key]?.order?.state==='failed'&&p.ok){db.done[key].order=await sendOrder(p,db.done[key].refs||[],'',db.done[key].order);changed=true;if(db.done[key].order.state==='posted')evs.push({agent:p.agent,type:'order.posted',kind:p.kind||'qris'});if(db.done[key].state)continue}
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
   // the order goes to the team whatever happens with the labels, and only once
   if(!d.paid){d.paid=true;evs.push({agent:p.agent,type:'payment.paid',kind:p.kind||'qris'})}
   if(!d.order){d.order=await sendOrder(p,refs,'');d.refs=refs;changed=true;if(d.order.state==='posted')evs.push({agent:p.agent,type:'order.posted',kind:p.kind||'qris'})}
   try{const r=await label(p.agent,{conversationId:p.conversation,phone:p.phone,add:['Customer',...(p.products||[])],remove:['Checkout'],source:'payment',run:p.run||'pay'});
    db.done[key]={state:'labelled',at:t,refs,changed:r?.changed||[],...(r?.set===false?{why:r.why}:{}),order:d.order};res.push({agent:p.agent,total:p.total,...r})}
   catch(e){d.tries++;d.error=e.message;db.done[key]=d.tries>=TRIES?{state:'closed',why:'labels failed: '+e.message,at:t,order:d.order,refs}:d;log('paid labels: '+p.agent+' labelling failed (try '+d.tries+'): '+e.message)}
   changed=true}
  for(const [k,v] of Object.entries(db.done))if(t-(v.at||0)>7*86400e3)delete db.done[k],changed=true;
  if(changed)await put(db);tell(evs);return {labelled:res}}finally{running=false}})}
 return {tick,statusFor,postOrder}}
