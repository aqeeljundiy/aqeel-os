// OPS-19 (12 Nov 2026): the lean screen's rules, run in bash with scripts/agent-users.sh sourced as a library (same way as
// agent-users.test.mjs): which screen to start, when to sleep, when a stopped screen starts or stays asleep, what the Chrome
// watcher does when Chrome exits, what a wake's result means, the sleep and wake log and the fall back to the old desktop.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,mkdirSync,writeFileSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT=path.join(path.dirname(fileURLToPath(import.meta.url)),'agent-users.sh').replace(/\\/g,'/');
function sh(body,dir){
 const r=spawnSync('bash',['-c',`export AQ_AGENT_USERS_LIB=1 AQEELOS_HOME='${dir}' AQ_RESTARTS='${dir}/rst' AQ_SEEN='${dir}/seen' AQ_WAKE='${dir}/wake' AQ_WAKE_TICK=0.01 AQ_WAKE_TRIES=5; source '${SCRIPT}'; ${body}`],{encoding:'utf8'});
 return {code:r.status,out:(r.stdout||'').trim(),err:r.stderr}}
const tmp=()=>mkdtempSync(path.join(tmpdir(),'aq-users-')).replace(/\\/g,'/');
const events=d=>existsSync(d+'/wake/events.jsonl')?readFileSync(d+'/wake/events.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l)):[];

test('lean is the default; the old desktop is a setting, and the fallback once a lean start failed',()=>{
 const d=tmp();const pick=(w,wm,f)=>sh(`screen_pick ${w} ${wm} ${f}`,d).out;
 assert.equal(pick('lean',1,0),'lean-fluxbox');
 assert.equal(pick('lean',0,0),'lean-bare','no window manager installed: none at all (Chrome fills the screen itself)');
 assert.equal(pick('lean',1,1),'desktop','lean failed before: this agent uses the desktop');
 assert.equal(pick('desktop',1,0),'desktop','the setting');
 // the setting is the 4th column of the agent's line; no file, no line or no column means lean
 assert.equal(sh('mode_of a1',d).out,'lean');
 writeFileSync(d+'/.aqeelos-agent-limits','a1 4096 15 desktop\nb2 4096 15 lean\nc3 4096 15\n');
 assert.equal(sh('mode_of a1',d).out,'desktop');assert.equal(sh('mode_of b2',d).out,'lean');assert.equal(sh('mode_of c3',d).out,'lean');assert.equal(sh('mode_of zz',d).out,'lean')});

test('sleep rule: only an idle, running, ordinary screen goes to sleep, after its minutes',()=>{
 const d=tmp();const st=(sl,now,last,asleep,nosleep,ads,run)=>sh(`sleep_step ${sl} ${now} ${last} ${asleep} ${nosleep} ${ads} ${run}`,d).out;
 assert.equal(st(15,10000,10000-899,0,0,0,1),'wait','14 min 59 s');
 assert.equal(st(15,10000,10000-900,0,0,0,1),'sleep','15 min');
 assert.equal(st(0,10000,0,0,0,0,1),'off','minutes 0: never');
 assert.equal(st(15,10000,0,0,1,0,1),'awake-always','two failed wakes: stays on');
 assert.equal(st(15,10000,0,1,0,0,1),'asleep');
 assert.equal(st(15,10000,0,0,0,1,1),'ads','its own AdsPower runs');
 assert.equal(st(15,10000,0,0,0,0,0),'down')});

test('on demand: a screen that is not running stays asleep until used, unless it may not sleep or a wake was just asked',()=>{
 const d=tmp();const st=(sl,nos,age)=>sh(`ondemand_step ${sl} ${nos} ${age}`,d).out;
 assert.equal(st(15,0,-1),'sleep','box start, never used');
 assert.equal(st(0,0,-1),'start','sleep off: always on as before');
 assert.equal(st(15,1,-1),'start','kept awake after failed wakes');
 assert.equal(st(15,0,5),'start','a wake asked 5 s ago (held back by the back-off) is not put back to sleep');
 assert.equal(st(15,0,119),'start');assert.equal(st(15,0,120),'sleep','a stale wake marker counts for nothing')});

test('wake result: the first failure is tried once more, the second in a row keeps the screen always on',()=>{
 const d=tmp();const st=(ok,f)=>sh(`wake_step ${ok} ${f}`,d).out;
 assert.equal(st(1,0),'ok');assert.equal(st(1,1),'ok');assert.equal(st(0,0),'retry');assert.equal(st(0,1),'keep-awake');assert.equal(st(0,5),'keep-awake')});

test('Chrome watcher: a closed or crashed browser comes back, a deliberate sleep is never fought',()=>{
 const d=tmp();const st=(asleep,alive,code,ran,count)=>sh(`chrome_exit_step ${asleep} ${alive} ${code} ${ran} ${count}`,d).out;
 assert.equal(st(1,1,0,500,1),'stop','asleep (the idle rule ended Chrome on purpose)');
 assert.equal(st(1,1,143,500,1),'stop','asleep, whatever the exit code');
 assert.equal(st(0,0,0,500,1),'stop','the screen is gone: nothing to open it on');
 assert.equal(st(0,1,0,300,1),'reopen','a person closed the window in the take-over view');
 assert.equal(st(0,1,0,300,4),'reopen','closed by hand any number of times: never given up on');
 assert.equal(st(0,1,0,3,1),'backoff','exited cleanly at once (a profile lock): counted as a failure');
 assert.equal(st(0,1,139,500,1),'backoff','a crash');
 assert.equal(st(0,1,139,500,4),'backoff');assert.equal(st(0,1,139,500,5),'giveup','5 failures within an hour: given up, one issue (janitor)')});

test('the Chrome watcher loop itself: starts Chrome again after an exit, stops for a sleep (run with a stand-in Chrome)',()=>{
 const d=tmp();mkdirSync(d+'/sd',{recursive:true});
 // launcher.pid = this shell (alive). The stand-in exits 0 at once (a failure: it ran under 20 s), so the loop starts it again;
 // the second run marks the screen asleep, and the loop must end instead of starting a third
 writeFileSync(d+'/chrome-standin.sh',`#!/bin/bash\necho x >> '${d}/runs'\n[ "$(wc -l < '${d}/runs')" -ge 2 ] && touch '${d}/sd/asleep'\nexit 0\n`);
 const r=sh(`chmod +x '${d}/chrome-standin.sh'; echo $$ > '${d}/sd/launcher.pid'; sleep(){ command sleep 0.01; }; chrome_loop '${d}/sd' '${d}/chrome-standin.sh'; echo done`,d);
 assert.equal(r.out,'done',r.err);assert.equal(readFileSync(d+'/runs','utf8').trim().split('\n').length,2,'started again once, then the sleep ended the loop')});

test('janitor counts for a lean screen: X server, one window manager and Chrome; the old desktop is still five',()=>{
 const d=tmp();const ws=d+'/workspaces/a1';mkdirSync(ws+'/.screen',{recursive:true});
 const ps=[`101 ag-a1 900 Xvnc :42 -geometry 1280x800`,`102 ag-a1 900 fluxbox -rc ${ws}/.screen/fluxbox/init -no-slit -no-toolbar`,
  `103 ag-a1 800 /opt/aqeelos/chrome/chrome --no-sandbox --user-data-dir=${ws}/.browser --remote-debugging-port=19601`,
  `104 ag-a1 800 /opt/aqeelos/chrome/chrome --type=renderer --user-data-dir=${ws}/.browser`].join('\n')+'\n';
 writeFileSync(d+'/ps.txt',ps);
 assert.equal(sh(`jan_count a1 ag-a1 42 '${ws}' < '${d}/ps.txt'`,d).out,'a1 5 3','no mode file: an old desktop screen, three of five parts');
 writeFileSync(ws+'/.screen/mode','lean-fluxbox');
 assert.equal(sh(`jan_count a1 ag-a1 42 '${ws}' < '${d}/ps.txt'`,d).out,'a1 3 3');
 writeFileSync(d+'/ps2.txt',ps+'105 ag-a1 20 fluxbox\n');
 assert.deepEqual(sh(`jan_count a1 ag-a1 42 '${ws}' < '${d}/ps2.txt'`,d).out.split(' '),['a1','3','4','105'],'a second window manager is extra');
 writeFileSync(ws+'/.screen/mode','lean-bare');
 assert.equal(sh(`jan_count a1 ag-a1 42 '${ws}' < '${d}/ps.txt'`,d).out,'a1 2 3','bare: X server and Chrome expected; a window manager running anyway is counted');
 writeFileSync(ws+'/.screen/mode','lean-fluxbox');writeFileSync(ws+'/.screen/chrome.stopped','1');
 assert.equal(sh(`jan_count a1 ag-a1 42 '${ws}' < /dev/null`,d).out,'a1 2 0','Chrome gave up: not expected');
 // missing parts: a lean screen only needs its window manager; the desktop needs three
 const miss=(mode,file)=>sh(`jan_missing ag-a1 42 ${mode} < '${d}/${file}'`,d).out;
 writeFileSync(d+'/ps3.txt','101 ag-a1 900 Xvnc :42\n');
 assert.equal(miss('lean-fluxbox','ps3.txt'),'window manager');assert.equal(miss('lean-bare','ps3.txt'),'');
 assert.equal(miss('desktop','ps3.txt'),'window manager, desktop background, panel');
 assert.equal(miss('lean-fluxbox','ps.txt'),'')});

test('the window manager of a lean screen has no toolbar, menu, keys or borders and maximises every window',()=>{
 const d=tmp();sh(`lean_wm_files '${d}/sd'`,d);
 const init=readFileSync(d+'/sd/fluxbox/init','utf8');
 assert.match(init,/toolbar\.visible: false/);assert.match(init,/defaultDeco: NONE/);assert.match(init,/appsFile: .*\/apps/);
 assert.equal(readFileSync(d+'/sd/fluxbox/keys','utf8'),'');
 const apps=readFileSync(d+'/sd/fluxbox/apps','utf8');assert.match(apps,/\[Maximized\] \{yes\}/);assert.match(apps,/\[Deco\] \{NONE\}/)});

test('every sleep, wake and fall back is one JSON line; quotes in a note cannot break it',()=>{
 const d=tmp();sh(`screen_event a1 wake 4200 true lean-fluxbox; screen_event a1 sleep 900 true lean-fluxbox 'say "hi"'`,d);
 const e=events(d);assert.equal(e.length,2);assert.equal(e[0].event,'wake');assert.equal(e[0].ms,4200);assert.equal(e[0].ok,true);assert.equal(e[0].mode,'lean-fluxbox');
 assert.equal(e[1].note,"say 'hi'");assert.ok(e[0].at>1e9)});

// the functions that start things are replaced by stand-ins: only the rules are run
const STUBS=[
 'port_of(){ echo "a1 40 9601"; }','limit_of(){ echo "4096 15"; }',
 'screen_kill(){ echo kill >> "$AQEELOS_HOME/calls"; }','report(){ echo "$1|$2|$4" >> "$AQEELOS_HOME/reports"; }',
 'screen_up(){ echo "up:${AQ_NOVERIFY:-0}" >> "$AQEELOS_HOME/calls"; [ -f "$HOMEC/workspaces/$1/.screen/lean.failed" ] && echo desktop > "$HOMEC/workspaces/$1/.screen/mode"; return 0; }'].join('; ');
const screen=(d,mode)=>{mkdirSync(d+'/workspaces/a1/.screen',{recursive:true});if(mode)writeFileSync(d+'/workspaces/a1/.screen/mode',mode)};

test('a wake that comes up is logged with its time and clears the failure count',()=>{
 const d=tmp();screen(d,'lean-fluxbox');mkdirSync(d+'/rst',{recursive:true});writeFileSync(d+'/rst/a1.wakefails','1');
 const sd=d+'/workspaces/a1/.screen';writeFileSync(sd+'/waking','1');
 const r=sh(`${STUBS}; screen_ready(){ return 0; }; wake_verify a1 ag-a1 $(( $(now_ms) - 3500 )) wake`,d);
 const e=events(d);assert.equal(e.length,1,r.err);assert.equal(e[0].event,'wake');assert.equal(e[0].ok,true);assert.ok(e[0].ms>=3500&&e[0].ms<8000,'took '+e[0].ms);
 assert.ok(!existsSync(d+'/rst/a1.wakefails'));assert.ok(!existsSync(sd+'/waking'))});

test('a lean start that does not come up falls back to the old desktop once, and that is not a failed wake',()=>{
 const d=tmp();screen(d,'lean-fluxbox');const sd=d+'/workspaces/a1/.screen';
 // not ready while the mode is lean, ready once the stand-in has started the desktop
 const r=sh(`${STUBS}; screen_ready(){ [ "$(cat "$HOMEC/workspaces/a1/.screen/mode")" = desktop ]; }; wake_verify a1 ag-a1 $(now_ms) wake`,d);
 assert.ok(existsSync(sd+'/lean.failed'),r.err);
 const e=events(d);assert.deepEqual(e.map(x=>x.event+':'+x.ok),['fallback:false','wake:true']);
 assert.equal(e[1].mode,'desktop');
 assert.ok(!existsSync(d+'/reports'),'no issue filed');assert.ok(!existsSync(d+'/rst/a1.wakefails'))});

test('two wakes in a row that fail: the screen stays always on and exactly one issue is filed',()=>{
 const d=tmp();screen(d,'desktop');const sd=d+'/workspaces/a1/.screen';
 // already on the desktop (lean.failed set), nothing ever comes up: the first failure retries, the second gives up
 writeFileSync(sd+'/lean.failed','1');
 sh(`${STUBS}; screen_ready(){ return 1; }; wake_verify a1 ag-a1 $(now_ms) wake`,d);
 const e=events(d);assert.deepEqual(e.map(x=>x.event+':'+x.ok),['wake:false','wake:false','keep-awake:true']);
 assert.ok(existsSync(sd+'/nosleep'),'always on from now on');
 const rep=readFileSync(d+'/reports','utf8').trim().split('\n');assert.equal(rep.length,1);assert.match(rep[0],/^a1\|wake-failed\|Agent screen would not wake$/);
 // never put to sleep again, until a reset
 assert.equal(sh('sleep_step 15 99999 0 0 1 0 1',d).out,'awake-always');
 writeFileSync(d+'/.aqeelos-agent-users.reset','a1\n');sh('take_resets >/dev/null',d);assert.ok(!existsSync(sd+'/nosleep'));assert.ok(!existsSync(sd+'/lean.failed'))});

test('a start at box start (not a wake) that fails is logged but never counts toward keeping the screen on',()=>{
 const d=tmp();screen(d,'desktop');writeFileSync(d+'/workspaces/a1/.screen/lean.failed','1');
 sh(`${STUBS}; screen_ready(){ return 1; }; wake_verify a1 ag-a1 $(now_ms) start`,d);
 assert.deepEqual(events(d).map(x=>x.event+':'+x.ok),['start:false']);assert.ok(!existsSync(d+'/workspaces/a1/.screen/nosleep'))});

test('going to sleep: the asleep marker comes before Chrome is ended, so the watcher cannot open it again; the sleep is logged',()=>{
 const d=tmp();screen(d,'lean-fluxbox');const sd=d+'/workspaces/a1/.screen';writeFileSync(d+'/.aqeelos-agent-ports','a1 40 9601\n');
 const r=sh(`${STUBS}; chown(){ :; }; chrome_graceful(){ [ -f "$HOMEC/workspaces/a1/.screen/asleep" ] && echo marker-first >> "$AQEELOS_HOME/calls"; }; put_to_sleep a1 ag-a1 '15 min unused'`,d);
 assert.ok(existsSync(sd+'/asleep'),r.err);
 assert.match(readFileSync(d+'/calls','utf8'),/marker-first/);
 const e=events(d);assert.equal(e.length,1);assert.equal(e[0].event,'sleep');assert.equal(e[0].note,'15 min unused')});

test('a wake request starts the clock when it was asked and removes the asleep marker',()=>{
 const d=tmp();screen(d,'lean-fluxbox');const sd=d+'/workspaces/a1/.screen';mkdirSync(d+'/wake',{recursive:true});
 writeFileSync(d+'/.aqeelos-agent-users','a1\n');writeFileSync(sd+'/asleep','');
 const asked=Math.floor(Date.now()/1000)-3;writeFileSync(d+'/wake/a1.wake','');utimesSync(d+'/wake/a1.wake',asked,asked);
 sh(`${STUBS}; id(){ return 0; }; take_wakes`,d);
 assert.ok(!existsSync(sd+'/asleep'));assert.ok(!existsSync(d+'/wake/a1.wake'));
 const t0=Number(readFileSync(sd+'/waking','utf8'));assert.ok(Math.abs(t0-asked*1000)<1,'the clock starts at the request, not at the pickup');
 assert.match(readFileSync(d+'/calls','utf8'),/^up:0/m)});
