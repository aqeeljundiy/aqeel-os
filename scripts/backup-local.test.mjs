// Backups with no Google account (12 Nov 2026): the nightly backup stays on the box and is pruned by count, age and size;
// a failing openssl (full disk) is reported as itself, not as tar's exit 141 (SIGPIPE); one Health item when the newest good
// backup is more than 48 hours old.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,existsSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createBackups,pruneLocal,staleBackup,LOCAL_NAME,LEFTOVER} from '../app/backup.mjs';

const D=864e5;
test('pruneLocal: newest 3, none older than 14 days, under the size cap, the newest never',()=>{
 const now=Date.now(),f=(n,days,size=10)=>({name:n,size,at:now-days*D});
 assert.deepEqual(pruneLocal([f('a',1),f('b',2),f('c',3),f('d',4),f('e',5)],{now}),['d','e']);
 assert.deepEqual(pruneLocal([f('a',1),f('b',20)],{now}),['b']);
 assert.deepEqual(pruneLocal([f('a',20)],{now}),[],'the only backup stays however old');
 assert.deepEqual(pruneLocal([f('a',1,60),f('b',2,60),f('c',3,60)],{now,max:100}),['c','b']);
 assert.deepEqual(pruneLocal([f('a',1,500)],{now,max:100}),[],'the newest stays even over the cap');
 assert.deepEqual(pruneLocal([],{now}),[])});

test('stale: more than 48 hours since the newest good backup, or none since first looked',()=>{
 const now=Date.now();
 assert.equal(staleBackup(now-47*3600e3,0,now),null);assert.deepEqual(staleBackup(now-72*3600e3,0,now),{hours:72,never:false});
 assert.equal(staleBackup(0,now-10*3600e3,now),null);assert.deepEqual(staleBackup(0,now-60*3600e3,now),{hours:60,never:true});
 assert.equal(staleBackup(0,0,now),null)});

test('names',()=>{assert.ok(LOCAL_NAME.test('aqeelos-2026-11-12-03-00.tar.gz.enc'));assert.ok(!LOCAL_NAME.test('aqeelos-2026-11-12-03-00.tar.gz.enc.part'));
 for(const n of ['x.oerr','x.tcode','x.err','x.skipped'])assert.ok(LEFTOVER.test('aqeelos-2026-11-12-03-00.tar.gz.enc'+n.slice(1)),n)});

function scene(x={}){const T=mkdtempSync(path.join(tmpdir(),'aq-bklocal-')).split(path.sep).join('/'),HOME=T+'/home',H=HOME+'/.hermes',DATA=T+'/data',TMP=T+'/tmp';
 for(const d of [H,DATA,TMP,HOME+'/workspaces/a'])mkdirSync(d,{recursive:true});writeFileSync(H+'/config.yaml','x: 1\n'.repeat(50));writeFileSync(HOME+'/workspaces/a/notes.txt','hello');
 const told=[],solved=[];
 const b=createBackups({DATA,HOME,HERMES_HOME:H,TMP,MIN:1,fetchImpl:async()=>{throw Error('no network in tests')},disk:async()=>({free:1e12,dev:'d'}),notify:(...a)=>told.push(a),solved:()=>solved.push(1),...x});
 return {T,HOME,H,DATA,TMP,b,told,solved,LOCALDIR:HOME+'/aqeelos-local-backups',done:()=>rmSync(T,{recursive:true,force:true})}}

test('no Google: the backup is made on the box, encrypted, nobody told, and shows in the status',async()=>{const s=scene();try{
 await s.b.run('by hand');const l=readdirSync(s.LOCALDIR);assert.equal(l.length,1,l.join());assert.ok(LOCAL_NAME.test(l[0]));
 assert.deepEqual(readdirSync(s.TMP),[],'nothing left in /tmp');
 const st=await s.b.status();assert.equal(st.last.ok,true);assert.equal(st.last.local,true);assert.equal(st.local.count,1);assert.equal(st.local.active,true);assert.equal(st.stale,null);assert.deepEqual(s.told,[]);
 // a second and later ones: only the newest 3 stay
 for(let i=0;i<4;i++){const f=path.join(s.LOCALDIR,'aqeelos-2026-11-0'+(i+1)+'-03-00.tar.gz.enc');writeFileSync(f,'old');const t=new Date(Date.now()-(i+2)*3600e3);(await import('node:fs')).utimesSync(f,t,t)}
 await s.b.run('by hand');const after=readdirSync(s.LOCALDIR).sort();assert.equal(after.length,3,after.join())}finally{s.done()}});

