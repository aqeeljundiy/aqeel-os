// Tests for the efficient defaults in every agent's home (app/efficiency.mjs). Run: node --test scripts/efficiency.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createEfficiency,DEFAULTS} from '../app/efficiency.mjs';

async function make(cfg){const root=await mkdtemp(path.join(tmpdir(),'eff-'));const H=path.join(root,'.hermes'),DATA=path.join(root,'data');
 await mkdir(H,{recursive:true});await writeFile(path.join(H,'config.yaml'),'');
 for(const p of Object.keys(cfg).filter(a=>a!=='default'))await mkdir(path.join(H,'profiles',p),{recursive:true}).then(()=>writeFile(path.join(H,'profiles',p,'config.yaml'),''));
 await mkdir(path.join(H,'profiles','no-config'),{recursive:true});
 const writes=[];
 const E=createEfficiency({HERMES_HOME:H,DATA,log:()=>{},readConfig:async a=>cfg[a],
  setKey:async(a,k,v)=>{writes.push([a,k,v]);const ks=k.split('.');let o=cfg[a];for(const x of ks.slice(0,-1))o=o[x]??={};o[ks.at(-1)]=v},pick:(c,k)=>k.split('.').reduce((o,x)=>o?.[x],c)});
 return {E,cfg,writes,DATA}}

test('every home gets a fixed shortening point and the auto cache, once',async()=>{
 const {E,cfg,writes}=await make({default:{prompt_caching:{cache_ttl:'5m'}},sales:{},help:{compression:{threshold:0.5}}});
 assert.deepEqual((await E.apply()).sort(),['default','help','sales']);
 for(const a of ['default','sales','help']){assert.equal(cfg[a].compression.threshold_tokens,DEFAULTS['compression.threshold_tokens']);assert.equal(cfg[a].prompt_caching.cache_ttl,'auto')}
 assert.equal(cfg.help.compression.threshold,0.5,'other compression settings stay');
 const n=writes.length;assert.deepEqual(await E.apply(),[],'nothing changes the second time');assert.equal(writes.length,n)});

test('a value set by hand is kept; one this module set follows a new default',async()=>{
 const {E,cfg,DATA}=await make({default:{},sales:{compression:{threshold_tokens:400000},prompt_caching:{cache_ttl:'1h'}}});
 await E.apply();assert.equal(cfg.sales.compression.threshold_tokens,400000);assert.equal(cfg.sales.prompt_caching.cache_ttl,'1h');
 assert.equal(cfg.default.compression.threshold_tokens,DEFAULTS['compression.threshold_tokens']);
 const saved=JSON.parse(await readFile(path.join(DATA,'efficiency.json'),'utf8'));assert.equal(saved.set.default['compression.threshold_tokens'],DEFAULTS['compression.threshold_tokens']);assert.equal(saved.set.sales,undefined);
 const E2=createEfficiency({HERMES_HOME:path.join(path.dirname(DATA),'.hermes'),DATA,log:()=>{},defaults:{...DEFAULTS,'compression.threshold_tokens':150000},
  readConfig:async a=>cfg[a],setKey:async(a,k,v)=>{const ks=k.split('.');let o=cfg[a];for(const x of ks.slice(0,-1))o=o[x]??={};o[ks.at(-1)]=v},pick:(c,k)=>k.split('.').reduce((o,x)=>o?.[x],c)});
 assert.deepEqual(await E2.apply(),['default']);assert.equal(cfg.default.compression.threshold_tokens,150000);assert.equal(cfg.sales.compression.threshold_tokens,400000)});

test('status names the homes that keep a value of their own',async()=>{
 const {E}=await make({default:{},sales:{prompt_caching:{cache_ttl:'1h'}}});await E.apply();
 const s=await E.status();assert.equal(s.find(x=>x.agent==='sales').own,true);assert.equal(s.find(x=>x.agent==='default').own,false)});
