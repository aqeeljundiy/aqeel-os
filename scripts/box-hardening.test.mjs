// Box-side findings of the 12 Nov 2026 audits, run for real in a fake home with stand-in commands (Linux or Git Bash):
//  CR-5 logs in a private folder, M16 a changed session command reaches a running session (scripts/services.sh)
//  H9 the test copy's folder is private (scripts/box-check.sh, fixer-testcopy.sh, test-people.sh)
//  CR-6 / H-10 / H-12 the local firewall and VNC on the socket only (scripts/agent-users.sh)
//  L5 auto-update gives a version up only after a real failure; M18 a patch that does not fit is said and counted
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g,'/');
const read=f=>readFileSync(path.join(HERE,f),'utf8');
const tmp=n=>mkdtempSync(path.join(tmpdir(),n)).replace(/\\/g,'/');
const posix=process.platform!=='win32';
const mode=f=>(statSync(f).mode&0o777).toString(8);
const bash=(body,env={})=>{const r=spawnSync('bash',['-c',body],{encoding:'utf8',env:{...process.env,...env}});return {code:r.status,out:(r.stdout||'').trim(),err:r.stderr||''}};

// ---------- services.sh ----------
const SV=read('services.sh');
const svHead=SV.slice(SV.indexOf('\numask 077'),SV.indexOf('# a value from a "name=value" file'));
function svBox(){const H=tmp('sv-'),bin=H+'/bin';mkdirSync(bin);mkdirSync(H+'/sessions');
 // tmux stand-in: a session is a file; new-session records its command
 writeFileSync(bin+'/tmux',`#!/bin/bash\nS=${H}/sessions\ncase "$1" in\n has-session) n=\${3#=}; [ -e "$S/$n" ] ;;\n kill-session) n=\${3#=}; rm -f "$S/$n"; echo "kill $n" >> ${H}/calls ;;\n new-session) printf '%s' "$5" > "$S/$4"; echo "new $4" >> ${H}/calls ;;\nesac\n`);chmodSync(bin+'/tmux',0o755);
 return {H,run:body=>bash(svHead+'\n'+body,{HOME:H,PATH:bin+path.delimiter+process.env.PATH})}}

