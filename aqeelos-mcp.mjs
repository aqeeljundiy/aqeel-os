#!/usr/bin/env node
// MCP server (stdio) that gives every coding run the person's aqeelOS: ask one of their agents to do something with
// its abilities (skills such as Google Sheets, connected apps such as n8n, Notion, Slack, GitHub, schedules, channels
// such as WhatsApp, knowledge and memory) and get the answer back. Relays to aqeelOS (AQ_BASE, AQ_TOKEN).
const BASE=process.env.AQ_BASE||'',TOKEN=process.env.AQ_TOKEN||'',PROJECT=process.env.AQ_PROJECT||'';
const TOOLS=[
 {name:'aqeelos_agents',description:'List the person\'s aqeelOS agents you can ask, with what each is for and which apps it has (Google Sheets, n8n, Notion, Slack, WhatsApp…).',inputSchema:{type:'object',properties:{}}},
 {name:'aqeelos_ask',description:'Ask one of the person\'s aqeelOS agents to do or find something with its own abilities, and get its answer. Use it for anything outside this project folder: read or update a Google Sheet, run or build an n8n workflow, send a WhatsApp or Slack message, set up a schedule, look something up in Notion or memory. Say exactly what you need back (for example "the product list as JSON with name, price, image").',inputSchema:{type:'object',properties:{agent:{type:'string',description:'Agent id from aqeelos_agents (default: the project\'s agent)'},task:{type:'string',description:'What the agent should do or find, in plain words'}},required:['task']}}];
async function call(p,body){const r=await fetch(BASE+p,{method:body?'POST':'GET',headers:{authorization:'Bearer '+TOKEN,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(600000)});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||('aqeelOS answered '+r.status));return j}
async function run(name,a){
 if(name==='aqeelos_agents'){const j=await call('/ui/code/agents');return JSON.stringify(j.agents||[],null,1)}
 if(name==='aqeelos_ask'){const j=await call('/ui/code/ask',{agent:a.agent||'',task:a.task,project:PROJECT});return (j.agentName?j.agentName+': ':'')+(j.text||'(no answer)')}
 throw Error('Unknown tool '+name)}
let buffer='';const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
process.stdin.on('data',async d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line)continue;let m;try{m=JSON.parse(line)}catch{continue}
 if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'aqeelos',version:'0.1.0'}}});
 else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools:TOOLS}});
 else if(m.method==='tools/call'){try{const out=await run(m.params.name,m.params.arguments||{});send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:out}]}})}catch(e){send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'Error: '+e.message}],isError:true}})}}
 else if(m.method==='ping')send({jsonrpc:'2.0',id:m.id,result:{}});
 else if(m.id!==undefined)send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});
}});
process.stdin.on('end',()=>process.exit(0));
