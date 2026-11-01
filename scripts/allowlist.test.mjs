// Channels › Who can message (1 Nov 2026), checked against what the engine does (app/allowlist.mjs): one row per person
// whatever the source and whichever WhatsApp alias (phone or LID, through lid-mapping files); lists parsed and written
// like the engine; what new people get per platform; the confirm's words worked out from the channel afterwards;
// removal from every list and approval, with a fresh read before and a full check after; a paused channel untouched.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {split,parseList,formatList,removeFrom,channelWho,globalWho,parseEnv,setEnvLine,samePerson,waAliases,newPeople,removePerson,engineChange} from '../app/allowlist.mjs';

// a fake WhatsApp session folder, as the bridge writes it: lid-mapping-<phone>.json holds the LID, <lid>_reverse the phone
function mappingDir(pairs){const d=mkdtempSync(path.join(tmpdir(),'aq-lid-'));for(const [phone,lid] of pairs){writeFileSync(path.join(d,'lid-mapping-'+phone+'.json'),JSON.stringify(lid+'@lid'));writeFileSync(path.join(d,'lid-mapping-'+lid+'_reverse.json'),JSON.stringify(phone+'@s.whatsapp.net'))}
 return Object.fromEntries(readdirSync(d).map(n=>[n,readFileSync(path.join(d,n),'utf8')]))}
const MAP=mappingDir([['628111116879','128822227789555'],['628222223417','139933330843555']]);

test('WhatsApp aliases: phone and LID are one person, as the engine expands them',()=>{
 assert.deepEqual([...waAliases('628111116879@s.whatsapp.net',MAP)].sort(),['128822227789555','628111116879']);
 assert.deepEqual([...waAliases('128822227789555@lid',MAP)].sort(),['128822227789555','628111116879']);
 assert.ok(samePerson('whatsapp','+628111116879','128822227789555',MAP));assert.ok(!samePerson('whatsapp','628111116879','139933330843555',MAP));
 assert.ok(samePerson('whatsapp','6281:4@s.whatsapp.net','6281',{}),'device and domain parts drop off');
 assert.ok(!samePerson('whatsapp','+62 81','6281',{}),'spaces are not dropped: the engine compares them as written')});

test('one row for both IDs of one person, approved under one and listed under the other',()=>{
 const env={WHATSAPP_ALLOWED_USERS:'628111116879,128822227789555,139933330843555,628999'};
 const c=channelWho(env,'whatsapp',[{platform:'whatsapp',user_id:'128822227789555@lid',user_name:'Wife'},{platform:'whatsapp',user_id:'628222223417@s.whatsapp.net',user_name:'Owner'}],MAP);
 assert.equal(c.rows.length,3);const w=c.rows.find(r=>r.name==='Wife');assert.equal(w.id,'628111116879','shown by the phone');assert.deepEqual(w.aliases,['128822227789555']);assert.ok(w.approved&&w.listed);
 assert.ok(c.rows.find(r=>r.name==='Owner').listed,'the owner listed only by LID is the same row')});

test('removing a person takes every alias off, and approvals under any alias',async()=>{
 assert.deepEqual(removeFrom(split('628111116879,128822227789555,628999,*'),'whatsapp','628111116879@s.whatsapp.net',MAP),['628999','*']);
 const env={WHATSAPP_ALLOWED_USERS:'628111116879,128822227789555,628999'},f=fakeIo(env,[{platform:'whatsapp',user_id:'128822227789555@lid'}],MAP);
 const r=await removePerson(f.io,{pf:'whatsapp',id:'628111116879'});assert.equal(env.WHATSAPP_ALLOWED_USERS,'628999');assert.deepEqual(f.revoked,[['whatsapp','128822227789555@lid']]);assert.equal(r.still,false)});

test('lists are read and written like the engine: commas only, or a JSON list kept as JSON',()=>{
 assert.deepEqual(parseList('a, b ,,c'),{items:['a','b','c'],json:false});assert.deepEqual(parseList('["1", 2]'),{items:['1','2'],json:true});
 assert.deepEqual(parseList('[not json'),{items:['[not json'],json:false});assert.deepEqual(split('1 2,3'),['1 2','3'],'a space does not split');
 assert.equal(formatList(['1','2'],true),'["1","2"]');assert.equal(formatList(['1','2'],false),'1,2');
 assert.equal(setEnvLine('A=1\nK="x,y"\n','K',v=>v.split(',').filter(x=>x!=='x').join(',')),'A=1\nK="y"\n','the quote stays');
 assert.equal(setEnvLine('K=x\nB=2\n','K',()=>''),'B=2\n','an emptied list goes');assert.equal(setEnvLine('B=2\n','K',()=>null),null);
 assert.deepEqual(parseEnv('# c\nA=1\nexport B="x,y"\nA=2\n'),{A:'2',B:'x,y'})});

