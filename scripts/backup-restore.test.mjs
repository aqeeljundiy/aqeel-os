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
