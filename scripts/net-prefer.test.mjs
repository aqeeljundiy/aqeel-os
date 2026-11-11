import test from 'node:test';
import assert from 'node:assert/strict';
import {ipv6Broken,preferIpv4,_reset} from '../app/net-prefer.mjs';

const conn=(v4,v6)=>async(h,family)=>family===4?v4:v6;
test('IPv4 works and IPv6 does not: broken; both work, or no network: not',async()=>{
 assert.equal(await ipv6Broken({connect:conn(true,false)}),true);assert.equal(await ipv6Broken({connect:conn(true,true)}),false);
 assert.equal(await ipv6Broken({connect:conn(false,false)}),false,'no network: no conclusion')});
test('the probe is cached for 30 minutes',async()=>{_reset();let n=0;const probe=async()=>{n++;return true};
 assert.equal(await preferIpv4({now:1000,probe}),true);assert.equal(await preferIpv4({now:1000+29*60e3,probe}),true);assert.equal(n,1);
 await preferIpv4({now:1000+31*60e3,probe});assert.equal(n,2);_reset()});
test('a probe that throws counts as not broken',async()=>{_reset();assert.equal(await preferIpv4({probe:async()=>{throw Error('x')}}),false);_reset()});
