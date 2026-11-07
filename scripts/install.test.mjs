// Plug-and-play install (install.mjs, install-routes.mjs): engine keys, the cookie key, Your address, live or test copy,
// the one time zone, per-agent users and the routes on System › Settings. No network: fetch is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,statSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const DIR=mkdtempSync(path.join(tmpdir(),'aq-install-'));
process.env.UI_DATA_DIR=path.join(DIR,'data');
for(const k of ['PUBLIC_URL','AQEELOS_LIVE','UI_PORT','CODE_HOST','CODE_PREVIEW_HOST','LIVE_DOMAIN','UI_SECRET'])delete process.env[k];
const I=await import('../app/install-routes.mjs');

test('engine keys come from the engine’s own .env when the environment has none',()=>{
 const home=path.join(DIR,'hermes');mkdirSync(home,{recursive:true});
 writeFileSync(path.join(home,'.env'),'# keys\nAPI_SERVER_KEY="abc123"\nexport HERMES_DASHBOARD_SESSION_TOKEN=tok # the dashboard\nOTHER=1\n');
 const k=I.engineKeys({},home);assert.equal(k.API_SERVER_KEY,'abc123');assert.equal(k.HERMES_DASHBOARD_SESSION_TOKEN,'tok');assert.deepEqual(k.from,{api:'engine',dash:'engine'});
 const e=I.engineKeys({API_SERVER_KEY:'fromenv'},home);assert.equal(e.API_SERVER_KEY,'fromenv');assert.equal(e.from.api,'env');
 assert.deepEqual(I.engineKeys({},path.join(DIR,'nowhere')).from,{api:'',dash:''})});

test('a fresh engine gets its keys written once into its own .env, never over existing ones',()=>{
 const home=path.join(DIR,'fresh-engine');assert.deepEqual(I.ensureEngineKeys({},home),['API_SERVER_ENABLED','API_SERVER_KEY','HERMES_DASHBOARD_SESSION_TOKEN']);
 const t=readFileSync(path.join(home,'.env'),'utf8'),k=I.engineKeys({},home);assert.ok(k.API_SERVER_KEY.length>=40&&k.HERMES_DASHBOARD_SESSION_TOKEN.length>=30);assert.match(t,/API_SERVER_ENABLED=true/);
 assert.equal(statSync(path.join(home,'.env')).mode&0o777,0o600);assert.deepEqual(I.ensureEngineKeys({},home),[]);assert.equal(readFileSync(path.join(home,'.env'),'utf8'),t);
 assert.deepEqual(I.ensureEngineKeys({API_SERVER_KEY:'x',HERMES_DASHBOARD_SESSION_TOKEN:'y',API_SERVER_ENABLED:'true'},path.join(DIR,'fresh2')),[])});

test('the cookie key is made once, kept owner-only and reused, so sign-ins survive a restart',()=>{
 const d=path.join(DIR,'sec');const a=I.uiSecret({},d);assert.equal(a.from,'made');assert.ok(a.secret.length>=64);
 assert.equal(statSync(path.join(d,'ui-secret')).mode&0o777,0o600);
 const b=I.uiSecret({},d);assert.equal(b.from,'file');assert.equal(b.secret,a.secret);
 assert.equal(I.uiSecret({UI_SECRET:'x'.repeat(40)},d).secret,'x'.repeat(40))});

test('Your address: default, the owner’s setting, the environment; and a live reference for modules made at start',()=>{
 assert.equal(I.publicUrl(),'http://localhost:4400');assert.equal(I.publicUrlFrom(),'default');
 const ref=I.PUBLIC_URL_REF,oauth=I.urlRef('/mcp-oauth');
 I.saveSettings({publicUrl:'https://ai.example.com'});
 assert.equal(I.publicUrl(),'https://ai.example.com');assert.equal(I.publicUrlFrom(),'setting');
 assert.equal(ref+'/kirimdev/a','https://ai.example.com/kirimdev/a');assert.equal(`${ref}/pub`,'https://ai.example.com/pub');
 assert.equal(JSON.stringify({base:ref}),'{"base":"https://ai.example.com"}');assert.equal(new URL(ref).hostname,'ai.example.com');
 assert.equal(oauth+'/api/mcp/oauth/callback/x','https://ai.example.com/mcp-oauth/api/mcp/oauth/callback/x');assert.equal(String(I.PUBLIC_HOST_REF),'ai.example.com');
 process.env.PUBLIC_URL='https://env.example.com/';assert.equal(I.publicUrl(),'https://env.example.com');assert.equal(I.publicUrlFrom(),'env');delete process.env.PUBLIC_URL;
 I.saveSettings({publicUrl:''});assert.equal(I.publicUrlFrom(),'default')});

