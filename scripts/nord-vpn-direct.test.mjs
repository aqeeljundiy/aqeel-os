// Owner, 18 Nov 2026: through Nord about 1 in 10 connections to Telegram timed out (voice notes to Donna were lost); direct, none did.
// Telegram's ranges skip the tunnel: a rule per range into table 100 (the normal route), put back on every connect.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp,writeFile,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';import path from 'node:path';import os from 'node:os';
const SH=new URL('./nord-vpn.sh',import.meta.url),src=await readFile(SH,'utf8');
test('every connect sends Telegram around Nord, right after incoming connections are kept on the normal route',()=>{
 assert.match(src,/inbound_stays \|\| \{[^\n]*\}\n  direct_routes\n/);
 for(const n of ['149.154.160.0/20','91.108.4.0/22','91.108.56.0/22'])assert.ok(src.includes(n),n)});
test('each range gets one rule into table 100, ahead of the mark rule; a rule left from before is replaced, not doubled',{skip:process.platform==='win32'&&'needs bash'},async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'nord-')),log=path.join(d,'log');
 await writeFile(path.join(d,'ip'),'#!/bin/bash\necho "$*" >> "'+log+'"\n');await chmod(path.join(d,'ip'),0o755);
 const fn=src.match(/^DIRECT_NETS=.*$/m)[0]+'\n'+src.match(/^direct_routes\(\)\{[\s\S]*?^\}/m)[0];
 execFileSync('bash',['-c',fn+'\ndirect_routes'],{env:{...process.env,PATH:d+':'+process.env.PATH}});
 const lines=(await readFile(log,'utf8')).trim().split('\n'),adds=lines.filter(l=>l.startsWith('rule add'));
 assert.equal(adds.length,9);assert.ok(adds.every(l=>/^rule add to \S+ lookup 100 priority 99$/.test(l)),adds.join('\n'));
 assert.equal(lines.filter(l=>l.startsWith('rule del')).length,9);assert.ok(lines.indexOf('rule del to 149.154.160.0/20 lookup 100')<lines.indexOf('rule add to 149.154.160.0/20 lookup 100 priority 99'))});
