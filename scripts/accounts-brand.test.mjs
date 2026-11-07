// Plug and play accounts and branding (7 Nov 2026): first-run owner, forgot password by email, the owner's recovery code,
// admins' tools for people (new password, sign out, suspend, two-step off, renew invites), the Branding store, the
// skills policy writer, editable starter prompts and the trusted-agents list. No network, temp HOME.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const HOME=await mkdtemp(path.join(tmpdir(),'acctb-'));process.env.HOME=HOME;process.env.HERMES_HOME=path.join(HOME,'.hermes');await mkdir(process.env.HERMES_HOME,{recursive:true});
const DATA=path.join(HOME,'data');process.env.UI_DATA_DIR=DATA;
const {createUsers}=await import('../app/users.mjs');
const {createAccountAuth}=await import('../app/account-auth.mjs');
const sent=[];const mail={deliver:async(to,subject,text)=>{sent.push({to,subject,text})}};
let envHash=false;
const users=createUsers(DATA,mail,{ownerCheck:()=>false,envOwner:()=>envHash,brandName:async()=>'PixelOS'});
const revoked=[];users.hooks.revoke=async id=>{revoked.push(id)};
const call=async(u,method,p,body)=>{let out;await users.api(u,{method,url:p},{},p,(res,status,b)=>{out={status,body:b}},async()=>JSON.stringify(body||{}));return out};
// the auth routes with a fake request/response
const auth=createAccountAuth({users,send:(res,status,body,h)=>{res.out={status,body,h}},readBody:async req=>JSON.stringify(req.body||{}),signIn:id=>({'set-cookie':'hui='+id}),
 limited:()=>false,miss:()=>{},revoke:async id=>{revoked.push(id)},publicUrl:()=>'https://ai.example.com'});
const route=async(method,p,body,q='')=>{const res={};const handled=await auth({method,body},res,p,new URL('http://x'+p+q));return {handled,...res.out}};