test('a failing openssl is reported as itself, not as tar exit 141, and leaves nothing behind',async()=>{const s=scene();const bin=s.T+'/bin';mkdirSync(bin);
 writeFileSync(bin+'/openssl','#!/bin/sh\necho "error writing output file" >&2\nexit 1\n');chmodSync(bin+'/openssl',0o755);
 const was=process.env.PATH;process.env.PATH=bin+path.delimiter+was;
 try{await assert.rejects(()=>s.b.run('by hand'),e=>/encrypting the backup failed.*error writing output file/.test(e.message)&&!/141/.test(e.message),'the cause, not the SIGPIPE');
  assert.equal((await s.b.status()).last.ok,false);assert.deepEqual(readdirSync(s.TMP),[]);assert.deepEqual(readdirSync(s.LOCALDIR),[],'no half file')}
 finally{process.env.PATH=was;s.done()}});

test('a full disk is said before packing starts',async()=>{const s=scene({disk:async()=>({free:5e8,dev:'d'})});try{
 await assert.rejects(()=>s.b.run('by hand'),/Not enough free disk space/);assert.deepEqual(readdirSync(s.LOCALDIR),[])}finally{s.done()}});

test('Health: one item when the newest good backup is over 48 h old, again at most daily, gone when a backup works',async()=>{
 const s=scene();try{
  const old=Date.now()-60*3600e3;writeFileSync(s.DATA+'/backup-key','K'.repeat(40));writeFileSync(s.DATA+'/backups.json',JSON.stringify({since:old,lastOkAt:old,last:{at:old,ok:true}}));
  assert.equal((await s.b.status()).stale.hours,60);
  await s.b.staleCheck();await s.b.staleCheck();assert.equal(s.told.length,1,'told once');assert.match(s.told[0][0],/60 hours old/);
  await s.b.run('by hand');assert.equal((await s.b.status()).stale,null);await s.b.staleCheck();assert.ok(s.solved.length>=1,'the item goes when a backup works');
  // never made: counted from when aqeelOS first looked
  const s2=scene();writeFileSync(s2.DATA+'/backups.json',JSON.stringify({since:Date.now()-50*3600e3}));await s2.b.staleCheck();assert.match(s2.told[0][0],/No backup has been made yet/);s2.done()
 }finally{s.done()}});

// 12 Nov 2026: a box with little room left must not be filled to the brim by a backup (Elkiya went to 99% on 11 Nov). While packing,
// the free space is watched; below the limit the pipeline is killed, the cause is said, and no half file or note is left behind.
test('the disk watchdog stops a backup that is filling the disk, says so, and leaves nothing behind',{skip:process.platform==='win32'&&'process groups are Linux-only'},async()=>{
 let n=0;const s=scene({LOWFREE:1e9,WATCH:50,disk:async()=>({free:++n<2?1e12:2e8,dev:'d'})});const bin=s.T+'/bin';mkdirSync(bin);
 // a tar that never ends, so only the watchdog can stop it
 writeFileSync(bin+'/tar','#!/bin/sh\nwhile :; do head -c 100000 /dev/zero; sleep 0.05; done\n');chmodSync(bin+'/tar',0o755);
 const was=process.env.PATH;process.env.PATH=bin+path.delimiter+was;
 try{await assert.rejects(()=>s.b.run('by hand'),e=>/disk filled up while packing/.test(e.message)&&!/141/.test(e.message));
  assert.equal((await s.b.status()).last.ok,false);assert.deepEqual(readdirSync(s.TMP),[]);assert.deepEqual(readdirSync(s.LOCALDIR),[],'no half file, no notes')}
 finally{process.env.PATH=was;s.done()}});
