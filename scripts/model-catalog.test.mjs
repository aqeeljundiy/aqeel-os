// One model list for the chat and Code (app/model-catalog.mjs, 21 Nov 2026). Run: node --test scripts/model-catalog.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {buildCatalog,resolveModel,niceName,contextOf} from '../app/model-catalog.mjs';
const OPTS={provider:'claude-subscription-directsdk-experimental',model:'claude-sonnet-5-5[1m]',providers:[
 {slug:'antigravity-subscription',name:'Google AI Pro',authenticated:true,models:['gemini-4-neon-low','gemini-4-neon-medium','gemini-4-neon-high','gemini-4-neon-xhigh','gemini-3.8-flash-high','gemini-3.8-flash-medium','claude-sonnet-5-5-medium','gemini-pro-orchestrator-neon'],capabilities:{}},
 {slug:'claude-subscription-directsdk-experimental',name:'Claude',authenticated:true,is_current:true,models:['claude-sonnet-5-5[1m]','claude-fable-5-2[1m]','claude-haiku-4-5-20251001'],capabilities:{'claude-haiku-4-5-20251001':{reasoning:true}}},
 {slug:'openai-codex',name:'ChatGPT',authenticated:true,models:['gpt-6.2-sol','gpt-6.1-sol-900k'],capabilities:{}},
 {slug:'gemini-subscription',name:'Gemini CLI',authenticated:true,models:['gemini-2.5-pro']},
 {slug:'nous',name:'Nous Portal',authenticated:true,models:['anthropic/claude-fable-5.2']},
 {slug:'xai',name:'xAI',authenticated:true,models:['grok-5'],capabilities:{'grok-5':{reasoning:false}}}]};
test('one list: groups in order, retired and hidden providers left out, Google efforts folded into one model',()=>{
 const c=buildCatalog(OPTS);assert.deepEqual(c.providers.map(p=>[p.group,p.provider]),[['Claude','claude-subscription-directsdk-experimental'],['ChatGPT','openai-codex'],['Google','antigravity-subscription'],['Other','xai']]);
 const g=c.providers.find(p=>p.group==='Google'),neon=g.models.find(m=>m.id==='gemini-4-neon');
 assert.deepEqual(neon.efforts,['low','medium','high','xhigh']);assert.equal(neon.defaultEffort,'high');assert.equal(neon.name,'Gemini 4 Neon');
 assert.ok(g.models.some(m=>m.id==='gemini-3.8-flash'),'two efforts fold');assert.ok(g.models.some(m=>m.id==='claude-sonnet-5-5-medium'),'a single effort stays as it is');
 assert.ok(!g.models.some(m=>/neon-high/.test(m.id)));
 assert.deepEqual(c.providers[0].models.find(m=>m.id==='claude-fable-5-2[1m]').efforts,['low','medium','high','xhigh','max']);
 assert.deepEqual(c.providers.find(p=>p.group==='ChatGPT').models[0].efforts,['minimal','low','medium','high','xhigh']);
 assert.deepEqual(c.providers.find(p=>p.group==='Other').models[0].efforts,[],'a model without reasoning has no effort');
 assert.equal(buildCatalog(OPTS,{allow:['nous']}).providers.some(p=>p.provider==='nous'),true,'an allowed hidden provider shows')});
test('the engine runs the name for the picked effort; plain models stay; names and context sizes',()=>{
 const c=buildCatalog(OPTS);assert.equal(resolveModel(c,'antigravity-subscription','gemini-4-neon','medium'),'gemini-4-neon-medium');
 assert.equal(resolveModel(c,'antigravity-subscription','gemini-4-neon','max'),'gemini-4-neon-high','an effort it lacks: its default');
 assert.equal(resolveModel(c,'openai-codex','gpt-6.2-sol','high'),'gpt-6.2-sol');
 assert.equal(niceName('claude-fable-5-2[1m]'),'Claude Fable 5.2 (1M)');assert.equal(niceName('gpt-6.2-sol'),'GPT-6.2 Sol');
 assert.equal(contextOf('claude-sonnet-5-5[1m]'),1e6);assert.equal(contextOf('gpt-6.1-sol-900k'),9e5);assert.equal(contextOf('claude-haiku-4-5-20251001'),2e5)});
test('new for a week after it first shows up; nothing is new on the first read',()=>{
 const now=Date.parse('2026-11-21T00:00:00Z');const c=buildCatalog(OPTS,{now,seen:{'antigravity-subscription|gemini-4-neon-xhigh':now-864e5,'openai-codex|gpt-6.2-sol':1}});
 assert.equal(c.providers.find(p=>p.group==='Google').models.find(m=>m.id==='gemini-4-neon').isNew,true);assert.equal(c.providers.find(p=>p.group==='ChatGPT').models[0].isNew,false)});

test('a model too small for the agent\'s requests says so',async()=>{const {buildCatalog}=await import('../app/model-catalog.mjs');
 const o={provider:'openai-codex',model:'gpt-6',providers:[{slug:'openai-codex',name:'ChatGPT',authenticated:true,is_current:true,models:['gpt-6-mini-128k','gpt-6']}]};
 const c=buildCatalog(o,{need:300_000}),ms=c.providers[0].models;
 assert.match(ms.find(m=>m.id==='gpt-6-mini-128k').warn,/Too small for this agent/);assert.equal(ms.find(m=>m.id==='gpt-6').warn,'');
 assert.equal(buildCatalog(o).providers[0].models[0].warn,'','no record, no warning')});
