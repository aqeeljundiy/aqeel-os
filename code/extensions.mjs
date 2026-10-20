// Customisation shared by Claude and GPT: saved prompts (slash commands), skills, hooks and scheduled runs.
import {readFile,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {shell,killTree,isWindows} from './platform.mjs';

const NAME=/^[a-z][a-z0-9-]{0,39}$/;
export const HOOK_EVENTS=['run-start','files-changed','run-finished'];
export const EVERY=['hour','day','weekday','week'];

// "---\nkey: value\n---\nbody" → {meta, body}
export function frontmatter(text){const m=String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);if(!m)return {meta:{},body:String(text)};
 const meta={};for(const line of m[1].split(/\r?\n/)){const kv=line.match(/^([\w-]+):\s*(.*)$/);if(kv)meta[kv[1]]=kv[2].replace(/^["']|["']$/g,'').trim()}return {meta,body:String(text).slice(m[0].length)}}

async function mdFiles(dir){try{return (await readdir(dir)).filter(f=>f.endsWith('.md')).slice(0,100).map(f=>path.join(dir,f))}catch{return []}}

// Saved prompts from settings plus Claude (.claude/commands) and Codex (.codex/prompts) command files.
export async function loadPrompts(cwd,settings,home=os.homedir()){const out=[];const seen=new Set();const add=p=>{if(!seen.has(p.name)){seen.add(p.name);out.push(p)}};
 for(const p of settings.prompts||[])add({name:p.name,description:p.description||p.text.split('\n')[0].slice(0,80),text:p.text,source:'Saved'});
 for(const [dir,source] of [[path.join(cwd,'.claude','commands'),'Project'],[path.join(cwd,'.codex','prompts'),'Project'],[path.join(home,'.claude','commands'),'Claude'],[path.join(home,'.codex','prompts'),'Codex']])
  for(const file of await mdFiles(dir)){const name=path.basename(file,'.md').toLowerCase().replace(/[^a-z0-9-]+/g,'-');if(!NAME.test(name))continue;try{const {meta,body}=frontmatter(await readFile(file,'utf8'));if(body.trim())add({name,description:meta.description||body.trim().split('\n')[0].slice(0,80),text:body.trim().slice(0,20000),source})}catch{}}
 return out}

export function validatePrompts(list){if(!Array.isArray(list)||list.length>50)throw Error('Save up to 50 prompts.');const names=new Set();
 return list.map(p=>{const name=String(p.name||'').trim().toLowerCase();if(!NAME.test(name))throw Error('Prompt names use lowercase letters, numbers and dashes, like fix-tests.');if(names.has(name))throw Error('Two prompts are named '+name+'.');names.add(name);
  const text=String(p.text||'').trim();if(!text||text.length>20000)throw Error('Write the prompt for /'+name+'.');return {name,text,description:String(p.description||'').trim().slice(0,120)}})}

// Skills: folders with a SKILL.md (name + description frontmatter), from the project and the user's Claude/Codex homes.
export async function loadSkills(cwd,settings,home=os.homedir()){const out=[];const seen=new Set();const off=new Set(settings.disabledSkills||[]);
 for(const [dir,source] of [[path.join(path.dirname(fileURLToPath(import.meta.url)),'data','skills'),'Bundle'],[path.join(cwd,'.claude','skills'),'Project'],[path.join(cwd,'.agents','skills'),'Project'],[path.join(home,'.claude','skills'),'Claude'],[path.join(home,'.codex','skills'),'Codex']]){
  let names=[];try{names=(await readdir(dir,{withFileTypes:true})).filter(d=>d.isDirectory()).map(d=>d.name).slice(0,100)}catch{}
  for(const folder of names){const file=path.join(dir,folder,'SKILL.md');try{const {meta}=frontmatter(await readFile(file,'utf8'));const name=(meta.name||folder).trim();if(seen.has(name))continue;seen.add(name);out.push({name,description:(meta.description||'').slice(0,300),path:file,source,enabled:!off.has(name)})}catch{}}}
 return out}

// Progressive disclosure: the AI sees names and descriptions and reads SKILL.md only when a skill applies.
export function skillsInstructions(skills){const on=skills.filter(s=>s.enabled);if(!on.length)return '';
 return '\n\nSkills are available. When a request matches a skill, read its SKILL.md first and follow it:\n'+on.slice(0,40).map(s=>'- '+s.name+(s.description?': '+s.description:'')+' ('+s.path+')').join('\n')}

export function validateHooks(list){if(!Array.isArray(list)||list.length>20)throw Error('Add up to 20 hooks.');
 return list.map(h=>{if(!HOOK_EVENTS.includes(h.event))throw Error('Unknown hook event.');const command=String(h.command||'').trim();if(!command||command.length>1000)throw Error('Enter the command the hook runs.');return {id:/^[\w-]{1,40}$/.test(h.id||'')?h.id:randomUUID(),event:h.event,command,enabled:h.enabled!==false}})}

// Run a hook's shell command in the project folder; resolves {code, output}. Never throws.
export function runHook(hook,{cwd,env={},timeout=60000}){return new Promise(resolve=>{
 // PowerShell: stop on cmdlet errors and pass a native command's exit code through
 const {exe,args}=shell(isWindows?"$ErrorActionPreference='Stop'\n"+hook.command+"\nif($LASTEXITCODE){exit $LASTEXITCODE}":hook.command);let output='',done=false;
 let child;try{child=spawn(exe,args,{cwd,env:{...process.env,...env},windowsHide:true})}catch(e){return resolve({code:-1,output:e.message})}
 const finish=r=>{if(!done){done=true;clearTimeout(timer);resolve(r)}};const timer=setTimeout(()=>{killTree(child);finish({code:-1,output:(output+'\nStopped after '+timeout/1000+' seconds.').slice(-2000)})},timeout);
 const take=d=>{output=(output+d).slice(-4000)};child.stdout.on('data',take);child.stderr.on('data',take);child.on('error',e=>finish({code:-1,output:e.message}));child.on('close',code=>finish({code,output:output.trim().slice(-2000)}))})}

export function validateSchedules(list,projectIds){if(!Array.isArray(list)||list.length>20)throw Error('Add up to 20 schedules.');
 return list.map(s=>{const name=String(s.name||'').trim().slice(0,60);if(!name)throw Error('Name each schedule.');if(!projectIds.includes(s.projectId))throw Error('Choose a project for '+name+'.');
  const prompt=String(s.prompt||'').trim();if(!prompt||prompt.length>20000)throw Error('Write the prompt for '+name+'.');if(!EVERY.includes(s.every))throw Error('Choose how often '+name+' runs.');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time||''))throw Error('Use a time like 09:00 for '+name+'.');if(!['codex','claude','gemini'].includes(s.provider))throw Error('Choose Claude, GPT or Gemini for '+name+'.');
  return {id:/^[\w-]{1,40}$/.test(s.id||'')?s.id:randomUUID(),name,projectId:s.projectId,prompt,every:s.every,time:s.time,day:Math.max(0,Math.min(6,Number(s.day)||1)),provider:s.provider,model:String(s.model||'').slice(0,80),effort:String(s.effort||'').slice(0,20),mode:s.mode==='auto'?'auto':'plan',enabled:s.enabled!==false}})}

// The next run strictly after `from` (local time). Hourly runs at the minute of `time`.
export function nextRun(s,from=Date.now()){const [h,m]=s.time.split(':').map(Number);const d=new Date(from);d.setSeconds(0,0);
 if(s.every==='hour'){d.setMinutes(m);if(d.getTime()<=from)d.setHours(d.getHours()+1);return d.getTime()}
 d.setHours(h,m,0,0);if(d.getTime()<=from)d.setDate(d.getDate()+1);
 for(let i=0;i<8;i++){const wd=d.getDay();if(s.every==='day'||(s.every==='weekday'&&wd>0&&wd<6)||(s.every==='week'&&wd===s.day))return d.getTime();d.setDate(d.getDate()+1)}
 return d.getTime()}

// Checks every 30 seconds; a run that was due while the app was closed runs once at the next start.
export class Scheduler{
 constructor({readSettings,readState,writeState,start,log=()=>{}}){Object.assign(this,{readSettings,readState,writeState,start,log});this.timer=null}
 begin(){this.timer=setInterval(()=>this.tick().catch(e=>this.log(e.message)),30000);this.timer.unref?.();setTimeout(()=>this.tick().catch(()=>{}),5000).unref?.()}
 async tick(now=Date.now()){const {schedules=[]}=await this.readSettings();const state=await this.readState();let changed=false;
  for(const s of schedules){if(!s.enabled)continue;const st=state[s.id]??={};if(!st.since){st.since=now;changed=true;continue}
   if(nextRun(s,st.lastRun||st.since)<=now){st.lastRun=now;changed=true;try{st.chatId=await this.start(s);st.error=null}catch(e){st.error=e.message}}}
  if(changed)await this.writeState(state);return state}
}
