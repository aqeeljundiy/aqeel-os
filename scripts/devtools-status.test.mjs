// AUD-15 part 3 (13 Nov 2026): after the first deploy of the browser port rules an agent's user still reached the AdsPower bridge
// (9333) and nobody could see why, as the box user cannot read iptables. Root in the ai-box container has no CAP_SYS_PTRACE, so
// ss -p as root named no process for another user's socket and devtools_scan dropped every such line. Here: the scan that looks
// such a listener up as its own user, the status file the root script writes each full pass (~/.aqeelos-devtools-fw.json), the
// Health items read from it (app/agent-health.mjs fwProblems), and scripts/devtools-reach-check.sh without root (over SSH with
// the agents key). Real shell functions in bash with stand-ins for ss, iptables, id, getent and ssh (Linux or macOS).
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir,userInfo} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fwProblems,FW_STATUS} from '../app/agent-health.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g,'/');
const AU=HERE+'/agent-users.sh',CHECK=HERE+'/devtools-reach-check.sh';
const skip=process.platform==='win32'?'bash scripts, run on the box':false;
const bash=(body,env={})=>{const r=spawnSync('bash',['-c',body],{encoding:'utf8',env:{...process.env,...env}});return {code:r.status,out:(r.stdout||'').trim(),err:r.stderr||''}};
const tmp=p=>mkdtempSync(path.join(tmpdir(),p)).replace(/\\/g,'/');
const lib=(H,body,env)=>bash(`export AQ_AGENT_USERS_LIB=1 AQEELOS_HOME='${H}' AQ_RESTARTS='${H}/rst' AQ_SEEN='${H}/seen' AQEELOS_USER=claude; source '${AU}'; ${body}`,env);
const exe=(f,body)=>{writeFileSync(f,body);chmodSync(f,0o755)};
const R=(port,...ok)=>`OUT -p tcp --dport ${port} -m owner ! --uid-owner 0 -m owner ! --uid-owner 1001${ok.map(u=>' -m owner ! --uid-owner '+u).join('')} -j REJECT --reject-with tcp-reset`;

// ss as each user sees it on the box (iproute2 6.1, as in the ai-box): root names only its own process (sshd); the box user (1001)
// its own (the bridge), and it lies about a socket of a1's; a1 (2015) its AdsPower and Chrome; a2's listener (2016) has a process
// nobody may look into; the wake proxy's user (999) answers nothing
const SS={
 root:['LISTEN 0 511 127.0.0.1:9333 0.0.0.0:* uid:1001 ino:111 sk:1 cgroup:/ <->','LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=10,fd=3)) ino:222 sk:2 cgroup:/ <->',
  'LISTEN 0 511 *:50325 *:* uid:2015 ino:333 sk:3 cgroup:/ v6only:0 <->','LISTEN 0 10 127.0.0.1:19600 0.0.0.0:* uid:2015 ino:444 sk:4 cgroup:/ <->',
  'LISTEN 0 511 127.0.0.1:9600 0.0.0.0:* uid:999 ino:555 sk:5 cgroup:/ <->','LISTEN 0 511 127.0.0.1:4471 0.0.0.0:* uid:2016 ino:666 sk:6 cgroup:/ <->'],
 claude:['LISTEN 0 511 127.0.0.1:9333 0.0.0.0:* users:(("node",pid=543,fd=18)) uid:1001 ino:111 sk:1 cgroup:/ <->','LISTEN 0 10 127.0.0.1:19600 0.0.0.0:* users:(("evil",pid=666,fd=1)) uid:1001 ino:444 sk:4 cgroup:/ <->'],
 'ag-a1':['LISTEN 0 511 *:50325 *:* users:(("adspower_global",pid=700,fd=9)) uid:2015 ino:333 sk:3 cgroup:/ v6only:0 <->','LISTEN 0 10 127.0.0.1:19600 0.0.0.0:* users:(("chrome",pid=701,fd=40)) uid:2015 ino:444 sk:4 cgroup:/ <->'],
 'ag-a2':['LISTEN 0 511 127.0.0.1:4471 0.0.0.0:* uid:2016 ino:666 sk:6 cgroup:/ <->']};
