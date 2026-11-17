// An agent's scripts call its connected tools (app/tool-bridge.mjs, scripts/tool-bridge.py; 17 Nov 2026: a daily Airtable → Sheet sync
// of 6,000 records could only run through the chat). A fake engine worker stands in for scripts/tool-bridge.py.
// Run: node --test scripts/tool-bridge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createToolBridge,scriptServers} from '../app/tool-bridge.mjs';
import {createAgentOps} from '../app/agent-ops.mjs';
import {signedIn} from '../app/relay-keys.mjs';
import {createGoogleTools} from '../app/google-tools.mjs';
import {writeFile} from 'node:fs/promises';

const CFG={mcp_servers:{'aqeelos-notify':{url:'http://127.0.0.1:4400/mcp/notify/a/x'},'local-thing':{url:'http://localhost:9000/mcp'},airtable:{url:'https://mcp.example.test/mcp',auth:'oauth'},
 n8n:{url:'https://n8n.example.test/mcp',headers:{Authorization:'Bearer x'}},off:{url:'https://off.example.test/mcp',enabled:false}}};
// a fake worker: answers ready with its tools, then each call line with structured data (or a connect failure)
function fakeSpawn({tools=['list_records','create_records'],fail=null}={}){const spawned=[];
 const spawn=(cmd,args,opts)=>{const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();c.killed=false;c.kill=()=>{c.killed=true;c.emit('exit',0)};
  spawned.push({cmd,args,opts,child:c,calls:[]});const me=spawned.at(-1);
  setImmediate(()=>c.stdout.write(JSON.stringify(fail?{ready:false,error:fail}:{ready:true,tools})+'\n'));
  let buf='';c.stdin.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const j=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);me.calls.push(j);
   c.stdout.write(JSON.stringify({id:j.id,ok:true,isError:false,text:'',structured:{records:[{id:'rec'+j.id}],args:j.arguments}})+'\n')}});
  c.stdin.on('finish',()=>setImmediate(()=>c.emit('exit',0)));return c};
 return {spawn,spawned}}
const google={TOOLS:[{name:'google_sheets'},{name:'google_drive'}],calls:[],async call(a,t,args,o){this.calls.push([a,t,args,o]);return {text:'Leads: 3 rows'}}};
async function make(o={}){const H=await mkdtemp(path.join(tmpdir(),'tb-')),W=path.join(H,'workspaces');await mkdir(path.join(W,'bot'),{recursive:true});
 const f=fakeSpawn(o);google.calls=[];
 const b=createToolBridge({HERMES_HOME:path.join(H,'.hermes'),WORK:W,PORT:4400,sig:a=>'sig-'+a,homeOf:a=>path.join(H,'.hermes','profiles',a),python:async()=>'/engine/python',readConfig:async a=>a==='bot'?CFG:null,googleTools:google,spawn:f.spawn,idleMs:o.idleMs??60000,log:()=>{}});
 return {b,H,W,...f}}

test('a script may use the agent\'s own enabled servers, never aqeelOS\'s loopback ones',()=>{
 assert.deepEqual(scriptServers(CFG),['airtable','n8n']);assert.deepEqual(scriptServers({}),[])});

test('one call through the engine worker: the agent\'s home, the engine\'s folder, the server; its answer as data',async()=>{const t=await make();
 const r=await t.b.call('bot',{server:'airtable',tool:'list_records',arguments:{baseId:'app1',offset:'x'}});
 assert.equal(r.status,200);assert.equal(r.json.ok,true);assert.deepEqual(r.json.structured.records,[{id:'rec1'}]);assert.deepEqual(r.json.structured.args,{baseId:'app1',offset:'x'});
 const s=t.spawned[0];assert.equal(s.cmd,'/engine/python');assert.match(s.args[0],/scripts[\\/]tool-bridge\.py$/);assert.equal(s.args[1],path.join(t.H,'.hermes','hermes-agent'));assert.equal(s.args[2],'airtable');
 assert.equal(s.opts.env.HERMES_HOME,path.join(t.H,'.hermes','profiles','bot'));assert.equal('DISPLAY' in s.opts.env,false);
 // a paging loop reuses the same worker: one connect, many calls
 for(let i=0;i<5;i++)await t.b.call('bot',{server:'airtable',tool:'list_records',arguments:{offset:String(i)}});
 assert.equal(t.spawned.length,1);assert.equal(s.calls.length,6);t.b.close()});

test('a numbered copy uses its base agent; nothing else is offered',async()=>{const t=await make();
 assert.equal((await t.b.call('bot--2',{server:'airtable',tool:'list_records'})).status,200);assert.equal(t.spawned[0].opts.env.HERMES_HOME,path.join(t.H,'.hermes','profiles','bot'));
 const own=await t.b.call('bot',{server:'aqeelos-notify',tool:'notify'});assert.equal(own.status,404);assert.match(own.json.error,/Yours: airtable, n8n, and google/);
 assert.equal((await t.b.call('bot',{server:'off',tool:'x'})).status,404);
 const no=await t.b.call('bot',{server:'airtable',tool:'drop_everything'});assert.equal(no.status,404);assert.match(no.json.error,/no tool drop_everything/);assert.equal(t.spawned[0].calls.length,1,'a refused tool is never sent');
 assert.equal((await t.b.call('nobody',{server:'airtable',tool:'list_records'})).status,404);
 assert.equal((await t.b.call('bot',{server:'airtable'})).status,400);t.b.close()});

