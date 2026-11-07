// AdsPower and Composio per agent (app/agent-optins.mjs, 7 Nov 2026): off by default, kept at the first start only for agents
// whose tools really ran in the last 14 days, backups first, and Composio never handed to an agent switched off.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createOptins,decide,toolNames,baseOf,appNames,decideApps,solvedIssues} from '../app/agent-optins.mjs';
import {createConnectors} from '../app/connectors.mjs';

const COMP={url:'https://connect.composio.dev/mcp',auth:'oauth'};
async function setup(){const DIR=await mkdtemp(path.join(tmpdir(),'optins-')),H=path.join(DIR,'hermes'),DATA=path.join(DIR,'data');
 const cfg={default:{mcp_servers:{composio:COMP}},sales:{mcp_servers:{'composio-x':COMP}},quiet:{mcp_servers:{composio:COMP}},'default--whatsapp-2':{mcp_servers:{composio:COMP}}};
 for(const a of Object.keys(cfg)){const d=a==='default'?H:path.join(H,'profiles',a);await mkdir(d,{recursive:true});await writeFile(path.join(d,'config.yaml'),'x: 1\n');await writeFile(path.join(d,'state.db'),'')}
 await mkdir(DATA,{recursive:true});await writeFile(path.join(DATA,'agent-adspower.json'),'{"ports":{}}');
 return {DIR,H,DATA,cfg}}

test('only agents whose tools really ran keep an ability; copies count for their agent',()=>{
 const counts={'default--whatsapp-2':{adspower:{n:3,last:1}},sales:{composio:{n:1,last:1},adspower:{n:0,last:0}},quiet:{}};
 assert.deepEqual(decide(counts,['default','default--whatsapp-2','sales','quiet']),{adspower:{default:true},composio:{sales:true}});
 assert.deepEqual(toolNames({mcp_servers:{'composio-x':COMP,notion:{url:'https://mcp.notion.com'}}}),{adspower:['AdsPower'],composio:['composio-x']});
 assert.equal(baseOf('default--whatsapp-3'),'default')});

test('before the first-start count everything stays on; after it, an agent not kept is off; switches save',async()=>{
 const {H,DATA,cfg}=await setup();const notes=[];
 const run=async(py,args)=>{const q=JSON.parse(args[2]);assert.equal(args[0],'-c');assert.deepEqual(q.agents.sales.names.composio,['composio-x']);assert.equal(q.days,14);
  return {ok:true,out:JSON.stringify({default:{adspower:{n:0,last:0},composio:{n:0,last:0}},'default--whatsapp-2':{adspower:{n:5,last:1700000000},composio:{n:0,last:0}},sales:{adspower:{n:0,last:0},composio:{n:2,last:1700000100}},quiet:{adspower:{n:0,last:0},composio:{n:0,last:0}}})}};
 const o=createOptins({DATA,HERMES_HOME:H,listAgents:async()=>Object.keys(cfg),readConfig:async a=>cfg[a],python:async()=>'/py',live:true,run,note:async(t,d)=>notes.push(t+': '+d),log:()=>{}});
 assert.equal(await o.on('adspower','quiet'),true);assert.equal(await o.on('composio','sales'),true);   // not counted yet: as before
 const r=await o.migrate();assert.deepEqual(r.decision,{adspower:{default:true},composio:{sales:true}});
 assert.equal(await o.on('adspower','default--whatsapp-3'),true);assert.equal(await o.on('adspower','sales'),false);assert.equal(await o.on('composio','quiet'),false);assert.equal(await o.on('composio','sales'),true);
 assert.match(notes[0],/AdsPower kept for default; Composio kept for sales\. Everyone else has them off/);
 // backups: the AdsPower ports file and each config that loses its Composio entry (not sales, which keeps it)
 assert.equal(r.backups.length,4);assert.ok(r.backups.every(f=>/\.bak-optins-\d{14}$/.test(f)));assert.ok(!r.backups.some(f=>f.includes('/sales/')));
 assert.equal(await o.migrate(),null);   // once
 await o.set('composio','quiet',true);assert.equal(await o.on('composio','quiet'),true);await o.set('composio','quiet',false);assert.equal(await o.on('composio','quiet'),false);
 await assert.rejects(o.set('nope','quiet',true),/Unknown ability/);
 const st=await o.state('default');assert.equal(st.adspower.on,true);assert.deepEqual(st.adspower.used,{n:5,last:1700000000});assert.equal(st.composio.on,false)});

test('a clean install keeps nothing, and a test copy never counts',async()=>{const {H,DATA}=await setup();
 const fresh=createOptins({DATA,HERMES_HOME:H,listAgents:async()=>['default'],readConfig:async()=>({}),python:async()=>'/py',live:true,run:async()=>({ok:true,out:'{"default":{}}'}),log:()=>{}});
 const r=await fresh.migrate();assert.deepEqual(r.decision,{adspower:{},composio:{}});assert.equal(await fresh.on('adspower','default'),false);assert.equal(await fresh.on('composio','research'),false);
 const {H:H2,DATA:D2}=await setup();const copy=createOptins({DATA:D2,HERMES_HOME:H2,listAgents:async()=>['default'],readConfig:async()=>({}),python:async()=>'/py',live:false,run:async()=>{throw Error('must not run')},log:()=>{}});
 assert.equal(await copy.migrate(),null)});

test('connectors never hand Composio to an agent switched off for it, other apps still go',async()=>{
 const cfg={default:{mcp_servers:{composio:COMP,notion:{url:'https://mcp.notion.com/mcp',auth:'oauth'}}},sales:{mcp_servers:{}},helper:{mcp_servers:{}}};const set=[];
 const c=createConnectors({listAgents:async()=>Object.keys(cfg),readConfig:async a=>cfg[a],setKey:async(a,k,v)=>{set.push(a+' '+k);return {ok:true}},redirect:n=>'https://x/'+n,
  allow:async(a,e)=>!/composio/.test(e.url)||a==='helper'});
 await c.ensureAll();assert.deepEqual(set.sort(),['helper mcp_servers.composio','helper mcp_servers.notion','sales mcp_servers.notion'])});