test('addresses are cleaned and plain words explain a wrong one',()=>{
 assert.equal(I.cleanUrl(' https://ai.example.com/ '),'https://ai.example.com');
 assert.throws(()=>I.cleanUrl('ai example'),/not a web address/);assert.throws(()=>I.cleanUrl('ftp://x.com'),/https/);assert.throws(()=>I.cleanUrl('https://x.com/app'),/without a path/);
 assert.equal(I.localAddress('http://localhost:4400'),true);assert.equal(I.localAddress('https://ai.example.com'),false)});

test('the address check proves it reaches this very install',async()=>{
 const id=I.installId();assert.ok(id);
 const hit=body=>async url=>{assert.match(String(url),/\/install-ping$/);return {ok:true,status:200,json:async()=>body}};
 assert.deepEqual(await I.checkAddress('https://ai.example.com',{fetchImpl:hit({id})}),{ok:true,url:'https://ai.example.com',https:true,why:''});
 const other=await I.checkAddress('https://ai.example.com',{fetchImpl:hit({id:'someone-else'})});assert.equal(other.ok,false);assert.match(other.why,/different aqeelOS/);
 const plain=await I.checkAddress('http://1.2.3.4:4400',{fetchImpl:hit({id})});assert.equal(plain.ok,true);assert.match(plain.why,/https/);
 const down=await I.checkAddress('https://ai.example.com',{fetchImpl:async()=>{throw new TypeError('fetch failed')}});assert.equal(down.ok,false);assert.match(down.why,/Nothing answers/);
 const bad=await I.checkAddress('https://ai.example.com',{fetchImpl:async()=>({ok:false,status:502,json:async()=>({})})});assert.match(bad.why,/502/);
 assert.equal((await I.checkAddress('',{fetchImpl:hit({id})})).ok,false)});

test('live or test copy: AQEELOS_LIVE decides; without it only the usual port is live',()=>{
 assert.equal(I.isLive({AQEELOS_LIVE:'1',UI_PORT:'4402'}),true);assert.equal(I.isLive({AQEELOS_LIVE:'0'}),false);assert.equal(I.isLive({AQEELOS_LIVE:'off',UI_PORT:'4400'}),false);
 assert.equal(I.isLive({}),true);assert.equal(I.isLive({UI_PORT:'4402'}),false);assert.equal(I.liveFrom({AQEELOS_LIVE:'1'}),'env');assert.equal(I.liveFrom({}),'port')});

test('one time zone for the whole install, followed by the process',()=>{
 assert.equal(I.installTz(),'');I.saveSettings({timezone:'Not/AZone'});assert.equal(I.installTz(),'');
 I.saveSettings({timezone:'Europe/Amsterdam'});assert.equal(I.installTz(),'Europe/Amsterdam');
 const was=process.env.TZ;I.applyTz();assert.equal(process.env.TZ,'Europe/Amsterdam');assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone,'Europe/Amsterdam');
 if(was===undefined)delete process.env.TZ;else process.env.TZ=was;I.saveSettings({timezone:''})});

test('per-agent users: missing, stopped or running, with the one command that fixes it',()=>{
 const now=Date.now(),st=m=>f=>m[path.basename(f)]?{mtimeMs:m[path.basename(f)]}:null;
 const none=I.agentUsersState({home:'/h',now,statImpl:st({})});assert.equal(none.ok,false);assert.equal(none.seen,false);assert.match(none.fix,/^sudo bash .*scripts\/install\.sh --agent-users$/);
 assert.equal(I.agentUsersState({home:'/h',now,statImpl:st({'.aqeelos-agent-users.alive':now-30e3})}).ok,true);
 assert.equal(I.agentUsersState({home:'/h',now,statImpl:st({'.aqeelos-agent-users.done':now-60*60e3})}).ok,true);
 const old=I.agentUsersState({home:'/h',now,statImpl:st({'.aqeelos-agent-users.alive':now-10*60e3,'.aqeelos-agent-users.done':now-10*60e3})});assert.equal(old.ok,false);assert.equal(old.seen,true)});

