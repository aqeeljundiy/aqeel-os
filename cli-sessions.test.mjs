import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {claudeMessages,codexMessages,claudeFolder,listSessions} from './cli-sessions.mjs';

test('Claude transcripts keep user and assistant text only',()=>{
 const r=claudeMessages([
  {type:'user',message:{role:'user',content:'User request: Fix the header'},timestamp:'2026-10-14T01:00:00Z'},
  {type:'user',isMeta:true,message:{role:'user',content:'Caveat: The messages below were generated'}},
  {type:'assistant',message:{id:'a1',content:[{type:'thinking',thinking:'x'},{type:'text',text:'Looking.'}]}},
  {type:'assistant',message:{id:'a1',content:[{type:'tool_use',name:'Read'}]}},
  {type:'user',message:{role:'user',content:[{type:'tool_result',content:'file'}]}},
  {type:'assistant',message:{id:'a1',content:[{type:'text',text:'Fixed it.'}]}},
  {type:'ai-title',aiTitle:'Header fix'}]);
 assert.equal(r.title,'Header fix');
 assert.deepEqual(r.messages.map(m=>[m.role,m.text]),[['user','Fix the header'],['assistant','Looking.\nFixed it.']]);
});

test('Codex transcripts skip injected context',()=>{
 const r=codexMessages([
  {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'<environment_context>\n<cwd>x</cwd></environment_context>'}]}},
  {type:'response_item',payload:{type:'message',role:'developer',content:[{type:'input_text',text:'rules'}]}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Add a footer'}]}},
  {type:'response_item',payload:{type:'reasoning'}},
  {type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'Done.'}]}}]);
 assert.deepEqual(r.messages.map(m=>[m.role,m.text]),[['user','Add a footer'],['assistant','Done.']]);
});

test('sessions are found per folder and excluded when already used',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'cba-cli-'));const cwd=path.join(tmp,'my site');
 try{const cdir=path.join(tmp,'claude','projects',claudeFolder(cwd));await mkdir(cdir,{recursive:true});
  await writeFile(path.join(cdir,'s1.jsonl'),JSON.stringify({type:'user',cwd,message:{role:'user',content:'Hello'}})+'\n');
  const xdir=path.join(tmp,'codex','sessions','2026','10','14');await mkdir(xdir,{recursive:true});
  await writeFile(path.join(xdir,'rollout-a.jsonl'),[{type:'session_meta',payload:{id:'c1',cwd}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Hi GPT'}]}}].map(x=>JSON.stringify(x)).join('\n'));
  await writeFile(path.join(xdir,'rollout-b.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'c2',cwd:path.join(tmp,'other')}}));
  const all=await listSessions(cwd,{claudeHome:path.join(tmp,'claude'),codexHome:path.join(tmp,'codex')});
  assert.deepEqual(all.map(s=>s.provider+':'+s.id).sort(),['claude:s1','codex:c1']);
  const some=await listSessions(cwd,{claudeHome:path.join(tmp,'claude'),codexHome:path.join(tmp,'codex'),exclude:new Set(['s1'])});
  assert.deepEqual(some.map(s=>s.id),['c1']);
 }finally{await rm(tmp,{recursive:true,force:true})}
});
