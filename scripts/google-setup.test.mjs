// Tests for the guided Google setup (app/google-connect.mjs: checkClient, siteFor, authVerdict, checkFile).
// Run: node --test scripts/google-setup.test.mjs
// The client file is checked against this install's own return address before it is saved: a Desktop client, a wrong
// or missing return address, another project and missing fields are each said plainly; a good file passes. Google's
// answer to a sign-in address (no person) tells a good client from a bad one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGoogleConnect,checkClient,siteFor,authVerdict} from '../app/google-connect.mjs';

const R='https://ai.example.com/google-oauth/callback';
const web=(o={})=>({web:{client_id:'123456789-abc.apps.googleusercontent.com',client_secret:'s3',project_id:'aqeelos-482915',redirect_uris:[R],...o}});
const err=b64=>'https://accounts.google.com/signin/oauth/error?authError='+encodeURIComponent(Buffer.from(b64).toString('base64'))+'&client_id=x';

test('a good Web application file passes, from text or an object',()=>{
 const c=checkClient(JSON.stringify(web()),{redirect:R});assert.equal(c.type,'web');assert.equal(c.project,'aqeelos-482915');
 assert.equal(checkClient(web({redirect_uris:['https://other.example/x',R]}),{redirect:R,project:'aqeelos-482915'}).type,'web')});

test('wrong type: a Desktop client or a service account key',()=>{
 assert.throws(()=>checkClient({installed:web().web},{redirect:R}),/Desktop client\. Create a Web application client/);
 assert.throws(()=>checkClient({type:'service_account',client_email:'x@y'},{redirect:R}),/service account/)});

test('wrong or missing return address names both addresses',()=>{
 assert.throws(()=>checkClient(web({redirect_uris:['https://ai.example.com/google-oauth/callback/']}),{redirect:R}),
  e=>e.message.includes('The return address in this file is https://ai.example.com/google-oauth/callback/, it must be '+R));
 assert.throws(()=>checkClient(web({redirect_uris:['http://ai.example.com/google-oauth/callback']}),{redirect:R}),/it must be https:\/\/ai\.example\.com/);
 assert.throws(()=>checkClient(web({redirect_uris:undefined}),{redirect:R}),/no return address\. .*add https:\/\/ai\.example\.com\/google-oauth\/callback/)});

test('missing fields and other projects',()=>{
 assert.throws(()=>checkClient('{"web":',{redirect:R}),/not the JSON file/);
 assert.throws(()=>checkClient({web:{client_id:'123-abc.apps.googleusercontent.com'}},{redirect:R}),/no client ID and secret/);
 assert.throws(()=>checkClient({web:{client_secret:'s'}},{redirect:R}),/no client ID and secret/);
 assert.throws(()=>checkClient({},{redirect:R}),/no client ID and secret/);
 assert.throws(()=>checkClient(web({client_id:'abc'}),{redirect:R}),/does not look like/);
 assert.throws(()=>checkClient(web({project_id:undefined}),{redirect:R}),/no project ID/);
 assert.throws(()=>checkClient(web(),{redirect:R,project:'my-other-proj'}),/from the project aqeelos-482915, not my-other-proj/)});

test('the install\'s home page, authorised domain and address problems',()=>{
 assert.deepEqual(siteFor(R),{home:'https://ai.example.com',domain:'example.com',issue:'',local:false});
 assert.equal(siteFor('https://ai.example.org/google-oauth/callback').domain,'example.org');
 assert.equal(siteFor('https://os.toko.co.id/x').domain,'toko.co.id');assert.equal(siteFor('https://a.b.example.co.uk/').domain,'example.co.uk');
 assert.match(siteFor('http://ai.example.com/x').issue,/https/);assert.match(siteFor('https://203.0.113.7/x').issue,/bare IP/);
 const l=siteFor('http://localhost:4400/google-oauth/callback');assert.equal(l.issue,'');assert.equal(l.local,true);assert.equal(l.domain,'');
 assert.match(siteFor('').issue,/no web address/)});

