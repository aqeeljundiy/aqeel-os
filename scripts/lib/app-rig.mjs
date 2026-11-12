// The real app (app/server.mjs) started for a test, the way scripts/route-rights-matrix.test.mjs starts it: an empty home and data folder,
// a free port, AQEELOS_LIVE=0 (a test copy: no schedules, no background jobs), every outside address a stub that records what it gets.
// A preload refuses any connection that is not to this machine and turns every child process that is not node into "exit 127", so a
// proof can never reach a provider, a customer or the box. The owner is made by the app's own first-run path.
//   const rig=await startApp({seed:async({data,hh,home})=>{...files the app reads at start...},engine:(req)=>answer|undefined});
//   rig.http(method,path,{cookie,body,headers}) -> {status,json,text};  rig.seen: every request a stub received;  rig.owner: the owner's cookie
//   await rig.until(()=>condition, 'what was waited for');  await rig.stop()
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const PRELOAD=`import net from 'node:net';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const local=h=>!h||/^(localhost|127\\.|::1$|::ffff:127\\.|0\\.0\\.0\\.0$)/i.test(String(h).replace(/^\\[|\\]$/g,''));
const oc=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...a){const o=a[0];const host=o&&typeof o==='object'?(o.path?'':o.host):(typeof o==='number'&&typeof a[1]==='string'?a[1]:'');
 if(!local(host)){process.nextTick(()=>this.destroy(Object.assign(new Error('blocked by the test rig: '+host),{code:'ECONNREFUSED'})));return this}return oc.apply(this,a)};
const NODE=process.execPath,DEAD=['-e','process.exit(127)'],ok=f=>f===NODE;
const split=a=>{let cb;if(typeof a.at(-1)==='function')cb=a.pop();let opts;if(a.length&&a.at(-1)&&typeof a.at(-1)==='object'&&!Array.isArray(a.at(-1)))opts=a.pop();return {opts:{...(opts||{}),shell:false},cb}};
const oSpawn=cp.spawn,oSpawnSync=cp.spawnSync,oExecFile=cp.execFile,oExecFileSync=cp.execFileSync;
cp.spawn=function(f,...a){if(ok(f))return oSpawn.call(this,f,...a);return oSpawn.call(this,NODE,DEAD,split(a).opts)};
cp.spawnSync=function(f,...a){if(ok(f))return oSpawnSync.call(this,f,...a);return oSpawnSync.call(this,NODE,DEAD,split(a).opts)};
cp.execFile=function(f,...a){if(ok(f))return oExecFile.call(this,f,...a);const {opts,cb}=split(a);return oExecFile.call(this,NODE,DEAD,opts,cb)};
cp.execFileSync=function(f,...a){if(ok(f))return oExecFileSync.call(this,f,...a);return oExecFileSync.call(this,NODE,DEAD,split(a).opts)};
cp.exec=function(c,...a){const {opts,cb}=split(a);return oExecFile.call(cp,NODE,DEAD,opts,cb)};
cp.execSync=function(c,...a){return oExecFileSync.call(cp,NODE,DEAD,split(a).opts)};
syncBuiltinESMExports();`;

const listen=h=>new Promise(r=>{const s=createServer(h);s.listen(0,'127.0.0.1',()=>r(s))});
const freePort=()=>new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});

