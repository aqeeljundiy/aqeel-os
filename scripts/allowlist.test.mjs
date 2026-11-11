// Channels › Who can message (1-2 Nov 2026), checked against what the engine and the WhatsApp bridge do (app/allowlist.mjs):
// one row per person whatever the source and whichever WhatsApp alias; .env entries the engine also lists as approvals
// (tagged `source`) and group IDs are not approvals; lists parsed and written like the engine; what strangers get, from
// config.yaml's unauthorized_dm_behavior and the bridge; the confirm's words from the channel afterwards; removal from
// every list and approval in the agent's own store, never touching the main agent's .env; one ID at a time.
import {test,after} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readdirSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {split,parseList,formatList,channelWho,globalWho,parseEnv,setEnvLine,samePerson,waAliases,newPeople,dmBehavior,removePerson,engineChange,approvedWithout,checkId,truthy,listKey} from '../app/allowlist.mjs';

// a fake WhatsApp session folder, as the bridge writes it: lid-mapping-<phone>.json holds the LID, <lid>_reverse the phone
const TMP=[];after(()=>{for(const d of TMP)rmSync(d,{recursive:true,force:true})});   // the scratch folders go when the tests end
function mappingDir(pairs){const d=mkdtempSync(path.join(tmpdir(),'aq-lid-'));TMP.push(d);for(const [phone,lid] of pairs){writeFileSync(path.join(d,'lid-mapping-'+phone+'.json'),JSON.stringify(lid+'@lid'));writeFileSync(path.join(d,'lid-mapping-'+lid+'_reverse.json'),JSON.stringify(phone+'@s.whatsapp.net'))}
 return d}
const DIR=mappingDir([['6280000000005','100000000000001'],['6280000000006','100000000000002']]);
// read only the files asked for, as the server does
const asked=[];const MAP=n=>{asked.push(n);try{return readFileSync(path.join(DIR,n),'utf8')}catch{return null}};

test('WhatsApp aliases: phone and LID are one person; only the files for the IDs asked about are read',()=>{asked.length=0;
 assert.deepEqual([...waAliases('6280000000005@s.whatsapp.net',MAP)].sort(),['100000000000001','6280000000005']);
 assert.ok(asked.every(n=>/6280000000005|100000000000001/.test(n)),'no other mapping file read');
 assert.ok(samePerson('whatsapp','+6280000000005','100000000000001',MAP));assert.ok(!samePerson('whatsapp','6280000000005','100000000000002',MAP));
 assert.ok(samePerson('whatsapp','6281:4@s.whatsapp.net','6281',{}))});

test('one row per person; .env entries the engine lists as approvals (source) are list entries, never approvals or names',()=>{
 const env={WHATSAPP_ALLOWED_USERS:'6280000000005,100000000000001,100000000000002,628999'};
 const approved=[{platform:'whatsapp',user_id:'100000000000001',user_name:'Wife'},{platform:'whatsapp',user_id:'628999',user_name:'(added in settings file)',source:'WHATSAPP_ALLOWED_USERS'}];
 const c=channelWho(env,'whatsapp',approved,MAP);assert.equal(c.rows.length,3);
 const w=c.rows.find(r=>r.name==='Wife');assert.equal(w.id,'6280000000005');assert.deepEqual(w.aliases,['100000000000001']);assert.ok(w.approved&&w.listed);
 const x=c.rows.find(r=>r.id==='628999');assert.equal(x.name,'','no placeholder name');assert.equal(x.approved,false,'list only')});

test('group IDs are not people: kept out of the rows and shown as groups',()=>{
 const env={WHATSAPP_ALLOWED_USERS:'6280000000005',WHATSAPP_GROUP_ALLOWED_USERS:'1200000000001@g.us'};
 const c=channelWho(env,'whatsapp',[{platform:'whatsapp',user_id:'1200000000001@g.us',user_name:'Group (added in settings file)',source:'WHATSAPP_GROUP_ALLOWED_USERS'}],MAP);
 assert.deepEqual(c.rows.map(r=>r.id),['6280000000005']);assert.equal(c.groups[0].id,'1200000000001@g.us');
 const t=channelWho({},'telegram',[],{},{platforms:{telegram:{group_allowed_chats:-1001234567890}}});assert.equal(t.groups[0].id,'-1001234567890');assert.match(t.groups[0].where,/config\.yaml/)});

