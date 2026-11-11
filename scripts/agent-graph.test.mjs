// Tests for each agent's map, its search tool, the size of what it sends, and the reference-section proposal (app/agent-graph.mjs).
// Run: node --test scripts/agent-graph.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createAgentGraph,kindOf,dirOk,looksSecret,sizeOf,referenceSections,withPointers,toolEntry,sameEntry,runArgs,TOOL_NAMES,MAX_DOCS_PER_RUN} from '../app/agent-graph.mjs';

const w=async(f,t)=>{await mkdir(path.dirname(f),{recursive:true});await writeFile(f,t)};
const exists=f=>stat(f).then(()=>true,()=>false);
const walkAll=async(d,rel='')=>{const out=[];for(const e of await readdir(d,{withFileTypes:true}).catch(()=>[])){const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())out.push(...await walkAll(path.join(d,e.name),r));else out.push(r)}return out};

// one agent "sales" with a workspace full of things that must never be mapped, and a fake graphify
async function make({backend=true,agents=['sales'],busy=()=>false,budget=16*1024,pause=()=>false,pilot=false,custom=null,quota=false}={}){
 const root=await mkdtemp(path.join(tmpdir(),'ag-'));const H=path.join(root,'.hermes'),DATA=path.join(root,'data');const PY=path.join(root,'workspaces','.aqeelos-python','bin');
 await mkdir(PY,{recursive:true});await writeFile(path.join(PY,'graphify'),'');
 if(backend){await mkdir(path.join(root,'.gemini','antigravity-cli'),{recursive:true});await w(path.join(root,'.local','bin','agy'),'')}
 for(const a of agents){await mkdir(path.join(H,'profiles',a,'memories'),{recursive:true});await writeFile(path.join(H,'profiles',a,'config.yaml'),'');}
 const ws=path.join(root,'workspaces','sales');
 await w(path.join(ws,'PRICES.md'),'# Prices\nBasic costs 10.\n');
 await w(path.join(ws,'notes','guide.txt'),'How we onboard a customer.\n');
 await w(path.join(ws,'AGENTS.md'),'# agents file, always sent already\n');
 await w(path.join(ws,'AQEEL_DECISIONS.md.bak-1106'),'old\n');
 await w(path.join(ws,'.env'),'KEY=abc\n');
 await w(path.join(ws,'.secrets','keys.md'),'# secrets\n');
 await w(path.join(ws,'.browser','Default','notes.md'),'# cookies page\n');
 await w(path.join(ws,'.config','x.md'),'# config\n');
 await w(path.join(ws,'sessions','chat1.md'),'# a customer chat with a phone number\n');
 await w(path.join(ws,'node_modules','pkg','README.md'),'# lib\n');
 await w(path.join(ws,'notes','credentials.md'),'# logins\n');
 await w(path.join(ws,'notes','leak.md'),'The key is sk-abcdefghijklmnopqrstuvwxyz123456 ok\n');
 await w(path.join(ws,'notes','data.db'),'binary');
 await w(path.join(ws,'.tools','sync.py'),'def sync():\n    return 1\n');
 await w(path.join(ws,'.tools','state.json'),'{}');
 const cfg=Object.fromEntries(agents.map(a=>[a,{}]));const sets=[];const runs=[];const relays=[];let t=1e12,isBusy=busy;
 const relay=async o=>{const r={url:'http://127.0.0.1:1/v1',key:'one-run-key',stats:{quota:false},stopped:false,stop:async()=>{r.stopped=true},o};relays.push(r);return r};
 const run=async(cmd,args,o)=>{const b=path.basename(cmd);
  if(b==='agy')return 'agy 1.5.5';
  if(b==='python')return '';
  if(custom)return custom(cmd,args,o,relays);
  if(b==='graphify'){runs.push({args,o});if(quota&&args.includes('--backend')){relays.at(-1).o.onQuota();throw new Error('aborted')}const g=path.join(args[1],'graphify-out','graph.json');await w(g,JSON.stringify({nodes:[{id:'a'},{id:'b'}],links:[]}));return ''}
  return ''};
 const G=createAgentGraph({HERMES_HOME:H,DATA,home0:root,run,relay,nice:false,now:()=>t,log:()=>{},env:{},budget,busy:a=>isBusy(a),paused:()=>pause(),
  agents:async()=>agents,readConfig:async a=>cfg[a],pick:(c,k)=>k.split('.').reduce((o,x)=>o?.[x],c),
  setKey:async(a,k,v)=>{sets.push([a,k,v]);const ks=k.split('.');let o=cfg[a];for(const x of ks.slice(0,-1))o=o[x]??={};o[ks.at(-1)]=v;return {ok:true}},
  writeSoul:null,busyPoll:5});
 if(!pilot)await G.setEnabled({all:true});
 return {G,H,DATA,root,ws,cfg,sets,runs,tick:ms=>{t+=ms},relays,setBusy:f=>{isBusy=f}}}

