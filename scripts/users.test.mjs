// People and sign-in (app/users.mjs): owner login, invites, member limits, private agents. No network, temp HOME.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const HOME=await mkdtemp(path.join(tmpdir(),'users-'));process.env.HOME=HOME;
const {createUsers}=await import('../app/users.mjs');
const DATA=path.join(HOME,'data');const mail={deliver:async()=>{}};
const users=createUsers(DATA,mail,{ownerCheck:pw=>pw==='owner-pass-1'});
// a tiny request/response pair for the people API
const list=async(u,names)=>{let out;await users.api(u,{method:'GET',url:'/ui/agents?names='+names},{},'/ui/agents',(res,status,b)=>{out=b},async()=>'{}');return out};
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
 assert.equal(users.gate(u,'/ui/supervision','GET',Q,'shop'),null);   // the team is told when admins can review chats
 assert.equal(users.gate(u,'/gapi/p/shop/api/sessions/s-not-mine','GET',Q,'shop')?.status,403);
 await users.own('s-mine',u);assert.equal(users.gate(u,'/gapi/p/shop/api/sessions/s-mine','GET',Q,'shop'),null);
 assert.equal(users.isAdmin(u),false);assert.equal(users.can(u,'create'),false);
 // a member cannot invite people or change shares
 const r=await call(u,'POST','/ui/people/invite',{name:'X'});assert.notEqual(r?.status,200)});

test('the rule by role: admins manage every agent, members (employees) only their own and what is shared; admins read the chats of members',async()=>{
 const owner=await users.user('owner');
 const inv=(await call(owner,'POST','/ui/people/invite',{name:'Ada',role:'admin'})).body;const admin=await users.accept(inv.code,'Ada','ada-pass-1234');
 const rina=await users.login('rina','rina-pass-123');await users.created(rina,'rinabot');await users.created(admin,'adabot');
 const inv2=(await call(owner,'POST','/ui/people/invite',{name:'Tom',role:'member',roleId:'creator'})).body;const tom=await users.accept(inv2.code,'Tom','tom-pass-1234');
 assert.equal(users.level(rina,'rinabot'),'owner');
 // an admin opens and manages a member's agent, and may change who has it
 assert.equal(users.level(admin,'rinabot'),'owner');
 assert.equal(users.gate(admin,'/gapi/p/rinabot/api/sessions','POST',Q,'rinabot'),null);
 assert.equal((await call(admin,'PUT','/ui/agents/rinabot/share',{user:tom.id,level:'chat'})).status,200);
 // a member: not another member's agent unless shared, never an admin's unless shared
 assert.equal(users.level(tom,'rinabot'),'chat');
 assert.equal(users.level(rina,'adabot'),null);
 assert.equal(users.gate(rina,'/gapi/p/adabot/api/sessions','POST',Q,'adabot')?.status,403);
 // chats: an admin's list has members' chats (marked), never another admin's; a member's has only their own
 await users.own('c-rina',rina);await users.own('c-ada',admin);await users.own('c-owner',owner);
 const list={sessions:[{id:'c-rina'},{id:'c-ada'},{id:'c-owner'}]};
 assert.deepEqual(users.filter(admin,'/hapi/sessions',list,'default').sessions.map(x=>x.id+':'+(x.person||'')),['c-rina:Rina','c-ada:']);
 assert.deepEqual(users.filter(rina,'/hapi/sessions',list,'default').sessions.map(x=>x.id),['c-rina']);
 // the owner without Team view reads as an admin does: members' chats marked, never an admin's (13 Nov 2026)
 assert.deepEqual(users.filter(owner,'/hapi/sessions',list,'default').sessions.map(x=>x.id+':'+(x.person||'')),['c-rina:Rina','c-owner:']);
 // the engine's status: a member sees only whether it runs and their own agents; an admin all of it (Help left out)
 const st={gateway_running:true,gateway_state:'running',active_agents:2,active_sessions:1,gateway_pid:4242,hermes_home:'/root/.hermes',env_path:'/root/.hermes/.env',gateway_platforms:{whatsapp:{}},profiles:[{name:'default'},{name:'rinabot'},{name:'adabot'},{name:'aqeelos-help'}],gateway_shared_with:['default','rinabot','adabot']};
 const mem=users.statusFor(rina,JSON.parse(JSON.stringify(st)));
 assert.deepEqual(Object.keys(mem).sort(),['active_agents','active_sessions','gateway_running','gateway_shared_with','gateway_state','profiles']);
 assert.equal(JSON.stringify(mem).includes('adabot'),false,'a member sees no other agent');assert.equal(JSON.stringify(mem).match(/4242|\.hermes|\.env/),null);
 assert.equal(mem.gateway_running,true);
 const adm=users.statusFor(admin,JSON.parse(JSON.stringify(st)));
 assert.equal(adm.gateway_pid,4242);assert.ok(adm.profiles.some(x=>x.name==='adabot'));assert.ok(!adm.profiles.some(x=>x.name==='aqeelos-help'),'Help stays hidden');
 assert.equal(users.memberChat('c-rina'),true);assert.equal(users.memberChat('c-ada'),false);
 assert.equal(users.gate(owner,'/gapi/p/rinabot/api/sessions','POST',Q,'rinabot'),null)});

