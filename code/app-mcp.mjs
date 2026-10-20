#!/usr/bin/env node
// MCP server (stdio) with the app's own tools, the same for Claude and GPT: open an output in the Artifacts panel,
// end a turn with the next-step box, and read the project's design system. Relays to the app (CBA_URL, CBA_TOKEN, CBA_RUN).
const BASE=(process.env.CBA_URL||'http://127.0.0.1:4321')+'/api/workspace/app-tool',TOKEN=process.env.CBA_TOKEN||'',RUN=process.env.CBA_RUN||'';
const TOOLS=[
 {name:'show_output',description:'Open an output (a folder under outputs/) in the user\'s Artifacts panel. Call it as soon as the first version of the file exists; the panel then refreshes live while you keep writing.',inputSchema:{type:'object',properties:{slug:{type:'string',description:'Folder name under outputs/, for example "investor-pitch"'}},required:['slug']}},
 {name:'next_steps',description:'Finish your turn with a short recap and up to two one-click next actions for the user. Call it once, at the very end.',inputSchema:{type:'object',properties:{recap:{type:'string',description:'One or two sentences: what is now true, and what is not done or not checked.'},actions:{type:'array',maxItems:2,items:{type:'object',properties:{label:{type:'string',description:'Button text, 1 to 4 words'},message:{type:'string',description:'What clicking it sends to you'}},required:['label','message']}}},required:['recap']}},
 {name:'chapter',description:'Mark the start of a new chapter in a long chat (a new phase of work, such as moving from research to writing). Use sparingly.',inputSchema:{type:'object',properties:{title:{type:'string',description:'A short noun phrase, under 40 characters'}},required:['title']}},
 {name:'remember',description:'Save a lasting fact or preference to the user\'s memory, so later chats know it (for example "Prefers Bahasa Indonesia for client documents"). Never save secrets.',inputSchema:{type:'object',properties:{fact:{type:'string',description:'One short sentence'},scope:{type:'string',enum:['project','global'],description:'project (default) or global (about the user, for every project)'}},required:['fact']}},
 {name:'save_design_system',description:'Save a design system you worked out (from a brand guide, images, a website or code) and make this project use it.',inputSchema:{type:'object',properties:{name:{type:'string'},colors:{type:'object',description:'Hex colours: bg, surface, ink, muted, accent, accent2, onAccent',properties:{bg:{type:'string'},surface:{type:'string'},ink:{type:'string'},muted:{type:'string'},accent:{type:'string'},accent2:{type:'string'},onAccent:{type:'string'}}},fonts:{type:'object',properties:{heading:{type:'string'},body:{type:'string'}}},radius:{type:'number'},voice:{type:'string'}},required:['name','colors']}},
 {name:'design_system',description:'Get the project\'s design system (colours, fonts, corner radius, tone of voice) to follow in what you make.',inputSchema:{type:'object',properties:{}}},
];
async function call(op,body){const r=await fetch(BASE,{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':TOKEN},body:JSON.stringify({...body,op,run:RUN})});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'The app did not respond.');return data}
async function run(name,a){
 if(name==='show_output'){const r=await call('show',{slug:a.slug});return 'Opened "'+r.title+'" in the Artifacts panel.'}
 if(name==='next_steps'){await call('next',{recap:a.recap,actions:a.actions||[]});return 'Shown to the user. End your turn now.'}
 if(name==='chapter'){await call('chapter',{title:a.title});return 'Chapter marked.'}
 if(name==='remember'){await call('remember',{fact:a.fact,scope:a.scope});return 'Saved to memory.'}
 if(name==='save_design_system'){const r=await call('save-ds',{designSystem:a});return 'Saved "'+r.name+'" and set it for this project.'}
 if(name==='design_system'){const r=await call('ds',{});return JSON.stringify(r.designSystem)}
 throw Error('Unknown tool '+name)}
let buffer='';const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
process.stdin.on('data',async d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line)continue;let m;try{m=JSON.parse(line)}catch{continue}
 if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'code-by-aqeel-app',version:'0.1.0'}}});
 else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools:TOOLS}});
 else if(m.method==='tools/call'){try{const out=await run(m.params.name,m.params.arguments||{});send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:out}]}})}catch(e){send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'Error: '+e.message}],isError:true}})}}
 else if(m.method==='ping')send({jsonrpc:'2.0',id:m.id,result:{}});
 else if(m.id!==undefined)send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});
}});
process.stdin.on('end',()=>process.exit(0));
