// OPS-18 (12 Nov 2026): the root script's uploads fix and its sweep of leftover processes (scratch Postgres servers, Next.js
// servers, staging copies of aqeelOS). Run in bash with the script sourced as a library, like agent-users.test.mjs; the
// real evidence is Elkiya's process list of 11 Nov (5 scratch Postgres up to 2 days, next-server 16 to 18 days, a 5-day-old
// staging copy).
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT=path.join(path.dirname(fileURLToPath(import.meta.url)),'agent-users.sh').split(path.sep).join('/');
function sh(body,dir){
 const r=spawnSync('bash',['-c',`export AQ_AGENT_USERS_LIB=1 AQEELOS_HOME='${dir}' AQ_RESTARTS='${dir}/rst' AQ_SEEN='${dir}/seen' AQ_ORPHANS='${dir}/orph' AQ_TMP='${dir}/tmp'; source '${SCRIPT}'; ${body}`],{encoding:'utf8'});
 return {code:r.status,out:(r.stdout||'').trim(),err:r.stderr}}
const tmp=()=>mkdtempSync(path.join(tmpdir(),'aq-orph-')).split(path.sep).join('/');

const PS=[
 '133411 1 claude 85000 /home/claude/.hermes/home/.hermes/cache/scratch/pg/x/package/native/bin/postgres -D /home/claude/.hermes/cache/scratch/trklog-pg -p 55497 -k /tmp -c listen_addresses=127.0.0.1',
 '133412 133411 claude 85000 postgres: io worker 0',
 '133415 133411 claude 85000 postgres: checkpointer ',
 '193750 193734 claude 83000 /home/claude/workspaces/default/continue-labs/node_modules/.pnpm/postgres -D /home/claude/.hermes/home/.hermes/cache/scratch/labtest/pgdata -p 54399',
 '1020365 1 claude 1540000 next-server (v16.3.3)',
 '1006877 1 claude 60000 next-server (v15.5.26)',
 '3131226 3023529 claude 480000 node --env-file=/home/claude/.hermes/.env --env-file=/home/claude/apps/hermes-ui-staging.env /home/claude/apps/hermes-ui-staging/app/server.mjs',
 '3061062 3061037 claude 60 node --env-file=/home/claude/.hermes/.env --env-file=/tmp/ppl/env /tmp/aq-stage/app/server.mjs',
 '3061070 1 claude 70 node /home/claude/apps/hermes-ui/app/server.mjs',
 '777 1 www-data 99999 next-server (v16.3.3)',
 '778 1 ag-sesa 99999 next-server (v16.3.3)',
 '779 1 claude 99999 /usr/bin/postgres -D /var/lib/postgresql/data',
];

test('what may be a leftover: scratch Postgres, next-server, staging copies; nothing else, nobody else',()=>{
 const d=tmp();writeFileSync(d+'/ps.txt',PS.join('\n')+'\n');
 const r=sh(`orphan_kinds claude < '${d}/ps.txt'`,d);
 assert.deepEqual(r.out.split('\n'),['133411 1 claude 85000 pg','193750 193734 claude 83000 pg','1020365 1 claude 1540000 app','1006877 1 claude 60000 app','3131226 3023529 claude 480000 stage','3061062 3061037 claude 60 check','778 1 ag-sesa 99999 app'],r.err)});

