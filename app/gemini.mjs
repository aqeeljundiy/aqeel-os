// Gemini through the person's Google AI subscription (Google AI Pro / Ultra), via the official Gemini CLI.
// The CLI's first sign-in needs a real terminal, so it runs in a hidden tmux session: aqeelOS shows the Google
// link, the person signs in and pastes the code back, aqeelOS types it into that terminal. The login is kept by
// the CLI in ~/.gemini (refreshed by the CLI itself); the engine plugin gemini-subscription then uses it for chats.
import {execFile} from 'node:child_process';
import {readFile,writeFile,rm,mkdir,stat,cp,readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

const GDIR=path.join(homedir(),'.gemini'),CREDS=path.join(GDIR,'oauth_creds.json'),SESSION='gemini-login';
const BIN=path.join(homedir(),'.local','bin','gemini');
const run=(cmd,args,o={})=>new Promise(res=>execFile(cmd,args,{timeout:o.timeout||20000,env:{...process.env,PATH:path.join(homedir(),'.local','bin')+':'+process.env.PATH,...(o.env||{})}},(e,out,err)=>res({ok:!e,out:String(out||''),err:String(err||e?.message||'')})));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Gemini only thinks: its own shell, file-writing and memory tools stay off (the engine also refuses its permission asks)
const SETTINGS={security:{auth:{selectedType:'oauth-personal'}},tools:{exclude:['run_shell_command','write_file','replace','save_memory']},general:{disableAutoUpdate:true,disableUpdateNag:true},privacy:{usageStatisticsEnabled:false}};

export function createGemini({HERMES_HOME,hcmd,listAgents}){
 let login=null;   // {started, state}
 async function ensureSettings(){await mkdir(GDIR,{recursive:true,mode:0o700});const f=path.join(GDIR,'settings.json');let cur={};try{cur=JSON.parse(await readFile(f,'utf8'))}catch{}
  const next={...cur,...SETTINGS,tools:{...(cur.tools||{}),...SETTINGS.tools},general:{...(cur.general||{}),...SETTINGS.general}};if(JSON.stringify(next)!==JSON.stringify(cur))await writeFile(f,JSON.stringify(next,null,2))}
 async function account(){try{const a=JSON.parse(await readFile(path.join(GDIR,'google_accounts.json'),'utf8'));return a.active||null}catch{return null}}
 async function status(){const installed=await stat(BIN).then(()=>true,()=>false);const signedIn=await stat(CREDS).then(s=>s.size>20,()=>false);
  // Google stopped serving Gemini CLI to personal accounts (Google AI Pro too) and points to Antigravity; checked 17 Oct 2026
  return {installed,signedIn,retired:true,account:signedIn?await account():null,login:login?.state||null}}
 const pane=async()=>(await run('tmux',['capture-pane','-pJt',SESSION,'-S','-200'])).out;
 async function start(){await ensureSettings();await run('tmux',['kill-session','-t',SESSION]);
  const r=await run('tmux',['new-session','-d','-s',SESSION,'-x','400','-y','80','-c',homedir(),'env NO_BROWSER=true '+BIN]);if(!r.ok)throw new Error('Could not start the Gemini sign-in: '+r.err.slice(0,200));
  const me=login={started:Date.now(),state:'waiting'};console.log('gemini sign-in started');setTimeout(()=>{if(login===me&&me.state==='waiting'){me.state='expired';console.log('gemini sign-in expired (no code within 20 minutes)');run('tmux',['kill-session','-t',SESSION])}},20*60000).unref();
  for(let i=0;i<60;i++){await sleep(500);const t=await pane();const m=/https:\/\/accounts\.google\.com\/o\/oauth2\/\S+/.exec(t.replace(/\n(?=\S)/g,''));if(m)return {url:m[0]};
   if(await stat(CREDS).then(()=>true,()=>false)){await stop();login.state='done';return {signedIn:true}}}
  throw new Error('The Gemini sign-in did not show a link. Try again.')}
 async function stop(){await run('tmux',['kill-session','-t',SESSION])}
 async function code(c){c=String(c||'').trim();if(!c||c.length>2048||/[\s'"`$\\]/.test(c))throw new Error('Paste the whole code from the Google page.');
  if(login?.state!=='waiting')throw new Error('This sign-in is not running any more. Start again.');
  await run('tmux',['send-keys','-t',SESSION,'-l',c]);await run('tmux',['send-keys','-t',SESSION,'Enter']);
  console.log('gemini sign-in: code received');const before=(await pane()).length;
  for(let i=0;i<60;i++){await sleep(500);if(await stat(CREDS).then(s=>s.size>20,()=>false)){login.state='done';console.log('gemini signed in as',await account());await sleep(1500);await stop();await enableAll().catch(e=>console.warn('gemini plugin',e.message));return {ok:true,account:await account()}}
   const tail=(await pane()).slice(Math.max(0,before-200));if(/invalid_grant|Failed to authenticate|Error authenticating|code.{0,20}(invalid|expired)/i.test(tail)){console.warn('gemini sign-in refused:',tail.replace(/\s+/g,' ').slice(-240));break}}
  return {ok:false,error:'Google did not accept that code. Press Connect again, sign in with the new link and paste its code (each link works once).'}}
 async function logout(){await stop();await rm(CREDS,{force:true});login=null;return {ok:true}}
 // the engine plugin, installed for every agent and switched on
 async function enableAll(){const src=path.join(path.dirname(new URL(import.meta.url).pathname),'..','engine','gemini-subscription');
  for(const a of await listAgents()){if(a.includes('--'))continue;const dst=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'plugins','gemini-subscription');
   await mkdir(dst,{recursive:true});for(const f of await readdir(src))await cp(path.join(src,f),path.join(dst,f));
   const r=await hcmd(a,['plugins','enable','gemini-subscription'],{timeout:150000});if(!r.ok)console.warn('gemini plugin for',a,(r.err||'').slice(0,200))}
  console.log('gemini subscription plugin ready')}
 return {status,start,code,logout,enableAll,ensureSettings}}
