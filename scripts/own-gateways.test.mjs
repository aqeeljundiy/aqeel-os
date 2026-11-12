// Agents with a gateway process of their own are restarted with the default one (app/gateway-stop.mjs). Run: node --test scripts/own-gateways.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseGatewayList,ownGateways,stopOwnGatewayCmd,startOwnGatewayCmd} from '../app/gateway-stop.mjs';
import {src} from './lib/source.mjs';
test('only agents whose gateway pid differs from the default one are restarted on their own; names reach a command line only when plain',()=>{
 const out='Gateways:\n  ✓ default (current)        — PID 3757885\n  ✓ aq-livetest              — PID 3757885\n  ✓ sesa                     — PID 4100\n  ✗ cont-socmed              — stopped\n  ✓ pep.club-2               — PID 4200\n';
 const l=parseGatewayList(out);assert.deepEqual(l.map(x=>x.name),['default','aq-livetest','sesa','pep.club-2']);
 assert.deepEqual(ownGateways(l),['sesa','pep.club-2'],'the shared gateway serves the rest');
 assert.deepEqual(ownGateways(parseGatewayList('Gateways:\n  ✓ default (current) — PID 1\n  ✓ sesa — PID 1\n')),[],'a shared gateway: nothing extra');assert.deepEqual(ownGateways(parseGatewayList('')),[]);
 assert.match(stopOwnGatewayCmd('sesa'),/hermes -p sesa gateway stop --yes/);assert.match(startOwnGatewayCmd('sesa'),/hermes -p sesa gateway start .*tmux new-session -d -s "gateway-sesa"/);
 assert.equal(stopOwnGatewayCmd('x; rm -rf ~'),'true');assert.equal(startOwnGatewayCmd('$(id)'),'true')});
test('server: the restart lists the own gateways, stops them with the default one and starts them after the launcher',async()=>{
 const {readFileSync}=await import('node:fs'),s=src('app/server.mjs');
 assert.ok(s.includes("ownGateways(parseGatewayList((await shx('hermes gateway list")&&s.includes('for(const a of own)await shx(stopOwnGatewayCmd(a)')&&s.includes("for(const a of own)await shx(startOwnGatewayCmd(a)")&&s.indexOf('stopOwnGatewayCmd(a)')<s.indexOf('stopGatewayCmd(),stopTimeoutMs()')&&s.indexOf("services.sh >/dev/null 2>&1');for(const a of own)")>0)});