test('a new install asks for the owner: the first visit makes it, signs in and gives a recovery code; then setup is closed',async()=>{
 assert.equal((await route('GET','/auth/setup')).body.needed,true);
 assert.equal(await users.login('','anything-123'),null,'nobody signs in before the owner exists');
 const bad=await route('POST','/auth/setup',{name:'Sam Lee',username:'sam',password:'short'});assert.equal(bad.status,400);assert.match(bad.body.error,/8 characters/);
 const r=await route('POST','/auth/setup',{name:'Sam Lee',username:'sam',password:'owner-pass-1'});
 assert.equal(r.status,200);assert.equal(r.h['set-cookie'],'hui=owner');assert.match(r.body.recovery,/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
 assert.equal((await users.login('sam','owner-pass-1'))?.role,'owner');assert.equal((await users.login('Sam Lee','owner-pass-1'))?.role,'owner');
 assert.equal((await route('GET','/auth/setup')).body.needed,false);
 const again=await route('POST','/auth/setup',{name:'Eve',username:'eve',password:'evil-pass-123'});assert.equal(again.status,409);
 assert.equal(await users.login('eve','evil-pass-123'),null);
 globalThis.RC=r.body.recovery});

test('an install with UI_PASSWORD_HASH never shows the setup screen',async()=>{
 const u2=createUsers(path.join(HOME,'data2'),mail,{ownerCheck:pw=>pw==='env-pass-1',envOwner:()=>true});
 assert.equal(await u2.needsOwner(),false);await assert.rejects(u2.createOwner('X','xx','some-pass-1'),/already has an owner/)});

test('forgot password: a one-hour, one-use link to a confirmed email only; the same answer for everyone',async()=>{
 const owner=await users.user('owner');
 const inv=(await call(owner,'POST','/ui/people/invite',{name:'Rina'})).body;const rina=await users.accept(inv.code,'Rina','rina-pass-123','rina');
 sent.length=0;
 // no email yet, and an unknown name: nothing is sent, the answer is the same
 assert.deepEqual((await route('POST','/auth/forgot',{who:'rina'})).body,{ok:true});assert.deepEqual((await route('POST','/auth/forgot',{who:'nobody'})).body,{ok:true});assert.equal(sent.length,0);
 // an email that is not confirmed is not used either
 await call(rina,'PUT','/ui/me/email',{email:'rina@example.com'});sent.length=0;await route('POST','/auth/forgot',{who:'rina'});assert.equal(sent.length,0);
 // confirmed: a link to the public address, in the install's name
 const key=(await call(rina,'POST','/ui/me/email/resend')).body.key;const code=/(\d{6})/.exec(sent.at(-1).text)[1];assert.equal((await call(rina,'POST','/ui/me/email/verify',{key,code})).status,200);
 sent.length=0;await route('POST','/auth/forgot',{who:'RINA@example.com'});assert.equal(sent.length,1);
 assert.equal(sent[0].to,'rina@example.com');assert.match(sent[0].subject,/Reset your PixelOS password/);const tok=/https:\/\/ai\.example\.com\/#reset\/([\w-]+)/.exec(sent[0].text)[1];
 assert.equal((await route('GET','/auth/reset',null,'?t='+tok)).body.name,'Rina');
 assert.equal((await route('POST','/auth/reset',{t:tok,password:'short'})).status,400);
 revoked.length=0;const ok=await route('POST','/auth/reset',{t:tok,password:'rina-new-pass-1'});assert.equal(ok.status,200);assert.equal(ok.h['set-cookie'],'hui='+rina.id);assert.deepEqual(revoked,[rina.id]);
 assert.equal((await users.login('rina','rina-new-pass-1'))?.id,rina.id);assert.equal(await users.login('rina','rina-pass-123'),null);
 assert.equal((await route('POST','/auth/reset',{t:tok,password:'again-pass-12'})).status,400,'a link works once');
 assert.equal((await route('GET','/auth/reset',null,'?t=made-up')).status,404)});

test('the owner\'s recovery code: signs in once, sets the password, turns two-step off, and is replaced',async()=>{
 const owner=await users.user('owner');
 assert.equal((await route('POST','/auth/recover',{code:'AAAAA-BBBBB-CCCCC-DDDDD',password:'whatever-12'})).status,400);
 // two-step on (email confirmed), then lost
 await call(owner,'PUT','/ui/me/email',{email:'sam@example.com'});const key=(await call(owner,'POST','/ui/me/email/resend')).body.key;await call(owner,'POST','/ui/me/email/verify',{key,code:/(\d{6})/.exec(sent.at(-1).text)[1]});
 assert.equal((await call(owner,'PUT','/ui/me/two-step',{on:true})).status,200);assert.equal((await users.user('owner')).twoStep,true);
 const r=await route('POST','/auth/recover',{code:globalThis.RC.toLowerCase().replace(/-/g,' '),password:'owner-new-pass-2'});
 assert.equal(r.status,200);assert.equal(r.h['set-cookie'],'hui=owner');assert.notEqual(r.body.recovery,globalThis.RC);
 assert.equal((await users.user('owner')).twoStep,false);assert.equal((await users.login('sam','owner-new-pass-2'))?.role,'owner');
 assert.equal((await route('POST','/auth/recover',{code:globalThis.RC,password:'owner-new-pass-3'})).status,400,'the old code is used up');
 // a new code from the profile needs the current password
 assert.equal((await call(await users.user('owner'),'POST','/ui/me/recovery',{current:'wrong'})).status,400);
 const n=await call(await users.user('owner'),'POST','/ui/me/recovery',{current:'owner-new-pass-2'});assert.equal(n.status,200);assert.match(n.body.code,/^[A-Z2-9-]{23}$/);
 assert.equal((await call(await users.user('owner'),'GET','/ui/me')).body.recovery,true)});

test('admins set a new password, sign someone out, turn two-step off and suspend; never the owner, and admins not each other',async()=>{
 const owner=await users.user('owner');const rina=(await users.people()).find(x=>x.username==='rina');
 revoked.length=0;assert.equal((await call(owner,'POST','/ui/people/'+rina.id+'/password',{password:'short'})).status,400);
 assert.equal((await call(owner,'POST','/ui/people/'+rina.id+'/password',{password:'set-by-admin-1'})).status,200);assert.deepEqual(revoked,[rina.id]);
 assert.equal((await users.login('rina','set-by-admin-1'))?.id,rina.id);
 assert.equal((await call(owner,'POST','/ui/people/'+rina.id+'/signout')).status,200);assert.equal(revoked.length,2);
 assert.equal((await call(owner,'POST','/ui/people/owner/password',{password:'hijack-pass-1'})).status,404,'the owner is not a person here');
 // suspend: no sign-in, the cookie stops working, the People list says so; then back
 assert.equal((await call(owner,'POST','/ui/people/'+rina.id+'/suspend',{on:true})).body.disabled>0,true);
 assert.equal(await users.login('rina','set-by-admin-1'),null);assert.equal(await users.user(rina.id),null);
 assert.ok((await call(owner,'GET','/ui/people')).body.users.find(x=>x.id===rina.id).disabled);
 await call(owner,'POST','/ui/people/'+rina.id+'/suspend',{on:false});assert.equal((await users.login('rina','set-by-admin-1'))?.id,rina.id);
 // admins: one admin cannot reset another; the owner can
 const i1=(await call(owner,'POST','/ui/people/invite',{name:'Ada',role:'admin'})).body;const ada=await users.accept(i1.code,'Ada','ada-pass-1234','ada');
 const i2=(await call(owner,'POST','/ui/people/invite',{name:'Bo',role:'admin'})).body;const bo=await users.accept(i2.code,'Bo','bo-pass-12345','bob');
 assert.equal((await call(ada,'POST','/ui/people/'+bo.id+'/password',{password:'taken-over-1'})).status,403);
 assert.equal((await call(ada,'POST','/ui/people/'+bo.id+'/suspend',{on:true})).status,403);
 assert.equal((await call(ada,'POST','/ui/people/'+ada.id+'/suspend',{on:true})).status,400,'not yourself');
 assert.equal((await call(ada,'POST','/ui/people/'+rina.id+'/two-step-off')).status,200);
 assert.equal((await call(owner,'POST','/ui/people/'+bo.id+'/password',{password:'owner-set-12'})).status,200);
 // a member cannot use any of it
 const r2=await users.user(rina.id);assert.equal((await call(r2,'POST','/ui/people/'+ada.id+'/signout')).status,403)});

test('an expired invite is listed and renews for 7 days with the same link',async()=>{
 const owner=await users.user('owner');const inv=(await call(owner,'POST','/ui/people/invite',{name:'Late'})).body;
 const list0=(await call(owner,'GET','/ui/people')).body;assert.ok(list0.invites.some(i=>i.code===inv.code));
 inv.expires=Date.now()-60e3;   // the fake send hands back the stored invite itself, so this ages it in place
 const list=(await call(owner,'GET','/ui/people')).body;assert.ok(list.expired.some(x=>x.code===inv.code));assert.ok(!list.invites.some(x=>x.code===inv.code));
 assert.equal(await users.inviteInfo(inv.code),null);
 const r=await call(owner,'POST','/ui/people/invite/'+inv.code+'/renew');assert.equal(r.status,200);assert.ok(r.body.expires>Date.now()+6*864e5);
 assert.equal((await users.inviteInfo(inv.code)).name,'Late')});

test('Branding: name, contact and a black-and-white logo are saved; a colourful or scripted SVG is refused',async()=>{
 const {createBrand,colourful}=await import('../app/brand.mjs');const b=createBrand({DATA,contactFallback:'the owner'});
 assert.equal((await b.get()).name,'aqeelOS');assert.equal((await b.get()).contactDefault,'the owner');
 await assert.rejects(b.setName('x'),/2 to 24/);assert.equal((await b.setName('PixelOS')).name,'PixelOS');assert.equal(globalThis.AQ_BRAND,'PixelOS');
 assert.equal((await b.setContact('Sam <sam@example.com>')).contact,'Sam sam@example.com');assert.equal(globalThis.AQ_CONTACT,'Sam sam@example.com');
 assert.equal(colourful('<svg><path fill="#ff0000"/></svg>'),true);assert.equal(colourful('<svg><path fill="#333"/></svg>'),false);
 await assert.rejects(b.setLogo(Buffer.from('<svg><path fill="red"/></svg>'),'image/svg+xml'),/black and white/);
 await assert.rejects(b.setLogo(Buffer.from('<svg onload="x()"></svg>'),'image/svg+xml'),/scripts/);
 const g=await b.setLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M0 0h1v1z"/></svg>'),'image/svg+xml');assert.ok(g.logo);assert.equal((await b.logo()).type,'image/svg+xml');
 const again=createBrand({DATA});assert.equal((await again.get()).name,'PixelOS','kept across restarts');
 assert.equal((await b.clearLogo()).logo,null);assert.equal(await b.logo(),null)});

test('skills policy: a skill goes to only some agents (the main agent always), then to every agent again',async()=>{
 const sp=await import('../app/skills-policy.mjs');
 assert.equal(sp.allowed('media/video-maker','shop'),true);
 await sp.setRule('media/video-maker',['studio']);assert.equal(sp.allowed('media/video-maker','shop'),false);assert.equal(sp.allowed('media/video-maker','studio'),true);
 assert.equal(sp.allowed('media/video-maker','default'),true);assert.equal(sp.allowed('other/video-maker','shop'),false,'matched by name in any category');
 assert.deepEqual(sp.rules().restricted['media/video-maker'],['default','studio']);
 await sp.setRule('video-maker',null);assert.equal(sp.allowed('media/video-maker','shop'),true);assert.deepEqual(sp.rules().restricted,{});
 await assert.rejects(sp.setRule('../etc',['x']),/Unknown skill/)});

test('starter prompts: neutral by default, editable per kind of person, empty goes back to the defaults',async()=>{
 const {createStarters}=await import('../app/starters.mjs');const s=createStarters(DATA);
 const d=await s.defaults();assert.equal(d.admin.length,4);assert.ok(!JSON.stringify(d).match(/VPS|my sites/i),'no owner-specific defaults');
 assert.deepEqual((await s.get('u1','admin','default',[])).prompts,d.admin);
 const mine=[['A','Do a'],['B','Do b'],['C','Do c'],['D','Do d']];await s.setDefaults({admin:mine});
 assert.deepEqual((await s.get('u1','admin','default',[])).prompts,mine);assert.deepEqual((await s.get('u2','member','default',[])).prompts,d.member);
 assert.equal((await s.defaults()).custom.admin,true);await s.setDefaults({admin:[]});assert.deepEqual((await s.defaults()).admin,d.admin)});

test('trusted agents: the list is written and read back; the main agent is always trusted',async()=>{
 const {createAgentDefaults}=await import('../app/agent-defaults.mjs');const ad=createAgentDefaults({DATA});
 assert.deepEqual([...await ad.trusted()],['default']);await ad.setTrusted('ops',true);assert.ok((await ad.trusted()).has('ops'));
 assert.deepEqual(JSON.parse(await readFile(path.join(DATA,'agent-trust.json'),'utf8')).trusted,['ops']);
 await ad.setTrusted('ops',false);assert.ok(!(await ad.trusted()).has('ops'));assert.ok((await ad.trusted()).has('default'))});
