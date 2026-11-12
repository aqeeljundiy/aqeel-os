// Per-account sign-in limit (app/signin-guard.mjs, app/signin-routes.mjs, users.mjs; BACKLOG AUD-15).
// Covered: every way to sign in or prove a secret (password login, two-step code, "current password" in Settings, recovery code,
// forgot-password asks, reset-link use, invite codes), the lock, the no-reveal property, the trusted-browser exception, restart, expiry.
import test from 'node:test';import {scryptSync} from 'node:crypto';import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const HOME=await mkdtemp(path.join(tmpdir(),'signguard-'));process.env.HOME=HOME;
const {createSignInGuard,withRequest,hashName,WINDOW_MS,MAX_ENTRIES}=await import('../app/signin-guard.mjs');
const {createSignInRoutes}=await import('../app/signin-routes.mjs');
const {createUsers}=await import('../app/users.mjs');

// a fake request carries its address (ip) and the person its session cookie belongs to (dev)
const REQ=(ip,dev=null,body={},method='POST')=>({ip,dev,body,method,headers:{}});
const mk=(o={})=>{const clock={t:1e9};const locks=[];
 const guard=createSignInGuard({now:()=>clock.t,ipOf:r=>r.ip,deviceOf:r=>r.dev,onLock:x=>locks.push(x),flushMs:5,...o});return {guard,clock,locks}};
let n=0;
async function world(o={},uo={}){const w=mk(o),sent=[];const users=createUsers(path.join(HOME,'d'+(++n)),{deliver:async(to,sub,text)=>sent.push({to,sub,text})},{ownerCheck:()=>false,limiter:w.guard,...uo});
 const owner=await users.createOwner('Ola','ola@example.com','longpassword1');
 const send=(res,status,body,headers={})=>{res.out={status,body,headers}};
 const routes=createSignInRoutes({users,guard:w.guard,send,readBody:async r=>JSON.stringify(r.body),clientIp:r=>r.ip,ownerCheck:()=>false,signIn:id=>({'set-cookie':'hui='+id}),limited:()=>false,miss:()=>{},clear:()=>{},needEmail:()=>false});
 const call=async(p,req,url)=>{const res={};await withRequest(req,()=>routes(req,res,p,url));return res.out};
 const login=(ip,pw,{name='ola@example.com',dev=null}={})=>call('/auth/login',REQ(ip,dev,{name,password:pw}));
 return {...w,users,owner,sent,call,login,send}}
const timeOf=async f=>{const t=process.hrtime.bigint();await f();return Number(process.hrtime.bigint()-t)/1e6};

test('the rule: 5 wrong tries in 15 minutes, then 30 s, 60 s, 120 s ... never more than 15 minutes; other accounts are free; a right answer starts over',()=>{
 const {guard:g,clock}=mk();
 for(let i=0;i<4;i++){assert.equal(g.fail('pw:a'),0);assert.equal(g.wait('pw:a'),0)}
 assert.equal(g.fail('pw:a'),30,'the 5th wrong try starts the wait');assert.equal(g.wait('pw:a'),30);
 clock.t+=31e3;assert.equal(g.wait('pw:a'),0);assert.equal(g.fail('pw:a'),60);clock.t+=61e3;assert.equal(g.fail('pw:a'),120);
 for(let i=0;i<8;i++){clock.t+=901e3;g.fail('pw:a')}
 assert.ok(g.wait('pw:a')<=900,'capped at 15 minutes');assert.equal(g.wait('pw:b'),0);
 clock.t+=901e3;g.ok('pw:a');assert.equal(g.fail('pw:a'),0,'a right answer starts the count over')});

test('the window: tries older than 15 minutes do not count',()=>{
 const {guard:g,clock}=mk();for(let i=0;i<4;i++)g.fail('pw:a');
 clock.t+=WINDOW_MS+1000;assert.equal(g.fail('pw:a'),0,'the first four expired');for(let i=0;i<3;i++)g.fail('pw:a');assert.equal(g.fail('pw:a'),30)});

