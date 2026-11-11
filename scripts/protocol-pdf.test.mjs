// The protocol PDF over WhatsApp: the one-purpose link, the member-app client, the sender and the tool (12 Nov 2026, issue i19b649d9).
// Run: node --test scripts/protocol-pdf.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDocLinks,DOC_TTL,DOC_MAX_HITS,safeName} from '../app/doc-links.mjs';
import {createProtocolPdf,createProtocolSender} from '../app/protocol-pdf.mjs';
import {createCustomerTools,TOOLS} from '../app/customer-tools.mjs';

const PDF=Buffer.from('%PDF-1.4\n'+'x'.repeat(200));
const res=()=>{const r={code:0,head:{},body:null,writeHead(c,h){r.code=c;r.head=h||{}},end(b){r.body=b}};return r};
const tokenOf=url=>/\/doc\/([\w-]{43})\//.exec(url)[1];

test('a file link: one PDF, an unguessable token, 15 minutes, a few downloads, then the same plain 404',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'dl-'));let t=1e12;const L=createDocLinks({DATA,PUBLIC_URL:'https://ai.example',now:()=>t});
 await assert.rejects(L.put({buffer:Buffer.from('<html>'),name:'a.pdf'}),/not a PDF/);
 await assert.rejects(createDocLinks({DATA,PUBLIC_URL:'http://ai.example'}).put({buffer:PDF,name:'a.pdf'}),/https/);
 const a=await L.put({buffer:PDF,name:'Protocol.pdf'}),b=await L.put({buffer:PDF,name:'Protocol.pdf'});
 assert.match(a.url,/^https:\/\/ai\.example\/doc\/[\w-]{43}\/Protokol%20Continue\.pdf$/);assert.notEqual(tokenOf(a.url),tokenOf(b.url));assert.equal(a.exp,t+DOC_TTL);
 const get=async(url,method='GET')=>{const r=res();await L.serve({method},r,tokenOf(url),url.split('/').pop());return r};
 const ok=await get(a.url);assert.equal(ok.code,200);assert.equal(ok.head['content-type'],'application/pdf');assert.deepEqual(ok.body,PDF);assert.equal(ok.head['cache-control'],'no-store');
 const wrong=res();await L.serve({method:'GET'},wrong,tokenOf(a.url),'other.pdf');assert.equal(wrong.code,404,'wrong name');
 const bad=res();await L.serve({method:'GET'},bad,'A'.repeat(43),'Protokol%20Continue.pdf');assert.equal(bad.code,404);
 for(let i=1;i<DOC_MAX_HITS;i++)assert.equal((await get(a.url)).code,200);assert.equal((await get(a.url)).code,404,'downloads used up');
 assert.equal((await get(b.url,'HEAD')).code,200,'a HEAD does not use a download');
 t+=DOC_TTL+1;assert.equal((await get(b.url)).code,404,'expired');assert.equal(L.count(),0);assert.deepEqual(await readdir(path.join(DATA,'doc-links')),[],'the files are gone too');
 const c=await L.put({buffer:PDF,name:'x.pdf'});await c.revoke();assert.equal((await get(c.url)).code,404,'revoked');
 assert.match(safeName('../../etc/passwd'),/^[\w-]+\.pdf$/);
 const stale=createDocLinks({DATA,PUBLIC_URL:'https://ai.example'});await stale.put({buffer:PDF,name:'k.pdf'});assert.equal((await readdir(path.join(DATA,'doc-links'))).length,1)});

async function member({members=[{id:7,phone:'0812-3456-7890'}],protocols=[{name:'P'}],pdf=PDF,status={}}={}){
 const W=await mkdtemp(path.join(tmpdir(),'pp-'));await mkdir(path.join(W,'cove-support','.secrets'),{recursive:true});await writeFile(path.join(W,'cove-support','.secrets','MEMBER_PW'),'s3cret\n');
 const calls=[];const fetchFn=async(url,o)=>{const u=new URL(url);calls.push([o.method,u.pathname+u.search,o.headers.cookie||'',o.body||'']);
  const ok=j=>({ok:true,status:200,headers:{getSetCookie:()=>['sid=abc; Path=/; HttpOnly']},json:async()=>j,arrayBuffer:async()=>pdf});
  if(status[u.pathname])return {ok:false,status:status[u.pathname]};
  if(u.pathname==='/api/auth/verify-identity')return ok({ok:true});if(u.pathname==='/api/admin/customers')return ok(members);
  if(/^\/api\/admin\/customers\/\d+$/.test(u.pathname))return ok({protocols});if(u.pathname==='/api/protocols/export-all.pdf')return ok(null);return {ok:false,status:404}};
 return {W,calls,make:createProtocolPdf({WORK:W,fetchFn})}}
const CFG={baseUrl:'https://member.example',email:'admin@example.com',secret:'MEMBER_PW',lang:'id',filename:'Protokol.pdf',caption:'Ini protokolnya.'};

