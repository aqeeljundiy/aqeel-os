// Earlier Claude Code and Codex CLI sessions for a folder, so they can be opened as chats and resumed natively.
// Claude: <home>/projects/<folder with non-alphanumerics as "-">/<session>.jsonl
// Codex:  <home>/sessions/YYYY/MM/DD/rollout-*.jsonl whose session_meta names the folder
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';

const MAX_FILE=40*1024*1024;
const same=(a,b)=>path.resolve(String(a||'')).toLowerCase()===path.resolve(String(b||'')).toLowerCase();
const jsonLines=text=>text.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
// text the CLIs add around the user's own words
const injected=t=>/^\s*<(environment_context|user_instructions|permissions instructions|turn_aborted|user_shell_command)/.test(t)||/^# AGENTS\.md instructions/.test(t)||/^Caveat: The messages below/.test(t)||/^<command-(name|message|args)>|^<local-command-stdout>/.test(t);

export const claudeFolder=cwd=>path.resolve(cwd).replace(/[^a-zA-Z0-9]/g,'-');

export function claudeMessages(lines){const out=[];let title='';
 for(const l of lines){if(l.type==='ai-title'||l.type==='custom-title')title=l.customTitle||l.aiTitle||title;else if(l.type==='summary'&&l.summary)title=title||l.summary;
  if(l.isSidechain||l.isMeta||!l.message)continue;const time=Date.parse(l.timestamp)||0;
  if(l.type==='user'){const c=l.message.content;const text=typeof c==='string'?c:Array.isArray(c)?c.filter(b=>b.type==='text').map(b=>b.text).join('\n'):'';if(text.trim()&&!injected(text))out.push({role:'user',text:text.replace(/^User request: /,'').trim(),time})}
  else if(l.type==='assistant'){const text=(l.message.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();if(!text)continue;const prev=out.at(-1);if(prev?.role==='assistant'&&prev.id===l.message.id)prev.text+='\n'+text;else out.push({role:'assistant',text,time,id:l.message.id})}}
 return {title,messages:out.map(({id,...m})=>m)}}

export function codexMessages(lines){const out=[];
 for(const l of lines){if(l.type!=='response_item'||l.payload?.type!=='message')continue;const time=Date.parse(l.timestamp)||0;const text=(l.payload.content||[]).filter(b=>/text$/.test(b.type)).map(b=>b.text).join('\n').trim();
  if(!text||injected(text))continue;if(l.payload.role==='user')out.push({role:'user',text:text.replace(/^[\s\S]*?User request: /,'').trim(),time});else if(l.payload.role==='assistant')out.push({role:'assistant',text,time})}
 return {title:'',messages:out}}

async function walk(dir,depth=0){let out=[];let entries=[];try{entries=await readdir(dir,{withFileTypes:true})}catch{return out}
 for(const e of entries){const p=path.join(dir,e.name);if(e.isDirectory()&&depth<4)out=out.concat(await walk(p,depth+1));else if(e.isFile()&&e.name.endsWith('.jsonl'))out.push(p)}return out}

async function read(file){const s=await stat(file);if(s.size>MAX_FILE)return null;return {lines:jsonLines(await readFile(file,'utf8')),mtime:s.mtimeMs}}

export async function listSessions(cwd,{claudeHome,codexHome,exclude=new Set()}){const found=[];
 if(claudeHome){const dir=path.join(claudeHome,'projects');let names=[];try{names=await readdir(dir)}catch{}
  for(const n of names.filter(n=>n.toLowerCase()===claudeFolder(cwd).toLowerCase()))for(const f of (await readdir(path.join(dir,n)).catch(()=>[])).filter(f=>f.endsWith('.jsonl'))){
   const id=f.slice(0,-6);if(exclude.has(id))continue;const r=await read(path.join(dir,n,f)).catch(()=>null);if(!r)continue;if(!r.lines.some(l=>l.cwd&&same(l.cwd,cwd)))continue;const {title,messages}=claudeMessages(r.lines);if(!messages.some(m=>m.role==='user'))continue;
   found.push({provider:'claude',id,file:path.join(dir,n,f),title:title||messages.find(m=>m.role==='user').text.slice(0,60),time:r.mtime,count:messages.length})}}
 if(codexHome)for(const file of await walk(path.join(codexHome,'sessions'))){const r=await read(file).catch(()=>null);if(!r)continue;const meta=r.lines.find(l=>l.type==='session_meta')?.payload;if(!meta||!same(meta.cwd,cwd))continue;const id=meta.id||meta.session_id;if(!id||exclude.has(id))continue;
  const {messages}=codexMessages(r.lines);if(!messages.some(m=>m.role==='user'))continue;found.push({provider:'codex',id,file,title:messages.find(m=>m.role==='user').text.slice(0,60),time:r.mtime,count:messages.length})}
 return found.sort((a,b)=>b.time-a.time).slice(0,50)}

export async function readSession(s){const r=await read(s.file);if(!r)throw Error('That session is too large to import.');return (s.provider==='claude'?claudeMessages:codexMessages)(r.lines)}
