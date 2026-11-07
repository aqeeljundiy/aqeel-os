// node scripts/instructions.test.mjs: history, outside edits, change_instructions (small applies, big waits), approval, undo, override flags
import {createInstructions,lineDiff} from '../app/instructions.mjs';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const T=await mkdtemp(path.join(tmpdir(),'instr-'));const H=path.join(T,'hermes'),P=path.join(H,'profiles','bot');await mkdir(path.join(P,'memories'),{recursive:true});
await writeFile(path.join(P,'SOUL.md.bak-1'),'old one\n');await new Promise(r=>setTimeout(r,20));
await writeFile(path.join(P,'SOUL.md'),'# Rules\n- comments: 70 a day\n- max 5 an hour\n## Caution (overrides every earlier rule)\n- 20 a day\n## Push (overrides earlier volume caps)\n- 40 a day\n');
// a stand-in for the engine's dashboard: PUT /api/profiles/<a>/soul writes the file
const srv=createServer((q,s)=>{let b='';q.on('data',d=>b+=d);q.on('end',async()=>{const m=/^\/api\/profiles\/([^/]+)\/soul$/.exec(q.url);if(q.method==='PUT'&&m){await writeFile(path.join(H,'profiles',m[1],'SOUL.md'),JSON.parse(b).content);s.end('{}')}else{s.statusCode=404;s.end()}})}).listen(0);
const DASH='http://127.0.0.1:'+srv.address().port;
const I=createInstructions({DATA:path.join(T,'data'),HERMES_HOME:H,DASH,DASH_TOKEN:'x',python:async()=>null,root:process.cwd()});
const soul=()=>readFile(path.join(P,'SOUL.md'),'utf8');

let h=await I.history('bot');assert.equal(h.versions.length,2,'backup + current');assert.equal(h.versions[1].kind,'import');
await writeFile(path.join(P,'SOUL.md'),(await soul())+'- extra line\n');h=await I.history('bot');assert.equal(h.versions[0].kind,'box','an outside edit is a version');
let r=await I.change('bot',{edits:[{old_text:'max 5 an hour',new_text:'max 3 an hour'}],why:'3 an hour',said_by:'Abel'},{by:'bot'});assert.match(r.text,/Saved as version 4/);assert.match(await soul(),/max 3 an hour/);
r=await I.change('bot',{edits:[{old_text:'nope',new_text:'x'}],why:'x'},{by:'bot'});assert.ok(r.isError);
r=await I.change('bot',{edits:[{old_text:'- extra line',new_text:'## New (overrides earlier rules)'}],why:'x'},{by:'bot'});assert.ok(r.isError,'no override sections');
// 7 Nov 2026: a big edit and a rewrite apply at once too; nobody approves an agent's own change
{const big='x'.repeat(2000);r=await I.change('bot',{edits:[{old_text:'max 3 an hour',new_text:'max 3 an hour\n- note: '+big}],why:'long note'},{by:'bot'});assert.match(r.text,/Saved as version/);assert.doesNotMatch(r.text,/waits|owner's approval/i);assert.match(await soul(),/note: x{2000}/)}
r=await I.change('bot',{rewrite:'# Rules\n- comments: 70 a day\n- max 3 an hour\n',why:'clean up',said_by:'Abel'},{by:'bot'});assert.match(r.text,/Saved as version 6/);assert.equal(await soul(),'# Rules\n- comments: 70 a day\n- max 3 an hour\n');
assert.equal((await I.history('bot')).proposals.length,0,'no proposal for the owner');
await I.propose('bot',{content:'# Rules\n- comments: 70 a day\n- max 5 an hour\n',why:'owner edit in the app',by:'Abel'});
h=await I.history('bot');assert.equal(h.proposals.length,1);const p=await I.proposal('bot',h.proposals[0].id);assert.ok(p.diff.some(d=>d[0]==='-'));
await I.decide('bot',p.id,true,'Abel');assert.equal(await soul(),'# Rules\n- comments: 70 a day\n- max 5 an hour\n');
h=await I.history('bot');assert.equal(h.versions[0].kind,'approved');assert.equal(h.versions[0].approvedBy,'Abel');assert.equal(h.proposals.length,0);
await I.restore('bot',4,'Abel');assert.match(await soul(),/max 3 an hour/,'undo brings a version back');
// flags: override sections are found without the model
await I.write('bot','# A\n## X (overrides every earlier rule)\n## Y — overrides earlier caps\n',{kind:'edit',by:'t'});await I.check('bot',{force:true});h=await I.history('bot');
assert.ok(h.flags.some(f=>f.kind==='override'));
// flags: a separate decisions file is a second place for rules
await I.write('bot','# A\n- Decisions: /x/DECISIONS.md (read every run)\n',{kind:'edit',by:'t'});await I.check('bot',{force:true});h=await I.history('bot');
assert.ok(h.flags.some(f=>f.kind==='decisions-file'&&f.quotes[0].quote.includes('DECISIONS.md')));
assert.deepEqual(lineDiff('a\nb\nc','a\nc\nd').map(x=>x[0]).join(''),' - +');
srv.close();console.log('instructions: all good');
