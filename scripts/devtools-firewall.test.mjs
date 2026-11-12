// AUD-15 part 2 (13 Nov 2026): every browser debugging port on the box is its own user's (scripts/agent-users.sh: devtools_rules,
// devtools_fw) and scripts/devtools-reach-check.sh, which tries them as each agent's user after a deploy. Runs the real shell
// functions in bash with stand-ins for iptables, ss and id (Linux or macOS).
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,existsSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g,'/');
const AU=HERE+'/agent-users.sh',CHECK=HERE+'/devtools-reach-check.sh';
const skip=process.platform==='win32'?'bash scripts, run on the box':false;
const bash=(body,env={})=>{const r=spawnSync('bash',['-c',body],{encoding:'utf8',env:{...process.env,...env}});return {code:r.status,out:(r.stdout||'').trim(),err:r.stderr||''}};
const lib=(H,body,env)=>bash(`export AQ_AGENT_USERS_LIB=1 AQEELOS_HOME='${H}' AQ_RESTARTS='${H}/rst' AQ_SEEN='${H}/seen' AQEELOS_USER=claude; source '${AU}'; ${body}`,env);

// what listens on a box like the reference one: the box user (1001) runs the app, the engine's Chrome on a random port, agent-browser
// and the AdsPower bridge; the wake proxy (999) holds each agent's outer port; agent a1 (2015) runs its Chrome and its own AdsPower
// (API and a profile's browser on every address); agent a2 (2016) is asleep, and a Chrome of the box user left behind holds its inner port
const SCAN=[
 'L 4400 1001 any node --env-file=/x/.env /x/apps/hermes-ui/app/server.mjs',
 'L 8644 1001 any /x/.hermes/tools/python/bin/python3 -I -c import os',
 'L 9333 1001 lo node /x/apps/hermes-ui/scripts/adspower-bridge.mjs',
 'L 35073 1001 lo /x/.hermes/tools/chromium-1208/chrome-linux64/chrome --remote-debugging-port=0 --no-first-run',
 'L 37185 1001 lo /x/.hermes/tools/agent-browser-0.26.0-linux-x64/bin/agent-browser-linux-x64',
 'L 9600 999 lo node /var/lib/aqeelos/wake-proxy.mjs /var/lib/aqeelos/wake',
 'L 9601 999 lo node /var/lib/aqeelos/wake-proxy.mjs /var/lib/aqeelos/wake',
 'L 19600 2015 lo /opt/aqeelos/chrome/chrome --no-sandbox --remote-debugging-address=127.0.0.1 --remote-debugging-port=19600',
 'L 50325 2015 any /x/workspaces/.aqeelos-adspower/adspower_global --no-sandbox --api-port=50325',
 'L 20408 2015 any /x/workspaces/.aqeelos-adspower/SunBrowser --remote-debugging-port=20408',
 'L 19601 1001 lo /opt/aqeelos/chrome/chrome --remote-debugging-port=19601 --user-data-dir=/tmp/aq-users-x/a1/.browser',
 'L 5555 2015 lo python3 -m http.server 5555'];
const AGENTS=['A a1 9600 19600 2015','A a2 9601 19601 2016'];
const R=(port,...ok)=>`OUT -p tcp --dport ${port} -m owner ! --uid-owner 0 -m owner ! --uid-owner 1001${ok.map(u=>' -m owner ! --uid-owner '+u).join('')} -j REJECT --reject-with tcp-reset`;

