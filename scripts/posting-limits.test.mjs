// Tests for app/posting-limits.mjs. Run: node --test scripts/posting-limits.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {decide,gateText,clean,seen,needle,local,createPostingLimits} from '../app/posting-limits.mjs';

// Cove Threads' rules (70 a day, 90% hot, max 5 an hour, 5 min apart, lighter 01-05 WIB)
const R=clean({tz:'Asia/Jakarta',on:true,perDay:70,perHour:5,gapMin:5,perRun:2,quietFrom:1,quietTo:5,quietPerHour:2,hotShare:90,afterMissingPerHour:2,afterMissingHours:6,stopFile:'.tools/STOP_COMMENTS',checkUrl:'https://www.threads.com/@x/replies',alert:'telegram:-100123'});
const at=(hhmm,day='05')=>Date.parse('2026-11-'+day+'T'+hhmm+':00+07:00');
const posts=(times,lead='hot')=>times.map(t=>({at:t,lead,status:'visible'}));

test('days are counted in the agent\'s time zone',()=>{
 assert.equal(local(at('00:30'),'Asia/Jakarta').date,'2026-11-05');assert.equal(local(at('00:30'),'Asia/Jakarta').hour,0);
 const l=posts([at('23:50','04')]);assert.equal(decide(R,l,{now:at('00:10')}).today,0)});

test('a free slot allows up to the run limit',()=>{const d=decide(R,[],{now:at('10:00')});assert.equal(d.allow,true);assert.equal(d.n,2)});

test('never two within the gap, max per hour, max per day',()=>{
 assert.equal(decide(R,posts([at('09:57')]),{now:at('10:00')}).allow,false);
 const five=posts([at('09:10'),at('09:20'),at('09:30'),at('09:40'),at('09:50')]);const d=decide(R,five,{now:at('10:00')});assert.equal(d.allow,false);assert.match(d.reason,/last hour/);
 const four=five.slice(1);assert.equal(decide(R,four,{now:at('10:00')}).n,1);
 const day=posts(Array.from({length:70},(_,i)=>at('08:00')+i*60e3));assert.match(decide(R,day,{now:at('20:00')}).reason,/Done for today: 70 of 70/)});

test('lighter at night: 2 an hour between 01:00 and 05:00',()=>{const two=posts([at('02:00'),at('02:20')]);
 assert.equal(decide(R,two,{now:at('02:40')}).allow,false);assert.equal(decide(R,posts([at('05:00')]),{now:at('05:20')}).n,2)});

test('the pause file stops everything',()=>{const d=decide(R,[],{now:at('10:00'),stopped:true});assert.equal(d.allow,false);assert.match(d.reason,/STOP_COMMENTS/)});

test('a post that was not visible slows down for 6 hours',()=>{const l=[{at:at('08:00'),lead:'hot',status:'missing',missingAt:at('08:01')},...posts([at('09:30'),at('09:40')])];
 assert.equal(decide(R,l,{now:at('10:00')}).allow,false);assert.equal(decide(R,l.slice(0,1),{now:at('15:00')}).n,2)});

test('hot share below target asks for hot leads only',()=>{const l=[...posts(Array.from({length:8},(_,i)=>at('06:00')+i*600e3)),...posts([at('08:00'),at('08:10')],'warm')];
 const d=decide(R,l,{now:at('10:00')});assert.equal(d.share,80);assert.equal(d.needHot,true);assert.match(gateText(R,d),/only to HOT leads/)});

test('a skipped run ends with the engine\'s wake gate',()=>{const t=gateText(R,decide(R,[],{now:at('10:00'),stopped:true}));assert.equal(t.trim().split('\n').pop(),'{"wakeAgent": false}');
 assert.doesNotMatch(gateText(R,decide(R,[],{now:at('10:00')})),/wakeAgent/)});

test('the comment is found on the public page by its words, whatever Threads does to spaces and emoji',()=>{
 const text='wah 3 bulan konsisten itu udah keren kak 🙌\n\ndi komunitas emang lumayan banyak yg cerita';
 assert.ok(seen('continue.products\n4m\nwah 3 bulan konsisten itu udah keren kak🙌\ndi komunitas...',text));
 assert.ok(!seen('continue.products\nsomething else entirely',text));assert.equal(needle('ok'),'ok')});

test('rules are checked',()=>{assert.throws(()=>clean({stopFile:'../x'}));assert.throws(()=>clean({alert:'whatsapp:1'}));assert.throws(()=>clean({checkUrl:'http://x'}));assert.equal(clean({perHour:999}).perHour,60)});

async function rig({pages,stop=false}){const dir=await mkdtemp(path.join(tmpdir(),'pl-'));const DATA=path.join(dir,'data'),WORK=path.join(dir,'ws'),HH=path.join(dir,'hermes');
 if(stop){await mkdir(path.join(WORK,'ct','.tools'),{recursive:true});await writeFile(path.join(WORK,'ct','.tools','STOP_COMMENTS'),'')}
 let t=at('10:00');const events=[],tg=[],keys=[];let n=0;
 const pl=createPostingLimits({DATA,WORK,HERMES_HOME:HH,PORT:4400,sig:a=>'sig-'+a,setKey:async(a,k,v)=>{keys.push([a,k,v]);return {ok:true}},readConfig:async()=>({cron:{max_parallel_jobs:keys.length?Number(keys.at(-1)[2]):null}}),pick:(o,k)=>k.split('.').reduce((x,y)=>x?.[y],o),
  look:async u=>{const p=pages[Math.min(n++,pages.length-1)];if(p instanceof Error)throw p;return p},event:async(...x)=>events.push(x),telegram:async(...x)=>{tg.push(x);return true},log:()=>{},now:()=>t,retryMs:0});
 return {pl,dir,HH,events,tg,keys,tick:ms=>{t+=ms}}}

