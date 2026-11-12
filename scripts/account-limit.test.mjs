// Per-account sign-in limits (app/account-limit.mjs, audit of 12 Nov 2026): wrong passwords, two-step codes and the recovery code
// lock ONE ACCOUNT for a growing delay, whatever address the tries come from; secrets compare in constant time.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const HOME=await mkdtemp(path.join(tmpdir(),'acclimit-'));process.env.HOME=HOME;
const {createAccountLimiter,safeEq}=await import('../app/account-limit.mjs');
const {createUsers}=await import('../app/users.mjs');

test('limiter: 4 free wrong tries, then 30 s, 60 s, 120 s ... up to the cap; a right answer or a calm day starts over',()=>{
 let t=1e6;const L=createAccountLimiter({now:()=>t});
 for(let i=0;i<4;i++){assert.equal(L.fail('pw:a'),0);assert.equal(L.wait('pw:a'),0)}
 assert.equal(L.fail('pw:a'),30);assert.equal(L.wait('pw:a'),30);
 t+=31e3;assert.equal(L.wait('pw:a'),0,'the wait is over');
 assert.equal(L.fail('pw:a'),60);t+=61e3;assert.equal(L.fail('pw:a'),120);t+=121e3;assert.equal(L.fail('pw:a'),240);
 for(let i=0;i<20;i++){t+=4000e3;L.fail('pw:a')}assert.equal(L.wait('pw:a'),3600,'capped at an hour');
 assert.equal(L.wait('pw:b'),0,'another account is not touched');
 t+=4000e3;L.ok('pw:a');assert.equal(L.wait('pw:a'),0);assert.equal(L.fail('pw:a'),0,'a right answer starts the count over');
 for(let i=0;i<6;i++)L.fail('pw:c');t+=7*3600e3;assert.equal(L.wait('pw:c'),0);assert.equal(L.fail('pw:c'),0,'calm for 6 hours starts over');
 assert.match(L.text(30),/30 seconds/);assert.match(L.text(300),/5 minutes/)});

test('constant-time compare: equal strings match, different ones and different lengths do not',()=>{
 assert.ok(safeEq('abc123','abc123'));assert.ok(!safeEq('abc123','abc124'));assert.ok(!safeEq('abc','abc123'));assert.ok(!safeEq('x',''));assert.ok(safeEq(undefined,''))});

test('password tries: counted per account from any address, the account waits, the right password is not even looked at, other accounts are free',async()=>{
 let t=5e6;const L=createAccountLimiter({now:()=>t});
 const users=createUsers(path.join(HOME,'d1'),{deliver:async()=>{}},{ownerCheck:pw=>pw==='owner-pass-1',limiter:L});
 // the way server.mjs does it
 const tryLogin=async(name,pw)=>{const k=await users.loginKey(name),w=L.wait(k);if(w)return {locked:w};const u=await users.login(name,pw);if(!u){L.fail(k);return {bad:true}}L.ok(k);return {user:u}};
 for(let i=0;i<4;i++)assert.ok((await tryLogin('','guess'+i)).bad);
 assert.ok((await tryLogin('','guess4')).bad);
 assert.equal((await tryLogin('','owner-pass-1')).locked,30,'locked: even the right password gets nothing');
 assert.equal((await tryLogin('owner','owner-pass-1')).locked,30,'the same account by another name is the same lock');
 t+=31e3;assert.equal((await tryLogin('','owner-pass-1')).user.role,'owner');
 // a made-up name is limited like a real one, so the two cannot be told apart
 for(let i=0;i<5;i++)await tryLogin('nobody@example.com','x');assert.ok((await tryLogin('nobody@example.com','x')).locked>0);
 assert.equal(await users.loginKey('Nobody@Example.com '),'pw:name:nobody@example.com')});

test('two-step codes: wrong codes for one account make it wait, even through new codes; the right code works once the wait is over',async()=>{
 let t=9e6;const L=createAccountLimiter({now:()=>t}),sent=[];
 const users=createUsers(path.join(HOME,'d2'),{deliver:async(to,sub)=>sent.push(sub.split(' ')[0])},{ownerCheck:()=>false,limiter:L});
 const o=await users.createOwner('Ola','ola@example.com','longpassword1');assert.ok(o.recovery);
 const me={id:'owner',name:'Ola'};
 // each wrong guess is on a fresh challenge, as an attacker with the password would do
 let last;for(let i=0;i<5;i++){const key=await users.loginCode(me);last=users.finishLogin(key,'000000');assert.match(last.error,/not right|Too many/)}
 const key=await users.loginCode(me);const r=users.finishLogin(key,sent.at(-1));
 assert.ok(r.wait>0,'locked: the right code is not looked at');assert.match(r.error,/Too many wrong tries/);
 t+=31e3;assert.equal(users.finishLogin(key,sent.at(-1)).ok,true)});

test('the owner recovery code: wrong tries lock it for a growing delay; the right one works after',async()=>{
 let t=3e6;const L=createAccountLimiter({now:()=>t});
 const users=createUsers(path.join(HOME,'d3'),{deliver:async()=>{}},{ownerCheck:()=>false,limiter:L});
 const o=await users.createOwner('Ola','ola@example.com','longpassword1');
 for(let i=0;i<5;i++)assert.match((await users.recoverOwner('AAAAA-BBBBB-CCCCC-DDDDD','newpassword1')).error,/not right/);
 const r=await users.recoverOwner(o.recovery,'newpassword1');assert.ok(r.wait>0&&r.keep,'the right code waits too');
 t+=31e3;assert.equal((await users.recoverOwner(o.recovery,'newpassword1')).ok,true)});