test('login: a waiting account, an unknown email and a wrong password answer identically and take the same work',async()=>{
 const w=await world();
 const wrongKnown=await w.login('203.0.113.1','nope-nope');
 const wrongUnknown=await w.login('203.0.113.2','nope-nope',{name:'nobody@example.com'});
 assert.equal(wrongKnown.status,401);assert.deepEqual(wrongUnknown,wrongKnown,'a made-up email is answered like a real one');
 for(let i=0;i<3;i++)await w.login('2.2.2.'+i,'bad'+i);   // 4 wrong in all so far; one more locks
 await w.login('203.0.113.3','bad4');
 const locked=await w.login('203.0.113.4','longpassword1');   // the RIGHT password, from a new address, while the account waits
 assert.deepEqual(locked,wrongKnown,'locked answers exactly like a wrong password; the right one is not looked at');
 assert.ok(!JSON.stringify(locked).match(/too many|wait|minute|second|lock/i),'no hint that it is locked');
 // the same for a made-up name that was guessed at 6 times
 for(let i=0;i<6;i++)await w.login('5.5.5.'+i,'x',{name:'ghost@example.com'});
 assert.deepEqual(await w.login('203.0.113.5','x',{name:'ghost@example.com'}),wrongKnown);
 // timing: the waiting account and the made-up name both spend the work of a wrong password
 const wrongT=await timeOf(()=>w.login('203.0.113.6','nope',{name:'other@example.com'}));
 const lockedT=await timeOf(()=>w.login('203.0.113.7','longpassword1')),ghostT=await timeOf(()=>w.login('203.0.113.8','x',{name:'ghost@example.com'}));
 for(const t of [lockedT,ghostT])assert.ok(t>wrongT*0.25&&t<wrongT*4+30,'similar time: '+t.toFixed(1)+' ms against '+wrongT.toFixed(1)+' ms');
 w.clock.t+=31e3;assert.equal((await w.login('203.0.113.4','longpassword1')).status,200,'after the wait the right password works')});

test('the owner is not locked out by someone else: a browser with a valid session for that account signs in through the wait and is not counted',async()=>{
 const w=await world();
 for(let i=0;i<5;i++)await w.login('6.6.6.'+i,'guess'+i);
 assert.equal((await w.login('203.0.113.9','longpassword1')).status,401,'the attacker, even with the right password, waits');
 assert.equal((await w.login('203.0.113.10','longpassword1',{dev:'someone-else'})).status,401,'a session cookie of ANOTHER account does not help');
 const mine=await w.login('203.0.113.10','longpassword1',{dev:'owner'});assert.equal(mine.status,200,'the owner on a browser that is already signed in gets through');assert.ok(mine.headers['set-cookie']);
 assert.equal((await w.login('203.0.113.9','longpassword1')).status,200,'and the owner success ends the attacker lock');
 for(let i=0;i<8;i++)await w.login('203.0.113.10','typo',{dev:'owner'});
 assert.equal((await w.login('203.0.113.11','longpassword1')).status,200,'typos from the trusted browser did not lock anyone out')});

test('two-step code: a waiting account answers like a wrong code; the signed-in browser is the exception',async()=>{
 const w=await world();const me={id:'owner',name:'Ola'};
 const wrong=async dev=>{const key=await w.users.loginCode(me);return w.call('/auth/code',REQ('203.0.113.12',dev,{key,code:'000000'}))};
 const first=await wrong();assert.equal(first.status,401);assert.deepEqual(first.body,{error:'That code is not right.'});
 for(let i=0;i<4;i++)await wrong();   // 5 wrong codes, each on a fresh challenge
 const key=await w.users.loginCode(me),good=w.sent.at(-1).sub.split(' ')[0];
 assert.deepEqual(await w.call('/auth/code',REQ('203.0.113.5',null,{key,code:good})),first,'the right code while it waits is answered exactly like a wrong one');
 assert.equal((await w.call('/auth/code',REQ('203.0.113.5','owner',{key,code:good}))).status,200,'the signed-in browser gets through')});

test('current password in Settings and the recovery code: same words as a wrong one; a session gets no exception there',async()=>{
 const w=await world();
 const put=async(dev,current)=>{const req=REQ('203.0.113.1',dev,{current,next:'brandnewpass1'},'PUT');const res={};await withRequest(req,()=>w.users.api({id:'owner',role:'owner',name:'Ola'},req,res,'/ui/me/password',w.send,async r=>JSON.stringify(r.body)));return res.out};
 const bad=await put('owner','nope');assert.equal(bad.status,400);assert.equal(bad.body.error,'Your current password is not right.');
 for(let i=0;i<4;i++)await put('owner','nope'+i);
 assert.deepEqual(await put('owner','longpassword1'),bad,'even from the signed-in browser: a stolen session must not guess on');
 const rec=c=>w.users.recoverOwner(c,'newpassword1');
 const r1=await rec('AAAAA-BBBBB-CCCCC-DDDDD');for(let i=0;i<5;i++)await rec('AAAAA-BBBBB-CCCCC-DDDDD');
 assert.deepEqual(await rec(w.owner.recovery),r1,'the right recovery code while it waits answers like a wrong one');
 w.clock.t+=40e3;assert.equal((await rec(w.owner.recovery)).ok,true)});