test('only documents and code that cannot hold a secret are allowed',()=>{
 assert.equal(kindOf('notes.md'),'doc');assert.equal(kindOf('a.txt'),'doc');assert.equal(kindOf('sync.py'),'code');assert.equal(kindOf('data.json'),null);assert.equal(kindOf('page.html'),null);
 for(const n of ['.env','.env.bak-20261109','auth.json','credentials.md','my-secrets.md','api-tokens.txt','state.db','x.log','SOUL.md','AGENTS.md','MEMORY.md','USER.md','AQEEL_DECISIONS.md.bak-1106','id.pem'])assert.equal(kindOf(n),null,n);
 for(const d of ['.browser','.secrets','.config','.hermes','.local','.cache','node_modules','sessions','logs','mcp-tokens','vault','Downloads','attachments','__pycache__'])assert.equal(dirOk(d),false,d);
 assert.equal(dirOk('.tools'),true);assert.equal(dirOk('notes'),true);assert.equal(dirOk('work'),true)});

test('text that looks like a key keeps the whole file out',()=>{
 for(const t of ['sk-abcdefghijklmnopqrstuvwxyz123456','-----BEGIN RSA PRIVATE KEY-----','AKIAABCDEFGHIJKLMNOP','Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789','api_key = "abcdef0123456789abcdef"','password: hunter2hunter2hunter2'])assert.equal(looksSecret(t),true,t);
 for(const t of ['token: ${N8N_MCP_TOKEN}','Ask for the API key in the lock box.','The password is set by the customer.'])assert.equal(looksSecret(t),false,t)});

test('the size sent every time is measured against a budget',()=>{
 assert.deepEqual(sizeOf({soul:30970,memory:2485}),{soul:30970,memory:2485,total:33455,budget:16384,over:17071,level:'warn'});
 assert.equal(sizeOf({soul:8000,memory:2000}).level,'ok');assert.equal(sizeOf({soul:16384,memory:0}).level,'ok');assert.equal(sizeOf({soul:16385,memory:0}).level,'warn')});

const SOUL='# Who you are\nYou are the sales agent. Never share prices before the customer says the country.\n\n## Price list\n'+Array.from({length:30},(_,i)=>'| Plan '+i+' | '+(i*10)+' | monthly |').join('\n')+'\n\n## Glossary\n'+Array.from({length:20},(_,i)=>'- Term'+i+': a long explanation of this word so it takes room in the file').join('\n')+'\n\n## Escalation rules\nYou must always escalate refunds. Never promise a refund. Do not argue. '+'Always follow this. '.repeat(60)+'\n\n## Product FAQ\n'+'Q: Do you ship? A: yes, to everyone. '.repeat(30)+'\n';
test('only clearly-reference sections are proposed, never rules or the opening',()=>{
 const s=referenceSections(SOUL);const titles=s.map(x=>x.title);
 assert.deepEqual(titles,['Price list','Glossary','Product FAQ']);assert.ok(s.every(x=>x.bytes>=800&&x.reason&&x.id));
 assert.ok(!titles.includes('Escalation rules'));assert.ok(!titles.includes('Who you are'));
 assert.deepEqual(referenceSections('## Reference\nshort\n'),[],'too small to be worth moving');
 assert.deepEqual(referenceSections('## Reference keys\nkey: sk-abcdefghijklmnopqrstuvwxyz123456\n'+'x '.repeat(500)),[],'never a section with a secret');
 const out=withPointers(SOUL,s.slice(0,1));assert.ok(out.includes('## Price list\nMoved to your map (reference/price-list.md)'));assert.ok(!out.includes('| Plan 3 |'));assert.ok(out.includes('## Glossary\n- Term0'),'the others stay');
 assert.ok(out.length<SOUL.length-s[0].bytes+200)});

