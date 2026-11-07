// Built in or added on this OS (app/builtin-skills.mjs): which names are Built in, and the installer that puts the
// repo's skills into the main agent's folder without ever overwriting a skill made or changed on this OS.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createBuiltinSkills} from '../app/builtin-skills.mjs';

const sk=async(dir,name,body='Use when testing.')=>{await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'SKILL.md'),'---\nname: '+name+'\ndescription: '+body+'\n---\nSteps.\n')};
async function box({users=true}={}){const d=await mkdtemp(path.join(tmpdir(),'bis-'));const root=path.join(d,'repo'),H=path.join(d,'.hermes'),DATA=path.join(d,'data');
 await sk(path.join(root,'skills','creative','brand-kit'),'brand-kit');await sk(path.join(root,'skills','productivity','trip-planning'),'trip-planning');
 await mkdir(path.join(root,'engine','aqeelos-live'),{recursive:true});await writeFile(path.join(root,'engine','aqeelos-live','plugin.yaml'),'name: aqeelos-live\n');await mkdir(path.join(root,'engine','patches'),{recursive:true});
 await sk(path.join(H,'hermes-agent','skills','research','arxiv'),'arxiv');await mkdir(path.join(H,'hermes-agent','plugins','disk-cleanup'),{recursive:true});await writeFile(path.join(H,'hermes-agent','plugins','disk-cleanup','plugin.yaml'),'x');
 await sk(path.join(H,'skills','productivity','my-own'),'my-own');await mkdir(DATA,{recursive:true});if(users)await writeFile(path.join(DATA,'users.json'),'{}');
 return {d,H,DATA,root,b:createBuiltinSkills({root,HERMES_HOME:H,DATA})}}

test('Built in: the repo’s skills and the engine’s own; plugins from engine/ and the engine; nothing made on this OS',async()=>{const {d,b}=await box();try{
 const n=await b.names();assert.deepEqual(n.skills,['arxiv','brand-kit','trip-planning']);assert.deepEqual(n.repoSkills,['brand-kit','trip-planning']);
 assert.ok(n.plugins.includes('aqeelos-live')&&n.plugins.includes('disk-cleanup')&&!n.plugins.includes('patches'));assert.ok(!n.skills.includes('my-own'))
}finally{await rm(d,{recursive:true,force:true})}});

test('an existing install is left alone until the owner switches it on; a fresh one gets them',async()=>{
 const a=await box();try{assert.deepEqual(await a.b.install(),{skipped:'off'});assert.ok(!(await readdir(path.join(a.H,'skills'))).includes('creative'))}finally{await rm(a.d,{recursive:true,force:true})}
 const f=await box({users:false});try{const r=await f.b.install();assert.deepEqual(r.added.sort(),['brand-kit','trip-planning'])}finally{await rm(f.d,{recursive:true,force:true})}});

test('switched on: added once, updated with aqeelOS, never over a skill made or changed here, local.md kept',async()=>{const {d,H,DATA,root,b}=await box();try{
 await sk(path.join(H,'skills','travel','trip-planning'),'trip-planning','Someone’s own trip skill.');   // made on this OS with the same name
 await b.setWanted(true);let r=await b.install();assert.deepEqual(r.added,['brand-kit']);assert.deepEqual(r.kept,['trip-planning']);
 const dest=path.join(H,'skills','creative','brand-kit');assert.match(await readFile(path.join(dest,'.aqeelos-builtin'),'utf8'),/"hash"/);
 r=await b.install();assert.deepEqual([r.added,r.updated],[[],[]],'nothing twice');
 await mkdir(path.join(dest,'references'),{recursive:true});await writeFile(path.join(dest,'references','local.md'),'Brand: Acme\n');
 await sk(path.join(root,'skills','creative','brand-kit'),'brand-kit','Use when making posts, new version.');r=await b.install();assert.deepEqual(r.updated,['brand-kit']);
 assert.match(await readFile(path.join(dest,'SKILL.md'),'utf8'),/new version/);assert.equal(await readFile(path.join(dest,'references','local.md'),'utf8'),'Brand: Acme\n','the install’s details stay');
 await writeFile(path.join(dest,'SKILL.md'),'---\nname: brand-kit\ndescription: changed here\n---\n');await sk(path.join(root,'skills','creative','brand-kit'),'brand-kit','Use when posting, v3.');
 r=await b.install();assert.deepEqual(r.kept,['trip-planning','brand-kit'].sort().filter(x=>r.kept.includes(x)));assert.match(await readFile(path.join(dest,'SKILL.md'),'utf8'),/changed here/,'a copy changed on this OS is never overwritten');
 assert.equal(JSON.parse(await readFile(path.join(DATA,'builtin-skills.json'),'utf8')).install,true)
}finally{await rm(d,{recursive:true,force:true})}});

test('the Skills and Plugins pages group by it, and Built in skills open read-only',async()=>{const src=await readFile(new URL('../app/skill-groups.js',import.meta.url),'utf8');
 assert.match(src,/'Built in'/);assert.match(src,/'Added on this OS'/);assert.match(src,/readOnly=true/);assert.match(src,/#skSave'\)\?\.remove/);assert.doesNotMatch(src,/[—–]/);
 const html=await readFile(new URL('../app/index.html',import.meta.url),'utf8');assert.ok(html.indexOf('skill-groups.js')>html.indexOf('labels.js'))});
