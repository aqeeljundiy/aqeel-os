// People and sign-in (app/users.mjs): owner login, invites, member limits, private agents. No network, temp HOME.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const HOME=await mkdtemp(path.join(tmpdir(),'users-'));process.env.HOME=HOME;
const {createUsers}=await import('../app/users.mjs');
const DATA=path.join(HOME,'data');const mail={deliver:async()=>{}};
const users=createUsers(DATA,mail,{ownerCheck:pw=>pw==='owner-pass-1'});
// a tiny request/response pair for the people API
const call=async(u,method,p,body)=>{let out;await users.api(u,{method,url:p},{},p,(res,status,b)=>{out={status,body:b}},async()=>JSON.stringify(body||{}));return out};
const Q=new URLSearchParams();

test('Team view on: the owner lists all chats, each marked; off, and for admins and members, chats stay private',async()=>{
 let on=true;const U2=createUsers(path.join(HOME,'data-see'),mail,{ownerCheck:()=>false,ownerSeesAll:()=>on});await U2.load();
 const owner={id:'owner',role:'owner',name:'O'},admin={id:'a',role:'admin',name:'A'};await U2.own('s-a',admin);await U2.own('s-o',owner);
 const list={sessions:[{id:'s-a'},{id:'s-o'}]},ids=u=>U2.filter(u,'/hapi/sessions',JSON.parse(JSON.stringify(list))).sessions.map(x=>x.id);
 assert.deepEqual(ids(owner),['s-a','s-o']);assert.deepEqual(ids(admin),['s-a']);
 assert.equal(U2.filter(owner,'/hapi/sessions',JSON.parse(JSON.stringify(list))).sessions.find(x=>x.id==='s-o').person,undefined,'your own chat is not marked');
 assert.ok('person' in U2.filter(owner,'/hapi/sessions',JSON.parse(JSON.stringify(list))).sessions.find(x=>x.id==='s-a'));
 on=false;assert.deepEqual(ids(owner),['s-o'])});

test('the owner signs in with the install password (empty name too); a wrong one is refused',async()=>{
 assert.equal((await users.login('','owner-pass-1'))?.role,'owner');
 assert.equal(await users.login('','wrong'),null);assert.equal(await users.login('nobody','owner-pass-1'),null)});

test('an invite makes a member once; the link cannot be used twice; short passwords and taken names are refused',async()=>{
 const owner=await users.user('owner');
 const inv=(await call(owner,'POST','/ui/people/invite',{name:'Rina',agents:{shop:'chat'}})).body;assert.ok(inv.code);
 assert.equal((await users.inviteInfo(inv.code)).name,'Rina');
 await assert.rejects(users.accept(inv.code,'Rina','short'),/8 characters/);
 const u=await users.accept(inv.code,'Rina','rina-pass-123');assert.equal(u.role,'member');
 await assert.rejects(users.accept(inv.code,'Rina2','rina-pass-123'),/expired or was already used/);
 assert.equal((await users.login('rina','rina-pass-123'))?.id,u.id);assert.equal(await users.login('rina','bad-pass-123'),null);
 const inv2=(await call(owner,'POST','/ui/people/invite',{name:'Other'})).body;await assert.rejects(users.accept(inv2.code,'Rina','x-pass-1234'),/taken/)});

test('a member reaches only what is shared: chat on a shared agent, not other agents, not admin pages, not others\' chats',async()=>{
 const u=await users.login('rina','rina-pass-123');
 assert.equal(users.gate(u,'/gapi/p/shop/api/sessions','POST',Q,'shop'),null);
 assert.equal(users.gate(u,'/gapi/p/other/api/sessions','POST',Q,'other')?.status,403);
 assert.equal(users.gate(u,'/gapi/p/shop/api/sessions/s-not-mine','GET',Q,'shop')?.status,403);
 await users.own('s-mine',u);assert.equal(users.gate(u,'/gapi/p/shop/api/sessions/s-mine','GET',Q,'shop'),null);
 assert.equal(users.isAdmin(u),false);assert.equal(users.can(u,'create'),false);
 // a member cannot invite people or change shares
 const r=await call(u,'POST','/ui/people/invite',{name:'X'});assert.notEqual(r?.status,200)});

test('an agent a member made is private: an admin cannot open it until it is shared; the owner of aqeelOS always can',async()=>{
 const owner=await users.user('owner');
 const inv=(await call(owner,'POST','/ui/people/invite',{name:'Ada',role:'admin'})).body;const admin=await users.accept(inv.code,'Ada','ada-pass-1234');
 const rina=await users.login('rina','rina-pass-123');await users.created(rina,'rinabot');
 assert.equal(users.level(rina,'rinabot'),'owner');
 assert.equal(users.gate(admin,'/gapi/p/rinabot/api/sessions','POST',Q,'rinabot')?.status,403);
 assert.equal(users.gate(owner,'/gapi/p/rinabot/api/sessions','POST',Q,'rinabot'),null);
 // only its owner may share it (Edit agent › Sharing), not the admin, and not through the admins' People page either
 assert.equal((await call(admin,'PUT','/ui/agents/rinabot/share',{user:admin.id,level:'edit'})).status,403);
 assert.equal((await call(admin,'PUT','/ui/people/share',{agent:'rinabot',user:admin.id,level:'edit'})).status,403);
 assert.equal((await call(rina,'PUT','/ui/agents/rinabot/share',{user:admin.id,level:'chat'})).status,200);
 assert.equal(users.gate(admin,'/gapi/p/rinabot/api/sessions','POST',Q,'rinabot'),null)});

test('the password change needs the current one',async()=>{
 const owner=await users.user('owner');
 assert.equal((await call(owner,'PUT','/ui/me/password',{current:'nope',next:'new-owner-pass'})).status,400);
 assert.equal((await call(owner,'PUT','/ui/me/password',{current:'owner-pass-1',next:'new-owner-pass'})).status,200);
 assert.equal((await users.login('','new-owner-pass'))?.role,'owner');assert.equal(await users.login('','owner-pass-1'),null)});
