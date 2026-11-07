// Sign-in by email (7 Nov 2026): email for everyone (any case, trimmed), the old username for 14 days with a note, accounts
// without an email keep their username until they add one, and the one-time DATA/login-emails.json move (users.json is
// backed up first; passwords and two-step stay). No network, temp HOME.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {scryptSync,randomBytes} from 'node:crypto';
const HOME=await mkdtemp(path.join(tmpdir(),'emlogin-'));process.env.HOME=HOME;process.env.HERMES_HOME=path.join(HOME,'.hermes');await mkdir(process.env.HERMES_HOME,{recursive:true});
const {createUsers}=await import('../app/users.mjs');
const hash=pw=>{const salt=randomBytes(16);return 'scrypt:'+salt.toString('hex')+':'+scryptSync(pw,salt,64).toString('hex')};
const mail={deliver:async()=>{}};
const call=async(users,u,method,p,body)=>{let out;await users.api(u,{method,url:p},{},p,(res,status,b)=>{out={status,body:b}},async()=>JSON.stringify(body||{}));return out};
// an install from before email sign-in: the owner "abel" (no email), "sela" with two-step on, "budi" with no email
async function oldInstall(dir,{since}={}){const DATA=path.join(HOME,dir);await mkdir(DATA,{recursive:true});
 const db={ownerName:'Abel',ownerUsername:'abel',ownerPw:hash('owner-pass-1'),
  users:[{id:'s1',name:'Sela',username:'sela',role:'member',caps:[],pw:hash('sela-pass-1'),email:'old@sela.test',emailVerified:true,twoStep:true},
   {id:'b1',name:'Budi',username:'budi',role:'member',caps:[],pw:hash('budi-pass-1')}],...(since?{emailLoginSince:since}:{})};
 await writeFile(path.join(DATA,'users.json'),JSON.stringify(db));return DATA}

test('the one-time move sets abel and sela to their emails; users.json is backed up; passwords and two-step stay',async()=>{
 const DATA=await oldInstall('move');const before=await readFile(path.join(DATA,'users.json'),'utf8');
 await writeFile(path.join(DATA,'login-emails.json'),JSON.stringify({abel:'Abel@Elmora.example',sela:'sela@elmora.example',ghost:'ghost@elmora.example'}));
 const users=createUsers(DATA,mail,{relaxed:false});await users.load();
 const files=await readdir(DATA);const bak=files.find(f=>f.startsWith('users.json.bak-emails-'));assert.ok(bak,'backup made');assert.equal(await readFile(path.join(DATA,bak),'utf8'),before);
 const o=await users.user('owner'),s=await users.user('s1');
 assert.equal(o.email,'abel@elmora.example');assert.equal(o.emailVerified,true);assert.equal(s.email,'sela@elmora.example');assert.equal(s.emailVerified,true);assert.equal(s.twoStep,true,'two-step stays');
 assert.equal((await users.login('abel@elmora.example','owner-pass-1'))?.id,'owner','password unchanged');assert.equal((await users.login(' SELA@elmora.example','sela-pass-1'))?.id,'s1');
 assert.deepEqual(JSON.parse(await readFile(path.join(DATA,'login-emails.left.json'),'utf8')),{ghost:'ghost@elmora.example'},'the name it could not place is set aside');assert.ok(files.includes('login-emails.done.json'));assert.ok(!files.includes('login-emails.json'));
 // a second start does nothing more (no new backup)
 const again=createUsers(DATA,mail,{relaxed:false});await again.load();assert.equal((await readdir(DATA)).filter(f=>f.startsWith('users.json.bak-emails-')).length,1)});

