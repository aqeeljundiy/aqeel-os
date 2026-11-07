import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {stopGatewayCmd,stopTimeoutMs,STOP_WAIT_S} from '../app/gateway-stop.mjs';
// 7 Nov 2026: the engine needs ~40 s to stop; aqeelOS closed its window after 30 s and every such stop was an unclean exit
assert.ok(STOP_WAIT_S>=120,'waits well past the engine\'s 30-45 s teardown');
assert.ok(stopTimeoutMs()>STOP_WAIT_S*1000,'the shell may run longer than the wait');
const run=async({teardown,wait,dropPid})=>{
 const H=mkdtempSync(path.join(tmpdir(),'gs-'));const bin=path.join(H,'bin');mkdirSync(bin);mkdirSync(path.join(H,'.hermes'));
 const log=path.join(H,'calls.log');
 // a fake engine: on SIGTERM it takes `teardown` seconds to finish, like the real one
 // started through a shell that exits at once, so the fake engine is reaped by the system (as the real one is by its
 // tmux shell) and not left a zombie of this test, which kill -0 would still see
 const gw={pid:Number(execFileSync('bash',['-c',`nohup bash -c 'trap "sleep ${teardown}; exit 0" TERM; while :; do sleep 0.1; done' >/dev/null 2>&1 & echo $!`]).toString().trim())};
 writeFileSync(path.join(H,'.hermes','gateway.pid'),String(gw.pid));
 writeFileSync(path.join(bin,'hermes'),`#!/bin/bash\necho "hermes $*" >> ${log}\nkill -TERM $(cat ${H}/.hermes/gateway.pid)\n${dropPid?`rm -f ${H}/.hermes/gateway.pid\n`:''}`);
 writeFileSync(path.join(bin,'tmux'),`#!/bin/bash\nif kill -0 ${gw.pid} 2>/dev/null; then echo "tmux $* ALIVE" >> ${log}; kill -9 ${gw.pid}; else echo "tmux $* gone" >> ${log}; fi\n`);
 chmodSync(path.join(bin,'hermes'),0o755);chmodSync(path.join(bin,'tmux'),0o755);
 const out=execFileSync('bash',['-c',stopGatewayCmd({wait})],{env:{...process.env,HOME:H,PATH:bin+':'+process.env.PATH},timeout:stopTimeoutMs(wait)}).toString();
 return {out,calls:readFileSync(log,'utf8')}};
// the engine tears down for 3 s: the window is closed only after it is gone, and nothing is forced
let r=await run({teardown:3,wait:20});
assert.match(r.calls,/hermes -p default gateway stop --yes/);assert.match(r.calls,/tmux kill-session -t =gateway gone/,'tmux closed after the engine exited: '+r.calls);assert.doesNotMatch(r.out,/FORCED/);
// the engine drops its pid file early but keeps tearing down: the first pid is still followed
r=await run({teardown:3,wait:20,dropPid:true});
assert.match(r.calls,/kill-session -t =gateway gone/,'pid seen before the stop is followed: '+r.calls);
// a stuck engine: after the wait it is closed and reported
r=await run({teardown:30,wait:2});
assert.match(r.out,/FORCED/);assert.match(r.calls,/ALIVE/);
// dashboard too when asked; no --yes when not asked
assert.match(stopGatewayCmd({dashboard:true}),/kill-session -t "=dashboard"/);assert.doesNotMatch(stopGatewayCmd({yes:false}),/--yes/);
// server.mjs uses it for every stop (no 30 s loops left)
const src=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8');
assert.doesNotMatch(src,/seq 1 30\); do p=\$\(grep -o "\[0-9\]\*" ~\/\.hermes\/gateway\.pid/,'no 30 s stop loop left');
assert.equal((src.match(/stopGatewayCmd\(/g)||[]).length,3,'restart, restore and Stop use it');
console.log('gateway-stop ok');