test('host settings: cleaned, and the environment wins',()=>{
 assert.equal(I.cleanHost('https://Code.Example.com/'),'code.example.com');assert.throws(()=>I.cleanHost('not a host!'),/host name/);
 assert.equal(I.hostSetting('codeHost'),'code.localhost');I.saveSettings({codeHost:'code.example.com'});assert.equal(I.hostSetting('codeHost'),'code.example.com');assert.equal(I.hostFrom('codeHost'),'setting');
 process.env.CODE_HOST='c.env.com';assert.equal(I.hostSetting('codeHost'),'c.env.com');assert.equal(I.hostFrom('codeHost'),'env');delete process.env.CODE_HOST;I.saveSettings({codeHost:''})});

/* ---------- the routes ---------- */
function routes(over={}){const out=[],set=[];const r=I.createInstallRoutes({send:(res,code,body)=>{res.code=code;res.body=body},readBody:async req=>req.body||'',isAdmin:u=>u.admin,
 listAgents:async()=>['default','sales','support'],setKey:async(a,k,v)=>{set.push([a,k,v]);return a==='support'?{ok:false,err:'busy'}:{ok:true}},hermes:async()=>({ok:true}),log:m=>out.push(m),...over});return {r,set,out}}
const call=async(r,u,method,p,body)=>{const req={method,headers:{host:'ai.example.com','x-forwarded-proto':'https'},body:body?JSON.stringify(body):''},res={};const done=await r.handle(req,res,u,new URL('http://x'+p));return {done,...res}};
const admin={id:'owner',admin:true},member={id:'m',admin:false};

test('the first sign-in is asked once, prefilled with the browser’s address',async()=>{const {r}=routes();process.env.AQEELOS_LIVE='0';assert.equal((await call(r,admin,'GET','/ui/install')).body.address.ask,false);delete process.env.AQEELOS_LIVE;
 const s=await call(r,admin,'GET','/ui/install');assert.equal(s.code,200);assert.equal(s.body.address.ask,true);assert.equal(s.body.address.suggest,'https://ai.example.com');assert.ok(s.body.agentUsers&&s.body.claude&&s.body.live);
 const m=await call(r,member,'GET','/ui/install');assert.equal(m.body.address.suggest,undefined);assert.equal(m.body.agentUsers,undefined);
 await call(r,admin,'POST','/ui/install/address',{later:true});assert.equal((await call(r,admin,'GET','/ui/install')).body.address.ask,false);I.saveSettings({addressAsked:''})});

test('saving the address checks it first; Save anyway keeps an unchecked one',async()=>{
 const id=I.installId();const good=routes({fetchImpl:async()=>({ok:true,status:200,json:async()=>({id})})});
 const ok=await call(good.r,admin,'POST','/ui/install/address',{url:'https://ai.example.com/'});assert.equal(ok.body.saved,true);assert.equal(I.publicUrl(),'https://ai.example.com');assert.ok(I.settings().publicUrlChecked>0);
 const bad=routes({fetchImpl:async()=>{throw new TypeError('fetch failed')}});
 const no=await call(bad.r,admin,'POST','/ui/install/address',{url:'https://other.example.com'});assert.equal(no.body.saved,false);assert.equal(I.publicUrl(),'https://ai.example.com');
 const any=await call(bad.r,admin,'POST','/ui/install/address',{url:'https://other.example.com',anyway:true});assert.equal(any.body.saved,true);assert.equal(I.publicUrl(),'https://other.example.com');assert.equal(I.settings().publicUrlChecked,undefined);
 assert.equal((await call(bad.r,admin,'POST','/ui/install/address',{url:'nope nope'})).code,400);
 assert.equal((await call(bad.r,member,'POST','/ui/install/address',{url:'https://x.com'})).code,403);
 process.env.PUBLIC_URL='https://env.example.com';assert.equal((await call(good.r,admin,'POST','/ui/install/address',{url:'https://ai.example.com'})).code,409);delete process.env.PUBLIC_URL;
 I.saveSettings({publicUrl:'',publicUrlChecked:'',addressAsked:''})});

