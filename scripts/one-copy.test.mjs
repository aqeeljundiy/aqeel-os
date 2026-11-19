// EN-13: a compressed chat keeps older generations of the same message in state.db (active=0, same message_uid).
// Our read-only readers must show each message once, like the engine's own views.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {oneCopy} from '../app/one-copy.mjs';

function chat(){
 const db=new DatabaseSync(':memory:');
 db.exec(`create table messages(id integer primary key,session_id text,role text,content text,timestamp real,message_uid text,active integer,compacted integer)`);
 const add=db.prepare('insert into messages(id,session_id,role,content,timestamp,message_uid,active,compacted) values(?,?,?,?,?,?,?,?)');
 // first generation, superseded by a compression
 add.run(1,'s','user','hello',100,'u1',0,1);add.run(2,'s','assistant','hi',101,'a1',0,0);
 add.run(3,'s','user','more feedback',200,'u2',0,0);add.run(4,'s','assistant','noted',201,'a2',0,0);
 // the compression's rewrite: summary carries a1's uid, folded copies (compacted=1), then the live tail (active=1)
 add.run(5,'s','assistant','[PRIOR CONTEXT]',300,'a1',0,1);add.run(6,'s','user','more feedback',200,'u2',0,1);
 add.run(7,'s','user','more feedback',200,'u2',1,0);add.run(8,'s','assistant','noted',300,'a2',1,0);
 // a message a rewind dropped: only an inactive, non-compacted copy is left
 add.run(9,'s','user','dropped',250,'u3',0,0);
 // after the compression, a single new row; another chat with the same uid stays separate
 add.run(10,'s','user','next',400,'u4',1,0);add.run(11,'t','user','other chat',400,'u4',1,0);
 return db;
}

test('a chat read shows each message once, in its first place, without the summary or rewound rows',()=>{
 const rows=chat().prepare(`select id,content from messages where session_id=? and ${oneCopy('session_id=?')} order by timestamp,id`).all('s','s');
 assert.deepEqual(rows.map(r=>r.id),[1,2,3,4,10]);
});

test('a time-bounded cross-chat count counts each person message once per chat',()=>{
 const rows=chat().prepare(`select m.id from messages m where m.role='user' and m.timestamp>? and ${oneCopy("role='user' and timestamp>?",'m.id')} order by m.id`).all(150,150);
 assert.deepEqual(rows.map(r=>r.id),[3,10,11]);
});

test('a message without a uid is never merged with another',()=>{
 const db=chat();db.prepare('insert into messages(id,session_id,role,content,timestamp,message_uid,active,compacted) values(?,?,?,?,?,?,?,?)').run(12,'s','user','a',500,null,1,0);
 db.prepare('insert into messages(id,session_id,role,content,timestamp,message_uid,active,compacted) values(?,?,?,?,?,?,?,?)').run(13,'s','user','b',501,null,1,0);
 const rows=db.prepare(`select id from messages where session_id=? and timestamp>=500 and ${oneCopy('session_id=?')}`).all('s','s');
 assert.deepEqual(rows.map(r=>r.id),[12,13]);
});

test('the chat readers that judge or show messages use the one-copy condition',()=>{
 for(const f of ['team-view','resume-engine','escalations'])assert.match(readFileSync(new URL(`../app/${f}.mjs`,import.meta.url),'utf8'),/\$\{oneCopy\(/,f);
});
