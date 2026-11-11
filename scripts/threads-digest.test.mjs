// Tests for scripts/threads-digest.mjs (the rules digest of the Continue Threads runners). Run: node --test scripts/threads-digest.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dateOf,isRunLog,rulesOf,decisionsOf,build,hashOf} from './threads-digest.mjs';

const LOGS=['2026-11-05 06:36 WIB | Threads agent | run: DM check clean, 0 comments/0 follows, still holding for the pause decision',
 '2026-11-05 07:40 WIB | Threads agent | FAST DM run: no chats with their message newest, 0 sent.','2026-11-06 02:30 WIB | Threads agent | run (comment loop): no DM flag; 0 comments',
 '10 Nov 2026 ~05:20 WIB outbound DM run: ~22 candidates (8 searches); 0 DMs','11 Nov 2026 ~21:35 WIB comment run: browser hung, restarted Chrome; 0 comments','12 Nov 2026 ~01:30 WIB DM+replies run: inbox ours newest; 0 sent'];
const DECS=['2026-11-02 22:00 WIB | Donna | Full plan approved: 70 comments/day, 15 own posts/day, answer all DMs.','2026-11-03 09:00 WIB | Donna | 70/day straight away, no ramp. Max 5/hour.',
 '2026-11-05 12:29 WIB | Threads agent | CORRECTION (AJ, explicit): it is 3 comments PER HOUR.','2026-11-05 13:24 WIB | Threads agent | AJ: nothing went live after 13:00, so the 12:37 comments are a run problem',
 '2026-11-04 17:13 WIB | Threads agent | Every run (comment loop runs too, not only DM runs): answer new replies under our comments.','2026-11-09 03:43 WIB | Threads agent | AJ: blockers must be PATCHED in the tools immediately.',
 '2026-11-11 21:00 WIB | Threads agent | AJ lets do it: depth + BPOM reminder printed by style_pick.py.'];

test('dates in both of the file formats',()=>{assert.equal(dateOf('2026-11-05 07:40 WIB | x'),'2026-11-05');assert.equal(dateOf('9 Nov 2026 ~12:30 WIB thread run'),'2026-11-09');assert.equal(dateOf('12 Nov 2026 x'),'2026-11-12');assert.equal(dateOf('no date'),null)});
test('run logs are recognised, decisions are never taken for logs',()=>{for(const l of LOGS)assert.equal(isRunLog(l),true,l);for(const l of DECS)assert.equal(isRunLog(l),false,l);
 assert.equal(isRunLog('# Aqeel decisions for Continue Threads'),false);assert.equal(isRunLog(''),false)});
test('the decisions keep every decision line verbatim and in order, and count what they drop',()=>{const r=decisionsOf([...LOGS.slice(0,3),...DECS,...LOGS.slice(3)].join('\n'));assert.deepEqual(r.lines,DECS);assert.equal(r.dropped,LOGS.length)});
test('with a base, the lines up to its date are replaced and only the later ones follow',()=>{const r=decisionsOf(DECS.join('\n'),{since:'2026-11-05'});assert.deepEqual(r.lines,[DECS[5],DECS[6]]);assert.equal(r.old,5);
 const b=build({knowledge:'',playbook:'P',facts:'F',decisions:DECS.join('\n'),base:'BASE TEXT',baseUntil:'2026-11-05'}).text;assert.ok(b.includes('BASE TEXT'));assert.ok(b.indexOf('BASE TEXT')<b.indexOf(DECS[6]));assert.ok(!b.includes(DECS[0]))});
test('the knowledge file keeps its sections and drops its per-run log lines',()=>{const k=['9 Nov 2026 ~12:30 WIB thread run: x','10 Nov 2026 ~08:09 WIB reply-run: y','','## DEPTH + BPOM (AJ, 11 Nov)','- Real users asking BPOM get an honest answer.','','## CONFLICT TONE','- calm','12 Nov 2026 ~01:15 WIB DM+replies run: 0 sent'].join('\n');
 const r=rulesOf(k);assert.ok(r.includes('## DEPTH + BPOM')&&r.includes('honest answer')&&r.includes('- calm'));assert.ok(!r.includes('thread run: x')&&!r.includes('reply-run: y'));
 assert.equal(rulesOf('Plain rule line without a date\n9 Nov 2026 ~1:00 WIB run: x'),'Plain rule line without a date')});
test('the digest is one file: rules, playbook, facts, decisions; it says where run summaries go',()=>{const d=build({knowledge:'## R\n- a',playbook:'PLAYBOOK TEXT',facts:'FACTS TEXT',decisions:[...LOGS,...DECS].join('\n')});
 for(const x of ['## RULES','- a','## CONTENT PLAYBOOK','PLAYBOOK TEXT','## FORUM FACTS','FACTS TEXT','## DECISIONS','RUNLOG.txt'])assert.ok(d.text.includes(x),x);assert.equal(d.stats.runLogsDropped,LOGS.length);assert.equal(d.stats.decisionLines,DECS.length);
 assert.notEqual(hashOf(['a','b']),hashOf(['ab','']))});

const run=(args)=>new Promise(res=>execFile(process.execPath,[path.join(path.dirname(fileURLToPath(import.meta.url)),'threads-digest.mjs'),...args],(e,out,err)=>res({code:e?e.code:0,out,err})));
test('the command writes the digest, leaves the sources alone, and does nothing when the sources did not change',async()=>{const D=await mkdtemp(path.join(tmpdir(),'td-'));
 const files={'THREADS_KNOWLEDGE.md':'12 Nov 2026 ~01:15 WIB DM+replies run: 0 sent\n## R\n- a','CONTENT_PLAYBOOK.md':'PB','FORUM_FACTS.md':'FF','AQEEL_DECISIONS.md':'# h\n# h2\n'+[...LOGS,...DECS].join('\n')};
 for(const [f,t] of Object.entries(files))await writeFile(path.join(D,f),t);
 assert.equal((await run(['--dir',D,'--check'])).code,1,'no digest yet');
 const a=await run(['--dir',D]);assert.equal(a.code,0);assert.match(a.out,/written .*decisions kept 7, run logs left out 6/);
 const text=await readFile(path.join(D,'RULES_DIGEST.md'),'utf8');assert.match(text,/^<!-- sources [0-9a-f]{16} -->\n/);assert.ok(text.includes(DECS[2])&&!text.includes(LOGS[0]));
 for(const [f,t] of Object.entries(files))assert.equal(await readFile(path.join(D,f),'utf8'),t,f+' untouched');
 assert.equal((await run(['--dir',D,'--check'])).code,0);assert.match((await run(['--dir',D])).out,/up to date/);
 await writeFile(path.join(D,'AQEEL_DECISIONS.md'),files['AQEEL_DECISIONS.md']+'\n2026-11-12 09:00 WIB | Donna | AJ: new rule.');assert.equal((await run(['--dir',D,'--check'])).code,1,'a changed source');
 assert.equal((await run(['--dir',D,'--base','B.md'])).code,2,'a base needs its date');
 await writeFile(path.join(D,'B.md'),'BASE');const b=await run(['--dir',D,'--base','B.md','--base-until','2026-11-05']);assert.equal(b.code,0);assert.ok((await readFile(path.join(D,'RULES_DIGEST.md'),'utf8')).includes('BASE'))});
