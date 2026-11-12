// OPS-8: the operations rules (OPERATIONS.md) as tests. Each fails when new code breaks a rule; the message says which
// rule and what to do. Reading the code is the check: nothing here starts a process.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LEFTOVER} from '../app/backup.mjs';
import {src} from './lib/source.mjs';

const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>readFileSync(path.join(ROOT,f),'utf8');
const files=(dir,re)=>readdirSync(path.join(ROOT,dir)).filter(f=>re.test(f)).map(f=>dir+'/'+f);
const USERS=read('scripts/agent-users.sh');
const body=name=>{const i=USERS.indexOf('\n'+name+'(){');assert.ok(i>=0,name+' is gone from agent-users.sh');return USERS.slice(i,USERS.indexOf('\n}\n',i))};

test('rule 1: agent screens start only in screen_up, which stops what an earlier start left first',()=>{
 const up=body('screen_up');
 const kill=up.indexOf('screen_kill '),start=up.indexOf('Xvnc :');
 assert.ok(kill>0&&kill<start,'screen_up must call screen_kill before it starts Xvnc (OPERATIONS.md rule 1)');
 // the only Xvnc, desktop and Chrome launches in the script are in screen_up (a headless start check in a throwaway profile is not a screen)
 for(const [what,re] of [['Xvnc',/Xvnc :\$disp -geometry/g],['the desktop',/\( dbus-launch --exit-with-session bash/g],['Chrome',/^(?!.*--headless).*--remote-debugging-port=/gm]]){
  const all=[...USERS.matchAll(re)].length,inUp=[...up.matchAll(re)].length;
  assert.equal(all,inUp,what+' is started outside screen_up in agent-users.sh: start it there, after screen_kill (rule 1)')}});

test('rule 1: background launches with a bare ( … & ) only in screen_up',()=>{
 for(const f of files('scripts',/\.sh$/)){const t=read(f);
  for(const m of t.matchAll(/\(\s[^()\n]*&\s*\)/g)){
   const ok=f==='scripts/agent-users.sh'&&body('screen_up').includes(m[0]);
   assert.ok(ok,f+': "'+m[0].slice(0,60)+'" starts a process nothing tracks (rule 1). Give it one owner that stops it before starting it again.')}}});

test('rule 1: new detached launches in the app are deliberate',()=>{
 // a detached child outlives the app: each one here has an owner that finds and stops it (reviewed 11 Nov 2026)
 // app/backup.mjs (12 Nov 2026): the nightly backup's own process; DATA/backup-job.json is its lock (pid + heartbeat), it ends by itself, and the app follows or clears it at start
 const KNOWN={'app/backup.mjs':1,'app/automation-guard.mjs':1,'app/issues.mjs':1,'app/self-runs-box.mjs':1,'app/server.mjs':2};
 for(const f of files('app',/\.mjs$/)){const n=[...read(f).matchAll(/detached:\s*true/g)].length;
  assert.ok(n<=(KNOWN[f]||0),f+' has '+n+' detached launch(es), '+(KNOWN[f]||0)+' known. A detached process needs an owner that stops it (OPERATIONS.md rule 1); then add it to KNOWN here.')}});

test('rule 3: screen restarts go through the back-off gate and Chrome through its back-off loop',()=>{
 const up=body('screen_up');
 assert.ok(up.indexOf('restart_gate')>0&&up.indexOf('restart_gate')<up.indexOf('screen_kill '),'screen_up must ask restart_gate before (re)starting a screen (rule 3)');
 assert.ok(/chrome_loop '\$sd' '\$CHROME'/.test(up),'Chrome must be run by chrome_loop, which backs off and gives up (rule 3)');
 assert.ok(!/while [^\n]*; do [^\n]*\$CHROME/.test(USERS),'a plain restart loop around Chrome is back (rule 3)');
 assert.match(USERS,/WAITS=\(5 30 120 600 600\)/,'the back-off is 5 s, 30 s, 2 min, 10 min (rule 3)')});

test('rule 4: the janitor runs every minute in the watch loop',()=>{
 assert.match(USERS,/\$\(\(n % 12\)\) -eq 0 \] && \[ -f "\$REQ" \] && \{ janitor;/,'watch must run the janitor every 12 beats of 5 s (rule 4)')});

test('rule 2: memory caps and sleep are checked every minute, and Chrome sits behind the wake proxy when it may sleep',()=>{
 const up=body('screen_up');
 assert.ok(USERS.includes('mem_cap "$n" "$u" "$ws"'),'the janitor must check each agent\'s memory cap (rule 2)');
 assert.ok(USERS.includes('janitor; sleep_idle;'),'idle screens must be put to sleep every minute (rule 2)');
 assert.ok(up.includes('--remote-debugging-port=$cport '),'Chrome must listen on the port chrome_port picks (behind the wake proxy when it may sleep)');
 assert.ok(up.includes('[ -f "$sd/asleep" ] && return 0'),'a sleeping screen is started only by a wake (rule 2)')});

test('rule 7: the backup\'s temporary file is one the leftover sweep knows',()=>{
 const b=read('app/backup.mjs');
 assert.match(b,/const nameOf=at=>'aqeelos-'\+new Date\(at\+7\*3600e3\)\.toISOString\(\)\.slice\(0,16\)\.replace\(\/\[:T\]\/g,'-'\)\+'\.tar\.gz\.enc'/,'the backup file name changed: update LEFTOVER in backup.mjs so cut-off backups are still swept (rule 7)');
 assert.ok(LEFTOVER.test('aqeelos-2026-11-11-07-57.tar.gz.enc')&&LEFTOVER.test('aqeelos-2026-11-11-07-57.tar.gz.enc.skipped'));
 assert.match(b,/dropLeftovers()/,'cut-off backups must be removed on start (rule 7)')});

test('rule 7: screen logs are trimmed and the app expires temporary files',()=>{
 assert.match(USERS,/trim_logs/);assert.match(src('app/server.mjs'),/boxOps\.start\(\)/,'the app must run box-ops (expiry, rule 7)')});

test('the rules document names a test or check for every rule that is no longer planned',()=>{
 const doc=read('OPERATIONS.md');
 for(const id of ['OPS-3','OPS-5','OPS-7','OPS-8'])assert.ok(!new RegExp('\\(planned, '+id+'\\)').test(doc),id+' is built: OPERATIONS.md should say what enforces it')});