test('ports, clients and Postgres client backends are read from ss and ps lines',()=>{
 const d=tmp();
 writeFileSync(d+'/l.txt','LISTEN 0 511 *:3199 *:* users:(("next-server (v1",pid=1020365,fd=18))\nLISTEN 0 200 127.0.0.1:55432 0.0.0.0:* users:(("postgres",pid=1305553,fd=8))\nLISTEN 0 511 0.0.0.0:4403 0.0.0.0:* users:(("node",pid=3131226,fd=20))\n');
 assert.equal(sh(`orphan_ports 1020365 < '${d}/l.txt'`,d).out,'3199');assert.equal(sh(`orphan_ports 31226 < '${d}/l.txt'`,d).out,'','a pid that only ends the same is not it');
 writeFileSync(d+'/e.txt','0 0 127.0.0.1:3199 127.0.0.1:41234\n0 0 10.0.0.2:22 10.0.0.9:5000\n0 0 [::ffff:10.0.0.2]:3199 [::ffff:192.0.2.4]:6000\n');
 assert.equal(sh(`orphan_clients '3199 3200' < '${d}/e.txt'`,d).out,'2');assert.equal(sh(`orphan_clients '' < '${d}/e.txt'`,d).out,'0');
 writeFileSync(d+'/p.txt',['500 1 claude 100 /x/postgres -D /h/cache/scratch/a','501 500 claude 100 postgres: io worker 0','502 500 claude 100 postgres: checkpointer ','503 500 claude 50 postgres: autovacuum worker db',
  '504 500 claude 20 postgres: postgres postgres 127.0.0.1(51234) idle','505 500 claude 10 postgres: app mydb [local] SELECT','600 1 claude 100 postgres: postgres postgres [local] idle'].join('\n')+'\n');
 assert.equal(sh(`orphan_pg_clients 500 < '${d}/p.txt'`,d).out,'2')});

test('the decision: watched 15 minutes first; folder gone or idle past the limit stops; old with clients is only reported',()=>{
 const d=tmp(),step=(...a)=>sh('orphan_step '+a.join(' '),d).out,H=3600,D=86400;
 // kind age idle watched clients gone [checking]
 assert.equal(step('pg',90*H,90*H,100,0,0),'none','not watched long enough');
 assert.equal(step('pg',90*H,3*H,900,0,0),'stop','scratch Postgres: no client for over 2 h');
 assert.equal(step('pg',90*H,1*H,900,0,0),'none','idle for less than 2 h');
 assert.equal(step('app',20*D,20*D,900,0,0),'stop','a Next.js server idle for over a day (16 to 18 days on Elkiya)');
 assert.equal(step('app',20*D,2*H,900,0,0),'none','a client within the day');
 assert.equal(step('app',20*D,0,900,1,0),'report','old but in use: reported, not stopped');
 assert.equal(step('app',3*D,0,900,1,0),'none','in use and not old');
 assert.equal(step('app',1*H,0,900,1,1),'stop','its folder is gone');
 assert.equal(step('stage',5*D,5*D,900,0,0),'stop','a staging copy idle for 5 days');
 assert.equal(step('check',5*H,5*H,900,0,0,0),'stop','the deploy check\'s test copy 3 h after its last use');
 assert.equal(step('check',5*H,5*H,900,0,0,1),'none','but never while a check holds it')});

test('a report can carry its own title',()=>{const d=tmp();
 sh('report default leftover-app-1 "a process" "Leftover process"; report sesa screen-stopped "x"',d);
 const l=readFileSync(d+'/.aqeelos-agent-issues.jsonl','utf8').trim().split('\n').map(x=>JSON.parse(x));
 assert.equal(l[0].title,'Leftover process');assert.equal(l[0].agent,'default');assert.equal(l[1].title,undefined)});

