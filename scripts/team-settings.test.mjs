// node scripts/team-settings.test.mjs: System › Teams: team policy writer, fixer settings, alerts target, Pause alerts, test agents
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {cleanTeams,cleanFixer,cleanPerson,setTestLine,createTeamSettings,FIXER_DEFAULTS} from '../app/team-settings.mjs';
import {createQuiet,parseTestAgents} from '../app/alert-quiet.mjs';
let n=0;const t=async(name,f)=>{await f();n++;console.log('ok',name)};
const AG=['default','sesa','a1','a2'];

await t('a person: ids cleaned, unknown agents dropped from full authority',()=>{
 const p=cleanPerson({name:' Amri ',telegram:'1339820731, abc, 12',telegram_names:['@xvr','xvr'],whatsapp:['+62 812-3456-7890','12'],full_authority:['a1','zz']},['a1','a2']);
 assert.deepEqual(p,{name:'Amri',telegram:['1339820731'],telegram_names:['xvr'],whatsapp:['+6281234567890'],full_authority:['a1']})});
await t('teams: one team per agent, unique names, aliases only for its agents, contact must be a member',()=>{
 const out=cleanTeams([{name:'A',agents:['a1','a2','zz'],aliases:{a1:['Randy'],sesa:['x']},members:[{name:'M'},{name:'M'},{name:''}],contact:'Nobody'},{name:'B',agents:['a2','sesa'],members:[{name:'K'}],contact:'K'}],AG);
 assert.deepEqual(out[0].agents,['a1'],'a2 moved to B, zz is unknown');assert.deepEqual(out[0].aliases,{a1:['Randy']});assert.deepEqual(out[0].members,[{name:'M'}]);assert.equal(out[0].contact,undefined);
 assert.deepEqual(out[1].agents,['a2','sesa']);assert.equal(out[1].contact,'K');
 assert.throws(()=>cleanTeams([{name:'A'},{name:'a'}],AG),/Two teams/);assert.throws(()=>cleanTeams([{name:' '}],AG),/needs a name/)});
await t('fixer: ranges kept, agent must exist, off reason only while off',()=>{
 const f=cleanFixer({on:false,cap:500,minutes:1,proof_minutes:'20',off_why:'engine work'},AG,{agent:'default'});
 assert.deepEqual(f,{...FIXER_DEFAULTS,on:false,cap:100,minutes:5,proof_minutes:20,off_why:'engine work'});
 assert.equal(cleanFixer({on:true},AG,f).off_why,undefined);assert.throws(()=>cleanFixer({agent:'ghost'},AG),/does not exist/)});
await t('test agents file: add, remove, comments kept, read by alert-quiet',async()=>{
 let x=setTestLine('# made by checks\nmb-1\n','a1',true);assert.equal(x,'# made by checks\nmb-1\na1\n');x=setTestLine(x,'a1',true);assert.equal(x.match(/a1/g).length,1);
 x=setTestLine(x,'mb-1',false);assert.equal(x,'# made by checks\na1\n');assert.deepEqual([...parseTestAgents(x)],['a1'])});
await t('store: saves keep other keys and a .prev copy; pause and alerts; quiet sees both',async()=>{
 const D=await mkdtemp(path.join(tmpdir(),'ts-')),H=await mkdtemp(path.join(tmpdir(),'th-'));let clock=Date.parse('2026-11-07T10:00:00Z');
 await writeFile(path.join(D,'team-policy.json'),JSON.stringify({_about:'keep me',owner:{name:'Aq',telegram:['1']},teams:[],fixer:{on:false,agent:'default',cap:20,off_why:'hold'}}));
 const T=createTeamSettings({DATA:D,HERMES_HOME:H,listAgents:async()=>AG,now:()=>clock});
 await T.setTeams({teams:[{name:'Continue',agents:['a1'],members:[{name:'Amri',telegram:['2']}],contact:'Amri'}]});
 const p=JSON.parse(await readFile(path.join(D,'team-policy.json'),'utf8'));assert.equal(p._about,'keep me');assert.equal(p.owner.name,'Aq');assert.equal(p.teams[0].contact,'Amri');assert.equal(p.fixer.off_why,'hold');
 assert.equal(JSON.parse(await readFile(path.join(D,'team-policy.json.prev'),'utf8')).teams.length,0);
 const f=await T.setFixer({on:true,cap:12});assert.deepEqual([f.on,f.cap,f.off_why],[true,12,undefined]);assert.equal((await T.view()).teams[0].name,'Continue');
 assert.deepEqual(await T.setAlerts({channel:'telegram',chat:'99',name:'Telegram (main)'}),{channel:'telegram',chat:'99',name:'Telegram (main)'});assert.equal((await T.alertTarget()).chat,'99');
 assert.equal(await T.setAlerts({channel:''}),null);assert.equal(await T.alertTarget(),null);
 const q=createQuiet({DATA:D,HERMES_HOME:H,now:()=>clock,every:0});assert.equal(q('a1'),null);
 const ps=await T.setPause({until:clock+3600e3,why:'build'});assert.equal(ps.why,'build');assert.equal(q('a1'),'hold');assert.equal((await T.view()).pause.why,'build');
 await assert.rejects(T.setPause({until:clock+30*864e5}),/two weeks/);
 assert.equal(await T.setPause({until:0}),null);assert.equal(q('a1'),null);assert.equal((await T.view()).pause,null);
 await T.setPause({until:clock+60e3});clock+=120e3;assert.equal(q('a1'),null,'an expired pause is ignored');assert.equal((await T.view()).pause,null);
 assert.deepEqual(await T.setTest('a2',true),['a2']);assert.equal(q('a2'),'test');assert.deepEqual(await T.setTest('a2',false),[]);await assert.rejects(T.setTest('ghost',true),/does not exist/)});
console.log(n+' passed');
