// Tests for Connect Microsoft (app/microsoft-connect.mjs). Run: node --test scripts/microsoft-connect.test.mjs
// A fake Microsoft answers the token calls: the pasted ID and secret are checked in plain words (a Secret ID is not the
// Value), the sign-in address has PKCE, offline access and the install's return address, the callback writes a private
// sign-in file for the agent, Reconnect keeps the account, a check saves the new refresh token, and AADSTS errors are said plainly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,rmSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createMicrosoftConnect,parseClient,cleanTenant,scopesFor,servicesOf,emailOf,codeFrom,plainError,authUrl,tokenUrl} from '../app/microsoft-connect.mjs';

const ID='0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',SECRET='Abc8Q~xyzXYZ0123456789_abcdefghijklmnop';
const jwt=o=>'x.'+Buffer.from(JSON.stringify(o)).toString('base64url')+'.y';
function setup({email='owner@contoso.test',refreshOk=true}={}){const T=mkdtempSync(path.join(tmpdir(),'aq-ms-')),H=path.join(T,'hh'),DATA=path.join(T,'data');mkdirSync(H,{recursive:true});
 const who={email};const calls=[];const fetchImpl=async(url,o={})=>{const body=Object.fromEntries(new URLSearchParams(o.body||''));calls.push({url,body});
  if(body.grant_type==='authorization_code')return {ok:true,json:async()=>({access_token:'at',refresh_token:'r1',expires_in:3600,scope:'https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/User.Read openid',id_token:jwt({preferred_username:who.email})})};
  if(body.grant_type==='refresh_token')return refreshOk?{ok:true,json:async()=>({access_token:'at2',refresh_token:'r2',expires_in:3600})}:{ok:false,status:400,json:async()=>({error:'invalid_grant',error_description:'AADSTS70000: expired'})};
  throw Error('unexpected '+url)};
 const m=createMicrosoftConnect({HERMES_HOME:H,DATA,PUBLIC_URL:{toString:()=>'https://ai.example.test/'},fetchImpl});return {T,H,DATA,m,calls,who,done:()=>rmSync(T,{recursive:true,force:true})}}

test('the pasted app ID and secret: right ones pass, the usual mistakes are said plainly',()=>{
 assert.deepEqual(parseClient({client_id:ID.toUpperCase(),client_secret:SECRET}),{client_id:ID,client_secret:SECRET,tenant:'common'});
 assert.throws(()=>parseClient({}),/client\) ID first/);
 assert.throws(()=>parseClient({client_id:'aqeelos',client_secret:SECRET}),/does not look like an Application/);
 assert.throws(()=>parseClient({client_id:ID}),/Value too/);
 assert.throws(()=>parseClient({client_id:ID,client_secret:'11111111-2222-3333-4444-555555555555'}),/Secret ID/);
 assert.throws(()=>parseClient({client_id:ID,client_secret:'short'}),/Value column/);
 assert.equal(cleanTenant(''),'common');assert.equal(cleanTenant('Contoso.onmicrosoft.com'),'contoso.onmicrosoft.com');assert.equal(cleanTenant(ID),ID);
 assert.throws(()=>cleanTenant('not a tenant'),/Directory \(tenant\) ID/)});

test('scopes, services and addresses',()=>{const s=scopesFor(['mail']);for(const x of ['openid','offline_access','User.Read','Mail.ReadWrite','Mail.Send'])assert.ok(s.includes(x),x);assert.ok(!s.includes('Calendars.ReadWrite'));
 assert.deepEqual(servicesOf(scopesFor()),['mail','calendar','files']);assert.deepEqual(servicesOf(['https://graph.microsoft.com/Files.ReadWrite.All']),['files']);
 assert.throws(()=>scopesFor(['nope']),/at least one/);
 assert.equal(authUrl('common'),'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');assert.equal(tokenUrl(ID),'https://login.microsoftonline.com/'+ID+'/oauth2/v2.0/token');
 assert.equal(emailOf(jwt({preferred_username:'A@B.test'})),'a@b.test');assert.equal(emailOf(jwt({email:'e@x.test',preferred_username:'p@x.test'})),'e@x.test');
 assert.deepEqual(codeFrom('https://ai.example.test/microsoft-oauth/callback?code=c&state=s'),{code:'c',state:'s',error:'',why:''})});

