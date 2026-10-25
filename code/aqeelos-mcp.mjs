#!/usr/bin/env node
// MCP server (stdio) that gives a coding run the aqeelOS agents attached to it (25 Oct 2026: Code uses agents, one
// way). The coding model asks them to fetch or do things with their own access (Google Docs, Drive and Gmail, Slack,
// Notion, n8n, WhatsApp, schedules, memory) and gets their answers back; it may ask several at once. Files in an answer
// are saved in the project (from-agents/<agent>/, or a folder the model names), never outside it, and not in Plan
// only. Only the attached agents can be asked: aqeelOS checks the run's ticket (AQ_TICKET) on every ask.
import {readFileSync} from 'node:fs';
import {mkdir,writeFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
const BASE=process.env.AQ_BASE||'',TOKEN=process.env.AQ_TOKEN||'',PROJECT=process.env.AQ_PROJECT||'',TICKET=process.env.AQ_TICKET||'',DIR=process.env.AQ_DIR||'',PLAN=process.env.AQ_PLAN==='1';
let AGENTS=[];try{AGENTS=JSON.parse(process.env.AQ_AGENTS||'[]').filter(a=>a&&typeof a.id==='string')}catch{}
const names=AGENTS.map(a=>a.name+' ('+a.id+')').join(', ');
const TOOLS=[
 {name:'aqeelos_agents',description:'List the aqeelOS agents attached to this run (only these can be asked), with what each is for and which apps it has.',inputSchema:{type:'object',properties:{}}},
 {name:'aqeelos_ask',description:'Ask one of the agents attached to this run ('+(names||'none')+') to fetch or do something with its own access, and get its answer: read a Google Doc or Sheet, find a file in Drive or Gmail, look something up in Slack or Notion, run an n8n workflow, send a WhatsApp message. Say exactly what you need back (for example "the product list as JSON with name, price, image", or "export the brief as a .docx file"). Files it returns are saved in the project. Ask several agents at once when the task needs them.',inputSchema:{type:'object',properties:{agent:{type:'string',enum:AGENTS.map(a=>a.id),description:'The attached agent to ask'},task:{type:'string',description:'What the agent should do or find, in plain words, and what to send back'},save_to:{type:'string',description:'Optional folder inside the project for its files, e.g. assets/images (default from-agents/<agent>)'}},required:['agent','task']}}];
// Code online: who the run is for (x-aq-act, a few minutes); Code keeps the person's newest note in AQ_ACT_FILE, read on every call
const act=()=>{let a='';try{if(process.env.AQ_ACT_FILE)a=readFileSync(process.env.AQ_ACT_FILE,'utf8').trim()}catch{}const exp=s=>Number(String(s||'').split('.')[1])||0;const e=process.env.AQ_ACT||'';return exp(a)>=exp(e)?a:e};
async function call(p,body){const a=act();const r=await fetch(BASE+p,{method:body?'POST':'GET',headers:{authorization:'Bearer '+TOKEN,'content-type':'application/json',...(a?{'x-aq-act':a}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(900000)});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||('aqeelOS answered '+r.status));return j}
// a file name and a folder inside the project, as they are saved (the same rules as aqeelOS: app/code-agents.mjs)
const safeName=n=>{const b=String(n||'').split(/[\\/]/).pop().normalize('NFC').replace(/[^\p{L}\p{N} ._()-]+/gu,'_').replace(/^[.\s]+/,'').replace(/\s+/g,' ').trim().slice(0,100);return b&&b!=='.'&&b!=='..'?b:'file'};
const safeRel=p=>{const s=String(p||'').replace(/\\/g,'/').trim();if(!s)return '';if(/^\/|^[A-Za-z]:|(^|\/)\.\.(\/|$)|\0/.test(s))return null;const parts=s.split('/').filter(x=>x&&x!=='.').map(safeName);return parts.length&&parts.length<=8?parts.join('/'):null};
const FILES_MAX=12,FILE_MAX=20e6;
async function save(agentName,files,to){if(!DIR||!files?.length)return [];const rel=to?safeRel(to):'';if(rel===null)throw Error('Save files to a folder inside the project, for example from-agents or assets.');
 const root=await realpath(DIR),base=path.join(root,rel||path.join('from-agents',safeName(agentName).toLowerCase().replace(/\s+/g,'-')));await mkdir(base,{recursive:true});const real=await realpath(base);
 if(real!==root&&!real.startsWith(root+path.sep))throw Error('That folder is outside the project.');const saved=[];
 for(const f of files.slice(0,FILES_MAX)){const data=Buffer.from(String(f.data||''),'base64');if(!data.length||data.length>FILE_MAX)continue;const nm=safeName(f.name),x=path.extname(nm),stem=nm.slice(0,nm.length-x.length);let to2=path.join(real,nm);
  for(let i=2;await lstat(to2).then(()=>true,()=>false)&&i<100;i++)to2=path.join(real,stem+'-'+i+x);await writeFile(to2,data,{flag:'wx'});saved.push(path.relative(root,to2).split(path.sep).join('/'))}return saved}
async function run(name,a){
 if(name==='aqeelos_agents'){if(!AGENTS.length)return 'No agents are attached to this run. The person attaches them in the message box.';const j=await call('/ui/code/agents');const on=new Set(AGENTS.map(x=>x.id));return JSON.stringify((j.agents||[]).filter(x=>on.has(x.id)),null,1)}
 if(name==='aqeelos_ask'){const ag=String(a.agent||AGENTS[0]?.id||'');if(!AGENTS.some(x=>x.id===ag))throw Error('Only the agents attached to this run can be asked: '+(names||'none')+'.');if(a.save_to&&safeRel(a.save_to)===null)throw Error('Save files to a folder inside the project, for example from-agents or assets.');
  const j=await call('/ui/code/ask',{agent:ag,task:a.task,project:PROJECT,ticket:TICKET,plan:PLAN});const who=j.agentName||ag;let tail='';
  if(j.files?.length){if(PLAN)tail='\n\nIt had files ('+j.files.map(f=>f.name).join(', ')+'); they are not saved in Plan only.';else{const saved=await save(who,j.files,a.save_to);if(saved.length)tail='\n\nSaved in the project: '+saved.join(', ')}}
  return who+': '+(j.text||'(no answer)')+tail}
 throw Error('Unknown tool '+name)}
// each call runs on its own, so the model can ask several agents at once
let buffer='';const send=o=>process.stdout.write(JSON.stringify(o)+'\n');const pending=new Set();
function handle(m){
 if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'aqeelos',version:'0.2.0'}}});
 else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools:TOOLS}});
 else if(m.method==='tools/call'){const job=run(m.params?.name,m.params?.arguments||{}).then(out=>send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:out}]}}),e=>send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'Error: '+e.message}],isError:true}}));pending.add(job);job.finally(()=>pending.delete(job))}
 else if(m.method==='ping')send({jsonrpc:'2.0',id:m.id,result:{}});
 else if(m.id!==undefined)send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}})}
process.stdin.on('data',d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line)continue;let m;try{m=JSON.parse(line)}catch{continue}handle(m)}});
// the client closed: finish what was asked, then stop
process.stdin.on('end',async()=>{await Promise.allSettled([...pending]);process.exit(0)});
