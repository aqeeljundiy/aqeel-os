// Tests for the bell's list (app/news.mjs): caps per audience, the rate limit on a person's app, keys, read and cleared
// per person. Run: node --test scripts/news.test.mjs (uses a scratch data folder)
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createNews,trim,CAPS,RATE} from '../app/news.mjs';

const dir=()=>mkdtempSync(path.join(tmpdir(),'aq-news-'));
const owner={id:'owner'},mem={id:'u1'},mem2={id:'u2'};

test('trim: each audience keeps its own newest, so one person can not push the admins\' history out',()=>{const now=Date.now();
 const items=[...Array.from({length:CAPS.person+50},(_,i)=>({aud:'u:u1',t:now-i})),...Array.from({length:10},(_,i)=>({aud:'admins',t:now-1000-i}))];
 const l=trim(items,now);assert.equal(l.filter(x=>x.aud==='admins').length,10);assert.equal(l.filter(x=>x.aud==='u:u1').length,CAPS.person)});
test('trim: nothing older than 30 days',()=>{const now=Date.now();assert.equal(trim([{aud:'admins',t:now-31*864e5},{aud:'admins',t:now}],now).length,1)});

test('keys: the same key lands once per audience and gives back the first item',async()=>{const D=dir();try{const n=createNews({DATA:D});
 const a=await n.add({aud:'admins',key:'k',title:'A'}),b=await n.add({aud:'admins',key:'k',title:'A again'});assert.equal(a.id,b.id);
 const c=await n.addOwn(mem,{key:'k',title:'mine'});assert.notEqual(c.id,a.id);
 assert.equal((await n.list(owner,true)).length,1);assert.deepEqual((await n.list(mem,false)).map(x=>x.title),['mine'])}finally{rmSync(D,{recursive:true,force:true})}});

test('own items: only to the person, never another audience, and rate limited',async()=>{const D=dir();try{const n=createNews({DATA:D});
 const x=await n.addOwn(mem,{title:'t',aud:'admins'});assert.ok(x);assert.equal((await n.list(owner,true)).length,0);assert.equal((await n.list(mem2,false)).length,0);
 for(let i=1;i<RATE.n;i++)await n.addOwn(mem,{title:'t'+i});
 await assert.rejects(()=>n.addOwn(mem,{title:'one too many'}),e=>e.status===429);
 assert.ok(await n.addOwn(mem2,{title:'someone else still may'}))}finally{rmSync(D,{recursive:true,force:true})}});

test('read and cleared are per person',async()=>{const D=dir();try{const n=createNews({DATA:D});const a=await n.add({aud:'admins',title:'news'});
 const admin2={id:'a2'};await n.read(owner,true,{ids:[a.id]});assert.equal((await n.list(owner,true))[0].read,true);assert.equal((await n.list(admin2,true))[0].read,false);
 await n.hide(owner,true,{read:true});assert.equal((await n.list(owner,true)).length,0);assert.equal((await n.list(admin2,true)).length,1)}finally{rmSync(D,{recursive:true,force:true})}});

test('rate limit: only new items count, so duplicates never use it up',async()=>{const D=dir();try{const n=createNews({DATA:D});
 for(let i=0;i<RATE.n*2;i++)await n.addOwn(mem,{key:'same',title:'again'});
 for(let i=1;i<RATE.n;i++)await n.addOwn(mem,{key:'k'+i,title:'new '+i});
 await assert.rejects(()=>n.addOwn(mem,{key:'over',title:'one too many'}),e=>e.status===429)}finally{rmSync(D,{recursive:true,force:true})}});
test('import: once per person, at most 30, outside the limit, read ones stay read',async()=>{const D=dir();try{const n=createNews({DATA:D});
 for(let i=0;i<RATE.n;i++)await n.addOwn(mem,{key:'x'+i,title:'t'});
 const items=Array.from({length:40},(_,i)=>({key:'old:'+i,title:'old '+i,read:i===0}));
 assert.equal(await n.importOwn(mem,items),30);assert.equal(await n.importOwn(mem,items),0);
 const l=await n.list(mem,false);assert.equal(l.find(x=>x.key==='old:0').read,true);assert.equal(l.find(x=>x.key==='old:1').read,false)}finally{rmSync(D,{recursive:true,force:true})}});
