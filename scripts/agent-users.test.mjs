// The root script's decisions (scripts/agent-users.sh), run in bash with the script sourced as a library
// (AQ_AGENT_USERS_LIB=1: functions only, nothing started): OPS-3 restart back-off and OPS-5 janitor counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,mkdirSync,writeFileSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT=path.join(path.dirname(fileURLToPath(import.meta.url)),'agent-users.sh').replace(/\\/g,'/');
function sh(body,dir){
 const r=spawnSync('bash',['-c',`export AQ_AGENT_USERS_LIB=1 AQEELOS_HOME='${dir}' AQ_RESTARTS='${dir}/rst' AQ_SEEN='${dir}/seen'; source '${SCRIPT}'; ${body}`],{encoding:'utf8'});
 return {code:r.status,out:(r.stdout||'').trim(),err:r.stderr}}
const tmp=()=>mkdtempSync(path.join(tmpdir(),'aq-users-')).replace(/\\/g,'/');

test('the script parses and sourcing it starts nothing',()=>{
 assert.equal(spawnSync('bash',['-n',SCRIPT]).status,0);
 const d=tmp();const r=sh('echo sourced',d);assert.equal(r.out,'sourced',r.err)});

test('restarts back off 5 s, 30 s, 2 min, 10 min and stop after 5 failures in an hour, filing one issue',()=>{
 const d=tmp();
 const gate=t=>sh(`restart_gate a1 ${t} >/dev/null; echo $?`,d).out;
 assert.equal(gate(1000),'0');            // first start
 assert.equal(gate(1001),'1');            // failed at once: wait 5 s
 assert.equal(gate(1006),'0');
 assert.equal(gate(1020),'1');            // second failure: 30 s
 assert.equal(gate(1036),'0');
 assert.equal(gate(1100),'1');            // 2 min
 assert.equal(gate(1157),'0');
 assert.equal(gate(1500),'1');            // 10 min
 assert.equal(gate(1757),'0');
 assert.equal(gate(2357),'0');            // 5th failure's restart (10 min)
 assert.equal(gate(2957),'2');            // 6th start in the hour: given up
 assert.equal(gate(9000),'2');            // stays stopped, even later
 const issues=readFileSync(d+'/.aqeelos-agent-issues.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(issues.length,1);assert.equal(issues[0].agent,'a1');assert.equal(issues[0].key,'screen-stopped');
 // a reset lets it start again with the counts cleared
 writeFileSync(d+'/.aqeelos-agent-users.reset','a1\n');
 sh('take_resets >/dev/null',d);assert.equal(gate(9001),'0');assert.equal(gate(9002),'1')});

test('failures more than an hour old no longer count',()=>{
 const d=tmp();const gate=t=>sh(`restart_gate b ${t} >/dev/null; echo $?`,d).out;
 for(const t of [0,10,50,200,900])assert.equal(gate(t),'0');
 assert.equal(gate(1500),'0');            // the 5th failure, still allowed
 assert.equal(gate(5000),'0')});          // all old: a fresh start

test('janitor: one of each screen part is expected; copies and foreign displays are extra, the oldest copy kept',()=>{
 const d=tmp();mkdirSync(d+'/workspaces/a1/.screen',{recursive:true});
 const ws=d+'/workspaces/a1';
 const ps=[
  `101 ag-a1 900 Xvnc :42 -geometry 1280x800`,
  `102 ag-a1 50 Xvnc :43 -geometry 1280x800`,           // not its display
  `103 ag-a1 900 xfwm4`,
  `104 ag-a1 900 xfdesktop`,
  `105 ag-a1 900 xfce4-panel`,
  `106 ag-a1 20 xfce4-panel`,                           // a second panel: the newer one is extra
  `107 ag-a1 800 /opt/aqeelos/chrome/chrome --no-sandbox --user-data-dir=${ws}/.browser --remote-debugging-port=9602`,
  `108 ag-a1 800 /opt/aqeelos/chrome/chrome --type=renderer --user-data-dir=${ws}/.browser`,
  `109 ag-a1 30 python3 my_task.py`,                    // the agent's own work: not counted, never removed
  `110 ag-b2 900 Xvnc :44`,                             // another agent
 ].join('\n');
 writeFileSync(d+'/ps.txt',ps+'\n');
 const r=sh(`jan_count a1 ag-a1 42 '${ws}' < '${d}/ps.txt'`,d).out.split(' ');
 assert.deepEqual(r.slice(0,3),['a1','5','7']);
 assert.deepEqual(r.slice(3).sort(),['102','106']);
 // a clean screen: expected equals running, nothing extra
 writeFileSync(d+'/ps2.txt',ps.split('\n').filter(l=>!/^10[26] /.test(l)).join('\n')+'\n');
 assert.equal(sh(`jan_count a1 ag-a1 42 '${ws}' < '${d}/ps2.txt'`,d).out,'a1 5 5');
 // a Chrome that gave up is not expected any more
 writeFileSync(ws+'/.screen/chrome.stopped','1');
 assert.equal(sh(`jan_count a1 ag-a1 42 '${ws}' < /dev/null`,d).out,'a1 4 0')});

test('limits: no file or no line means no cap and no sleep (as before); a line sets both',()=>{
 const d=tmp();assert.equal(sh('limit_of a1',d).out,'0 0');
 writeFileSync(d+'/.aqeelos-agent-limits','a1 4096 30\nb2 0 0\n');
 assert.equal(sh('limit_of a1',d).out,'4096 30');assert.equal(sh('limit_of b2',d).out,'0 0');assert.equal(sh('limit_of zz',d).out,'0 0');
 assert.equal(sh('chrome_port 9602 30',d).out,'19602');
 // 13 Nov 2026: sleep 0 must not move Chrome off the inner port: the agent's own address stays behind the proxy
 assert.equal(sh('chrome_port 9602 0',d).out,'19602')});

test('port map for the wake proxy: every agent with a port line is listed, whatever its sleep setting (sleep 0 too)',()=>{
 const d=tmp();mkdirSync(d+'/wake');
 writeFileSync(d+'/.aqeelos-agent-users','a1\nb2\nc3\nno-port\n');
 writeFileSync(d+'/.aqeelos-agent-ports','a1 40 9600\nb2 41 9601\nc3 42 9602\n');
 writeFileSync(d+'/.aqeelos-agent-limits','a1 4096 30\nb2 8192 0\n');   // c3 has no line at all
 const run=()=>{sh('id(){ return 0; }; WAKE='+d+'/wake; wake_ports',d);return readFileSync(d+'/wake/ports','utf8')};
 let out=run().trim().split('\n');
 assert.deepEqual(out,['a1 9600 19600','b2 9601 19601','c3 9602 19602']);
 // the setting changes while Chrome runs: the map does not change, so 127.0.0.1:<port> keeps answering
 writeFileSync(d+'/.aqeelos-agent-limits','a1 4096 0\nb2 8192 30\n');
 assert.deepEqual(run().trim().split('\n'),out);
 // and what Chrome is told to listen on matches the proxy's inner port for every setting
 for(const sl of [0,1,30,43200])assert.equal(sh('chrome_port 9600 '+sl,d).out,'19600')});

test('reading another user\'s environ prints no error line (the redirect error is silenced, not only the command\'s)',()=>{
 const d=tmp();const r=sh('harness_port 1 >/dev/null; harness_port 999999 >/dev/null',d);assert.equal(r.err,'')});

test('memory cap: 3 min over restarts Chrome, 3 more min files one issue, twice the cap stops the biggest at once',()=>{
 const d=tmp();const step=(mb,cap,now,since,acted)=>sh(`mem_step ${mb} ${cap} ${now} ${since} ${acted}`,d).out;
 assert.equal(step(3000,4096,1000,0,0),'none');          // under
 assert.equal(step(5000,0,1000,900,0),'none');           // no cap
 assert.equal(step(5000,4096,1000,900,0),'none');        // over for 100 s
 assert.equal(step(5000,4096,1100,900,0),'chrome');      // over for 200 s
 assert.equal(step(5000,4096,1200,900,1100),'none');     // just restarted
 assert.equal(step(5000,4096,1300,900,1100),'report');   // still over 3 min later
 assert.equal(step(5000,4096,9000,900,-1),'none');       // reported once
 assert.equal(step(9000,4096,1000,1000,0),'biggest')});

test('OPS-17: over its cap while at work, nothing of the agent is restarted unless it holds three times the cap',()=>{
 const d=tmp();const step=(mb,cap,now,since,acted,busy)=>sh(`mem_step ${mb} ${cap} ${now} ${since} ${acted} ${busy}`,d).out;
 assert.equal(step(5000,4096,1100,900,0,1),'none');      // would restart Chrome: waits
 assert.equal(step(9000,4096,1000,1000,0,1),'none');     // twice the cap: waits too
 assert.equal(step(13000,4096,1000,1000,0,1),'biggest'); // three times: the box comes first
 assert.equal(step(5000,4096,1100,900,0,0),'chrome')});

test('OPS-17: the bigger part is restarted, Chrome or AdsPower',()=>{
 const d=tmp();assert.equal(sh('mem_target 1567 5757',d).out,'adspower');assert.equal(sh('mem_target 2400 0',d).out,'chrome');assert.equal(sh('mem_target 0 0',d).out,'chrome')});

test('OPS-17: the watchdog\'s requests are checked again before anything is done',()=>{
 const d=tmp();const step=(what,used,busy,ads,asleep)=>sh(`mem_req_step ${what} 10000 ${used} ${busy} ${ads} ${asleep}`,d).out;
 assert.equal(step('sleep',1000,0,0,0),'sleep');
 assert.equal(step('sleep',1000,0,1,0),'skip');          // its own AdsPower runs: its screen never sleeps
 assert.equal(step('sleep',9800,0,0,0),'skip');          // screen used 200 s ago
 assert.equal(step('chrome',1000,1,0,0),'skip');         // mid-reply or a schedule running
 assert.equal(step('chrome',1000,0,0,1),'skip');         // already asleep
 assert.equal(step('chrome',1000,0,0,0),'chrome');
 assert.equal(step('adspower',1000,0,0,0),'skip');       // no AdsPower running
 assert.equal(step('adspower',1000,0,1,0),'adspower');
 assert.equal(step('rm',1000,0,0,0),'skip');assert.equal(step('no-sleep',1000,0,0,0),'skip')});

test('OPS-13: missing desktop parts are named only while the agent\'s display runs',()=>{
 const d=tmp();const miss=lines=>{writeFileSync(d+'/ps.txt',lines.join('\n')+'\n');return sh(`jan_missing ag-a1 42 < '${d}/ps.txt'`,d).out};
 const full=['1 ag-a1 900 Xvnc :42 -geometry 1280x800','2 ag-a1 900 xfwm4','3 ag-a1 900 xfdesktop','4 ag-a1 900 xfce4-panel','5 ag-b2 900 xfdesktop'];
 assert.equal(miss(full),'');
 assert.equal(miss(full.filter(l=>!/xfdesktop$|panel$/.test(l)||/ag-b2/.test(l))),'desktop background, panel');   // P&P pixel-agent, 9 Nov
 assert.equal(miss(full.filter(l=>!/xfwm4/.test(l))),'window manager');
 assert.equal(miss(['1 ag-a1 900 Xvnc :43','9 ag-a1 9 /usr/lib/x86_64-linux-gnu/xfce4/panel/wrapper-2.0 x']),'');  // not its display: not this check
 assert.equal(miss([]),'')});

test('OPS-13: a part missing 10 min starts again unless the agent uses its screen within 5 min',()=>{
 const d=tmp();const step=(now,since,used,busy)=>sh(`part_step ${now} ${since} ${used} ${busy}`,d).out;
 assert.equal(step(5000,0,0,0),'none');
 assert.equal(step(5000,4500,0,0),'wait');        // 8 min
 assert.equal(step(5000,4400,0,0),'restart');     // 10 min
 assert.equal(step(5000,4400,4800,0),'busy');     // used 200 s ago
 assert.equal(step(5000,4400,4700,0),'restart');  // used 5 min ago
 assert.equal(step(5000,4400,0,1),'busy')});      // mid-reply

test('OPS-13: desk_check waits 10 min, skips a busy agent, restarts the desktop alone and tries again 10 min later',()=>{
 const d=tmp(),ws=d+'/workspaces/a1';mkdirSync(ws+'/.screen',{recursive:true});mkdirSync(d+'/wake');
 writeFileSync(ws+'/.screen/activity','');utimesSync(ws+'/.screen/activity',1000,1000);
 writeFileSync(d+'/ps.txt',['1 ag-a1 900 Xvnc :42','2 ag-a1 900 xfwm4'].join('\n')+'\n');
 const check=(now,pre='')=>sh(`WAKE='${d}/wake'; screen_up(){ echo "UP $*"; }; ${pre} desk_check a1 ag-a1 42 '${ws}' ${now} < '${d}/ps.txt'`,d).out;
 assert.equal(check(100000),'');                                   // first seen missing
 assert.equal(readFileSync(d+'/rst/a1.part','utf8').trim(),'100000');
 assert.equal(check(100540),'');                                   // 9 min
 // mid-reply: the app's list names it, written 1 min ago
 writeFileSync(d+'/.aqeelos-agent-busy','zz\na1\n');utimesSync(d+'/.aqeelos-agent-busy',100560,100560);
 assert.equal(check(100620),'');
 // the list is stale (the app stopped writing it): not busy any more; DevTools traffic 2 min ago is
 writeFileSync(d+'/wake/a1.active','');utimesSync(d+'/wake/a1.active',100800,100800);
 assert.equal(check(100920),'');
 assert.equal(check(101200),'UP a1 ag-a1 desktop desktop background, panel missing for 20 min');
 assert.equal(readFileSync(d+'/rst/a1.part','utf8').trim(),'101200');
 assert.equal(check(101500),'');                                   // still missing: the next try is 10 min on
 assert.equal(check(101800),'UP a1 ag-a1 desktop desktop background, panel missing for 10 min');
 // whole again: the record goes
 writeFileSync(d+'/ps.txt',['1 ag-a1 900 Xvnc :42','2 ag-a1 900 xfwm4','3 ag-a1 900 xfdesktop','4 ag-a1 900 xfce4-panel'].join('\n')+'\n');
 assert.equal(check(101860),'');assert.ok(!existsSync(d+'/rst/a1.part'));
 // an asleep screen is never checked
 writeFileSync(d+'/ps.txt','');writeFileSync(ws+'/.screen/asleep','');assert.equal(check(200000),'');assert.ok(!existsSync(d+'/rst/a1.part'))});

test('OPS-13: the desktop restart goes through restart_gate and desk_kill, and only on a running display',()=>{
 const src=readFileSync(SCRIPT,'utf8');const up=src.slice(src.indexOf('\nscreen_up(){'),src.indexOf('\n}\n',src.indexOf('\nscreen_up(){')));
 const br=up.slice(up.indexOf('if [ "$part" = desktop ]'),up.indexOf('  fi\n',up.indexOf('if [ "$part" = desktop ]')));
 assert.ok(br.indexOf('kill -0')<br.indexOf('restart_gate')&&br.indexOf('restart_gate')<br.indexOf('desk_kill')&&br.indexOf('desk_kill')<br.indexOf('$desk'));
 assert.ok(!/Xvnc|chrome_loop|screen_kill/.test(br),'the desktop alone: its display and Chrome keep running');
 assert.ok(src.includes('| desk_check "$n" "$u" "$disp" "$ws"'),'the janitor checks the desktop parts every minute')});
test('OPS-16: leftover browser helpers are stopped only when detached, over 2 h old and their Chrome is gone, or over a day old',()=>{
 const d=tmp();
 writeFileSync(d+'/h.txt',[
  '201 1 9000 35819',     // 2.5 h, its Chrome no longer listens: stopped
  '202 1 9000 9602',      // 2.5 h, its Chrome still listens: kept
  '203 1 3600 35820',     // 1 h, Chrome gone: still young, kept
  '204 1 9000 -',         // Chrome unknown: kept until a day old
  '205 1 90000 -',        // over a day, Chrome unknown: stopped
  '206 1 90000 9602',     // over a day, Chrome alive: stopped (the engine starts one again on the next call)
  '207 4242 99999 35819', // still has a parent: never touched
 ].join('\n')+'\n');
 const r=sh(`harness_orphans '22 4400 9602' < '${d}/h.txt'`,d);
 assert.deepEqual(r.out.split('\n'),['201','205','206'],r.err);
 assert.equal(sh(`harness_orphans '' < /dev/null`,d).out,'')});

test('the fixer\'s own user (CR-7): asked with "on", its firewall allows one connection (the app) and refuses the rest',()=>{
 const d=tmp();
 assert.equal(sh('fixer_wanted; echo $?',d).out,'1','nothing asked yet');
 writeFileSync(d+'/.aqeelos-agent-users.reset','');writeFileSync(d+'/.aqeelos-fixer-user','off\n');assert.equal(sh('fixer_wanted; echo $?',d).out,'1');
 writeFileSync(d+'/.aqeelos-fixer-user','on\n');assert.equal(sh('fixer_wanted; echo $?',d).out,'0');
 // a stand-in iptables that records what it is told; -C (is the rule there?) says no, so every rule is added
 const log=d+'/ipt.log';
 const out=sh(`id(){ return 0; }; iptables(){ echo "$*" >> '${log}'; case "$1" in -C) return 1;; *) return 0;; esac; }; fixer_fw; echo rc=$?`,d);
 assert.match(out.out,/rc=0/,out.err);
 const calls=readFileSync(log,'utf8');
 assert.match(calls,/-A AQ-FIXER -o lo -p tcp --dport 4400 -j RETURN/);assert.match(calls,/-A AQ-FIXER -j REJECT/);
 assert.match(calls,/-I OUTPUT 1 -m owner --uid-owner aq-fixer -j AQ-FIXER/);
 assert.ok(calls.indexOf('-A AQ-FIXER -o lo')<calls.indexOf('-A AQ-FIXER -j REJECT'),'the allowed connection comes before the refusal');
 // no iptables: not applied, one issue filed for the person
 const r=sh(`id(){ return 0; }; command(){ [ "$1" = -v ] && [ "$2" = iptables ] && return 1; builtin command "$@"; }; fixer_fw; echo rc=$?`,d);
 assert.match(r.out,/rc=1/);assert.match(readFileSync(d+'/.aqeelos-agent-issues.jsonl','utf8'),/fixer-firewall/)});

test('the fixer\'s user is listed to pass through the owner\'s home only when asked for',()=>{
 const src=readFileSync(SCRIPT,'utf8');
 assert.match(src,/Match User ag-\*,aq-fixer/);assert.match(src,/AllowUsers claude ag-\* aq-fixer/);assert.match(src,/fixer_wanted; then uid=/)});