test('in the 14 days the old username still signs in, with the note; email works in any case',async()=>{
 const DATA=await oldInstall('grace');await writeFile(path.join(DATA,'login-emails.json'),JSON.stringify({abel:'abel@elmora.example',sela:'sela@elmora.example'}));
 const users=createUsers(DATA,mail,{relaxed:false});
 const o=await users.login('abel','owner-pass-1');assert.equal(o?.id,'owner');assert.match(users.loginNote(o,'abel'),/Use your email next time: abel@elmora\.example/);
 assert.equal(users.loginNote(o,'abel@elmora.example'),null);
 assert.equal((await users.login('Sela','sela-pass-1'))?.id,'s1');assert.equal(await users.login('abel@elmora.example','wrong-pass-1'),null);
 assert.equal(users.emailOnly(),false);assert.equal((await users.login('','owner-pass-1'))?.id,'owner','password alone still works in the 14 days')});

test('after 14 days: email only; an account with no email still signs in by username until it adds one',async()=>{
 const DATA=await oldInstall('after',{since:Date.now()-15*864e5});await writeFile(path.join(DATA,'login-emails.json'),JSON.stringify({abel:'abel@elmora.example',sela:'sela@elmora.example'}));
 const users=createUsers(DATA,mail,{relaxed:false});
 assert.equal(await users.login('abel','owner-pass-1'),null);assert.equal(await users.login('sela','sela-pass-1'),null);assert.equal(await users.login('','owner-pass-1'),null,'no password-only sign-in');
 assert.equal(users.emailOnly(),true);assert.equal((await users.login('abel@elmora.example','owner-pass-1'))?.id,'owner');
 const budi=await users.login('budi','budi-pass-1');assert.equal(budi?.id,'b1','no email yet: the username keeps working');assert.equal(budi.email,undefined);
 // the "Add your email" step: they add one, then only the email signs in; it can't be removed again
 assert.equal((await call(users,budi,'PUT','/ui/me/email',{email:'Budi@Example.com'})).status,200);
 assert.equal(await users.login('budi','budi-pass-1'),null);assert.equal((await users.login('budi@example.com','budi-pass-1'))?.id,'b1');
 const rm=await call(users,await users.user('b1'),'PUT','/ui/me/email',{email:'',current:'budi-pass-1'});assert.equal(rm.status,400);assert.match(rm.body.error,/not removed/)});

test('a test copy (relaxed) keeps the owner\'s password-only sign-in for the deploy checks',async()=>{
 const DATA=await oldInstall('relaxed',{since:Date.now()-30*864e5});const users=createUsers(DATA,mail,{relaxed:true});
 await users.load();const u=await users.user('owner');assert.equal((await users.login('','owner-pass-1'))?.id,'owner');assert.equal(u.email,'')});

test('invites carry the email; joining takes it (unique), the handle comes from it; admins change a member\'s email',async()=>{
 const DATA=await oldInstall('invite');const users=createUsers(DATA,mail,{relaxed:false});const owner=await users.user('owner');
 const inv=(await call(users,owner,'POST','/ui/people/invite',{name:'Rina',email:'Rina@Example.com'})).body;assert.equal(inv.email,'rina@example.com');
 assert.equal((await users.inviteInfo(inv.code)).email,'rina@example.com');
 await assert.rejects(users.accept(inv.code,'Rina','rina-pass-123',null,'old@sela.test'),/already uses that email/);
 await assert.rejects(users.accept(inv.code,'Rina','rina-pass-123',null,'not-an-email'),/does not look right/);
 const r=await users.accept(inv.code,'Rina','rina-pass-123',null,'rina@example.com');assert.equal(r.email,'rina@example.com');assert.equal(r.username,'rina');
 assert.equal((await users.login('RINA@example.com','rina-pass-123'))?.id,r.id);
 const bad=await call(users,owner,'POST','/ui/people/'+r.id+'/email',{email:'old@sela.test'});assert.equal(bad.status,400);
 const ok=await call(users,owner,'POST','/ui/people/'+r.id+'/email',{email:'rina@new.test'});assert.equal(ok.status,200);
 assert.equal((await users.user(r.id)).email,'rina@new.test');assert.equal((await users.user(r.id)).emailVerified,false);
 const self=await call(users,await users.user(r.id),'POST','/ui/people/'+r.id+'/email',{email:'x@y.test'});assert.notEqual(self.status,200,'a member cannot')});
