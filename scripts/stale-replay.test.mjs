// Tests for app/stale-replay.mjs: an old pinned "STILL IN PROGRESS" request is removed only when newer messages exist and it is 6+ h old.
// Run: node --test scripts/stale-replay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {staleReplays} from '../app/stale-replay.mjs';

const HDR='[STILL IN PROGRESS — this is the active request, restated after the compaction boundary because it was not finished yet. Continue it; do not start over.]';
const hasPy=spawnSync('python3',['-c','import sqlite3']).status===0;

async function makeHome(rows){
  const home=await mkdtemp(path.join(tmpdir(),'stale-'));await mkdir(path.join(home,'profiles','a'),{recursive:true});
  const db=path.join(home,'profiles','a','state.db');
  const py=`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1])
c.execute("create table sessions(id text, source text, ended_at real)")
c.execute("create table messages(id integer primary key, session_id text, role text, content text, timestamp real, active int)")
c.execute("insert into sessions values('s1','telegram',null)")
for r in json.loads(sys.argv[2]): c.execute("insert into messages(id,session_id,role,content,timestamp,active) values(?,?,?,?,?,1)",r)
c.commit()`;
  assert.equal(spawnSync('python3',['-c',py,db,JSON.stringify(rows)]).status,0);
  return {home,db};
}
const read=(db,id)=>String(spawnSync('python3',['-c','import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute("select content from messages where id=?",(int(sys.argv[2]),)).fetchone()[0])',db,String(id)]).stdout);
const old=Date.now()/1000-8*86400;

test('a days-old pinned order is removed once the person has written since (continue-threads, 29 Nov 2026)',{skip:!hasPy},async()=>{
  const {home,db}=await makeHome([[1,'s1','user','summary text\n--- END OF CONTEXT SUMMARY ---\n\n'+HDR+'\n[AJ] i need you to push now',old],[2,'s1','user','[AJ] pause threads comenting and post for now',old+7*86400]]);
  const r=await staleReplays({hermesHome:home,backup:path.join(home,'b.jsonl')});
  assert.equal(r.items.length,1);assert.equal(r.items[0].fixed,true);assert.match(r.items[0].pinned,/push now/);
  const after=read(db,1);assert.doesNotMatch(after,/STILL IN PROGRESS|push now/);assert.match(after,/END OF CONTEXT SUMMARY/);
  assert.match(await readFile(path.join(home,'b.jsonl'),'utf8'),/push now/);
});
test('kept when nothing newer was written, or when only aqeelOS team notices followed',{skip:!hasPy},async()=>{
  const {home,db}=await makeHome([[1,'s1','user','sum\n\n'+HDR+'\n[AJ] do X',old],[2,'s1','user','[Posted in this topic by aqeelOS, for the team; you did not write it] alert',old+3600*20]]);
  const r=await staleReplays({hermesHome:home,backup:path.join(home,'b.jsonl')});
  assert.equal(r.items.length,0);assert.match(read(db,1),/STILL IN PROGRESS/);
});
test('kept while the pin is younger than 6 hours',{skip:!hasPy},async()=>{
  const now=Date.now()/1000;
  const {home,db}=await makeHome([[1,'s1','user','sum\n\n'+HDR+'\n[AJ] do X',now-3600],[2,'s1','user','[AJ] and also Y',now-60]]);
  const r=await staleReplays({hermesHome:home,backup:path.join(home,'b.jsonl')});
  assert.equal(r.items.length,0);assert.match(read(db,1),/STILL IN PROGRESS/);
});