test('Google from a script: the same google_* tools and rules as in chat',async()=>{const t=await make();
 const r=await t.b.call('bot',{server:'google',tool:'google_sheets',arguments:{action:'read',spreadsheet:'S',range:'Leads!A1:B2'}});
 assert.equal(r.status,200);assert.equal(r.json.text,'Leads: 3 rows');assert.deepEqual(google.calls,[['bot','google_sheets',{action:'read',spreadsheet:'S',range:'Leads!A1:B2'},{full:true}]]);
 assert.equal((await t.b.call('bot',{server:'google',tool:'gmail_raw'})).status,404);assert.equal(t.spawned.length,0)});

test('list: every server with the tools a script may call',async()=>{const t=await make();const r=await t.b.call('bot',{op:'list'});
 assert.deepEqual(r.json.servers,{google:['google_sheets','google_drive'],airtable:['list_records','create_records'],n8n:['list_records','create_records']});t.b.close()});

test('a server that cannot connect says why, and the next call tries again',async()=>{const t=await make({fail:'needs sign-in: run the Airtable sign-in in aqeelOS'});
 const r=await t.b.call('bot',{server:'airtable',tool:'list_records'});assert.equal(r.status,502);assert.match(r.json.error,/needs sign-in/);
 await t.b.call('bot',{server:'airtable',tool:'list_records'});assert.equal(t.spawned.length,2)});

test('an idle worker is stopped, and a later call starts a new one',async()=>{const t=await make({idleMs:30});
 await t.b.call('bot',{server:'airtable',tool:'list_records'});await new Promise(r=>setTimeout(r,120));assert.equal(t.b._pool.size,0);
 await t.b.call('bot',{server:'airtable',tool:'list_records'});assert.equal(t.spawned.length,2);t.b.close()});

test('helpers in the agent\'s folder: the signed address, no key, the same each time',async()=>{const t=await make();
 assert.equal(await t.b.ensureClients(['bot','bot--2','gone']),2);
 const mod=await readFile(path.join(t.W,'bot','.tools','aqtools.py'),'utf8'),cli=await readFile(path.join(t.W,'bot','.tools','aqtool'),'utf8');
 assert.match(mod,/http:\/\/127\.0\.0\.1:4400\/tool-call\/bot\/sig-bot/);assert.doesNotMatch(mod+cli,/Bearer|secret|token/i);assert.match(cli,/aqtool list/);
 if(process.platform!=='win32'){assert.equal((await stat(path.join(t.W,'bot','.tools'))).mode&0o777,0o775);assert.equal((await stat(path.join(t.W,'bot','.tools','aqtool'))).mode&0o777,0o775)}
 assert.equal(await t.b.ensureClients(['bot']),0)});

test('agent-ops hosts it for every agent (signed tool-call:<agent>), and key rotation finds its address',async()=>{const H=await mkdtemp(path.join(tmpdir(),'tb-')),W=path.join(H,'workspaces');await mkdir(path.join(W,'bot'),{recursive:true});
 const ops=createAgentOps({HERMES_HOME:path.join(H,'.hermes'),WORK:W,PORT:4400,sign:s=>'S'.repeat(8)+s.replace(/\W/g,'').padEnd(40,'x'),kirimdev:{lines:async()=>({})},enginePython:async()=>'/py',readConfig:async()=>CFG,googleTools:google,listAgents:async()=>['bot'],log:()=>{}});
 assert.ok(ops.tools);assert.equal(await ops.ensureClients(),2);
 const mod=await readFile(path.join(W,'bot','.tools','aqtools.py'),'utf8');assert.match(mod,/\/tool-call\/bot\/SSSSSSSStoolcallbot/);
 const found=signedIn(mod);assert.equal(found.length,1);assert.equal(found[0].label,'tool-call:');assert.equal(found[0].agent,'bot');
 // without the engine the old agent-ops is unchanged
 assert.equal(createAgentOps({WORK:W,PORT:4400,sig:a=>'sig-'+a,kirimdev:{lines:async()=>({})},log:()=>{}}).tools,null)});

test('a long Sheets read: cut for the chat, whole for a script, and the two never mix',async()=>{const H=await mkdtemp(path.join(tmpdir(),'tb-g-')),home=path.join(H,'profiles','bot');await mkdir(home,{recursive:true});
 await writeFile(path.join(home,'google_token.json'),JSON.stringify({type:'authorized_user',account:'me@example.test',client_id:'1-x.apps.googleusercontent.com',client_secret:'s',refresh_token:'R',token:'T',expiry:'2999-01-01T00:00:00Z'}));
 const rows=Array.from({length:3000},(_,i)=>['rec'+String(i).padStart(14,'0'),'Name '+i,'2026-11-0'+(i%9+1)]);
 const fetchImpl=async()=>{await new Promise(r=>setTimeout(r,5));const t=JSON.stringify({range:'Leads!A1:C3000',values:rows});return {ok:true,status:200,json:async()=>JSON.parse(t),text:async()=>t}};
 const g=createGoogleTools({HERMES_HOME:H,fetchImpl});const args={action:'read',spreadsheet:'S1',range:'Leads!A1:C3000'};
 const [chat,script]=await Promise.all([g.call('bot','google_sheets',args),g.call('bot','google_sheets',args,{full:true})]);
 assert.match(chat.text,/cut at 40000 characters/);assert.ok(chat.text.length<41000);
 assert.doesNotMatch(script.text,/cut at/);assert.ok(script.text.includes('rec00000000002999'))});
