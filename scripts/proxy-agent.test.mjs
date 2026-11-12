// Security audit CR-1 / H-1 (12 Nov 2026): a member with access to agent A cannot reach agent B or the main agent
// through the engine proxy by ANY selector (path, ?profile=, ?agent=, JSON body, header). The real app is started
// against two stub engines that record what reaches them.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {createHmac,randomBytes} from 'node:crypto';
import {decide,rewrite} from '../app/proxy-agent.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const Q=s=>new URLSearchParams(s||'');

test('decide: the agent comes only from what the engine reads',()=>{
 assert.deepEqual(decide('/gapi/api/sessions',Q('profile=a&agent=a')),{agent:'default',via:'none'});
 assert.deepEqual(decide('/gapi/p/a/api/sessions',Q('profile=b')),{agent:'a',via:'path'});
 assert.ok(decide('/gapi/p/a%2Fb/api/sessions',Q()).error);assert.ok(decide('/gapi/p/..%2f/x',Q()).error);assert.ok(decide('/gapi/p',Q()).error);assert.ok(decide('/gapi/p/A/x',Q()).error);
 assert.deepEqual(decide('/hapi/cron/jobs',Q('agent=a')),{agent:'default',via:'none'});
 assert.deepEqual(decide('/hapi/cron/jobs',Q('profile=a')),{agent:'a',via:'query'});
 assert.deepEqual(decide('/hapi/cron/jobs',Q('profile=a'),{profile:'b'}),{agent:'b',via:'body'});
 assert.deepEqual(decide('/hapi/profiles/b/soul',Q('profile=a'),{profile:'c'}),{agent:'b',via:'path'});
 assert.ok(decide('/hapi/skills',Q('profile=__proto__')).error);assert.ok(decide('/hapi/skills',Q(),{profile:['a']}).error);assert.ok(decide('/hapi/skills',Q(),{profile:'all'}).error);
 assert.equal(decide('/hapi/cron/jobs',Q('profile=all')).agent,'all')});

test('rewrite: one agent is left in the request',()=>{
 let q=Q('profile=a&agent=b&x=1'),r=rewrite('/gapi/p/a/api/sessions',q,undefined,'a');assert.equal(q.toString(),'x=1');
 q=Q('agent=a');r=rewrite('/hapi/cron/jobs',q,{name:'n'},'default');assert.equal(q.toString(),'');assert.equal(r.changed,false);
 q=Q('profile=a');r=rewrite('/hapi/cron/jobs',q,{name:'n'},'a');assert.equal(q.get('profile'),'a');assert.equal(r.body.profile,'a');
 q=Q('profile=a');r=rewrite('/hapi/cron/jobs',q,{profile:'b'},'b');assert.equal(q.get('profile'),'b');assert.equal(r.body.profile,'b');
 q=Q('');r=rewrite('/hapi/cron/jobs',q,{profile:'b'},'b');assert.equal(q.get('profile'),'b');
 q=Q('profile=a');r=rewrite('/hapi/profiles/b/soul',q,{profile:'c',content:'x'},'b');assert.equal(q.get('profile'),'b');assert.equal(r.body.profile,'b')});

/* ---------- the real app between a member's browser and two stub engines ---------- */
const listen=h=>new Promise(r=>{const s=createServer(h);s.listen(0,'127.0.0.1',()=>r(s))});
const seen=[];   // every request that reached an engine
const stub=kind=>(req,res)=>{const ch=[];req.on('data',c=>ch.push(c));req.on('end',()=>{const u=new URL(req.url,'http://x');let body=null;try{body=JSON.parse(Buffer.concat(ch).toString('utf8'))}catch{}
 seen.push({kind,method:req.method,path:u.pathname,q:u.searchParams,body,headers:req.headers});res.writeHead(200,{'content-type':'application/json'});
 res.end(JSON.stringify(u.pathname.endsWith('/api/sessions')&&req.method==='POST'?{id:'s-'+randomBytes(4).toString('hex')}:{ok:true,jobs:[],profiles:[],sessions:[]}))})};