test('the tool entry has three tools only and is recognised again',()=>{
 const e=toolEntry({py:'/py/bin/python',graph:'/g/graph.json'});assert.deepEqual(e.args,['-m','graphify.serve','/g/graph.json']);assert.deepEqual(e.tools.include,TOOL_NAMES);assert.equal(e.env.GRAPHIFY_NO_AUTO_REFRESH,'1');
 assert.equal(sameEntry(e,toolEntry({py:'/py/bin/python',graph:'/g/graph.json'})),true);assert.equal(sameEntry(e,{...e,args:['x']}),false);assert.equal(sameEntry(e,null),false);
 assert.deepEqual(runArgs({corpus:'/c',docs:true,first:true,backend:'openai',model:'m'}),['extract','/c','--max-concurrency','1','--backend','openai','--model','m']);
 assert.deepEqual(runArgs({corpus:'/c',docs:false,first:true}),['extract','/c','--code-only']);assert.deepEqual(runArgs({corpus:'/c',docs:false,first:false}),['update','/c'])});

test('the first map holds only allowed files, then the tool is added, once',async()=>{const t=await make();const {G,cfg,sets,runs,root,H}=t;
 const r=await G.refresh('sales');assert.equal(r.ok,true);assert.equal(r.tool,true);
 const files=(await walkAll(G.corpusOf('sales'))).filter(f=>!f.startsWith('graphify-out')).sort();
 assert.deepEqual(files,['workspace/.tools/sync.py','workspace/PRICES.md','workspace/notes/guide.txt']);
 assert.equal(runs.length,1);assert.deepEqual(runs[0].args.slice(0,2),['extract',G.corpusOf('sales')]);assert.ok(!runs[0].args.includes('--code-only'));assert.equal(runs[0].o.env.GRAPHIFY_NO_AUTO_REFRESH,'1');
 // the free route only: graphify gets the relay and a bare environment, never the server's own keys
 assert.equal(runs[0].o.env.OPENAI_BASE_URL,'http://127.0.0.1:1/v1');assert.equal(runs[0].o.env.OPENAI_API_KEY,'one-run-key');assert.equal(runs[0].o.env.OPENAI_MODEL,'gemini-3.8-flash-low');assert.equal(runs[0].o.env.GRAPHIFY_BACKEND,'openai');
 assert.ok(Object.keys(runs[0].o.env).every(k=>/^(PATH|HOME|LANG|GRAPHIFY_.*|OPENAI_.*)$/.test(k)),'nothing else in its environment');assert.equal(t.relays[0].stopped,true,'the relay ends with the run');
 assert.equal(cfg.sales.mcp_servers.graphify.command,path.join(root,'workspaces','.aqeelos-python','bin','python'));
 assert.equal(cfg.sales.mcp_servers.graphify.args[2],G.graphOf('sales'));assert.deepEqual(cfg.sales.mcp_servers.graphify.tools.include,TOOL_NAMES);
 const v=await G.view();assert.equal(v.agents.sales.map.state,'ready');assert.equal(v.agents.sales.map.nodes,2);assert.equal(v.agents.sales.map.skippedSecret,1);
 // nothing changed: no model call at all
 assert.deepEqual(await G.refresh('sales'),{skipped:'nothing changed'});assert.equal(runs.length,1);assert.equal(sets.length,1,'the tool is not written again');
 assert.ok(H)});

test('after the first build only changed files are looked at: a document uses the model, code alone does not',async()=>{const {G,runs,ws}=await make();await G.refresh('sales');
 await w(path.join(ws,'notes','guide.txt'),'How we onboard a customer, changed.\n');await G.refresh('sales');
 assert.equal(runs.length,2);assert.equal(runs[1].args[0],'extract');assert.ok(runs[1].args.includes('--max-concurrency'));
 await w(path.join(ws,'.tools','sync.py'),'def sync():\n    return 2\n');await G.refresh('sales');
 assert.deepEqual(runs[2].args,['update',G.corpusOf('sales')],'code only: no model');
 await (await import('node:fs/promises')).rm(path.join(ws,'PRICES.md'));await G.refresh('sales');assert.equal(runs.length,4,'a document that is gone is taken out');assert.equal(runs[3].args[0],'extract');
 assert.ok(!await exists(path.join(G.corpusOf('sales'),'workspace','PRICES.md')))});

