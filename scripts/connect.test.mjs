// Model accounts with an API key (app/connect.mjs): a rejected key is said in plain words, and the first account's model
// is what agents without a model get (clean-install test, 7 Nov 2026). No network: fetch is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnect,firstModelFor,providerName} from '../app/connect.mjs';

const real=globalThis.fetch;
const answer=(status,body)=>async()=>({ok:status<300,status,statusText:'',text:async()=>JSON.stringify(body),json:async()=>body});
const make=()=>createConnect({HERMES_HOME:'/nowhere',DASH:new URL('http://127.0.0.1:1'),DASH_TOKEN:'t'});

test('a rejected key says which provider refused it, in plain words, with the provider’s own answer kept as detail',async()=>{
 globalThis.fetch=answer(401,{error:{message:'User not found.',code:401}});
 try{const r=await make().test('openrouter','sk-or-v1-bad');assert.equal(r.state,'rejected');
  assert.equal(r.message,'OpenRouter says this key isn’t valid. Copy the whole key again, or make a new one.');assert.doesNotMatch(r.message,/HTTP|User not found/);
  assert.equal(r.detail,'User not found. (HTTP 401)');
  const a=await make().test('anthropic','sk-ant-bad');assert.match(a.message,/^Anthropic says/)}
 finally{globalThis.fetch=real}});

test('a provider without a name of its own is named by its address',()=>{
 assert.equal(providerName('zzz','https://api.example.ai/v1/models'),'example.ai');assert.equal(providerName('xai','https://api.x.ai/v1/models'),'xAI')});

test('the first account’s model: that provider’s first model, else any signed-in provider',()=>{
 const P=[{slug:'nous',authenticated:false,models:['n1']},{slug:'openai',authenticated:true,models:[]},{slug:'openrouter',authenticated:true,models:['anthropic/claude-sonnet-5.5','openai/gpt-5.2']},{slug:'anthropic',authenticated:true,models:['claude-opus-5-5']}];
 assert.deepEqual(firstModelFor(P,'openrouter'),{provider:'openrouter',model:'anthropic/claude-sonnet-5.5'});
 assert.deepEqual(firstModelFor(P,'anthropic'),{provider:'anthropic',model:'claude-opus-5-5'});
 assert.deepEqual(firstModelFor(P,'openai-api'),{provider:'openrouter',model:'anthropic/claude-sonnet-5.5'});   // no models of its own yet: the first signed-in one
 assert.equal(firstModelFor([],'openrouter'),null);assert.equal(firstModelFor(undefined,'x'),null)});
