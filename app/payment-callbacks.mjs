// Provider "paid" callbacks (12 Nov 2026). aqeelOS used to learn that a payment succeeded only by asking Tripay / Xendit about every recent
// payment once a minute (paid-labels.mjs). Both providers can call us instead; this is the receiving side:
//   POST /hooks/pay/tripay/<agent>   Tripay: header X-Callback-Signature = HMAC-SHA256 (hex) of the RAW body with the merchant PRIVATE key
//                                    (the agent's .secrets/TRIPAY_PRIVATE_KEY), header X-Callback-Event: payment_status. Answer {"success":true}.
//   POST /hooks/pay/xendit/<agent>   Xendit invoice callback: header x-callback-token = the dashboard's "callback verification token"
//                                    (the agent's .secrets/XENDIT_CALLBACK_TOKEN), a fixed token, the body is NOT signed. Answer 200.
// A callback is only a wake-up: nothing in its body is believed. After the check passes, paid-labels.nudge(agent) asks the provider's own API
// about that agent's payments right now, so a forged, replayed or stale body can never mark an order paid. The same state, labels, order post
// and payment.paid event follow as before.
// Once a verified callback has arrived for an agent and provider, paid-labels polls that provider every 10 minutes instead of every minute
// (the slow fallback for a callback the provider never sent). Seen-state: DATA/payment-callbacks.json {seen:{"<agent>|<provider>":{at,n}}}.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHmac,timingSafeEqual} from 'node:crypto';
import path from 'node:path';

export const MAX_BODY=64*1024,ACTIVE_MS=14*86400e3,PROVIDERS=['tripay','xendit'];
const AGENT=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const SECRET={tripay:'TRIPAY_PRIVATE_KEY',xendit:'XENDIT_CALLBACK_TOKEN'};
const same=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)};

export const tripaySignature=(raw,privateKey)=>createHmac('sha256',privateKey).update(Buffer.isBuffer(raw)?raw:Buffer.from(String(raw))).digest('hex');
export function verifyTripay(raw,headers,privateKey){const sig=String(headers['x-callback-signature']||'').trim().toLowerCase();
 if(!privateKey||!/^[0-9a-f]{64}$/.test(sig))return false;const ev=headers['x-callback-event'];if(ev!=null&&String(ev).trim()!=='payment_status')return false;
 return same(sig,tripaySignature(raw,privateKey))}
export function verifyXendit(headers,token){const got=String(headers['x-callback-token']||'');return !!token&&got.length>0&&same(got,token)}

// the address the person pastes into each provider's dashboard
export const callbackPath=(provider,agent)=>'/hooks/pay/'+provider+'/'+agent;

export function createPaymentCallbacks({DATA,WORK,nudge=async()=>{},now=()=>Date.now(),log=m=>console.log(m),readSecret}){
 const F=path.join(DATA,'payment-callbacks.json');let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(F,'utf8'))}catch{db={}}db.seen||={}}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});const t=F+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(db,null,1),{mode:0o600});await rename(t,F)};
 const secret=readSecret||(async(agent,provider)=>(await readFile(path.join(WORK,agent,'.secrets',SECRET[provider]),'utf8').catch(()=>'')).trim());
 // true while a verified callback of this provider arrived for this agent in the last 14 days
 async function active(agent,provider){await load();const s=db.seen[agent+'|'+provider];return !!s&&now()-s.at<ACTIVE_MS}
 async function receive(provider,agent,headers,raw){
  if(!PROVIDERS.includes(provider)||!AGENT.test(String(agent||'')))return {status:404,body:{success:false}};
  if(!Buffer.isBuffer(raw))raw=Buffer.from(String(raw||''));if(raw.length>MAX_BODY)return {status:413,body:{success:false}};
  const key=await secret(agent,provider);
  const ok=provider==='tripay'?verifyTripay(raw,headers,key):verifyXendit(headers,key);
  if(!ok){log('payment callback: '+provider+' for '+agent+' refused (bad signature or no key)');return {status:401,body:{success:false,message:'refused'}}}
  let body={};try{body=JSON.parse(raw.toString('utf8'))}catch{}
  await load();const k=agent+'|'+provider,s=db.seen[k]||{n:0};db.seen[k]={at:now(),n:s.n+1,last:String(body?.status||'').toUpperCase().slice(0,16)};await save().catch(()=>{});
  return {status:200,body:provider==='tripay'?{success:true}:{ok:true},after:()=>nudge(agent)}}
 return {receive,active,view:async()=>({seen:(await load()).seen})}}