test('an admin can make their own agent private from other admins; a member cannot; an invited person shows as owner',async()=>{
 const owner=await users.user('owner');
 const inv=(await call(owner,'POST','/ui/people/invite',{name:'Bea',role:'admin'})).body;const bea=await users.accept(inv.code,'Bea','bea-pass-1234');
 const ada=await users.login('ada','ada-pass-1234')||(await users.people()).find(x=>x.name==='Ada');const rina=await users.login('rina','rina-pass-123');
 await users.created(bea,'beabot');
 assert.equal(users.level(ada,'beabot'),'owner');
 assert.equal((await call(ada,'PUT','/ui/agents/beabot/private',{on:true})).status,403);
 assert.equal((await call(rina,'PUT','/ui/agents/rinabot/private',{on:true})).status,403);
 assert.equal((await call(bea,'PUT','/ui/agents/beabot/private',{on:true})).status,200);
 assert.equal(users.level(ada,'beabot'),null);
 assert.equal(users.gate(ada,'/gapi/p/beabot/api/sessions','POST',Q,'beabot')?.status,403);
 assert.equal(users.level(owner,'beabot'),'owner');assert.equal(users.lockedByOwner('beabot'),true);
 const l=(await list(ada,'beabot')).beabot;assert.equal(l.private,true);assert.equal(l.access,null);
 // AUDIT-2 (11 Nov 2026): another admin can't get in by sharing it with themselves or by putting it in an invite
 assert.equal((await call(ada,'PUT','/ui/people/share',{agent:'beabot',user:ada.id,level:'owner'})).status,403);
 assert.equal(users.level(ada,'beabot'),null);
 const sneak=(await call(ada,'POST','/ui/people/invite',{name:'Sneak',role:'member',agents:{beabot:'owner'}})).body;
 assert.deepEqual((await users.invites?.()||[]).find(i=>i.code===sneak.code)?.agents||sneak.agents||{},{});
 assert.equal((await call(bea,'PUT','/ui/people/share',{agent:'beabot',user:ada.id,level:'chat'})).status,200,'its owner still shares it');
 assert.equal((await call(bea,'PUT','/ui/people/share',{agent:'beabot',user:ada.id,level:'none'})).status,200);
 assert.equal((await call(bea,'PUT','/ui/agents/beabot/private',{on:false})).status,200);assert.equal(users.level(ada,'beabot'),'owner');
 // an agent made for someone invited shows them as its owner until they join
 await users.created(bea,'forzed');const iv=(await call(bea,'POST','/ui/people/invite',{name:'Zed',role:'member',agents:{forzed:'owner'},ownAgent:'forzed'})).body;
 assert.equal(iv.ownAgent,'forzed');assert.deepEqual((await list(bea,'forzed')).forzed.invitee,{name:'Zed'})});

test('/ui/me names a member\'s lead agent only once it is theirs, so pages can fall back to it',async()=>{
 const rina=await users.login('rina','rina-pass-123');
 await users.setLead(rina.id,'rina-lead');assert.equal((await call(rina,'GET','/ui/me')).body.lead,null,'not made yet: not named');
 await users.created(rina,'rina-lead');const me=(await call(rina,'GET','/ui/me')).body;assert.equal(me.lead,'rina-lead');assert.equal(me.agents['rina-lead'],'owner');
 assert.equal(users.gate(rina,'/hapi/skills','GET',new URLSearchParams({profile:'rina-lead'}),'rina-lead'),null,'the page asks for its lead: allowed');
 assert.equal(users.gate(rina,'/hapi/skills','GET',new URLSearchParams({profile:'default'}),'default')?.status,403,'the main agent stays closed')});

test('the password change needs the current one',async()=>{
 const owner=await users.user('owner');
 assert.equal((await call(owner,'PUT','/ui/me/password',{current:'nope',next:'new-owner-pass'})).status,400);
 assert.equal((await call(owner,'PUT','/ui/me/password',{current:'owner-pass-1',next:'new-owner-pass'})).status,200);
 assert.equal((await users.login('','new-owner-pass'))?.role,'owner');assert.equal(await users.login('','owner-pass-1'),null)});


test('the live test\'s throwaway agent is left out of the agent lists, like Help; other test agents stay listed (UI audit 15, 14 Nov 2026)',async()=>{
 const {listedAgent,LIVE_TEST_AGENT}=await import('../app/agentops.mjs');assert.equal(LIVE_TEST_AGENT,process.env.LIVE_TEST_AGENT||'aq-livetest');
 assert.equal(listedAgent(LIVE_TEST_AGENT),false);assert.equal(listedAgent({name:LIVE_TEST_AGENT}),false);assert.equal(listedAgent('aqeelos-help'),false);
 assert.equal(listedAgent('continue-support'),true,'a real agent in training on the test-agents list is still listed');assert.equal(listedAgent('default'),true);
 const owner={id:'owner',role:'owner',name:'O'},pr={profiles:[{name:'default'},{name:'rinabot'},{name:LIVE_TEST_AGENT},{name:'aqeelos-help'},{name:'rinabot--wa2'}]};
 assert.deepEqual(users.filter(owner,'/hapi/profiles',JSON.parse(JSON.stringify(pr))).profiles.map(x=>x.name),['default','rinabot']);
 assert.deepEqual(users.statusFor(owner,{gateway_running:true,profiles:[{name:'default'},{name:LIVE_TEST_AGENT},{name:'rinabot'}]}).profiles.map(x=>x.name),['default','rinabot'])});
test('System › Teams and Models › every agent leave the live test\'s agent out too',async()=>{const {readFileSync}=await import('node:fs');const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
 assert.match(src('health-routes.mjs'),/agents:v\.agents\.filter\(listedAgent\)\.map/);assert.match(src('instructions-routes.mjs'),/\(await listAgents\(\)\)\.filter\(a=>listedAgent\(a\)&&/)});
