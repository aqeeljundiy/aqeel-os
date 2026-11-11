// The root script's decisions (scripts/agent-users.sh), run in bash with the script sourced as a library
// (AQ_AGENT_USERS_LIB=1: functions only, nothing started): OPS-3 restart back-off and OPS-5 janitor counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
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
 assert.equal(sh('chrome_port 9602 30',d).out,'19602');assert.equal(sh('chrome_port 9602 0',d).out,'9602')});

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
