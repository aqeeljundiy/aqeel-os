// Tests for what may run during a restore (app/busy.mjs), and that server.mjs asks these rules where it matters.
// Run: node --test scripts/busy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mayStartAgents,busyTotal,guardPaused} from '../app/busy.mjs';

const server=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8');

test('restartGateway: refused while a restore runs, except the restore\'s own start',()=>{
 assert.equal(mayStartAgents({restoring:true}),false);assert.equal(mayStartAgents({restoring:true,forRestore:true}),true);assert.equal(mayStartAgents({restoring:false}),true);
 // the check is the first thing restartGateway does, before a queued restart or gwStopped=false
 const body=server.slice(server.indexOf('function restartGateway('),server.indexOf('function restartGateway(')+700);
 assert.ok(/if\(!mayStartAgents\(\{restoring:restoreBusy\(\),forRestore:restore\}\)\)/.test(body));assert.ok(body.indexOf('mayStartAgents')<body.indexOf('if(gwRestarting)'));
 assert.ok(server.includes('restoreBusy=()=>backups.busy()'));assert.ok(/startEngine:[^\n]*restartGateway\([^)]*restore:true/.test(server))});
test('healthz busy: counts a restore, so deploy.sh waits',()=>{
 assert.equal(busyTotal({}),0);assert.equal(busyTotal({restore:true}),1);assert.equal(busyTotal({live:2,gwRestarting:true,engineUpdate:true,restore:true}),5);
 const hz=server.slice(server.indexOf("if(p==='/healthz')"),server.indexOf("if(p==='/healthz')")+400);assert.ok(/busy:busyTotal\(\{[^}]*restore:backups\.busy\(\)/.test(hz))});
test('automations guard: paused during a restore',()=>{
 assert.equal(guardPaused({restore:true}),true);assert.equal(guardPaused({}),false);
 assert.ok(/paused:\(\)=>guardPaused\(\{[^}]*restore:backups\.busy\(\)/.test(server))});
test('the app\'s own restart and the engine\'s start and stop say no during a restore',()=>{
 assert.ok(/'\/ui\/gateway\/restart'[^\n]*if\(backups\.busy\(\)\)return send\(res,409/.test(server));assert.ok(server.includes("if(p.startsWith('/hapi/gateway/')&&req.method==='POST'&&backups.busy())return send(res,409"))});
