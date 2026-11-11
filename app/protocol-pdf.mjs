// The member app's protocol, as text and as PDF (12 Nov 2026, issue i19b649d9): taken into git from the box-only `.tools/protocol`
// script of the Continue support agent. Same calls, now in aqeelOS: log in to the member app as the line's admin user, find the member
// by THIS chat's own number (never one from the model), refuse when two members share it or none has a protocol, and give the
// protocols as plain text or download "all protocols" as one PDF. Setting, per line in kirimdev.json:
//   "protocolPdf": {"baseUrl":"https://member.continuelife.id","email":"randy@admin.com","secret":"CONTINUE_MEMBER_RANDY_PASSWORD","lang":"id","filename":"Protokol Continue.pdf","caption":"Ini protokolnya, kak."}
// secret = the NAME of a key (agent-keys.mjs: the app's own store, else the agent's .secrets), never the value.
// Audit 12 Nov 2026, H8a: the text script on the box printed EVERY member who shares the number (a couple, a parent and child, each
// saw the other's protocol and dose), while the PDF path refused. One rule now for both, here: exactly one member, or hand off.
// And the member list must be whole: when the member app says there is more than it returned (pages), "exactly one" cannot be checked,
// so nothing is given.
import {readFile} from 'node:fs/promises';
import path from 'node:path';

export const normPhone=x=>{let d=String(x||'').replace(/\D/g,'');if(d.startsWith('0'))d='62'+d.slice(1);return d};
const UA='Mozilla/5.0 (X11; Linux x86_64) aqeelOS-protocol/1.0';
// the member list is whole: no sign that the member app holds more members than it returned
export function listWhole(raw,list){if(Array.isArray(raw))return true;const n=list.length,num=v=>Number.isFinite(Number(v))?Number(v):null;
 const total=num(raw?.total??raw?.totalCount??raw?.count??raw?.meta?.total??raw?.pagination?.total);if(total!=null&&total>n)return false;
 const pages=num(raw?.totalPages??raw?.pages??raw?.meta?.totalPages??raw?.pagination?.totalPages);if(pages!=null&&pages>1)return false;
 return !(raw?.hasMore||raw?.has_more||raw?.nextCursor||raw?.next_cursor||raw?.nextPage||raw?.next||raw?.pagination?.next||raw?.meta?.next)}
