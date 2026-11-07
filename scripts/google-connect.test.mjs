// Tests for Connect Google in the app (app/google-connect.mjs). Run: node --test scripts/google-connect.test.mjs
// A fake Google answers the token calls: the client file is checked, the sign-in address has PKCE and offline access,
// the callback and a pasted address both finish, the file is the skill's own format, Reconnect keeps the file and the
// account, Remove deletes it, and a dead sign-in is said plainly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGoogleConnect,parseClient,scopesFor,servicesOf,cleanName,codeFrom,emailOf} from '../app/google-connect.mjs';

const WEB={web:{client_id:'123456789-abc.apps.googleusercontent.com',client_secret:'s3',project_id:'proj',redirect_uris:['https://ai.example.test/google-oauth/callback']}};
const DESK={installed:{client_id:'123456789-abc.apps.googleusercontent.com',client_secret:'s3',project_id:'proj',redirect_uris:['http://localhost']}};
const jwt=o=>'x.'+Buffer.from(JSON.stringify(o)).toString('base64url')+'.y';
function setup({email='owner@x.test',refresh='r1',refreshOk=true}={}){const T=mkdtempSync(path.join(tmpdir(),'aq-gc-')),H=path.join(T,'hh'),DATA=path.join(T,'data');mkdirSync(H,{recursive:true});
 const calls=[];const fetchImpl=async(url,o={})=>{const body=Object.fromEntries(new URLSearchParams(o.body||''));calls.push({url,body});
  if(body.grant_type==='authorization_code')return {ok:true,json:async()=>({access_token:'at',refresh_token:refresh,expires_in:3600,scope:'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/gmail.readonly',id_token:jwt({email})})};
  if(body.grant_type==='refresh_token')return refreshOk?{ok:true,json:async()=>({access_token:'at2'})}:{ok:false,status:400,json:async()=>({error:'invalid_grant'})};
  throw Error('unexpected '+url)};
 const g=createGoogleConnect({HERMES_HOME:H,DATA,PUBLIC_URL:{toString:()=>'https://ai.example.test/'},fetchImpl});   /* an object that reads as the address, like PUBLIC_URL_REF */return {T,H,DATA,g,calls,done:()=>rmSync(T,{recursive:true,force:true})}}

test('the client file: web and desktop are read; a service account or junk is said plainly',()=>{
 assert.equal(parseClient(JSON.stringify(WEB)).type,'web');assert.equal(parseClient(DESK).type,'installed');
 assert.throws(()=>parseClient('{nope'),/not the JSON file/);assert.throws(()=>parseClient({type:'service_account'}),/service account/);assert.throws(()=>parseClient({web:{client_id:'x',client_secret:'y'}}),/does not look like/)});
test('services and scopes',()=>{const s=scopesFor(['drive','gmail']);assert.ok(s.includes('openid'));assert.ok(s.includes('https://www.googleapis.com/auth/drive'));assert.ok(s.includes('https://www.googleapis.com/auth/gmail.send'));
 assert.deepEqual(servicesOf(s),['gmail','drive']);assert.equal(scopesFor().length,2+8);assert.throws(()=>scopesFor(['nope']),/at least one/);
 assert.equal(cleanName(' Client A! '),'client-a');assert.deepEqual(codeFrom('http://localhost/?state=s&code=c&scope=x'),{code:'c',state:'s',error:'',scope:'x'});assert.equal(emailOf(jwt({email:'A@B.test'})),'a@b.test')});

test('connect (web client): PKCE address, the callback writes the skill\'s own file, private',async()=>{const t=setup();try{
 await assert.rejects(()=>t.g.start({}),/client file first/);await t.g.saveClient(JSON.stringify(WEB));
 assert.equal(statSync(path.join(t.H,'google_client_secret.json')).mode&0o777,0o600);const info=await t.g.info();assert.equal(info.client.type,'web');assert.equal(info.client.redirectOk,true);
 const s=await t.g.start({agent:'default',services:['drive','gmail']});const u=new URL(s.url);assert.equal(s.paste,false);
 assert.equal(u.searchParams.get('redirect_uri'),'https://ai.example.test/google-oauth/callback');assert.equal(u.searchParams.get('access_type'),'offline');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 assert.equal(await t.g.has(s.state),true);assert.deepEqual(await t.g.result(s.state),{waiting:true});
 const r=await t.g.finish('?state='+s.state+'&code=abc');assert.equal(r.ok,true);assert.equal(r.file,'google_token.json');assert.equal(r.email,'owner@x.test');
 const sent=t.calls.find(c=>c.body.grant_type==='authorization_code').body;const pend=JSON.parse(readFileSync(path.join(t.DATA,'google-connect.json'),'utf8'));assert.ok(sent.code_verifier);
 assert.equal(createHash('sha256').update(sent.code_verifier).digest('base64url'),u.searchParams.get('code_challenge'));
 const f=JSON.parse(readFileSync(path.join(t.H,'google_token.json'),'utf8'));assert.equal(f.type,'authorized_user');assert.equal(f.account,'owner@x.test');assert.equal(f.refresh_token,'r1');assert.ok(f.client_id&&f.client_secret&&f.token_uri);
 assert.equal(statSync(path.join(t.H,'google_token.json')).mode&0o777,0o600);assert.equal((await t.g.result(s.state)).ok,true);
 await assert.rejects(()=>t.g.finish('?state='+s.state+'&code=abc'),/expired or was already used/);assert.equal(pend[s.state].verifier,null,"the code verifier is not kept after use")}finally{t.done()}});

