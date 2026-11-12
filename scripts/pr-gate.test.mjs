// Security audit CR-9 (12 Nov 2026): the merge gate. A fixer's pull request merges by itself only when it is small and
// inside the allow-list; a change to what gates it (workflows, tests, deploy and update scripts) waits for the owner.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {decide,DEFAULTS} from './pr-gate.mjs';
const CFG={owner:'own',reviewAllUntil:''},F=(filename,status='modified',additions=5,deletions=1,extra={})=>({filename,status,additions,deletions,...extra});
const fix=(files,o={})=>decide({files,author:'claude[bot]',headRef:'claude/i0123abcd',headSha:'abc',config:CFG,...o});

test('a small fix in the app with a new test merges by itself',()=>{
 const d=fix([F('app/kirimdev.mjs'),F('scripts/kirimdev-fix.test.mjs','added',30,0),F('engine/patches/2026-11-12-x.patch','added')]);assert.equal(d.ok,true);assert.equal(d.kind,'auto')});

test('what gates or ships a change never merges by itself',()=>{
 for(const f of ['.github/workflows/tests.yml','.github/workflows/fixer-gate.yml','.github/fixer-gate.json','.github/CODEOWNERS','scripts/pr-gate.mjs','scripts/check-globals.mjs','scripts/deploy.sh','scripts/box-deploy.sh','scripts/box-live.sh','scripts/auto-update.mjs',
  'scripts/agent-users.sh','scripts/services.sh','scripts/apply-skill-patches.mjs','package.json','code/package.json','code/aqeelos.mjs','code/desktop/main.cjs','docs/cloud-fixer.md','server.mjs','engine/apply.sh','skills/x/SKILL.md','VERSION',
  'app/issues.mjs','app/cloud-fixer.mjs','app/users.mjs','app/proxy-agent.mjs','app/account-auth.mjs']){
  const d=fix([F('app/kirimdev.mjs'),F(f)]);assert.equal(d.ok,false,f);assert.equal(d.kind,'owner');assert.ok(d.why.some(w=>w.includes(f)),f)}});

test('an existing test may not be edited, deleted or renamed away; a rename out of a protected path counts as touching it',()=>{
 assert.equal(fix([F('scripts/users.test.mjs','modified')]).ok,false);assert.equal(fix([F('scripts/users.test.mjs','removed')]).ok,false);
 assert.equal(fix([F('app/old-users.test.mjs','renamed',0,0,{previous_filename:'scripts/users.test.mjs'})]).ok,false);
 assert.equal(fix([F('app/x.mjs','renamed',0,0,{previous_filename:'scripts/auto-update.mjs'})]).ok,false)});

test('size limits, and the first weeks when the owner reviews every fix',()=>{
 assert.equal(fix([F('app/a.mjs','modified',390,20)]).ok,false);assert.equal(fix(Array.from({length:16},(_,k)=>F('app/f'+k+'.mjs'))).ok,false);assert.equal(fix([]).ok,false);
 const d=decide({files:[F('app/a.mjs')],author:'claude[bot]',headRef:'claude/i1',headSha:'abc',config:{...CFG,reviewAllUntil:'2026-12-13'},now:Date.parse('2026-11-20')});assert.equal(d.ok,false);assert.match(d.why.join(' '),/until 2026-12-13/);
 assert.equal(decide({files:[F('app/a.mjs')],author:'claude[bot]',headRef:'claude/i1',headSha:'abc',config:{...CFG,reviewAllUntil:'2026-12-13'},now:Date.parse('2026-12-20')}).ok,true)});

test('the owner\'s approval counts for exactly this commit, and only the owner\'s',()=>{
 const files=[F('.github/workflows/tests.yml')],rev=(login,state,commit_id,t)=>({user:{login},state,commit_id,submitted_at:t});
 assert.equal(fix(files,{reviews:[rev('own','APPROVED','abc','2026-11-12T01:00:00Z')]}).ok,true);
 assert.equal(fix(files,{reviews:[rev('own','APPROVED','OLD','2026-11-12T01:00:00Z')]}).ok,false,'an approval of an earlier commit');
 assert.equal(fix(files,{reviews:[rev('someone','APPROVED','abc','2026-11-12T01:00:00Z'),rev('claude[bot]','APPROVED','abc','2026-11-12T01:00:00Z')]}).ok,false);
 assert.equal(fix(files,{reviews:[rev('own','APPROVED','abc','2026-11-12T01:00:00Z'),rev('own','CHANGES_REQUESTED','abc','2026-11-12T02:00:00Z')]}).ok,false,'taken back');
 assert.equal(fix(files,{reviews:[rev('own','APPROVED','abc','2026-11-12T01:00:00Z'),rev('own','COMMENTED','abc','2026-11-12T02:00:00Z')]}).ok,true)});

test('who is a fixer: the branch name, a bot, or anyone who is not the owner; with no owner set nothing merges unreviewed outside the list',()=>{
 assert.equal(decide({files:[F('scripts/deploy.sh')],author:'own',headRef:'my-work',headSha:'a',config:CFG}).kind,'own');
 assert.equal(decide({files:[F('scripts/deploy.sh')],author:'own',headRef:'claude/i1',headSha:'a',config:CFG}).ok,false,'a fixer branch, whoever pushed it');
 assert.equal(decide({files:[F('scripts/deploy.sh')],author:'stranger',headRef:'patch-1',headSha:'a',config:CFG}).ok,false);
 assert.equal(decide({files:[F('scripts/deploy.sh')],author:'own',headRef:'x',headSha:'a',config:{owner:''}}).ok,false)});

test('the workflow runs from main and never gives the pull request\'s code a token; CODEOWNERS covers what the gate refuses',async()=>{
 const y=await readFile(new URL('../.github/workflows/fixer-gate.yml',import.meta.url),'utf8');
 assert.match(y,/pull_request_target:/);assert.match(y,/^permissions: \{\}$/m);assert.doesNotMatch(y,/secrets\./);assert.doesNotMatch(y,/(contents|pull-requests|actions|checks|statuses): write/);
 const gate=y.slice(y.indexOf('  fixer-gate:'),y.indexOf('  tests-from-main:')),tests=y.slice(y.indexOf('  tests-from-main:'));
 assert.doesNotMatch(gate,/head\.sha|head\.ref/,'the judging job never checks out the pull request');assert.doesNotMatch(tests,/GITHUB_TOKEN|github\.token/);assert.equal((y.match(/persist-credentials: false/g)||[]).length,3);
 for(const u of y.match(/uses: \S+/g))assert.match(u,/@[0-9a-f]{40}$/,u+' is pinned by commit');
 const co=await readFile(new URL('../.github/CODEOWNERS',import.meta.url),'utf8'),cfg=JSON.parse(await readFile(new URL('../.github/fixer-gate.json',import.meta.url),'utf8'));
 assert.match(co,/^\*\s+@\w+/m);for(const n of DEFAULTS.never)assert.match(co,new RegExp('^/'+n.replace(/[.]/g,'\\.')+'\\s+@','m'),n+' has an owner');
 assert.equal(cfg.never,undefined,'the protected list is the script\'s own');assert.ok(cfg.owner)});
