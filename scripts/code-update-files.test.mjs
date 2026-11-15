// 15 Nov 2026: no installed Code app had updated since 12 Nov. The box's Code copy holds VERSION (box-live.sh writes it)
// and a file a later commit deleted (a tar only adds), aqeelOS zipped the whole folder, and the app refuses an update with
// any file GitHub does not list (update-verify.mjs): "VERSION is not part of this version on GitHub". aqeelOS now sends
// only the files the last deploy unpacked (.deploy-files), never VERSION; this checks the server's zip against the app's check.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createCode,sourceFiles} from '../app/code.mjs';import {verifyUpdate,blobSha} from '../code/update-verify.mjs';
const V='8201603e6487',SHA=V+'0'.repeat(28),TREE='1'.repeat(40),CODE='2'.repeat(40),BASE='https://ai.example.com';
const GIT=[['server.mjs','console.log(1)\n'],['assets/icon.svg','<svg/>\n']];
const github=async url=>{const p=url.replace(/^.*\/repos\/[^/]+\/[^/]+/,'');const j=b=>({ok:true,status:200,json:async()=>b});
 if(p==='/commits/'+V)return j({sha:SHA,commit:{tree:{sha:TREE}}});if(p==='/compare/'+SHA+'...main')return j({status:'identical',behind_by:0});
 if(p==='/git/trees/'+TREE)return j({tree:[{path:'code',type:'tree',sha:CODE}]});
 if(p==='/git/trees/'+CODE+'?recursive=1')return j({truncated:false,tree:GIT.map(([path,d])=>({path,type:'blob',sha:blobSha(Buffer.from(d))}))});return {ok:false,status:404,json:async()=>({})}};
const unzip=buf=>{const out=[];let i=0;while(i+30<=buf.length&&buf.readUInt32LE(i)===0x04034b50){const size=buf.readUInt32LE(i+18),nl=buf.readUInt16LE(i+26),xl=buf.readUInt16LE(i+28);const name=buf.slice(i+30,i+30+nl).toString();const s=i+30+nl+xl;out.push([name,buf.slice(s,s+size)]);i=s+size}return out};
async function box({list}){const D=await mkdtemp(path.join(tmpdir(),'cuf-'));const SRC=path.join(D,'aqeel-code');
 for(const [n,d] of GIT){await mkdir(path.dirname(path.join(SRC,n)),{recursive:true});await writeFile(path.join(SRC,n),d)}
 await writeFile(path.join(SRC,'VERSION'),V+'\n');await writeFile(path.join(SRC,'assets','deleted-long-ago.svg'),'<svg old/>');
 if(list)await writeFile(path.join(SRC,'.deploy-files'),GIT.map(([n])=>'code/'+n).join('\n')+'\ncode/\ncode/assets/\n');
 return {D,SRC,code:createCode({DATA:path.join(D,'data'),SRC,PUBLIC_URL:BASE,ROOT:D})}}

test('the update a computer fetches passes the app\'s own GitHub check: no VERSION, no file a deploy left behind',async()=>{
 const {code}=await box({list:true});const u=await code.update();const files=unzip(u.zip);
 assert.deepEqual(files.map(f=>f[0]).sort(),['aqeelos.json','assets/icon.svg','server.mjs']);
 const repo=JSON.parse(files.find(f=>f[0]==='aqeelos.json')[1]).aqeelos.repo;assert.equal(await verifyUpdate(files,V,BASE,{fetchFn:github,repo,api:'https://api.example'}),2)});
test('a copy without the deploy\'s list still never sends VERSION',async()=>{const {SRC}=await box({list:false});
 const names=(await sourceFiles(SRC)).map(f=>f[0]).sort();assert.ok(!names.includes('VERSION')&&!names.includes('.deploy-files'));assert.ok(names.includes('server.mjs'))});
test('the deploy writes the list of what it unpacked next to VERSION',async()=>{const s=await readFile(new URL('./box-live.sh',import.meta.url),'utf8');
 const i=s.indexOf('tar -xzf $CT -C $C');const line=s.slice(i,s.indexOf('\n',i));assert.match(line,/tar -tzf \$CT .*> \$C\/\.deploy-files\.new && mv \$C\/\.deploy-files\.new \$C\/\.deploy-files/);assert.ok(line.indexOf('.deploy-files')<line.indexOf('rm -f $CT'),'listed before the archive is removed')});