test('lists are read and written like the engine: commas only, or a JSON list kept as JSON; truthy is true/1/yes only',()=>{
 assert.deepEqual(parseList('a, b ,,c'),{items:['a','b','c'],json:false});assert.deepEqual(parseList('["1", 2]'),{items:['1','2'],json:true});
 assert.deepEqual(split('1 2,3'),['1 2','3']);assert.equal(formatList(['1','2'],true),'["1","2"]');
 assert.equal(setEnvLine('A=1\nK="x,y"\n','K',v=>v.split(',').filter(x=>x!=='x').join(',')),'A=1\nK="y"\n');assert.equal(setEnvLine('K=x\nB=2\n','K',()=>''),'B=2\n');
 assert.deepEqual(parseEnv('# c\nA=1\nexport B="x,y"\nA=2\n'),{A:'2',B:'x,y'});
 assert.ok(truthy('yes')&&truthy('1')&&truthy('TRUE'));assert.ok(!truthy('on'));assert.equal(listKey('qqbot'),'QQ_ALLOWED_USERS')});

test('strangers, as config.yaml and the engine decide: unauthorized_dm_behavior global and per channel',()=>{
 const ign={unauthorized_dm_behavior:'ignore'};
 assert.equal(newPeople({TELEGRAM_ALLOWED_USERS:'1'},'telegram',ign),'silent','no reply, but filed under People waiting');
 assert.equal(newPeople({},'telegram',{}),'ask');assert.equal(newPeople({TELEGRAM_ALLOWED_USERS:'1'},'telegram',{}),'silent','a list stops pairing: ignore, still filed');
 assert.equal(newPeople({},'slack',{gateway:{unauthorized_dm_behavior:'decline'}}),'ignored');
 assert.equal(newPeople({},'slack',{unauthorized_dm_behavior:'ignore',platforms:{slack:{unauthorized_dm_behavior:'pair'}}}),'ask','per channel wins');
 assert.equal(dmBehavior({},'email',{}),'ignore');assert.equal(newPeople({},'weixin',{}),'ask');
 assert.equal(newPeople({},'slack',{allow_all_users:true}),'anyone','config allow_all_users with no list');
 assert.equal(newPeople({GATEWAY_ALLOW_ALL_USERS:'false'},'slack',{allow_all_users:true}),'ask','the .env wins over config.yaml')});

test('WhatsApp follows its bridge: under any policy but pairing only its own list gets in',()=>{
 assert.equal(newPeople({WHATSAPP_DM_POLICY:'open'},'whatsapp',{}),'ignored','open with no list = nobody');
 assert.equal(newPeople({WHATSAPP_DM_POLICY:'open',WHATSAPP_ALLOWED_USERS:'*'},'whatsapp',{}),'anyone');
 assert.equal(newPeople({GATEWAY_ALLOW_ALL_USERS:'true'},'whatsapp',{}),'anyone','pairing, no list, allow-all: anyone');
 assert.equal(newPeople({WHATSAPP_DM_POLICY:'allowlist',WHATSAPP_ALLOW_ALL_USERS:'true'},'whatsapp',{}),'ignored','the anyone switch does not get past the bridge');
 assert.equal(newPeople({},'whatsapp',{unauthorized_dm_behavior:'ignore'}),'silent');
 const c=channelWho({WHATSAPP_DM_POLICY:'allowlist',WHATSAPP_ALLOWED_USERS:'1'},'whatsapp',[{platform:'whatsapp',user_id:'2',user_name:'Old'}],{});
 assert.equal(c.rows.find(r=>r.name==='Old').blocked,true,'an approval not on the list stays outside the bridge')});