test('the rules: each debugging port is its own user\'s (and root\'s and the box user\'s); nothing else on the box is touched',{skip},()=>{
 const H=mkdtempSync(path.join(tmpdir(),'aq-dt-'));writeFileSync(H+'/in',[...SCAN,...AGENTS].join('\n')+'\n');
 const r=lib(H,`devtools_rules 1001 999 < '${H}/in'`);assert.equal(r.code,0,r.err);
 assert.deepEqual(r.out.split('\n'),[
  R(9333),                       // the AdsPower bridge: the engine only
  R(9600,999,2015),              // a1's own address: a1 (and the proxy that holds it)
  R(9601,2016),                  // a2's own address while it sleeps: a2 only
  R(19600,999,2015),             // a1's Chrome: a1 and the wake proxy
  R(19601),                      // a2's Chrome port, held by the box user's leftover: nobody else (not a2, not the proxy)
  'SQUAT 19601 a2 1001',
  R(20408,2015),'IN -p tcp --dport 20408 -j REJECT --reject-with tcp-reset',   // a1's AdsPower browser: a1, and never from outside
  R(35073),R(37185),             // the engine's Chrome and agent-browser: the box user only
  R(50325,2015),'IN -p tcp --dport 50325 -j REJECT --reject-with tcp-reset']);
 assert.doesNotMatch(r.out,/--dport (4400|8644|5555) /,'the app, the webhooks and what an agent runs for itself are not debugging ports');
 // no agent is ever let into another agent's port
 for(const l of r.out.split('\n').filter(x=>/--dport (9601|19601) /.test(x)))assert.doesNotMatch(l,/2015/);
 for(const l of r.out.split('\n').filter(x=>/--dport (9600|19600|20408|50325) /.test(x)))assert.doesNotMatch(l,/2016/);
 // the same input in another order gives the same rules (so an unchanged box changes nothing)
 writeFileSync(H+'/in2',[...SCAN,...AGENTS].reverse().join('\n')+'\n');assert.equal(lib(H,`devtools_rules 1001 999 < '${H}/in2'`).out,r.out);
 // whatever listens on an agent's port counts, even a plain program and even when its line comes first: another agent's server on
 // a3's address while a3 sleeps: no other agent gets in, and it is reported (Health: "Browser port taken")
 writeFileSync(H+'/in3','L 9602 2016 lo python3 -m http.server 9602\nA a3 9602 19602 2017\n');
 assert.deepEqual(lib(H,`devtools_rules 1001 999 < '${H}/in3'`).out.split('\n'),[R(9602,2016),'SQUAT 9602 a3 2016',R(19602,999,2017)]);
 // no wake proxy user on the box: the inner port is the agent's alone
 assert.match(lib(H,`printf 'A a3 9602 19602 2017\\n' | devtools_rules 1001 -`).out,/^OUT -p tcp --dport 9602 .* ! --uid-owner 2017 -j REJECT.*\nOUT -p tcp --dport 19602 -m owner ! --uid-owner 0 -m owner ! --uid-owner 1001 -m owner ! --uid-owner 2017 -j REJECT/)});

// a stand-in iptables: one file of rules per tool; -C finds a line, -A appends, -I puts first, -D removes one, -N makes nothing
function box({broken=false}={}){const H=mkdtempSync(path.join(tmpdir(),'aq-dtfw-')).replace(/\\/g,'/'),bin=H+'/bin';mkdirSync(bin);
 const ipt=`#!/bin/bash\nR=${H}/rules.$(basename "$0"); touch "$R"\nop=$1; shift\necho "$(basename "$0") $op $*" >> ${H}/calls\ncase "$op" in\n -C) grep -qxF -- "$*" "$R" ;;\n -N) exit 0 ;;\n -A) ${broken?'exit 1':'echo "$*" >> "$R"'} ;;\n -I) ${broken?'exit 1':'c=$1; shift; shift; { echo "$c $*"; cat "$R"; } > "$R.t"; mv "$R.t" "$R"'} ;;\n -D) grep -qxF -- "$*" "$R" || exit 1; awk -v l="$*" 'd || $0!=l {print; next} {d=1}' "$R" > "$R.t"; mv "$R.t" "$R" ;;\nesac\n`;
 for(const n of ['iptables','ip6tables']){writeFileSync(bin+'/'+n,ipt);chmodSync(bin+'/'+n,0o755)}
 writeFileSync(bin+'/ss','#!/bin/bash\nexit 0\n');chmodSync(bin+'/ss',0o755);
 writeFileSync(H+'/.aqeelos-agent-ports','a1 40 9600\na2 41 9601\n');writeFileSync(H+'/scan',SCAN.map(l=>l.slice(2)).join('\n')+'\n');
 // id: the box user is 1001, the wake proxy 999, ag-a1 2015, ag-a2 2016
 const stubs=`id(){ case "$*" in "-u claude") echo 1001;; "-u aq-wake") echo 999;; "-u ag-a1") echo 2015;; "-u ag-a2") echo 2016;; *) return 1;; esac; }; devtools_scan(){ cat '${H}/scan'; }; `;
 const run=body=>lib(H,stubs+body,{PATH:bin+':'+process.env.PATH});
 const rules=(t='iptables')=>existsSync(`${H}/rules.${t}`)?readFileSync(`${H}/rules.${t}`,'utf8').trim().split('\n').filter(Boolean):[];
 const calls=()=>existsSync(H+'/calls')?readFileSync(H+'/calls','utf8').trim().split('\n'):[];
 return {H,run,rules,calls}}

