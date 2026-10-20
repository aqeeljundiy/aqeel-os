import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Accounts,exhausted,readCodexAccount} from './accounts.mjs';

test('profiles isolate homes, persist choices and reject unknown paths',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aqeel-accounts-'));try{
 const a=await new Accounts(root,{PATH:'test',CODEX_HOME:'existing-home'}).init();await a.update({action:'create',label:'Second'});const second=a.state.profiles[1];assert.notEqual(a.env(second.id).CODEX_HOME,a.env('desktop').CODEX_HOME);assert.equal(a.env('desktop').CODEX_HOME,'existing-home');assert.throws(()=>a.env('../elsewhere'));
 await a.update({action:'select',id:second.id});await a.update({action:'settings',autoSwitch:true});const b=await new Accounts(root,{}).init();assert.equal(b.state.active,second.id);assert.equal(b.state.autoSwitch,true);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('automatic selection respects limits, preference and authentication failures',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aqeel-routing-'));try{
 const a=await new Accounts(root,{}).init();await a.update({action:'create',label:'Second'});
 const limited={ready:true,limits:{rateLimits:{primary:{usedPercent:100,resetsAt:Date.now()/1000+600}}}};
 const inspect=async id=>id==='desktop'?limited:{ready:true,limits:{rateLimits:{primary:{usedPercent:10}}}};
 await assert.rejects(a.choose(inspect),/usage limit/);await a.update({action:'settings',autoSwitch:true});const selected=await a.choose(inspect);assert.equal(selected.profileLabel,'Second');assert.equal(selected.switched,true);assert.equal(a.state.active,'desktop');
 await assert.rejects(a.choose(async()=>limited),/No available/);await assert.rejects(a.choose(async()=>({ready:false,message:'Login expired'})),/Login expired/);
 assert.equal(exhausted({rateLimits:{primary:{usedPercent:100,resetsAt:1}}}),false);assert.equal(exhausted(null),false);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('missing Codex executable returns unavailable without leaking errors',async()=>{
 const result=await readCodexAccount('nonexistent-aqeel-test-executable',{},os.tmpdir());assert.equal(result.account,null);assert.equal(result.limits,null);
});

test('Claude accounts switch away from an exhausted one',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'aqeel-claude-accounts-'));try{
  const a=await new Accounts(root,{},'claude').init();await a.update({action:'create',label:'Work'});const first=a.state.active,second=a.state.profiles.find(p=>p.id!==first).id;
  const inspect=async id=>({ready:true,exhausted:id===first});
  await assert.rejects(a.choose(inspect),/This Claude account has reached its usage limit/);
  await a.update({action:'settings',autoSwitch:true});const pick=await a.choose(inspect);assert.equal(pick.profileId,second);assert.equal(pick.switched,true);
 }finally{await rm(root,{recursive:true,force:true})}
});