test('Run rules: one at a time and the gate script',async()=>{const {pl,HH,keys}=await rig({pages:['']});
 const v=await pl.set('ct',{serial:true,rules:R});assert.deepEqual(keys[0],['ct','cron.max_parallel_jobs','1']);assert.equal(v.serial,true);
 const s=await readFile(path.join(HH,'profiles','ct','scripts','aqeelos-posting-gate.sh'),'utf8');assert.match(s,/127\.0\.0\.1:4400\/posting-gate\/ct\/sig-ct/);assert.match(s,/wakeAgent": false/);
 assert.match(await pl.gate('ct'),/This run: post at most 2/)});

test('record_post: visible is confirmed; not visible alerts the owner and fails the run',async()=>{
 const text='banyak yg nanya ini kak, patokannya simpel: brandnya jelas';
 let x=await rig({pages:['continue.products\n'+text]});await x.pl.set('ct',{rules:R});
 let r=await x.pl.record('ct',{post_url:'https://www.threads.com/@a/post/1',text,lead:'hot'});assert.match(r.text,/visible to the public/);assert.match(r.text,/Today: 1 of 70/);assert.equal(x.tg.length,0);
 x=await rig({pages:['continue.products\nother']});await x.pl.set('ct',{rules:R});
 r=await x.pl.record('ct',{post_url:'https://www.threads.com/@a/post/1',text,lead:'hot'});assert.equal(r.isError,true);assert.match(r.text,/\[CRON_FAILURE\]/);
 assert.equal(x.tg.length,1);assert.deepEqual(x.tg[0].slice(0,3),['ct','-100123',null]);assert.equal(x.events[0][0],'comment');assert.equal(x.events[0][3].agent,'ct');
 assert.match((await x.pl.view('ct')).recent[0].status,/missing/);assert.match(await x.pl.gate('ct'),/no post this run/)});

test('the second look 30 minutes later catches a post Threads took down',async()=>{const text='tirze itu senyawa yg sama kayak di mounjaro kak';
 const x=await rig({pages:['p\n'+text,'p\nnothing']});await x.pl.set('ct',{rules:R});await x.pl.record('ct',{post_url:'https://www.threads.com/@a/post/2',text});
 await x.pl.tick();assert.equal(x.tg.length,0);x.tick(31*60e3);await x.pl.tick();assert.equal(x.tg.length,1);assert.match(x.tg[0][3],/gone 30 min later/)});

test('a check browser that fails is retried, not reported as a missing post',async()=>{const text='statusnya masih tahap riset kak';
 const x=await rig({pages:[Error('no browser'),Error('no browser'),Error('no browser'),Error('no browser'),'p\n'+text]});await x.pl.set('ct',{rules:R});
 const r=await x.pl.record('ct',{post_url:'https://www.threads.com/@a/post/3',text});assert.match(r.text,/could not run right now/);assert.equal(x.tg.length,0);
 x.tick(2*60e3);await x.pl.tick();assert.equal((await x.pl.view('ct')).recent[0].status,'visible')});

test('the pause file and over-limit posts are honoured and shown',async()=>{const x=await rig({pages:['']});await x.pl.set('ct',{rules:R});
 const y=await rig({pages:[''],stop:true});await y.pl.set('ct',{rules:R});assert.match(await y.pl.gate('ct'),/Paused/);
 const r=await y.pl.record('ct',{text:'abcdefghijklmnop qrs'});assert.equal(r.isError,true,'audit H1: over the limits or with the pause file there is an error that says stop');assert.match(r.text,/^STOP posting this run/);assert.match(r.text,/over the limits/);assert.ok(y.events.some(e=>/over its limits/.test(e[1])))});

test('allowNow: the gate\'s decision as numbers for a script that posts without a model; it counts what record() recorded and logs no gate call',async()=>{
 const text='banyak yg nanya ini kak, patokannya simpel: brandnya jelas';const x=await rig({pages:['continue.products\n'+text]});
 assert.equal((await x.pl.allowNow('ct')).allow,false,'no limits set: nothing may post');
 await x.pl.set('ct',{rules:R});let a=await x.pl.allowNow('ct');assert.equal(a.allow,true);assert.equal(a.n,2);assert.equal(a.today,0);assert.equal(a.gapMin,R.gapMin);
 await x.pl.record('ct',{post_url:'https://www.threads.com/@a/post/1',text,lead:'hot'});
 a=await x.pl.allowNow('ct');assert.equal(a.allow,false);assert.match(a.reason,/min ago/);assert.equal(a.today,1);assert.equal(a.sinceMin,0);
 x.tick((R.gapMin+1)*60e3);assert.equal((await x.pl.allowNow('ct')).allow,true,'after the gap');
 assert.equal((await x.pl.view('ct')).lastGate,null,'no gate call was logged')});
