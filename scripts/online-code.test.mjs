// Online Code is a per-install setting, OFF by default (owner, 12 Nov 2026: coding happens on people's own computers).
// Covers the rule, the marker file the box's start script reads, the settings route, the addresses' answer while off,
// and scripts/online-code.mjs (what box-live.sh asks before installing Code's packages). Live publishing does not depend on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const DIR=mkdtempSync(path.join(tmpdir(),'aq-oc-'));
process.env.UI_DATA_DIR=path.join(DIR,'data');delete process.env.ONLINE_CODE;
const I=await import('../app/install-routes.mjs');
const {createCodeOnline}=await import('../app/code-online.mjs');

test('the rule: off unless this install switched it on; the environment wins either way',()=>{
 assert.equal(I.onlineCodeRule({},{}),false);assert.equal(I.onlineCodeRule({},{onlineCode:true}),true);assert.equal(I.onlineCodeRule({},{onlineCode:'yes'}),false,'only a real true');
 assert.equal(I.onlineCodeRule({ONLINE_CODE:'1'},{}),true);assert.equal(I.onlineCodeRule({ONLINE_CODE:'off'},{onlineCode:true}),false);assert.equal(I.onlineCodeRule({ONLINE_CODE:''},{onlineCode:true}),true,'empty counts as unset');
 assert.equal(I.onlineCodeFrom({ONLINE_CODE:'0'}),'env');assert.equal(I.onlineCodeFrom({}),'setting')});

test('the marker file for the box start script follows the setting',()=>{
 const home=path.join(DIR,'home');writeFileSync(path.join(DIR,'x'),'');const f=path.join(home,'.aqeelos-online-code');
 assert.equal(I.syncOnlineCodeMarker({home:DIR,on:false}),false);assert.equal(existsSync(path.join(DIR,'.aqeelos-online-code')),false,'off and none there: fine');
 assert.equal(I.syncOnlineCodeMarker({home:DIR,on:true}),true);assert.ok(existsSync(path.join(DIR,'.aqeelos-online-code')));
 assert.equal(I.syncOnlineCodeMarker({home:DIR,on:false}),false);assert.equal(existsSync(path.join(DIR,'.aqeelos-online-code')),false);void f});

const admin={id:'owner',admin:true},member={id:'m',admin:false};
function routes(){const r=I.createInstallRoutes({send:(res,code,body)=>{res.code=code;res.body=body},readBody:async req=>req.body||'',isAdmin:u=>u.admin,listAgents:async()=>[],setKey:async()=>({ok:true}),hermes:async()=>({ok:true}),log:()=>{}});return r}
const call=async(r,u,method,p,body)=>{const req={method,headers:{host:'ai.example.com'},body:body?JSON.stringify(body):''},res={};await r.handle(req,res,u,new URL('http://x'+p));return res};

test('the settings route: off by default, admins switch it, the environment locks it',async()=>{const r=routes();
 assert.deepEqual((await call(r,admin,'GET','/ui/install')).body.onlineCode,{on:false,from:'setting'});assert.equal((await call(r,member,'GET','/ui/install')).body.onlineCode,undefined);
 assert.equal((await call(r,member,'POST','/ui/install/online-code',{on:true})).code,403);
 const on=await call(r,admin,'POST','/ui/install/online-code',{on:true});assert.equal(on.body.on,true);assert.equal(I.onlineCodeOn(),true);
 const off=await call(r,admin,'POST','/ui/install/online-code',{on:false});assert.equal(off.body.on,false);assert.equal(I.onlineCodeOn(),false);assert.equal(I.settings().onlineCode,undefined);
 process.env.ONLINE_CODE='1';assert.equal((await call(r,admin,'POST','/ui/install/online-code',{on:false})).code,409);delete process.env.ONLINE_CODE});

function fakeRes(){const r={head:null,body:'',writeHead(c,h){r.head={c,h}},end(b){r.body=String(b||'')}};return r}
test('while off, the Code addresses answer one plain message and nothing reaches the workspace',()=>{
 let on=false;const C=createCodeOnline({SECRET:'s'.repeat(32),SECURE:true,users:()=>({}),HOST:'code.example.com',PREVIEW_HOST:'code-preview.example.com',enabled:()=>on});
 for(const host of ['code.example.com','code-preview.example.com']){const res=fakeRes();
  assert.equal(C.handle({url:'/api/x',method:'POST',headers:{host}},res),true);assert.equal(res.head.c,410);assert.match(res.body,/Coding happens on your own computer; publish from the Build app\./)}
 const other=fakeRes();assert.equal(C.handle({url:'/',method:'GET',headers:{host:'ai.example.com'}},other),false,'other addresses are not touched');
 on=true;const res=fakeRes();C.handle({url:'/api/x',method:'GET',headers:{host:'code.example.com'}},res);assert.equal(res.head.c,401,'on again: the sign-in check is back')});

test('scripts/online-code.mjs answers what box-live.sh needs',()=>{
 const run=env=>execFileSync(process.execPath,[fileURLToPath(new URL('./online-code.mjs',import.meta.url))],{env:{PATH:process.env.PATH,UI_DATA_DIR:path.join(DIR,'data2'),...env},encoding:'utf8'}).trim();
 assert.equal(run({}),'off');assert.equal(run({ONLINE_CODE:'1'}),'on');assert.equal(run({ONLINE_CODE:'0'}),'off')});
