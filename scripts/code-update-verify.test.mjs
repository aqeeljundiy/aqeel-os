// Security audit H-7 (12 Nov 2026): Code on a person's computer unpacks an update only when every file is what GitHub's
// main holds for that version. A changed file, an extra file, a version that is not on main, or no answer from GitHub: refused.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {verifyUpdate,blobSha,repoIn} from '../code/update-verify.mjs';
const V='8201603e6487',SHA=V+'0'.repeat(28),TREE='1'.repeat(40),CODE='2'.repeat(40),BASE='https://ai.example.com';
const FILES=[['server.mjs',Buffer.from('console.log(1)\n')],['desktop/main.cjs',Buffer.from('// main\n')]];
const cfg=(o={})=>['aqeelos.json',Buffer.from(JSON.stringify({aqeelos:{base:BASE,origins:[BASE],version:V,...o}}))];
const github=(o={})=>async url=>{const p=url.replace(/^.*\/repos\/[^/]+\/[^/]+/,'');const j=(b,status=200)=>({ok:status<300,status,json:async()=>b});
 if(o.down)throw new Error('offline');
 if(p==='/commits/'+V)return o.unknown?j({},404):j({sha:SHA,commit:{tree:{sha:TREE}}});
 if(p==='/compare/'+SHA+'...main')return j(o.compare||{status:'ahead',behind_by:0});
 if(p==='/git/trees/'+TREE)return j({tree:[{path:'app',type:'tree',sha:'9'.repeat(40)},{path:'code',type:'tree',sha:CODE}]});
 if(p==='/git/trees/'+CODE+'?recursive=1')return j({truncated:!!o.truncated,tree:FILES.map(([path,d])=>({path,type:'blob',sha:blobSha(d)}))});
 return j({},404)};
const check=(files,o)=>verifyUpdate(files,V,BASE,{fetchFn:github(o),repo:'o/r',api:'https://api.example'});

test('git\'s content hash',()=>assert.equal(blobSha(Buffer.from('hello\n')),'ce013625030ba8dba906f756967f9e9ca394464a'));
test('an update that is exactly GitHub\'s files for that version passes',async()=>{assert.equal(await check([...FILES,cfg()]),2);assert.equal(await check([FILES[0],cfg()],{compare:{status:'identical',behind_by:0}}),1)});
test('a changed file, an extra file, a path trick or another address in the settings file is refused',async()=>{
 await assert.rejects(check([['server.mjs',Buffer.from('evil()\n')],FILES[1],cfg()]),/differs/);
 await assert.rejects(check([...FILES,['evil.mjs',Buffer.from('x')],cfg()]),/not part of this version/);
 await assert.rejects(check([...FILES,['../x',Buffer.from('x')]]),/not allowed/);await assert.rejects(check([...FILES,['a\\..\\x',Buffer.from('x')]]),/not allowed/);
 await assert.rejects(check([...FILES,cfg({base:'https://evil.example'})]),/another address/);await assert.rejects(check([...FILES,cfg({origins:[BASE,'https://evil.example']})]),/another address/);
 await assert.rejects(check([...FILES,cfg({extra:1})]),/another address/);await assert.rejects(check([...FILES,cfg({repo:'evil/fork'})]),/another address/,'an update cannot move the app to another repository');assert.equal(await check([...FILES,cfg({repo:'o/r'})]),2);
 await assert.rejects(verifyUpdate([...FILES,cfg()],V,BASE,{fetchFn:github(),repo:''}),/does not know which GitHub repository/);assert.equal(repoIn([cfg({repo:'o/r'})]),'o/r');assert.equal(repoIn([cfg({repo:'../x'})]),'');await assert.rejects(check([cfg()]),/empty/)});
test('a version that is not on main, that GitHub does not know, or that cannot be checked is refused',async()=>{
 await assert.rejects(check([...FILES,cfg()],{compare:{status:'diverged',behind_by:3}}),/not on the main branch/);await assert.rejects(check([...FILES,cfg()],{compare:{status:'behind',behind_by:2}}),/not on the main branch/);
 await assert.rejects(check([...FILES,cfg()],{unknown:true}),/did not confirm/);await assert.rejects(check([...FILES,cfg()],{down:true}),/could not be reached/);await assert.rejects(check([...FILES,cfg()],{truncated:true}),/incomplete/);
 await assert.rejects(verifyUpdate(FILES,'main',BASE,{fetchFn:github(),repo:'o/r'}),/not a commit id/)});
test('the app checks before it writes a single file',async()=>{const s=await readFile(new URL('../code/aqeelos.mjs',import.meta.url),'utf8');
 const at=s.indexOf('await verifyUpdate('),wr=s.indexOf('await writeFile(to,data)');assert.ok(at>0&&wr>at,'verifyUpdate runs before the first write');
 const c=await readFile(new URL('../app/code.mjs',import.meta.url),'utf8');assert.match(c,/repo:UPDATE_REPO/,'the server names its source repository in the install')});
