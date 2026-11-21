// The terminal's ~/workspaces is the real workspaces folder (app/tools-workspaces.mjs, 21 Nov 2026: Donna's PDF was made under the
// tools' home and the attachment was skipped as "not found").
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,readlink,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {linkToolsWorkspaces,linkAll,MAX_FILES} from '../app/tools-workspaces.mjs';

const box=async()=>{const t=await mkdtemp(path.join(tmpdir(),'tw-'));const work=path.join(t,'workspaces'),home=path.join(t,'.hermes','home');await mkdir(work,{recursive:true});await mkdir(home,{recursive:true});return {t,work,home}};

test('no folder yet: a link is made, and a file written through it lands in the real workspace',async()=>{const {work,home}=await box();
 assert.equal((await linkToolsWorkspaces(home,work)).state,'made');
 await mkdir(path.join(home,'workspaces','default','reports'),{recursive:true});await writeFile(path.join(home,'workspaces','default','reports','r.pdf'),'%PDF');
 assert.equal(await readFile(path.join(work,'default','reports','r.pdf'),'utf8'),'%PDF','the path the agent names is the file it made')});

test('an existing folder is merged: new files move, identical ones go, then it becomes the link',async()=>{const {work,home}=await box();
 await mkdir(path.join(home,'workspaces','default','reports'),{recursive:true});await mkdir(path.join(work,'default'),{recursive:true});
 await writeFile(path.join(home,'workspaces','default','reports','r.pdf'),'%PDF');await writeFile(path.join(home,'workspaces','default','AGENTS.md'),'same');await writeFile(path.join(work,'default','AGENTS.md'),'same');
 const r=await linkToolsWorkspaces(home,work);assert.equal(r.state,'merged');assert.equal(r.moved,1);assert.equal(r.dropped,1);
 assert.ok((await lstat(path.join(home,'workspaces'))).isSymbolicLink());assert.equal(await realpath(path.join(home,'workspaces')),await realpath(work));
 assert.equal(await readFile(path.join(work,'default','reports','r.pdf'),'utf8'),'%PDF')});

test('a file that differs from the real one never replaces it: it is kept aside, and the link is made',async()=>{const {work,home}=await box();const logs=[];
 await mkdir(path.join(home,'workspaces','default'),{recursive:true});await mkdir(path.join(work,'default'),{recursive:true});
 await writeFile(path.join(home,'workspaces','default','AGENTS.md'),'old copy');await writeFile(path.join(work,'default','AGENTS.md'),'real');
 const t=path.dirname(path.dirname(home));const all=await linkAll({HERMES_HOME:path.join(t,'.hermes'),WORK:work,log:m=>logs.push(m)});
 const r=all[home];assert.equal(r.state,'merged');assert.deepEqual(r.kept,[path.join('default','AGENTS.md')]);
 assert.equal(await readFile(path.join(work,'default','AGENTS.md'),'utf8'),'real','the real file is untouched');
 assert.equal(await readFile(path.join(r.aside,'default','AGENTS.md'),'utf8'),'old copy','the old copy is kept, not lost');
 assert.ok((await lstat(path.join(home,'workspaces'))).isSymbolicLink());assert.match(logs.join('\n'),/1 differing kept in/)});

test('a second leftover with the same name the same day is never written over: the folder stays',async()=>{const {work,home}=await box();const now=new Date('2026-11-21T01:00:00Z');
 await mkdir(path.join(home,'workspaces','d'),{recursive:true});await mkdir(path.join(work,'d'),{recursive:true});
 await writeFile(path.join(home,'workspaces','d','a.md'),'shadow');await writeFile(path.join(work,'d','a.md'),'real');
 await mkdir(path.join(home,'workspaces-leftovers-2026-11-21','d'),{recursive:true});await writeFile(path.join(home,'workspaces-leftovers-2026-11-21','d','a.md'),'earlier');
 const r=await linkToolsWorkspaces(home,work,{now});assert.equal(r.state,'conflict');
 assert.equal(await readFile(path.join(home,'workspaces','d','a.md'),'utf8'),'shadow');assert.equal(await readFile(path.join(home,'workspaces-leftovers-2026-11-21','d','a.md'),'utf8'),'earlier')});

test('a big folder is only reported; a link someone pointed elsewhere is left alone; a second run changes nothing',async()=>{const {work,home}=await box();
 for(let i=0;i<=MAX_FILES;i++){if(i%100===0)await mkdir(path.join(home,'workspaces','x',String(i/100)),{recursive:true});await writeFile(path.join(home,'workspaces','x',String(Math.floor(i/100)),i+'.txt'),'')}
 assert.equal((await linkToolsWorkspaces(home,work)).state,'too-big');
 const b=await box();const {symlink}=await import('node:fs/promises');await symlink(b.t,path.join(b.home,'workspaces'));
 assert.equal((await linkToolsWorkspaces(b.home,b.work)).state,'other');assert.equal(await readlink(path.join(b.home,'workspaces')),b.t);
 const c=await box();await linkToolsWorkspaces(c.home,c.work);assert.equal((await linkToolsWorkspaces(c.home,c.work)).state,'linked')});
