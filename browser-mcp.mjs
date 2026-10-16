#!/usr/bin/env node
// MCP server (stdio) that gives Claude and Codex the same side browser. Each tool relays to the
// running app (CBA_URL + CBA_TOKEN), so every action shows up live in the app's Browser tab.
const BASE=(process.env.CBA_URL||'http://127.0.0.1:4321')+'/api/workspace/browser',TOKEN=process.env.CBA_TOKEN||'';

const TOOLS=[
 {name:'browser_open',description:'Open a URL (or search the web) in the shared side browser. Returns the page title and URL.',inputSchema:{type:'object',properties:{url:{type:'string',description:'Address, domain or search text'}},required:['url']}},
 {name:'browser_snapshot',description:'List visible interactive elements with numbered refs. Use the refs with browser_click and browser_type. Take a new snapshot after the page changes.',inputSchema:{type:'object',properties:{}}},
 {name:'browser_click',description:'Click the element with this ref from the latest snapshot.',inputSchema:{type:'object',properties:{ref:{type:'integer'}},required:['ref']}},
 {name:'browser_type',description:'Type text into the element with this ref (it is focused and its text selected first). Set submit to press Enter afterwards.',inputSchema:{type:'object',properties:{ref:{type:'integer'},text:{type:'string'},submit:{type:'boolean'}},required:['ref','text']}},
 {name:'browser_press',description:'Press a key: Enter, Tab, Escape, Backspace, ArrowUp, ArrowDown, PageDown, PageUp, Home, End.',inputSchema:{type:'object',properties:{key:{type:'string'}},required:['key']}},
 {name:'browser_scroll',description:'Scroll the page up or down.',inputSchema:{type:'object',properties:{direction:{type:'string',enum:['up','down']},amount:{type:'integer',description:'Pixels, default 600'}},required:['direction']}},
 {name:'browser_back',description:'Go back to the previous page.',inputSchema:{type:'object',properties:{}}},
 {name:'browser_read',description:'Read the visible text of the current page (up to 20,000 characters).',inputSchema:{type:'object',properties:{}}},
 {name:'browser_viewport',description:'Change the screen size the page is rendered at (to check responsive layouts) and/or the page colour scheme.',inputSchema:{type:'object',properties:{preset:{type:'string',enum:['desktop','laptop','tablet','mobile']},rotate:{type:'boolean'},scheme:{type:'string',enum:['light','dark','system']}}}},
 {name:'browser_tabs',description:'List, open, switch or close side browser tabs. action: list | new (optional url) | switch (id) | close (id).',inputSchema:{type:'object',properties:{action:{type:'string',enum:['list','new','switch','close']},id:{type:'string'},url:{type:'string'}},required:['action']}},
 {name:'browser_screenshot',description:'Take a screenshot of the current page.',inputSchema:{type:'object',properties:{}}},
];

async function call(route,body){const r=await fetch(BASE+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Local-Token':TOKEN},...(body?{body:JSON.stringify({...body,by:'ai'})}:{})});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'The app did not respond.');return data}
const page=s=>`Page: ${s.title||'(untitled)'}\nURL: ${s.url}`;

async function run(name,a){
 if(name==='browser_open')return page(await call('/navigate',{url:a.url}));
 if(name==='browser_snapshot'){const s=await call('/snapshot');return page(s)+'\n\nInteractive elements (ref | role | name):\n'+(s.elements.join('\n')||'(none visible — try browser_scroll or browser_read)')}
 if(name==='browser_click')return 'Clicked.\n'+page(await call('/click',{ref:a.ref}));
 if(name==='browser_type'){let s=await call('/type',{ref:a.ref,text:a.text});if(a.submit)s=await call('/key',{key:'Enter'});return 'Typed.\n'+page(s)}
 if(name==='browser_press')return 'Pressed '+a.key+'.\n'+page(await call('/key',{key:a.key}));
 if(name==='browser_scroll'){const n=Number(a.amount)||600;return 'Scrolled.\n'+page(await call('/scroll',{dx:0,dy:a.direction==='up'?-n:n}))}
 if(name==='browser_back')return page(await call('/back',{}));
 if(name==='browser_read'){const t=await call('/text');return page(t)+'\n\n'+t.text}
 if(name==='browser_viewport'){const s=await call('/view',{preset:a.preset,rotate:a.rotate,scheme:a.scheme});return 'Screen '+s.width+'×'+s.height+' ('+s.preset+'), '+s.scheme+' colour scheme.\n'+page(s)}
 if(name==='browser_tabs'){const s=a.action==='list'?await call('/status'):await call('/tab',a.action==='new'?{url:a.url}:{id:a.id,close:a.action==='close'});return 'Tabs:\n'+(s.tabs||[]).map(t=>(t.id===s.tab?'* ':'  ')+t.id+' | '+(t.title||'(untitled)')+' | '+t.url).join('\n')}
 if(name==='browser_screenshot'){const s=await call('/screenshot');return [{type:'image',data:s.data,mimeType:'image/jpeg'}]}
 throw Error('Unknown tool '+name);
}

let buffer='';const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
process.stdin.on('data',async d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line)continue;let m;try{m=JSON.parse(line)}catch{continue}
 if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'code-by-aqeel-browser',version:'0.1.0'}}});
 else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools:TOOLS}});
 else if(m.method==='tools/call'){try{const out=await run(m.params.name,m.params.arguments||{});send({jsonrpc:'2.0',id:m.id,result:{content:typeof out==='string'?[{type:'text',text:out}]:out}})}catch(e){send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'Error: '+e.message}],isError:true}})}}
 else if(m.method==='ping')send({jsonrpc:'2.0',id:m.id,result:{}});
 else if(m.id!==undefined)send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});
}});
process.stdin.on('end',()=>process.exit(0));