test('what new people get, per the engine: WhatsApp follows its policy (none = pairing), the others stop pairing once they have a list',()=>{
 assert.equal(newPeople({},'whatsapp'),'ask','no policy on WhatsApp is pairing');
 assert.equal(newPeople({WHATSAPP_ALLOWED_USERS:'1'},'whatsapp'),'ask','a list does not stop WhatsApp pairing');
 assert.equal(newPeople({WHATSAPP_DM_POLICY:'allowlist'},'whatsapp'),'ignored');assert.equal(newPeople({WHATSAPP_DM_POLICY:'open'},'whatsapp'),'anyone');
 assert.equal(newPeople({WHATSAPP_DM_POLICY:'open',WHATSAPP_ALLOWED_USERS:'1'},'whatsapp'),'ignored','open with a list: the list decides');
 assert.equal(newPeople({},'telegram'),'ask');assert.equal(newPeople({TELEGRAM_ALLOWED_USERS:'1'},'telegram'),'ignored');
 assert.equal(newPeople({GATEWAY_ALLOWED_USERS:'9'},'slack'),'ignored');assert.equal(newPeople({GATEWAY_ALLOW_ALL_USERS:'true'},'slack'),'anyone');
 assert.equal(newPeople({GATEWAY_ALLOW_ALL_USERS:'true',SLACK_ALLOWED_USERS:'U1'},'slack'),'ignored','a list beats allow-all');
 assert.equal(newPeople({SLACK_ALLOW_ALL_USERS:'1',SLACK_ALLOWED_USERS:'U1'},'slack'),'anyone');assert.equal(newPeople({TELEGRAM_ALLOWED_USERS:'*'},'telegram'),'anyone');
 assert.equal(newPeople({},'email'),'ignored');assert.equal(newPeople({},'weixin'),'ask')});

test('the confirm says what the channel is like afterwards',()=>{
 assert.equal(channelWho({TELEGRAM_ALLOWED_USERS:'1'},'telegram').rows[0].after,'New people can ask to message it again then.','the last list entry gone: Telegram pairs again');
 assert.equal(channelWho({TELEGRAM_ALLOWED_USERS:'1',GATEWAY_ALLOW_ALL_USERS:'true'},'telegram').rows[0].after,'Anyone can message it then.');
 assert.equal(channelWho({TELEGRAM_ALLOWED_USERS:'1,2'},'telegram').rows[0].after,'');
 assert.equal(channelWho({WHATSAPP_DM_POLICY:'allowlist',WHATSAPP_ALLOWED_USERS:'1'},'whatsapp').rows[0].after,'Nobody can message it then, and new people can’t ask.');
 assert.equal(channelWho({WHATSAPP_ALLOWED_USERS:'1'},'whatsapp').rows[0].after,'','WhatsApp still pairs');
 assert.equal(channelWho({TELEGRAM_ALLOWED_USERS:'*,1'},'telegram').starAfter,'');assert.equal(channelWho({SLACK_ALLOWED_USERS:'*'},'slack').starAfter,'New people can ask to message it again then.');
 assert.equal(globalWho({GATEWAY_ALLOWED_USERS:'1',GATEWAY_ALLOW_ALL_USERS:'1'}).after,'With no list left, anyone may message every channel that has no list of its own.')});

// the remove flow with its reading and writing handed in; setList computes from the value at the moment of writing
function fakeIo(env,approved,mapping={},{hot=true}={}){const log=[],revoked=[];let reads=0;
 return {log,revoked,reads:()=>reads,io:{read:async()=>{reads++;return {env:{...env},approved:approved.map(x=>({...x})),mapping}},
  setList:async(k,fn)=>{const v=fn(env[k]??'');if(v==null)return {changed:false,hot:true};log.push([k,v]);if(v)env[k]=v;else delete env[k];return {changed:true,hot:!/^GATEWAY_/.test(k)&&hot}},
  revoke:async(pf,uid)=>{revoked.push([pf,uid]);const i=approved.findIndex(x=>x.platform===pf&&x.user_id===uid);if(i>=0)approved.splice(i,1)}}}}

test('a row that is both: off the list and its approval, read before and after',async()=>{
 const env={TELEGRAM_ALLOWED_USERS:'5,6'},f=fakeIo(env,[{platform:'telegram',user_id:'5'}]);const r=await removePerson(f.io,{pf:'telegram',id:'5'});
 assert.deepEqual(f.log,[['TELEGRAM_ALLOWED_USERS','6']]);assert.deepEqual(f.revoked,[['telegram','5']]);assert.equal(r.still,false);assert.equal(f.reads(),2)});