test('the confirm says what the channel is like afterwards',()=>{
 assert.equal(channelWho({TELEGRAM_ALLOWED_USERS:'1'},'telegram',[],{},{}).rows[0].after,'','strangers were already filed silently and still are');
 assert.equal(channelWho({TELEGRAM_ALLOWED_USERS:'1',GATEWAY_ALLOW_ALL_USERS:'true'},'telegram',[],{},{}).rows[0].after,'Anyone can message it then.');
 assert.equal(channelWho({WHATSAPP_DM_POLICY:'allowlist',WHATSAPP_ALLOWED_USERS:'1'},'whatsapp',[],{},{}).rows[0].after,'Nobody can message it then.');
 assert.equal(channelWho({TELEGRAM_ALLOWED_USERS:'1'},'telegram',[],{},{unauthorized_dm_behavior:'decline'}).rows[0].after,'Nobody can message it then.','decline stays decline: the last person gone, nobody can write');
});

test('one ID at a time: empty and malformed IDs are refused, clear only for one list',()=>{
 assert.ok(checkId(''));assert.ok(checkId('',{clear:true,every:true}));assert.equal(checkId('',{clear:true}),null);
 assert.ok(checkId('1,2'));assert.ok(checkId('a b'));assert.equal(checkId('*'),null);assert.equal(checkId('628111@s.whatsapp.net'),null)});

// the remove flow with its reading and writing handed in; setList computes from the value at the moment of writing
function fakeIo(env,approved,mapping={},{hot=true,main=null,conf={}}={}){const log=[],revoked=[];let reads=0;const store=approved.filter(x=>!x.source);
 const io={read:async()=>{reads++;const ap=[...store.map(x=>({...x})),...Object.entries(env).filter(([k])=>/_ALLOWED_USERS$/.test(k)&&!/^GATEWAY/.test(k)).flatMap(([k,v])=>split(v).filter(u=>u!=='*').map(u=>({platform:k.replace(/_(GROUP_)?ALLOWED_USERS$/,'').toLowerCase(),user_id:u,user_name:'(added in settings file)',source:k})))];return {env:{...env},approved:ap,mapping,conf}},
  setList:async(k,fn)=>{const v=fn(env[k]??'');if(v==null)return {changed:false,hot:true};log.push([k,v]);if(v)env[k]=v;else delete env[k];return {changed:true,hot:!/^GATEWAY_/.test(k)&&hot}},
  // like the server: this agent's own store only (the engine's revoke would 404 on .env entries and touch the main .env)
  revoke:async(pf,ids)=>{for(const id of ids){revoked.push([pf,id]);const i=store.findIndex(x=>x.platform===pf&&x.user_id===id);if(i>=0)store.splice(i,1)}}};
 if(main)io.mainEnv=async()=>main.text;
 return {log,revoked,reads:()=>reads,io}}

test('a listed person is removed without touching approvals the engine only echoes from the .env (no 404, no 502)',async()=>{
 const env={TELEGRAM_ALLOWED_USERS:'5,6'},f=fakeIo(env,[]);const r=await removePerson(f.io,{pf:'telegram',id:'5'});
 assert.deepEqual(f.log,[['TELEGRAM_ALLOWED_USERS','6']]);assert.deepEqual(f.revoked,[],'nothing to revoke: it was only on the list');assert.equal(r.still,false);assert.equal(f.reads(),2)});

test('a row that is both: off the list and its real approval (every alias)',async()=>{
 const env={WHATSAPP_ALLOWED_USERS:'6280000000005,100000000000001,628999'},f=fakeIo(env,[{platform:'whatsapp',user_id:'100000000000001',user_name:'Wife'}],MAP);
 const r=await removePerson(f.io,{pf:'whatsapp',id:'6280000000005'});assert.equal(env.WHATSAPP_ALLOWED_USERS,'628999');assert.deepEqual(f.revoked,[['whatsapp','100000000000001']]);assert.equal(r.still,false)});