test('forgot password: asks are counted per account (a made-up name too); past 5 no more mail; nothing throws or differs',async()=>{
 const w=await world();
 const ask=who=>w.users.forgot(who,t=>'https://x/#reset/'+t);
 for(let i=0;i<7;i++){await ask('ola@example.com');await ask('ghost@example.com')}
 assert.ok(w.guard.wait('reset:owner')>0,'the owner account is throttled');
 assert.ok(w.guard.wait('reset:name:'+hashName('ghost@example.com'))>0,'and so is a made-up name');
 assert.equal(await ask('ghost@example.com'),undefined);assert.equal(w.locks.length,0,'asks never raise the failed-sign-in item')});

test('reset links and invite codes that match nothing are counted (per address, see the review tests below); while it waits even a right one answers "expired"',async()=>{
 const w=await world();
 const GONE='This reset link has expired or was already used. Ask for a new one.';
 for(let i=0;i<30;i++)assert.equal((await w.users.finishReset('wrong'+i,'newpassword1')).error,GONE);
 assert.equal((await w.users.finishReset('wrong-again','newpassword1')).error,GONE);assert.ok(w.guard.wait('resettok:any')>0);
 assert.equal(await w.users.resetInfo('anything'),null);
 const inv=()=>w.call('/auth/accept',REQ('203.0.113.1',null,{code:'nope',name:'Sam',password:'longpassword1',email:'sam@example.com'}));
 const first=await inv();assert.equal(first.status,400);for(let i=0;i<30;i++)await inv();
 assert.deepEqual(await inv(),first);assert.ok(await withRequest(REQ('203.0.113.1'),()=>w.guard.wait('invite:any'))>0);
 const info=await w.call('/auth/invite',REQ('203.0.113.1',null,{},'GET'),new URL('http://x/auth/invite?code=nope'));assert.equal(info.status,404)});

test('Health: one item per account when it starts waiting, with the count and the number of addresses, never a password; again only when the count doubles',async()=>{
 const w=await world();
 for(let i=0;i<5;i++)await w.login('10.0.0.'+(i%3),'secret-guess-'+i);   // 5 tries from 3 addresses
 assert.equal(w.locks.length,1,'told once');const l=w.locks[0];
 assert.deepEqual({kind:l.kind,id:l.id,count:l.count,addresses:l.addresses},{kind:'pw',id:'owner',count:5,addresses:3});
 assert.ok(!JSON.stringify(l).includes('secret-guess'));
 // a patient attacker who tries again each time the wait is over: 14 more tries, but the item is told at most a few times (when the count doubles), not per try
 for(let i=0;i<14;i++){w.clock.t+=(w.guard.wait('pw:owner')+1)*1e3;await w.login('10.0.0.7','more'+i)}
 assert.ok(w.locks.length<=3,'not once per try: '+w.locks.length);assert.ok(w.locks.every((x,i)=>i===0||x.count>=w.locks[i-1].count*2),'only when the count doubles');
 for(let i=0;i<8;i++)await w.login('203.0.113.13','x',{name:'ghost@example.com'});assert.ok(w.locks.every(x=>x.id==='owner'),'a made-up name gets no item of its own')});

test('restart: the lock survives; the file holds no email, address or password; old entries expire; the file stays bounded',async()=>{
 const file=path.join(HOME,'guard-state.json');const clock={t:5e9};
 const make=()=>createSignInGuard({file,now:()=>clock.t,ipOf:r=>r.ip,deviceOf:r=>r.dev,flushMs:5});
 let g=make();const users=createUsers(path.join(HOME,'dr'),{deliver:async()=>{}},{ownerCheck:()=>false,limiter:g});await users.createOwner('Ola','ola@example.com','longpassword1');
 const k=await users.loginKey('ghost@example.com');assert.equal(k,'pw:name:'+hashName('ghost@example.com'));
 await withRequest(REQ('203.0.113.7'),async()=>{for(let i=0;i<5;i++){g.fail('pw:owner');g.fail(k)}});
 assert.ok(g.wait('pw:owner')>0);await g.flush();
 const raw=await readFile(file,'utf8');assert.ok(!/ghost|example\.com|203\.0\.113|longpassword/.test(raw),'only hashes are kept');
 g=make();assert.ok(g.wait('pw:owner')>0,'after a restart the account still waits');assert.ok(g.wait(k)>0,'and so does the made-up name');
 clock.t+=WINDOW_MS+1000;assert.equal(g.wait('pw:owner'),0,'expired');assert.equal(g.size(),1,'one expired entry is dropped when asked about');
 assert.equal(g.wait(k),0);assert.equal(g.size(),0,'old entries are dropped');
 for(let i=0;i<MAX_ENTRIES+300;i++){clock.t+=1;g.fail('pw:name:'+i)}assert.ok(g.size()<=MAX_ENTRIES);await g.flush();
 assert.ok(make().size()<=MAX_ENTRIES,'and what is read back is bounded too')});