const NOTION={url:'https://mcp.notion.com/mcp',auth:'oauth'},SLACK={url:'https://mcp.slack.com/mcp',auth:'oauth'};
test('sign-in apps: an agent keeps the ones it ran; the main agent keeps all its own (the owner’s sign-ins); Composio and local tools are not apps',()=>{
 const cfg={default:{mcp_servers:{'notion-abel':NOTION,slack:SLACK,'slack-as2':SLACK,composio:COMP,notify:{url:'http://127.0.0.1:4400/mcp'}}},'default--whatsapp-2':{mcp_servers:{slack:SLACK}},
  sela:{mcp_servers:{'notion-abel':NOTION,slack:SLACK}},pixel:{mcp_servers:{slack:SLACK,'notion-abel':NOTION}}};
 assert.deepEqual(appNames(cfg.default),['notion-abel','slack','slack-as2']);
 const counts={pixel:{'app:slack':{n:3,last:1}},sela:{'app:slack':{n:0,last:0}}};
 assert.deepEqual(decideApps(counts,cfg),{default:{'notion-abel':true,slack:true,'slack-as2':true},pixel:{slack:true}})});

test('sign-in apps: on until the first count, then only what was kept; backups of each config that loses an app; switches save',async()=>{
 const {H,DATA}=await setup();const cfg={default:{mcp_servers:{slack:SLACK}},sela:{mcp_servers:{slack:SLACK,'notion-abel':NOTION}},quiet:{mcp_servers:{}}};
 for(const a of ['sela','quiet']){const d=path.join(H,'profiles',a);await mkdir(d,{recursive:true});await writeFile(path.join(d,'config.yaml'),'x: 1\n');await writeFile(path.join(d,'state.db'),'')}
 const notes=[];const o=createOptins({DATA,HERMES_HOME:H,listAgents:async()=>Object.keys(cfg),readConfig:async a=>cfg[a],python:async()=>'/py',live:true,note:async(t,d)=>notes.push(d),log:()=>{},
  run:async(py,args)=>{const q=JSON.parse(args[2]);assert.deepEqual(q.agents.sela.names,{'app:slack':['slack'],'app:notion-abel':['notion-abel']});return {ok:true,out:JSON.stringify({default:{'app:slack':{n:9,last:2}},sela:{'app:slack':{n:0,last:0},'app:notion-abel':{n:1,last:5}}})}}});
 assert.equal(await o.appOn('sela','slack'),true);
 const r=await o.migrateApps();assert.deepEqual(r.decision,{default:{slack:true},sela:{'notion-abel':true}});
 assert.equal(await o.appOn('sela','slack'),false);assert.equal(await o.appOn('sela','notion-abel'),true);assert.equal(await o.appOn('default--whatsapp-2','slack'),true);assert.equal(await o.appOn('newbie','slack'),false);
 assert.equal(r.backups.length,1);assert.match(r.backups[0],/profiles\/sela\/config\.yaml\.bak-apps-\d{14}$/);assert.match(notes[0],/sela: notion-abel/);
 assert.equal(await o.migrateApps(),null);
 await o.setApp('sela','notion-abel',false);assert.equal(await o.appOn('sela','notion-abel'),false);await assert.rejects(o.setApp('sela','../x',true),/Unknown app/);
 assert.deepEqual((await o.appsState('sela',['notion-abel','slack'])).map(x=>[x.name,x.on]),[['notion-abel',false],['slack',false]])});

test('connectors pass the app’s name to the switch',async()=>{const seen=[];
 const c=createConnectors({listAgents:async()=>['default','sela'],readConfig:async a=>a==='default'?{mcp_servers:{'notion-abel':NOTION}}:{mcp_servers:{}},setKey:async()=>({ok:true}),redirect:n=>n,allow:async(a,e,n)=>{seen.push(a+' '+n);return false}});
 await c.ensureAll();assert.deepEqual(seen,['sela notion-abel'])});

test('an agent’s own sign-in reports close only when every app they name is off for it',async()=>{
 const items=[{id:'a',state:'open',source:'agent',agent:'sela',what:'Stop engine-start OAuth failures for composio, notion, slack',missing:'A sign-in, Sela does not need them'},
  {id:'b',state:'queued',source:'agent',agent:'default',what:'Re-sign in slack-as2',missing:'A usable sign-in link for slack-as2'},
  {id:'c',state:'open',source:'agent',agent:'cove-threads',what:'Read label generator',missing:'Read access to /home/claude/work/labels'},
  {id:'d',state:'open',source:'person',agent:'sela',what:'Slack sign-in for the team',missing:'x'},
  {id:'e',state:'closed',source:'agent',agent:'sela',what:'Fix notion sign-in',missing:''},
  {id:'f',state:'open',source:'agent',agent:'pixel',what:'Start MCP tool servers notion and slack',missing:'OAuth sign-in'},
  {id:'g',state:'open',source:'agent',agent:'sela',what:'Stop engine start failures from unused MCP apps',missing:'Permission to edit my config'},
  {id:'h',state:'open',source:'agent',agent:'pixel',what:'Stop engine start failures from unused MCP apps',missing:'x'}];
 const on={default:['slack'],pixel:['slack']};
 assert.deepEqual(await solvedIssues(items,async(a,w)=>w==='*'?(on[a]||[]).length>0:(on[a]||[]).includes(w)),['a','g'])});