test('a secondary agent\'s removal never touches the main agent\'s .env, and the check proves it',async()=>{
 const main={text:'TELEGRAM_ALLOWED_USERS=0731\n'},env={TELEGRAM_ALLOWED_USERS:'0731,9'},f=fakeIo(env,[{platform:'telegram',user_id:'0731',user_name:'xvr'}],{},{main});
 let r=await removePerson(f.io,{pf:'telegram',id:'0731'});assert.equal(r.mainTouched,false);assert.equal(main.text,'TELEGRAM_ALLOWED_USERS=0731\n');assert.equal(r.still,false);
 // what the engine's own revoke would do (it writes the dashboard's scope, the main .env): caught and reported
 const g=fakeIo({TELEGRAM_ALLOWED_USERS:'0752'},[{platform:'telegram',user_id:'0752'}],{},{main:{get text(){return this._t},_t:'TELEGRAM_ALLOWED_USERS=0752\n'}});
 const mainRef={t:'TELEGRAM_ALLOWED_USERS=0752\n'};g.io.mainEnv=async()=>mainRef.t;const rv=g.io.revoke;g.io.revoke=async(p,ids)=>{mainRef.t='';return rv(p,ids)};
 r=await removePerson(g.io,{pf:'telegram',id:'0752'});assert.equal(r.mainTouched,true);assert.equal(r.still,true);assert.match(r.why.join(),/main agent/)});

test('computes from the list at the time of writing: a number taken off meanwhile is not written back',async()=>{
 const env={TELEGRAM_ALLOWED_USERS:'1,2,3'},f=fakeIo(env,[]);const set=f.io.setList;f.io.setList=async(k,fn)=>{env[k]='1,3';return set(k,fn)};
 await removePerson(f.io,{pf:'telegram',id:'1'});assert.equal(env.TELEGRAM_ALLOWED_USERS,'3')});

test('empty ID refused; clear takes one whole list only when asked; groups never touched by Every channel',async()=>{
 const env={TELEGRAM_ALLOWED_USERS:'1,2',GATEWAY_ALLOWED_USERS:'9',WHATSAPP_GROUP_ALLOWED_USERS:'x@g.us'};
 await assert.rejects(removePerson(fakeIo(env,[]).io,{pf:'telegram',id:''}),/Say who/);await assert.rejects(removePerson(fakeIo(env,[]).io,{pf:'',id:'',every:true,clear:true}));
 assert.equal(env.TELEGRAM_ALLOWED_USERS,'1,2');assert.equal(env.GATEWAY_ALLOWED_USERS,'9');
 await removePerson(fakeIo(env,[]).io,{pf:'telegram',id:'',clear:true});assert.equal(env.TELEGRAM_ALLOWED_USERS,undefined);
 await removePerson(fakeIo(env,[]).io,{pf:'',id:'9',every:true});assert.equal(env.WHATSAPP_GROUP_ALLOWED_USERS,'x@g.us')});

test('JSON lists stay JSON; "*" Stop takes only the star off',async()=>{const env={SLACK_ALLOWED_USERS:'["U1","U2"]'};await removePerson(fakeIo(env,[]).io,{pf:'slack',id:'U1'});assert.equal(env.SLACK_ALLOWED_USERS,'["U2"]');
 const e2={SLACK_ALLOWED_USERS:'*,U1'};assert.equal((await removePerson(fakeIo(e2,[]).io,{pf:'slack',id:'*'})).still,false);assert.equal(e2.SLACK_ALLOWED_USERS,'U1')});

