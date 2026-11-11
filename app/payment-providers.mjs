// Payments made by aqeelOS itself (audit 12 Nov 2026, H2 + H3). Until now create_payment ran a script in the agent's folder
// (.tools/qris, .tools/pay, .tools/card) that read the provider keys there. Two things followed: the keys were in the agent's reach,
// and Biomarkers' script sent the QR to the customer by itself, past deliver() and the mode rules (31 of 38 replies were then dropped,
// because its echo looked like a team member's reply).
// Here the app calls the provider with keys only it can read (agent-keys.mjs) and returns what the reply needs; the reply, with the QR
// as a [FOTO: …] part, leaves through kirimdev.mjs deliver() like every other message, in every mode.
// Settings, per line (kirimdev.json lines.<agent>.payment.provider):
//   {"tripay": {"merchantCode": "T12345", "refPrefix": "BM", "email": "customer@example.com", "banks": {"BCA": "BCAVA", …}},
//    "xendit": {"duration": 86400}, "tz": {"offset": 7, "label": "WIB"}}
// Tripay: POST /transaction/create, signed with HMAC-SHA256(private key, merchant code + our ref + amount); a QRIS answers qr_url, a
// virtual account pay_code. Xendit: POST /v2/invoices, card only. Same calls and texts as the scripts they replace.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import path from 'node:path';
import {money} from './price-catalog.mjs';