const CMD={10:'sshd: /usr/sbin/sshd -D',543:'node /x/apps/hermes-ui/scripts/adspower-bridge.mjs',666:'/x/agent-browser-linux-x64 evil',700:'/x/workspaces/.aqeelos-adspower/adspower_global --api-port=50325',701:'/opt/aqeelos/chrome/chrome --remote-debugging-port=19600'};
function scanBox(){const H=tmp('aq-scan-'),bin=H+'/bin';mkdirSync(bin);
 for(const [who,lines] of Object.entries(SS))writeFileSync(`${H}/ss.${who}`,lines.join('\n')+'\n');
 exe(bin+'/ss',`#!/bin/bash\n[ "\${WHO:-root}" = aq-wake ] && exit 1\ncat "${H}/ss.\${WHO:-root}" 2>/dev/null\n`);
 const stubs=`getent(){ case "$2" in 1001) echo claude:x:1001:1001::/h:/bin/bash;; 2015) echo ag-a1:x:2015:2015::/w:/bin/bash;; 2016) echo ag-a2:x:2016:2016::/w:/bin/bash;; 999) echo aq-wake:x:999:999::/:/usr/sbin/nologin;; esac; }
  devtools_cmd(){ case "$1" in ${Object.entries(CMD).map(([p,c])=>`${p}) echo '${c}';;`).join(' ')} esac; }
  fake_as(){ local u=$1; shift; echo "$u" >> '${H}/asked'; WHO=$u "$@"; }; export AQ_AS=fake_as; `;
 const asked=()=>existsSync(H+'/asked')?readFileSync(H+'/asked','utf8').trim().split('\n'):[];
 return {H,asked,run:body=>lib(H,stubs+body,{PATH:bin+':'+process.env.PATH})}}

test('the scan names a listener root cannot place by asking its own user, takes only that user\'s sockets from the answer, and keeps what it found',{skip},()=>{
 const b=scanBox();let r=b.run('devtools_scan full');assert.equal(r.code,0,r.err);
 assert.deepEqual(r.out.split('\n').sort(),['19600 2015 lo /opt/aqeelos/chrome/chrome --remote-debugging-port=19600','22 0 any sshd: /usr/sbin/sshd -D','4471 2016 lo',
  '50325 2015 any /x/workspaces/.aqeelos-adspower/adspower_global --api-port=50325','9333 1001 lo node /x/apps/hermes-ui/scripts/adspower-bridge.mjs','9600 999 lo']);
 assert.deepEqual(b.asked(),['aq-wake','claude','ag-a1','ag-a2'],'each user whose socket root could not place, once; never root');
 assert.doesNotMatch(r.out,/evil/,'the box user\'s answer about a1\'s socket is not taken');
 // the bridge now gets its rule (it got none on the boxes: its line was dropped)
 const rules=b.run(`devtools_scan | sed 's/^/L /' | devtools_rules 1001 999`).out.split('\n');
 assert.ok(rules.includes(R(9333)),rules.join('\n'));assert.ok(rules.includes(R(50325,2015)));assert.ok(rules.includes('IN -p tcp --dport 50325 -j REJECT --reject-with tcp-reset'));
 // a plain pass (every 5 s) asks nobody about a socket it asked about before (found or not); a full pass (every minute) asks again
 writeFileSync(b.H+'/asked','');r=b.run('devtools_scan');assert.match(r.out,/^9333 1001 lo node .*adspower-bridge/m);assert.match(r.out,/^4471 2016 lo$/m);
 assert.deepEqual(b.asked().filter(Boolean),[],'kept by inode');
 writeFileSync(b.H+'/asked','');b.run('devtools_scan full');assert.deepEqual(b.asked().filter(Boolean),['aq-wake','claude','ag-a1','ag-a2']);
 // a new socket on the same port (another inode) is looked up again, never given the old one's program
 writeFileSync(b.H+'/ss.root',SS.root.map(l=>l.replace('ino:111','ino:999')).join('\n')+'\n');writeFileSync(b.H+'/ss.claude','');
 writeFileSync(b.H+'/asked','');assert.match(b.run('devtools_scan').out,/^9333 1001 lo$/m);assert.deepEqual(b.asked().filter(Boolean),['claude'])});