test('Google\'s answer: sign-in page is good; each error is read from authError',()=>{
 assert.deepEqual(authVerdict({status:302,location:'https://accounts.google.com/v3/signin/identifier?client_id=x'}),{ok:true});
 assert.deepEqual(authVerdict({status:200}),{ok:true});
 const bad=authVerdict({status:302,location:err('\n\x0einvalid_client\x12\x1fThe OAuth client was not found.')});assert.equal(bad.ok,false);assert.equal(bad.code,'invalid_client');assert.match(bad.why,/does not know this client/);
 const mis=authVerdict({status:302,location:err('\n\x15redirect_uri_mismatch\x12...')},R);assert.equal(mis.code,'redirect_uri_mismatch');assert.ok(mis.why.includes(R));
 assert.equal(authVerdict({status:302,location:err('\n\x0edeleted_client')}).code,'deleted_client');
 assert.equal(authVerdict({status:400,body:'<html>Error 401: disabled_client</html>'}).code,'disabled_client');
 assert.equal(authVerdict({status:302,location:'https://accounts.google.com/signin/oauth/error'}).code,'error');
 assert.equal(authVerdict({status:0}).ok,null)});

test('checkFile: checks without saving; test asks Google with this install\'s return address',async()=>{
 const T=mkdtempSync(path.join(tmpdir(),'aq-gs-')),H=path.join(T,'hh');mkdirSync(H,{recursive:true});const seen=[];
 let answer={status:302,location:'https://accounts.google.com/v3/signin/identifier?x=1'};
 const fetchImpl=async(u,o)=>{seen.push({u:new URL(u),o});return {status:answer.status,headers:{get:k=>k==='location'?answer.location:null},text:async()=>''}};
 const g=createGoogleConnect({HERMES_HOME:H,DATA:path.join(T,'d'),PUBLIC_URL:'https://ai.example.com/',fetchImpl});
 try{const r=await g.checkFile({json:JSON.stringify(web())});assert.equal(r.ok,true);assert.equal(r.client.type,'web');assert.equal(r.client.project,'aqeelos-482915');assert.ok(!r.client.secret&&!JSON.stringify(r).includes('s3'),'the secret is never sent back');
  assert.equal(existsSync(path.join(H,'google_client_secret.json')),false,'nothing is saved');assert.equal(seen.length,0,'Google is not asked unless test is set');
  await assert.rejects(()=>g.checkFile({json:JSON.stringify({installed:web().web})}),/Desktop client/);
  await assert.rejects(()=>g.checkFile({test:true}),/client file first/);
  const t=await g.checkFile({json:web(),test:true});assert.deepEqual(t.google,{ok:true});
  assert.equal(seen[0].u.searchParams.get('redirect_uri'),R);assert.equal(seen[0].u.searchParams.get('client_id'),web().web.client_id);assert.equal(seen[0].o.redirect,'manual');
  await g.saveClient(web());answer={status:302,location:err('\n\x15redirect_uri_mismatch')};const s=await g.checkFile({test:true});assert.equal(s.google.ok,false);assert.equal(s.google.code,'redirect_uri_mismatch');
  const i=await g.info();assert.equal(i.site.domain,'example.com');assert.deepEqual(i.apis.map(a=>a.api),['gmail.googleapis.com','calendar-json.googleapis.com','drive.googleapis.com','sheets.googleapis.com','docs.googleapis.com','people.googleapis.com']);
  const down=createGoogleConnect({HERMES_HOME:H,DATA:path.join(T,'d'),PUBLIC_URL:'https://ai.example.com',fetchImpl:async()=>{throw Error('offline')}});
  const o=await down.checkFile({test:true});assert.equal(o.google.ok,null);assert.match(o.google.why,/could not reach Google/)}
 finally{rmSync(T,{recursive:true,force:true})}});
