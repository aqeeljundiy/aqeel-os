// Google AI Pro / Ultra through Antigravity, Google's official agy command-line tool (Google retired the Gemini CLI
// for personal accounts on 17 Oct 2026 and points people here). agy's first sign-in needs a real terminal, so it runs
// in a hidden tmux session: aqeelOS shows the Google link, the person signs in and pastes the code back into
// aqeelOS, which types it into that terminal. agy keeps and refreshes the login itself; the engine plugin
// antigravity-subscription then uses agy for chats (thinking only: aqeelOS keeps the tools and approvals).
import {execFile} from 'node:child_process';
import {mkdir,cp,readdir,stat,readFile,writeFile,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {swr} from './swr.mjs';
import {writeStore} from './store.mjs';

const BIN=path.join(homedir(),'.local','bin','agy'),WORK=path.join(homedir(),'.cache','agy-work'),SESSION='agy-login';
const run=(cmd,args,o={})=>new Promise(res=>execFile(cmd,args,{timeout:o.timeout||20000,cwd:o.cwd,maxBuffer:4e6,env:{...process.env,...(o.home?{HOME:o.home}:{}),PATH:path.join(homedir(),'.local','bin')+':'+process.env.PATH}},(e,out,err)=>res({ok:!e,out:String(out||''),err:String(err||e?.message||'')})));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// more Google accounts (owner, 20 Nov 2026: "I have two Google Gemini accounts"): agy keeps one sign-in per home folder, so
// each extra account is a folder of its own under ~/.aqeelos/agy/<id>, listed in ~/.gemini/aqeelos-accounts.json, which the
// engine plugin reads to spread the work and to move on when one runs out. The first account stays agy's own (~/.gemini).
const ACCTS=path.join(homedir(),'.gemini','aqeelos-accounts.json'),EXTRA=path.join(homedir(),'.aqeelos','agy');
const agyDir=home=>path.join(home,'.gemini','antigravity-cli');
const readAccts=async()=>{try{const j=JSON.parse(await readFile(ACCTS,'utf8'));return Array.isArray(j.accounts)?j.accounts.filter(a=>/^g[0-9a-f]{6}$/.test(a.id||'')):[]}catch{return []}};
const writeAccts=async l=>{await mkdir(path.dirname(ACCTS),{recursive:true});await writeStore(ACCTS,JSON.stringify({accounts:l},null,1))};

export function createAntigravity({HERMES_HOME,hcmd,listAgents,moveOff=async()=>null}){
 // signed in or not is agy listing models (a CLI run of 5-30 s): the last answer is used at once and asked again behind the
 // scenes after 10 min; only the very first ask waits, at most 3 s ({partial:true}, the page then leaves the card out)
 let login=null;const seen=swr({fresh:10*60000,cap:3000});
 const pane=async()=>(await run('tmux',['capture-pane','-pt',SESSION,'-S','-300'])).out;
 // signed in = agy can list the account's models (agy keeps its login where it wants: keyring or its own file)
 async function models(home){const r=await run(BIN,['models'],{timeout:30000,cwd:WORK,home});if(!r.ok||/not signed in|sign in|login/i.test(r.out+r.err)&&!/gemini|claude/i.test(r.out))return null;
  return r.out.split('\n').map(l=>l.trim()).filter(l=>/^[\w.-]+$/.test(l)||/^[-*•]\s*[\w.-]+/.test(l)).map(l=>l.replace(/^[-*•]\s*/,'').split(/\s/)[0]).filter(Boolean)}
 async function status(fresh){const installed=await stat(BIN).then(()=>true,()=>false);if(!installed)return {installed:false,signedIn:false};
  let part=false;const m=await seen.get('models',models,{force:!!fresh,partial:fresh?undefined:()=>{part=true;return null}});
  const extra=[];for(const a of await readAccts())extra.push({id:a.id,label:a.label,pending:!!a.pending,signedIn:!!(await seen.get('models|'+a.id,()=>models(a.home),{force:!!fresh,partial:()=>null}))});
  return {installed,signedIn:!!m,models:m||[],login:login?.state||null,accounts:extra,...(part?{partial:true}:{})}}
 async function stop(){await run('tmux',['kill-session','-t',SESSION])}
 // the link sits between two ruled lines and is wrapped over several screen lines: join them back together
 const linkIn=t=>{const m=/Open the URL below[\s\S]*?─{10,}\s*\n([\s\S]*?)\n\s*─{10,}/.exec(t);return m?(m[1].replace(/\s+/g,'').match(/https:\/\/accounts\.google\.com\/\S+/)||[])[0]:null};
 async function start(account){await mkdir(WORK,{recursive:true});await stop();if(login?.acct?.pending)await dropAcct(login.acct.id);
  // "new": one more Google account in a folder of its own, with the same deny-everything settings as the first
  let acct=null;if(account==='new'){const l=await readAccts();if(l.length>=8)throw new Error('Eight extra Google accounts is the most.');const id='g'+randomBytes(3).toString('hex');
   acct={id,label:'Google AI Pro '+(l.length+2),home:path.join(EXTRA,id),pending:true};await mkdir(agyDir(acct.home),{recursive:true});await writeAccts([...l,acct]);await denyAll()}
  const r=await run('tmux',['new-session','-d','-s',SESSION,'-x','200','-y','60','-c',WORK,'env SSH_CONNECTION=1 '+(acct?'HOME='+acct.home+' ':'')+BIN]);if(!r.ok){if(acct)await dropAcct(acct.id);throw new Error('Could not start the Antigravity sign-in: '+r.err.slice(0,200))}
  const me=login={state:'waiting',acct};console.log('antigravity sign-in started'+(acct?' for '+acct.id:''));setTimeout(()=>{if(login===me&&me.state==='waiting'){me.state='expired';console.log('antigravity sign-in expired');stop();if(acct)dropAcct(acct.id)}},20*60000).unref();
  let chose=false;
  for(let i=0;i<60;i++){await sleep(500);const t=await pane();
   if(!chose&&/Select login method/.test(t)){chose=true;await run('tmux',['send-keys','-t',SESSION,'Enter']);continue}   // 1. Google OAuth
   const u=linkIn(t);if(u)return {url:u};
   if(!/not signed in|Select login method|Open the URL/i.test(t)&&i>16){if(await signedHere(acct)){await stop();me.state='done';await kept(acct);return {signedIn:true}}}}
  throw new Error('The Antigravity sign-in did not show a link. Try again.')}
 async function code(c){c=String(c||'').trim();if(!c||c.length>2048||/[\s'"`$\\]/.test(c))throw new Error('Paste the whole code from the Google page.');
  if(login?.state!=='waiting')throw new Error('This sign-in is not running any more. Press Try again.');
  console.log('antigravity sign-in: code received');await run('tmux',['send-keys','-t',SESSION,'-l',c]);await run('tmux',['send-keys','-t',SESSION,'Enter']);
  for(let i=0;i<24;i++){await sleep(2500);const t=(await pane()).slice(-1500);
   if(/invalid|expired|failed|error/i.test(t)&&/code|auth/i.test(t)&&i>1){console.warn('antigravity sign-in refused:',t.replace(/\s+/g,' ').slice(-200));break}
   // an extra account counts as signed in once agy has saved its sign-in in that folder (20 Nov 2026: a fresh folder's agy kept
   // showing setup screens after the code, so its model list never came within the wait and the new account was thrown away)
   const saved=login.acct&&await stat(path.join(agyDir(login.acct.home),'antigravity-oauth-token')).then(()=>true,()=>false);
   if(saved||!/authorization code/i.test(t)||i>3){const ms=saved?['(signed in)']:login.acct?await models(login.acct.home):(await status(true)).models;if(ms?.length){login.state='done';console.log('antigravity signed in'+(login.acct?' ('+login.acct.id+')':'')+',',ms.length,'models');await stop();await kept(login.acct);seen.drop();await enableAll().catch(e=>console.warn('antigravity plugin',e.message));return {ok:true,models:ms}}}}
  console.warn('antigravity sign-in not confirmed'+(login.acct?' for '+login.acct.id:'')+':',(await pane()).replace(/\s+/g,' ').slice(-300));
  return {ok:false,error:'Google did not accept that code. Press Try again, sign in with the new link and paste its code (each link works once).'}}
 // closing the Connect dialog ends the sign-in here too (25 Oct): the hidden terminal goes and a code sent later is refused
 async function cancel(){if(login?.state==='waiting'){login.state='cancelled';console.log('antigravity sign-in cancelled');await stop();if(login.acct)await dropAcct(login.acct.id)}return {ok:true}}
 // an extra account: signed in = agy lists its models from that folder; kept once signed in, its folder and line gone if not
 async function signedHere(acct){return acct?!!(await models(acct.home))?.length:(await status(true)).signedIn}
 async function kept(acct){if(!acct)return;acct.pending=false;const l=await readAccts();await writeAccts(l.map(a=>a.id===acct.id?{id:a.id,label:a.label,home:a.home}:a))}
 async function dropAcct(id){const l=await readAccts(),a=l.find(x=>x.id===id);if(!a)return;await writeAccts(l.filter(x=>x.id!==id));if(a.home.startsWith(EXTRA+path.sep))await rm(a.home,{recursive:true,force:true});seen.drop()}
 // Remove on an extra account: its line and folder go; agents keep using the other Google accounts (the plugin reads the list each time)
 async function removeAcct(id){if(!/^g[0-9a-f]{6}$/.test(String(id||'')))throw new Error('Unknown account.');if(!(await readAccts()).some(a=>a.id===id))throw new Error('That account is not there any more.');
  await dropAcct(id);console.log('antigravity account',id,'removed');return {ok:true}}
 async function renameAcct(id,label){label=String(label||'').replace(/[^\w .@+-]/g,'').trim().slice(0,40);const l=await readAccts();if(!l.some(a=>a.id===id))throw new Error('Unknown account.');await writeAccts(l.map(a=>a.id===id?{...a,label:label||a.label}:a));return {ok:true}}
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
 async function denyAll(){for(const home of [homedir(),...(await readAccts()).map(a=>a.home)]){const f=path.join(agyDir(home),'settings.json');let cur={};try{cur=JSON.parse(await readFile(f,'utf8'))}catch{}
  const deny=['command(*)','read_file(*)','write_file(*)','read_url(*)','execute_url(*)','mcp(*)','unsandboxed(*)'];
  const next={...cur,permissions:{...(cur.permissions||{}),allow:[],ask:[],deny}};if(JSON.stringify(next)!==JSON.stringify(cur)){await mkdir(path.dirname(f),{recursive:true});await writeStore(f,JSON.stringify(next,null,2))}}}
 // the engine plugin, installed for every agent and switched on (only once agy is signed in)
 async function enableAll(){await denyAll();const src=path.join(path.dirname(new URL(import.meta.url).pathname),'..','engine','antigravity-subscription');if(!await stat(src).then(()=>true,()=>false))return;
  for(const a of await listAgents()){if(a.includes('--'))continue;const dst=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'plugins','antigravity-subscription');
   await mkdir(dst,{recursive:true});for(const f of await readdir(src))await cp(path.join(src,f),path.join(dst,f),{recursive:true});
   const r=await hcmd(a,['plugins','enable','antigravity-subscription'],{timeout:150000});if(!r.ok)console.warn('antigravity plugin for',a,(r.err||'').slice(0,200))}
  console.log('antigravity subscription plugin ready')}
 return {status,start,code,cancel,logout,enableAll,removeAcct,renameAcct,denyAll}}