// a stand-in iptables that answers like the real one (nf_tables 1.8.10): -C on a rule that is not there says "Bad rule", -S lists
// a chain, --version. owner=false: the owner match does not load (any rule with -m owner is refused, as without xt_owner)
function fwBox({owner=true,user='claude'}={}){const H=tmp('aq-fws-'),bin=H+'/bin';mkdirSync(bin);
 const ipt=`#!/bin/bash
R=${H}/rules.$(basename "$0"); touch "$R"; op=$1; shift
echo "$(basename "$0") $op $*" >> ${H}/calls
${owner?'':`case " $* " in *" -m owner "*) echo "Warning: Extension owner revision 0 not supported, missing kernel module?" >&2; echo "$(basename "$0") v1.8.10 (nf_tables): Couldn't load match \\\`owner':No such file or directory" >&2; exit 2;; esac`}
case "$op" in
 --version) echo "$(basename "$0") v1.8.10 (nf_tables)" ;;
 -C) grep -qxF -- "$*" "$R" || { echo "$(basename "$0"): Bad rule (does a matching rule exist in that chain?)." >&2; exit 1; } ;;
 -N) exit 0 ;;
 -S) grep -- "^$1 " "$R" | sed 's/^/-A /' ;;
 -A) echo "$*" >> "$R" ;;
 -I) c=$1; shift; shift; { echo "$c $*"; cat "$R"; } > "$R.t"; mv "$R.t" "$R" ;;
 -D) grep -qxF -- "$*" "$R" || exit 1; grep -vxF -- "$*" "$R" > "$R.t"; mv "$R.t" "$R" ;;
esac
`;
 for(const n of ['iptables','ip6tables'])exe(bin+'/'+n,ipt);exe(bin+'/ss','#!/bin/bash\nexit 0\n');
 writeFileSync(H+'/.aqeelos-agent-ports','a1 40 9600\n');
 writeFileSync(H+'/scan',['9333 1001 lo node /x/apps/hermes-ui/scripts/adspower-bridge.mjs','19600 2015 lo /opt/aqeelos/chrome/chrome --remote-debugging-port=19600','4471 2016 lo','22 0 any sshd: /usr/sbin/sshd -D'].join('\n')+'\n');
 const stubs=`id(){ case "$*" in "-u claude") echo 1001;; "-u aq-wake") echo 999;; "-u ag-a1") echo 2015;; *) return 1;; esac; }; devtools_scan(){ cat '${H}/scan'; }; OWNER=${user}; `;
 const run=body=>lib(H,stubs+body,{PATH:bin+':'+process.env.PATH});
 const status=()=>JSON.parse(readFileSync(H+'/'+FW_STATUS,'utf8'));
 const issues=()=>existsSync(H+'/.aqeelos-agent-issues.jsonl')?readFileSync(H+'/.aqeelos-agent-issues.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l)):[];
 return {H,run,status,issues}}
const SUM=createHash('sha256').update(readFileSync(AU)).digest('hex');

test('the status file: what was wanted, what is there, the running copy\'s sum, the listeners nobody could see; written on full passes only',{skip},()=>{
 const b=fwBox();let r=b.run('devtools_fw; echo rc=$?');assert.match(r.out,/rc=0/,r.out+r.err);
 assert.equal(existsSync(b.H+'/'+FW_STATUS),false,'a plain pass (every 5 s) writes nothing');
 r=b.run('devtools_fw full; echo rc=$?');assert.match(r.out,/rc=0/,r.out+r.err);
 const s=b.status();const now=Date.now()/1000;assert.ok(Math.abs(s.at-now)<60);
 assert.equal(s.script,SUM,'the sum of the copy that runs');assert.equal(s.ok,true);assert.equal(s.why,'');assert.deepEqual(s.errors,[]);
 assert.equal(s.listeners,4);assert.deepEqual(s.unseen,['4471 2016 lo'],'not root\'s, no program: said');
 const t=s.tools.iptables;assert.equal(t.installed,true);assert.equal(t.version,'iptables v1.8.10 (nf_tables)');assert.equal(t.owner,'yes');assert.equal(t.hooked,true);
 assert.ok(t.wanted.includes(R(9333)),'the bridge is wanted');assert.deepEqual(t.missing,[]);
 assert.ok(t.present.includes('-A AQ-DEVTOOLS '+R(9333).slice(4)),'iptables -S of the chain');assert.equal(t.wanted.length,t.present.length);
 assert.deepEqual(s.tools.ip6tables.wanted,t.wanted);
 assert.doesNotMatch(JSON.stringify(s),/adspower-bridge|chrome|sshd/,'rules and ports only, no command lines');
 // Health: the rules are in place; only the listener nobody could see is shown
 assert.deepEqual(fwProblems(s,{appSum:SUM,appMtime:0}).map(x=>x.topic),['health|aqeelos|devtools|unseen']);
 assert.deepEqual(fwProblems({...s,unseen:[]},{appSum:SUM,appMtime:0}),[]);
 // a rule someone removed: the full pass puts it back, the status says what is there
 writeFileSync(b.H+'/rules.iptables',readFileSync(b.H+'/rules.iptables','utf8').split('\n').filter(l=>!/--dport 9333 /.test(l)).join('\n'));
 b.run('devtools_fw full');assert.ok(b.status().tools.iptables.present.some(l=>/--dport 9333 /.test(l)));assert.equal(b.status().ok,true)});

