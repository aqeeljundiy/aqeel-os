// Skill access (accounts.mjs skillShare): the builder keeps it, added agents get a copy, removed ones lose it, "every
// agent" reaches the main agent, and a preview changes nothing. Temp homes only.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,access,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const HOME=await mkdtemp(path.join(tmpdir(),'skshare-'));process.env.HOME=HOME;const HH=path.join(HOME,'.hermes');process.env.HERMES_HOME=HH;
const DATA=path.join(HOME,'data');process.env.UI_DATA_DIR=DATA;process.env.AQEELOS_SKILLS_POLICY=path.join(DATA,'skills-policy.json');
for(const a of ['lead-a','writer','other'])await mkdir(path.join(HH,'profiles',a,'skills'),{recursive:true}).then(()=>writeFile(path.join(HH,'profiles',a,'config.yaml'),'model: {}\n'));
await mkdir(path.join(HH,'skills'),{recursive:true});await writeFile(path.join(HH,'config.yaml'),'model: {}\n');
const sk=path.join(HH,'profiles','lead-a','skills','marketing','play');await mkdir(path.join(sk,'refs'),{recursive:true});await writeFile(path.join(sk,'SKILL.md'),'---\nname: play\n---\n');await writeFile(path.join(sk,'refs','a.md'),'x');
const {createAccounts,accountHooks}=await import('../app/accounts.mjs');createAccounts(DATA);
const has=a=>access(path.join(a==='default'?HH:path.join(HH,'profiles',a),'skills','marketing','play','SKILL.md')).then(()=>true,()=>false);
test('a preview names the builder and changes nothing',async()=>{const r=await accountHooks.skillShare({key:'play',agents:['writer'],dry:true});assert.equal(r.owner,'lead-a');assert.deepEqual(r.gain,['writer']);assert.deepEqual(r.lose,[]);assert.equal(await has('writer'),false)});
test('only some agents: the builder keeps it even when left off, the picked agent gets a full copy',async()=>{const r=await accountHooks.skillShare({key:'play',agents:['writer']});assert.deepEqual(r.gain,['writer']);assert.equal(await has('lead-a'),true);assert.equal(await has('writer'),true);
 await access(path.join(HH,'profiles','writer','skills','marketing','play','refs','a.md'));const pol=JSON.parse(await readFile(process.env.AQEELOS_SKILLS_POLICY,'utf8'));assert.deepEqual(pol.restricted['marketing/play'],['default','lead-a','writer']);assert.equal(pol.owners['marketing/play'],'lead-a')});
test('removing an agent takes its copy away, never the builder',async()=>{const r=await accountHooks.skillShare({key:'play',agents:[]});assert.deepEqual(r.lose,['writer']);assert.equal(await has('writer'),false);assert.equal(await has('lead-a'),true)});
test('every agent: the main agent gets it so it spreads, and the rule is gone',async()=>{const r=await accountHooks.skillShare({key:'play',agents:null});assert.ok(r.gain.includes('default'));assert.equal(await has('default'),true);assert.equal(await has('other'),true);const pol=JSON.parse(await readFile(process.env.AQEELOS_SKILLS_POLICY,'utf8'));assert.equal(pol.restricted['marketing/play'],undefined)});
test('a skill nobody has is refused with a reason',async()=>{await assert.rejects(accountHooks.skillShare({key:'nothing-here',agents:[]}),/No agent has this skill/)});
