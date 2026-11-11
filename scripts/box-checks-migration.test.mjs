// The one-time move of install-specific check scripts out of the code folder (12 Nov 2026): aq_migrate_box_checks in box-live.sh copies the old
// scripts/box-checks/ to <data>/box-checks/ and keeps close-stage-due's sheet settings, before the new files are unpacked. Idempotent, never overwrites, never deletes.
// Also: the generic wake-up template and close-stage-due read their settings from <data>/box-checks/, not from the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';

const src=readFileSync(new URL('./box-live.sh',import.meta.url),'utf8');
const fn=src.slice(src.indexOf('# --- migrate box-checks'),src.indexOf('# --- end migrate box-checks ---'));
const OLD_CLOSE="const stage=+opt('stage'),sheet=opt('sheet','SHEET_ID_X'),tab=opt('tab','AI RUN STATUS'),account=opt('account','acct-x'),month=1;\n";

function box({close=true,files={'wakeup-nudge.py':'print(1)\n','probe.py':'print(2)\n'}}={}){const H=mkdtempSync(path.join(tmpdir(),'mig-')),L=path.join(H,'apps','hermes-ui'),D=path.join(H,'apps','hermes-ui-data');
 mkdirSync(path.join(L,'scripts','box-checks'),{recursive:true});mkdirSync(D,{recursive:true});
 for(const [n,t] of Object.entries(files))writeFileSync(path.join(L,'scripts','box-checks',n),t);
 if(close)writeFileSync(path.join(L,'scripts','close-stage-due.mjs'),OLD_CLOSE);
 return {H,L,D,run:()=>spawnSync('bash',['-c',fn+'\naq_migrate_box_checks; echo rc=$?'],{env:{...process.env,HOME:H,AQ_LIVE:L,AQ_MIG_DATA:D,UI_DATA_DIR:D},encoding:'utf8'})}}

test('the old box-checks files are copied to the data folder, the close-stage settings are kept, nothing is deleted',()=>{const b=box();const r=b.run();
 assert.match(r.stdout,/rc=0/);const T=path.join(b.D,'box-checks');
 assert.equal(readFileSync(path.join(T,'wakeup-nudge.py'),'utf8'),'print(1)\n');assert.equal(readFileSync(path.join(T,'probe.py'),'utf8'),'print(2)\n');
 assert.deepEqual(JSON.parse(readFileSync(path.join(T,'close-stage-due.json'),'utf8')),{sheet:'SHEET_ID_X',tab:'AI RUN STATUS',account:'acct-x'});
 assert.ok(existsSync(path.join(b.L,'scripts','box-checks','wakeup-nudge.py')),'the old copy is left where it is');assert.ok(!readdirSync(T).some(f=>f.endsWith('.tmp')))});

test('it is idempotent and never overwrites what the install already edited',()=>{const b=box();b.run();const T=path.join(b.D,'box-checks');
 writeFileSync(path.join(T,'wakeup-nudge.py'),'edited\n');writeFileSync(path.join(T,'close-stage-due.json'),'{"sheet":"mine"}');
 writeFileSync(path.join(b.L,'scripts','box-checks','wakeup-nudge.py'),'changed in the old folder\n');
 const r=b.run();assert.match(r.stdout,/rc=0/);assert.equal(readFileSync(path.join(T,'wakeup-nudge.py'),'utf8'),'edited\n');assert.equal(readFileSync(path.join(T,'close-stage-due.json'),'utf8'),'{"sheet":"mine"}')});

test('after the new version is unpacked (no defaults in close-stage-due, no old folder) it does nothing and does not fail',()=>{const b=box({close:false,files:{}});
 writeFileSync(path.join(b.L,'scripts','close-stage-due.mjs'),"const sheet=opt('sheet',cfg.sheet);\n");
 const r=b.run();assert.match(r.stdout,/rc=0/);assert.ok(!existsSync(path.join(b.D,'box-checks','close-stage-due.json')));
 const none=mkdtempSync(path.join(tmpdir(),'mig-'));const r2=spawnSync('bash',['-c',fn+'\naq_migrate_box_checks; echo rc=$?'],{env:{...process.env,HOME:none,AQ_LIVE:path.join(none,'nope'),AQ_MIG_DATA:path.join(none,'d')},encoding:'utf8'});assert.match(r2.stdout,/rc=0/)});

test('box-live.sh runs the move before it unpacks the new files',()=>{const i=src.indexOf('aq_migrate_box_checks || true'),j=src.indexOf('tar -xzf $HT -C ~/apps/hermes-ui');assert.ok(i>0&&j>i)});

test('close-stage-due reads its sheet from <data>/box-checks/close-stage-due.json and has no default id in the code',()=>{
 const code=readFileSync(new URL('./close-stage-due.mjs',import.meta.url),'utf8');assert.doesNotMatch(code,/\b1[A-Za-z0-9_-]{43}\b/);assert.match(code,/box-checks/);
 const D=mkdtempSync(path.join(tmpdir(),'cs-'));const f=path.join(D,'c.json');
 const r=spawnSync('node',[new URL('./close-stage-due.mjs',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),'--stage','2'],{env:{...process.env,CLOSE_STAGE_CONFIG:f},encoding:'utf8'});
 assert.equal(r.status,1);assert.match(r.stderr,/no sheet id/)});

test('the wake-up template takes its wording and hour from <data>/box-checks/wakeup-nudge.json',{skip:spawnSync('python3',['--version']).status!==0&&'no python3 here'},()=>{
 const H=mkdtempSync(path.join(tmpdir(),'wk-')),cfg=path.join(H,'w.json');mkdirSync(path.join(H,'.hermes','cron'),{recursive:true});
 const py=path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')),'check-templates','wakeup-nudge.py');
 const run=(extra={})=>spawnSync('python3',[py,'--dry'],{env:{...process.env,HOME:H,USERPROFILE:H,WAKEUP_CONFIG:cfg,...extra},encoding:'utf8'});
 assert.equal(run().stdout.trim(),'Wake up!','built-in neutral wording without a settings file');
 writeFileSync(cfg,JSON.stringify({nudges:['Good morning, Pat!','Up!'],hour:5}));assert.equal(run().stdout.trim(),'Good morning, Pat!');
 assert.doesNotMatch(readFileSync(py,"utf8"),/bAqeelb|@lid/i)});
