// Team of models (app/moa-map.js): a saved advisor whose provider is not signed in is shown and saved as the same model
// through a sign-in the install does have; with no equivalent it stays, marked as missing.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import vm from 'node:vm';
const ctx={};vm.createContext(ctx);vm.runInContext(readFileSync(new URL('../app/moa-map.js',import.meta.url),'utf8'),ctx);
const {moaEquivalent,moaFixTeam}=ctx;
const eq=(a,b)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),b);
const SUB='claude-subscription-directsdk-experimental';
const MS=[{id:'claude-opus-4-5',provider:SUB},{id:'claude-sonnet-4-5',provider:SUB},{id:'claude-haiku-4-5',provider:SUB},{id:'claude-sonnet-4',provider:SUB},{id:'gpt-5',provider:'openai-codex'}];

test('a saved model whose provider is signed in stays as it is',()=>{
 eq(moaEquivalent({provider:SUB,model:'claude-haiku-4-5'},MS),{provider:SUB,model:'claude-haiku-4-5',changed:false,missing:false})});

test('the same model through a sign-in the install has replaces a provider that is not signed in',()=>{
 eq(moaEquivalent({provider:'anthropic',model:'claude-sonnet-4-5'},MS),{provider:SUB,model:'claude-sonnet-4-5',changed:true,missing:false});
 // the same name written another way: a provider prefix, dots, a date stamp
 eq(moaEquivalent({provider:'openrouter',model:'anthropic/claude-haiku-4.5'},MS),{provider:SUB,model:'claude-haiku-4-5',changed:true,missing:false});
 eq(moaEquivalent({provider:'anthropic',model:'claude-sonnet-4-20250514'},MS),{provider:SUB,model:'claude-sonnet-4',changed:true,missing:false})});

test('an older version maps to the current one of the same family (Haiku, Sonnet, Opus)',()=>{
 eq(moaEquivalent({provider:'anthropic',model:'claude-3-5-haiku-20241022'},MS),{provider:SUB,model:'claude-haiku-4-5',changed:true,missing:false});
 eq(moaEquivalent({provider:'anthropic',model:'claude-3-7-sonnet-latest'},MS),{provider:SUB,model:'claude-sonnet-4-5',changed:true,missing:false});
 eq(moaEquivalent({provider:'anthropic',model:'claude-opus-4-1'},MS),{provider:SUB,model:'claude-opus-4-5',changed:true,missing:false})});

test('no equivalent: it stays as saved and is marked missing',()=>{
 eq(moaEquivalent({provider:'xai',model:'grok-4'},MS),{provider:'xai',model:'grok-4',changed:false,missing:true});
 eq(moaEquivalent({provider:'anthropic',model:'claude-haiku-4-5'},[{id:'gpt-5',provider:'openai-codex'}]),{provider:'anthropic',model:'claude-haiku-4-5',changed:false,missing:true});
 eq(moaEquivalent(null,MS),{provider:'',model:'',changed:false,missing:false})});

test('a whole team is rewritten in one go, keeping each entry\'s other settings',()=>{
 const team={enabled:true,reference_models:[{provider:'anthropic',model:'claude-haiku-4-5',enabled:true,temperature:0.3},{provider:'anthropic',model:'claude-sonnet-4-5',enabled:false},{provider:'xai',model:'grok-4'}],aggregator:{provider:'anthropic',model:'claude-opus-4-5'}};
 const r=moaFixTeam(team,MS);assert.equal(r.changed,3);assert.equal(r.missing,1);
 eq(r.preset,{enabled:true,reference_models:[{provider:SUB,model:'claude-haiku-4-5',enabled:true,temperature:0.3},{provider:SUB,model:'claude-sonnet-4-5',enabled:false},{provider:'xai',model:'grok-4'}],aggregator:{provider:SUB,model:'claude-opus-4-5'}});
 assert.equal(team.aggregator.provider,'anthropic','the saved team is not changed in place');
 assert.equal(moaFixTeam(r.preset,MS).changed,0)});
