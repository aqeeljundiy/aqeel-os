// Several ChatGPT plans side by side (owner, 20 Nov 2026: "we could add a lot of Claude subs, but not a lot of Gemini or GPT
// subs"). The engine already keeps a pool of sign-ins per provider (auth.json credential_pool) and moves to the next one
// when an account runs out; aqeelOS only had a way to add the first. Adding another runs the engine's own
// `hermes auth add openai-codex` in a hidden terminal: aqeelOS shows its link and code, the person approves in the browser,
// the engine saves the new sign-in in the pool. Every agent then takes the least used account first.
// (Several Google accounts are in antigravity.mjs: agy keeps one sign-in per home folder.)
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {homeOf} from './agentops.mjs';

const SESSION='aq-codex-add',sleep=ms=>new Promise(r=>setTimeout(r,ms));
const run=(cmd,args,o={})=>new Promise(res=>execFile(cmd,args,{timeout:o.timeout||20000,maxBuffer:4e6},(e,out,err)=>res({ok:!e,out:String(out||''),err:String(err||e?.message||'')})));
// a label is shown on the account card; it goes into a terminal command, so only plain characters
export const cleanLabel=s=>String(s||'').replace(/[^\w .@+-]/g,'').replace(/\s+/g,' ').trim().slice(0,40);
// the engine's device sign-in screen: the address and the code (XXXX-XXXXX)
export function deviceOf(t){const u=/https:\/\/auth\.openai\.com\/\S*device\S*/.exec(t),c=/\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/.exec(t.split(/Enter this code/i)[1]||'');return u&&c?{url:u[0],code:c[1]}:null}
// the pool as the card shows it: no tokens, only who, how it is doing and how much it was used
export function poolView(auth){const l=auth?.credential_pool?.['openai-codex'];return (Array.isArray(l)?l:[]).map((e,i)=>({id:String(e.id||''),label:String(e.label&&e.label!=='device_code'?e.label:i===0?'ChatGPT':'ChatGPT '+(i+1)),
 priority:+e.priority||0,requests:+e.request_count||0,status:e.last_status||null,error:e.last_error_code||null,resetAt:e.last_error_reset_at||null}))}

export function createModelPools({HERMES_HOME,hcmd,listAgents,log=m=>console.log(m)}){
 const HBIN=path.join(homedir(),'.local','bin','hermes'),AUTH=path.join(HERMES_HOME,'auth.json');
 const codexList=async()=>poolView(JSON.parse(await readFile(AUTH,'utf8').catch(()=>'{}')||'{}'));
 const pane=async()=>(await run('tmux',['capture-pane','-pt',SESSION,'-S','-200'])).out;
 const stop=()=>run('tmux',['kill-session','-t',SESSION]);
 let login=null;
 // every agent takes the ChatGPT account used least so far (the engine's least_used); set once, where it is not set yet
 async function spread(){for(const a of await listAgents()){if(a.includes('--'))continue;const y=await readFile(path.join(homeOf(a),'config.yaml'),'utf8').catch(()=>'');
  if(/credential_pool_strategies:[\s\S]{0,200}openai-codex:\s*least_used/.test(y))continue;await hcmd(a,['config','set','credential_pool_strategies.openai-codex','least_used'],{timeout:60000}).catch(()=>{})}}
 async function codexAdd(label){const name=cleanLabel(label)||'ChatGPT '+((await codexList()).length+1);await stop();
  const before=(await codexList()).length;
  const r=await run('tmux',['new-session','-d','-s',SESSION,'-x','200','-y','50',`${HBIN} auth add openai-codex --type oauth --no-browser --label '${name}'`]);if(!r.ok)throw Error('Could not start the ChatGPT sign-in: '+r.err.slice(0,200));
  const me=login={state:'waiting',before,label:name};setTimeout(()=>{if(login===me&&me.state==='waiting'){me.state='expired';stop()}},15*60000).unref();
  for(let i=0;i<40;i++){await sleep(500);const d=deviceOf(await pane());if(d){log('chatgpt pool: sign-in started for '+name);return {...d,expires:15*60000}}}
  await stop();throw Error('The ChatGPT sign-in did not show a code. Try again.')}
 async function codexPoll(){if(!login)return {state:'none'};if(login.state!=='waiting')return {state:login.state};
  const now=await codexList();if(now.length>login.before){login.state='done';await stop();log('chatgpt pool: '+login.label+' added ('+now.length+' accounts)');await spread().catch(e=>log('chatgpt pool spread: '+e.message));return {state:'done',accounts:now}}
  const t=(await pane()).slice(-800);if(/error|failed|denied|expired|cancel/i.test(t)&&!/Waiting for sign-in/i.test(t.slice(-200))){login.state='error';await stop();return {state:'error',error:'The sign-in did not finish. Press Try again.'}}
  return {state:'waiting'}}
 async function codexCancel(){if(login?.state==='waiting'){login.state='cancelled';await stop()}return {ok:true}}
 // the first account is the card itself (Remove on the card); an extra one goes on its own
 async function codexRemove(id){id=String(id||'');if(!/^[0-9a-z]{4,16}$/i.test(id))throw Error('Unknown account.');const l=await codexList();const i=l.findIndex(x=>x.id===id);
  if(i<0)throw Error('That account is not there any more.');if(l.length<2)throw Error('This is the only ChatGPT account: remove it from its card.');
  const r=await run(HBIN,['auth','remove','openai-codex',id],{timeout:60000});if(!r.ok)throw Error('Could not remove it: '+(r.err||r.out).slice(0,200));log('chatgpt pool: '+l[i].label+' removed');return {ok:true,accounts:await codexList()}}
 // the routes (admins only; server.mjs keeps one line): /ui/pools/chatgpt  GET list · POST add · GET add (how it goes) · DELETE add · DELETE /<id>
 async function handle(req,res,p,{admin,send,readBody}){if(!p.startsWith('/ui/pools/chatgpt'))return false;if(!admin)return send(res,403,{error:'Only admins add accounts.'}),true;
  try{if(p==='/ui/pools/chatgpt'&&req.method==='GET')return send(res,200,{accounts:await codexList()}),true;
   if(p==='/ui/pools/chatgpt/add'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,2048))}catch{}return send(res,200,await codexAdd(b.label)),true}
   if(p==='/ui/pools/chatgpt/add'&&req.method==='GET')return send(res,200,await codexPoll()),true;
   if(p==='/ui/pools/chatgpt/add'&&req.method==='DELETE')return send(res,200,await codexCancel()),true;
   const m=/^\/ui\/pools\/chatgpt\/([0-9a-z]{4,16})$/i.exec(p);if(m&&req.method==='DELETE')return send(res,200,await codexRemove(m[1])),true;
   return send(res,404,{error:'Not found'}),true}catch(e){return send(res,409,{error:e.message}),true}}
 return {codexList,codexAdd,codexPoll,codexCancel,codexRemove,spread,handle}}
