// Tests for the restore rules (app/backup.mjs restoreRules, dbFiles, spaceNeeded). Run: node --test scripts/backup-restore.test.mjs
// When rsync is installed, the rules are also tried on two scratch folders: what the backup holds comes back, nothing
// on the box is deleted, and the parts a backup leaves out are not copied (at any depth, like tar's patterns).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {restoreRules,dbFiles,spaceNeeded} from '../app/backup.mjs';

test('rules: never delete, no sockets or devices',()=>{const r=restoreRules();
 assert.ok(!r.some(x=>x.startsWith('--delete')));assert.ok(r.includes('--no-specials'));assert.ok(r.includes('--no-devices'));
 for(const x of ['*.pid','*.lock','*.sock'])assert.ok(r.includes('--exclude='+x),x)});
test('rules: tar patterns become rsync ones (* across folders becomes **, .hermes/ is anchored at the top)',()=>{
 const r=restoreRules(['.hermes/installs','.hermes/profiles/*/cache','*/home/.cache','*.log','node_modules','apps/hermes-ui-data/desktop','workspaces/.aqeelos-python','.claude/projects']);
 assert.deepEqual(r.filter(x=>x.startsWith('--exclude=')&&!/\*\.(pid|lock|sock)$/.test(x)),['--exclude=/installs','--exclude=/profiles/**/cache','--exclude=**/home/.cache','--exclude=*.log','--exclude=node_modules'])});
test('databases: the backup\'s .db and .sqlite files',()=>{assert.deepEqual(dbFiles(['state.db','profiles/a/state.db','x.sqlite','y.sqlite3','state.db-wal','notes.md']),['state.db','profiles/a/state.db','x.sqlite','y.sqlite3'])});
test('space: download plus unpacked plus the safety copy, together when one disk',()=>{const a=spaceNeeded(9e9,false),b=spaceNeeded(9e9,true);
 assert.equal(a.tmp,9e9*3+2e9);assert.equal(a.home,9e9*1.2+1e9);assert.equal(b.tmp,a.tmp+a.home);assert.equal(b.home,b.tmp)});

let rsync=true;try{execFileSync('rsync',['--version'],{stdio:'ignore'})}catch{rsync=false}
test('rsync: restores what the backup holds, keeps what it does not, copies no left-out part',{skip:!rsync&&'rsync is not installed'},()=>{
 const T=mkdtempSync(path.join(tmpdir(),'aq-restore-')),src=path.join(T,'b'),dst=path.join(T,'h');const w=(f,t)=>{mkdirSync(path.dirname(f),{recursive:true});writeFileSync(f,t)};
 try{w(path.join(src,'config.yaml'),'old');w(path.join(src,'profiles/a/config.yaml'),'old-a');w(path.join(src,'profiles/a/deep/x/cache/c'),'c');w(path.join(src,'profiles/a/cache/c'),'c');
  w(path.join(src,'installs/i'),'i');w(path.join(src,'gateway.pid'),'1');w(path.join(src,'logs/agent.log'),'l');
  w(path.join(dst,'config.yaml'),'new');w(path.join(dst,'profiles/b/config.yaml'),'made after');w(path.join(dst,'profiles/a/skill.md'),'made after');w(path.join(dst,'gateway.pid'),'2');
  execFileSync('rsync',[...restoreRules(),src+'/',dst+'/']);
  assert.equal(readFileSync(path.join(dst,'config.yaml'),'utf8'),'old');assert.equal(readFileSync(path.join(dst,'profiles/a/config.yaml'),'utf8'),'old-a');
  assert.ok(existsSync(path.join(dst,'profiles/b/config.yaml')),'an agent made after the backup stays');assert.ok(existsSync(path.join(dst,'profiles/a/skill.md')),'a file made after stays');
  assert.equal(readFileSync(path.join(dst,'gateway.pid'),'utf8'),'2');
  for(const x of ['profiles/a/deep/x/cache/c','profiles/a/cache/c','installs/i','logs/agent.log'])assert.ok(!existsSync(path.join(dst,x)),x+' is not copied')}
 finally{rmSync(T,{recursive:true,force:true})}});

/* applyRestore (the part that changes the box) on scratch folders: a .hermes of today with a database and its -wal, and a
   backup with older files. Agents stopping and starting are counted. */
