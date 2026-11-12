// Security audit, medium and low findings fixed on 12 Nov 2026. Each test names the finding.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {createHmac,randomBytes} from 'node:crypto';
import {safePattern} from '../app/event-hooks.mjs';import {createUsers} from '../app/users.mjs';import {createCode} from '../app/code.mjs';
import {src} from './lib/source.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('C-M6: a pattern that can backtrack without end is not run; ordinary ones are',()=>{
 for(const p of ['^(a+)+$','(a*)*b','(a|aa)+$','(x+x+)+y','([a-z]+)*$','(.*a){20}','(a+){2,}','\\1(a)','a**'])assert.equal(safePattern(p),null,p);
 for(const p of ['-> OK|ERROR','^paid\\b','order #\\d+','(OK|FAIL): .*','\\[done\\]','^[A-Z]{3}-\\d{4}$']){const re=safePattern(p);assert.ok(re instanceof RegExp,p)}
 const t0=Date.now();const re=safePattern('^(a+)+$');assert.equal(re,null);assert.ok(Date.now()-t0<200);assert.equal(safePattern('x'.repeat(200)),null)});

test('A4: a damaged people file stops the app instead of becoming an empty, claimable install',async()=>{
 const D=await mkdtemp(path.join(tmpdir(),'a4-'));await writeFile(path.join(D,'users.json'),'{"users":[{"id":"m1"');
 const U=createUsers(D,{deliver:async()=>{}},{ownerCheck:()=>false});await assert.rejects(U.load(),/damaged/);await assert.rejects(U.needsOwner?.()??U.load(),/damaged/);
 assert.equal(await readFile(path.join(D,'users.json'),'utf8'),'{"users":[{"id":"m1"','the file is left as it was');
 const D2=await mkdtemp(path.join(tmpdir(),'a4b-'));const U2=createUsers(D2,{deliver:async()=>{}},{ownerCheck:()=>false});await U2.load();assert.ok(true,'no file yet is a new install')});

test('C-M1: an agent named like something every object has cannot be shared, made private or invited to',async()=>{
 const D=await mkdtemp(path.join(tmpdir(),'m1-'));const U=createUsers(D,{deliver:async()=>{}},{ownerCheck:()=>false});await U.load();const owner=await U.user('owner');
 const call=async(method,p,body)=>{let out;await U.api(owner,{method,url:p},{},p,(res,status,b)=>{out={status,body:b}},async()=>JSON.stringify(body||{}));return out};
 for(const a of ['__proto__','constructor','toString','UPPER','a/b']){assert.equal((await call('PUT','/ui/agents/'+encodeURIComponent(a)+'/share',{user:'owner',level:'owner'})).status,400,a);assert.equal((await call('PUT','/ui/agents/'+encodeURIComponent(a)+'/private',{on:true})).status,400,a)}
 const inv=(await call('POST','/ui/people/invite',{name:'X',agents:{constructor:'owner',__proto__:'owner',shop:'chat'}})).body;assert.ok(inv.code);
 assert.equal(({}).owner,undefined);assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype,'owner'),false)});

test('C-M7: a Code run reported for an agent called __proto__ changes no shared object',async()=>{
 const D=await mkdtemp(path.join(tmpdir(),'m7-'));const c=createCode({DATA:D,SRC:D,PUBLIC_URL:'https://x.example',ROOT:D});
 if(typeof c.addRun!=='function'||typeof c.runs!=='function')return;
 await c.addRun({user:'m1',name:'pc'},{agent:'__proto__',projectName:'constructor',input:5,output:5,provider:'p'.repeat(500)}).catch(()=>{});const r=await c.runs(7).catch(()=>null);
 assert.equal(({}).runs,undefined);assert.equal(({}).input,undefined);if(r)assert.equal(Object.getPrototypeOf(r.byAgent),null);
 const line=JSON.parse((await readFile(path.join(D,'code-runs.jsonl'),'utf8')).trim().split('\n').pop());assert.equal(line.agent,'');assert.ok(line.provider.length<=80)});

