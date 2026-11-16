// 16 Nov 2026, the owner: "why are the models still not according to our setup". Two causes, both tested here.
// 1) Only the main agent had the Antigravity sign-in (Gemini); every other agent had only Claude's, so when Claude was out they fell to
//    GPT, past Gemini in the owner's order. Every agent now gets every model sign-in the main agent uses, at setup and in the 5-minute sync.
// 2) Claude replies failed for a few minutes while the box's own connection was failing, the outage switch moved nine agents to GPT for
//    half an hour. It now asks the provider again, and the next provider, before it moves anyone.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {outageCheck} from '../app/backup-models.mjs';import {providerPlugins} from '../app/code-agent.mjs';
const src=f=>readFile(new URL('../app/'+f,import.meta.url),'utf8');

test('before a move: an answer now is a blip, both failing is the box, only "this fails, the next answers" is an outage',()=>{
 assert.equal(outageCheck({answers:true,other:undefined}),'blip');assert.equal(outageCheck({answers:true,other:false}),'blip');
 assert.equal(outageCheck({answers:false,other:false}),'box');
 assert.equal(outageCheck({answers:false,other:true}),'start');
 assert.equal(outageCheck({answers:false,other:undefined}),'start','no other provider to ask: it counts as an outage, as before')});
test('the minute loop looks before it moves, and waits 5 minutes after a "not an outage"',async()=>{const s=await src('backup-models.mjs');
 assert.match(s,/if\(v==='start'&&now<\(p\.checkAgain\|\|0\)\)continue;if\(v==='start'\)\{const c=await confirmOutage\(slug,now\);if\(c==='start'\)await start\(slug,now\);continue\}/);
 assert.match(s,/p\.checkAgain=now\+R\.probeEvery/);assert.match(s,/find\(e=>e\.provider!==slug\)/,'the second question goes to another provider')});
test('which sign-ins are given: the main agent\'s plugins whose manifest says kind: model-provider',()=>{
 const man={'claude-subscription-directsdk-experimental':'name: c\nkind: model-provider\n','antigravity-subscription':'kind: model-provider\n','aqeelos-live':'name: aqeelos-live\n'};
 assert.deepEqual(providerPlugins(['antigravity-subscription','aqeelos-live','claude-subscription-directsdk-experimental'],n=>man[n]),['antigravity-subscription','claude-subscription-directsdk-experimental'])});
test('every agent gets them: at setup (no longer only Claude\'s) and in the fallback sync, which then asks for one restart',async()=>{
 const a=await src('accounts.mjs'),b=await src('backup-models.mjs'),s=await src('server.mjs');
 assert.match(a,/await step\('model sign-ins',\(\)=>signins\(name\)\)/);assert.doesNotMatch(a,/the engine did not keep the Claude plugin enabled/);
 assert.match(a,/for\(const p of providerPlugins\(pick\(main,'plugins\.enabled'\),n=>mans\[n\]\)\)/);assert.match(a,/signins:n=>signins\(n\)/);
 assert.match(b,/const on=await signins\(profile\);if\(on\.length\)turnedOn\.push/);assert.match(b,/await restartLater\('model sign-ins switched on for '/);
 assert.match(s,/signins:n=>accountsApi\.backup\.signins\(n\),restartLater:why=>restartLater\(why\)/)});