// the sweep end to end, with ps, ss, date and kill replaced
test('the sweep: watched first, then an idle scratch Postgres gets SIGINT and, still there 2 minutes later, SIGKILL; an old one in use is reported once; busy agents are left',()=>{
 const d=tmp();writeFileSync(d+'/ps.txt',[
  '500 1 claude 100000 /h/postgres -D /home/claude/.hermes/cache/scratch/a-pg -p 5500',
  '600 1 claude 1700000 next-server (v16.3.3)',
  '700 1 ag-busy 1700000 next-server (v16.3.3)'].join('\n')+'\n');
 writeFileSync(d+'/l.txt','LISTEN 0 511 *:3199 *:* users:(("next-server (v1",pid=600,fd=18))\nLISTEN 0 511 *:3200 *:* users:(("next-server (v1",pid=700,fd=18))\n');
 writeFileSync(d+'/e.txt','0 0 127.0.0.1:3199 127.0.0.1:41234\n');
 writeFileSync(d+'/.aqeelos-agent-busy','busy\n');
 const T=2000000000;
 const stubs=`ps(){ case "$*" in *"-eo pid="*) awk -v dt=$((NOW-${T})) '{ $4=$4+dt; print }' '${d}/ps.txt' ;; *) return 1 ;; esac; }   # the processes grow older as time passes
ss(){ case "$*" in *tlnp*) cat '${d}/l.txt' ;; *) cat '${d}/e.txt' ;; esac; }
kill(){ if [ "$1" = -0 ]; then return 0; fi; echo "kill $*" >> '${d}/kills.txt'; return 0; }
date(){ echo $NOW; }
readlink(){ [ "$1" = /proc/700/cwd ] && echo /home/claude/workspaces/busy/app; return 0; }
in_reply(){ [ "$1" = busy ]; }`;
 const sweep=(now)=>sh(`${stubs}; NOW=${now}; orphan_sweep`,d);
 let r=sweep(T);assert.ok(!existsSync(d+'/kills.txt'),'first sight: only watched');
 r=sweep(T+300);assert.ok(!existsSync(d+'/kills.txt'),'5 minutes: still watching');
 r=sweep(T+1000);assert.match(r.out,/stopping leftover pg process 500/);assert.equal(readFileSync(d+'/kills.txt','utf8').trim(),'kill -INT 500','a clean fast shutdown');
 r=sweep(T+1060);assert.equal(readFileSync(d+'/kills.txt','utf8').trim(),'kill -INT 500','not killed before 2 minutes');
 r=sweep(T+1200);assert.equal(readFileSync(d+'/kills.txt','utf8').trim().split('\n').pop(),'kill -KILL 500');
 // 600 has a client and is over a week old: reported once, never stopped; 700's agent is mid-reply: nothing at all
 const issues=readFileSync(d+'/.aqeelos-agent-issues.jsonl','utf8').trim().split('\n').map(x=>JSON.parse(x));
 assert.equal(issues.length,1);assert.equal(issues[0].key,'leftover-app-600');assert.equal(issues[0].title,'Leftover process');
 assert.ok(!readFileSync(d+'/kills.txt','utf8').includes(' 600')&&!readFileSync(d+'/kills.txt','utf8').includes(' 700'));
 assert.ok(readdirSync(d+'/orph').includes('600'),'state kept for the live ones')});

test('the janitor loop runs both every 5 minutes and the script still parses',()=>{
 const src=readFileSync(SCRIPT,'utf8');assert.ok(src.includes('[ $((n % 60)) -eq 0 ] && [ -f "$REQ" ] && { uploads_fix; orphan_sweep; }'));
 assert.equal(spawnSync('bash',['-n',SCRIPT]).status,0)});

test('uploads: files the agents cannot read are made readable; nothing else changes',{skip:process.platform==='win32'&&'no Unix modes on Windows'},()=>{
 const d=tmp();sh('mkdir -p "$AQEELOS_HOME/uploads/sub"; echo x > "$AQEELOS_HOME/uploads/a.pdf"; chmod 600 "$AQEELOS_HOME/uploads/a.pdf"; echo x > "$AQEELOS_HOME/uploads/b.txt"; chmod 664 "$AQEELOS_HOME/uploads/b.txt"; echo x > "$AQEELOS_HOME/uploads/sub/c"; chmod 640 "$AQEELOS_HOME/uploads/sub/c"',d);
 sh('uploads_fix',d);
 assert.equal(sh('stat -c %a "$AQEELOS_HOME/uploads/a.pdf" "$AQEELOS_HOME/uploads/b.txt" "$AQEELOS_HOME/uploads/sub/c"',d).out,'644\n664\n644'.replace(/\n/g,'\n'))});