test('computes from the list at the time of writing: a number taken off meanwhile is not written back',async()=>{
 const env={TELEGRAM_ALLOWED_USERS:'1,2,3'},f=fakeIo(env,[]);const set=f.io.setList;
 f.io.setList=async(k,fn)=>{env[k]='1,3';return set(k,fn)};   // the WhatsApp loop guard got there between the read and the write
 await removePerson(f.io,{pf:'telegram',id:'1'});assert.equal(env.TELEGRAM_ALLOWED_USERS,'3')});

test('JSON lists stay JSON',async()=>{const env={SLACK_ALLOWED_USERS:'["U1","U2"]'};await removePerson(fakeIo(env,[]).io,{pf:'slack',id:'U1'});assert.equal(env.SLACK_ALLOWED_USERS,'["U2"]')});

test('the after-check sees every way in: the list for every channel, "*", the anyone switch, an approval kept',async()=>{
 let r=await removePerson(fakeIo({TELEGRAM_ALLOWED_USERS:'5',GATEWAY_ALLOWED_USERS:'5'},[]).io,{pf:'telegram',id:'5'});assert.equal(r.still,true);assert.match(r.why.join(),/every channel/);
 r=await removePerson(fakeIo({TELEGRAM_ALLOWED_USERS:'5,*'},[]).io,{pf:'telegram',id:'5'});assert.equal(r.still,true);assert.match(r.why.join(),/\*/);
 r=await removePerson(fakeIo({TELEGRAM_ALLOWED_USERS:'5',TELEGRAM_ALLOW_ALL_USERS:'true'},[]).io,{pf:'telegram',id:'5'});assert.match(r.why.join(),/anyone/);
 const f=fakeIo({},[{platform:'telegram',user_id:'5'}]);f.io.revoke=async()=>{};r=await removePerson(f.io,{pf:'telegram',id:'5'});assert.match(r.why.join(),/approval/)});

test('"Every channel" takes them off every list and approval, as its dialog says; that list needs a restart',async()=>{
 const env={GATEWAY_ALLOWED_USERS:'628111116879,9',WHATSAPP_ALLOWED_USERS:'128822227789555',TELEGRAM_ALLOWED_USERS:'628111116879'},f=fakeIo(env,[{platform:'whatsapp',user_id:'628111116879@s.whatsapp.net'}],MAP);
 const r=await removePerson(f.io,{pf:'',id:'628111116879',every:true});
 assert.equal(env.GATEWAY_ALLOWED_USERS,'9');assert.equal(env.WHATSAPP_ALLOWED_USERS,undefined,'the LID too');assert.equal(env.TELEGRAM_ALLOWED_USERS,undefined);assert.equal(f.revoked.length,1);assert.equal(r.restart,true);assert.equal(r.still,false)});

test('"*": Stop takes only the star off',async()=>{const env={SLACK_ALLOWED_USERS:'*,U1'};const r=await removePerson(fakeIo(env,[]).io,{pf:'slack',id:'*'});assert.equal(env.SLACK_ALLOWED_USERS,'U1');assert.equal(r.still,false)});

test('the engine is only told about the list: a paused channel stays paused, also when its state could not be read',()=>{
 assert.deepEqual(engineChange('WHATSAPP_ALLOWED_USERS','1'),{env:{WHATSAPP_ALLOWED_USERS:'1'}});assert.deepEqual(engineChange('K',''),{env:{},clear_env:['K']});
 assert.ok(!('enabled' in engineChange('K','1')))});

// the locked write: aqeelOS's editEnv holds the engine's own flock on .env.lock. macOS has no flock, so this runs where it
// exists (the AI box: copy app/agentops.mjs, app/allowlist.mjs and this file to a folder there and run node --test)
const HAS_FLOCK=spawnSync('sh',['-c','command -v flock']).status===0;
test('the list changes under the .env lock, from the file as it is then',{skip:HAS_FLOCK?false:'flock is not on this computer (macOS); run this file on the AI box'},async()=>{
 const {editEnv}=await import('../app/agentops.mjs');const d=mkdtempSync(path.join(tmpdir(),'aq-env-')),f=path.join(d,'.env');writeFileSync(f,'A=1\nTELEGRAM_ALLOWED_USERS=1,2,3\n');
 const held=spawnSync('sh',['-c',`flock ${f}.lock -c 'sleep 0'`]);assert.equal(held.status,0);
 const changed=await editEnv(f,t=>setEnvLine(t,'TELEGRAM_ALLOWED_USERS',v=>formatList(removeFrom(parseList(v).items,'telegram','2'),false)));
 assert.equal(changed,true);assert.equal(readFileSync(f,'utf8'),'A=1\nTELEGRAM_ALLOWED_USERS=1,3\n')});