// which agent the engine would act on for a recorded request (the engine's own rule)
const engineAgent=r=>{if(r.kind==='gate'){const m=/^\/p\/([^/]+)\//.exec(r.path);return m?decodeURIComponent(m[1]):'default'}
 const m=/^\/api\/profiles\/([^/]+)/.exec(r.path);if(m)return decodeURIComponent(m[1]);return (r.body&&typeof r.body==='object'&&r.body.profile)||r.q.get('profile')||'default'};

let app,base,dash,gate,tmp;const SECRET='test-secret-'+randomBytes(8).toString('hex');
const cookie=uid=>{const v=uid+'.'+(Date.now()+864e5)+'.'+randomBytes(9).toString('base64url');return 'hui='+v+'.'+createHmac('sha256',SECRET).update(v).digest('base64url')};
let trace=0;const call=async(uid,method,p,body,headers={})=>{const id='t'+(++trace);const r=await fetch(base+p,{method,headers:{cookie:cookie(uid),'x-hui':'1','x-trace':id,...(body!==undefined?{'content-type':'application/json'}:{}),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
 await r.text();return {status:r.status,reached:seen.filter(x=>x.headers['x-trace']===id)}};   // only what this call caused (the app also asks the engines things by itself)

test.before(async()=>{
 tmp=await mkdtemp(path.join(tmpdir(),'proxy-agent-'));const home=path.join(tmp,'home'),data=path.join(tmp,'data');await mkdir(home,{recursive:true});await mkdir(data,{recursive:true});
 // m1 owns agent "mine" and may chat with "shared"; "other" and the main agent are not theirs. ad1 is an admin; "priv" is the owner's private agent
 await writeFile(path.join(data,'users.json'),JSON.stringify({ownerName:'Owner',ownerUsername:'owner',emailLoginSince:1,
  users:[{id:'m1',name:'Mem',username:'mem',role:'member',caps:['schedules','skills','mcp'],pw:'x',created:1,last:1},{id:'ad1',name:'Adm',username:'adm',role:'admin',caps:[],pw:'x',created:1,last:1}],
  agentOwners:{mine:'m1'},shares:{shared:{m1:'chat'}},privateAgents:{priv:true},leads:{m1:'mine'},owners:{}}));
 dash=await listen(stub('dash'));gate=await listen(stub('gate'));const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
 base='http://127.0.0.1:'+port;let log='';
 app=spawn(process.execPath,[path.join(ROOT,'app','server.mjs')],{cwd:home,stdio:['ignore','pipe','pipe'],env:{...process.env,HOME:home,USERPROFILE:home,UI_DATA_DIR:data,UI_PORT:String(port),UI_INSECURE_COOKIE:'1',AQEELOS_LIVE:'0',UI_SECRET:SECRET,
  HERMES_DASH:'http://127.0.0.1:'+dash.address().port,HERMES_API:'http://127.0.0.1:'+gate.address().port,API_SERVER_KEY:'k',HERMES_DASHBOARD_SESSION_TOKEN:'t'}});
 app.stdout.on('data',d=>log+=d);app.stderr.on('data',d=>log+=d);
 for(let i=0;i<150;i++){try{const r=await fetch(base+'/healthz');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,200))}
 throw new Error('the app did not start:\n'+log.slice(-2000))});
test.after(async()=>{app?.kill();dash?.close();gate?.close();await new Promise(r=>setTimeout(r,300));await rm(tmp,{recursive:true,force:true}).catch(()=>{})});

// every way to name an agent, for one gateway call and one dashboard call
const GAPI=['/api/sessions','/api/sessions/s1/chat/stream','/v1/runs/r1/approval','/v1/runs/r1/stop','/v1/runs/r1/steer','/v1/runs/r1','/api/model/options','/v1/models'];
const HAPI=[['POST','/cron/jobs'],['PUT','/cron/jobs/j1'],['POST','/cron/jobs/j1/trigger'],['GET','/cron/jobs'],['POST','/skills'],['PUT','/skills/content'],['PUT','/skills/toggle'],['POST','/mcp/servers'],['PUT','/mcp/servers/x'],['DELETE','/mcp/servers/x'],
 ['GET','/memory'],['PUT','/memory'],['POST','/model/set'],['GET','/tools/toolsets'],['PUT','/tools/toolsets/web'],['GET','/mcp/catalog'],['GET','/sessions'],['GET','/status'],['GET','/env'],['GET','/config'],['PUT','/config'],['GET','/logs'],['POST','/gateway/restart'],['GET','/files'],['GET','/webhooks'],['POST','/messaging/whatsapp/onboarding/x/apply'],['GET','/analytics/usage'],['GET','/messaging/platforms']];
const ALLOWED=new Set(['mine','shared']);   // agents m1 has any right on

test('gateway routes: a member never reaches the main agent or another agent, whatever selector they add',async()=>{
 for(const rest of GAPI)for(const method of ['GET','POST'])for(const [pre,qs,hd] of [['','',{}],['','?profile=mine',{}],['','?agent=mine',{}],['','?profile=mine&agent=mine',{}],['',' ',{'x-hermes-profile':'mine'}],['/p/other','?profile=mine',{}],['/p/other','?agent=mine',{}],['/p/default','?profile=mine',{}],['/p/mine%2F..','',{}],['/p/MINE','',{}]]){
  const r=await call('m1',method,'/gapi'+pre+rest+qs.trim(),method==='POST'?{profile:'mine',agent:'mine',message:'hi'}:undefined,hd);
  for(const x of r.reached)assert.ok(ALLOWED.has(engineAgent(x)),method+' /gapi'+pre+rest+qs+' reached agent '+engineAgent(x));
  assert.ok(r.status>=400,method+' /gapi'+pre+rest+qs+' → '+r.status)}
 // their own agent works, and the selectors that mean nothing to the gateway are dropped on the way
 const ok=await call('m1','POST','/gapi/p/mine/api/sessions?profile=other&agent=default',{});assert.equal(ok.status,200);assert.equal(ok.reached.length,1);
 assert.equal(engineAgent(ok.reached[0]),'mine');assert.equal(ok.reached[0].q.has('profile'),false);assert.equal(ok.reached[0].q.has('agent'),false);
 assert.equal((await call('m1','POST','/gapi/p/shared/api/sessions',{})).status,200)});

test('dashboard routes: a member never changes or reads the main agent or another agent, whatever selector they add',async()=>{
 for(const [method,rest] of HAPI)for(const [qs,b,ct] of [['',{},undefined],['?agent=mine',{},undefined],['?agent=mine',{agent:'mine'},undefined],['?profile=mine',{profile:'default'},undefined],['?profile=mine',{profile:'other'},undefined],['?profile=mine',{profile:'other'},'text/plain'],['?profile=mine',{profile:'priv'},''],
   ['?profile=other',{},undefined],['?profile=default',{},undefined],['?profile=mine&profile=other',{},undefined],['?profile=mine&agent=other',{profile:'other'},undefined]]){
  const hd=ct===undefined?{}:{'content-type':ct};const r=await call('m1',method,'/hapi'+rest+qs,method==='GET'?undefined:JSON.stringify(b),hd);
  for(const x of r.reached)if(!(x.method==='GET'&&/^\/api\/(status|profiles|sessions|model\/info|files)$/.test(x.path)))assert.ok(ALLOWED.has(engineAgent(x)),method+' /hapi'+rest+qs+' '+JSON.stringify(b)+' reached agent '+engineAgent(x)+' at '+x.path)}
 // on their own agent the forwarded request names it in the address and in the body, and nothing else
 const ok=await call('m1','POST','/hapi/cron/jobs?profile=mine&agent=other',{name:'n',prompt:'p',schedule:'0 9 * * *'});assert.equal(ok.status,200);const x=ok.reached.at(-1);
 assert.equal(x.q.get('profile'),'mine');assert.equal(x.q.has('agent'),false);assert.equal(x.body.profile,'mine');
 // the path form: /hapi/profiles/<agent>/...
 for(const [m,p2] of [['PUT','/hapi/profiles/default/soul?profile=mine'],['PUT','/hapi/profiles/other/soul?profile=mine'],['PUT','/hapi/profiles/other/model?profile=mine'],['DELETE','/hapi/profiles/default?profile=mine'],['GET','/hapi/profiles/other?profile=mine'],['PUT','/hapi/profiles/mine%2F..%2Fdefault/soul']]){
  const r=await call('m1',m,p2,m==='GET'?undefined:{content:'x'});assert.ok(r.status>=400,m+' '+p2+' → '+r.status);assert.equal(r.reached.length,0,m+' '+p2+' reached the engine')}
 const soul=await call('m1','PUT','/hapi/profiles/mine/soul?profile=other',{content:'x',profile:'default'});assert.equal(soul.status,200);assert.equal(engineAgent(soul.reached.at(-1)),'mine');assert.equal(soul.reached.at(-1).q.get('profile'),'mine');assert.equal(soul.reached.at(-1).body.profile,'mine')});

test('an admin cannot reach an agent that is private to its owner through the body',async()=>{
 for(const [qs,b] of [['?profile=priv',{}],['?profile=mine',{profile:'priv'}],['',{profile:'priv'}]]){const r=await call('ad1','POST','/hapi/cron/jobs'+qs,{name:'n',...b});
  assert.equal(r.status,403,qs+JSON.stringify(b));assert.equal(r.reached.length,0)}
 const ok=await call('ad1','POST','/hapi/cron/jobs?profile=mine',{name:'n',profile:'shared'});assert.equal(ok.status,200);assert.equal(engineAgent(ok.reached.at(-1)),'shared');assert.equal(ok.reached.at(-1).q.get('profile'),'shared')});

test('client headers that could carry an engine identity are not forwarded',async()=>{
 const r=await call('m1','POST','/gapi/p/mine/api/sessions',{}, {'x-hermes-session-token':'evil','x-hermes-profile':'default',authorization:'Bearer evil'});
 const h=r.reached.at(-1).headers;assert.equal(h.authorization,'Bearer k');assert.equal(Object.keys(h).filter(k=>k.startsWith('x-hermes-')).length,0)});