test('the after-check sees every way in: the list for every channel, "*", the anyone switch, a real approval kept',async()=>{
 let r=await removePerson(fakeIo({TELEGRAM_ALLOWED_USERS:'5',GATEWAY_ALLOWED_USERS:'5'},[]).io,{pf:'telegram',id:'5'});assert.match(r.why.join(),/every channel/);
 r=await removePerson(fakeIo({TELEGRAM_ALLOWED_USERS:'5,*'},[]).io,{pf:'telegram',id:'5'});assert.match(r.why.join(),/\*/);
 r=await removePerson(fakeIo({TELEGRAM_ALLOWED_USERS:'5',TELEGRAM_ALLOW_ALL_USERS:'true'},[]).io,{pf:'telegram',id:'5'});assert.match(r.why.join(),/anyone/);
 const f=fakeIo({},[{platform:'telegram',user_id:'5'}]);f.io.revoke=async()=>{};r=await removePerson(f.io,{pf:'telegram',id:'5'});assert.match(r.why.join(),/approval/)});

test('"Every channel" takes them off every list (aliases too) and every real approval; that list needs a restart',async()=>{
 const env={GATEWAY_ALLOWED_USERS:'6280000000005,9',WHATSAPP_ALLOWED_USERS:'100000000000001',TELEGRAM_ALLOWED_USERS:'6280000000005'},f=fakeIo(env,[{platform:'whatsapp',user_id:'6280000000005'}],MAP);
 const r=await removePerson(f.io,{pf:'',id:'6280000000005',every:true});
 assert.equal(env.GATEWAY_ALLOWED_USERS,'9');assert.equal(env.WHATSAPP_ALLOWED_USERS,undefined);assert.equal(env.TELEGRAM_ALLOWED_USERS,undefined);assert.equal(f.revoked.length,1);assert.equal(r.restart,true);assert.equal(r.still,false);
 assert.deepEqual(globalWho({GATEWAY_ALLOWED_USERS:'6280000000005,100000000000001'},MAP).rows.length,1,'aliases merged on the every-channel list')});

test('the approved file loses every alias of the person, and nothing else',()=>{
 const {data,gone}=approvedWithout({'100000000000001':{user_name:'Wife'},'628999':{user_name:'B'}},'whatsapp',['6280000000005'],MAP);
 assert.deepEqual(gone,['100000000000001']);assert.deepEqual(Object.keys(data),['628999'])});

test('the engine is only told about the list: a paused channel stays paused',()=>{
 assert.deepEqual(engineChange('WHATSAPP_ALLOWED_USERS','1'),{env:{WHATSAPP_ALLOWED_USERS:'1'}});assert.ok(!('enabled' in engineChange('K','1')))});

// the locked writes: the engine's own flocks (.env.lock, the pairing folder's .lock). macOS has no flock, so this runs where
// it exists (the AI box: copy app/agentops.mjs, app/allowlist.mjs and this file to a scratch folder there and run it)
const HAS_FLOCK=spawnSync('sh',['-c','command -v flock']).status===0;
test('the list and the approvals change under the engine\'s locks',{skip:HAS_FLOCK?false:'flock is not on this computer (macOS); run this file on the AI box'},async()=>{
 const {editEnv,withFlock}=await import('../app/agentops.mjs');const d=mkdtempSync(path.join(tmpdir(),'aq-env-'));TMP.push(d);const f=path.join(d,'.env');writeFileSync(f,'A=1\nTELEGRAM_ALLOWED_USERS=1,2,3\n');
 assert.equal(await editEnv(f,t=>setEnvLine(t,'TELEGRAM_ALLOWED_USERS',v=>formatList(split(v).filter(x=>x!=='2'),false))),true);assert.equal(readFileSync(f,'utf8'),'A=1\nTELEGRAM_ALLOWED_USERS=1,3\n');
 // while the pairing folder's lock is held elsewhere, withFlock waits for it
 const lock=path.join(d,'.lock'),{spawn}=await import('node:child_process');spawn('flock',[lock,'-c','sleep 1'],{stdio:'ignore'});await new Promise(r=>setTimeout(r,200));
 const t=Date.now();await withFlock(lock,async()=>{},5);assert.ok(Date.now()-t>=500,'waited for the other holder')});
