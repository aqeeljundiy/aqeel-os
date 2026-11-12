// The automatic undo in box-live.sh (8 Nov 2026): when the live test fails, the kept previous version is unpacked again, its
// commit restored, only the web app restarted, the undo recorded for System › Health, and the owner messaged only when
// putting it back fails too. Runs the real aq_undo from box-live.sh in a fake home with stand-in tmux, curl and services.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';

const src=readFileSync(new URL('./box-live.sh',import.meta.url),'utf8');
const fns=src.slice(src.indexOf('aq_tell_owner(){'),src.indexOf('# the files arrived whole'));
const live=src.slice(src.indexOf('# The real-life test'),src.indexOf('\nfi',src.indexOf('# The real-life test'))+3);

function box({healthy=true,prev=true,testOk=false}={}){const H=mkdtempSync(path.join(tmpdir(),'undo-')),A=path.join(H,'apps','hermes-ui'),bin=path.join(H,'bin'),D=path.join(H,'apps','hermes-ui-data');
 mkdirSync(path.join(A,'app'),{recursive:true});mkdirSync(path.join(A,'scripts'),{recursive:true});mkdirSync(bin);mkdirSync(D,{recursive:true});mkdirSync(path.join(H,'.hermes'));
 writeFileSync(path.join(H,'.hermes','.env'),'TELEGRAM_BOT_TOKEN=tok\nTELEGRAM_HOME_CHANNEL=42\n');writeFileSync(path.join(H,'apps','hermes-ui.env'),'');
 // the previous version: app/v.txt = old
 const old=path.join(H,'old');mkdirSync(path.join(old,'app'),{recursive:true});writeFileSync(path.join(old,'app','v.txt'),'old');
 if(prev){execFileSync('tar',['-czf',path.join(A,'.deployed.prev.tgz'),'-C',old,'app']);writeFileSync(path.join(A,'.deployed.prev-commit'),'aaaaaaaa1111\n')}
 writeFileSync(path.join(A,'app','v.txt'),'new');writeFileSync(path.join(A,'.deployed-commit'),'bbbbbbbb2222\n');
 writeFileSync(path.join(A,'scripts','live-test.mjs'),`process.exit(${testOk?0:1})`);
 const log=path.join(H,'calls.log');
 const stub=(n,body)=>{writeFileSync(path.join(bin,n),'#!/bin/bash\necho "'+n+' $*" >> '+log+'\n'+body);chmodSync(path.join(bin,n),0o755)};
 stub('tmux','exit 0');stub('timeout','shift; exec "$@"');
 stub('curl',`case "$*" in *healthz*) ${healthy?'echo \'{"ok":true}\'':'exit 7'};; *telegram*) exit 0;; esac`);
 writeFileSync(path.join(H,'services.sh'),'#!/bin/bash\necho "services" >> '+log+'\n');chmodSync(path.join(H,'services.sh'),0o755);
 return {H,A,D,log,env:{...process.env,HOME:H,UI_DATA_DIR:D,PATH:bin+':'+process.env.PATH,SHA:'bbbbbbbb2222'}}}

test('a failed live test puts the previous version back, restores its commit, restarts only the web app and records it',()=>{
 const b=box();const r=spawnSync('bash',['-c',fns+'\nT0=0\n'+live+'\necho reached-end'],{env:b.env,encoding:'utf8'});
 assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/putting aaaaaaaa back/);assert.match(r.stdout,/aaaaaaaa is back and answers/);
 assert.equal(readFileSync(path.join(b.A,'app','v.txt'),'utf8'),'old');assert.equal(readFileSync(path.join(b.A,'.deployed-commit'),'utf8').trim(),'aaaaaaaa1111');
 const calls=readFileSync(b.log,'utf8');assert.match(calls,/tmux kill-session -t =ui/);assert.match(calls,/services/);assert.doesNotMatch(calls,/telegram/);assert.doesNotMatch(calls,/hermes gateway/);
 const rec=JSON.parse(readFileSync(path.join(b.D,'live-test.json'),'utf8')).runs[0];assert.equal(rec.undo.to,'aaaaaaaa1111');assert.equal(rec.undo.ok,true);assert.equal(rec.undo.why,'the live test failed')});

test('a passing live test changes nothing',()=>{const b=box({testOk:true});
 const r=spawnSync('bash',['-c',fns+'\nT0=0\n'+live+'\necho reached-end'],{env:b.env,encoding:'utf8'});
 assert.equal(r.status,0);assert.match(r.stdout,/reached-end/);assert.equal(readFileSync(path.join(b.A,'app','v.txt'),'utf8'),'new');assert.ok(!existsSync(b.log)||!/services/.test(readFileSync(b.log,'utf8')))});

