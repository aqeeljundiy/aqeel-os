// Tests for the bell's list (app/news.mjs): caps per audience, the rate limit on a person's app, keys, read and cleared
// per person. Run: node --test scripts/news.test.mjs (uses a scratch data folder)
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createNews,trim,fold,legacyGroup,eveningLine,CAPS,RATE} from '../app/news.mjs';

const dir=()=>mkdtempSync(path.join(tmpdir(),'aq-news-'));
const owner={id:'owner'},mem={id:'u1'},mem2={id:'u2'};

test('trim: each audience keeps its own newest, so one person can not push the admins\' history out',()=>{const now=Date.now();
 const items=[...Array.from({length:CAPS.person+50},(_,i)=>({aud:'u:u1',t:now-i})),...Array.from({length:10},(_,i)=>({aud:'admins',t:now-1000-i}))];
 const l=trim(items,now);assert.equal(l.filter(x=>x.aud==='admins').length,10);assert.equal(l.filter(x=>x.aud==='u:u1').length,CAPS.person)});
test('trim: nothing older than 30 days',()=>{const now=Date.now();assert.equal(trim([{aud:'admins',t:now-31*864e5},{aud:'admins',t:now}],now).length,1)});

test('keys: the same key lands once per audience and gives back the first item',async()=>{const D=dir();try{const n=createNews({DATA:D});
 const a=await n.add({aud:'admins',key:'k',title:'A',started:true}),b=await n.add({aud:'admins',key:'k',title:'A again',started:true});assert.equal(a.id,b.id);
 const c=await n.addOwn(mem,{key:'k',title:'mine',started:true});assert.notEqual(c.id,a.id);
 assert.equal((await n.list(owner,true)).length,1);assert.deepEqual((await n.list(mem,false)).map(x=>x.title),['mine'])}finally{rmSync(D,{recursive:true,force:true})}});

test('own items: only to the person, never another audience, and rate limited',async()=>{const D=dir();try{const n=createNews({DATA:D});
 const x=await n.addOwn(mem,{title:'t',aud:'admins',started:true});assert.ok(x);assert.equal((await n.list(owner,true)).length,0);assert.equal((await n.list(mem2,false)).length,0);
 for(let i=1;i<RATE.n;i++)await n.addOwn(mem,{title:'t'+i});
 await assert.rejects(()=>n.addOwn(mem,{title:'one too many'}),e=>e.status===429);
 assert.ok(await n.addOwn(mem2,{title:'someone else still may'}))}finally{rmSync(D,{recursive:true,force:true})}});

test('read and cleared are per person',async()=>{const D=dir();try{const n=createNews({DATA:D});const a=await n.add({aud:'admins',title:'news',started:true});
 const admin2={id:'a2'};await n.read(owner,true,{ids:[a.id]});assert.equal((await n.list(owner,true))[0].read,true);assert.equal((await n.list(admin2,true))[0].read,false);
 await n.hide(owner,true,{read:true});assert.equal((await n.list(owner,true)).length,0);assert.equal((await n.list(admin2,true)).length,1)}finally{rmSync(D,{recursive:true,force:true})}});

test('rate limit: only new items count, so duplicates never use it up',async()=>{const D=dir();try{const n=createNews({DATA:D});
 for(let i=0;i<RATE.n*2;i++)await n.addOwn(mem,{key:'same',title:'again'});
 for(let i=1;i<RATE.n;i++)await n.addOwn(mem,{key:'k'+i,title:'new '+i});
 await assert.rejects(()=>n.addOwn(mem,{key:'over',title:'one too many'}),e=>e.status===429)}finally{rmSync(D,{recursive:true,force:true})}});
test('import: once per person, at most 30, outside the limit; old news is Activity now',async()=>{const D=dir();try{const n=createNews({DATA:D});
 for(let i=0;i<RATE.n;i++)await n.addOwn(mem,{key:'x'+i,title:'t'});
 const items=Array.from({length:40},(_,i)=>({key:'old:'+i,title:'old '+i,read:i===0}));
 assert.equal(await n.importOwn(mem,items),30);assert.equal(await n.importOwn(mem,items),0);
 assert.equal((await n.list(mem,false)).length,0,'not in the bell');assert.ok((await n.activity(mem,false)).some(x=>x.key==='old:0'))}finally{rmSync(D,{recursive:true,force:true})}});

test('the bell holds only what you started; everything else is Activity',async()=>{const D=dir();try{const n=createNews({DATA:D});
 await n.add({aud:'admins',title:'Sela finished a run it started itself (4 min).'});await n.add({aud:'admins',title:'Your export is ready',started:true});
 assert.deepEqual((await n.list(owner,true)).map(x=>x.title),['Your export is ready']);assert.deepEqual((await n.activity(owner,true)).map(x=>x.title),['Sela finished a run it started itself (4 min).'])}finally{rmSync(D,{recursive:true,force:true})}});
test('one row per problem: Low on RAM updates in place with since and a count, and a resolved one starts fresh next time',async()=>{const D=dir();try{const n=createNews({DATA:D});
 for(let i=0;i<3;i++)await n.add({aud:'admins',group:'sys:memory',title:'The AI box is low on RAM',text:'free '+i+' GB'});
 let l=await n.activity(owner,true);assert.equal(l.length,1);assert.equal(l[0].count,3);assert.ok(l[0].since<=l[0].t);assert.equal(l[0].text,'free 2 GB');
 assert.equal(await n.resolve('sys:memory'),1);await n.add({aud:'admins',group:'sys:memory',title:'The AI box is low on RAM'});l=await n.activity(owner,true);assert.equal(l.length,2)}finally{rmSync(D,{recursive:true,force:true})}});
test('bell items expire after 7 days',async()=>{const D=dir();try{const n=createNews({DATA:D});const a=await n.add({aud:'admins',title:'old',started:true});
 (await n.activity(owner,true));const db=JSON.parse(JSON.stringify(await n.list(owner,true)));assert.equal(db.length,1);
 const {readFileSync,writeFileSync}=await import('node:fs');const f=path.join(D,'news.json');await new Promise(r=>setTimeout(r,50));const j=JSON.parse(readFileSync(f,'utf8'));j.items[0].t=Date.now()-8*864e5;writeFileSync(f,JSON.stringify(j));
 assert.equal((await createNews({DATA:D}).list(owner,true)).length,0)}finally{rmSync(D,{recursive:true,force:true})}});
test('first start: a week of 213 items fold into one row per problem, all in Activity, none in the bell',()=>{const now=Date.now();const items=[];
 for(let i=0;i<16;i++)items.push({aud:'u:owner',t:now-i*6e5,key:'sys:m'+i+'@1',title:'The AI box is low on RAM'});
 for(let i=0;i<19;i++)items.push({aud:'u:owner',t:now-i*6e5,key:'sys:r'+i+'@1',title:'Agents restarted for a moment'});
 for(let i=0;i<13;i++)items.push({aud:'admins',t:now-i*6e5,key:'ev|selfruns|x|'+i,title:'Cove Threads finished a run it started itself ('+(i+2)+' min). Reason: x'});
 const f=fold(items);assert.equal(f.length,3);assert.deepEqual(f.map(x=>x.count),[16,19,13]);assert.ok(f.every(x=>x.cls!=='started'));
 assert.equal(legacyGroup({title:'The AI box is low on RAM'}),'sys:memory')});
test('the evening line',()=>{assert.equal(eveningLine(12,0),'12 things fixed themselves today, nothing needs you');assert.equal(eveningLine(1,2),'1 thing fixed itself today, 2 things need you')});