test('CR-5: every session logs into ~/logs/aqeelos, a folder and files only the box user can read; nothing is written to /tmp',()=>{
 assert.equal(/tee -a \/tmp\//.test(SV),false);assert.match(SV,/^umask 077$/m);
 const b=svBox();const r=b.run('start gateway "hermes gateway"; start ui "node server.mjs"');assert.equal(r.code,0,r.err);
 const L=b.H+'/logs/aqeelos';assert.ok(existsSync(L+'/gateway.log')&&existsSync(L+'/ui.log'));
 assert.match(readFileSync(b.H+'/sessions/gateway','utf8'),new RegExp("^umask 077; cd ~; hermes gateway 2>&1 \\| tee -a '"+L+"/gateway.log'$"));
 if(posix){assert.equal(mode(L),'700');assert.equal(mode(b.H+'/logs'),'700');assert.equal(mode(L+'/gateway.log'),'600')}});

test('CR-5: a log over 20 MB keeps its last 2 MB in place (a running session goes on writing to the same file)',()=>{
 const b=svBox();mkdirSync(b.H+'/logs/aqeelos',{recursive:true});writeFileSync(b.H+'/logs/aqeelos/gateway.log',Buffer.concat([Buffer.alloc(21*1024*1024,'a'),Buffer.from('THE-END\n')]));
 const r=b.run(':');assert.equal(r.code,0,r.err);const s=readFileSync(b.H+'/logs/aqeelos/gateway.log','utf8');
 assert.equal(s.length,2097152);assert.ok(s.endsWith('THE-END\n'));assert.ok(existsSync(b.H+'/logs/aqeelos/gateway.log.1'))});

test('M16: a session that may be restarted gets its new command; the engine, the UI and the screen are never restarted by the launcher',()=>{
 const b=svBox();b.run('start nightly "old loop"; start gateway "hermes gateway"; start ui "node a"');
 const r=b.run('start nightly "new loop"; start gateway "hermes gateway --changed"; start ui "node b"; start nightly "new loop"');
 assert.match(r.out,/nightly is started again/);
 assert.match(readFileSync(b.H+'/sessions/nightly','utf8'),/new loop/);assert.match(readFileSync(b.H+'/sessions/gateway','utf8'),/hermes gateway 2>&1/);assert.match(readFileSync(b.H+'/sessions/ui','utf8'),/node a/);
 assert.deepEqual(readFileSync(b.H+'/calls','utf8').trim().split('\n'),['new nightly','new gateway','new ui','kill nightly','new nightly']);
 // a session started before this version (no command on record) is restarted once, when it is one of the safe ones
 const c=svBox();writeFileSync(c.H+'/sessions/nightly','retired');writeFileSync(c.H+'/sessions/gateway','x');c.run('start nightly "loop"; start gateway "g"');
 assert.deepEqual(readFileSync(c.H+'/calls','utf8').trim().split('\n'),['kill nightly','new nightly'])});

// ---------- the test copy ----------
test('H9: the test copy\'s folders are this user\'s alone, a link or a stranger\'s folder is refused, and the copy is taken down when the check ends',()=>{
 const BC=read('box-check.sh');const priv=BC.slice(BC.indexOf('\numask 077'),BC.indexOf('\nD=/tmp/ppl'));
 const T=tmp('h9-');mkdirSync(T+'/open');if(posix)chmodSync(T+'/open',0o775);writeFileSync(T+'/target','x');
 const r=bash(priv+`\naq_private '${T}/open' && echo secret > '${T}/open/pw' && echo OPEN-OK; aq_private '${T}/new/deep' && echo NEW-OK`);
 assert.match(r.out,/OPEN-OK/);assert.match(r.out,/NEW-OK/);
 if(posix){assert.equal(mode(T+'/open'),'700');assert.equal(mode(T+'/open/pw'),'600');assert.equal(mode(T+'/new/deep'),'700');
  symlinkSync(T+'/open',T+'/link');const l=bash(priv+`\naq_private '${T}/link' && echo USED`);assert.doesNotMatch(l.out,/USED/);assert.match(l.out,/is a link/)}
 for(const f of ['box-check.sh','fixer-testcopy.sh','test-people.sh']){const s=read(f);assert.match(s,/^umask 077$/m,f);assert.match(s,/UI_HOST=127\.0\.0\.1/,f);assert.equal(/mkdir -p \$D;/.test(s)&&!/chmod 700 \$D/.test(s),false,f)}
 assert.match(BC,/trap 'aq_copy_down; rmdir \/tmp\/aq-check\.lock 2>\/dev\/null' EXIT/);
 const down=BC.slice(BC.indexOf('aq_copy_down(){'),BC.indexOf('\ntrap \'aq_copy_down'));
 const D=tmp('ppl-');mkdirSync(D+'/data');for(const f of ['pw','env','data/users.json'])writeFileSync(D+'/'+f,'x');
 const k=bash(`sleep 60 & echo $! > '${D}/pid'; P=$!; D='${D}'; HEAVY=1; ${down}\naq_copy_down; sleep 0.3; kill -0 $P 2>/dev/null && echo STILL-RUNNING; ls '${D}'`);
 assert.doesNotMatch(k.out,/STILL-RUNNING/);assert.equal(k.out.trim(),'','password, settings and data are removed: '+k.out);
 const light=bash(`D='${D}'; HEAVY=0; echo 1 > "$D/pw"; ${down}\naq_copy_down; ls '${D}'`);assert.match(light.out,/pw/,'a light check starts no copy and takes none down (the fixer may be using one)')});

// ---------- the local firewall ----------
const AU=HERE+'/agent-users.sh';
function fwBox({broken=false}={}){const H=tmp('fw-'),bin=H+'/bin';mkdirSync(bin);
 // iptables stand-in: -C succeeds when that rule was added before; -A/-I/-N record; "broken" refuses every change
 const ipt=`#!/bin/bash\nR=${H}/rules.$(basename "$0")\nop=$1; shift\ncase "$op" in\n -C) grep -qxF -- "$*" "$R" 2>/dev/null ;;\n -N) ${broken?'exit 1':'exit 0'} ;;\n -F) ${broken?'exit 1':`grep -v "^$1 " "$R" > "$R.t" 2>/dev/null; mv "$R.t" "$R"; exit 0`} ;;\n -A) ${broken?'exit 1':'echo "$*" >> "$R"; echo "A $*" >> '+H+'/calls'} ;;\n -I) ${broken?'exit 1':'c=$1; shift; shift; echo "$c $*" >> "$R"; echo "I $c $*" >> '+H+'/calls'} ;;\nesac\n`;
 for(const n of ['iptables','ip6tables']){writeFileSync(bin+'/'+n,ipt);chmodSync(bin+'/'+n,0o755)}
 return {H,run:body=>bash(`export AQ_AGENT_USERS_LIB=1 AQEELOS_HOME='${H}' AQ_RESTARTS='${H}/rst' AQ_SEEN='${H}/seen'; source '${AU}'; ${body}`,{PATH:bin+path.delimiter+process.env.PATH})}}

test('CR-6: on the box\'s own addresses only root and the box user may connect to the dashboard, gateway, bridges, shared screen, VNC and test copy',()=>{
 const b=fwBox();const r=b.run('local_fw; echo "rc=$?"');assert.match(r.out,/rc=0/,r.out+r.err);
 const rules=readFileSync(b.H+'/rules.iptables','utf8').trim().split('\n');
 assert.deepEqual(rules,['AQ-LOCAL -m owner --uid-owner 0 -j RETURN','AQ-LOCAL -m owner --uid-owner claude -j RETURN',
  'AQ-LOCAL -p tcp -m multiport --dports 9119,8642,3000:3002,4402,5900:5999,6080 -j REJECT --reject-with tcp-reset','OUTPUT -o lo -p tcp -j AQ-LOCAL','INPUT ! -i lo -p tcp --dport 5900:5999 -j REJECT --reject-with tcp-reset']);
 assert.ok(existsSync(b.H+'/rules.ip6tables'),'the same for ::1');
 // run again: nothing is added twice
 const n=readFileSync(b.H+'/calls','utf8');b.run('local_fw; local_fw');assert.equal(readFileSync(b.H+'/calls','utf8'),n);
 // a rule someone removed is put back on the next look
 writeFileSync(b.H+'/rules.iptables',rules.filter(x=>!x.startsWith('OUTPUT')).join('\n')+'\n');b.run('local_fw');assert.match(readFileSync(b.H+'/rules.iptables','utf8'),/^OUTPUT -o lo -p tcp -j AQ-LOCAL$/m);
 const src=readFileSync(AU,'utf8');assert.match(src,/\{ janitor; sleep_idle; setup_wake; local_fw; \}/,'looked at again every minute');assert.match(src,/x11_dir\n  local_fw\n/,'and applied at start')});

test('CR-6: a box where the rules cannot be set says so in its log and files one Health item, once',()=>{
 const b=fwBox({broken:true});const r=b.run('local_fw; echo "rc=$?"; local_fw >/dev/null; local_fw >/dev/null');
 assert.match(r.out,/LOCAL FIREWALL NOT APPLIED/);assert.match(r.out,/rc=1/);
 const issues=readFileSync(b.H+'/.aqeelos-agent-issues.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(issues.length,1);assert.equal(issues[0].key,'local-firewall');assert.equal(issues[0].title,'Local firewall not applied');assert.match(issues[0].what,/9119/);
 // once it works again the note is cleared, so a later failure is reported again
 const ok=fwBox();ok.run(`mkdir -p '${ok.H}/rst'; : > '${ok.H}/rst/.fw-failed'; local_fw`);assert.ok(!existsSync(ok.H+'/rst/.fw-failed'));
 const bad=b.run('AQ_LOCAL_PORTS="9119;rm -rf x" ; LOCAL_PORTS=$AQ_LOCAL_PORTS; local_fw; echo "rc=$?"');assert.match(bad.out,/not a list of ports/)});

test('H-10: an agent\'s screen listens on its socket only: no VNC port on any address',()=>{
 const src=readFileSync(AU,'utf8');assert.match(src,/-SecurityTypes None -rfbport -1 -localhost -rfbunixpath '\$sd\/rfb\.sock' -rfbunixmode 0660/);assert.equal(/-rfbport 0\b/.test(src),false)});

// ---------- auto-update and engine patches ----------
test('L5: a version is given up on at once after a failed check or go-live, and only after three tries when the server was busy or the deploy ran out of time',()=>{
 const s=read('auto-update.mjs');const m=/function giveUp\(v,passing\)\{[\s\S]*?\n[^\n]*\}/.exec(s);assert.ok(m);
 const state={};const giveUp=new Function('state',m[0]+';return giveUp')(state);
 giveUp('v1',true);giveUp('v1',true);assert.equal(state.skip,undefined);giveUp('v1',true);assert.equal(state.skip,'v1');
 const st2={};const g2=new Function('state',m[0]+';return giveUp')(st2);g2('v2',false);assert.equal(st2.skip,'v2');
 const st3={};const g3=new Function('state',m[0]+';return giveUp')(st3);g3('a',true);g3('a',true);g3('b',true);assert.equal(st3.skip,undefined,'the count starts over for a newer version');
 assert.match(s,/giveUp\(latest,\/\^\(busy\|pack\|unpack steps\)\$\/\.test\(m\[1\]\)\)/);assert.match(s,/giveUp\(latest,true\);record\('failed','It did not finish within 75 minutes\.'/)});

test('M18: an engine patch that does not fit is printed as MISFIT and the run ends with exit code 3',()=>{
 const s=read('apply-skill-patches.mjs');
 assert.match(s,/const misfit=w=>\{misfits\.push\(w\);console\.warn\('MISFIT '\+w\)\}/);assert.match(s,/if\(misfits\.length\)\{[^\n]*process\.exitCode=3\}/);
 assert.ok((s.match(/misfit\(/g)||[]).length>=5,'every place a patch can fail to fit says so');
 assert.match(read('engine-sim.sh'),/\[ \$ru = 0 \] \|\| \[ \$ru = 3 \]/);assert.match(read('box-live.sh'),/apply-skill-patches\.mjs \|\| echo "! skill patches: see the message above \(exit \$\?\)"/)});