test('when putting it back fails (it does not answer, or there is nothing to put back), the owner is messaged',()=>{
 const b=box({healthy:false});let r=spawnSync('bash',['-c',fns+'\naq_undo "the live test failed"'],{env:b.env,encoding:'utf8'});
 assert.equal(r.status,1);assert.match(readFileSync(b.log,'utf8'),/curl .*api\.telegram\.org\/bottok\/sendMessage/);
 const c=box({prev:false});r=spawnSync('bash',['-c',fns+'\naq_undo "the live test failed"'],{env:c.env,encoding:'utf8'});
 assert.equal(r.status,1);assert.match(r.stdout,/no previous version/);assert.match(readFileSync(c.log,'utf8'),/telegram/)});

test('box-live.sh keeps the running version before unpacking the new one',()=>{
 assert.ok(src.indexOf('cp ~/apps/hermes-ui/.deployed.tgz ~/apps/hermes-ui/.deployed.prev.tgz')<src.indexOf('\naq_stage_new "$HT"'));assert.match(src,/cp ~\/apps\/hermes-ui\/\.deployed-commit ~\/apps\/hermes-ui\/\.deployed\.prev-commit/)});

// 12 Nov 2026: ~/services.sh returned 1 after the new files were unpacked; with set -e the deploy said "FAILED go live" and left the
// new version running untested. Now any unhandled failure after the unpack puts the previous version back (aq_exit), and a failing
// launcher alone neither stops the undo nor the go-live.
const run=(b,body,{e=true}={})=>spawnSync('bash',['-c',(e?'set -e\n':'')+fns+'\ntrap aq_exit EXIT\n'+body],{env:b.env,encoding:'utf8'});
const failingServices=b=>{writeFileSync(path.join(b.H,'services.sh'),'#!/bin/bash\necho "services" >> '+b.log+'\nexit 1\n');chmodSync(path.join(b.H,'services.sh'),0o755)};

test('an unhandled failure after the unpack (a step that exits non-zero) puts the previous version back and still fails the deploy',()=>{
 const b=box();const r=run(b,'AQ_STAGE=golive\nfalse\necho not-reached');
 assert.equal(r.status,1,r.stdout+r.stderr);assert.doesNotMatch(r.stdout,/not-reached/);assert.match(r.stdout,/going live stopped \(exit 1\)/);assert.match(r.stdout,/aaaaaaaa is back and answers/);
 assert.equal(readFileSync(path.join(b.A,'app','v.txt'),'utf8'),'old');assert.equal(readFileSync(path.join(b.A,'.deployed-commit'),'utf8').trim(),'aaaaaaaa1111');
 assert.equal(JSON.parse(readFileSync(path.join(b.D,'live-test.json'),'utf8')).runs[0].undo.why,'going live failed')});

test('a failing ~/services.sh does not stop the undo (set -e), and the version is back when the UI answers',()=>{
 const b=box();failingServices(b);const r=run(b,'aq_undo "the live test failed"');
 assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/services\.sh exited with an error \(1\)/);assert.match(r.stdout,/aaaaaaaa is back and answers/);assert.equal(readFileSync(path.join(b.A,'app','v.txt'),'utf8'),'old')});

test('a failure that was handled (undo already ran) is not undone a second time',()=>{
 const b=box();const r=run(b,'AQ_STAGE=golive\naq_undo "the UI did not answer"; exit 1');
 assert.equal(r.status,1);assert.equal((readFileSync(b.log,'utf8').match(/^services$/gm)||[]).length,1,'the launcher ran once')});

test('before the unpack, or after a passed live test, nothing is undone: the log says which version runs',()=>{
 let b=box();let r=run(b,'false');assert.equal(r.status,1);assert.equal(readFileSync(path.join(b.A,'app','v.txt'),'utf8'),'new');
 b=box();r=run(b,'AQ_STAGE=done\nfalse');assert.equal(r.status,1);assert.equal(readFileSync(path.join(b.A,'app','v.txt'),'utf8'),'new');assert.match(r.stdout,/new version bbbbbbbb is running and passed its live test/)});

test('no previous version to put back: the log names the NEW version as running, untested',()=>{
 const b=box({prev:false});const r=run(b,'AQ_STAGE=golive\nfalse');
 assert.equal(r.status,1);assert.match(r.stdout,/no previous version/);assert.match(r.stdout,/the NEW version bbbbbbbb is running: it was not live-tested/)});

