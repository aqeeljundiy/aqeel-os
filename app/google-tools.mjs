// Google tools with no terminal (11 Nov 2026). Agents reached Gmail, Sheets, Drive, Docs and Calendar only through the
// Google Workspace skill (gapi.py / gws), which runs in the terminal; employee agents have terminal and file tools off
// (fakhri-agent: disabled_toolsets terminal, file), so even after signing in they could not use Google. These tools sit
// in aqeelOS's own MCP server (aqeelos-notify, which every agent has) and make the call with the calling agent's own
// sign-in (google_token[_<name>].json in its engine home), the same files the skill uses:
//   - an own sign-in is renewed with its refresh token when its key is old and saved back, as google-connect.mjs writes it;
//   - a share (aqeelos_managed, google-shares.mjs) holds no refresh token: aqeelOS mints a fresh key at the agent's level;
//   - an agent locked to its own files (google-files.mjs) holds no key: Sheets and Docs go through that lock, the rest is refused;
//   - the same rules gapi.py keeps (aqeelos-accounts.json): a paused account, an account not shared with the agent
//     (deny) and the allowed actions (read, edit, draft, send) per agent. Sending mail or calendar invites needs "send".
// Tools are grouped by service with an action, so an agent sees six tools, not twenty.
import {readFile,writeFile,rename,readdir,chmod,stat} from 'node:fs/promises';
import path from 'node:path';

const TOKEN='https://oauth2.googleapis.com/token';
const GMAIL='https://gmail.googleapis.com/gmail/v1/users/me/',SHEETS='https://sheets.googleapis.com/v4/spreadsheets',DOCS='https://docs.googleapis.com/v1/documents',
 DRIVE='https://www.googleapis.com/drive/v3/files',UPLOAD='https://www.googleapis.com/upload/drive/v3/files',CAL='https://www.googleapis.com/calendar/v3/calendars/';
const e=encodeURIComponent;
const MAX_TEXT=40000;
const isTok=f=>/^google_token(?:_[\w.-]+)?\.json$/.test(f);
const nameOf=f=>(/^google_token(?:_([\w.-]+))?\.json/.exec(f)||[])[1]||'';
const clip=(s,n=MAX_TEXT)=>{s=String(s??'');return s.length>n?s.slice(0,n)+'\n… (cut at '+n+' characters of '+s.length+')':s};
// a file id from a Google link (docs.google.com/spreadsheets/d/<id>/…, drive.google.com/file/d/<id>, /drive/folders/<id>,
// ?id=<id>) or the id itself
export function idOf(v){const s=String(v||'').trim();const m=/\/(?:d|folders)\/([\w-]{10,})/.exec(s)||/[?&]id=([\w-]{10,})/.exec(s);return m?m[1]:s}
// what an action needs, in gapi.py's words (connected-accounts.mjs guard): mail and calendar changes are "send"
export function canDo(can,need){if(!need||!Array.isArray(can))return true;const h=new Set(can);if(h.has('send')){h.add('edit');h.add('draft')}if(h.has('draft'))h.add('edit');return h.has(need)}
// an event's default end: the next day for an all-day date, else one hour later, kept in the start's own form (a time with
// no zone stays without one, so the calendar's or time_zone's clock applies); null when start is not a date
export function endOf(start){const s=String(start||'').trim();
 if(/^\d{4}-\d\d-\d\d$/.test(s)){const d=new Date(s+'T00:00:00Z');if(isNaN(d))return null;d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}
 const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?)(\.\d+)?(Z|[+-]\d\d:?\d\d)?$/i.exec(s);if(!m)return null;
 if(m[3]){const d=new Date(s);return isNaN(d)?null:new Date(d.getTime()+3600e3).toISOString().replace(/\.000Z$/,'Z')}
 const d=new Date(m[1]+'Z');return isNaN(d)?null:new Date(d.getTime()+3600e3).toISOString().slice(0,19)}
const NEED_WORDS={draft:'save mail drafts',edit:'change Sheets, Docs or Drive files',send:'send mail or change calendars'};