test('AADSTS errors in plain words',()=>{assert.match(plainError('invalid_request','AADSTS50011: The redirect URI'),/return address/);
 assert.match(plainError('invalid_client','AADSTS7000215: Invalid client secret'),/secret is wrong/);assert.match(plainError('unauthorized_client','AADSTS700016: not found'),/personal accounts/);
 assert.match(plainError('access_denied',''),/Cancel/);assert.match(plainError('consent_required','AADSTS65001'),/admin/);assert.match(plainError('x','something new'),/something new/)});

test('connect: PKCE address with offline access; the callback writes a private sign-in file',async()=>{const t=setup();try{
 await assert.rejects(t.m.start({agent:'sales'}),/Microsoft app first/);
 const inf=await t.m.saveClient({client_id:ID,client_secret:SECRET});assert.ok(!JSON.stringify(inf).includes(SECRET));assert.equal(inf.redirect,'https://ai.example.test/microsoft-oauth/callback');assert.ok(inf.permissions.includes('Files.ReadWrite.All'));
 const s=await t.m.start({agent:'sales',services:['mail']});const u=new URL(s.url);
 assert.equal(u.origin+u.pathname,'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
 assert.equal(u.searchParams.get('client_id'),ID);assert.equal(u.searchParams.get('redirect_uri'),inf.redirect);assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 assert.ok(u.searchParams.get('scope').split(' ').includes('offline_access'));assert.ok(await t.m.has(s.state));
 const r=await t.m.finish('?code=abc&state='+s.state);assert.equal(r.ok,true);assert.equal(r.email,'owner@contoso.test');assert.deepEqual(r.services,['mail']);
 const sent=t.calls[0].body,pend=JSON.parse(readFileSync(path.join(t.DATA,'microsoft-connect.json'),'utf8'));
 assert.equal(sent.client_secret,SECRET);assert.equal(createHash('sha256').update(sent.code_verifier).digest('base64url'),u.searchParams.get('code_challenge'));assert.equal(pend[s.state].verifier,null);
 const f=path.join(t.H,'profiles','sales','microsoft_token.json'),tok=JSON.parse(readFileSync(f,'utf8'));
 assert.equal(tok.refresh_token,'r1');assert.deepEqual(tok.scopes,['Mail.ReadWrite','User.Read','openid']);if(process.platform!=='win32')assert.equal(statSync(f).mode&0o777,0o600);
 assert.deepEqual(await t.m.result(s.state),r);await assert.rejects(t.m.finish('?code=abc&state='+s.state),/expired or was already used/);
 assert.equal((await t.m.accounts('sales'))[0].email,'owner@contoso.test');
 await assert.rejects(t.m.start({agent:'sales'}),/already has a main Microsoft account/)}finally{t.done()}});

test('cancel on Microsoft, and check: a new refresh token is saved; a dead sign-in says Reconnect',async()=>{const t=setup();try{
 await t.m.saveClient({client_id:ID,client_secret:SECRET});const s=await t.m.start({agent:'default'});
 await assert.rejects(t.m.finish('?error=access_denied&state='+s.state),/Cancel/);assert.equal((await t.m.result(s.state)).ok,false);
 const s2=await t.m.start({agent:'default'});await t.m.finish('?code=c&state='+s2.state);
 assert.deepEqual(await t.m.check('default',''),{ok:true});assert.equal(JSON.parse(readFileSync(path.join(t.H,'microsoft_token.json'),'utf8')).refresh_token,'r2');
 const re=await t.m.start({agent:'default',name:'',reconnect:true});assert.equal(new URL(re.url).searchParams.get('login_hint'),'owner@contoso.test');
 await t.m.remove('default','');assert.ok(!existsSync(path.join(t.H,'microsoft_token.json')))}finally{t.done()}
 const d=setup({refreshOk:false});try{await d.m.saveClient({client_id:ID,client_secret:SECRET});const s=await d.m.start({agent:'default'});await d.m.finish('?code=c&state='+s.state);
  const r=await d.m.check('default','');assert.equal(r.ok,false);assert.match(r.why,/Reconnect/)}finally{d.done()}});

test('reconnect with another account is refused',async()=>{const t=setup();try{await t.m.saveClient({client_id:ID,client_secret:SECRET});
 const s=await t.m.start({agent:'default',name:'work'});await t.m.finish('?code=c&state='+s.state);
 t.who.email='other@x.test';const re=await t.m.start({agent:'default',name:'work',reconnect:true});
 await assert.rejects(t.m.finish('?code=c&state='+re.state),/You signed in as other@x.test, but this account is owner@contoso.test/);
 assert.equal(JSON.parse(readFileSync(path.join(t.H,'microsoft_token_work.json'),'utf8')).account,'owner@contoso.test')}finally{t.done()}});
