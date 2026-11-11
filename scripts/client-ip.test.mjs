// Who is calling (12 Nov 2026, secrets audit): forwarding headers count only from a trusted proxy, so a caller who reaches the app directly
// cannot choose its own address and walk around the "5 wrong passwords per address" limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeClientIp,parseTrusted} from '../app/client-ip.mjs';

const req=(remote,headers={})=>({socket:{remoteAddress:remote},headers});

test('a direct caller is its socket address, whatever headers it sends',()=>{const ip=makeClientIp('');
 assert.equal(ip(req('203.0.113.9',{'cf-connecting-ip':'198.51.100.1'})),'203.0.113.9');
 assert.equal(ip(req('203.0.113.9',{'x-forwarded-for':'198.51.100.1, 198.51.100.2'})),'203.0.113.9');
 assert.equal(ip(req('::ffff:203.0.113.9',{'cf-connecting-ip':'198.51.100.1'})),'203.0.113.9');
 assert.equal(ip(req(undefined)),'?')});

test('the limit cannot be walked around by changing the header on every request',()=>{const ip=makeClientIp('');
 const seen=new Set();for(let i=0;i<50;i++)seen.add(ip(req('203.0.113.9',{'cf-connecting-ip':'198.51.100.'+i})));
 assert.deepEqual([...seen],['203.0.113.9'])});

test('loopback is trusted by default: the proxy on this host tells who the visitor is',()=>{const ip=makeClientIp(undefined);
 assert.equal(ip(req('127.0.0.1',{'cf-connecting-ip':'198.51.100.7'})),'198.51.100.7');
 assert.equal(ip(req('::1',{'cf-connecting-ip':'198.51.100.7'})),'198.51.100.7');
 assert.equal(ip(req('::ffff:127.0.0.1',{'x-forwarded-for':'198.51.100.8'})),'198.51.100.8');
 assert.equal(ip(req('127.0.0.1')),'127.0.0.1','no header: the proxy itself')});

test('x-forwarded-for: the client is the first address from the right that is not a trusted proxy',()=>{const ip=makeClientIp('127.0.0.1,10.0.1.0/24');
 // a visitor who writes their own first entry cannot make it count
 assert.equal(ip(req('127.0.0.1',{'x-forwarded-for':'192.0.2.99, 198.51.100.5'})),'198.51.100.5');
 assert.equal(ip(req('10.0.1.9',{'x-forwarded-for':'198.51.100.5, 10.0.1.4'})),'198.51.100.5');
 assert.equal(ip(req('127.0.0.1',{'x-forwarded-for':'not-an-address'})),'127.0.0.1')});

test('a bad cf-connecting-ip from a trusted proxy is not used',()=>{const ip=makeClientIp('');
 assert.equal(ip(req('127.0.0.1',{'cf-connecting-ip':'<script>'})),'127.0.0.1')});

test('TRUSTED_PROXIES: ranges, IPv6, junk ignored and said',()=>{const said=[];const ip=makeClientIp('10.0.1.0/24, fd00::/8, nonsense, 10.0.0.0/99',{warn:m=>said.push(m)});
 assert.equal(ip(req('10.0.1.9',{'cf-connecting-ip':'198.51.100.5'})),'198.51.100.5');
 assert.equal(ip(req('fd00::5',{'cf-connecting-ip':'198.51.100.6'})),'198.51.100.6');
 assert.equal(ip(req('10.0.2.9',{'cf-connecting-ip':'198.51.100.5'})),'10.0.2.9');
 assert.equal(ip(req('127.0.0.1',{'cf-connecting-ip':'198.51.100.5'})),'127.0.0.1','a custom list replaces the default');
 assert.match(said[0],/ignored nonsense, 10\.0\.0\.0\/99/);
 assert.equal(parseTrusted('').has('127.0.0.1'),true)});

test('a proxy on a private network that is not listed is said once, and counts as one address',()=>{const said=[];const ip=makeClientIp('',{warn:m=>said.push(m)});
 assert.equal(ip(req('10.0.1.9',{'x-forwarded-for':'198.51.100.5'})),'10.0.1.9');assert.equal(ip(req('10.0.1.9',{'x-forwarded-for':'198.51.100.6'})),'10.0.1.9');
 assert.equal(said.length,1);assert.match(said[0],/TRUSTED_PROXIES/)});