/* ---------- the tools agents see ---------- */
const ACC={type:'string',description:'Which Google account: its name (e.g. work) or email. Leave out when you have one, or for the main one.'};
export const GOOGLE_TOOLS=[
 {name:'google_accounts',description:'Your Google accounts (name, email, what each may do) for the google_* tools. With connect true: a link for the person to connect a Google account to you (send it to them as it is).',inputSchema:{type:'object',properties:{connect:{type:'boolean',description:'Get a link to connect a Google account'},name:{type:'string',description:'With connect: a short name for an extra account, e.g. work'}}},annotations:{readOnlyHint:true}},
 {name:'google_gmail',description:'Gmail with your own Google account, no terminal needed. search: messages matching a Gmail query (from:, subject:, newer_than:7d, is:unread…). read: one message in full. draft: save a draft (reply_to keeps it in the thread). send: send a draft (draft_id) or a new message; only when the person has approved the exact text and recipients, and only if aqeelOS allows this account to send.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['search','read','draft','send']},account:ACC,query:{type:'string',description:'search: Gmail search words'},max:{type:'number',description:'search: how many (default 10, at most 25)'},id:{type:'string',description:'read: the message id from search'},to:{type:'string',description:'draft/send: recipients, comma separated'},cc:{type:'string'},bcc:{type:'string'},subject:{type:'string'},body:{type:'string',description:'draft/send: plain text'},reply_to:{type:'string',description:'draft/send: id of the message you answer'},draft_id:{type:'string',description:'send: the draft id from draft'}},required:['action']}},
 {name:'google_sheets',description:'Google Sheets with your own Google account, no terminal needed. read: values of a range. write: replace a range. append: add rows under the table. create: a new spreadsheet (optionally with first rows). spreadsheet takes the id or the link.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['read','write','append','create']},account:ACC,spreadsheet:{type:'string',description:'The spreadsheet id or link'},range:{type:'string',description:'A1 range, e.g. Sheet1!A1:D20 (read/write/append)'},values:{type:'array',items:{type:'array',items:{}},description:'write/append/create: rows, e.g. [["Name","Total"],["Ana",12]]'},title:{type:'string',description:'create: the title'}},required:['action']}},
 {name:'google_drive',description:'Google Drive with your own Google account, no terminal needed. search: files by words in their name or text. read: a file as text (Docs as text, Sheets as CSV, text files). upload: a new file from text you give (convert to a Google Doc or Sheet if you like).',inputSchema:{type:'object',properties:{action:{type:'string',enum:['search','read','upload']},account:ACC,query:{type:'string',description:'search: words to find'},max:{type:'number',description:'search: how many (default 20, at most 50)'},file:{type:'string',description:'read: the file id or link'},name:{type:'string',description:'upload: file name'},content:{type:'string',description:'upload: the text content'},content_base64:{type:'string',description:'upload: binary content instead, base64'},mime_type:{type:'string',description:'upload: e.g. text/csv (default text/plain)'},convert:{type:'string',enum:['doc','sheet'],description:'upload: make it a Google Doc or Sheet'},folder:{type:'string',description:'upload: folder id or link'}},required:['action']}},
 {name:'google_docs',description:'Google Docs with your own Google account, no terminal needed. read: the text of a document. create: a new document (optionally with text). append: add text at the end. document takes the id or the link.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['read','create','append']},account:ACC,document:{type:'string',description:'The document id or link'},title:{type:'string',description:'create: the title'},text:{type:'string',description:'create/append: plain text'}},required:['action']}},
 {name:'google_calendar',description:'Google Calendar with your own Google account, no terminal needed. list: events in a time window (default the next 7 days). create: a new event; guests get an invitation only with notify true, and only after the person agreed.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['list','create']},account:ACC,calendar:{type:'string',description:'Calendar id (default primary)'},from:{type:'string',description:'list: start, ISO date or date-time (default now)'},to:{type:'string',description:'list: end (default 7 days after from)'},query:{type:'string',description:'list: words to find'},max:{type:'number',description:'list: how many (default 25, at most 100)'},title:{type:'string',description:'create: the event title'},start:{type:'string',description:'create: ISO date-time (2026-11-12T10:00:00) or a date for all day'},end:{type:'string',description:'create: ISO date-time or date (default one hour after start)'},time_zone:{type:'string',description:'create: e.g. Asia/Jakarta (default the calendar\'s)'},description:{type:'string'},location:{type:'string'},attendees:{type:'array',items:{type:'string'},description:'create: guest emails'},notify:{type:'boolean',description:'create: send the guests an invitation'}},required:['action']}}];
export const GOOGLE_TOOL_NAMES=new Set(GOOGLE_TOOLS.map(t=>t.name));

/* ---------- mail text ---------- */
const hdr=s=>/^[\x20-\x7e]*$/.test(s)?s:'=?UTF-8?B?'+Buffer.from(s,'utf8').toString('base64')+'?=';
const clean=s=>String(s||'').replace(/[\r\n]+/g,' ').trim();
export function mime({to,cc,bcc,subject,body,inReplyTo,references}){const L=['To: '+clean(to)];if(cc)L.push('Cc: '+clean(cc));if(bcc)L.push('Bcc: '+clean(bcc));
 L.push('Subject: '+hdr(clean(subject)));if(inReplyTo){L.push('In-Reply-To: '+clean(inReplyTo));L.push('References: '+clean(references||inReplyTo))}
 L.push('MIME-Version: 1.0','Content-Type: text/plain; charset="UTF-8"','Content-Transfer-Encoding: base64','',Buffer.from(String(body||''),'utf8').toString('base64').replace(/.{76}/g,'$&\r\n'));
 return Buffer.from(L.join('\r\n'),'utf8').toString('base64url')}
const b64=s=>Buffer.from(String(s||''),'base64url').toString('utf8');
const unHtml=h=>String(h).replace(/<(script|style)[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\n{3,}/g,'\n\n').trim();
export function mailText(payload){let plain='',html='';const files=[];
 const walk=p=>{if(!p)return;const t=String(p.mimeType||'');if(p.filename){files.push(p.filename);return}
  if(t==='text/plain'&&p.body?.data&&!plain)plain=b64(p.body.data);else if(t==='text/html'&&p.body?.data&&!html)html=b64(p.body.data);(p.parts||[]).forEach(walk)};
 walk(payload);return {text:plain||(html?unHtml(html):''),files}}
const header=(m,n)=>(m?.payload?.headers||[]).find(h=>String(h.name).toLowerCase()===n.toLowerCase())?.value||'';
// a Google document's text (paragraphs and tables, in order)
export function docText(doc){const out=[];const els=c=>{for(const x of c||[]){if(x.paragraph)out.push((x.paragraph.elements||[]).map(r=>r.textRun?.content||'').join(''));
  else if(x.table)for(const row of x.table.tableRows||[])out.push((row.tableCells||[]).map(c=>{const s=[];for(const y of c.content||[])if(y.paragraph)s.push((y.paragraph.elements||[]).map(r=>r.textRun?.content||'').join('').trim());return s.join(' ')}).join('\t')+'\n');
  else if(x.tableOfContents)els(x.tableOfContents.content)}};
 els(doc?.body?.content);return out.join('')}

/* ---------- the factory ---------- */
// deps: HERMES_HOME; homeOf(agent); policy file in HERMES_HOME (aqeelos-accounts.json); sharedKey(email,agent) -> a fresh key
// for a share; locked(agent) and filesCall(agent,req) from google-files.mjs; connectLink(agent,name) -> {url,how}; labels(agent,name)
export function createGoogleTools({HERMES_HOME,homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),sharedKey=null,locked=async()=>false,filesCall=null,connectLink=async()=>null,labels=async()=>({}),fetchImpl=fetch,now=()=>Date.now(),log=()=>{}}){
 const readJson=async f=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return null}};
 const put=async(f,v)=>{const t=f+'.'+process.pid+'.'+Math.random().toString(36).slice(2,8)+'.tmp';const mode=((await stat(f).catch(()=>null))?.mode??0o600)&0o777;
  await writeFile(t,JSON.stringify(v,null,2),{mode});await chmod(t,mode).catch(()=>{});await rename(t,f)};
 class Say extends Error{}   // an answer for the agent, not a crash
 const say=t=>{throw new Say(t)};
 async function notConnected(agent,extra=''){const l=await connectLink(agent).catch(()=>null);
  return 'Google isn\'t connected for this agent — Connect Google: '+(l?.url||'aqeelOS › Abilities › Connections › Add › A Google account')+(l?.how?'\n'+l.how:'')+(extra?'\n'+extra:'')}
 // the agent's sign-ins: its own home (a numbered copy falls back to the base agent's)
 async function accounts(agent){for(const a of [...new Set([agent,String(agent).split('--')[0]])]){const home=homeOf(a);const fs=await readdir(home).catch(()=>[]);
   const out=[];for(const f of fs.filter(isTok).sort()){const d=await readJson(path.join(home,f));if(!d)continue;out.push({name:nameOf(f),file:path.join(home,f),email:String(d.account||'').toLowerCase(),data:d,managed:!!d.aqeelos_managed})}
   const paused=fs.filter(f=>/^google_token(?:_[\w.-]+)?\.json\.paused$/.test(f)).map(f=>({name:nameOf(f),file:path.join(home,f),paused:true}));
   if(out.length||paused.length)return {list:out,paused}}
  return {list:[],paused:[]}}
 async function pick(agent,want){const {list,paused}=await accounts(agent);const w=String(want||'').trim().toLowerCase();
  const match=x=>x.name.toLowerCase()===w||x.email===w||x.name.toLowerCase()===w.replace(/[^a-z0-9_-]+/g,'-');
  if(w){const x=list.find(match);if(x)return x;if(paused.find(match))say('This Google account is paused in aqeelOS (Abilities › Connections). Do not retry; tell the person it is paused and ask them to resume it there.');
   if(!list.length)say(await notConnected(agent));
   for(const x of list){const l=await labels(agent,x.name).catch(()=>({}));if(l?.label&&String(l.label).toLowerCase()===w)return x}
   say('You have no Google account called '+want+'. Yours: '+list.map(x=>(x.name||'main')+' ('+x.email+')').join(', ')+'.')}
  if(list.length===1)return list[0];const main=list.find(x=>!x.name);if(main)return main;
  if(!list.length)say(paused.length?'Your Google account is paused in aqeelOS (Abilities › Connections). Do not retry; tell the person it is paused and ask them to resume it there.':await notConnected(agent));
  say('You have several Google accounts; say which with account: '+list.map(x=>x.name+' ('+x.email+')').join(', ')+'.')}
 // gapi.py's guard (connected-accounts.mjs), the same file and the same answers
 async function guard(agent,acc,need){const base=String(agent).split('--')[0];const pol=(await readJson(path.join(HERMES_HOME,'aqeelos-accounts.json')))?.google||{};const ent=pol[acc.email]||{};
  if((ent.deny||[]).includes(base))say('This Google account is not shared with you in aqeelOS (Abilities › Connections). Do not retry; ask its owner agent or the person to share it.');
  const per=ent.agents&&typeof ent.agents==='object'?ent.agents:{};const can=per[agent]??per[base]??ent.can;
  if(!canDo(can,need))say('aqeelOS does not let you '+NEED_WORDS[need]+' with '+acc.email+' (Abilities › Connections). Do not retry; tell the person what you would have done.')}
 // a key that works now: the saved one, else renewed (own sign-in: saved back; share: minted by aqeelOS)
 async function key(agent,acc,force=false){const d=acc.data;const left=(Date.parse(d.expiry||'')||0)-now();if(!force&&d.token&&left>90e3)return d.token;
  if(acc.managed){if(!sharedKey)say('The shared key for '+acc.email+' is renewing. Try again in a few minutes.');
   try{return await sharedKey(acc.email,agent)}catch(x){say('aqeelOS could not get a key for '+acc.email+' ('+x.message+'). It is shared with you by the owner agent; tell the person.')}}
  if(!d.refresh_token)say(await notConnected(agent,'('+acc.email+' has no lasting sign-in: connect it again.)'));
  let cid=d.client_id,sec=d.client_secret;if(!cid||!sec){const c=await readJson(path.join(HERMES_HOME,'google_client_secret.json'));const x=c?.web||c?.installed||c||{};cid||=x.client_id;sec||=x.client_secret}
  const r=await fetchImpl(d.token_uri||TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cid||'',client_secret:sec||'',refresh_token:d.refresh_token,grant_type:'refresh_token'}).toString(),signal:AbortSignal.timeout(20000)}).catch(x=>({ok:false,status:0,json:async()=>({error:x.message})}));
  const j=await r.json().catch(()=>({}));
  if(!j.access_token)say(j.error==='invalid_grant'||j.error==='invalid_client'||j.error==='unauthorized_client'?await notConnected(agent,'(Google ended the sign-in for '+acc.email+': connect it again.)'):'Google did not renew the key for '+acc.email+' ('+(j.error_description||j.error||r.status)+'). Try again in a minute.');
  // saved back as the skill and google-connect write it, so the skill and Backups use the same fresh key
  const cur=await readJson(acc.file)||d;const next={...cur,token:j.access_token,expiry:new Date(now()+(Number(j.expires_in)||3600)*1000).toISOString().replace(/\.\d+Z$/,'.000000Z')};
  if(j.refresh_token)next.refresh_token=j.refresh_token;await put(acc.file,next).catch(x=>log('google tools: could not save the renewed key for '+acc.email+': '+x.message));acc.data=next;return j.access_token}
 // one Google call; a key Google calls expired is renewed once
 async function api(agent,acc,method,url,body,{raw=false,ctype='application/json'}={}){let tok=await key(agent,acc);
  for(let n=0;;n++){const r=await fetchImpl(url,{method,headers:{authorization:'Bearer '+tok,...(body!==undefined?{'content-type':ctype}:{})},body:body===undefined?undefined:typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body),signal:AbortSignal.timeout(60000)}).catch(x=>({ok:false,status:0,text:async()=>x.message,json:async()=>({error:{message:x.message}})}));
   if(r.status===401&&n===0){tok=await key(agent,acc,true);continue}
   if(r.ok)return raw?await r.text():await r.json().catch(()=>({}));
   const t=await r.text().catch(()=>'');let j={};try{j=JSON.parse(t)}catch{}const m=j.error?.message||j.error_description||(typeof j.error==='string'?j.error:'')||t.slice(0,200);
   if(r.status===403&&/insufficient|scope/i.test(m+' '+JSON.stringify(j.error?.details||'')))say(acc.managed?acc.email+' is shared with you at a level that does not allow this (Abilities › Connections). Do not retry; tell the person what you would have done.':'The sign-in for '+acc.email+' does not include this Google service. '+await notConnected(agent,'(Connect it again with that service ticked.)'));
   if(r.status===404)say('Not found, or not shared with '+acc.email+'. Check the id or link, or ask the person to share it with '+acc.email+'.');
   if(r.status===403&&/has not been used|is disabled/i.test(m))say('This Google API is switched off in the install\'s Google Cloud project ('+m.slice(0,160)+'). Report it with report_bottleneck so the owner switches it on.');
   say('Google said '+(r.status||'no answer')+': '+m)}}
 // an agent locked to its own files: the call goes through google-files.mjs (its file list and level), never with a key here
 async function viaFiles(agent,account,key2,params,body){if(!filesCall)say('aqeelOS keeps you to your own Google files and cannot reach them right now. Try again later.');
  const [service,...rest]=key2.split('.');const r=await filesCall(agent,{service,method:rest.join('.'),params,body,account:account||undefined});
  if(r.status!==200)say(typeof r.json?.error==='string'?r.json.error:'Google said '+r.status+': '+JSON.stringify(r.json?.error||r.json).slice(0,300));return r.json}
 const filesOnly=async(agent,acc)=>!acc&&await locked(String(agent).split('--')[0]).catch(()=>false);
 const lockedSay='aqeelOS keeps you to your own Google files (Abilities › Connections): only reading and changing those Sheets and Docs is possible. Do not retry; tell the person what you needed.';
 // the account, or null for an agent locked to its own files (that has no sign-in of its own)
 async function accFor(agent,a,fileOk){const {list}=await accounts(agent);if(!list.length&&await filesOnly(agent,null)){if(!fileOk)say(lockedSay);return null}return pick(agent,a.account)}

 /* ---------- services ---------- */
 async function gmail(agent,a){const act=a.action;const acc=await accFor(agent,a,false);
  if(act==='search'){await guard(agent,acc,null);const max=Math.min(Math.max(Number(a.max)||10,1),25);
   const l=await api(agent,acc,'GET',GMAIL+'messages?'+new URLSearchParams({q:String(a.query||''),maxResults:String(max)}));const ids=(l.messages||[]).map(m=>m.id);
   if(!ids.length)return 'No messages match '+JSON.stringify(String(a.query||''))+' in '+acc.email+'.';
   const ms=await Promise.all(ids.map(id=>api(agent,acc,'GET',GMAIL+'messages/'+e(id)+'?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date')));
   return ms.length+' message'+(ms.length===1?'':'s')+' in '+acc.email+(l.nextPageToken?' (more match; narrow the search)':'')+':\n'+ms.map(m=>'- id '+m.id+' · '+header(m,'Date')+' · from '+header(m,'From')+' · '+(header(m,'Subject')||'(no subject)')+((m.labelIds||[]).includes('UNREAD')?' · unread':'')+'\n  '+String(m.snippet||'').slice(0,200)).join('\n')}
  if(act==='read'){await guard(agent,acc,null);if(!a.id)say('Give the message id (from search).');const m=await api(agent,acc,'GET',GMAIL+'messages/'+e(a.id)+'?format=full');const t=mailText(m.payload);
   return ['From: '+header(m,'From'),'To: '+header(m,'To'),header(m,'Cc')?'Cc: '+header(m,'Cc'):null,'Date: '+header(m,'Date'),'Subject: '+header(m,'Subject'),'Thread: '+m.threadId,t.files.length?'Attachments: '+t.files.join(', '):null,'',clip(t.text||m.snippet||'(no text)')].filter(x=>x!==null).join('\n')}
  if(act==='draft'||act==='send'){
   if(act==='send'&&a.draft_id){await guard(agent,acc,'send');const r=await api(agent,acc,'POST',GMAIL+'drafts/send',{id:String(a.draft_id)});log('google tools: '+agent+' sent a draft from '+acc.email);return 'Sent from '+acc.email+' (message id '+r.id+'). Do not send it again.'}
   if(!String(a.to||'').trim())say('Give to (the recipients).');await guard(agent,acc,act==='send'?'send':'draft');
   let thread,inReplyTo,refs,subject=a.subject;
   if(a.reply_to){const o=await api(agent,acc,'GET',GMAIL+'messages/'+e(a.reply_to)+'?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject');thread=o.threadId;inReplyTo=header(o,'Message-ID');refs=[header(o,'References'),inReplyTo].filter(Boolean).join(' ');if(!subject){const s=header(o,'Subject');subject=/^re:/i.test(s)?s:'Re: '+s}}
   const raw=mime({to:a.to,cc:a.cc,bcc:a.bcc,subject:subject||'',body:a.body,inReplyTo,references:refs});const message={raw,...(thread?{threadId:thread}:{})};
   if(act==='draft'){const r=await api(agent,acc,'POST',GMAIL+'drafts',{message});return 'Draft saved in '+acc.email+' (draft_id '+r.id+'). It is not sent. To send it after the person approves: google_gmail action send with draft_id '+r.id+'.'}
   const r=await api(agent,acc,'POST',GMAIL+'messages/send',message);log('google tools: '+agent+' sent mail from '+acc.email);return 'Sent from '+acc.email+' to '+clean(a.to)+' (message id '+r.id+'). Do not send it again.'}
  say('action is search, read, draft or send.')}
 async function sheets(agent,a){const act=a.action;const acc=await accFor(agent,a,act!=='create');const id=idOf(a.spreadsheet);
  if(act==='create'){await guard(agent,acc,'edit');if(!String(a.title||'').trim())say('Give the title.');const r=await api(agent,acc,'POST',SHEETS,{properties:{title:String(a.title)}});
   if(Array.isArray(a.values)&&a.values.length){const first=r.sheets?.[0]?.properties?.title||'Sheet1';await api(agent,acc,'PUT',SHEETS+'/'+e(r.spreadsheetId)+'/values/'+e("'"+first.replace(/'/g,"''")+"'!A1")+'?valueInputOption=USER_ENTERED',{values:a.values})}
   return 'Created "'+a.title+'" in '+acc.email+': '+(r.spreadsheetUrl||'https://docs.google.com/spreadsheets/d/'+r.spreadsheetId)+' (id '+r.spreadsheetId+').'}
  if(!id)say('Give the spreadsheet id or link.');if(!a.range)say('Give the range, e.g. Sheet1!A1:D20.');const range=String(a.range);
  const need=act==='read'?null:'edit';if(acc)await guard(agent,acc,need);
  if((act==='write'||act==='append')&&!(Array.isArray(a.values)&&a.values.length))say('Give values: rows, e.g. [["Ana",12]].');
  const go=(k,http,url,body)=>acc?api(agent,acc,http,url,body):viaFiles(agent,a.account,k,{spreadsheetId:id,range,...(k.endsWith('.get')?{}:{valueInputOption:'USER_ENTERED'}),...(k.endsWith('append')?{insertDataOption:'INSERT_ROWS'}:{})},body);
  const base=SHEETS+'/'+e(id)+'/values/'+e(range);
  if(act==='read'){const r=await go('sheets.spreadsheets.values.get','GET',base);const v=r.values||[];return v.length?clip((r.range||range)+' ('+v.length+' rows):\n'+JSON.stringify(v)):'No values in '+(r.range||range)+'.'}
  if(act==='write'){const r=await go('sheets.spreadsheets.values.update','PUT',base+'?valueInputOption=USER_ENTERED',{values:a.values});return 'Wrote '+(r.updatedCells??'the')+' cells in '+(r.updatedRange||range)+'.'}
  if(act==='append'){const r=await go('sheets.spreadsheets.values.append','POST',base+':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',{values:a.values});return 'Added '+(r.updates?.updatedRows??a.values.length)+' rows at '+(r.updates?.updatedRange||range)+'.'}
  say('action is read, write, append or create.')}
 async function drive(agent,a){const act=a.action;const acc=await accFor(agent,a,false);
  if(act==='search'){await guard(agent,acc,null);const w=String(a.query||'').trim().replace(/\\/g,'\\\\').replace(/'/g,"\\'");const max=Math.min(Math.max(Number(a.max)||20,1),50);
   const q=(w?"(name contains '"+w+"' or fullText contains '"+w+"') and ":'')+'trashed = false';
   // Drive refuses orderBy with a fullText search, so the newest first only when listing everything
   const r=await api(agent,acc,'GET',DRIVE+'?'+new URLSearchParams({q,pageSize:String(max),...(w?{}:{orderBy:'modifiedTime desc'}),fields:'files(id,name,mimeType,modifiedTime,webViewLink)',supportsAllDrives:'true',includeItemsFromAllDrives:'true'}));
   const f=r.files||[];return f.length?f.length+' file'+(f.length===1?'':'s')+' in '+acc.email+':\n'+f.map(x=>'- '+x.name+' · '+String(x.mimeType).replace('application/vnd.google-apps.','google ')+' · '+String(x.modifiedTime||'').slice(0,10)+' · id '+x.id+(x.webViewLink?' · '+x.webViewLink:'')).join('\n'):'No files match '+JSON.stringify(String(a.query||''))+' in '+acc.email+'.'}
  if(act==='read'){await guard(agent,acc,null);const id=idOf(a.file);if(!id)say('Give the file id or link.');
   const m=await api(agent,acc,'GET',DRIVE+'/'+e(id)+'?fields=id,name,mimeType,size&supportsAllDrives=true');const t=String(m.mimeType||'');
   const exp={'application/vnd.google-apps.document':'text/plain','application/vnd.google-apps.spreadsheet':'text/csv','application/vnd.google-apps.presentation':'text/plain'}[t];
   let text;if(exp)text=await api(agent,acc,'GET',DRIVE+'/'+e(id)+'/export?mimeType='+e(exp),undefined,{raw:true});
   else if(/^text\/|json|csv|xml|javascript|yaml/.test(t))text=await api(agent,acc,'GET',DRIVE+'/'+e(id)+'?alt=media&supportsAllDrives=true',undefined,{raw:true});
   else say(m.name+' is '+(t||'a binary file')+', which cannot be read as text here. Ask the person what they need from it.');
   return m.name+' ('+t.replace('application/vnd.google-apps.','google ')+(t.endsWith('spreadsheet')?', first sheet as CSV':'')+'):\n\n'+clip(text)}
  if(act==='upload'){await guard(agent,acc,'edit');const name=String(a.name||'').trim();if(!name)say('Give the file name.');if(a.content==null&&!a.content_base64)say('Give content (text) or content_base64.');
   const data=a.content_base64?Buffer.from(String(a.content_base64),'base64'):Buffer.from(String(a.content),'utf8');if(data.length>5*1024*1024)say('That is over 5 MB; upload it in the browser instead.');
   const type=String(a.mime_type||(a.content_base64?'application/octet-stream':'text/plain'));
   const meta={name,...(a.convert==='doc'?{mimeType:'application/vnd.google-apps.document'}:a.convert==='sheet'?{mimeType:'application/vnd.google-apps.spreadsheet'}:{}),...(a.folder?{parents:[idOf(a.folder)]}:{})};
   const B='aqeelos'+now().toString(36),body=Buffer.concat([Buffer.from('--'+B+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(meta)+'\r\n--'+B+'\r\nContent-Type: '+type+'\r\n\r\n'),data,Buffer.from('\r\n--'+B+'--')]);
   const r=await api(agent,acc,'POST',UPLOAD+'?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink',body,{ctype:'multipart/related; boundary='+B});
   return 'Uploaded "'+r.name+'" to '+acc.email+'\'s Drive: '+(r.webViewLink||r.id)+' (id '+r.id+').'}
  say('action is search, read or upload.')}
 async function docs(agent,a){const act=a.action;const acc=await accFor(agent,a,act!=='create');
  if(act==='create'){await guard(agent,acc,'edit');if(!String(a.title||'').trim())say('Give the title.');const r=await api(agent,acc,'POST',DOCS,{title:String(a.title)});
   if(a.text)await api(agent,acc,'POST',DOCS+'/'+e(r.documentId)+':batchUpdate',{requests:[{insertText:{location:{index:1},text:String(a.text)}}]});
   return 'Created "'+a.title+'" in '+acc.email+': https://docs.google.com/document/d/'+r.documentId+'/edit (id '+r.documentId+').'}
  const id=idOf(a.document);if(!id)say('Give the document id or link.');
  if(act==='read'){if(acc)await guard(agent,acc,null);const d=acc?await api(agent,acc,'GET',DOCS+'/'+e(id)):await viaFiles(agent,a.account,'docs.documents.get',{documentId:id});return '"'+(d.title||id)+'":\n\n'+clip(docText(d)||'(empty)')}
  if(act==='append'){if(!a.text)say('Give the text to add.');if(acc)await guard(agent,acc,'edit');const body={requests:[{insertText:{endOfSegmentLocation:{},text:'\n'+String(a.text)}}]};
   if(acc)await api(agent,acc,'POST',DOCS+'/'+e(id)+':batchUpdate',body);else await viaFiles(agent,a.account,'docs.documents.batchUpdate',{documentId:id},body);return 'Added '+String(a.text).length+' characters at the end of the document.'}
  say('action is read, create or append.')}
 async function calendar(agent,a){const act=a.action;const acc=await accFor(agent,a,false);const cal=e(String(a.calendar||'primary'));
  const when=(v,tz)=>/^\d{4}-\d\d-\d\d$/.test(String(v))?{date:String(v)}:{dateTime:String(v),...(tz?{timeZone:String(tz)}:{})};
  if(act==='list'){await guard(agent,acc,null);const from=a.from?new Date(a.from):new Date(now());if(isNaN(from))say('from is not a date.');const to=a.to?new Date(a.to):new Date(from.getTime()+7*864e5);if(isNaN(to))say('to is not a date.');
   const q=new URLSearchParams({timeMin:from.toISOString(),timeMax:to.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:String(Math.min(Math.max(Number(a.max)||25,1),100)),...(a.query?{q:String(a.query)}:{})});
   const r=await api(agent,acc,'GET',CAL+cal+'/events?'+q);const ev=r.items||[];
   return ev.length?ev.length+' event'+(ev.length===1?'':'s')+' in '+(r.summary||acc.email)+(r.timeZone?' ('+r.timeZone+')':'')+':\n'+ev.map(x=>'- '+(x.start?.dateTime||x.start?.date)+' → '+(x.end?.dateTime||x.end?.date)+' · '+(x.summary||'(no title)')+(x.location?' · '+x.location:'')+((x.attendees||[]).length?' · with '+x.attendees.map(p=>p.email).join(', '):'')+' · id '+x.id).join('\n'):'No events between '+from.toISOString().slice(0,16)+' and '+to.toISOString().slice(0,16)+'.'}
  if(act==='create'){await guard(agent,acc,'send');if(!String(a.title||'').trim()||!a.start)say('Give title and start.');
   const end=a.end||endOf(String(a.start));if(!end)say('start is not a date or date-time.');
   const ev={summary:String(a.title),...(a.description?{description:String(a.description)}:{}),...(a.location?{location:String(a.location)}:{}),start:when(a.start,a.time_zone),end:when(end,a.time_zone),
    ...(Array.isArray(a.attendees)&&a.attendees.length?{attendees:a.attendees.map(x=>({email:String(x).trim()}))}:{})};
   const r=await api(agent,acc,'POST',CAL+cal+'/events?sendUpdates='+(a.notify?'all':'none'),ev);log('google tools: '+agent+' made an event in '+acc.email);
   return 'Event "'+r.summary+'" made in '+acc.email+' ('+(r.start?.dateTime||r.start?.date)+' → '+(r.end?.dateTime||r.end?.date)+')'+(ev.attendees?(a.notify?', invitations sent':', guests added without an invitation'):'')+': '+(r.htmlLink||r.id)}
  say('action is list or create.')}
 async function listAccounts(agent,a){
  if(a.connect){const l=await connectLink(agent,a.name).catch(x=>({error:x.message}));if(l?.error)say(l.error);if(!l?.url)say('Google is not set up on this aqeelOS yet: an admin adds it once in aqeelOS › Abilities › Connections › Add › A Google account.');
   return 'Send the person this link to connect a Google account to you'+(l.expires?' (it works for '+l.expires+')':'')+': '+l.url+(l.how?'\n'+l.how:'')}
  const {list,paused}=await accounts(agent);if(!list.length&&!paused.length){if(await filesOnly(agent,null))return lockedSay;return notConnected(agent)}
  const pol=(await readJson(path.join(HERMES_HOME,'aqeelos-accounts.json')))?.google||{},base=String(agent).split('--')[0];
  const L=[];for(const x of list){const ent=pol[x.email]||{},can=(ent.agents||{})[agent]??(ent.agents||{})[base]??ent.can;const l=await labels(agent,x.name).catch(()=>({}))||{};
   const may=(ent.deny||[]).includes(base)?'not shared with you':Array.isArray(can)?['read',...['edit','draft','send'].filter(n=>canDo(can,n))].join(', '):'everything it was signed in for';
   L.push('- '+(x.name?'account: '+x.name:'main (leave account out)')+' · '+x.email+(l.label?' · "'+l.label+'"':'')+(l.note?' · '+l.note:'')+' · may: '+may+(x.managed?' · shared with you ('+(x.data.aqeelos_level||'read')+')':''))}
  for(const p of paused)L.push('- '+(p.name||'main')+' · paused in aqeelOS');return 'Your Google accounts (use them with google_gmail, google_sheets, google_drive, google_docs, google_calendar):\n'+L.join('\n')}
 const RUN={google_accounts:listAccounts,google_gmail:gmail,google_sheets:sheets,google_drive:drive,google_docs:docs,google_calendar:calendar};
 // one tool call: {text, isError}
 async function call(agent,name,args){const f=RUN[name];if(!f)return {isError:true,text:'No such Google tool.'};
  const acts=GOOGLE_TOOLS.find(t=>t.name===name).inputSchema.properties.action?.enum;
  if(acts&&!acts.includes(args?.action))return {isError:true,text:'action is one of: '+acts.join(', ')+'.'};
  try{const text=await f(agent,args&&typeof args==='object'?args:{});return {text:String(text)}}
  catch(x){if(x instanceof Say)return {isError:true,text:x.message};log('google tools: '+agent+' '+name+' failed: '+x.message);return {isError:true,text:'The Google call failed: '+x.message}}}
 return {call,accounts,pick,TOOLS:GOOGLE_TOOLS}}
