// Channels › Who can message (1 Nov 2026): one row per person whether they are approved, on the allowlist or both; removing
// takes them off everything, reading fresh before and checking after; "*" and a cleared list; what new people get
// (app/allowlist.mjs, used by server.mjs).
import {test} from 'node:test';import assert from 'node:assert/strict';
import {split,removeFrom,channelWho,parseEnv,samePerson,removePerson} from '../app/allowlist.mjs';

test('a person approved and on the list is one row, and removing them takes them off the list in every spelling',()=>{
 const env={WHATSAPP_ALLOWED_USERS:'6281234567890,6289876543210',WHATSAPP_DM_POLICY:'pairing'};
 const c=channelWho(env,'whatsapp',[{platform:'whatsapp',user_id:'6281234567890@s.whatsapp.net',user_name:'Sesa'},{platform:'telegram',user_id:'1'}]);
 assert.equal(c.rows.length,2);const sesa=c.rows.find(r=>r.name==='Sesa');assert.ok(sesa.approved&&sesa.listed,'both sources on one row');assert.equal(sesa.id,'6281234567890');
 assert.deepEqual(removeFrom(split('6281234567890,+6281234567890:3@s.whatsapp.net,628111'),'whatsapp','6281234567890@s.whatsapp.net'),['628111'])});

test('"*" is its own row: Stop takes only the star off, and a person removal keeps it',()=>{
 const c=channelWho({TELEGRAM_ALLOWED_USERS:'*,123'},'telegram',[]);assert.equal(c.star,true);assert.equal(c.newPeople,'anyone');assert.deepEqual(c.rows.map(r=>r.id),['123']);
 assert.deepEqual(removeFrom(['*','123'],'telegram','*'),['123']);assert.deepEqual(removeFrom(['*','123'],'telegram','123'),['*']);assert.deepEqual(removeFrom(['a','b'],'slack',''),[])});

test('what new people get follows the engine: a list or allowlist policy ignores them, pairing lets them ask',()=>{
 assert.equal(channelWho({},'telegram').newPeople,'ask');
 assert.equal(channelWho({TELEGRAM_ALLOWED_USERS:'1'},'telegram').newPeople,'ignored');
 assert.equal(channelWho({WHATSAPP_ALLOWED_USERS:'1',WHATSAPP_DM_POLICY:'pairing'},'whatsapp').newPeople,'ask');
 assert.equal(channelWho({WHATSAPP_DM_POLICY:'allowlist'},'whatsapp').newPeople,'ignored');
 assert.equal(channelWho({WHATSAPP_DM_POLICY:'open'},'whatsapp').newPeople,'anyone');
 assert.equal(channelWho({GATEWAY_ALLOW_ALL_USERS:'true'},'slack').newPeople,'anyone');
 assert.equal(channelWho({GATEWAY_ALLOW_ALL_USERS:'true',SLACK_ALLOWED_USERS:'U1'},'slack').newPeople,'ignored','a list beats allow-all');
 assert.equal(channelWho({SLACK_ALLOW_ALL_USERS:'1',SLACK_ALLOWED_USERS:'U1'},'slack').newPeople,'anyone');
 assert.equal(channelWho({GATEWAY_ALLOWED_USERS:'9'},'telegram').newPeople,'ignored');
 assert.equal(channelWho({},'email').newPeople,'ignored')});

test('the last way in is flagged, so the confirm can say nobody could reach the channel',()=>{
 assert.equal(channelWho({TELEGRAM_ALLOWED_USERS:'1'},'telegram').rows[0].last,true);
 assert.equal(channelWho({TELEGRAM_ALLOWED_USERS:'1,2'},'telegram').rows[0].last,false);
 assert.equal(channelWho({},'telegram',[{platform:'telegram',user_id:'1'}]).rows[0].last,false,'new people can still ask');
 assert.equal(channelWho({TELEGRAM_ALLOWED_USERS:'1',GATEWAY_ALLOWED_USERS:'2'},'telegram').rows[0].last,false)});

test('.env values and ID spellings',()=>{assert.deepEqual(parseEnv('# c\nA=1\nexport B="x,y"\nA=2\n'),{A:'2',B:'x,y'});
 assert.ok(samePerson('whatsapp','6281:2@s.whatsapp.net','+62 81'));assert.ok(samePerson('slack','u01','U01'));assert.ok(!samePerson('telegram','12','123'))});

// the remove flow with its reading and writing handed in
function fakeIo(env,approved,{hot=true}={}){const log=[];let reads=0;
 return {log,reads:()=>reads,io:{read:async()=>{reads++;return {env:{...env},approved:approved.map(x=>({...x}))}},
  setList:async(k,rest)=>{log.push(['list',k,rest.join(',')]);if(rest.length)env[k]=rest.join(',');else delete env[k];return hot},
  setGlobal:async rest=>{log.push(['global',rest.join(',')]);env.GATEWAY_ALLOWED_USERS=rest.join(',')},
  revoke:async uid=>{log.push(['revoke',uid]);const i=approved.findIndex(x=>x.user_id===uid);if(i>=0)approved.splice(i,1)}}}}

test('a row that is both: off the list and its approval, and reading again finds them gone',async()=>{
 const f=fakeIo({WHATSAPP_ALLOWED_USERS:'6281234567890,6289876543210'},[{platform:'whatsapp',user_id:'6281234567890@s.whatsapp.net'}]);
 const r=await removePerson(f.io,{pf:'whatsapp',id:'6281234567890@s.whatsapp.net'});
 assert.deepEqual(f.log,[['list','WHATSAPP_ALLOWED_USERS','6289876543210'],['revoke','6281234567890@s.whatsapp.net']]);assert.equal(r.still,false);assert.equal(f.reads(),2,'read before and after')});

test('reads the list at the time of the click: a number taken off meanwhile is not written back',async()=>{
 const env={TELEGRAM_ALLOWED_USERS:'1,2,3'};const f=fakeIo(env,[]);
 env.TELEGRAM_ALLOWED_USERS='1,3';   // the WhatsApp loop guard (or someone else) changed the file after the page was drawn
 await removePerson(f.io,{pf:'telegram',id:'1'});assert.deepEqual(f.log,[['list','TELEGRAM_ALLOWED_USERS','3']])});

test('"*": Stop takes only the star off; a cleared list; every channel\'s list needs a restart',async()=>{
 let f=fakeIo({SLACK_ALLOWED_USERS:'*,U1'},[]);let r=await removePerson(f.io,{pf:'slack',id:'*'});assert.deepEqual(f.log,[['list','SLACK_ALLOWED_USERS','U1']]);assert.equal(r.still,false);
 f=fakeIo({SLACK_ALLOWED_USERS:'U1,U2'},[],{hot:false});r=await removePerson(f.io,{pf:'slack',id:''});assert.deepEqual(f.log,[['list','SLACK_ALLOWED_USERS','']]);assert.equal(r.restart,true);
 f=fakeIo({GATEWAY_ALLOWED_USERS:'9,8'},[{platform:'telegram',user_id:'9'}]);r=await removePerson(f.io,{pf:'',id:'9',every:true});assert.deepEqual(f.log,[['global','8']]);assert.equal(r.restart,true);assert.equal(r.still,false)});

test('an approval the engine keeps is reported, not hidden',async()=>{
 const f=fakeIo({},[{platform:'telegram',user_id:'5'}]);f.io.revoke=async()=>{};assert.equal((await removePerson(f.io,{pf:'telegram',id:'5'})).still,true)});
