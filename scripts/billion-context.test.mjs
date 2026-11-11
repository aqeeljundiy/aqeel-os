// Tests for billion-context in every agent's home (app/billion-context.mjs). Run: node --test scripts/billion-context.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createBillionContext,BILI_VERSION} from '../app/billion-context.mjs';

async function make({fail=false}={}){const root=await mkdtemp(path.join(tmpdir(),'bili-'));const H=path.join(root,'.hermes');
 for(const p of ['sales','help'])await mkdir(path.join(H,'profiles',p),{recursive:true}).then(()=>writeFile(path.join(H,'profiles',p,'config.yaml'),''));
 await mkdir(path.join(H,'profiles','no-config'),{recursive:true});
 const cfg={default:{},sales:{plugins:{enabled:['aqeelos-live']},platform_toolsets:{whatsapp:['hermes-whatsapp'],cli:['hermes-cli','billion-context']}},help:{plugins:{disabled:['billion-context']},platform_toolsets:{whatsapp:['hermes-whatsapp']}}};const runs=[];let t=0;
 const run=async(cmd,args)=>{runs.push(args);if(fail)throw new Error('no network');const pkg=path.join(args[2],'node_modules','billion-context');
  await mkdir(path.join(pkg,'hermes-plugin'),{recursive:true});await writeFile(path.join(pkg,'package.json'),JSON.stringify({version:BILI_VERSION}));
  await writeFile(path.join(pkg,'hermes-plugin','plugin.yaml'),'name: billion-context\n');await writeFile(path.join(pkg,'hermes-plugin','__init__.py'),'# plugin\n')};
 const B=createBillionContext({HERMES_HOME:H,home0:root,run,npm:'npm',now:()=>t,nodePath:'/usr/bin/node',log:()=>{},
  readConfig:async a=>cfg[a],setKey:async(a,k,v)=>{const ks=k.split('.');let o=cfg[a];for(const x of ks.slice(0,-1))o=o[x]??={};o[ks.at(-1)]=v},pick:(c,k)=>k.split('.').reduce((o,x)=>o?.[x],c)});
 return {B,H,root,cfg,runs,tick:ms=>{t+=ms}}}

test('installs the pinned package once, copies the plugin with its sidecar into every home, switches it on once',async()=>{const {B,H,cfg,runs}=await make();
 const c=await B.install();assert.deepEqual(c.sort(),['default','help','sales']);assert.equal(runs.length,1);assert.ok(runs[0].includes('billion-context@'+BILI_VERSION));
 const side=JSON.parse(await readFile(path.join(H,'profiles','sales','plugins','billion-context','bili.json'),'utf8'));
 assert.equal(side.nodePath,'/usr/bin/node');assert.ok(side.proxyScript.endsWith(path.join('billion-context','dist','index.js')));
 assert.equal(await readFile(path.join(H,'plugins','billion-context','__init__.py'),'utf8'),'# plugin\n');
 assert.deepEqual(cfg.sales.plugins.enabled,['aqeelos-live','billion-context']);assert.deepEqual(cfg.default.plugins.enabled,['billion-context']);
 assert.equal(cfg.help.plugins.enabled,undefined,'switched off on the Plugins page stays off');
 assert.deepEqual(cfg.sales.platform_toolsets,{whatsapp:['hermes-whatsapp','billion-context'],cli:['hermes-cli','billion-context']},'its tools reach every channel, listed once');
 assert.deepEqual(cfg.help.platform_toolsets.whatsapp,['hermes-whatsapp'],'not added where it is switched off');
 assert.deepEqual(await B.install(),[],'nothing changes the second time');assert.equal(runs.length,1,'no second download')});

test('the proxy keeps to the pin: self-update and advisory installs off, other settings kept',async()=>{const {B,root}=await make();
 const f=path.join(root,'.config','billion-context','billion-context.json');await mkdir(path.dirname(f),{recursive:true});await writeFile(f,JSON.stringify({port:9000}));
 await B.install();assert.deepEqual(JSON.parse(await readFile(f,'utf8')),{port:9000,autoUpdate:false,advisoryCheck:false})});

test('a failed download changes nothing and waits an hour before trying again',async()=>{const {B,H,runs,tick}=await make({fail:true});
 assert.deepEqual(await B.install(),[]);assert.deepEqual(await B.install(),[]);assert.equal(runs.length,1);
 await assert.rejects(readFile(path.join(H,'plugins','billion-context','plugin.yaml')));tick(61*60e3);await B.install();assert.equal(runs.length,2)});

test('the off file takes it out of every agent, and nothing is downloaded',async()=>{const {B,H,cfg,runs}=await make();await B.install();
 await writeFile(path.join(H,'.aqeelos-billion-context-off'),'');const c=await B.install();
 assert.deepEqual(c.sort(),['default','sales']);assert.deepEqual(cfg.sales.plugins.enabled,['aqeelos-live']);assert.deepEqual(await B.install(),[]);assert.equal(runs.length,1)});