test('box-live.sh: the stage is set after both unpacks, and the launcher call cannot fail the go-live',()=>{
 assert.ok(src.indexOf('\nAQ_STAGE=golive')>src.indexOf('\naq_stage_new "$HT"')&&src.indexOf('\nAQ_STAGE=golive')<src.indexOf('\naq_switch ||'),'the stage is set after the new files are built beside the live ones and BEFORE the switch (H7)');
 assert.equal(src.includes('tar -xzf $HT -C ~/apps/hermes-ui'),false,'the new version is never unpacked over the live folder');assert.ok(src.indexOf('\nAQ_STAGE=done')>src.indexOf('scripts/live-test.mjs'));
 assert.match(src,/trap aq_exit EXIT/);assert.doesNotMatch(src,/^~\/services\.sh;/m);assert.match(src,/services-install\.sh/)});

// H7 and H8 (audit of 12 Nov 2026): the real aq_stage_new / aq_switch / aq_undo of box-live.sh on a fake home.
const pack=(b,name,files)=>{const d=path.join(b.H,'src-'+name);for(const [p,c] of Object.entries(files)){mkdirSync(path.dirname(path.join(d,p)),{recursive:true});writeFileSync(path.join(d,p),c)}
 const t=path.join(b.H,name+'.tgz');execFileSync('tar',['-czf',t,'-C',d,...new Set(Object.keys(files).map(p=>p.split('/')[0]))]);return t};
// a box that runs "old" from its own archive, with a file of its own in scripts/ and a data folder beside the code
function liveBox(){const b=box({prev:false});const old=pack(b,'old',{'app/v.txt':'old','app/gone.mjs':'removed from git later','scripts/live-test.mjs':'process.exit(1)','engine/patches/a.patch':'a'});
 execFileSync('rm',['-rf',path.join(b.A,'app'),path.join(b.A,'scripts')]);execFileSync('tar',['-xzf',old,'-C',b.A]);execFileSync('cp',[old,path.join(b.A,'.deployed.tgz')]);
 writeFileSync(path.join(b.A,'.deployed-commit'),'aaaaaaaa1111\n');writeFileSync(path.join(b.A,'.deployed-commits'),'aaaaaaaa1111\n');
 writeFileSync(path.join(b.A,'scripts','features.mjs'),'box only');mkdirSync(path.join(b.A,'data'));writeFileSync(path.join(b.A,'data','keep.json'),'{}');
 b.next=pack(b,'new',{'app/v.txt':'new','app/added.mjs':'x','scripts/live-test.mjs':'process.exit(1)','engine/patches/a.patch':'a','engine/patches/b.patch':'b','assets/logo.txt':'new top-level folder'});return b}
const tree=b=>execFileSync('bash',['-c','cd "$1" && find . -type f ! -name "calls.log" | sort | xargs cksum',"_",b.A],{encoding:'utf8'});

test('H7: an unpack that fails (a broken archive, a full disk) leaves the live folder exactly as it was, and nothing is undone',()=>{
 const b=liveBox();const before=tree(b);writeFileSync(b.next,readFileSync(b.next).subarray(0,200));   // cut off: tar fails part way
 const r=run(b,'aq_stage_new "'+b.next+'" || { rm -rf "$HOME/apps/hermes-ui/.next" "$HOME/apps/hermes-ui/.deployed.tgz.new"; echo UNPACK-FAILED; exit 1; }');
 assert.equal(r.status,1);assert.match(r.stdout,/UNPACK-FAILED/);assert.doesNotMatch(r.stdout,/putting .* back/);
 assert.equal(tree(b).replace(/^.*\.prev\.commit\n/m,''),before.replace(/^.*\.prev\.commit\n/m,''));assert.equal(readFileSync(path.join(b.A,'app','v.txt'),'utf8'),'old')});

test('H7: the switch puts the new version in whole: files git dropped are gone (M22), the box\'s own files and data stay',()=>{
 const b=liveBox();const r=run(b,'aq_stage_new "'+b.next+'" && AQ_STAGE=golive && aq_switch && AQ_STAGE=done');
 assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/1 file\(s\) that git no longer has/);
 assert.equal(readFileSync(path.join(b.A,'app','v.txt'),'utf8'),'new');assert.ok(existsSync(path.join(b.A,'app','added.mjs')));assert.ok(!existsSync(path.join(b.A,'app','gone.mjs')));
 assert.equal(readFileSync(path.join(b.A,'scripts','features.mjs'),'utf8'),'box only');assert.ok(existsSync(path.join(b.A,'data','keep.json')));
 assert.equal(readFileSync(path.join(b.A,'.deployed-commit'),'utf8').trim(),'bbbbbbbb2222');assert.deepEqual(readFileSync(path.join(b.A,'.deployed.tgz')),readFileSync(b.next))});