test('the member app client: login, this chat own number only, then the PDF; no member, two members or no protocol send nothing',async()=>{
 const m=await member();const r=await m.make('cove-support','+62 812-3456-7890',CFG);
 assert.deepEqual([r.pdf.equals(PDF),r.filename,r.caption],[true,'Protokol.pdf','Ini protokolnya.']);
 assert.equal(m.calls[0][3],JSON.stringify({emailOrPhone:'admin@example.com',memberCode:'s3cret'}));assert.match(m.calls.at(-1)[1],/export-all\.pdf\?customerId=7&lang=id/);assert.equal(m.calls.at(-1)[2],'sid=abc','the session cookie is kept');
 assert.match((await m.make('cove-support','6280000000008',CFG)).none,/No member/);
 assert.match((await (await member({members:[{id:1,phone:'6281234567890'},{id:2,whatsappNumber:'081234567890'}]})).make('cove-support','6281234567890',CFG)).none,/More than one/);
 assert.match((await (await member({protocols:[]})).make('cove-support','6281234567890',CFG)).none,/no protocol/);
 await assert.rejects((await member({pdf:Buffer.from('<html>')})).make('cove-support','6281234567890',CFG),/did not return a PDF/);
 await assert.rejects((await member({status:{'/api/auth/verify-identity':401}})).make('cove-support','6281234567890',CFG),/member app error 401/);
 await assert.rejects(m.make('cove-support','6281234567890',{...CFG,secret:'../x'}),/incomplete/);await assert.rejects(m.make('cove-support','12',CFG),/no customer number/);
 await assert.rejects(m.make('cove-support','6281234567890',{...CFG,baseUrl:'http://member.example'}),/https/)});

test('the sender: PDF, one-purpose link, document message with that link, link dropped after (also when the send fails)',async()=>{
 const m=await member(),DATA=await mkdtemp(path.join(tmpdir(),'dl-')),docLinks=createDocLinks({DATA,PUBLIC_URL:'https://ai.example'});const sent=[];let fail=false;
 const send=createProtocolSender({make:m.make,docLinks,sendDocument:async(a,to,o)=>{sent.push([a,to,o]);assert.equal(docLinks.count(),1,'the link exists while Kirimdev fetches it');if(fail)throw Error('Kirimdev said no')}});
 assert.deepEqual(await send('cove-support',{phone:'6281234567890'},CFG),{sent:true,filename:'Protokol.pdf'});
 assert.deepEqual([sent[0][1],sent[0][2].filename,sent[0][2].caption],['6281234567890','Protokol.pdf','Ini protokolnya.']);assert.match(sent[0][2].link,/^https:\/\/ai\.example\/doc\//);assert.equal(docLinks.count(),0);
 fail=true;await assert.rejects(send('cove-support',{phone:'6281234567890'},CFG),/Kirimdev said no/);assert.equal(docLinks.count(),0);
 assert.match((await send('cove-support',{phone:'6280000000008'},CFG)).none,/No member/);assert.equal(sent.length,2,'nothing sent for an unknown number')});

test('the tool: only on a line with the setting, once per run, only to this chat number, failures tell the agent to hand off',async()=>{
 assert.equal(TOOLS('qris',{},{},false,false,false,false,false).some(t=>t.name==='send_protocol_pdf'),false);assert.ok(TOOLS('qris',{},{},false,false,false,false,true).some(t=>t.name==='send_protocol_pdf'));
 const W=await mkdtemp(path.join(tmpdir(),'ct-'));await mkdir(path.join(W,'cove-support','.tools'),{recursive:true});await writeFile(path.join(W,'cove-support','.tools','qris'),'x');const got=[];let boom=false;
 const C=createCustomerTools({WORK:W,DATA:path.join(W,'d'),pdfRules:async a=>a==='cove-support'?CFG:null,sendProtocolPdf:async(a,r,c)=>{got.push([a,r,c]);if(boom)throw Error('member app error 500');return {sent:true}},googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',runAsAgent:async()=>({ok:true,out:''}),log:()=>{}});
 const tools=async a=>(await C.mcp(a,undefined,{jsonrpc:'2.0',id:1,method:'tools/list'})).body.result.tools.map(x=>x.name);
 assert.ok((await tools('cove-support')).includes('send_protocol_pdf'));assert.ok(!(await tools('bay-sales')).includes('send_protocol_pdf'),'another line does not get it');
 const tok=C.begin({agent:'cove-support',line:'1',conversation:'cnv_1',phone:'6281234567890',mode:'live'});
 const x=await C.call('cove-support',tok,'send_protocol_pdf',{phone:'629999999999'});assert.match(x.text,/was sent/);assert.equal(got[0][1].phone,'6281234567890','the number comes from the run, never from the model');
 assert.equal((await C.call('cove-support',tok,'send_protocol_pdf',{})).isError,true,'once per run');assert.equal(got.length,1);
 const t2=C.begin({agent:'cove-support',line:'1',conversation:'cnv_1',phone:'6281234567890',mode:'live'});boom=true;const y=await C.call('cove-support',t2,'send_protocol_pdf',{});assert.equal(y.isError,true);assert.match(y.text,/hand off/);
 const t3=C.begin({agent:'bay-sales',line:'2',conversation:'c',phone:'6281',mode:'live'});assert.equal((await C.call('bay-sales',t3,'send_protocol_pdf',{})).isError,true)});
