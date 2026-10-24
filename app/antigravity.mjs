// Google AI Pro / Ultra through Antigravity, Google's official agy command-line tool (Google retired the Gemini CLI
// for personal accounts on 17 Oct 2026 and points people here). agy's first sign-in needs a real terminal, so it runs
// in a hidden tmux session: aqeelOS shows the Google link, the person signs in and pastes the code back into
// aqeelOS, which types it into that terminal. agy keeps and refreshes the login itself; the engine plugin
// antigravity-subscription then uses agy for chats (thinking only: aqeelOS keeps the tools and approvals).
import {execFile} from 'node:child_process';
import {mkdir,cp,readdir,stat,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {swr} from './swr.mjs';

const BIN=path.join(homedir(),'.local','bin','agy'),WORK=path.join(homedir(),'.cache','agy-work'),SESSION='agy-login';
const run=(cmd,args,o={})=>new Promise(res=>execFile(cmd,args,{timeout:o.timeout||20000,cwd:o.cwd,maxBuffer:4e6,env:{...process.env,PATH:path.join(homedir(),'.local','bin')+':'+process.env.PATH}},(e,out,err)=>res({ok:!e,out:String(out||''),err:String(err||e?.message||'')})));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export function createAntigravity({HERMES_HOME,hcmd,listAgents,moveOff=async()=>null}){
 // signed in or not is agy listing models (a CLI run of 5-30 s): the last answer is used at once and asked again behind the
 // scenes after 10 min; only the very first ask waits, at most 3 s ({partial:true}, the page then leaves the card out)
 let login=null;const seen=swr({fresh:10*60000,cap:3000});
 const pane=async()=>(await run('tmux',['capture-pane','-pt',SESSION,'-S','-300'])).out;
 // signed in = agy can list the account's models (agy keeps its login where it wants: keyring or its own file)
 async function models(){const r=await run(BIN,['models'],{timeout:30000,cwd:WORK});if(!r.ok||/not signed in|sign in|login/i.test(r.out+r.err)&&!/gemini|claude/i.test(r.out))return null;
  return r.out.split('\n').map(l=>l.trim()).filter(l=>/^[\w.-]+$/.test(l)||/^[-*•]\s*[\w.-]+/.test(l)).map(l=>l.replace(/^[-*•]\s*/,'').split(/\s/)[0]).filter(Boolean)}
 async function status(fresh){const installed=await stat(BIN).then(()=>true,()=>false);if(!installed)return {installed:false,signedIn:false};
  let part=false;const m=await seen.get('models',models,{force:!!fresh,partial:fresh?undefined:()=>{part=true;return null}});
  return {installed,signedIn:!!m,models:m||[],login:login?.state||null,...(part?{partial:true}:{})}}
 async function stop(){await run('tmux',['kill-session','-t',SESSION])}
 // the link sits between two ruled lines and is wrapped over several screen lines: join them back together
 const linkIn=t=>{const m=/Open the URL below[\s\S]*?─{10,}\s*\n([\s\S]*?)\n\s*─{10,}/.exec(t);return m?(m[1].replace(/\s+/g,'').match(/https:\/\/accounts\.google\.com\/\S+/)||[])[0]:null};
 async function start(){await mkdir(WORK,{recursive:true});await stop();
  const r=await run('tmux',['new-session','-d','-s',SESSION,'-x','200','-y','60','-c',WORK,'env SSH_CONNECTION=1 '+BIN]);if(!r.ok)throw new Error('Could not start the Antigravity sign-in: '+r.err.slice(0,200));
  const me=login={state:'waiting'};console.log('antigravity sign-in started');setTimeout(()=>{if(login===me&&me.state==='waiting'){me.state='expired';console.log('antigravity sign-in expired');stop()}},20*60000).unref();
  let chose=false;
  for(let i=0;i<60;i++){await sleep(500);const t=await pane();
   if(!chose&&/Select login method/.test(t)){chose=true;await run('tmux',['send-keys','-t',SESSION,'Enter']);continue}   // 1. Google OAuth
   const u=linkIn(t);if(u)return {url:u};
   if(!/not signed in|Select login method|Open the URL/i.test(t)&&i>16){const s=await status(true);if(s.signedIn){await stop();me.state='done';return {signedIn:true}}}}
  throw new Error('The Antigravity sign-in did not show a link. Try again.')}
 async function code(c){c=String(c||'').trim();if(!c||c.length>2048||/[\s'"`$\\]/.test(c))throw new Error('Paste the whole code from the Google page.');
  if(login?.state!=='waiting')throw new Error('This sign-in is not running any more. Press Connect again.');
  console.log('antigravity sign-in: code received');await run('tmux',['send-keys','-t',SESSION,'-l',c]);await run('tmux',['send-keys','-t',SESSION,'Enter']);
  for(let i=0;i<12;i++){await sleep(2500);const t=(await pane()).slice(-1500);
   if(/invalid|expired|failed|error/i.test(t)&&/code|auth/i.test(t)&&i>1){console.warn('antigravity sign-in refused:',t.replace(/\s+/g,' ').slice(-200));break}
   if(!/authorization code/i.test(t)||i>3){const s=await status(true);if(s.signedIn){login.state='done';console.log('antigravity signed in,',s.models.length,'models');await stop();await enableAll().catch(e=>console.warn('antigravity plugin',e.message));return {ok:true,models:s.models}}}}
  return {ok:false,error:'Google did not accept that code. Press Connect again, sign in with the new link and paste its code (each link works once).'}}
 // signing out moves every agent that thinks with Google to another model FIRST (its first usable priority entry, else
 // the main agent's model); if one can't be moved, nothing is signed out. Then the plugin goes off where nobody uses it.
 async function logout(){
  const route=async a=>{const y=await readFile(path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'config.yaml'),'utf8').catch(()=>'');const k=key=>((new RegExp('^model:[\\s\\S]*?\\n\\s+'+key+':\\s*(\\S+)','m').exec(y)||[])[1]||'').replace(/^["']|["']$/g,'');return {provider:k('provider'),model:k('default')}};
  const AG='antigravity-subscription',main=await route('default'),moved={},stuck=[];const usable=main.provider&&main.provider!==AG;const all=(await listAgents()).filter(a=>!a.includes('--'));
  for(const a of all){if((await route(a)).provider!==AG)continue;
   let to=await moveOff(a,'p:'+AG).catch(()=>null);
   if(!to&&usable&&a!=='default'){const r=await hcmd(a,['config','set','model.provider',main.provider],{timeout:60000}).catch(()=>({ok:false}));if(r.ok&&main.model)await hcmd(a,['config','set','model.default',main.model],{timeout:60000}).catch(()=>{});if(r.ok)to='main'}
   if(to)moved[a]=to;else stuck.push(a)}
  if(stuck.length)throw new Error('Still signed in: '+stuck.join(', ')+(stuck.length>1?' use':' uses')+' Google AI Pro and there is no other model to move to. Add another account to Priority, or pick another model for '+(stuck.length>1?'them':'it')+' first.');
  await stop();await mkdir(WORK,{recursive:true});
  await run('tmux',['new-session','-d','-s',SESSION,'-x','200','-y','60','-c',WORK,BIN]);await sleep(6000);
  await run('tmux',['send-keys','-t',SESSION,'-l','/logout']);await run('tmux',['send-keys','-t',SESSION,'Enter']);await sleep(4000);await stop();
  seen.drop();login=null;
  for(const a of all)await hcmd(a,['plugins','disable',AG],{timeout:150000}).catch(()=>{});
  console.log('antigravity signed out');return {ok:true,moved,stuck}}
 // second guard behind the text-only agent: agy's own permission list denies every action it could take
 async function denyAll(){const f=path.join(homedir(),'.gemini','antigravity-cli','settings.json');let cur={};try{cur=JSON.parse(await readFile(f,'utf8'))}catch{}
  const deny=['command(*)','read_file(*)','write_file(*)','read_url(*)','execute_url(*)','mcp(*)','unsandboxed(*)'];
  const next={...cur,permissions:{...(cur.permissions||{}),allow:[],ask:[],deny}};if(JSON.stringify(next)!==JSON.stringify(cur)){await mkdir(path.dirname(f),{recursive:true});await writeFile(f,JSON.stringify(next,null,2))}}
 // the engine plugin, installed for every agent and switched on (only once agy is signed in)
 async function enableAll(){await denyAll();const src=path.join(path.dirname(new URL(import.meta.url).pathname),'..','engine','antigravity-subscription');if(!await stat(src).then(()=>true,()=>false))return;
  for(const a of await listAgents()){if(a.includes('--'))continue;const dst=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'plugins','antigravity-subscription');
   await mkdir(dst,{recursive:true});for(const f of await readdir(src))await cp(path.join(src,f),path.join(dst,f),{recursive:true});
   const r=await hcmd(a,['plugins','enable','antigravity-subscription'],{timeout:150000});if(!r.ok)console.warn('antigravity plugin for',a,(r.err||'').slice(0,200))}
  console.log('antigravity subscription plugin ready')}
 return {status,start,code,logout,enableAll}}