test('H8: a failed live test after the switch brings everything back: removed files, ~/services.sh, the commit; the list of live commits never changed',()=>{
 const b=liveBox();const before=tree(b);const sv=readFileSync(path.join(b.H,'services.sh'),'utf8');mkdirSync(b.D,{recursive:true});writeFileSync(path.join(b.D,'services.shipped'),'shipped-old');
 const r=run(b,'aq_stage_new "'+b.next+'"; aq_services_keep; AQ_STAGE=golive; aq_switch; printf "#!/bin/bash\\necho services >> '+b.log+'\\n# new launcher\\n" > ~/services.sh; echo shipped-new > "$UI_DATA_DIR/services.shipped"; T0=0\n'+live+'\necho reached-end');
 assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/aaaaaaaa is back and answers/);assert.match(r.stdout,/services\.sh is the previous one again/);
 assert.equal(tree(b),before,'the app folder is byte for byte what it was');
 assert.ok(existsSync(path.join(b.A,'app','gone.mjs'))&&!existsSync(path.join(b.A,'app','added.mjs'))&&!existsSync(path.join(b.A,'assets')),'a file the new version removed is back; what it added is gone');
 assert.equal(readFileSync(path.join(b.H,'services.sh'),'utf8'),sv);assert.equal(readFileSync(path.join(b.D,'services.shipped'),'utf8'),'shipped-old');
 assert.equal(readFileSync(path.join(b.A,'.deployed-commit'),'utf8').trim(),'aaaaaaaa1111');assert.equal(readFileSync(path.join(b.A,'.deployed-commits'),'utf8').trim(),'aaaaaaaa1111');
 for(const x of ['.prev','.prev.tgz','.prev.commit','.next','.undone','.services.prev'])assert.ok(!existsSync(path.join(b.A,x)),x+' left behind')});

test('H7: a switch that stops half way is put back by the exit handler',()=>{
 const b=liveBox();const before=tree(b);
 const r=run(b,'aq_stage_new "'+b.next+'"; AQ_STAGE=golive; mv(){ case "$*" in *"/.next/engine "*) return 1;; esac; command mv "$@"; }; aq_switch || { unset -f mv; echo SWITCH-FAILED; exit 1; }');
 assert.equal(r.status,1);assert.match(r.stdout,/SWITCH-FAILED/);assert.match(r.stdout,/aaaaaaaa is back and answers/);assert.equal(tree(b),before)});

test('H8: engine patches, the Code files and the list of live commits are touched only after the live test passed; the UI stops after the launcher is installed (L8)',()=>{
 const done=src.indexOf('\nAQ_STAGE=done');assert.ok(done>0);
 for(const step of ['scripts/apply-skill-patches.mjs','tar -xzf $CT -C $C','$A/.deployed-commits','echo "$CODE_V" > $C/VERSION'])assert.ok(src.indexOf(step)>done,step+' must come after the live test');
 assert.equal(src.slice(src.indexOf('# the files arrived whole'),done).includes('.deployed-commits'),false);
 assert.ok(src.indexOf('tmux kill-session -t "=ui" 2>/dev/null || true   #')>src.indexOf('bash ~/apps/hermes-ui/scripts/services-install.sh'))});

test('M17: deploying the live commit again keeps the real previous version; the lock has an owner and a heartbeat',()=>{
 assert.match(src,/\[ "\$NOW_SHA" != "\$SHA" \]; then cp ~\/apps\/hermes-ui\/\.deployed\.tgz ~\/apps\/hermes-ui\/\.deployed\.prev\.tgz/);
 assert.match(src,/echo \$\$ > \$L\/owner/);assert.match(src,/touch \$L 2>\/dev\/null; sleep 60/);
 const b=box();mkdirSync('/tmp/aq-live.lock-test-'+process.pid,{recursive:true});
 const r=run(b,'aq_unlock(){ [ "$(cat "$L/owner" 2>/dev/null)" = "$$" ] && rm -rf "$L"; return 0; }; L=/tmp/aq-live.lock-test-'+process.pid+'; echo 1 > $L/owner; aq_unlock; [ -d $L ] && echo KEPT; echo $$ > $L/owner; aq_unlock; [ -d $L ] || echo REMOVED; AQ_STAGE=done');
 assert.match(r.stdout,/KEPT/);assert.match(r.stdout,/REMOVED/)});