export const TRIPAY='https://tripay.co.id/api',XENDIT='https://api.xendit.co';
const BANKS={BCA:'BCAVA',BNI:'BNIVA',BRI:'BRIVA',MANDIRI:'MANDIRIVA'};
export function createPaymentProviders({DATA,keyOf,fetchFn=(...a)=>fetch(...a),now=()=>Date.now(),log=m=>console.log(m),base=TRIPAY,xendit=XENDIT}){
 const MEDIA=path.join(DATA,'payment-media.json');let media=null,seq=0;
 const loadMedia=async()=>media||=await readFile(MEDIA,'utf8').then(t=>JSON.parse(t),()=>({}));
 const saveMedia=async()=>{const t=now();for(const [k,v] of Object.entries(media))if(t-v.at>48*3600e3)delete media[k];await mkdir(DATA,{recursive:true});const f=MEDIA+'.'+process.pid+'.tmp';await writeFile(f,JSON.stringify(media),{mode:0o600});await rename(f,MEDIA)};
 // the QR pictures made here, by the name the reply's [FOTO: name] carries (kirimdev.mjs prepare asks this before the agent's own urls.txt)
 async function mediaLink(agent,name){const m=(await loadMedia())[String(agent)+'|'+String(name)];return m&&now()-m.at<48*3600e3?m.url:null}
 const tzOf=pr=>({offset:Number(pr?.provider?.tz?.offset??7),label:String(pr?.provider?.tz?.label??'WIB')});
 const clock=(ms,pr,withDay=false)=>{const z=tzOf(pr),d=new Date(ms+z.offset*3600e3),p=n=>String(n).padStart(2,'0');return (withDay?p(d.getUTCDate())+'/'+p(d.getUTCMonth()+1)+' ':'')+p(d.getUTCHours())+'.'+p(d.getUTCMinutes())+' '+z.label};
 // which kinds the app itself can make for this line: the setting is there and the keys are in reach
 async function can(agent,pr,kind){const p=pr?.provider||{};
  if(kind==='card')return !!p.xendit&&!!await keyOf(agent,'XENDIT_SECRET_KEY');
  return !!p.tripay?.merchantCode&&!!await keyOf(agent,'TRIPAY_API_KEY')&&!!await keyOf(agent,'TRIPAY_PRIVATE_KEY')}
 async function tripay(agent,pr,{method,amount,name,phone,i=1}){const t=pr.provider.tripay,key=await keyOf(agent,'TRIPAY_API_KEY'),priv=await keyOf(agent,'TRIPAY_PRIVATE_KEY');
  const ref=String(t.refPrefix||'BM').replace(/[^A-Z]/g,'').slice(0,4)+'-'+Math.floor(now()/1000)+'-'+i,exp=Math.floor(now()/1000)+Math.min(86400,Math.max(600,Number(t.ttl)||3600));
  const local=String(phone||'').replace(/^62/,'0');
  const body={method,merchant_ref:ref,amount,customer_name:name,customer_email:String(t.email||'customer@example.com'),customer_phone:local,order_items:[{sku:'ORDER',name:'Order '+ref,price:amount,quantity:1}],expired_time:exp,
   signature:createHmac('sha256',priv).update(String(t.merchantCode)+ref+String(amount)).digest('hex')};
  const r=await fetchFn(base+'/transaction/create',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','user-agent':'curl/8.5.0'},body:JSON.stringify(body),signal:AbortSignal.timeout(40000)});
  const j=await r.json().catch(()=>({}));if(!r.ok||!j.success||!j.data)throw Error('Tripay did not make the payment ('+r.status+(j.message?': '+String(j.message).slice(0,120):'')+')');
  return {ref,exp:exp*1000,data:j.data}}
 // QRIS: one transaction per amount; each is a picture part for the reply
 async function qris(agent,pr,{amounts,name,phone}){const out=[],refs=[],orders=[];await loadMedia();
  for(const [k,amt] of amounts.entries()){const x=await tripay(agent,pr,{method:'QRIS',amount:amt,name,phone,i:k+1+(seq++%7)*10});
   if(!/^https:\/\//.test(String(x.data.qr_url||'')))throw Error('Tripay gave no QR picture for '+x.ref);
   const file='qris-'+x.ref+'.png';media[agent+'|'+file]={url:x.data.qr_url,at:now()};refs.push(String(x.data.reference||''));orders.push(x.ref);
   out.push('[FOTO: '+file+'] | '+money(amt,pr.currency||'Rp')+' | berlaku sampai '+clock(x.exp,pr))}
  await saveMedia();return {ok:true,out:out.join('\n'),refs:refs.filter(Boolean),orders}}
 // virtual account: the number is text for the reply
 async function va(agent,pr,{bank,amount,name,phone}){const B={...BANKS,...(pr.provider.tripay.banks||{})},code=B[String(bank||'').toUpperCase()];if(!code)return {ok:false,err:'The bank is one of '+Object.keys(B).join(', ')+'.'};
  const x=await tripay(agent,pr,{method:code,amount,name,phone});if(!x.data.pay_code)throw Error('Tripay gave no VA number for '+x.ref);
  return {ok:true,refs:[String(x.data.reference||'')].filter(Boolean),orders:[x.ref],
   out:String(bank).toUpperCase()+' Virtual Account | nomor VA '+x.data.pay_code+' | '+money(x.data.amount||amount,pr.currency||'Rp')+' | berlaku sampai '+clock(x.exp,pr)}}
 // card: a Xendit invoice, card only; the checkout link is text for the reply
 async function card(agent,pr,{amount,name,phone,items=[]}){const key=await keyOf(agent,'XENDIT_SECRET_KEY'),ref='CC-'+Math.floor(now()/1000)+'-1',names=items.filter(Boolean).length?items.filter(Boolean):['Order'];
  const body={external_id:ref,amount,currency:'IDR',payment_methods:['CREDIT_CARD'],invoice_duration:Number(pr.provider.xendit?.duration)||86400,description:'Order '+names.join(', '),customer:{given_names:name,...(phone?{mobile_number:'+'+phone}:{})},items:names.map((n,i)=>({name:n,quantity:1,price:i?0:amount}))};
  const r=await fetchFn(xendit+'/v2/invoices',{method:'POST',headers:{authorization:'Basic '+Buffer.from(key+':').toString('base64'),'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(40000)});
  const j=await r.json().catch(()=>({}));if(!r.ok||!j.invoice_url)throw Error('Xendit did not make the card link ('+r.status+(j.message?': '+String(j.message).slice(0,120):'')+')');
  const exp=Date.parse(j.expiry_date)||now()+86400e3;
  return {ok:true,orders:[ref],invoices:[String(j.id||'')].filter(Boolean),out:j.invoice_url+' | '+money(amount,pr.currency||'Rp')+' | berlaku sampai '+clock(exp,pr,true)}}
 // one door for customer-tools.mjs: {ok, out, err, refs, orders, invoices}; never throws
 async function create(agent,pr,kind,o){try{const r=kind==='card'?await card(agent,pr,o):kind==='va'?await va(agent,pr,o):await qris(agent,pr,o);if(r.ok)log('payments: '+agent+' '+kind+' made by aqeelOS ('+(r.orders||[]).join(' ')+')');return r}
  catch(e){log('payments: '+agent+' '+kind+' failed: '+e.message);return {ok:false,err:e.message}}}
 return {can,create,mediaLink}}
