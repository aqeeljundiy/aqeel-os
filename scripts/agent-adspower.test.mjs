// Tests for every agent's own AdsPower (app/agent-adspower.mjs) and its tool's guard (scripts/adspower-mcp-guard.mjs).
// Run: node --test scripts/agent-adspower.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {assignPorts,launchLine,stopLine,marker,baseOf,BASE_PORT,parseListen,apiCandidates} from '../app/agent-adspower.mjs';
import {guardReply,NOT_SIGNED_IN} from './adspower-mcp-guard.mjs';

import {homedir as __hd} from 'node:os';const H=__hd();
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
 const l=launchLine({bin:`${H}/workspaces/.aqeelos-adspower/adspower_global`,home:`${H}/workspaces/sesa`,envFile:`${H}/workspaces/sesa/.screen/env`,port:50402});
 for(const want of ['P=50402',`HOME=${H}/workspaces/sesa`,'--no-sandbox --disable-dev-shm-usage --api-port=$P',`. ${H}/workspaces/sesa/.screen/env`,'setsid nohup bash -c','aqeelos-adspower-$P','while :;','sleep 5'])assert.ok(l.includes(want),want);
 // the stop patterns must not match the line that runs them (it would kill itself)
 for(const p of [marker(50402),'--api-port=50402',`${H}/workspaces/sesa/.config/adspower_global`])assert.ok(!l.includes(p),p);
 for(const bad of [{port:0},{port:'1;rm'},{home:"/x';rm -rf /;'"},{envFile:'rel/env'}])assert.throws(()=>launchLine({bin:'/b',home:'/h',envFile:'/e',port:1,...bad}));
 // it is valid shell
 execFileSync('bash',['-n','-c',l]);execFileSync('bash',['-n','-c',stopLine({home:'/h',port:50400})])});

test('stop patterns match the running copy and nothing else',()=>{const s=stopLine({home:`${H}/workspaces/sesa`,port:50402});
 const pats=[...s.matchAll(/-f (?:-- )?'([^']+)'/g)].map(m=>new RegExp(m[1]));assert.equal(pats.length,7);   // three with TERM, one wait, three with KILL
 assert.ok(pats[0].test('bash -c ... aqeelos-adspower-50402'));assert.ok(!pats[0].test('aqeelos-adspower-50403'));
 assert.ok(pats[1].test('/x/adspower_global --no-sandbox --api-port=50402'));
 assert.ok(!pats.some(p=>p.test(s)),'never its own line');assert.ok(!pats.some(p=>p.test(`${H}/apps/adspower/opt/adspower-global/adspower_global --no-sandbox --disable-dev-shm-usage`)),'never the shared :99 copy')});

test('tool guard: a tool call while AdsPower is not signed in gets a plain answer; the rest passes through',()=>{
 const r=guardReply({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'get-browser-list'}},false);
 assert.equal(r.id,7);assert.equal(r.result.isError,true);assert.match(r.result.content[0].text,/is not signed in yet: open its screen and sign in/);
 assert.equal(guardReply({jsonrpc:'2.0',id:7,method:'tools/call'},true),null);assert.equal(guardReply({jsonrpc:'2.0',id:1,method:'tools/list'},false),null);
 assert.equal(guardReply({jsonrpc:'2.0',method:'notifications/initialized'},false),null);assert.match(NOT_SIGNED_IN('Sesa'),/^AdsPower on Sesa's screen/)});

test('launch line with the port shim: preloaded only for this copy, with its own port; checked like the rest',()=>{
 const v={bin:'/w/.aqeelos-adspower/adspower_global',home:'/w/sesa',envFile:'/w/sesa/.screen/env',port:50404};
 const l=launchLine({...v,shim:'/w/.aqeelos-adspower-port.so'});assert.ok(l.includes('LD_PRELOAD=/w/.aqeelos-adspower-port.so AQ_ADSPOWER_PORT=$P HOME=/w/sesa /w/.aqeelos-adspower/adspower_global'));
 assert.ok(!launchLine(v).includes('LD_PRELOAD'),'no shim, no preload');assert.throws(()=>launchLine({...v,shim:"/x';rm -rf /;'"}));
 assert.ok(!l.includes(marker(50404))&&!l.includes('--api-port=50404'));execFileSync('bash',['-n','-c',l])});

// lines as /proc/net/tcp6 shows them on the box (1 Nov 2026): continue-threads (uid 2015) took 50325, sesa (2004) has
// only its start page port, Donna (1001) other things
const NET=`  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:C495 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  2015        0 333300001 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000000000000:5119 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  2004        0 333300002 1 0000000000000000 100 0 0 10 0
   2: 00000000000000000000000000000000:C4E4 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  2004        0 333300003 1 0000000000000000 100 0 0 10 0
   3: 00000000000000000000000000000000:C496 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 333300004 1 0000000000000000 100 0 0 10 0
   4: 0000000000000000FFFF00000100007F:C4F0 0000000000000000FFFF00000100007F:9A3C 01 00000000:00000000 00:00000000 00000000  1001        0 333300005 1 0000000000000000 100 0 0 10 0
   5: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 333300006 1 0000000000000000 100 0 0 10 0`;
test('port lookup: only listening sockets, the agent user\'s own, on its own port or AdsPower\'s range, its own first',()=>{
 const rows=parseListen(NET);assert.equal(rows.length,5,'the connected line is left out');assert.deepEqual(rows[0],{port:50325,uid:2015,inode:333300001});
 assert.deepEqual(apiCandidates(rows,{uid:2015,own:50402}),[50325],'continue-threads before the shim: on 50325');
 assert.deepEqual(apiCandidates(rows,{uid:2004,own:50404}),[50404],'sesa with the shim: its own port, not its start page (20761)');
 assert.deepEqual(apiCandidates([...rows,{port:50325,uid:2004,inode:9}],{uid:2004,own:50404}),[50404,50325],'its own port first');
 // Donna and trusted agents share a user: only sockets of their own copy's processes count
 assert.deepEqual(apiCandidates(rows,{uid:1001,own:50400}),[50326]);assert.deepEqual(apiCandidates(rows,{uid:1001,own:50400,mine:r=>r.inode===1}),[]);
 assert.deepEqual(apiCandidates(parseListen(''),{uid:1,own:2}),[])});
