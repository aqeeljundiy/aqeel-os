// Tests for usage across every provider (app/ledger.mjs, 20 Nov 2026). Run: node --test scripts/ledger.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {aggregate,placeOf,providerName,PARTS} from '../app/ledger.mjs';

const L=(o)=>({t:1795161600,a:'donna',s:'s1',p:'telegram',m:'claude-sonnet-5-5',pv:'claude-subscription-directsdk-experimental',in:100,cr:900,cw:0,out:50,an:{sys:400,tools:300,hist:100,toolres:150,last:50},...o});
test('five views of the same calls, every provider, with what the tokens were spent on',()=>{
 const info=(a,s)=>({s1:{source:'telegram',owner:'u1'},s2:{source:'cron',title:'Morning brief · Nov 20 07:00'},s3:{source:'cron',title:'Threads comment runner · Nov 20 18:50'}})[s]||null;
 const r=aggregate([L({}),L({s:'s2',p:'cron'}),L({a:'threads',s:'s3',p:'cron',m:'gemini-4-neon-high',pv:'antigravity-subscription',acct:'g000001',in:2000,cr:0,out:300,est:true,an:{sys:500,tools:500,hist:0,toolres:1000,last:0}}),
  L({s:'s1',aux:'title',in:20,cr:0,out:5,an:{}})],{info,acctOf:l=>l.acct||'Max 2',agentName:a=>({donna:'Donna',threads:'Threads'})[a]||a,personName:p=>p==='u1'?'Aqeel':p});
 assert.equal(r.total.calls,4);assert.equal(r.total.tokens,1050+1050+2300+25);
 assert.deepEqual(r.agent.map(x=>[x.name,x.tokens]),[['Threads',2300],['Donna',2125]]);
 assert.deepEqual(r.person.map(x=>x.name).sort(),['Aqeel','Scheduled and background work']);
 assert.deepEqual(r.provider.map(x=>[x.provider,x.account,x.est]),[['Google AI plan','g000001',1],['Claude plan','Max 2',0]]);
 assert.deepEqual(r.schedule.map(x=>[x.agentName,x.name,x.kind]),[['Threads','Threads comment runner','schedule'],['Donna','Chats on telegram','chat'],['Donna','Morning brief','schedule'],['Donna','Background work (title)','aux']]);
 const d=r.agent.find(x=>x.key==='donna');assert.deepEqual(PARTS.map(k=>d.an[k]),[800,600,200,300,100],'Donna’s tokens by part of the request')});
test('a call with no session details is still counted, as a chat or as background work',()=>{
 assert.deepEqual(placeOf({p:'api_server'},()=>null),{key:'chat:api_server',name:'Chats in aqeelOS',kind:'chat'});
 assert.equal(placeOf({p:'cron'},()=>null).name,'A scheduled run');assert.equal(providerName('openai-codex'),'ChatGPT plan');assert.equal(providerName('xai'),'xAI (Grok)')});
