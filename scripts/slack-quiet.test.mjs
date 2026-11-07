// Quiet Slack channels per workspace (7 Nov 2026): the old one-prefix-for-all setting moves to the single workspace it
// meant (Pixel & Profits on the owner's box), other workspaces answer normally, a list is cleaned when a prefix goes, and
// a Slack outage at the move changes nothing. No network.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createSlackQuiet,migrate,plan,cleanPrefix} from '../app/slack-quiet.mjs';
const dir=async()=>mkdtemp(path.join(tmpdir(),'sq-'));
const PNP={id:'T0PIXEL01',name:'Pixel & Profits'},AS={id:'T0ADMSGHT',name:'AdmissionSight'},PS={id:'T0POLYSP1',name:'Polyspeech'};

test('the old global ext- moves to the one workspace there is; the old file is backed up',async()=>{
 const D=await dir();await writeFile(path.join(D,'slack-quiet.json'),JSON.stringify({prefix:'ext-'}));
 const q=createSlackQuiet({DATA:D,teamsNow:async()=>[PNP,PNP],log:()=>{}});
 assert.equal(await q.prefixOf(PNP.id),'ext-');assert.equal(await q.prefixOf(AS.id),'','other workspaces answer normally');
 const j=JSON.parse(await readFile(path.join(D,'slack-quiet.json'),'utf8'));assert.equal(j.v,2);assert.deepEqual(j.teams,{[PNP.id]:{prefix:'ext-',name:'Pixel & Profits'}});
 assert.ok((await readdir(D)).some(f=>f.startsWith('slack-quiet.json.bak-')));
 // a later start reads the new file as it is
 const again=createSlackQuiet({DATA:D,teamsNow:async()=>{throw Error('not asked')}});assert.equal(await again.prefixOf(PNP.id),'ext-')});

test('several workspaces and one old prefix: none keeps it (nobody can say which meant it)',()=>{
 const logs=[];const m=migrate({prefix:'ext-'},[PNP,AS,PS],x=>logs.push(x));assert.deepEqual(m.teams,{});assert.equal(m.was,'ext-');assert.match(logs[0],/3 workspaces/)});

test('an install that kept ext- quiet before (no file, marked agents) counts as ext-; a new install has none',async()=>{
 const D=await dir();const q=createSlackQuiet({DATA:D,teamsNow:async()=>[PNP],legacy:async()=>'ext-',log:()=>{}});assert.equal(await q.prefixOf(PNP.id),'ext-');
 const D2=await dir();const fresh=createSlackQuiet({DATA:D2,teamsNow:async()=>[PNP],legacy:async()=>'',log:()=>{}});assert.equal(await fresh.prefixOf(PNP.id),'');assert.deepEqual(await fresh.get(),{})});

test('Slack not answering at the move: nothing is moved or changed, and it is tried again',async()=>{
 const D=await dir();await writeFile(path.join(D,'slack-quiet.json'),JSON.stringify({prefix:'ext-'}));let up=false;
 const q=createSlackQuiet({DATA:D,teamsNow:async()=>up?[PNP]:[],log:()=>{}});
 assert.equal((await q.load()).pending,true);await assert.rejects(q.set(PNP.id,'x-'),/not answering/);
 assert.deepEqual(JSON.parse(await readFile(path.join(D,'slack-quiet.json'),'utf8')),{prefix:'ext-'},'the old file is untouched');
 up=true;assert.equal(await q.prefixOf(PNP.id),'ext-');assert.equal((await readdir(D)).filter(f=>f.startsWith('slack-quiet.json.bak-')).length,1)});

test('set per workspace: cleaned prefix, unknown workspace refused',async()=>{
 const D=await dir();const q=createSlackQuiet({DATA:D,teamsNow:async()=>[],log:()=>{}});
 assert.deepEqual(await q.set(AS.id,' Client- ','AdmissionSight'),{prefix:'client-',name:'AdmissionSight'});assert.equal(await q.prefixOf(PNP.id),'');
 await assert.rejects(q.set('../etc','x'),/Unknown Slack workspace/);assert.equal(cleanPrefix('ext-<b>'),'ext-b')});

test('the quiet list: adds new matching channels, takes off ones the old prefix put there, keeps the rest',()=>{
 const channels=[{id:'C1',name:'ext-acme'},{id:'C2',name:'general'},{id:'C3',name:'ext-new'},{id:'C4',name:'client-x'}];
 // same prefix: a channel made later is added
 assert.deepEqual(plan({have:new Set(['C1']),channels,pre:'ext-',oldPre:'ext-'}),{add:['C3'],remove:[],next:['C1','C3']});
 // the prefix cleared for this workspace: the ext- channels answer again; one added by hand (C9, not in the list) stays
 assert.deepEqual(plan({have:new Set(['C1','C3','C9']),channels,pre:'',oldPre:'ext-'}),{add:[],remove:['C1','C3'],next:['C9']});
 // changed to client-
 assert.deepEqual(plan({have:new Set(['C1']),channels,pre:'client-',oldPre:'ext-'}),{add:['C4'],remove:['C1'],next:['C4']})});