test('connect (desktop client): the pasted address finishes; another account on the same agent needs a name',async()=>{const t=setup({email:'work@x.test'});try{await t.g.saveClient(DESK);
 writeFileSync(path.join(t.H,'google_token.json'),JSON.stringify({account:'main@x.test',refresh_token:'old',scopes:[]}));
 await assert.rejects(()=>t.g.start({agent:'default'}),/main Google account/);
 const s=await t.g.start({agent:'default',name:'Work'});assert.equal(s.paste,true);assert.equal(new URL(s.url).searchParams.get('redirect_uri'),'http://localhost');
 const r=await t.g.finish('http://localhost/?state='+s.state+'&code=abc&scope=x');assert.equal(r.file,'google_token_work.json');
 const l=await t.g.accounts('default');assert.deepEqual(l.map(a=>[a.name,a.email]),[['','main@x.test'],['work','work@x.test']]);assert.deepEqual(l[1].services,['gmail','drive'])}finally{t.done()}});

test('a profile agent gets its own file; a share is never listed or removed here',async()=>{const t=setup();try{await t.g.saveClient(WEB);
 const s=await t.g.start({agent:'sales'});await t.g.finish('?state='+s.state+'&code=c');assert.ok(existsSync(path.join(t.H,'profiles','sales','google_token.json')));
 writeFileSync(path.join(t.H,'profiles','sales','google_token_shared.json'),JSON.stringify({account:'o@x.test',aqeelos_managed:true}));
 assert.deepEqual((await t.g.accounts('sales')).map(a=>a.name),['']);await assert.rejects(()=>t.g.remove('sales','shared'),/share/)}finally{t.done()}});

test('reconnect keeps the file; the wrong account is refused and nothing is written',async()=>{const t=setup({email:'other@x.test',refresh:'r2'});try{await t.g.saveClient(WEB);
 writeFileSync(path.join(t.H,'google_token_work.json'),JSON.stringify({account:'work@x.test',refresh_token:'old',scopes:['https://www.googleapis.com/auth/drive']}));
 const s=await t.g.start({agent:'default',name:'work',reconnect:true});assert.equal(new URL(s.url).searchParams.get('login_hint'),'work@x.test');
 await assert.rejects(()=>t.g.finish('?state='+s.state+'&code=c'),/signed in as other@x.test/);assert.equal(JSON.parse(readFileSync(path.join(t.H,'google_token_work.json'),'utf8')).refresh_token,'old');
 assert.match((await t.g.result(s.state)).error,/other@x.test/)}finally{t.done()}});

test('the same Google account again renews its file instead of a second copy',async()=>{const t=setup({email:'main@x.test',refresh:'new'});try{await t.g.saveClient(WEB);
 writeFileSync(path.join(t.H,'google_token.json'),JSON.stringify({account:'main@x.test',refresh_token:'old',scopes:[]}));
 const s=await t.g.start({agent:'default',name:'again'});const r=await t.g.finish('?state='+s.state+'&code=c');assert.equal(r.file,'google_token.json');assert.equal(r.renewed,true);
 assert.ok(!existsSync(path.join(t.H,'google_token_again.json')));assert.equal(JSON.parse(readFileSync(path.join(t.H,'google_token.json'),'utf8')).refresh_token,'new')}finally{t.done()}});

test('cancel on Google, no lasting sign-in, check and remove',async()=>{const t=setup({refresh:''});try{await t.g.saveClient(WEB);
 let s=await t.g.start({agent:'default'});await assert.rejects(()=>t.g.finish('?state='+s.state+'&error=access_denied'),/Cancel/);
 s=await t.g.start({agent:'default'});await assert.rejects(()=>t.g.finish('?state='+s.state+'&code=c'),/no lasting sign-in/);assert.ok(!existsSync(path.join(t.H,'google_token.json')));
 writeFileSync(path.join(t.H,'google_token.json'),JSON.stringify({account:'a@x.test',refresh_token:'r',client_id:'c',client_secret:'s'}));
 assert.deepEqual(await t.g.check('default',''),{ok:true});const t2=setup({refreshOk:false});try{writeFileSync(path.join(t2.H,'google_token.json'),JSON.stringify({account:'a@x.test',refresh_token:'r'}));assert.match((await t2.g.check('default','')).why,/ended this sign-in/)}finally{t2.done()}
 assert.equal((await t.g.remove('default','')).email,'a@x.test');assert.ok(!existsSync(path.join(t.H,'google_token.json')));await t.g.removeClient();assert.equal((await t.g.info()).client,null)}finally{t.done()}});