export function createProtocolPdf({WORK,keyOf=null,fetchFn=(...a)=>fetch(...a)}){
 const secret=async(agent,name)=>keyOf?await keyOf(agent,name):(await readFile(path.join(WORK,agent,'.secrets',name),'utf8')).trim();
 // the one member who has this chat's number: {none:'why'} or {id, detail, call}
 async function member(agent,phone,cfg){
  if(!cfg?.baseUrl||!cfg?.email||!/^[A-Za-z0-9_]+$/.test(String(cfg.secret||'')))throw Error('The protocol setting of this line is incomplete.');
  const want=normPhone(phone);if(want.length<8)throw Error('This chat has no customer number.');
  const base=String(cfg.baseUrl).replace(/\/+$/,'');if(!/^https:\/\//.test(base))throw Error('The member app address must be https.');
  const pw=await secret(agent,cfg.secret);if(!pw)throw Error('The member app password is not saved for this line.');let cookie='';
  const call=async(p,body,raw)=>{const r=await fetchFn(base+p,{method:body?'POST':'GET',headers:{'content-type':'application/json',accept:raw?'application/pdf,*/*':'application/json','user-agent':UA,...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60e3)});
   if(!r.ok)throw Error('member app error '+r.status+' on '+p.split('?')[0]);
   if(!cookie){const ck=(typeof r.headers?.getSetCookie==='function'?r.headers.getSetCookie():[r.headers?.get?.('set-cookie')||'']).map(c=>String(c).split(';')[0]).filter(Boolean).join('; ');if(ck)cookie=ck}
   return raw?Buffer.from(await r.arrayBuffer()):r.json()};
  await call('/api/auth/verify-identity',{emailOrPhone:cfg.email,memberCode:pw});
  const raw=await call('/api/admin/customers'),list=Array.isArray(raw)?raw:(raw?.customers||raw?.data||[]);
  if(!Array.isArray(list))return {none:'The member app gave no member list.'};
  if(!listWhole(raw,list))return {none:'The member app returned only part of its member list, so it cannot be checked that exactly one member has this number.'};
  const hits=list.filter(c=>c&&[c.phone,c.whatsappNumber].some(x=>normPhone(x)===want));
  if(!hits.length)return {none:'No member in the member app has this chat\'s number.'};
  if(hits.length!==1)return {none:'More than one member has this number, so it is not certain whose protocol this is.'};
  const id=Number(hits[0].id);if(!Number.isInteger(id))return {none:'The member has no usable id.'};
  const detail=await call('/api/admin/customers/'+id);if(!(detail?.protocols||[]).length)return {none:'The member has no protocol set yet.'};
  return {id,detail,call}}
 async function make(agent,phone,cfg){const m=await member(agent,phone,cfg);if(m.none)return {none:m.none};
  const pdf=await m.call('/api/protocols/export-all.pdf?customerId='+m.id+'&lang='+encodeURIComponent(cfg.lang||'id'),null,true);
  if(!pdf.subarray(0,4).equals(Buffer.from('%PDF')))throw Error('the member app did not return a PDF');
  return {pdf,filename:String(cfg.filename||'Protocol.pdf').slice(0,200),caption:cfg.caption?String(cfg.caption).slice(0,1024):''}}
 // the same member's protocols as plain text (the get_protocol tool): one member only, as make()
 make.text=async function(agent,phone,cfg){const m=await member(agent,phone,cfg);if(m.none)return {none:m.none};const d=m.detail,out=[];
  for(const p of d.protocols||[]){const pd=p.product||{},prod=[pd.name,pd.strength?String(pd.strength)+(pd.strengthUnit||''):null,pd.format].filter(Boolean).join(' ');
   const L=['Protocol: '+p.name,'Status: '+p.status,'Product: '+prod,'Frequency: '+p.frequency];if(p.durationWeeks)L.push('Duration: '+p.durationWeeks+' weeks');if(p.startDate)L.push('Start: '+p.startDate);
   for(const ph of [...(p.phases||[])].sort((a,b)=>(a.weekNumber||0)-(b.weekNumber||0)))L.push('  Week '+ph.weekNumber+': '+ph.doseMg+' mg = '+ph.units+' units'+(ph.frequencyType&&ph.frequencyType!==p.frequency?' ('+ph.frequencyType+')':'')+(ph.notes?' - '+ph.notes:''));
   if(p.administrationTime)L.push('Time: '+p.administrationTime);if(p.instructions)L.push('Instructions: '+p.instructions);if(p.notes&&!String(p.notes).trimStart().startsWith('{'))L.push('Notes: '+p.notes);
   out.push(L.join('\n'))}
  return {text:out.join('\n\n')}};
 return make}

// the whole send for one chat run: PDF from the member app -> one-purpose link -> Kirimdev document message.
// The link stays alive after Kirimdev took the message (audit M4): WhatsApp fetches the file after that, so dropping the link at once
// could fail a real send while the customer is told "sudah dikirim". It is dropped when the send is known delivered, read or failed
// (kirimdev.mjs receiptFinal → docLinks.revokeUrl), and in any case after its 15 minutes and 6 downloads. A send that Kirimdev refused
// drops it at once. Returns {sent:true,filename} or {none:'why'}; throws with the reason otherwise.
export function createProtocolSender({make,docLinks,sendDocument,log=()=>{}}){
 return async function send(agent,{phone,conversation},cfg){
  const m=await make(agent,phone,cfg);if(m.none)return {none:m.none};
  const dl=await docLinks.put({buffer:m.pdf,name:m.filename,agent});
  try{await sendDocument(agent,phone,{link:dl.url,filename:m.filename,caption:m.caption});log('protocol PDF sent for '+agent+' ('+m.pdf.length+' bytes); its link stays until the delivery is known');return {sent:true,filename:m.filename}}
  catch(e){await dl.revoke();throw e}}}
