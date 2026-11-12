// Tests for the Google tools in aqeelos-notify (app/google-tools.mjs), with a mocked Google. Run: node --test scripts/google-tools.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGoogleTools,GOOGLE_TOOLS,idOf,canDo,mime,mailText,docText,endOf} from '../app/google-tools.mjs';

const NOW=Date.parse('2026-11-11T10:00:00Z');
const later=ms=>new Date(NOW+ms).toISOString();
// a fake Google: routes are [method, regex, handler(url, opts) -> {status, body}]
function google(routes){const calls=[];
 const fetchImpl=async(u,o={})=>{calls.push({u:String(u),o});const r=routes.find(([m,re])=>(o.method||'GET')===m&&re.test(String(u)));
  const x=r?await r[2](String(u),o):{status:404,body:{error:{message:'not mocked: '+u}}};const t=typeof x.body==='string'?x.body:JSON.stringify(x.body??{});
  return {ok:x.status<300,status:x.status,json:async()=>JSON.parse(t),text:async()=>t}};
 return {fetchImpl,calls}}
async function make({files={},policy=null,routes=[],locked=false,filesCall=null,sharedKey=null,connectLink=async()=>({url:'https://ai.example/connect'})}={}){
 const H=await mkdtemp(path.join(tmpdir(),'gt-'));const home=path.join(H,'profiles','bot');await mkdir(home,{recursive:true});
 for(const [f,d] of Object.entries(files))await writeFile(path.join(home,f),typeof d==='string'?d:JSON.stringify(d));
 if(policy)await writeFile(path.join(H,'aqeelos-accounts.json'),JSON.stringify(policy));
 const g=google(routes);const logs=[];
 const t=createGoogleTools({HERMES_HOME:H,fetchImpl:g.fetchImpl,now:()=>NOW,locked:async()=>locked,filesCall,sharedKey,connectLink,log:m=>logs.push(m)});
 return {t,H,home,calls:g.calls,logs}}
const own=(email='me@example.com',x={})=>({type:'authorized_user',account:email,client_id:'cid.apps.googleusercontent.com',client_secret:'sec',refresh_token:'RT',token:'AT',token_uri:'https://oauth2.googleapis.com/token',expiry:later(3600e3),scopes:[],...x});

test('the tools: six, grouped by service, each with an action',()=>{assert.equal(GOOGLE_TOOLS.length,6);
 for(const t of GOOGLE_TOOLS){assert.match(t.name,/^google_/);if(t.name!=='google_accounts')assert.deepEqual(t.inputSchema.required,['action'])}});

test('helpers: ids from links, allowed actions, mail, documents, event ends',()=>{
 assert.equal(idOf('https://docs.google.com/spreadsheets/d/1AbcDEFghijKLmn/edit#gid=0'),'1AbcDEFghijKLmn');assert.equal(idOf('https://drive.google.com/open?id=1AbcDEFghijKL'),'1AbcDEFghijKL');assert.equal(idOf(' abc '),'abc');
 assert.equal(canDo(undefined,'send'),true);assert.equal(canDo(['read'],null),true);assert.equal(canDo(['read'],'edit'),false);assert.equal(canDo(['draft'],'edit'),true);assert.equal(canDo(['draft'],'send'),false);assert.equal(canDo(['send'],'draft'),true);
 const raw=Buffer.from(mime({to:'a@example.com',subject:'Halo café',body:'Hi\nthere',inReplyTo:'<m1@x>'}),'base64url').toString();
 assert.match(raw,/^To: a@example\.com\r\n/);assert.match(raw,/Subject: =\?UTF-8\?B\?/);assert.match(raw,/In-Reply-To: <m1@x>/);assert.equal(Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g,''),'base64').toString(),'Hi\nthere');
   // header injection is flattened to one line
 assert.match(Buffer.from(mime({to:'a@example.com\r\nBcc: evil@example.com',subject:'s'}),'base64url').toString(),/^To: a@example\.com Bcc: evil@example\.com\r\n/);
 const b=s=>Buffer.from(s).toString('base64url');
 assert.deepEqual(mailText({mimeType:'multipart/mixed',parts:[{mimeType:'multipart/alternative',parts:[{mimeType:'text/html',body:{data:b('<p>Hi</p>')}},{mimeType:'text/plain',body:{data:b('Hi plain')}}]},{mimeType:'application/pdf',filename:'q.pdf',body:{}}]}),{text:'Hi plain',files:['q.pdf']});
 assert.equal(mailText({mimeType:'text/html',body:{data:b('<div>A &amp; B</div><br>C')}}).text,'A & B\n\nC');
 assert.equal(docText({body:{content:[{paragraph:{elements:[{textRun:{content:'Title\n'}}]}},{table:{tableRows:[{tableCells:[{content:[{paragraph:{elements:[{textRun:{content:'a\n'}}]}}]},{content:[{paragraph:{elements:[{textRun:{content:'b\n'}}]}}]}]}]}}]}}),'Title\na\tb\n');
 assert.equal(endOf('2026-11-12'),'2026-11-13');assert.equal(endOf('2026-11-12T10:30:00'),'2026-11-12T11:30:00');assert.equal(endOf('2026-11-12T23:30'),'2026-11-13T00:30:00');
 assert.equal(endOf('2026-11-12T10:00:00+07:00'),'2026-11-12T04:00:00Z');assert.equal(endOf('tomorrow'),null)});