test('the time zone goes to every agent and to the app at once',async()=>{let told='';const {r,set}=routes({onTz:z=>told=z});
 const res=await call(r,admin,'POST','/ui/install/timezone',{zone:'Asia/Jakarta'});assert.equal(res.code,200);assert.equal(res.body.agents,3);assert.deepEqual(res.body.failed,['support']);
 assert.deepEqual(set,[['default','timezone','Asia/Jakarta'],['sales','timezone','Asia/Jakarta'],['support','timezone','Asia/Jakarta']]);assert.equal(told,'Asia/Jakarta');assert.equal(I.installTz(),'Asia/Jakarta');
 assert.equal((await call(r,admin,'POST','/ui/install/timezone',{zone:'Mars/Base'})).code,400);I.saveSettings({timezone:''})});

test('a slow engine never holds the page: the zone is saved at once and agents follow',async()=>{let release;const gate=new Promise(x=>release=x);
 const {r}=routes({wait:30,setKey:async()=>{await gate;return {ok:true}}});
 const res=await call(r,admin,'POST','/ui/install/timezone',{zone:'Asia/Tokyo'});assert.equal(res.body.pending,true);assert.equal(I.installTz(),'Asia/Tokyo');release();I.saveSettings({timezone:''})});

test('new agents without a zone get the install’s; an agent’s own choice stays',async()=>{const cfg={default:{timezone:'Asia/Jakarta'},sales:{},support:{timezone:'Europe/Paris'}};
 const {r,set}=routes({readConfig:async a=>cfg[a]});await r.tick();assert.deepEqual(set,[]);
 I.saveSettings({timezone:'Asia/Jakarta'});await r.tick();assert.deepEqual(set,[['sales','timezone','Asia/Jakarta']]);I.saveSettings({timezone:''})});

test('hosts save as settings, never over the environment',async()=>{const {r}=routes();
 const ok=await call(r,admin,'POST','/ui/install/hosts',{codeHost:'code.example.com',liveDomain:'https://apps.example.com'});assert.equal(ok.body.restart,true);assert.equal(I.hostSetting('liveDomain'),'apps.example.com');
 process.env.LIVE_DOMAIN='x.com';assert.equal((await call(r,admin,'POST','/ui/install/hosts',{liveDomain:'y.com'})).code,400);delete process.env.LIVE_DOMAIN;I.saveSettings({codeHost:'',liveDomain:''})});

test('Install Claude sign-in: the app when missing, the shipped plugin, then turned on',async()=>{
 const home=path.join(DIR,'h2'),bin=path.join(DIR,'bin','claude');const ran=[],en=[];
 const {r}=routes({hermesHome:home,claudeBin:bin,runImpl:async(c,a)=>{ran.push(a.join(' '));mkdirSync(path.dirname(bin),{recursive:true});writeFileSync(bin,'#!/bin/sh\n');return {ok:true,out:''}},hermes:async(a,args)=>{en.push([a,...args]);return {ok:true}}});
 await call(r,admin,'POST','/ui/install/claude');for(let i=0;i<50&&r.claudeJob().state==='running';i++)await new Promise(x=>setTimeout(x,20));
 assert.equal(r.claudeJob().state,'done',r.claudeJob().error);assert.match(ran[0],/claude\.ai\/install\.sh/);
 assert.ok(readFileSync(path.join(home,'plugins',I.CLAUDE_PLUGIN,'plugin.yaml'),'utf8').includes('model-provider'));assert.deepEqual(en,[['default','plugins','enable',I.CLAUDE_PLUGIN]]);
 const st=(await call(r,admin,'GET','/ui/install/claude')).body;assert.equal(st.cli,true);assert.equal(st.plugin,true);
 assert.equal((await call(r,member,'POST','/ui/install/claude')).code,403)});

test('the engine state says when it refuses aqeelOS’s keys or does not answer',async()=>{
 for(const st of ['ok','auth','down']){const {r}=routes({engineProbe:async()=>st});assert.equal((await call(r,admin,'GET','/ui/install')).body.engine.state,st)}
 const {r}=routes({engineProbe:async()=>{throw Error('x')}});assert.equal((await call(r,admin,'GET','/ui/install')).body.engine.state,'down');
 assert.equal((await call(r,member,'GET','/ui/install')).body.engine,undefined)});

test('the address check’s ping answers with this install’s id, before sign-in',()=>{const {r}=routes();const res={};r.ping({},res);assert.equal(res.code,200);assert.equal(res.body.id,I.installId())});
