import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {frontmatter,loadPrompts,validatePrompts,loadSkills,skillsInstructions,validateHooks,runHook,validateSchedules,nextRun,Scheduler} from './extensions.mjs';

const at=(y,mo,d,h,mi)=>new Date(y,mo-1,d,h,mi).getTime();

test('frontmatter splits metadata from the body',()=>{
 assert.deepEqual(frontmatter('---\nname: deploy\ndescription: "Ship it"\n---\nBody'),{meta:{name:'deploy',description:'Ship it'},body:'Body'});
 assert.deepEqual(frontmatter('No header'),{meta:{},body:'No header'});
});

test('nextRun handles hourly, daily, weekday and weekly schedules',()=>{
 const wed9=at(2026,10,14,9,0); // Wednesday
 assert.equal(nextRun({every:'hour',time:'00:15'},wed9),at(2026,10,14,9,15));
 assert.equal(nextRun({every:'day',time:'09:00'},wed9),at(2026,10,15,9,0));
 assert.equal(nextRun({every:'day',time:'18:30'},wed9),at(2026,10,14,18,30));
 const fri20=at(2026,10,16,20,0);
 assert.equal(nextRun({every:'weekday',time:'08:00'},fri20),at(2026,10,19,8,0));
 assert.equal(nextRun({every:'week',time:'10:00',day:1},wed9),at(2026,10,19,10,0));
});

test('validation rejects bad prompts, hooks and schedules',()=>{
 assert.throws(()=>validatePrompts([{name:'Bad Name',text:'x'}]),/lowercase/);
 assert.throws(()=>validatePrompts([{name:'a',text:'x'},{name:'a',text:'y'}]),/Two prompts/);
 assert.equal(validatePrompts([{name:'fix-tests',text:' Run tests '}])[0].text,'Run tests');
 assert.throws(()=>validateHooks([{event:'nope',command:'x'}]),/Unknown hook/);
 const s=validateSchedules([{name:'Daily check',projectId:'p1',prompt:'Check',every:'day',time:'09:00',provider:'claude',mode:'bypass'}],['p1']);
 assert.equal(s[0].mode,'plan');
 assert.throws(()=>validateSchedules([{name:'x',projectId:'p2',prompt:'y',every:'day',time:'09:00',provider:'claude'}],['p1']),/Choose a project/);
 assert.throws(()=>validateSchedules([{name:'x',projectId:'p1',prompt:'y',every:'day',time:'9am',provider:'claude'}],['p1']),/time like/);
});

test('prompts and skills load from project and home folders',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'cba-ext-'));const cwd=path.join(tmp,'proj'),home=path.join(tmp,'home');
 try{await mkdir(path.join(cwd,'.claude','commands'),{recursive:true});await writeFile(path.join(cwd,'.claude','commands','Ship-It.md'),'---\ndescription: Deploy\n---\nDeploy the site');
  await mkdir(path.join(home,'.claude','skills','pdf'),{recursive:true});await writeFile(path.join(home,'.claude','skills','pdf','SKILL.md'),'---\nname: pdf\ndescription: Work with PDFs\n---\nSteps');
  const prompts=await loadPrompts(cwd,{prompts:[{name:'saved',text:'Saved text'}]},home);
  assert.deepEqual(prompts.map(p=>[p.name,p.source,p.text]),[['saved','Saved','Saved text'],['ship-it','Project','Deploy the site']]);
  const skills=await loadSkills(cwd,{disabledSkills:[]},home);assert.equal(skills[0].name,'pdf');assert.match(skillsInstructions(skills),/pdf: Work with PDFs/);
  assert.equal(skillsInstructions(await loadSkills(cwd,{disabledSkills:['pdf']},home)),'');
 }finally{await rm(tmp,{recursive:true,force:true})}
});

test('hooks run in the project folder with event variables',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'cba-hook-'));
 try{const ok=await runHook({command:'node -e "console.log(process.env.CBA_EVENT)"'},{cwd:tmp,env:{CBA_EVENT:'run-finished'}});assert.equal(ok.code,0);assert.match(ok.output,/run-finished/);
  const bad=await runHook({command:'node -e "process.exit(3)"'},{cwd:tmp});assert.equal(bad.code,3);
 }finally{await rm(tmp,{recursive:true,force:true})}
});

test('scheduler starts due runs once and remembers them',async()=>{
 let state={},started=[];const s={id:'s1',enabled:true,every:'day',time:'09:00'};
 const sch=new Scheduler({readSettings:async()=>({schedules:[s]}),readState:async()=>state,writeState:async st=>{state=JSON.parse(JSON.stringify(st))},start:async x=>{started.push(x.id);return 'chat-1'}});
 await sch.tick(at(2026,10,14,8,0));assert.equal(started.length,0); // first sight only records `since`
 await sch.tick(at(2026,10,14,8,59));assert.equal(started.length,0);
 await sch.tick(at(2026,10,14,9,0));assert.deepEqual(started,['s1']);assert.equal(state.s1.chatId,'chat-1');
 await sch.tick(at(2026,10,14,12,0));assert.equal(started.length,1);
});