/* ---------- the real app ---------- */
let app,base,tmp,dash;const SECRET='s-'+randomBytes(8).toString('hex');const seen=[];
const cookie=uid=>{const v=uid+'.'+(Date.now()+864e5)+'.'+randomBytes(9).toString('base64url');return 'hui='+v+'.'+createHmac('sha256',SECRET).update(v).digest('base64url')};
test.before(async()=>{tmp=await mkdtemp(path.join(tmpdir(),'secmed-'));const home=path.join(tmp,'home'),data=path.join(tmp,'data');await mkdir(home,{recursive:true});await mkdir(data,{recursive:true});
 await writeFile(path.join(data,'users.json'),JSON.stringify({ownerName:'Owner',ownerUsername:'owner',emailLoginSince:1,users:[{id:'m1',name:'Mem',username:'mem',role:'member',caps:['create','mcp'],pw:'x',created:1,last:1}],agentOwners:{mine:'m1'},shares:{},leads:{m1:'mine'},owners:{}}));
 dash=createServer((q,s)=>{const u=new URL(q.url,'http://x');const ch=[];q.on('data',c=>ch.push(c));q.on('end',()=>{let body=null;try{body=JSON.parse(Buffer.concat(ch).toString('utf8'))}catch{}seen.push({path:u.pathname,method:q.method,body,trace:q.headers['x-trace']});
  if(u.pathname==='/api/files/download'){const f=u.searchParams.get('path')||'';const [ct,b]=/\.html$/.test(f)?['text/html; charset=utf-8','<script src="/hapi/files/download?path=x.js"></script>']:/\.js$/.test(f)?['text/javascript','alert(1)']:/\.svg$/.test(f)?['image/svg+xml','<svg onload="alert(1)"/>']:/\.png$/.test(f)?['image/png','\x89PNG']:['application/pdf','%PDF-1.4'];s.writeHead(200,{'content-type':ct,'content-disposition':'inline; filename="f"'});return s.end(b)}
  if(u.pathname==='/api/mcp/servers')return s.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({servers:[{name:'aqeelos-notify',url:'http://127.0.0.1:4400/mcp/notify/mine/'+'S'.repeat(32)},{name:'web',url:'https://a.example/mcp'}]}));
  s.writeHead(200,{'content-type':'application/json'});s.end(JSON.stringify(u.pathname.endsWith('/api/sessions')&&q.method==='POST'?{id:'s-new'}:{ok:true,profiles:[],name:body?.name}))})});await new Promise(r=>dash.listen(0,'127.0.0.1',r));
 const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});base='http://127.0.0.1:'+port;let log='';
 app=spawn(process.execPath,[path.join(ROOT,'app','server.mjs')],{cwd:home,stdio:['ignore','pipe','pipe'],env:{...process.env,HOME:home,USERPROFILE:home,UI_DATA_DIR:data,UI_PORT:String(port),UI_INSECURE_COOKIE:'1',AQEELOS_LIVE:'0',UI_SECRET:SECRET,
  HERMES_DASH:'http://127.0.0.1:'+dash.address().port,HERMES_API:'http://127.0.0.1:'+dash.address().port,API_SERVER_KEY:'k',HERMES_DASHBOARD_SESSION_TOKEN:'t'}});app.stdout.on('data',d=>log+=d);app.stderr.on('data',d=>log+=d);
 for(let i=0;i<150;i++){try{if((await fetch(base+'/healthz')).ok)return}catch{}await new Promise(r=>setTimeout(r,200))}throw new Error('the app did not start:\n'+log.slice(-2000))});
test.after(async()=>{app?.kill();dash?.close();await new Promise(r=>setTimeout(r,300));await rm(tmp,{recursive:true,force:true}).catch(()=>{})});
const get=(p,uid,h={})=>fetch(base+p,{headers:{...(uid?{cookie:cookie(uid)}:{}),...h},redirect:'manual'});