export async function startApp({seed=async()=>{},engine=()=>undefined,agents=['agent-a'],env={}}={}){
 const tmp=await mkdtemp(path.join(tmpdir(),'aq-rig-')),home=path.join(tmp,'home'),data=path.join(tmp,'data'),hh=path.join(home,'.hermes');
 await mkdir(data,{recursive:true});await mkdir(hh,{recursive:true});await writeFile(path.join(hh,'config.yaml'),'model: {}\n');
 for(const a of agents){await mkdir(path.join(hh,'profiles',a),{recursive:true});await writeFile(path.join(hh,'profiles',a,'config.yaml'),'model: {}\n')}
 const preload=path.join(tmp,'preload.mjs');await writeFile(preload,PRELOAD);
 const seen=[],servers=[],stubs={};
 const stub=kind=>(req,res)=>{const ch=[];req.on('data',c=>ch.push(c));req.on('end',()=>{const u=new URL(req.url,'http://x');const raw=Buffer.concat(ch).toString('utf8');let body=null;try{body=JSON.parse(raw)}catch{}
  const r={kind,method:req.method,path:u.pathname,q:Object.fromEntries(u.searchParams),body,headers:req.headers,at:Date.now()};seen.push(r);
  const own=engine(r);const names=['default',...agents];
  const ans=own!==undefined?own:u.pathname==='/api/status'&&req.method==='GET'?{gateway_running:true,gateway_state:'running',active_agents:1,gateway_pid:4242,hermes_home:hh,gateway_platforms:{},gateway_shared_with:names,profiles:names.map(name=>({name}))}
   :u.pathname==='/api/profiles'&&req.method==='GET'?{profiles:names.map(name=>({name}))}:u.pathname.endsWith('/api/sessions')&&req.method==='POST'?{id:'s-'+randomBytes(4).toString('hex')}:{ok:true,jobs:[],profiles:[],sessions:[]};
  res.writeHead(ans?.__status||200,{'content-type':'application/json'});res.end(JSON.stringify(ans))})};
 for(const k of ['dash','gate','hooks','wa','n8n'])servers.push(stubs[k]=await listen(stub(k)));
 const url=k=>'http://127.0.0.1:'+stubs[k].address().port;
 await seed({data,hh,home,tmp});
 const port=await freePort(),base='http://127.0.0.1:'+port;let log='';
 const app=spawn(process.execPath,['--import',pathToFileURL(preload).href,path.join(ROOT,'app','server.mjs')],{cwd:home,stdio:['ignore','pipe','pipe'],env:{UI_SIGNIN_FREE_TRIES:'1000000',PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:home,USERPROFILE:home,TMPDIR:tmp,TEMP:tmp,TMP:tmp,
  HERMES_HOME:hh,UI_DATA_DIR:data,UI_PORT:String(port),UI_HOST:'127.0.0.1',UI_INSECURE_COOKIE:'1',AQEELOS_LIVE:'0',HERMES_DASH:url('dash'),HERMES_API:url('gate'),HERMES_WEBHOOKS:url('hooks'),HERMES_WA_CLOUD:url('wa'),N8N_URL:url('n8n'),
  API_SERVER_KEY:'k',HERMES_DASHBOARD_SESSION_TOKEN:'engine-token',HERMES_BIN:path.join(tmp,'no-engine'),UI_SECRET:'rig-'+randomBytes(8).toString('hex'),PUBLIC_URL:'https://aqeelos.example',...env}});
 app.stdout.on('data',d=>log+=d);app.stderr.on('data',d=>log+=d);
 const stop=async()=>{app.kill('SIGKILL');for(const s of servers)s.close();await new Promise(r=>setTimeout(r,200));await rm(tmp,{recursive:true,force:true}).catch(()=>{})};
 let up=false;for(let i=0;i<200&&!up;i++){try{up=(await fetch(base+'/healthz')).ok}catch{}if(!up)await new Promise(r=>setTimeout(r,150))}
 if(!up){await stop();throw new Error('the app did not start:\n'+log.slice(-2000))}
 const http=async(method,p,{cookie,body,headers={},raw}={})=>{const r=await fetch(base+p,{method,redirect:'manual',headers:{...(cookie?{cookie}:{}),'x-hui':'1',...(body!==undefined?{'content-type':'application/json'}:{}),...headers},body:raw!==undefined?raw:body!==undefined?JSON.stringify(body):undefined});
  const text=await r.text();let json=null;try{json=JSON.parse(text)}catch{}return {status:r.status,text,json,cookie:(r.headers.getSetCookie?.()||[]).map(x=>x.split(';')[0]).find(x=>x.startsWith('hui=')&&x.length>6)||null}};
 const r=await http('POST','/auth/setup',{body:{name:'Owner',email:'owner@example.com',password:'Rig-test-pw-1'}});
 if(r.status!==200||!r.cookie){await stop();throw new Error('owner setup failed: '+r.status+' '+r.text.slice(0,200))}
 const until=async(f,what,ms=8000)=>{const t=Date.now();for(;;){const v=await f();if(v)return v;if(Date.now()-t>ms)throw new Error('waited '+ms+' ms for: '+what+'\n'+log.slice(-1500));await new Promise(z=>setTimeout(z,50))}};
 return {base,http,seen,owner:r.cookie,data,hh,home,tmp,until,stop,log:()=>log,pause:ms=>new Promise(z=>setTimeout(z,ms))}}