test('fails loudly: no owner match means every refused command with its error, the rules missing, one issue, and a Health item',{skip},()=>{
 const b=fwBox({owner:false});const r=b.run('devtools_fw full; echo rc=$?');assert.match(r.out,/rc=1/);assert.match(r.out,/BROWSER PORT RULES NOT APPLIED: iptables refused them: iptables -A AQ-DEVTOOLS .*Couldn't load match/);
 const s=b.status(),t=s.tools.iptables;assert.equal(s.ok,false);
 assert.match(t.owner,/^no: .*Couldn't load match .owner/,'the probe says why');
 assert.equal(t.missing.length,t.wanted.length);assert.ok(t.wanted.length>0);assert.deepEqual(t.present,[]);assert.equal(t.hooked,true,'the jumps need no owner match');
 assert.ok(s.errors.length>0&&s.errors.length<=20);assert.match(s.errors[0],/^iptables -A AQ-DEVTOOLS -p tcp --dport \d+ -m owner .*: .*Couldn't load match/);
 b.run('devtools_fw full; devtools_fw');const iss=b.issues().filter(i=>i.key==='devtools-firewall');
 assert.equal(iss.length,1,'one issue while it lasts');assert.match(iss[0].what,/Couldn't load match/);assert.equal(iss[0].title,'Browser port rules not applied');
 const h=fwProblems(b.status(),{appSum:SUM});assert.deepEqual(h.map(x=>x.topic),['health|aqeelos|devtools|rules','health|aqeelos|devtools|unseen']);
 assert.equal(h[0].text,'Browser port rules not in place');assert.match(h[0].detail,/wanted rules missing, e\.g\. iptables OUT -p tcp --dport/);assert.match(h[0].detail,/owner match: iptables no: /);assert.match(h[0].detail,/refused: iptables -A AQ-DEVTOOLS/);
 // no box user: said in the status (it used to return "fine" without a word)
 const c=fwBox({user:'nobody-here'});assert.match(c.run('devtools_fw full; echo rc=$?').out,/rc=1/);
 assert.equal(c.status().ok,false);assert.equal(c.status().why,'there is no user nobody-here on the box');
 assert.equal(c.issues().filter(i=>i.key==='devtools-firewall').length,1)});

test('Health from the status: nothing without a file, a status that stopped, rules not in place, unseen listeners, a stale running copy',()=>{
 const now=Date.UTC(2026,10,13,8),at=now/1000,A='a'.repeat(64),B='b'.repeat(64);
 const good={at,script:A,ok:true,why:'',tools:{iptables:{installed:true,version:'v',owner:'yes',hooked:true,wanted:['OUT x'],missing:[],present:['-A AQ-DEVTOOLS x']},ip6tables:{installed:false}},errors:[],listeners:9,unseen:[]};
 for(const s of [null,undefined,'x',{},{at:'soon'}])assert.deepEqual(fwProblems(s,{now}),[]);
 assert.deepEqual(fwProblems(good,{now,appSum:A,appMtime:now-3600e3}),[]);
 assert.deepEqual(fwProblems({...good,at:at-11*60},{now}).map(x=>x.topic),['health|aqeelos|devtools|stale']);assert.deepEqual(fwProblems({...good,at:at-9*60},{now}),[]);
 const top=s=>fwProblems(s,{now}).map(x=>x.topic);
 assert.deepEqual(top({...good,ok:false}),['health|aqeelos|devtools|rules']);
 assert.deepEqual(top({...good,why:'iptables is not installed in the box',ok:false,tools:{}}),['health|aqeelos|devtools|rules']);
 assert.deepEqual(top({...good,tools:{ip6tables:{installed:true,owner:'yes',hooked:false,missing:[]}}}),['health|aqeelos|devtools|rules'],'IPv6 counts: a port on every address is reached on ::1 too');
 assert.deepEqual(top({...good,tools:{iptables:{...good.tools.iptables,missing:['OUT a','OUT b']}}}),['health|aqeelos|devtools|rules']);
 assert.match(fwProblems({...good,errors:['iptables -A AQ-DEVTOOLS y: refused']},{now})[0].detail,/refused: iptables -A AQ-DEVTOOLS y: refused/);
 assert.deepEqual(top({...good,unseen:['4471 2016 lo']}),['health|aqeelos|devtools|unseen']);
 // the running copy: other than the deployed one well after the deploy (2 minutes: the watcher takes 5 s, its first full pass is at once)
 assert.deepEqual(fwProblems({...good,script:B},{now,appSum:A,appMtime:now-30e3}),[],'just deployed: the watcher has not had its turn');
 assert.deepEqual(fwProblems({...good,script:B},{now,appSum:A,appMtime:now-10*60e3}).map(x=>x.topic),['health|aqeelos|devtools|script']);
 assert.deepEqual(fwProblems({...good,script:B},{now}),[],'no deployed copy known: nothing to compare')});

test('the reach check without root: over SSH as one agent user with the agents key, the command intact, and it says so when it cannot',{skip},()=>{
 const H=tmp('aq-rcnr-'),bin=H+'/bin';mkdirSync(bin);const me=userInfo().username;writeFileSync(H+'/key','not a real key\n');
 const src=`export AQ_REACH_LIB=1 AQEELOS_USER='${me}' AQ_RESTARTS='${H}/rst' AQ_AGENT_KEY='${H}/key'; source '${CHECK}'; `;
 if(process.getuid?.()!==0){
  const r=bash(src+`echo "noroot=$NOROOT runas=$AQ_RUNAS as=$AQ_AS"`);assert.equal(r.out,'noroot=1 runas=as_ssh as=as_ssh',r.err);
  // no key: it cannot run, and says how it can
  const n=bash(`AQ_AGENT_KEY='${H}/none' bash '${CHECK}'`);assert.equal(n.code,2);assert.match(n.out,/run as root, or as the box user with the agents key/)}
 const users='ag-a1:2015\nag-sesa:2004\nag-b:2020';
 const pick=w=>bash(src+`pick_user '${w}' $'${users.replace(/\n/g,'\\n')}'`).out;
 assert.equal(pick(''),'ag-a1:2015');assert.equal(pick('sesa'),'ag-sesa:2004');assert.equal(pick('ag-b'),'ag-b:2020');assert.equal(pick('nobody'),'');
 // a stand-in ssh: notes its words, then runs the command it was given here (as the login shell would on the box)
 exe(bin+'/ssh',`#!/bin/bash\nprintf '%s\\n' "$@" > '${H}/ssh.args'\nfor a; do last=$a; done\neval "$last"\n`);
 const r=bash(src+`AQ_RUNAS=as_ssh; runas ag-a1 printf '%s|' 'a b' '$HOME' "it's" '$(touch ${H}/oops)' $'two\\nlines'`,{PATH:bin+':'+process.env.PATH});
 assert.equal(r.out,`a b|$HOME|it's|$(touch ${H}/oops)|two\nlines|`,'every word reaches the agent\'s user as it was: '+r.err);assert.equal(existsSync(H+'/oops'),false);
 const a=readFileSync(H+'/ssh.args','utf8').split('\n');
 assert.ok(a.includes('-n'),'stdin stays here (the check reads its port list from it)');assert.equal(a[a.indexOf('-i')+1],H+'/key');assert.ok(a.includes('BatchMode=yes'));assert.ok(a.includes('ag-a1@127.0.0.1'));
 // the box user's own command runs here, without SSH
 assert.equal(bash(src+`as_ssh '${me}' echo here`,{PATH:bin+':'+process.env.PATH}).out,'here');
 // the listeners nobody could name are said, not tried
 const s=readFileSync(CHECK,'utf8');assert.match(s,/NOTE  port \$port \(\$sc\) of user \$uid: its program could not be seen/);assert.match(s,/devtools_scan full/)});