test('devtools_fw puts them in place on both tools, changes nothing when nothing changed, and never opens a port while changing',{skip},()=>{
 const b=box();let r=b.run('devtools_fw; echo rc=$?');assert.match(r.out,/rc=0/,r.out+r.err);
 const v4=b.rules();assert.ok(v4.includes('OUTPUT -o lo -p tcp -j AQ-DEVTOOLS'));assert.ok(v4.includes('INPUT ! -i lo -p tcp -j AQ-DEVIN'));
 assert.ok(v4.includes('AQ-DEVTOOLS '+R(35073).slice(4)),'the engine\'s Chrome');assert.ok(v4.includes('AQ-DEVIN -p tcp --dport 50325 -j REJECT --reject-with tcp-reset'));
 assert.equal(v4.filter(l=>l.startsWith('AQ-DEVTOOLS ')).length,9);assert.deepEqual(b.rules('ip6tables').filter(l=>l.startsWith('AQ-')),v4.filter(l=>l.startsWith('AQ-')),'the same for ::1');
 // a port taken from an agent is said once, on the agent's Health line
 const issues=()=>existsSync(b.H+'/.aqeelos-agent-issues.jsonl')?readFileSync(b.H+'/.aqeelos-agent-issues.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l)):[];
 assert.deepEqual(issues().map(i=>[i.agent,i.key]),[['a2','devtools-port-taken']]);
 // again, nothing changed: no iptables call at all
 const n=b.calls().length;b.run('devtools_fw');assert.equal(b.calls().length,n);assert.equal(issues().length,1,'said once');
 // the engine's Chrome ends and a new one starts on another port: the new rule is added BEFORE the old one goes
 writeFileSync(b.H+'/scan',SCAN.map(l=>l.slice(2)).filter(l=>!l.startsWith('35073 ')).concat('41999 1001 lo /x/chrome --remote-debugging-port=0').join('\n')+'\n');
 const before=b.calls().length;b.run('devtools_fw');const c=b.calls().slice(before).filter(l=>l.startsWith('iptables '));
 const add=c.findIndex(l=>/^iptables -A AQ-DEVTOOLS .*--dport 41999 /.test(l)),del=c.findIndex(l=>/^iptables -D AQ-DEVTOOLS .*--dport 35073 /.test(l));
 assert.ok(add>=0&&del>add,'added first, then removed: '+c.join(' | '));
 assert.ok(!b.rules().some(l=>/--dport 35073 /.test(l)));assert.ok(b.rules().some(l=>/--dport 41999 /.test(l)));
 // a rule someone removed is back within a minute (the full look); a plain pass trusts what it applied
 const kept=b.rules().filter(l=>!/--dport 37185 /.test(l));writeFileSync(b.H+'/rules.iptables',kept.join('\n')+'\n');
 b.run('devtools_fw');assert.ok(!b.rules().some(l=>/--dport 37185 /.test(l)));
 b.run('devtools_fw full');assert.ok(b.rules().some(l=>/--dport 37185 /.test(l)))});

test('devtools_fw takes over the per-agent rules screen_up used to add, once, and says so when iptables refuses',{skip},()=>{
 const b=box();const old=['OUTPUT -o lo -p tcp --dport 9600 -m owner ! --uid-owner claude -m owner ! --uid-owner ag-a1 -j REJECT','OUTPUT -o lo -p tcp --dport 19600 -m owner ! --uid-owner claude -m owner ! --uid-owner ag-a1 -m owner ! --uid-owner aq-wake -j REJECT'];
 writeFileSync(b.H+'/rules.iptables',old.join('\n')+'\n');b.run('devtools_fw');
 assert.ok(!b.rules().some(l=>old.includes(l)),'the old rules are gone, the chain has them');assert.ok(existsSync(b.H+'/rst/.devtools-legacy-gone'));
 const n=b.calls().filter(l=>/^iptables -D OUTPUT/.test(l)).length;b.run('devtools_fw full');assert.equal(b.calls().filter(l=>/^iptables -D OUTPUT/.test(l)).length,n,'only once');
 const x=box({broken:true});const r=x.run('devtools_fw; echo rc=$?; devtools_fw full >/dev/null');assert.match(r.out,/rc=1/);
 const issues=readFileSync(x.H+'/.aqeelos-agent-issues.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l)).filter(i=>i.key==='devtools-firewall');
 assert.equal(issues.length,1);assert.equal(issues[0].title,'Browser port rules not applied')});

test('the watcher applies them every pass (in full once a minute), at start, and before an agent\'s Chrome starts; screen_up adds no rules of its own',{skip},()=>{
 const s=readFileSync(AU,'utf8');
 assert.match(s,/proxy_up; if \[ \$\(\(n % 12\)\) -eq 0 \]; then devtools_fw full; else devtools_fw; fi;/);
 assert.match(s,/  fixer_step\n  devtools_fw full\n/);
 const up=s.slice(s.indexOf('screen_up(){'),s.indexOf('\nonce(){'));
 assert.doesNotMatch(up,/iptables -I/);assert.ok(up.indexOf('devtools_fw')>0&&up.indexOf('devtools_fw')<up.indexOf('chrome_loop'),'rules first, then Chrome')});

test('the reach check: what each agent\'s user must be refused on, and it parses',{skip},()=>{
 assert.equal(spawnSync('bash',['-n',CHECK]).status,0);
 const H=mkdtempSync(path.join(tmpdir(),'aq-rc-'));writeFileSync(H+'/in',[...SCAN,...AGENTS].join('\n')+'\n');
 const me=userInfo().username;
 const nm=uid=>bash(`export AQ_REACH_LIB=1 AQ_RUNAS=true AQEELOS_USER='${me}' AQ_RESTARTS='${H}/rst'; source '${CHECK}'; not_mine ${uid} 999 < '${H}/in'`).out.split('\n').map(l=>Number(l.split(' ')[0]));
 assert.deepEqual(nm(2015),[9333,9601,19601,35073,37185],'a1 tries everything but its own Chrome, address and AdsPower');
 assert.deepEqual(nm(2016),[9333,9600,19600,19601,20408,35073,37185,50325],'a2 tries a1\'s ports, and its own inner port held by someone else');
 const s=readFileSync(CHECK,'utf8');
 assert.match(s,/exec 3<>\/dev\/tcp\/127\.0\.0\.1\/\$2/,'a connect only, nothing sent');assert.match(s,/test -w "\$s"/,'a screen socket is never connected to');
 assert.match(s,/still reaches the app on \$APP_PORT/);assert.match(s,/\[ "\$fail" = 0 \]\n?$/)});
