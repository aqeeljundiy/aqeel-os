// Google APIs switched off in the install's Google Cloud project (16 Nov 2026): the project behind the install's own OAuth
// client had no API on, so every sign-in made with it failed and each agent reported it again. Now it is one owner item
// (Needs you, kind google_api) with one link, the agent is told it waits on that, a call that works takes it away, and a
// new sign-in is checked at once. Run: node --test scripts/google-api-off.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGoogleTools,apiOff,projectOf,enableLink} from '../app/google-tools.mjs';
import {createGoogleConnect} from '../app/google-connect.mjs';
import {personNeed} from '../app/bottlenecks.mjs';
import {forLadder} from '../app/agent-health.mjs';

const NOW=Date.parse('2026-11-16T10:00:00Z');
const tok=(email,cid)=>({type:'authorized_user',account:email,client_id:cid,client_secret:'s',refresh_token:'RT',token:'AT',token_uri:'https://oauth2.googleapis.com/token',expiry:new Date(NOW+3600e3).toISOString()});
const OFF='Google Sheets API has not been used in project 111111111111 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=111111111111 then retry.';
const offBody={error:{code:403,message:OFF,status:'PERMISSION_DENIED',details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',reason:'SERVICE_DISABLED',domain:'googleapis.com',metadata:{service:'sheets.googleapis.com',consumer:'projects/111111111111'}}]}};
// Bottlenecks as the server has it: event (a newer one on a topic replaces it), resolve, events
function fakeNeeds(){const ev=[];return {ev,event:async(kind,text,detail,o={})=>{const i=ev.findIndex(x=>x.topic===o.topic);if(i>=0)ev.splice(i,1);ev.push({kind,text,detail,...o})},
 resolve:async t=>{const n=ev.length;for(let i=ev.length-1;i>=0;i--)if(ev[i].topic===t)ev.splice(i,1);return n-ev.length},events:async()=>ev.map(x=>({...x}))}}
async function make({off=true,needs=fakeNeeds()}={}){const H=await mkdtemp(path.join(tmpdir(),'gao-')),home=path.join(H,'profiles','bot');await mkdir(home,{recursive:true});
 // the person's own sign-in, made with the install's new client (project 111111111111), and a share made with an older one
 await writeFile(path.join(home,'google_token_own.json'),JSON.stringify(tok('person@example.test','111111111111-new.apps.googleusercontent.com')));
 await writeFile(path.join(home,'google_token_team.json'),JSON.stringify(tok('team@example.test','222222222222-old.apps.googleusercontent.com')));
 const state={off},calls=[];
 const fetchImpl=async(u,o={})=>{calls.push(String(u));
  const x=state.off?{status:403,body:offBody}:{status:200,body:{sheets:[{properties:{sheetId:0,title:'Leads',index:0}}]}};const t=JSON.stringify(x.body);return {ok:x.status<300,status:x.status,json:async()=>JSON.parse(t),text:async()=>t}};
 const t=createGoogleTools({HERMES_HOME:H,fetchImpl,now:()=>NOW,needs:()=>needs});return {t,needs,state,calls}}
const read=t=>t.call('bot','google_sheets',{action:'list_sheets',account:'own',spreadsheet:'S1'});

test('the project of a sign-in and the one link that switches on every API aqeelOS uses',()=>{
 assert.equal(projectOf('111111111111-new.apps.googleusercontent.com'),'111111111111');assert.equal(projectOf('junk'),'');
 const l=enableLink('111111111111');assert.match(l,/^https:\/\/console\.cloud\.google\.com\/flows\/enableapi\?apiid=/);
 for(const a of ['sheets','drive','docs','gmail','calendar-json','people'])assert.ok(l.includes(a+'.googleapis.com'),a);assert.match(l,/&project=111111111111$/)});

test('API off: one owner item with the link, the agent is told it waits on the owner and not to report it again',async()=>{const {t,needs}=await make();
 const r=await read(t);assert.equal(r.isError,true);
 assert.match(r.text,/sheets API is switched off in this install's Google Cloud project \(111111111111\)/);assert.match(r.text,/nothing is wrong with the account/);
 assert.match(r.text,/already asked the owner/);assert.match(r.text,/do not report it again with report_bottleneck/);
 // the other account was made with another project: the agent may try it
 assert.match(r.text,/team \(team@example\.test\) uses another Google Cloud project/);
 assert.equal(needs.ev.length,1);const e=needs.ev[0];assert.equal(e.kind,'google_api');assert.equal(e.topic,'google_api|111111111111');
 assert.equal(e.data.link,enableLink('111111111111'));assert.equal(e.data.api,'sheets.googleapis.com');assert.match(e.text,/111111111111/);
 // a second agent call keeps the same item (its "Not now" and id stay), it is not added again
 const first=needs.ev[0];await read(t);assert.equal(needs.ev.length,1);assert.equal(needs.ev[0],first)});

test('the item is for a person, never the fixer, and goes away by itself at the first call that works',async()=>{const {t,needs,state}=await make();
 await read(t);const item={kind:'google_api',id:'event|e1',title:needs.ev[0].text,text:needs.ev[0].detail};
 assert.match(personNeed(item),/Switch on the Google APIs/);assert.equal(forLadder(item),false);
 state.off=false;const r=await read(t);assert.equal(r.isError,undefined);assert.equal(needs.ev.length,0)});

test('with no owner list wired the agent still gets the link and reports it',async()=>{const H=await mkdtemp(path.join(tmpdir(),'gao-')),home=path.join(H,'profiles','bot');await mkdir(home,{recursive:true});
 await writeFile(path.join(home,'google_token.json'),JSON.stringify(tok('person@example.test','111111111111-new.apps.googleusercontent.com')));
 const t=createGoogleTools({HERMES_HOME:H,now:()=>NOW,fetchImpl:async()=>({ok:false,status:403,json:async()=>offBody,text:async()=>JSON.stringify(offBody)})});
 const r=await t.call('bot','google_sheets',{action:'list_sheets',spreadsheet:'S1'});assert.match(r.text,/report it with report_bottleneck/);assert.ok(r.text.includes(enableLink('111111111111')));
 assert.match(apiOff('x'),/this tool cannot work yet/)});

test('a new sign-in is checked at once: an API that is off is the owner\'s item before any agent meets it',async()=>{const needs=fakeNeeds();const seen=[];
 const off=new Set(['sheets.googleapis.com','docs.googleapis.com']);
 const fetchImpl=async u=>{u=String(u);seen.push(u);const host=new URL(u).host,isOff=off.has(host);const b=isOff?offBody:{error:{code:404,message:'Requested entity was not found.'}};
  const st=isOff?403:/spreadsheets|documents/.test(u)?404:200;return {ok:st<300,status:st,json:async()=>b,text:async()=>JSON.stringify(b)}};
 const H=await mkdtemp(path.join(tmpdir(),'gao-'));const t=createGoogleTools({HERMES_HOME:H,fetchImpl,now:()=>NOW,needs:()=>needs});
 const r=await t.probe({token:'AT',client_id:'111111111111-new.apps.googleusercontent.com',services:['sheets','docs','drive','gmail'],email:'person@example.test'});
 assert.deepEqual(r,{off:['sheets','docs'],project:'111111111111'});assert.equal(needs.ev.length,1);assert.equal(needs.ev[0].topic,'google_api|111111111111');
 off.clear();const ok=await t.probe({token:'AT',client_id:'111111111111-new.apps.googleusercontent.com',services:['sheets']});assert.deepEqual(ok.off,[]);assert.equal(needs.ev.length,0)});

test('Connect Google runs the check after a sign-in and says which APIs are off',async()=>{const T=await mkdtemp(path.join(tmpdir(),'gao-c-')),H=path.join(T,'hh'),DATA=path.join(T,'data');await mkdir(H,{recursive:true});
 const jwt=o=>'x.'+Buffer.from(JSON.stringify(o)).toString('base64url')+'.y';const got=[];
 const fetchImpl=async(u,o={})=>{const b=Object.fromEntries(new URLSearchParams(o.body||''));if(b.grant_type==='authorization_code')return {ok:true,json:async()=>({access_token:'at',refresh_token:'r',expires_in:3600,scope:'openid https://www.googleapis.com/auth/spreadsheets',id_token:jwt({email:'person@example.test'})})};throw Error('unexpected '+u)};
 const g=createGoogleConnect({HERMES_HOME:H,DATA,PUBLIC_URL:'https://ai.example.test',fetchImpl,afterConnect:async x=>{got.push(x);return {off:['sheets'],project:'111111111111'}}});
 await g.saveClient(JSON.stringify({web:{client_id:'111111111111-new.apps.googleusercontent.com',client_secret:'s',project_id:'made-up-project',redirect_uris:['https://ai.example.test/google-oauth/callback']}}));
 const s=await g.start({agent:'default',services:['sheets']});const r=await g.finish('?state='+s.state+'&code=c');
 assert.equal(r.ok,true);assert.deepEqual(r.apisOff,['Sheets']);assert.equal(r.project,'made-up-project');
 assert.equal(got.length,1);assert.deepEqual(got[0].services,['sheets']);assert.equal(got[0].token,'at');assert.equal(got[0].client_id,'111111111111-new.apps.googleusercontent.com')});