test('without a model the documents wait and the code is mapped; with one, they follow',async()=>{const t=await make({backend:false});const {G,runs}=t;
 const r=await G.refresh('sales');assert.equal(r.ok,true);assert.deepEqual(runs[0].args,['extract',G.corpusOf('sales'),'--code-only']);
 const files=(await walkAll(G.corpusOf('sales'))).filter(f=>!f.startsWith('graphify-out'));assert.deepEqual(files,['workspace/.tools/sync.py']);
 assert.equal((await G.view()).agents.sales.map.model,null);
 // an agent with documents only and no model has no map yet
 const u=await make({backend:false});await (await import('node:fs/promises')).rm(path.join(u.ws,'.tools'),{recursive:true});
 assert.deepEqual(await u.G.refresh('sales'),{skipped:'nothing to map'});assert.equal((await u.G.view()).agents.sales.map.state,'needs-model');assert.equal(u.runs.length,0);assert.equal(u.sets.length,0,'no tool without a map')});

test('a few documents at a time, so a first build stays small',async()=>{const {G,ws,runs}=await make();
 for(let i=0;i<35;i++)await w(path.join(ws,'big','doc'+i+'.md'),'# doc '+i+'\nsome text\n');
 await G.refresh('sales');const staged=(await walkAll(G.corpusOf('sales'))).filter(f=>f.endsWith('.md')||f.endsWith('.txt')).length;
 assert.equal(staged,MAX_DOCS_PER_RUN);const v=await G.view();assert.equal(v.agents.sales.map.state,'building');assert.ok(v.agents.sales.map.waiting>0,'the rest wait for the next pass');
 await G.refresh('sales');assert.equal((await G.view()).agents.sales.map.state,'ready');assert.equal(runs.length,2)});

test('never while the agent is replying: before, and during a run',async()=>{
 const a=await make({busy:()=>true});assert.deepEqual(await a.G.refresh('sales'),{skipped:'busy'});assert.equal(a.runs.length,0);assert.deepEqual(await a.G.tick(),{changed:[]});assert.equal(a.runs.length,0);
 // it starts replying while graphify runs: the run is stopped, nothing is marked failed, the next pass retries
 let go=false;const b=await make({custom:(cmd,args,o)=>new Promise((res,rej)=>{go=true;const keep=setTimeout(res,60e3);o.signal.addEventListener('abort',()=>{clearTimeout(keep);rej(new Error('aborted'))})})});b.setBusy(async()=>go);
 const slow=b.G;
 const r=await slow.refresh('sales');assert.deepEqual(r,{skipped:'busy'});const v=await slow.view();assert.equal(v.agents.sales.map.error,null);assert.notEqual(v.agents.sales.map.state,'failed')});


test('a failed run leaves no tool, says why, and waits longer before the next try',async()=>{let calls=0;const t=await make({custom:()=>{calls++;throw new Error('no network')}});const G=t.G;
 const r=await G.refresh('sales');assert.match(r.error,/no network/);const v=(await G.view()).agents.sales.map;assert.equal(v.state,'failed');assert.match(v.error,/no network/);assert.equal(t.cfg.sales.mcp_servers,undefined);
 t.tick(7*3600e3);await G.tick();assert.equal(calls,1,'after one failure it waits twice the usual gap');t.tick(6*3600e3);await G.tick();assert.equal(calls,2);t.tick(13*3600e3);await G.tick();assert.equal(calls,2,'after two, four times');t.tick(12*3600e3);await G.tick();assert.equal(calls,3)});

