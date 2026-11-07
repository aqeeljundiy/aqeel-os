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
 assert.ok(src.indexOf('.deployed.prev.tgz')<src.indexOf('tar -xzf $HT -C ~/apps/hermes-ui'));assert.match(src,/cp ~\/apps\/hermes-ui\/\.deployed-commit ~\/apps\/hermes-ui\/\.deployed\.prev-commit/)});
