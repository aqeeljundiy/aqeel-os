// Tests for every agent's own AdsPower (app/agent-adspower.mjs) and its tool's guard (scripts/adspower-mcp-guard.mjs).
// Run: node --test scripts/agent-adspower.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {assignPorts,launchLine,stopLine,marker,baseOf,BASE_PORT} from '../app/agent-adspower.mjs';
import {guardReply,NOT_SIGNED_IN} from './adspower-mcp-guard.mjs';

test('ports: the main agent first, each agent keeps its port, a new one never gets a port used before',()=>{
 let r=assignPorts({},['sesa','default','continue-threads','default--whatsapp-2']);
 assert.deepEqual(r.db.ports,{default:BASE_PORT,'continue-threads':BASE_PORT+1,sesa:BASE_PORT+2});assert.ok(r.changed);
 const again=assignPorts(r.db,['continue-threads','sesa','default']);assert.equal(again.changed,false);assert.deepEqual(again.db.ports,r.db.ports);
 // an agent removed and a new one added: the new one gets a fresh port, not the removed one's
 const {sesa,...rest}=r.db.ports;r=assignPorts({...r.db,ports:rest},['default','continue-threads','zeta']);
 assert.equal(r.db.ports.zeta,BASE_PORT+3);assert.equal(r.db.ports['continue-threads'],BASE_PORT+1);
 // a counter lost from an old file: still past every kept port
 assert.equal(assignPorts({ports:{default:BASE_PORT+7}},['default','new']).db.ports.new,BASE_PORT+8);
 assert.equal(baseOf('default--whatsapp-3'),'default')});

test('launch line: own home, own screen, own port, a restart loop with a marker',()=>{
 const l=launchLine({bin:'/home/claude/workspaces/.aqeelos-adspower/adspower_global',home:'/home/claude/workspaces/sesa',envFile:'/home/claude/workspaces/sesa/.screen/env',port:50402});
 for(const want of ['P=50402','HOME=/home/claude/workspaces/sesa','--no-sandbox --disable-dev-shm-usage --api-port=$P','. /home/claude/workspaces/sesa/.screen/env','setsid nohup bash -c','aqeelos-adspower-$P','while :;','sleep 5'])assert.ok(l.includes(want),want);
 // the stop patterns must not match the line that runs them (it would kill itself)
 for(const p of [marker(50402),'--api-port=50402','/home/claude/workspaces/sesa/.config/adspower_global'])assert.ok(!l.includes(p),p);
 for(const bad of [{port:0},{port:'1;rm'},{home:"/x';rm -rf /;'"},{envFile:'rel/env'}])assert.throws(()=>launchLine({bin:'/b',home:'/h',envFile:'/e',port:1,...bad}));
 // it is valid shell
 execFileSync('bash',['-n','-c',l]);execFileSync('bash',['-n','-c',stopLine({home:'/h',port:50400})])});

test('stop patterns match the running copy and nothing else',()=>{const s=stopLine({home:'/home/claude/workspaces/sesa',port:50402});
 const pats=[...s.matchAll(/-f (?:-- )?'([^']+)'/g)].map(m=>new RegExp(m[1]));assert.equal(pats.length,7);   // three with TERM, one wait, three with KILL
 assert.ok(pats[0].test('bash -c ... aqeelos-adspower-50402'));assert.ok(!pats[0].test('aqeelos-adspower-50403'));
 assert.ok(pats[1].test('/x/adspower_global --no-sandbox --api-port=50402'));
 assert.ok(!pats.some(p=>p.test(s)),'never its own line');assert.ok(!pats.some(p=>p.test('/home/claude/apps/adspower/opt/adspower-global/adspower_global --no-sandbox --disable-dev-shm-usage')),'never the shared :99 copy')});

test('tool guard: a tool call while AdsPower is not signed in gets a plain answer; the rest passes through',()=>{
 const r=guardReply({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'get-browser-list'}},false);
 assert.equal(r.id,7);assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/is not signed in yet: open its screen and sign in/);
 assert.equal(guardReply({jsonrpc:'2.0',id:7,method:'tools/call'},true),null);assert.equal(guardReply({jsonrpc:'2.0',id:1,method:'tools/list'},false),null);
 assert.equal(guardReply({jsonrpc:'2.0',method:'notifications/initialized'},false),null);assert.match(NOT_SIGNED_IN('Sesa'),/^AdsPower on Sesa's screen/)});