test('one agent per pass, the one longest without a look; a pause or the off switch stops it',async()=>{
 const t=await make({agents:['sales','help']});await w(path.join(t.root,'workspaces','help','h.md'),'# help doc\n');
 const r=await t.G.tick();assert.equal(r.changed.length,1);assert.equal(t.runs.length,1,'one agent built');
 const r2=await t.G.tick();assert.equal(t.runs.length,2,'the next pass takes the other');assert.equal(r2.changed.length,1);
 t.tick(60e3);assert.equal(t.runs.length,2);await t.G.tick();assert.equal(t.runs.length,2,'not again before its time');
 const p=await make({pause:()=>true});assert.equal(await p.G.tick(),null);assert.equal(p.runs.length,0);
 const o=await make();await w(path.join(o.H,'.aqeelos-graph-off'),'');assert.equal(await o.G.tick(),null);assert.equal(o.runs.length,0)});

test('a person\'s choice of the tool stays: switched off is not switched on again',async()=>{const t=await make();await t.G.refresh('sales');
 t.cfg.sales.mcp_servers.graphify.enabled=false;assert.equal(await t.G.ensureTool('sales'),false);assert.equal(t.cfg.sales.mcp_servers.graphify.enabled,false);
 t.cfg.sales.mcp_servers.graphify={command:'/other',args:[]};assert.equal(await t.G.ensureTool('sales'),false)});

test('what an agent sends every time: SOUL.md plus memories, AGENTS.md shown on its own',async()=>{const t=await make();
 await w(path.join(t.H,'profiles','sales','SOUL.md'),'x'.repeat(30970));await w(path.join(t.H,'profiles','sales','memories','MEMORY.md'),'y'.repeat(1924));await w(path.join(t.H,'profiles','sales','memories','USER.md'),'z'.repeat(561));await w(path.join(t.H,'profiles','sales','memories','MEMORY.md.lock'),'');
 const z=await t.G.size('sales');assert.equal(z.total,33455);assert.equal(z.level,'warn');assert.ok(z.agentsMd>0)});

test('a proposal is only a file; accepting backs up, moves the text to the reference folder and leaves a pointer',async()=>{
 const t=await make();const sf=path.join(t.H,'profiles','sales','SOUL.md');await w(sf,SOUL);
 assert.ok((await t.G.size('sales')).level==='warn'||SOUL.length<16384);
 const small=await make({budget:1000});await w(path.join(small.H,'profiles','sales','SOUL.md'),SOUL);
 const p=await small.G.propose('sales');assert.deepEqual(p.sections.map(s=>s.title),['Price list','Glossary','Product FAQ']);assert.ok(p.saves>0);
 assert.equal(await readFile(path.join(small.H,'profiles','sales','SOUL.md'),'utf8'),SOUL,'proposing never changes the instructions');
 assert.equal((await small.G.view()).agents.sales.proposal.sections.length,3);
 // under the budget there is nothing to propose
 assert.equal(await t.G.propose('sales'),null,'SOUL is small enough here: no proposal');
 await assert.rejects(small.G.accept('sales',[]),/at least one/);
 const priceId=p.sections[0].id;const done=await small.G.accept('sales',[priceId],{by:'Aqeel'});
 assert.deepEqual(done.moved,['Price list']);
 const now=await readFile(path.join(small.H,'profiles','sales','SOUL.md'),'utf8');assert.ok(now.includes('Moved to your map (reference/price-list.md)'));assert.ok(!now.includes('| Plan 7 |'));assert.ok(now.includes('## Glossary\n- Term0'));
 assert.equal(await readFile(path.join(small.H,'profiles','sales',done.backup),'utf8'),SOUL,'the old instructions are kept beside it');
 assert.ok((await walkAll(path.join(small.DATA,'agent-graph','backups','sales'))).length===1,'and in aqeelOS\'s own data');
 assert.ok((await readFile(path.join(small.H,'profiles','sales','reference','price-list.md'),'utf8')).includes('| Plan 7 |'));
 await assert.rejects(small.G.accept('sales',[priceId]),/nothing to accept/);
 // the reference folder joins the map (documents, whatever the folder's name)
 await small.G.refresh('sales',{force:true});assert.ok(await exists(path.join(small.G.corpusOf('sales'),'reference','price-list.md')))});