test('enterRequest (what server.mjs calls per request): two requests in flight each see their own address and cookie',async()=>{
 const {enterRequest}=await import('../app/signin-guard.mjs');const w=mk();
 const one=async(ip,dev)=>{enterRequest(REQ(ip,dev));await new Promise(r=>setTimeout(r,10));w.guard.fail('pw:x');return w.guard.wait('pw:x',{signIn:true})};
 await Promise.all([one('203.0.113.1','x'),one('203.0.113.14',null)]);
 assert.equal(w.guard.wait('pw:x',{signIn:true}),0,'the request whose cookie is for x is trusted, and its tries are not counted');
 assert.equal(w.guard.size(),1)});

// Review of 12 Nov 2026.
test('made-up invite and reset links from one address do not close them for everyone else (the owner can still reset; a new person can still join)',async()=>{
 const w=await world();const from=(ip,f)=>withRequest(REQ(ip),f);
 const GONE='This reset link has expired or was already used. Ask for a new one.';
 for(let i=0;i<40;i++){assert.equal((await from('198.51.100.9',()=>w.users.finishReset('made-up-'+i,'newpassword1'))).error,GONE);await w.call('/auth/invite',REQ('198.51.100.9',null,{},'GET'),new URL('http://x/auth/invite?code=made-up-'+i))}
 assert.ok(await from('198.51.100.9',()=>w.guard.wait('resettok:any'))>0,'the address that sent them waits');assert.ok(await from('198.51.100.9',()=>w.guard.wait('invite:any'))>0);
 assert.equal(await from('203.0.113.20',()=>w.guard.wait('resettok:any')),0,'a reset link opened from another address is looked at');
 assert.equal(await from('203.0.113.20',()=>w.guard.wait('invite:any')),0,'and so is an invite');
 assert.ok(w.guard.size()<=4,'one entry per kind and address, not one per try: '+w.guard.size())});

test('a browser with a valid session gets 5 tries of its own, not tries without end: a stolen session cannot guess the password through the sign-in route',async()=>{
 const w=await world();const mine=pw=>w.login('203.0.113.30',pw,{dev:'owner'});
 for(let i=0;i<5;i++)assert.equal((await mine('guess'+i)).status,401);
 assert.equal((await mine('longpassword1')).status,401,'the sixth try from that browser waits, right password or not');
 assert.equal(w.locks.length,1,'and the owner is told');
 assert.equal((await w.login('203.0.113.31','longpassword1')).status,200,'nobody else was made to wait by it');
 assert.equal((await mine('longpassword1')).status,200,'a right answer starts that browser over as well');
 for(let i=0;i<5;i++)await w.login('203.0.113.32','x'+i);   // someone else guesses: the signed-in browser is not held up
 assert.equal((await mine('longpassword1')).status,200)});
test('login: a suspended account answers exactly like a wrong password and does the same hash work (counted, not timed)',async()=>{
 let hashes=0;const scrypt=(...a)=>{hashes++;return scryptSync(...a)};const w=await world({},{scrypt});
 const api=async(u,p,b)=>{let out;await w.users.api(u,{method:'POST',url:p},{},p,(res,status,body)=>{out={status,body}},async()=>JSON.stringify(b||{}));return out};
 const join=async(name,email)=>{const inv=(await api(w.owner.user,'/ui/people/invite',{name})).body;return w.users.accept(inv.code,name,'memberpass-123',undefined,email)};
 await join('Rina','rina@example.com');const sus=await join('Bo','bo@example.com');
 assert.equal((await api(w.owner.user,'/ui/people/'+sus.id+'/suspend',{on:true})).status,200);
 const work=async(pw,name,ip)=>{const before=hashes;const r=await w.login(ip,pw,{name});return {r,n:hashes-before}};
 const wrong=await work('not-the-pass','rina@example.com','203.0.113.31');
 assert.equal(wrong.r.status,401);assert.equal(wrong.n,1,'a wrong password costs one hash');
 for(const [what,x] of [['suspended, right password',await work('memberpass-123','bo@example.com','203.0.113.32')],['suspended, wrong password',await work('nope-nope-1','bo@example.com','203.0.113.33')],['unknown email',await work('nope-nope-1','ghost@example.com','203.0.113.34')],['unknown email again',await work('nope-nope-1','ghost2@example.com','203.0.113.35')]]){
  assert.deepEqual(x.r,wrong.r,what+': same status and words as a wrong password');assert.equal(x.n,wrong.n,what+': same hash work as a wrong password')}
 assert.equal((await w.login('203.0.113.36','memberpass-123',{name:'rina@example.com'})).status,200,'the active member still signs in')});