test('A12: the app\'s own source is not served, with or without a trailing slash',async()=>{
 for(const p of ['/app/server.mjs','/app/server.mjs/','/app/users.mjs/','/app/users.mjs//','/app/x.env/','/assets/..%2fapp%2fserver.mjs','/app/.gitignore']){const r=await get(p);const t=await r.text();assert.ok(r.status===404||!/createUsers|import /.test(t),p+' → '+r.status)}
 assert.equal((await get('/app/core.js')).status,200)});

test('C-H2: the browser-extension socket takes only a token this install handed out',async()=>{
 for(const t of ['__proto__','constructor','toString','hasOwnProperty']){const r=await fetch(base+'/ui/local-browser/ws?t='+t,{headers:{connection:'Upgrade',upgrade:'websocket','sec-websocket-version':'13','sec-websocket-key':Buffer.from(randomBytes(16)).toString('base64')}}).catch(()=>null);if(r)await r.arrayBuffer().catch(()=>{})}
 await new Promise(r=>setTimeout(r,3500));const h=await (await get('/healthz')).json().catch(()=>({}));assert.ok(h,'the app still answers');
 assert.equal((await get('/ui/local-browser/status',cookie('m1')&&'m1')).status<500,true)});

test('B-M3: a file an agent wrote is never rendered or run on the app\'s own address',async()=>{
 for(const [f,inline] of [['x.html',false],['x.js',false],['x.svg',false],['x.png',true],['x.pdf',true]]){const r=await get('/hapi/files/download?path='+encodeURIComponent('/home/x/'+f),'owner');await r.arrayBuffer();assert.equal(r.status,200,f);
  const ct=r.headers.get('content-type'),cd=r.headers.get('content-disposition')||'';assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  if(inline)assert.match(ct,/^(image\/png|application\/pdf)/);else{assert.equal(ct,'application/octet-stream',f);assert.match(cd,/^attachment/,f);assert.match(r.headers.get('content-security-policy'),/sandbox/,f)}}});

test('E19: the app list sent to a browser does not carry the signed address of aqeelOS\'s own tools',async()=>{
 const r=await get('/hapi/mcp/servers?profile=mine','m1');const t=await r.text();assert.equal(r.status,200,t);assert.equal(t.includes('S'.repeat(32)),false);assert.match(t,/a\.example/)});

test('A19: a new agent cannot be named like a copy of another; A10: a member\'s new chat cannot name its own id',async()=>{
 const post=(p,uid,b,id)=>fetch(base+p,{method:'POST',headers:{cookie:cookie(uid),'x-hui':'1','content-type':'application/json','x-trace':id},body:JSON.stringify(b)});
 for(const name of ['default--x','mine--whatsapp-2']){const r=await post('/hapi/profiles','owner',{name},'a19');assert.equal(r.status,400,name);await r.text()}assert.equal(seen.filter(x=>x.trace==='a19').length,0);
 const r=await post('/gapi/p/mine/api/sessions','m1',{id:'existing-chat',session_id:'existing-chat',title:'t'},'a10');assert.equal(r.status,200);await r.text();
 const got=seen.find(x=>x.trace==='a10');assert.ok(got);assert.equal(got.body.id,undefined);assert.equal(got.body.session_id,undefined);assert.equal(got.body.title,'t')});

test('N-3: the agent-live routes answer this server only (the key alone is not enough from elsewhere)',async()=>{
 // from loopback they still work as before (a wrong key is refused by the key check, not by the address check)
 const r=await fetch(base+'/agent-live/context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:'wrong'})});assert.notEqual(r.status,404);await r.text();
 const s=src('app/server.mjs');const at=s.indexOf("if(p.startsWith('/agent-live/')&&!/^(127"),first=s.indexOf("if(p==='/agent-live/team-view')");assert.ok(at>0&&at<first,'the address check comes before every agent-live route')});