test('no Google account: the plain answer with the connect link, and Google is never called',async()=>{const {t,calls}=await make();
 const r=await t.call('bot','google_gmail',{action:'search',query:'x'});assert.equal(r.isError,true);
 assert.match(r.text,/^Google isn't connected for this agent — Connect Google: https:\/\/ai\.example\/connect/);assert.equal(calls.length,0);
 const c=await t.call('bot','google_accounts',{connect:true});assert.equal(c.isError,undefined);assert.match(c.text,/https:\/\/ai\.example\/connect/)});

test('a wrong action is refused before anything else',async()=>{const {t}=await make();const r=await t.call('bot','google_sheets',{action:'delete'});assert.equal(r.isError,true);assert.match(r.text,/read, write, append, create/)});

test('gmail search and read with the saved key',async()=>{const {t,calls}=await make({files:{'google_token.json':own()},routes:[
  ['GET',/messages\?q=/,()=>({status:200,body:{messages:[{id:'m1'}]}})],
  ['GET',/messages\/m1\?format=metadata/,()=>({status:200,body:{id:'m1',snippet:'see you',labelIds:['UNREAD'],payload:{headers:[{name:'From',value:'Ana <ana@example.com>'},{name:'Subject',value:'Lunch'},{name:'Date',value:'Tue'}]}}})],
  ['GET',/messages\/m1\?format=full/,()=>({status:200,body:{id:'m1',threadId:'t1',payload:{headers:[{name:'From',value:'Ana'},{name:'Subject',value:'Lunch'}],mimeType:'text/plain',body:{data:Buffer.from('Body text').toString('base64url')}}}})]]});
 const s=await t.call('bot','google_gmail',{action:'search',query:'from:ana'});assert.equal(s.isError,undefined,s.text);assert.match(s.text,/id m1 · Tue · from Ana <ana@example\.com> · Lunch · unread/);
 assert.match(calls[0].u,/q=from%3Aana&maxResults=10/);assert.equal(calls[0].o.headers.authorization,'Bearer AT');
 const r=await t.call('bot','google_gmail',{action:'read',id:'m1'});assert.match(r.text,/Subject: Lunch/);assert.match(r.text,/Body text$/)});

test('an old key is renewed with the refresh token and saved back',async()=>{let posted;const {t,home,calls}=await make({files:{'google_token_work.json':own('w@example.com',{expiry:later(-60e3)})},routes:[
  ['POST',/oauth2\.googleapis\.com\/token/,(u,o)=>{posted=new URLSearchParams(o.body);return {status:200,body:{access_token:'NEW',expires_in:3599}}}],
  ['GET',/calendars\/primary\/events/,()=>({status:200,body:{summary:'w@example.com',items:[{id:'e1',summary:'Standup',start:{dateTime:'2026-11-11T09:00:00Z'},end:{dateTime:'2026-11-11T09:15:00Z'}}]}})]]});
 const r=await t.call('bot','google_calendar',{action:'list',account:'work'});assert.equal(r.isError,undefined,r.text);assert.match(r.text,/Standup/);
 assert.equal(posted.get('refresh_token'),'RT');assert.equal(posted.get('grant_type'),'refresh_token');assert.equal(calls[1].o.headers.authorization,'Bearer NEW');
 const saved=JSON.parse(await readFile(path.join(home,'google_token_work.json'),'utf8'));assert.equal(saved.token,'NEW');assert.equal(saved.refresh_token,'RT');assert.equal(saved.expiry,new Date(NOW+3599e3).toISOString().replace(/\.\d+Z$/,'.000000Z'))});

test('a sign-in Google ended: the connect link, not a crash',async()=>{const {t}=await make({files:{'google_token.json':own('me@example.com',{expiry:later(-1)})},routes:[['POST',/token$/,()=>({status:400,body:{error:'invalid_grant'}})]]});
 const r=await t.call('bot','google_drive',{action:'search',query:'q'});assert.equal(r.isError,true);assert.match(r.text,/Connect Google: https:\/\/ai\.example\/connect[\s\S]*Google ended the sign-in for me@example\.com/)});

test('several accounts: asked to choose; chosen by name or email',async()=>{const {t}=await make({files:{'google_token_a.json':own('a@example.com'),'google_token_b.json':own('b@example.com')},routes:[['GET',/drive\/v3\/files\?/,()=>({status:200,body:{files:[]}})]]});
 const r=await t.call('bot','google_drive',{action:'search',query:'x'});assert.equal(r.isError,true);assert.match(r.text,/several Google accounts.*a \(a@example\.com\), b \(b@example\.com\)/);
 assert.match((await t.call('bot','google_drive',{action:'search',query:'x',account:'b@example.com'})).text,/No files match "x" in b@example\.com/);
 assert.match((await t.call('bot','google_drive',{action:'search',query:'x',account:'zz'})).text,/no Google account called zz/)});

test('allowed actions and sharing from aqeelos-accounts.json, like gapi.py',async()=>{const {t,calls}=await make({files:{'google_token.json':own()},policy:{google:{'me@example.com':{agents:{bot:['read','draft']}}}},routes:[
  ['POST',/gmail\/v1\/users\/me\/drafts$/,(u,o)=>({status:200,body:{id:'d1',sent:JSON.parse(o.body)}})]]});
 const s=await t.call('bot','google_gmail',{action:'send',to:'c@example.com',subject:'Hi',body:'x'});assert.equal(s.isError,true);assert.match(s.text,/does not let you send mail/);
 const s2=await t.call('bot','google_gmail',{action:'send',draft_id:'d1'});assert.equal(s2.isError,true);
 const c=await t.call('bot','google_calendar',{action:'create',title:'T',start:'2026-11-12T10:00:00'});assert.equal(c.isError,true);   // calendar changes need send, as in gapi.py
 assert.equal(calls.length,0);
 const d=await t.call('bot','google_gmail',{action:'draft',to:'c@example.com',subject:'Hi',body:'x'});assert.equal(d.isError,undefined,d.text);assert.match(d.text,/draft_id d1.*not sent/s);
 const raw=Buffer.from(JSON.parse(calls[0].o.body).message.raw,'base64url').toString();assert.match(raw,/To: c@example\.com/);
 const {t:t2,calls:c2}=await make({files:{'google_token.json':own()},policy:{google:{'me@example.com':{deny:['bot']}}}});
 const n=await t2.call('bot--2','google_sheets',{action:'read',spreadsheet:'S1',range:'A1'});assert.match(n.text,/not shared with you/);assert.equal(c2.length,0)});

test('send with the send action allowed, as a reply in the thread',async()=>{const {t,calls,logs}=await make({files:{'google_token.json':own()},routes:[
  ['GET',/messages\/m9\?format=metadata/,()=>({status:200,body:{id:'m9',threadId:'th9',payload:{headers:[{name:'Message-ID',value:'<orig@x>'},{name:'Subject',value:'Order 12'}]}}})],
  ['POST',/messages\/send$/,()=>({status:200,body:{id:'s1'}})]]});
 const r=await t.call('bot','google_gmail',{action:'send',to:'c@example.com',body:'Done',reply_to:'m9'});assert.equal(r.isError,undefined,r.text);assert.match(r.text,/Sent from me@example\.com to c@example\.com/);
 const b=JSON.parse(calls[1].o.body);assert.equal(b.threadId,'th9');const raw=Buffer.from(b.message?b.message.raw:b.raw,'base64url').toString();assert.match(raw,/Subject: Re: Order 12/);assert.match(raw,/In-Reply-To: <orig@x>/);
 assert.ok(logs.some(l=>/sent mail/.test(l)))});

test('a paused account says so',async()=>{const {t,calls}=await make({files:{'google_token.json.paused':own()}});
 const r=await t.call('bot','google_docs',{action:'read',document:'D1'});assert.match(r.text,/paused in aqeelOS/);assert.equal(calls.length,0)});

test('sheets: read, write, append and create, links accepted',async()=>{const {t,calls}=await make({files:{'google_token.json':own()},routes:[
  ['GET',/spreadsheets\/S1\/values\//,()=>({status:200,body:{range:'Sheet1!A1:B2',values:[['a','b'],['1','2']]}})],
  ['PUT',/spreadsheets\/S1\/values\//,()=>({status:200,body:{updatedCells:2,updatedRange:'Sheet1!A1:B1'}})],
  ['POST',/spreadsheets\/S1\/values\/.*:append/,()=>({status:200,body:{updates:{updatedRows:1,updatedRange:'Sheet1!A3:B3'}}})],
  ['POST',/spreadsheets$/,()=>({status:200,body:{spreadsheetId:'NEW1',spreadsheetUrl:'https://docs.google.com/spreadsheets/d/NEW1/edit',sheets:[{properties:{title:'Sheet1'}}]}})],
  ['PUT',/spreadsheets\/NEW1\/values\//,()=>({status:200,body:{}})]]});
 assert.match((await t.call('bot','google_sheets',{action:'read',spreadsheet:'https://docs.google.com/spreadsheets/d/S1aaaaaaaaaa/edit',range:'Sheet1!A1:B2'})).text,/^Not found, or not shared with me@example\.com/);
 assert.match(calls[0].u,/spreadsheets\/S1aaaaaaaaaa\/values\/Sheet1!A1%3AB2$/);   // the id comes out of the link
 const r=await t.call('bot','google_sheets',{action:'read',spreadsheet:'S1',range:'Sheet1!A1:B2'});assert.match(r.text,/\(2 rows\):\n\[\["a","b"\],\["1","2"\]\]/);
 assert.match((await t.call('bot','google_sheets',{action:'write',spreadsheet:'S1',range:'Sheet1!A1',values:[['x','y']]})).text,/Wrote 2 cells/);
 assert.match(calls.at(-1).u,/valueInputOption=USER_ENTERED/);
 assert.match((await t.call('bot','google_sheets',{action:'append',spreadsheet:'S1',range:'Sheet1!A1',values:[['z',1]]})).text,/Added 1 rows/);
 assert.match((await t.call('bot','google_sheets',{action:'write',spreadsheet:'S1',range:'A1'})).text,/Give values/);
 const c=await t.call('bot','google_sheets',{action:'create',title:'Report',values:[['h']]});assert.match(c.text,/Created "Report".*NEW1/);assert.match(decodeURIComponent(calls.at(-1).u),/NEW1\/values\/'Sheet1'!A1\?valueInputOption=USER_ENTERED$/)});

test('drive read exports Google files as text, refuses binaries; upload is multipart',async()=>{const {t,calls}=await make({files:{'google_token.json':own()},routes:[
  ['GET',/files\/D1x+\?fields/,()=>({status:200,body:{id:'D1xxxxxxxxxx',name:'Plan',mimeType:'application/vnd.google-apps.document'}})],
  ['GET',/files\/D1x+\/export\?mimeType=text%2Fplain/,()=>({status:200,body:'The plan text'})],
  ['GET',/files\/P1\?fields/,()=>({status:200,body:{id:'P1',name:'x.png',mimeType:'image/png'}})],
  ['POST',/upload\/drive\/v3\/files\?uploadType=multipart/,()=>({status:200,body:{id:'U1',name:'n.csv',webViewLink:'https://drive/U1'}})]]});
 assert.match((await t.call('bot','google_drive',{action:'read',file:'https://docs.google.com/document/d/D1xxxxxxxxxx/edit'})).text,/Plan \(google document\):\n\nThe plan text/);
 assert.match((await t.call('bot','google_drive',{action:'read',file:'P1'})).text,/cannot be read as text/);
 const u=await t.call('bot','google_drive',{action:'upload',name:'n.csv',content:'a,b\n1,2',mime_type:'text/csv',convert:'sheet',folder:'https://drive.google.com/drive/folders/F1234567890'});
 assert.match(u.text,/Uploaded "n\.csv".*U1/);const c=calls.at(-1);assert.match(c.o.headers['content-type'],/^multipart\/related; boundary=/);
 const body=c.o.body.toString();assert.match(body,/"mimeType":"application\/vnd.google-apps.spreadsheet"/);assert.match(body,/"parents":\["F1234567890"\]/);assert.match(body,/a,b\n1,2/)});

test('docs: create with text, append at the end, read',async()=>{const {t,calls}=await make({files:{'google_token.json':own()},routes:[
  ['POST',/documents$/,()=>({status:200,body:{documentId:'DOC1'}})],['POST',/documents\/DOC1:batchUpdate/,()=>({status:200,body:{}})],
  ['GET',/documents\/DOC1$/,()=>({status:200,body:{title:'Notes',body:{content:[{paragraph:{elements:[{textRun:{content:'Hello\n'}}]}}]}}})]]});
 assert.match((await t.call('bot','google_docs',{action:'create',title:'Notes',text:'Hello'})).text,/document\/d\/DOC1\/edit/);
 assert.deepEqual(JSON.parse(calls[1].o.body).requests[0].insertText,{location:{index:1},text:'Hello'});
 await t.call('bot','google_docs',{action:'append',document:'DOC1',text:'More'});assert.deepEqual(JSON.parse(calls[2].o.body).requests[0].insertText,{endOfSegmentLocation:{},text:'\nMore'});
 assert.match((await t.call('bot','google_docs',{action:'read',document:'DOC1'})).text,/"Notes":\n\nHello/)});

test('calendar create: one hour by default, invitations only with notify',async()=>{const {t,calls}=await make({files:{'google_token.json':own()},routes:[
  ['POST',/calendars\/primary\/events\?sendUpdates=/,(u,o)=>({status:200,body:{...JSON.parse(o.body),id:'E1',htmlLink:'https://cal/E1'}})]]});
 const r=await t.call('bot','google_calendar',{action:'create',title:'Call',start:'2026-11-12T10:00:00',time_zone:'Asia/Jakarta',attendees:['g@example.com']});
 assert.match(r.text,/guests added without an invitation/);assert.match(calls[0].u,/sendUpdates=none/);
 const ev=JSON.parse(calls[0].o.body);assert.deepEqual(ev.end,{dateTime:'2026-11-12T11:00:00',timeZone:'Asia/Jakarta'});
 await t.call('bot','google_calendar',{action:'create',title:'Call',start:'2026-11-12',notify:true,attendees:['g@example.com']});assert.match(calls[1].u,/sendUpdates=all/);assert.deepEqual(JSON.parse(calls[1].o.body).end,{date:'2026-11-13'})});

test('a share: an expired key is minted again by aqeelOS, never refreshed here; a missing scope is said plainly',async()=>{const minted=[];
 const {t,calls}=await make({files:{'google_token_p.json':{type:'authorized_user',account:'o@example.com',token:'OLD',refresh_token:'',expiry:later(-1),aqeelos_managed:true,aqeelos_level:'read'}},
  sharedKey:async(email,a)=>{minted.push([email,a]);return 'SHARED'},routes:[['GET',/gmail.*messages\?q=/,()=>({status:200,body:{}})],['POST',/gmail.*drafts$/,()=>({status:403,body:{error:{message:'Request had insufficient authentication scopes.'}}})]]});
 assert.match((await t.call('bot','google_gmail',{action:'search',query:'x'})).text,/No messages/);assert.deepEqual(minted,[['o@example.com','bot']]);assert.equal(calls[0].o.headers.authorization,'Bearer SHARED');
 assert.ok(!calls.some(c=>/oauth2/.test(c.u)));
 const d=await t.call('bot','google_gmail',{action:'draft',to:'a@example.com',body:'x'});assert.match(d.text,/shared with you at a level that does not allow this/)});

test('a 401 renews once and retries',async()=>{let n=0;const {t}=await make({files:{'google_token.json':own()},routes:[['POST',/token$/,()=>({status:200,body:{access_token:'A2',expires_in:3600}})],
  ['GET',/drive\/v3\/files\?/,(u,o)=>(++n===1?{status:401,body:{error:{message:'expired'}}}:{status:200,body:{files:[{id:'f',name:'F',mimeType:'text/plain'}]}})]]});
 const r=await t.call('bot','google_drive',{action:'search',query:''});assert.equal(r.isError,undefined,r.text);assert.match(r.text,/- F · text\/plain/);assert.equal(n,2)});

test('an agent locked to its own files: Sheets and Docs go through google-files, the rest is refused',async()=>{const seen=[];
 const {t,calls}=await make({locked:true,filesCall:async(a,req)=>{seen.push([a,req]);return req.params.spreadsheetId==='OTHER'?{status:403,json:{error:'aqeelOS only lets this agent use its own Google files'}}:{status:200,json:{values:[['1']]}}}});
 const r=await t.call('bot','google_sheets',{action:'read',spreadsheet:'OWN',range:'A1'});assert.equal(r.isError,undefined,r.text);assert.match(r.text,/\[\["1"\]\]/);
 assert.deepEqual(seen[0],['bot',{service:'sheets',method:'spreadsheets.values.get',params:{spreadsheetId:'OWN',range:'A1'},body:undefined,account:undefined}]);
 await t.call('bot','google_sheets',{action:'append',spreadsheet:'OWN',range:'A1',values:[[2]]});assert.equal(seen[1][1].method,'spreadsheets.values.append');assert.equal(seen[1][1].params.valueInputOption,'USER_ENTERED');
 assert.match((await t.call('bot','google_sheets',{action:'read',spreadsheet:'OTHER',range:'A1'})).text,/only lets this agent use its own/);
 assert.match((await t.call('bot','google_gmail',{action:'search',query:'x'})).text,/keeps you to your own Google files/);
 assert.match((await t.call('bot','google_sheets',{action:'create',title:'x'})).text,/keeps you to your own Google files/);
 assert.equal(calls.length,0)});

test('google_accounts lists names, emails and what each may do',async()=>{const {t}=await make({files:{'google_token.json':own('me@example.com'),'google_token_p.json':{account:'o@example.com',token:'T',aqeelos_managed:true,aqeelos_level:'edit'}},policy:{google:{'o@example.com':{agents:{bot:['read','edit']}}}}});
 const r=await t.call('bot','google_accounts',{});assert.match(r.text,/main \(leave account out\) · me@example\.com · may: everything/);assert.match(r.text,/account: p · o@example\.com · may: read, edit · shared with you \(edit\)/)});
