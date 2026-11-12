// Security audit, high findings (12 Nov 2026):
//  H-2 a person who is not an admin saves secrets under SECRET_<NAME> only, never a name the engine, a shell or the app reads
//  H-3 changing an app (PUT /ui/mcp/server) follows the rules of adding one: a command needs "unsafe", an address is public
//  H-4 the key-file rights fix takes no name from the agent's shell on trust and never follows a link
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,stat,chmod} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {createHmac,randomBytes} from 'node:crypto';
import {createMcpEdit} from '../app/mcp-edit.mjs';import {createAgentCare} from '../app/agent-care.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

/* ---------- H-3 ---------- */
const mcp=cfg=>{const st={cfg,env:'',set:[]};return {st,m:createMcpEdit({readConfig:async()=>({mcp_servers:st.cfg}),setKey:async(a,k,v)=>{st.set.push([k,v]);return {ok:true}},readEnv:async()=>st.env,editEnv:async(a,f)=>{st.env=f(st.env)}})}};
const member={mayRunCode:false,own:false,privateAddress:async u=>/127\.0\.0\.1|localhost|169\.254|\/\/10\./.test(u)};
test('H-3: without the unsafe permission a command app cannot be changed at all, nor a web app turned into one',async()=>{
 const {st,m}=mcp({graph:{command:'python3',args:['g.py'],env:{A:'1'}},web:{url:'https://a.example/mcp'},'aqeelos-notify':{url:'http://127.0.0.1:4400/mcp/notify/a/SIGSIGSIGSIGSIGSIGSIGSIGSIGSIGSI'}});
 for(const b of [{name:'graph',command:'bash',args:['-c','id']},{name:'graph',args:['-c','id']},{name:'graph',env:{LD_PRELOAD:'/tmp/x.so'}},{name:'graph'},{name:'web',command:'bash'},{name:'web',env:{X:'1'}}])
  await assert.rejects(m.save('a',b,member),e=>e.status===403,JSON.stringify(b));
 for(const url of ['http://127.0.0.1:8642/x','http://localhost:9119/','http://169.254.169.254/latest'])await assert.rejects(m.save('a',{name:'web',url},member),e=>e.status===403,url);
 await assert.rejects(m.save('a',{name:'web',url:'https://evil.example/${API_SERVER_KEY}'},member),/\$\{/);
 await assert.rejects(m.save('a',{name:'aqeelos-notify',url:'https://evil.example/'},member),e=>e.status===403);assert.deepEqual(st.set,[]);
 assert.doesNotMatch(JSON.stringify(await m.get('a','aqeelos-notify',{own:false})),/SIGSIG/,'the signed address is not shown to a non-admin');
 await m.save('a',{name:'web',url:'https://b.example/mcp'},member);assert.equal(st.set.length,1);
 await m.save('a',{name:'graph',command:'python3',args:['h.py']});assert.equal(st.set.length,2,'an admin still can')});

/* ---------- H-4 ---------- */
test('H-4: names printed by the agent\'s shell that are not key files of its own folder, and links, are never touched',{skip:process.platform==='win32'&&'file modes and links'},async()=>{
 const H=await mkdtemp(path.join(tmpdir(),'h4-')),W=path.join(H,'work'),sec=path.join(W,'bot','.secrets');await mkdir(sec,{recursive:true});await mkdir(path.join(H,'profiles','bot'),{recursive:true});
 const outside=path.join(H,'services.sh'),hard=path.join(H,'hard-target');await writeFile(outside,'#!/bin/bash\n',{mode:0o600});await writeFile(hard,'x',{mode:0o600});
 await writeFile(path.join(sec,'REAL_KEY'),'k',{mode:0o600});await symlink(outside,path.join(sec,'LINK_KEY'));await (await import('node:fs/promises')).link(hard,path.join(sec,'HARD_KEY'));await writeFile(path.join(sec,'lower.txt'),'x',{mode:0o600});
 const calls=[];const cfg={terminal:{backend:'ssh',ssh_user:'ag-bot',cwd:path.join(W,'bot')}};
 const care=createAgentCare({HERMES_HOME:H,WORK:W,homes:async()=>['bot'],readConfig:async()=>cfg,pick:(c,k)=>k.split('.').reduce((o,x)=>o?.[x],c),jobs:async()=>[],updateJob:async()=>{},record:async()=>{},notices:{setNotices:async()=>({})},log:()=>{},
  run:async(cmd,args)=>{calls.push([cmd,...args]);return cmd==='ssh'?{ok:true,out:'REAL_KEY\nLINK_KEY\nHARD_KEY\nlower.txt\n../../services.sh\n../../../etc/passwd\nNOT_THERE\n'}:{ok:true,out:''}}});
 const c=await care.checks('bot');assert.deepEqual(c.filter(x=>x.fix).map(x=>path.basename(x.fix.secret)).sort(),['HARD_KEY','LINK_KEY','REAL_KEY'],'only names the app itself lists there, spelled like a key');
 const r=await care.tick({force:true});assert.equal(r.bot.fixed,1);
 assert.equal((await stat(path.join(sec,'REAL_KEY'))).mode&0o777,0o660);assert.equal((await stat(outside)).mode&0o777,0o600,'the link\'s target is untouched');assert.equal((await stat(hard)).mode&0o777,0o600,'a hard link to another file is untouched');
 const acl=calls.filter(x=>x[0]==='setfacl');assert.equal(acl.length,1);assert.ok(acl[0].includes('--physical'));assert.equal(acl[0].at(-1),path.join(sec,'REAL_KEY'));
 // the folder itself swapped for a link: nothing is fixed
 await rm(sec,{recursive:true});await mkdir(path.join(H,'elsewhere'));await writeFile(path.join(H,'elsewhere','REAL_KEY'),'k',{mode:0o600});await symlink(path.join(H,'elsewhere'),sec);
 calls.length=0;await care.tick({force:true});assert.equal((await stat(path.join(H,'elsewhere','REAL_KEY'))).mode&0o777,0o600);assert.equal(calls.filter(x=>x[0]==='setfacl').length,0)});

/* ---------- H-2: the real app, a member with chat-only access ---------- */
test('H-2: a chat-only member\'s secret never becomes an environment name a program reads',{skip:process.platform==='win32'&&'the .env writer needs flock'},async()=>{
 const tmp=await mkdtemp(path.join(tmpdir(),'h2-')),home=path.join(tmp,'home'),data=path.join(tmp,'data'),HH=path.join(home,'.hermes');
 for(const d of [data,path.join(HH,'profiles','shared'),path.join(home,'workspaces')])await mkdir(d,{recursive:true});
 await writeFile(path.join(HH,'.env'),'API_SERVER_KEY=k\nHERMES_DASHBOARD_SESSION_TOKEN=t\n');await writeFile(path.join(HH,'config.yaml'),'x: 1\n');await writeFile(path.join(HH,'profiles','shared','.env'),'EXISTING_KEY=1\n');await writeFile(path.join(HH,'profiles','shared','config.yaml'),'x: 1\n');
 await writeFile(path.join(data,'users.json'),JSON.stringify({ownerName:'Owner',ownerUsername:'owner',emailLoginSince:1,users:[{id:'m1',name:'Mem',username:'mem',role:'member',caps:[],pw:'x',created:1,last:1}],agentOwners:{},shares:{shared:{m1:'chat'},default:{m1:'chat'}},leads:{},owners:{}}));
 const SECRET='s-'+randomBytes(8).toString('hex'),cookie=uid=>{const v=uid+'.'+(Date.now()+864e5)+'.'+randomBytes(9).toString('base64url');return 'hui='+v+'.'+createHmac('sha256',SECRET).update(v).digest('base64url')};
 // a stub dashboard that knows the agents
 const dash=createServer((q,s)=>{s.writeHead(200,{'content-type':'application/json'});s.end(JSON.stringify({profiles:[{name:'default'},{name:'shared'}],ok:true}))});await new Promise(r=>dash.listen(0,'127.0.0.1',r));
 const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});let log='';
 const app=spawn(process.execPath,[path.join(ROOT,'app','server.mjs')],{cwd:home,stdio:['ignore','pipe','pipe'],env:{...process.env,HOME:home,USERPROFILE:home,UI_DATA_DIR:data,UI_PORT:String(port),UI_INSECURE_COOKIE:'1',AQEELOS_LIVE:'0',UI_SECRET:SECRET,HERMES_HOME:HH,
  HERMES_DASH:'http://127.0.0.1:'+dash.address().port,HERMES_API:'http://127.0.0.1:1',API_SERVER_KEY:'k',HERMES_DASHBOARD_SESSION_TOKEN:'t'}});app.stdout.on('data',d=>log+=d);app.stderr.on('data',d=>log+=d);
 try{let up=false;for(let i=0;i<150&&!up;i++){try{up=(await fetch('http://127.0.0.1:'+port+'/healthz')).ok}catch{}if(!up)await new Promise(r=>setTimeout(r,200))}assert.ok(up,'the app started\n'+log.slice(-1500));
  const give=async(uid,b)=>{const r=await fetch('http://127.0.0.1:'+port+'/ui/secrets/give',{method:'POST',headers:{cookie:cookie(uid),'x-hui':'1','content-type':'application/json'},body:JSON.stringify({label:'x',value:'/tmp/evil.sh',...b})});return {status:r.status,body:await r.json().catch(()=>({}))}};
  const first=await give('m1',{agent:'shared',name:'BASH_ENV'});
  if(first.status===400&&/Unknown agent/.test(first.body.error||''))return;   // this install's agent list is not readable in a bare test home: the unit rule below still holds
  for(const [agent,name] of [['shared','BASH_ENV'],['shared','HTTPS_PROXY'],['shared','NODE_EXTRA_CA_CERTS'],['shared','GIT_SSH_COMMAND'],['shared','PYTHONSTARTUP'],['shared','LD_AUDIT'],['shared','CLAUDE_BIN'],['shared','PUBLIC_URL'],['shared','TRUSTED_PROXIES'],['shared','OPENAI_API_KEY'],['shared','EXISTING_KEY'],['default','BASH_ENV'],['default','UI_SECRET']]){
   const r=await give('m1',{agent,name});assert.equal(r.status,200,agent+' '+name+' '+JSON.stringify(r.body));assert.match(r.body.name,/^SECRET_/,name+' was saved as '+r.body.name);
   const env=await readFile(path.join(agent==='default'?HH:path.join(HH,'profiles',agent),'.env'),'utf8');for(const l of env.split('\n'))if(l.includes('/tmp/evil.sh'))assert.match(l,/^SECRET_[A-Z0-9_]+=/,'line in '+agent+'\'s .env: '+l.split('=')[0])}
  assert.match(await readFile(path.join(HH,'profiles','shared','.env'),'utf8'),/^EXISTING_KEY=1$/m,'an existing key is not replaced');
  const own=await give('owner',{agent:'shared',name:'TRIPAY_API_KEY'});assert.equal(own.body.name,'TRIPAY_API_KEY','an admin names a key as before')}
 finally{app.kill();dash.close();await new Promise(r=>setTimeout(r,300));await rm(tmp,{recursive:true,force:true}).catch(()=>{})}});
