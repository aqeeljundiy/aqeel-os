// The rights matrix (maintainability audit, action 3; security audit 12 Nov 2026): EVERY route of the real app, for every kind of person,
// with the answer to "does this get past the gate?". The saved table is scripts/route-rights-matrix.json; this test fails on ANY difference
// from it and says which route, which person, what it was and what it is now. Removing one isAdmin check or one per-agent check turns it red.
//
//   node --test scripts/route-rights-matrix.test.mjs                       compare with the saved table
//   UPDATE_RIGHTS_MATRIX=1 node --test scripts/route-rights-matrix.test.mjs   after a DELIBERATE change: rewrites the answers (keeps the notes and "intended")
//
// How it works
//  1. The real app (app/server.mjs) is started on an empty data folder and a free port, as the deploy's test copy is (AQEELOS_LIVE=0: no schedules,
//     no background jobs). Every outside address points at a stub that records what it receives. A preload (written into the temp folder) also refuses
//     any connection that is not to this machine, turns every child process into "exit 127" and makes process.exit/kill do nothing, so no probe can
//     reach a provider, change the machine or stop the app. What it refused is listed at the end.
//  2. People are made by the app's own paths: the owner by POST /auth/setup, an admin and a member (shared agent A only) by an invite and
//     POST /auth/accept. Agents A and B exist (a folder with config.yaml in the engine home); the main agent always does.
//  3. The route list is read from the source: server.mjs's dispatcher and the modules it hands /ui, /auth and /hapi routes to (SOURCES). Exact paths
//     (p==='...'), prefixes (p.startsWith('...')) and regex routes (/^...$/.exec(p)); a regex is turned into a sample path. The test fails when the
//     reader finds fewer of any kind than the table's "min", so a refactor cannot quietly drop coverage: move the routes, then add the new file to SOURCES.
//  4. Each route x method x person gets a harmless request (empty or minimal body). The answer is only the authorization class:
//       D denied (401, 403, a redirect to sign-in)   A allowed (got past the gate: 2xx, or a 4xx/5xx the handler itself gave)
//       N nothing there for this method (404 "Not found", "POST only", or the app shell)   S not sent (it would sign the person out)
//     A member is probed four ways: naming no agent, and naming agent A, agent B and the main agent (in the path where the route has an agent in it,
//     else as ?agent=&profile= and in the body).
//  5. Every proxied route (/gapi, /hapi) is also checked against what the stub engine received: whatever a member sends, the engine only ever sees
//     agent A (guards app/proxy-agent.mjs); an anonymous call reaches no engine at all.
import {src as sourceOf} from './lib/source.mjs';import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer,request as httpRequest,Agent} from 'node:http';import {spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const TABLE=path.join(ROOT,'scripts','route-rights-matrix.json');
const UPDATE=process.env.UPDATE_RIGHTS_MATRIX==='1';
const SHOW=process.env.RIGHTS_SHOW?new RegExp(process.env.RIGHTS_SHOW):null;   // RIGHTS_SHOW='^GET /healthz anon' prints the raw answer of the matching cells
const A='agent-a',B='agent-b',MAIN='default';
export const ROLES=['anon','owner','admin','member','member@A','member@B','member@main'];
// the source files that decide routes (relative to app/). A route moved to a new file must be listed here, or the minimum below fails.
const SOURCES=['server.mjs','users.mjs','accounts.mjs','connect.mjs','help.mjs','install-routes.mjs','plugin-host.mjs','screens.mjs','agent-adspower.mjs','account-auth.mjs'];
// routes whose first path part names an agent (the first capture of its regex): a member's "agent A / B / main" goes in the path, not the query
const AGENT_IN_PATH=['/ui/screens/','/ui/instructions/','/ui/agent-versions/','/ui/browser-choice/','/agent-ops/','/google-files/','/mcp/self/','/mcp/notify/','/mcp/customer/','/mcp/code/','/run-gate/','/event-hook/','/posting-','/team-message/','/hooks/tebar/','/hooks/pay/','/kirimdev/','/webhooks/','/whatsapp-cloud/'];
// not sent to a signed-in person: answering it signs that person out for the rest of the run
const NO_SEND_SIGNED=new Set(['POST /auth/logout-all']);
// proxied engine routes (the app's /gapi gateway and /hapi dashboard): the same lists as scripts/proxy-agent.test.mjs, plus every /hapi and /gapi path the source names
const GAPI=['/api/sessions','/api/sessions/s1/chat/stream','/v1/runs/r1/approval','/v1/runs/r1/stop','/v1/runs/r1/steer','/v1/runs/r1','/api/model/options','/v1/models'];
const HAPI=[['POST','/cron/jobs'],['PUT','/cron/jobs/j1'],['POST','/cron/jobs/j1/trigger'],['GET','/cron/jobs'],['POST','/skills'],['PUT','/skills/content'],['PUT','/skills/toggle'],['POST','/mcp/servers'],['PUT','/mcp/servers/x'],['DELETE','/mcp/servers/x'],
 ['GET','/memory'],['PUT','/memory'],['POST','/model/set'],['GET','/tools/toolsets'],['PUT','/tools/toolsets/web'],['GET','/mcp/catalog'],['GET','/sessions'],['GET','/status'],['GET','/env'],['GET','/config'],['PUT','/config'],['GET','/logs'],['POST','/gateway/restart'],['GET','/files'],['GET','/webhooks'],['POST','/messaging/whatsapp/onboarding/x/apply'],['GET','/analytics/usage'],['GET','/messaging/platforms'],
 ['GET','/profiles'],['POST','/profiles'],['GET','/profiles/x'],['PUT','/profiles/x/soul'],['PUT','/profiles/x/model'],['DELETE','/profiles/x'],['GET','/sessions/s1'],['DELETE','/sessions/s1'],['GET','/dashboard/plugins/hub'],['POST','/dashboard/agent-plugins/install'],['POST','/audio/transcribe']];

/* ---------------------------------------------------------------- reading the routes from the source */
// A regex route's source -> sample paths. {s, cap}: cap = offset of the first capture group in s (-1 none). Optional parts give both variants, alternatives all of them.
export function sampleRegex(src){let i=0;const MAXV=16;
 const cart=(x,y)=>{const o=[];for(const a of x)for(const b of y){if(o.length>=MAXV)return o;o.push({s:a.s+b.s,cap:a.cap>=0?a.cap:b.cap>=0?a.s.length+b.cap:-1})}return o};
 const alt=()=>{let r=seq();while(src[i]==='|'){i++;r=r.concat(seq())}return r};
 const seq=()=>{let acc=[{s:'',cap:-1}];while(i<src.length&&src[i]!=='|'&&src[i]!==')'){const atom=one();const q=quant();let use=atom;
   if(q.min===0&&q.max===1)use=[{s:'',cap:-1},...atom];else if(q.min===0)use=q.max>1&&atom.every(a=>a.cap<0)?[{s:'',cap:-1}]:atom;else if(q.min>1)use=atom.map(a=>({s:a.s.repeat(q.min),cap:a.cap}));
   acc=cart(acc,use)}return acc};
 const quant=()=>{const c=src[i];if(c==='?'){i++;if(src[i]==='?')i++;return {min:0,max:1}}if(c==='+'){i++;return {min:1,max:1e9}}if(c==='*'){i++;return {min:0,max:1e9}}
  if(c==='{'){const j=src.indexOf('}',i),[a,b]=src.slice(i+1,j).split(',');i=j+1;return {min:+a,max:b===undefined?+a:b===''?1e9:+b}}return {min:1,max:1}};
 const esc=c=>c==='w'?'a':c==='d'?'1':c==='s'?' ':c;
 const one=()=>{const c=src[i++];
  if(c==='^'||c==='$')return [{s:'',cap:-1}];
  if(c==='.')return [{s:'a',cap:-1}];
  if(c==='\\'){return [{s:esc(src[i++]),cap:-1}]}
  if(c==='['){let neg=false;if(src[i]==='^'){neg=true;i++}let first=null;while(src[i]!==']'){if(first===null){first=src[i]==='\\'?esc(src[i+1]):src[i]}if(src[i]==='\\')i++;i++}i++;return [{s:neg?'a':first,cap:-1}]}
  if(c==='('){let capture=true;if(src.startsWith('?:',i)){i+=2;capture=false}else if(src[i]==='?')throw new Error('regex feature not supported: '+src);const inner=alt();if(src[i]!==')')throw new Error('bad regex '+src);i++;return capture?inner.map(o=>({s:o.s,cap:0})):inner}
  return [{s:c,cap:-1}]};
 const out=alt();if(i<src.length)throw new Error('could not read regex '+src);return out}

const RE_LIT=String.raw`\/\^(?:\\.|\[(?:\\.|[^\]\\])*\]|[^\/\\\[\n])*\/[gimsuy]*`;
export function parseRoutes(sources){
 const exact=new Map(),prefix=new Map(),regex=new Map();const add=(map,key,extra)=>{const e=map.get(key)||{path:key,methods:new Set(['GET','POST']),srcs:new Set(),slot:-1};for(const m of extra.methods||[])e.methods.add(m);e.srcs.add(extra.src);if(extra.slot!==undefined&&extra.slot>=0)e.slot=extra.slot;map.set(key,e)};
 for(const [file,text0] of sources){let text=text0,base=0;
  if(file==='server.mjs'){const a=text.indexOf('const server=createServer(async(req,res)=>'),b=text.indexOf("server.on('upgrade'");if(a<0||b<a)throw new Error('server.mjs: the dispatcher was not found (createServer ... server.on upgrade)');base=a;text=text.slice(a,b)}
  const line=off=>1+text0.slice(0,base+off).split('\n').length-1;
  const methodsAround=(idx,len)=>{const lo=text.lastIndexOf('\n',idx)+1;let hi=text.indexOf('\n',idx+len);if(hi<0)hi=text.length;const w=text.slice(Math.max(lo,idx-70),Math.min(hi,idx+len+230));const ms=new Set();
   for(const m of w.matchAll(/(?:req\.method|\bM|\bmethod)\s*[!=]==?\s*'(GET|POST|PUT|PATCH|DELETE)'/g))ms.add(m[1]);for(const m of w.matchAll(/\[((?:'(?:GET|POST|PUT|PATCH|DELETE)',?\s*)+)\]\.includes\((?:req\.)?method\)/g))for(const x of m[1].matchAll(/'([A-Z]+)'/g))ms.add(x[1]);return ms};
  for(const m of text.matchAll(/\b(?:p|pathname|url\.pathname)\s*===?\s*'(\/[^'\s]*)'/g))add(exact,m[1],{methods:methodsAround(m.index,m[0].length),src:file+':'+line(m.index)});
  for(const m of text.matchAll(/\b(?:p|pathname|url\.pathname)\.startsWith\('(\/[^']*)'\)/g))add(prefix,m[1],{methods:methodsAround(m.index,m[0].length),src:file+':'+line(m.index)});
  for(const m of text.matchAll(new RegExp('('+RE_LIT+')\\.(?:exec|test)\\((?:p|pathname|url\\.pathname)\\)','g'))){const lit=m[1],src=lit.slice(1,lit.lastIndexOf('/'));
   for(const v of sampleRegex(src)){const pth=v.s;if(!pth.startsWith('/'))continue;let slot=-1;if(v.cap>=0&&AGENT_IN_PATH.some(x=>pth.startsWith(x)))slot=pth.startsWith('/posting-')?2:pth.startsWith('/hooks/pay/')?4:pth.slice(0,v.cap).split('/').length-1;
    add(regex,pth,{methods:methodsAround(m.index,m[0].length),src:file+':'+line(m.index),slot})}}}
 // a path that is already an exact route is not also listed as a prefix sample
 const rows=[];const seen=new Set();
 const push=(kind,e,pth)=>{rows.push({kind,path:pth,methods:[...e.methods].sort(),src:[...e.srcs].sort()[0],slot:e.slot});seen.add(pth)};
 for(const e of exact.values())push('exact',e,e.path);
 for(const e of regex.values())if(!seen.has(e.path))push('regex',e,e.path);
 for(const e of prefix.values()){const pth=e.path.endsWith('/')?e.path+'zz-probe':e.path+'/zz-probe';if(!seen.has(pth))push('prefix',e,pth)}
 return {rows,counts:{exact:exact.size,prefix:prefix.size,regex:regex.size}}}

const classify=(status,headers,text)=>{
 if(status===401||status===403)return 'D';
 if(status>=300&&status<400){const l=headers.get('location')||'';return l==='/'||l.startsWith('/#')||/login|sign/i.test(l)?'D':'A'}
 if(status===404&&(text==='Not found'||text==='{"error":"Not found"}'))return 'N';
 if(status===200&&text&&text.includes('<meta name="build"'))return 'N';   // the app shell: no route answered
 if(status===405)return 'N';   // "POST only": no handler for this method
 if(status===429)throw new Error('the sign-in limit answered 429: the probe changed what it measures');
 return 'A'};

/* ---------------------------------------------------------------- the preload that keeps the app inside this machine */
const PRELOAD=`import net from 'node:net';import cp from 'node:child_process';import util from 'node:util';import {appendFileSync} from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const LOG=process.env.RIGHTS_BLOCK_LOG,log=(k,w)=>{try{appendFileSync(LOG,k+' '+w+'\\n')}catch{}};
const local=h=>!h||/^(localhost|127\\.|::1$|::ffff:127\\.|0\\.0\\.0\\.0$)/i.test(String(h).replace(/^\\[|\\]$/g,''));
const oc=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...a){const o=a[0];const host=o&&typeof o==='object'?(o.path?'':o.host):(typeof o==='number'&&typeof a[1]==='string'?a[1]:'');
 if(!local(host)){log('connect',host);process.nextTick(()=>this.destroy(Object.assign(new Error('blocked by the rights test: '+host),{code:'ECONNREFUSED'})));return this}return oc.apply(this,a)};
const NODE=process.execPath,DEAD=['-e','process.exit(127)'],ok=f=>f===NODE;
const split=a=>{let cb;if(typeof a.at(-1)==='function')cb=a.pop();let opts;if(a.length&&a.at(-1)&&typeof a.at(-1)==='object'&&!Array.isArray(a.at(-1)))opts=a.pop();return {opts:{...(opts||{}),shell:false},cb}};
const oSpawn=cp.spawn,oSpawnSync=cp.spawnSync,oExecFile=cp.execFile,oExecFileSync=cp.execFileSync;
cp.spawn=function(f,...a){if(ok(f))return oSpawn.call(this,f,...a);log('spawn',f);return oSpawn.call(this,NODE,DEAD,split(a).opts)};
cp.spawnSync=function(f,...a){if(ok(f))return oSpawnSync.call(this,f,...a);log('spawnSync',f);return oSpawnSync.call(this,NODE,DEAD,split(a).opts)};
cp.execFile=function(f,...a){if(ok(f))return oExecFile.call(this,f,...a);log('execFile',f);const {opts,cb}=split(a);return oExecFile.call(this,NODE,DEAD,opts,cb)};
cp.execFileSync=function(f,...a){if(ok(f))return oExecFileSync.call(this,f,...a);log('execFileSync',f);return oExecFileSync.call(this,NODE,DEAD,split(a).opts)};
cp.exec=function(c,...a){log('exec',String(c).slice(0,80));const {opts,cb}=split(a);return oExecFile.call(cp,NODE,DEAD,opts,cb)};
cp.execSync=function(c,...a){log('execSync',String(c).slice(0,80));return oExecFileSync.call(cp,NODE,DEAD,split(a).opts)};
cp.execFile[util.promisify.custom]=(...a)=>new Promise((res,rej)=>cp.execFile(...a,(e,stdout,stderr)=>e?rej(Object.assign(e,{stdout,stderr})):res({stdout,stderr})));
cp.exec[util.promisify.custom]=(...a)=>new Promise((res,rej)=>cp.exec(...a,(e,stdout,stderr)=>e?rej(Object.assign(e,{stdout,stderr})):res({stdout,stderr})));
cp.fork=function(){log('fork','');return oSpawn.call(this,NODE,DEAD)};
process.exit=c=>{log('process.exit',c)};process.kill=(pid,sig)=>{if(pid===process.pid&&(sig===0||sig==='0'))return true;log('process.kill',pid+' '+sig);return true};
syncBuiltinESMExports();`;

/* ---------------------------------------------------------------- the harness */
const listen=h=>new Promise(r=>{const s=createServer(h);s.listen(0,'127.0.0.1',()=>r(s))});
const seen=[];   // every request any stub received
const stub=kind=>(req,res)=>{const ch=[];req.on('data',c=>ch.push(c));req.on('end',()=>{const u=new URL(req.url,'http://x');let body=null;try{body=JSON.parse(Buffer.concat(ch).toString('utf8'))}catch{}
 seen.push({kind,method:req.method,path:u.pathname,q:u.searchParams,body,headers:req.headers});res.writeHead(200,{'content-type':'application/json'});
 res.end(JSON.stringify(u.pathname==='/api/profiles'&&req.method==='GET'?{profiles:[{name:'default'},{name:A},{name:B}]}:u.pathname.endsWith('/api/sessions')&&req.method==='POST'?{id:'s-'+randomBytes(4).toString('hex')}:{ok:true,jobs:[],profiles:[],sessions:[]}))})};
// which agent the engine would act on for a recorded request (the engine's own rule, as in scripts/proxy-agent.test.mjs)
const engineAgent=r=>{if(r.kind==='gate'){const m=/^\/p\/([^/]+)\//.exec(r.path);return m?decodeURIComponent(m[1]):'default'}
 const m=/^\/api\/profiles\/([^/]+)/.exec(r.path);if(m)return decodeURIComponent(m[1]);return (r.body&&typeof r.body==='object'&&r.body.profile)||r.q.get('profile')||'default'};
const GLOBAL_READS=/^\/api\/(status|profiles|sessions|sessions\/search|model\/info|files)$/;   // global lists the app trims itself on the way back (sessions/search: the users.mjs gate lets any signed-in person ask, filter() keeps only their chats)
// dictation is open to everyone on purpose (users.mjs gate, first line): it reaches the engine whatever agent is named. Reported as suspicious (the named agent is forwarded)
const OPEN_BY_DESIGN=/^\/api\/audio\/transcribe$/;

let app,base,tmp,blockLog,servers=[],appLog='';const cookies={};const stubs={};
const portFree=()=>new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
let trace=0;
// one kept-open connection pool: thousands of requests would otherwise use up the machine's ports (Windows)
const pool=new Agent({keepAlive:true,maxSockets:4});
function http(method,p,{cookie,body,headers={}}={}){const id='t'+(++trace);
 return new Promise((resolve,reject)=>{const h={...(cookie?{cookie}:{}),'x-hui':'1','x-trace':id,...(body!==undefined?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}),...headers};
  const req=httpRequest(base+p,{method,agent:pool,headers:h},res=>{const ch=[];let n=0,done=false;
   const fin=()=>{if(done)return;done=true;const ct=String(res.headers['content-type']||'');let text=null;
    if(/^text\/(plain|html)/.test(ct)&&(res.statusCode===404||res.statusCode===200)||res.statusCode===404&&/json/.test(ct)){text=Buffer.concat(ch).toString('utf8');if(text.length>200&&!text.includes('<meta name="build"'))text=text.slice(0,200)}
    resolve({status:res.statusCode,headers:{get:k=>{const v=res.headers[k.toLowerCase()];return Array.isArray(v)?v.join(', '):v??null},getSetCookie:()=>res.headers['set-cookie']||[]},text,id,reached:()=>seen.filter(x=>x.headers['x-trace']===id)})};
   res.on('data',c=>{n+=c.length;if(n<=400000)ch.push(c);if(n>400000||/event-stream/.test(String(res.headers['content-type']||''))){fin();res.destroy()}});res.on('end',fin);res.on('close',fin);res.on('error',()=>fin())});
  req.setTimeout(15000,()=>req.destroy(new Error('timeout 15 s')));req.on('error',reject);req.end(body)})}
const setCookie=r=>{const c=(r.headers.getSetCookie?.()||[]).map(x=>x.split(';')[0]).find(x=>x.startsWith('hui=')&&x.length>6);assert.ok(c,'no session cookie in the answer');return c};

test.before(async()=>{
 tmp=await mkdtemp(path.join(tmpdir(),'rights-'));const home=path.join(tmp,'home'),data=path.join(tmp,'data'),hh=path.join(home,'.hermes');blockLog=path.join(tmp,'blocked.log');
 await mkdir(data,{recursive:true});for(const a of [A,B]){await mkdir(path.join(hh,'profiles',a),{recursive:true});await writeFile(path.join(hh,'profiles',a,'config.yaml'),'model: {}\n')}await mkdir(hh,{recursive:true});await writeFile(path.join(hh,'config.yaml'),'model: {}\n');
 const preload=path.join(tmp,'preload.mjs');await writeFile(preload,PRELOAD);await writeFile(blockLog,'');
 for(const k of ['dash','gate','hooks','wa','n8n'])servers.push(stubs[k]=await listen(stub(k)));
 const port=await portFree();base='http://127.0.0.1:'+port;const url=k=>'http://127.0.0.1:'+stubs[k].address().port;
 app=spawn(process.execPath,['--import',pathToFileURL(preload).href,path.join(ROOT,'app','server.mjs')],{cwd:home,stdio:['ignore','pipe','pipe'],env:{UI_SIGNIN_FREE_TRIES:'1000000',PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:home,USERPROFILE:home,TMPDIR:tmp,TEMP:tmp,TMP:tmp,HERMES_HOME:hh,UI_DATA_DIR:data,UI_PORT:String(port),UI_HOST:'127.0.0.1',UI_INSECURE_COOKIE:'1',AQEELOS_LIVE:'0',
  HERMES_DASH:url('dash'),HERMES_API:url('gate'),HERMES_WEBHOOKS:url('hooks'),HERMES_WA_CLOUD:url('wa'),N8N_URL:url('n8n'),API_SERVER_KEY:'k',HERMES_DASHBOARD_SESSION_TOKEN:'t',HERMES_BIN:path.join(tmp,'no-engine'),RIGHTS_BLOCK_LOG:blockLog,UI_SECRET:'rights-test-'+randomBytes(8).toString('hex')}});
 app.stdout.on('data',d=>appLog+=d);app.stderr.on('data',d=>appLog+=d);
 let up=false;for(let i=0;i<150&&!up;i++){try{up=(await fetch(base+'/healthz')).ok}catch{}if(!up)await new Promise(r=>setTimeout(r,200))}
 assert.ok(up,'the app did not start:\n'+appLog.slice(-2000));
 // the people, through the app's own paths
 const pw='Rights-test-pw-1';
 let r=await http('POST','/auth/setup',{body:JSON.stringify({name:'Owner',email:'owner@rights.test',password:pw})});assert.equal(r.status,200,'owner setup: '+r.status);cookies.owner=setCookie(r);
 for(const [who,role,agents] of [['admin','admin',{}],['member','member',{[A]:'chat'}]]){
  r=await http('POST','/ui/people/invite',{cookie:cookies.owner,body:JSON.stringify({name:who,role,agents,noLead:true})});assert.equal(r.status,200,'invite '+who);
  const code=JSON.parse(await (await fetch(base+'/ui/people',{headers:{cookie:cookies.owner}})).text()).invites.find(i=>i.name===who).code;
  r=await http('POST','/auth/accept',{headers:{'x-forwarded-for':'10.9.'+(who==='admin'?1:2)+'.1'},body:JSON.stringify({code,name:who,username:who,email:who+'@rights.test',password:pw})});assert.equal(r.status,200,'accept '+who+': '+r.status);cookies[who]=setCookie(r)}
 const me=async c=>JSON.parse(await (await fetch(base+'/auth/me',{headers:{cookie:c}})).text());
 assert.deepEqual([(await me(cookies.owner)).role,(await me(cookies.admin)).role,(await me(cookies.member)).role],['owner','admin','member']);
 // the member really has agent A and nothing else
 const mine=JSON.parse(await (await fetch(base+'/ui/me',{headers:{cookie:cookies.member}})).text());assert.equal(mine.agents?.[A],'chat','the member has agent A');assert.equal(mine.agents?.[B],undefined,'the member does not have agent B')});
test.after(async()=>{app?.kill('SIGKILL');for(const s of servers)s.close();await new Promise(r=>setTimeout(r,300));await rm(tmp,{recursive:true,force:true}).catch(()=>{})});

/* ---------------------------------------------------------------- the requests */
const AGENT_OF={'member@A':A,'member@B':B,'member@main':MAIN};
function request(row,method,role){
 const named=AGENT_OF[role],proxied=/^\/(hapi|gapi)\//.test(row.path),write=!/^(GET|HEAD)$/.test(method);
 let p=row.path,q=[],body;
 if(proxied&&named!==undefined){
  if(p.startsWith('/gapi/'))p='/gapi/p/'+named+p.slice(5);else q.push('profile='+named)}
 else if(row.slot>=0){const seg=p.split('/');seg[row.slot]=named!==undefined?named:role==='member'?'zz-probe':A;p=seg.join('/')}
 else if(named!==undefined)q.push('agent='+named,'profile='+named);
 // a request with the usual fields filled in, so a handler that checks its input before its gate still reaches the gate (a bare {} would stop at "missing field")
 const who=named!==undefined?named:role==='member'?undefined:A;
 if(!proxied){if(who!==undefined&&named===undefined&&row.slot<0)q.push('agent='+who);q.push('names='+(who||''),'platform=telegram','kind=mcp')}
 if(write)body=JSON.stringify(proxied?(named!==undefined?{agent:named,profile:named}:{}):{...(who!==undefined?{agent:who,profile:who}:{}),platform:'telegram',kind:'mcp',name:'probe',id:'probe',cid:'probe',qid:'probe',key:'probe',value:'probe',level:'chat',on:false,kept:'session.unlinked-probe'});
 const headers={};if(/^\/auth\//.test(p))headers['x-forwarded-for']='10.1.'+((++trace)%250)+'.'+((trace>>8)%250+1);   // the sign-in limit counts per address
 return {url:p+(q.length?'?'+q.join('&'):''),opts:{cookie:role==='anon'?undefined:cookies[role.split('@')[0]],body,headers}}}


test('the matrix: every route, every kind of person',{timeout:240000},async t=>{
 const sources=[];for(const f of SOURCES)sources.push([f,sourceOf('app/'+f)]);
 const {rows:parsed,counts}=parseRoutes(sources);
 const rows=new Map();   // "METHOD path" -> {kind,path,method,slot,src}
 for(const r of parsed)for(const m of r.methods)rows.set(m+' '+r.path,{kind:r.kind,path:r.path,method:m,slot:r.slot,src:r.src});
 for(const rest of GAPI)for(const m of ['GET','POST'])rows.set(m+' /gapi'+rest,{kind:'proxy',path:'/gapi'+rest,method:m,slot:-1,src:'proxy list'});
 for(const [m,rest] of HAPI)rows.set(m+' /hapi'+rest,{kind:'proxy',path:'/hapi'+rest,method:m,slot:-1,src:'proxy list'});
 for(const r of rows.values())if(/^\/(hapi|gapi)\//.test(r.path)&&r.kind!=='proxy')r.kind='proxy';
 const keys=[...rows.keys()].sort((x,y)=>{const a=rows.get(x),b=rows.get(y);return a.path<b.path?-1:a.path>b.path?1:a.method<b.method?-1:1});

 let table=null;try{table=JSON.parse(await readFile(TABLE,'utf8'))}catch{}
 const MIN=table?.min;
 if(!UPDATE){assert.ok(MIN,'scripts/route-rights-matrix.json is missing or has no "min": run UPDATE_RIGHTS_MATRIX=1 node --test scripts/route-rights-matrix.test.mjs once');
  for(const k of ['exact','prefix','regex'])assert.ok(counts[k]>=MIN[k],'the route reader found only '+counts[k]+' '+k+' routes, the table recorded at least '+MIN[k]+': a refactor moved routes out of '+SOURCES.join(', ')+'. Move them back or add the new file to SOURCES.');
  assert.ok(keys.length>=MIN.rows,'only '+keys.length+' route x method rows, at least '+MIN.rows+' expected')}

 const got={};const bad=[];const t0=Date.now();
 for(const k of keys){const row=rows.get(k);let cells='';
  for(const role of ROLES){
   if(role!=='anon'&&NO_SEND_SIGNED.has(k)){cells+='S';continue}
   const {url,opts}=request(row,row.method,role);let res,c;
   try{res=await http(row.method,url,opts);c=classify(res.status,res.headers,res.text)}catch(e){if(/429/.test(e.message))throw new Error(k+' '+role+': '+e.message);throw new Error(k+' '+role+' ('+url+'): '+e.message+'\n'+appLog.slice(-800))}
   cells+=c;if(SHOW&&SHOW.test(k+' '+role))t.diagnostic(k+' as '+role+' -> '+res.status+' '+c+' '+(res.headers.get('location')||'')+' '+JSON.stringify(res.text?.slice(0,70)));
   if(row.kind==='proxy'){const reached=res.reached();
    if(role==='anon')assert.equal(reached.length,0,k+' anon: reached an engine');
    if(role.startsWith('member'))for(const x of reached){if(x.method==='GET'&&GLOBAL_READS.test(x.path)||OPEN_BY_DESIGN.test(x.path))continue;if(engineAgent(x)!==A)bad.push(k+' as '+role+' ('+url+') reached agent "'+engineAgent(x)+'" at '+x.kind+' '+x.path+(x.body?' body '+JSON.stringify(x.body).slice(0,80):'')+' q='+x.q)}}}
  got[k]=cells;
  // nobody was signed out by that probe
  for(const who of ['owner','admin','member']){const m=await http('GET','/auth/me',{cookie:cookies[who]});if(m.status!==200)throw new Error('the probe "'+k+'" signed '+who+' out (add it to NO_SEND_SIGNED)')}}
 const secs=((Date.now()-t0)/1000).toFixed(1);
 t.diagnostic(keys.length+' rows x '+ROLES.length+' people = '+keys.length*ROLES.length+' cells in '+secs+' s; routes read: '+counts.exact+' exact, '+counts.prefix+' prefix, '+counts.regex+' regex');
 assert.deepEqual(bad,[],'a member reached an engine agent that is not theirs:\n'+bad.join('\n'));

 // what the preload refused (information: a probe or the app's start that tried to leave this machine was stopped, never sent)
 const blocked=(await readFile(blockLog,'utf8')).split('\n').filter(Boolean);const kinds={};for(const l of blocked){const k=l.split(' ')[0];kinds[k]=(kinds[k]||0)+1}
 t.diagnostic('refused by the preload: '+JSON.stringify(kinds));
 {const hosts=[...new Set(blocked.filter(l=>l.startsWith('connect ')).map(l=>l.slice(8)))];if(hosts.length)t.diagnostic('outside hosts the app tried (refused): '+hosts.join(', '))}

 const counted={exact:counts.exact,prefix:counts.prefix,regex:counts.regex,rows:keys.length};
 if(UPDATE){
  const old=table?.rows||{};const out={};for(const k of keys){const row=rows.get(k);out[k]={cells:got[k],...(old[k]?.intended&&old[k].intended!==got[k]?{intended:old[k].intended}:{}),...(old[k]?.note?{note:old[k].note}:{}),src:row.src}}
  const doc={_:'The rights matrix. Written by scripts/route-rights-matrix.test.mjs (UPDATE_RIGHTS_MATRIX=1); read the header of that file. cells = one letter per person in "roles" order: D denied, A allowed (got past the gate), N nothing there for this method, S not sent. "intended" appears only where today answer is NOT the policy (SUSPICIOUS in "note"); the test is green on today answer and counts these as known problems to fix deliberately, then re-run with UPDATE_RIGHTS_MATRIX=1. "note" with REVIEW = looked at, low risk. Caveat: an A on a per-agent cell can be a 400/404 the handler gives before it reaches its gate (the probe has no real ask, token or chat id), so A means "not stopped by the gate", not "got data".',
   legend:{D:'denied (401, 403, redirect to sign-in)',A:'allowed (past the gate: 2xx, or a 4xx/5xx from the handler itself)',N:'no route for this method (404 Not found, or the app shell)',S:'not sent (would sign the person out)'},
   roles:ROLES,agents:{A,B,main:MAIN},min:{exact:Math.floor(counted.exact*0.97),prefix:Math.floor(counted.prefix*0.97),regex:Math.floor(counted.regex*0.97),rows:Math.floor(counted.rows*0.97)},rows:out};
  await writeFile(TABLE,JSON.stringify(doc,null,1).replace(/\n\s+("cells"|"intended"|"note"|"src")/g,' $1').replace(/\n\s+\}/g,' }')+'\n');
  t.diagnostic('table written: '+keys.length+' rows');return}

 // compare with the saved table: every difference, by route and person
 const diffs=[];const saved=table.rows;
 for(const k of keys){const s=saved[k];if(!s){diffs.push(k+': NEW route/method (not in the saved table); answers now '+got[k].split('').map((c,i)=>ROLES[i]+'='+c).join(' '));continue}
  for(let i=0;i<ROLES.length;i++)if(s.cells[i]!==got[k][i])diffs.push(k+' as '+ROLES[i]+': was '+s.cells[i]+', now '+got[k][i])}
 for(const k of Object.keys(saved))if(!(k in got))diffs.push(k+': in the saved table but the reader no longer finds it');
 const known=Object.entries(saved).filter(([,v])=>v.intended).length;if(known)t.diagnostic(known+' rows carry an "intended" that differs from today\'s answer (known problems, listed in the table)');
 assert.equal(diffs.length,0,'the rights matrix changed ('+diffs.length+' differences). If this is deliberate: UPDATE_RIGHTS_MATRIX=1 node --test scripts/route-rights-matrix.test.mjs\n'+diffs.slice(0,60).join('\n')+(diffs.length>60?'\n... and '+(diffs.length-60)+' more':''))});
