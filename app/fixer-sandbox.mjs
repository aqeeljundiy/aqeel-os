// The fixer's own Linux user (security audit CR-7 and AUD-6, 13 Nov 2026).
// The on-box fixer used to be the engine run as the owner's user: a shell with every key. A report written by an outsider could
// steer it. Now EVERY fixer run (a fix to aqeelOS's code, a settings repair, a proof run) runs like this, and no run has any other way
// to start (issues.mjs holds a run until this is ready; there is no switch to turn it off):
//   - the engine process (it holds the model access) still belongs to the owner's user, but its tools are only "terminal" and "file",
//     and those run over SSH as the user aq-fixer (made by the root script, scripts/agent-users.sh, when this app writes "on" to
//     ~/.aqeelos-fixer-user);
//   - aq-fixer reads and writes only the git checkout it was given (an access list the app puts on that folder), cannot read
//     ~/.hermes, the data folder, the agents' folders or the local-owner key, and its only outgoing connection is this app on
//     127.0.0.1 (the firewall rules of the root script). GitHub and the AI provider are reached by the app and the engine, so no
//     address list is needed for them;
//   - what it needs from the app comes through routes signed for one run (the way agents' relays are signed): the issue, redacted
//     logs, the tests (run as aq-fixer), the test copy and a read-only probe of it, the diff, and (AUD-6) "repair" and "check": a short
//     list of named repairs the APP performs after checking the arguments, and read-only looks (fixer-actions.mjs). A repair run has
//     no checkout and a proof run changes nothing; both work only through those two routes. The pull request is opened by the app
//     after a code run (fixer-git.mjs), never by the fixer. Whatever is not on the lists ends as "needs a person".
// The engine may take its terminal settings from the profile's config.yaml rather than from the environment this sets, so the first
// time (and after every engine update) a canary run asks the confined engine for `id -un`: only an answer of aq-fixer counts. The
// launch variant that passed is kept; if none passes, fixes wait and Health says so. Nothing runs confined on a guess.
// Where the user cannot be made, fixes and proofs wait and Health says so; the fixer is never run as the owner's user instead.
import {execFile} from 'node:child_process';
import {readFile,writeFile,stat,mkdir,rename} from 'node:fs/promises';
import {createHmac,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {createFixerActions} from './fixer-actions.mjs';

export const FIXER_USER='aq-fixer';
export const TOOLSETS='terminal,file';
// launch variants the canary tries in order: the settings in the environment only, then without the profile's own config
export const VARIANTS=[{name:'env',args:[]},{name:'no-profile-config',args:['--ignore-user-config']}];
export const TEST_FILE=/^scripts\/[\w.-]+\.test\.mjs$/;
export const PROBE_PATH=/^\/(healthz|install-ping|auth\/me|auth\/setup|ui\/[\w\/.-]*)$/;

// the signature of one run's routes: HMAC over issue and run, the same way as the agents' relays (server.mjs sign)
export const opsSig=(sign,issue,run)=>String(sign('fixer-ops:'+issue+':'+run)).slice(0,32);
export const sigOk=(sign,issue,run,got)=>{const a=Buffer.from(String(got||'')),b=Buffer.from(opsSig(sign,issue,run));return a.length===b.length&&timingSafeEqual(a,b)};

const execP=(cmd,args,opt={})=>new Promise(res=>execFile(cmd,args,{timeout:opt.timeout||60000,maxBuffer:4e6,env:opt.env,cwd:opt.cwd},(e,o,er)=>res({ok:!e,out:String(o||''),err:String(er||e?.message||'')})));

export function createFixerSandbox({DATA,home,sign,redactText=t=>String(t),keyFile=path.join(home,'.hermes','agent-ssh','id_ed25519'),appPort=4400,run=execP,
 fetchFn=(...a)=>fetch(...a),isActive=async()=>false,issueText=async()=>'',logs=async()=>'',diffOf=async()=>'',log=()=>{},now=()=>Date.now(),bin=path.join(home,'.local','bin','aqeelos'),testPort=4402,owner=path.basename(home),actionsRun}){
 const REQ=path.join(home,'.aqeelos-fixer-user'),STATE=path.join(DATA,'fixer-sandbox.json'),FIX=path.join(home,'apps','aqeel-os-fixer');
 const load=async()=>JSON.parse(await readFile(STATE,'utf8').catch(()=>'{}')||'{}');
 const save=async s=>{await mkdir(DATA,{recursive:true});await writeFile(STATE+'.tmp',JSON.stringify(s,null,1),{mode:0o600});await rename(STATE+'.tmp',STATE)};
 // ask the root script for the user (once; it answers in <file>.done)
 async function request(on){const want=on?'on\n':'off\n';if((await readFile(REQ,'utf8').catch(()=>''))!==want)await writeFile(REQ,want)}
 const userReady=async()=>(await readFile(REQ+'.done','utf8').catch(()=>'')).split('\n').includes(FIXER_USER);
 // the engine's identity for the canary: a new engine (an update) is checked again
 async function engineSig(){const s=await stat(bin).catch(()=>null);const r=s?`${Math.round(s.mtimeMs)}:${s.size}`:'none';return r}
 // the folder the fixer works in, readable and writable by aq-fixer only through an access list; the folders above it are passed through
 async function prepareDir(dir){
  if(!dir.startsWith(FIX+path.sep))return {ok:false,why:'not a fixer work dir'};
  for(const d of [path.dirname(FIX),FIX]){await mkdir(d,{recursive:true}).catch(()=>{});await run('setfacl',['-m','u:'+FIXER_USER+':--x',d])}
  const r=await run('setfacl',['-R','-m','u:'+FIXER_USER+':rwX','-m','d:u:'+FIXER_USER+':rwX','-m','u:'+owner+':rwX','-m','d:u:'+owner+':rwX',dir]);
  return r.ok?{ok:true}:{ok:false,why:'access list: '+r.err.slice(0,200)}}
 // what the fixer's user wrote there is its own: removed as that user (the owner's user cannot unlink in folders it made)
 async function clean(dir){if(!String(dir).startsWith(FIX+path.sep)||!await userReady())return;await ssh('find '+q(dir)+' -mindepth 1 -delete',90000)}
 const sshArgs=cmd=>['-i',keyFile,'-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes','-p','22',FIXER_USER+'@127.0.0.1',cmd];
 const ssh=(cmd,timeout=240000)=>run('ssh',sshArgs(cmd),{timeout});
 const q=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
 const actions=createFixerActions({DATA,home,redactText,log,...(actionsRun?{run:actionsRun}:{})});
 // the scratch folder of a repair or proof run (no checkout): its own, wiped before each run
 const scratch=issue=>path.join(FIX,'s-'+String(issue).replace(/[^\w-]/g,''));

 // What to do with a run: confine it, or hold it (the user or the canary is not ready). Never run it unconfined: there is no third answer.
 // mode: code (a bug in aqeelOS's own code, in a git checkout), repair (a settings repair, through the app's named repairs), proof (read-only checks).
 async function plan(pol,i,{mode='code',hasWorkDir=true}={}){
  await request(true).catch(()=>{});
  if(mode==='code'&&!hasWorkDir)return {confine:false,hold:true,why:'No git work dir for the confined fixer.'};
  if(!await userReady())return {confine:false,hold:true,why:'The fixer\'s own user ('+FIXER_USER+') is not made yet; the box\'s root script makes it within a minute of the request.'};
  const s=await load(),sig=await engineSig();
  if(s.canary?.sig===sig&&s.canary.ok)return {confine:true,mode,variant:VARIANTS.find(v=>v.name===s.canary.variant)||VARIANTS[0]};
  if(s.canary?.sig===sig&&s.canary.ok===false&&now()-(s.canary.at||0)<30*60e3)return {confine:false,hold:true,broken:true,why:'The engine did not run its tools as '+FIXER_USER+' in the last check ('+(s.canary.note||'no answer')+'); fixes wait and it is checked again.'};
  return {confine:true,mode,canary:true,sig,variant:null}}
 async function recordCanary(sig,variant,ok,note=''){const s=await load();s.canary={sig,variant:variant||null,ok:!!ok,at:now(),note:String(note).slice(0,200)};await save(s)}

 // what the engine run is launched with: the terminal settings in its environment, only terminal and file tools, the routes' address
 function launch({workDir,issue,run:runId,variant=VARIANTS[0]}){
  const url='http://127.0.0.1:'+appPort+'/fixer-ops/'+issue+'/'+runId+'/'+opsSig(sign,issue,runId);
  return {url,workDir,args:['-t',TOOLSETS,...(variant?.args||[])],
   env:{TERMINAL_ENV:'ssh',TERMINAL_SSH_HOST:'127.0.0.1',TERMINAL_SSH_USER:FIXER_USER,TERMINAL_SSH_PORT:'22',TERMINAL_SSH_KEY:keyFile,TERMINAL_CWD:workDir||FIX,AQEELOS_FIXER_URL:url}}}

 // ---- the routes. op is the last path part; body is parsed JSON. Returns {status,json}.
 async function ops(op,issue,runId,sig,body={}){
  if(!/^[\w-]{1,40}$/.test(issue)||!/^[\w-]{1,60}$/.test(runId))return {status:400,json:{error:'bad address'}};
  if(!sigOk(sign,issue,runId,sig))return {status:403,json:{error:'bad signature'}};
  const sc=await isActive(issue,runId);if(!sc)return {status:410,json:{error:'This run is over; its routes are closed.'}};
  const scope=sc===true?{}:sc,mode=scope.mode||'code',ctx={issue,run:runId,agents:scope.agents||[]};
  const dir=mode==='code'?path.join(FIX,issue):scratch(issue);
  if(op==='help')return {status:200,json:actions.help()};
  if(op==='check')return actions.check(String(body.check||''),body.args??{},ctx);
  if(op==='repair'){if(mode!=='repair')return {status:403,json:{error:'Repairs are only for a repair run.'}};return actions.repair(String(body.action||''),body.args??{},ctx)}
  if(mode!=='code')return {status:403,json:{error:'This route is for a code fix. Use repair, check or help.'}};
  if(op==='issue')return {status:200,json:{text:redactText(await issueText(issue))}};
  if(op==='logs')return {status:200,json:{text:redactText(String(await logs(issue)||'')).slice(-12000)}};
  if(op==='diff')return {status:200,json:{diff:redactText(String(await diffOf(issue)||'')).slice(0,200000)}};
  if(op==='tests'){const files=[].concat(body.files||[]).map(String);
   if(!files.length||files.length>8||!files.every(f=>TEST_FILE.test(f)&&!f.includes('..')))return {status:400,json:{error:'Name 1 to 8 test files like scripts/<name>.test.mjs.'}};
   // as aq-fixer, in its own checkout: no keys, no network
   const r=await ssh('cd '+q(dir)+' && timeout 220 node --test '+files.map(q).join(' ')+' 2>&1 | tail -c 8000',240000);
   return {status:200,json:{ok:r.ok,output:redactText(r.out||r.err).slice(-8000)}}}
  if(op==='testcopy'){const r=await ssh('cd '+q(dir)+' && AQ_OWNER='+q(path.basename(home))+' bash scripts/fixer-testcopy.sh --isolated '+q(dir)+' 2>&1 | tail -c 3000',900000);
   return {status:200,json:{ok:r.ok,output:redactText(r.out||r.err).slice(-3000)}}}
  if(op==='probe'){const p=String(body.path||'');if(!PROBE_PATH.test(p)||p.includes('..'))return {status:400,json:{error:'Only read-only pages of the test copy: /healthz, /auth/me, /ui/...'}};
   const base='http://127.0.0.1:'+testPort;let cookie='';
   try{const pw=(await readFile(path.join(FIX,'.testcopy','pw'),'utf8').catch(()=>'')).trim();
    if(pw&&p!=='/healthz'){const l=await fetchFn(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'',password:pw}),signal:AbortSignal.timeout(15000)});cookie=(l.headers.get('set-cookie')||'').split(';')[0]}
    const r=await fetchFn(base+p,{headers:cookie?{cookie}:{},signal:AbortSignal.timeout(20000)});const t=await r.text();
    return {status:200,json:{status:r.status,body:redactText(t).slice(0,6000)}}}catch(e){return {status:200,json:{error:'The test copy does not answer: '+String(e.message).slice(0,160)}}}}
  return {status:404,json:{error:'Unknown route'}}}

 return {request,userReady,plan,recordCanary,launch,prepareDir,clean,ops,engineSig,scratch,help:actions.help,journal:actions.journal,added:actions.added,FIX,state:load}}
export const canaryOk=(out,owner)=>/(^|\s)aq-fixer(\s|$)/.test(String(out))&&!new RegExp('(^|\\s)'+String(owner).replace(/[^\w-]/g,'')+'(\\s|$)').test(String(out).replace(/aq-fixer/g,''));