test('accepting is refused when the instructions changed meanwhile, or when no model can read the moved text',async()=>{
 const a=await make({budget:1000});const sf=path.join(a.H,'profiles','sales','SOUL.md');await w(sf,SOUL);const p=await a.G.propose('sales');
 await writeFile(sf,SOUL+'\nA new line.\n');await assert.rejects(a.G.accept('sales',[p.sections[0].id]),/changed since/);
 assert.equal(await readFile(sf,'utf8'),SOUL+'\nA new line.\n');
 const b=await make({budget:1000,backend:false});const sb=path.join(b.H,'profiles','sales','SOUL.md');await w(sb,SOUL);const q=await b.G.propose('sales');
 await assert.rejects(b.G.accept('sales',[q.sections[0].id]),/free Gemini route is not available/);assert.equal(await readFile(sb,'utf8'),SOUL,'nothing moved');assert.ok(!await exists(path.join(b.H,'profiles','sales','reference')))});

test('a dismissed proposal is not shown again for the same instructions',async()=>{const t=await make({budget:1000});await w(path.join(t.H,'profiles','sales','SOUL.md'),SOUL);await t.G.propose('sales');
 assert.equal(await t.G.dismiss('sales'),true);assert.equal((await t.G.view()).agents.sales.proposal,null);await t.G.propose('sales');assert.equal((await t.G.view()).agents.sales.proposal,null)});

test('only the pilot agent is mapped until a person turns on the rest',async()=>{const t=await make({agents:['sesa','sales'],pilot:true});await w(path.join(t.root,'workspaces','sesa','s.md'),'# sesa doc\n');
 await t.G.tick();assert.equal(t.runs.length,1);assert.ok(t.runs[0].args[1].includes('sesa'));await t.G.tick();t.tick(7*3600e3);await t.G.tick();assert.equal(t.runs.length,1,'the other agent is not mapped');assert.equal((await t.G.view()).agents.sales.map.on,false);
 assert.deepEqual(await t.G.setEnabled({all:true}),{all:true,agents:['sesa']});await t.G.tick();assert.equal(t.runs.length,2,'now it is');assert.deepEqual((await t.G.view()).enabled.all,true)});

test('the free plan\'s limit pauses documents for 6 hours, code is still mapped, nothing is failed and no other route is tried',async()=>{const t=await make({quota:true});
 const r=await t.G.refresh('sales');assert.deepEqual(r,{skipped:'quota'});const m=(await t.G.view()).agents.sales.map;assert.notEqual(m.state,'failed');assert.match(m.notice,/limit was reached/);assert.equal(t.relays[0].stopped,true);
 t.tick(3600e3);const r2=await t.G.refresh('sales');assert.equal(r2.ok,true,'code is mapped meanwhile');assert.deepEqual(t.runs.at(-1).args,['extract',t.G.corpusOf('sales'),'--code-only']);assert.equal(t.relays.length,1,'no relay while paused');
 const files=(await walkAll(t.G.corpusOf('sales'))).filter(f=>!f.startsWith('graphify-out'));assert.ok(!files.includes('workspace/notes/guide.txt'),'documents were not staged during the pause');
 assert.ok(!(await t.G.view()).agents.sales.map.error)});

test('a model that is not Gemini, or the owner turning documents off, means code only',async()=>{
 const a=await make();await w(path.join(a.DATA,'agent-graph','model.json'),JSON.stringify({model:'claude-sonnet-5-5-low'}));await a.G.refresh('sales');assert.equal(a.relays.length,0);assert.deepEqual(a.runs[0].args,['extract',a.G.corpusOf('sales'),'--code-only']);
 const b=await make();await w(path.join(b.DATA,'agent-graph','model.json'),JSON.stringify({route:'none'}));await b.G.refresh('sales');assert.equal(b.relays.length,0);
 const c=await make();await w(path.join(c.DATA,'agent-graph','model.json'),JSON.stringify({model:'gemini-4-argon-low'}));await c.G.refresh('sales');assert.equal(c.runs[0].o.env.OPENAI_MODEL,'gemini-4-argon-low')});

test('documents already in the map stay when the model is away for a while',async()=>{const t=await make();await t.G.refresh('sales');
 await w(path.join(t.DATA,'agent-graph','model.json'),JSON.stringify({route:'none'}));t.tick(2*3600e3);await w(path.join(t.ws,'.tools','sync.py'),'def sync():\n    return 3\n');await t.G.refresh('sales');
 assert.ok(await exists(path.join(t.G.corpusOf('sales'),'workspace','notes','guide.txt')))});