import {applyRestore} from '../app/backup.mjs';
import {chmodSync,readdirSync} from 'node:fs';
function box(){const T=mkdtempSync(path.join(tmpdir(),'aq-apply-')),HOME=path.join(T,'home'),H=path.join(HOME,'.hermes'),src=path.join(T,'b','.hermes');const w=(f,t)=>{mkdirSync(path.dirname(f),{recursive:true});writeFileSync(f,t)};
 w(path.join(H,'config.yaml'),'today');w(path.join(H,'state.db'),'db today');w(path.join(H,'state.db-wal'),'wal today');w(path.join(H,'profiles/new/config.yaml'),'made after');
 w(path.join(src,'config.yaml'),'backup');w(path.join(src,'state.db'),'db backup!');
 const n={stop:0,start:0};const script=(name,body)=>{const f=path.join(T,name);writeFileSync(f,'#!/bin/sh\n'+body+'\n');chmodSync(f,0o755);return f};
 return {T,HOME,H,src,n,script,stopEngine:async()=>{n.stop++},startEngine:async()=>{n.start++},read:f=>readFileSync(path.join(H,f),'utf8'),done:()=>rmSync(T,{recursive:true,force:true})}}
// the box has GNU tar; a Mac's bsdtar lacks --ignore-failed-read, so here a small stand-in leaves that one option out
let gnu=true;try{gnu=/GNU/.test(execFileSync('tar',['--version'],{encoding:'utf8'}))}catch{}
const opts=(b,x={})=>({src:b.src,HERMES_HOME:b.H,HOME:b.HOME,stopEngine:b.stopEngine,startEngine:b.startEngine,...(gnu?{}:{tar:b.script('tar-gnuish','for a; do shift; [ "$a" = --ignore-failed-read ] || set -- "$@" "$a"; done; exec tar "$@"')}),...x});
test('apply: rsync missing stops before anything (agents keep running, -wal untouched)',async()=>{const b=box();try{
 await assert.rejects(()=>applyRestore(opts(b,{rsync:'/no/such/rsync'})),/rsync is not installed/);
 assert.deepEqual(b.n,{stop:0,start:0});assert.equal(b.read('state.db-wal'),'wal today');assert.equal(b.read('config.yaml'),'today')}finally{b.done()}});
test('apply: agents that do not stop: nothing changes, they start again',async()=>{const b=box();try{
 await assert.rejects(()=>applyRestore(opts(b,{stopEngine:async()=>{throw Error('the dashboard still answers')}})),/did not stop/);
 assert.equal(b.n.start,1);assert.equal(b.read('state.db-wal'),'wal today');assert.equal(b.read('config.yaml'),'today')}finally{b.done()}});
test('apply: a safety copy that fails leaves no half file and changes nothing',async()=>{const b=box();try{
 const tar=b.script('tar','echo half > "$2"; exit 2');
 await assert.rejects(()=>applyRestore(opts(b,{tar})),/could not be saved first/);
 assert.deepEqual(readdirSync(b.HOME).filter(f=>f.startsWith('aqeelos-before-restore')),[]);assert.equal(b.read('state.db-wal'),'wal today');assert.deepEqual(b.n,{stop:1,start:1})}finally{b.done()}});
test('apply: rsync that fails halfway puts today back, -wal included',{skip:!rsync&&'rsync is not installed'},async()=>{const b=box();try{
 // copies one file of the backup, then fails like a permission error (exit 23)
 const bad=b.script('rsync','for a; do p="$q"; q="$a"; done; cp "${p}config.yaml" "${q}config.yaml"; exit 23');
 await assert.rejects(()=>applyRestore(opts(b,{rsync:bad})),/were put back/);
 assert.equal(b.read('config.yaml'),'today');assert.equal(b.read('state.db'),'db today');assert.equal(b.read('state.db-wal'),'wal today');
 assert.ok(!existsSync(path.join(b.H,'state.db-wal.aqeelos-held')));assert.deepEqual(b.n,{stop:1,start:1})}finally{b.done()}});
test('apply: success copies the backup, drops today\'s -wal, keeps agents made after, keeps two safety copies',{skip:!rsync&&'rsync is not installed'},async()=>{const b=box();try{
 for(let i=0;i<3;i++){const r=await applyRestore(opts(b,{at:Date.UTC(2026,10,1,1,0,i)}));assert.ok(existsSync(r.safety))}
 assert.equal(b.read('config.yaml'),'backup');assert.equal(b.read('state.db'),'db backup!');assert.ok(!existsSync(path.join(b.H,'state.db-wal')));assert.ok(!existsSync(path.join(b.H,'state.db-wal.aqeelos-held')));
 assert.equal(b.read('profiles/new/config.yaml'),'made after');assert.equal(readdirSync(b.HOME).filter(f=>/^aqeelos-before-restore-.*\.tar\.gz$/.test(f)).length,2);assert.deepEqual(b.n,{stop:3,start:3})}finally{b.done()}});
