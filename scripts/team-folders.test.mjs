// Tests for the team folders hub (app/team-folders.mjs): paths, members and rights, and real git over smart HTTP.
// Run: node --test scripts/team-folders.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {validId,gitPath,roleOf,may,cleanMembers,summarize,createTeamFolders} from '../app/team-folders.mjs';

test('ids and git paths: only the three smart HTTP paths of a 16-hex id',()=>{
 assert.ok(validId('0123456789abcdef'));for(const bad of ['','0123456789ABCDEF','0123456789abcde','../../etc/passwd','0123456789abcdef/..',null,42])assert.ok(!validId(bad));
 assert.deepEqual(gitPath('0123456789abcdef.git/info/refs'),{id:'0123456789abcdef',what:'info/refs'});assert.ok(gitPath('0123456789abcdef.git/git-receive-pack'));
 for(const bad of ['0123456789abcdef.git/objects/info/packs','0123456789abcdef.git/HEAD','../0123456789abcdef.git/info/refs','0123456789abcdef.git/../x/info/refs','0123456789abcdef.git/info/refs/../../config','%2e%2e/x.git/info/refs','0123456789abcdef.git/git-upload-pack/x','x.git/info/refs'])assert.equal(gitPath(bad),null,bad)});
test('members: owner manages, push members push, pull members only pull, others nothing',()=>{const f={owner:'aqeel',members:{rina:'push',budi:'pull',odd:'admin'}};
 assert.equal(roleOf(f,'aqeel'),'owner');assert.equal(roleOf(f,'odd'),null);assert.equal(roleOf(f,'stranger'),null);assert.equal(roleOf(f,''),null);
 assert.ok(may(f,'aqeel','push')&&may(f,'aqeel','manage'));assert.ok(may(f,'rina','push')&&!may(f,'rina','manage'));assert.ok(may(f,'budi','pull')&&!may(f,'budi','push'));
 for(const w of ['pull','push','manage'])assert.ok(!may(f,'stranger',w));assert.ok(!may(f,'rina','delete'))});
test('members list: known people with a role, never the owner',()=>{
 assert.deepEqual(cleanMembers([{uid:'rina',role:'push'},{uid:'aqeel',role:'push'},{uid:'x',role:'owner'},{uid:'../a',role:'pull'},{uid:'ghost',role:'pull'}],'aqeel',u=>u!=='ghost'),{rina:'push'})});
test('summary of a push',()=>{assert.equal(summarize([['M','index.html'],['M','css/styles.css']]),'Changed index.html and styles.css');
 assert.equal(summarize([['A','about.html'],['M','a'],['M','b'],['M','c'],['M','d'],['A','.code-team/chats/r/1.json']]),'Added about.html, changed 4 files, chats');assert.equal(summarize([]),'No file changes')});

// async on purpose: the stand-in server runs in this same process
const ENV={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'T',GIT_AUTHOR_EMAIL:'t@t',GIT_COMMITTER_NAME:'T',GIT_COMMITTER_EMAIL:'t@t'};
const tryGit=(cwd,...a)=>new Promise(r=>execFile('git',a,{cwd,env:ENV},(e,out,err)=>r({status:e?e.code||1:0,stdout:String(out),stderr:String(err)})));
const git=async(cwd,...a)=>{const r=await tryGit(cwd,...a);if(r.status)throw Error('git '+a.join(' ')+': '+r.stderr);return r.stdout};
test('real git over HTTP: push, pull, refusals and the history record',async()=>{const DATA=await mkdtemp(path.join(tmpdir(),'tf-'));const hub=createTeamFolders({DATA,names:u=>u.toUpperCase()});
 // a stand-in for aqeelOS: the person is the x-who header (aqeelOS uses the device key)
 const srv=createServer((req,res)=>{const u=new URL(req.url,'http://x');const who=String(req.headers['x-who']||'');if(!u.pathname.startsWith('/t/')){res.writeHead(404);return res.end()}hub.serve(req,res,who,u.pathname.slice(3),u.searchParams)});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+srv.address().port+'/t/';
 try{const f=await hub.create('aqeel',{name:'Site',members:[{uid:'rina',role:'push'},{uid:'budi',role:'pull'}],chats:true});
  const as=w=>['-c','http.extraHeader=x-who: '+w];
  const a=await mkdtemp(path.join(tmpdir(),'tfa-'));await git(a,'init','-q','-b','main');await writeFile(path.join(a,'index.html'),'<h1>hi</h1>\n');await git(a,'add','-A');await git(a,'commit','-qm','first');
  await git(a,...as('aqeel'),'push','-q',base+f.id+'.git','HEAD:refs/heads/main');
  const b=await mkdtemp(path.join(tmpdir(),'tfb-'));await git(b,...as('budi'),'clone','-q',base+f.id+'.git','.');assert.equal(await readFile(path.join(b,'index.html'),'utf8'),'<h1>hi</h1>\n');
  await writeFile(path.join(b,'index.html'),'<h1>budi</h1>\n');await git(b,'commit','-qam','budi');
  const no=await tryGit(b,...as('budi'),'push','-q','origin','HEAD:refs/heads/main');assert.notEqual(no.status,0);assert.match(no.stderr,/403|not push/);
  const stranger=await tryGit(b,...as('mallory'),'ls-remote',base+f.id+'.git');assert.notEqual(stranger.status,0);assert.match(stranger.stderr,/not found, or you are not in it/);
  const side=await tryGit(b,...as('aqeel'),'push','-q','origin','HEAD:refs/heads/other');assert.notEqual(side.status,0);assert.match(side.stderr,/one line of work/);
  // a rewrite of history is refused (no force pushes)
  await git(a,'commit','-q','--amend','-m','rewritten');await writeFile(path.join(a,'x.txt'),'x');await git(a,'add','-A');await git(a,'commit','-qm','x');
  const force=await tryGit(a,...as('aqeel'),'push','-q','-f',base+f.id+'.git','HEAD:refs/heads/main');assert.notEqual(force.status,0);
  // (a plain ../ is folded away by the client before it is sent; encoded ones reach the hub and are refused there)
  for(const bad of ['%2e%2e/'+f.id+'.git/info/refs?service=git-upload-pack',f.id+'.git%2f..%2f..%2fconfig','..%2f..%2fx.git/info/refs?service=git-upload-pack',f.id+'.git/config',f.id+'.git/objects/info/packs',f.id+'.git/info/refs?service=other']){const r=await fetch(base+bad,{headers:{'x-who':'aqeel'}});assert.equal(r.status,404,bad)}
  const h=await hub.history(f.id,'budi');assert.equal(h.length,1);assert.equal(h[0].user,'aqeel');assert.equal(h[0].name,'AQEEL');assert.equal(h[0].summary,'Added index.html');
  await assert.rejects(hub.history(f.id,'mallory'),/not found/);await assert.rejects(hub.update(f.id,'rina',{members:[]}),/Only/);
  assert.equal((await hub.list('budi')).length,1);assert.equal((await hub.list('mallory')).length,0);assert.equal((await hub.list('mallory',{all:true})).length,1);
  await hub.unshare(f.id,'aqeel');assert.equal((await hub.list('aqeel')).length,0)}
 finally{srv.close()}});
