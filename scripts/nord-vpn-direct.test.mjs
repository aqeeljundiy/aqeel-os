// Owner, 18 Nov 2026: through Nord about 1 in 10 connections to Telegram timed out (voice notes to Donna were lost); direct, none did.
// Telegram's published ranges skip the tunnel: a rule per range into table 100 (the normal route), put back on every connect.
// The list is fetched, never written in the repo; the addresses below are the documented fakes.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp,writeFile,chmod,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';import path from 'node:path';import os from 'node:os';
const src=await readFile(new URL('./nord-vpn.sh',import.meta.url),'utf8');
const fn=src.match(/^DIRECT_LIST=.*$/m)[0]+'\n'+src.match(/^direct_routes\(\)\{[\s\S]*?^\}/m)[0];
test('every connect sends Telegram around Nord, right after incoming connections are kept on the normal route',()=>{
 assert.match(src,/inbound_stays \|\| \{[^\n]*\}\n  direct_routes\n/);assert.match(src,/core\.telegram\.org\/resources\/cidr\.txt/)});
const bash=process.platform==='win32'&&'needs bash';
async function run(list){const d=await mkdtemp(path.join(os.tmpdir(),'nord-')),bin=path.join(d,'bin'),log=path.join(d,'log');await mkdir(bin);await mkdir(path.join(d,'vpn'));
 await writeFile(path.join(bin,'ip'),'#!/bin/bash\necho "$*" >> "'+log+'"\n');
 await writeFile(path.join(bin,'curl'),'#!/bin/bash\n'+(list===null?'exit 22\n':'cat "'+path.join(d,'list')+'"\n'));if(list!==null)await writeFile(path.join(d,'list'),list);
 await chmod(path.join(bin,'ip'),0o755);await chmod(path.join(bin,'curl'),0o755);
 const go=()=>execFileSync('bash',['-c','DIR="'+path.join(d,'vpn')+'"\n'+fn+'\ndirect_routes'],{env:{...process.env,PATH:bin+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
 return {d,log,go,lines:async()=>(await readFile(log,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean)}}
test('each IPv4 range of the list gets one rule into table 100, ahead of the mark rule; IPv6 and junk lines are left out; a rule from before is replaced, not doubled',{skip:bash},async()=>{
 const r=await run('192.0.2.0/24\n198.51.100.0/22\n2001:db8::/32\n<html>\n');r.go();const l=await r.lines(),adds=l.filter(x=>x.startsWith('rule add'));
 assert.deepEqual(adds,['rule add to 192.0.2.0/24 lookup 100 priority 99','rule add to 198.51.100.0/22 lookup 100 priority 99']);
 assert.ok(l.indexOf('rule del to 192.0.2.0/24 lookup 100')<l.indexOf(adds[0]))});
test('when the list cannot be fetched the last good one is used; with none, nothing is touched',{skip:bash},async()=>{
 const r=await run(null);r.go();assert.deepEqual(await r.lines(),[]);
 await writeFile(path.join(r.d,'vpn','telegram-nets'),'203.0.113.0/24\n');r.go();assert.ok((await r.lines()).includes('rule add to 203.0.113.0/24 lookup 100 priority 99'))});
