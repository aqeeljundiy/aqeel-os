// The member app's protocol PDF (12 Nov 2026, issue i19b649d9): taken into git from the box-only `.tools/protocol --pdf` script
// of the Continue support agent. Same calls, now in aqeelOS: log in to the member app as the line's admin user, find the member
// by THIS chat's own number (never one from the model), refuse when two members share it or none has a protocol, and download
// "all protocols" as one PDF. Setting, per line in kirimdev.json:
//   "protocolPdf": {"baseUrl":"https://member.example.com","email":"admin@example.com","secret":"MEMBER_ADMIN_PASSWORD","lang":"id","filename":"Protocol.pdf","caption":"Ini protokolnya, kak."}
// secret = the name of a file in the agent's .secrets (never the value). Result: {pdf:Buffer, filename, caption} or {none:'why'}.
import {readFile} from 'node:fs/promises';
import path from 'node:path';

export const normPhone=x=>{let d=String(x||'').replace(/\D/g,'');if(d.startsWith('0'))d='62'+d.slice(1);return d};
const UA='Mozilla/5.0 (X11; Linux x86_64) aqeelOS-protocol/1.0';
export function createProtocolPdf({WORK,fetchFn=(...a)=>fetch(...a)}){
 return async function make(agent,phone,cfg){
  if(!cfg?.baseUrl||!cfg?.email||!/^[A-Za-z0-9_]+$/.test(String(cfg.secret||'')))throw Error('The protocol PDF setting of this line is incomplete.');
  const want=normPhone(phone);if(want.length<8)throw Error('This chat has no customer number.');
  const base=String(cfg.baseUrl).replace(/\/+$/,'');if(!/^https:\/\//.test(base))throw Error('The member app address must be https.');
  const pw=(await readFile(path.join(WORK,agent,'.secrets',cfg.secret),'utf8')).trim();let cookie='';
  const call=async(p,body,raw)=>{const r=await fetchFn(base+p,{method:body?'POST':'GET',headers:{'content-type':'application/json',accept:raw?'application/pdf,*/*':'application/json','user-agent':UA,...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60e3)});
   if(!r.ok)throw Error('member app error '+r.status+' on '+p.split('?')[0]);
   if(!cookie){const ck=(typeof r.headers?.getSetCookie==='function'?r.headers.getSetCookie():[r.headers?.get?.('set-cookie')||'']).map(c=>String(c).split(';')[0]).filter(Boolean).join('; ');if(ck)cookie=ck}
   return raw?Buffer.from(await r.arrayBuffer()):r.json()};
  await call('/api/auth/verify-identity',{emailOrPhone:cfg.email,memberCode:pw});
  let list=await call('/api/admin/customers');list=Array.isArray(list)?list:(list?.customers||list?.data||[]);
  const hits=list.filter(c=>c&&[c.phone,c.whatsappNumber].some(x=>normPhone(x)===want));
  if(!hits.length)return {none:'No member in the member app has this chat\'s number.'};
  if(hits.length!==1)return {none:'More than one member has this number.'};
  const id=Number(hits[0].id);if(!Number.isInteger(id))return {none:'The member has no usable id.'};
  const d=await call('/api/admin/customers/'+id);if(!(d?.protocols||[]).length)return {none:'The member has no protocol set yet.'};
  const pdf=await call('/api/protocols/export-all.pdf?customerId='+id+'&lang='+encodeURIComponent(cfg.lang||'id'),null,true);
  if(!pdf.subarray(0,4).equals(Buffer.from('%PDF')))throw Error('the member app did not return a PDF');
  return {pdf,filename:String(cfg.filename||'Protocol.pdf').slice(0,200),caption:cfg.caption?String(cfg.caption).slice(0,1024):''}}}

// the whole send for one chat run: PDF from the member app -> one-purpose link -> Kirimdev document message; the link is dropped
// as soon as Kirimdev has taken it (or failed). Returns {sent:true,filename} or {none:'why'}; throws with the reason otherwise.
export function createProtocolSender({make,docLinks,sendDocument,log=()=>{}}){
 return async function send(agent,{phone,conversation},cfg){
  const m=await make(agent,phone,cfg);if(m.none)return {none:m.none};
  const dl=await docLinks.put({buffer:m.pdf,name:m.filename,agent});
  try{await sendDocument(agent,phone,{link:dl.url,filename:m.filename,caption:m.caption});log('protocol PDF sent for '+agent+' ('+m.pdf.length+' bytes)');return {sent:true,filename:m.filename}}
  finally{await dl.revoke()}}}
