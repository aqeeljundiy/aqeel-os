#!/usr/bin/env node
// MCP server (stdio) for computer use. Each tool relays to the running app (CBA_URL + CBA_TOKEN + CBA_RUN), which
// asks the user before an AI may control each app and shows every action in the run's timeline.
const BASE=(process.env.CBA_URL||'http://127.0.0.1:4321')+'/api/workspace/desktop',TOKEN=process.env.CBA_TOKEN||'',RUN=process.env.CBA_RUN||'';

const app={type:'integer',description:'The app\'s id (pid) from desktop_apps'};
const TOOLS=[
 {name:'desktop_apps',description:'List the open app windows on the user\'s computer (id, app name, window title) and whether each is already allowed. Use the browser_* tools for websites instead.',inputSchema:{type:'object',properties:{}}},
 {name:'desktop_screenshot',description:'Bring an app to the front and take a screenshot of its window. The first action on an app asks the user for permission. Coordinates for click and scroll are pixels in this screenshot.',inputSchema:{type:'object',properties:{app},required:['app']}},
 {name:'desktop_click',description:'Click at x,y (pixels in the latest screenshot of that app).',inputSchema:{type:'object',properties:{app,x:{type:'integer'},y:{type:'integer'},button:{type:'string',enum:['left','right']},double:{type:'boolean'}},required:['app','x','y']}},
 {name:'desktop_type',description:'Type text into the focused field of the app. Never type passwords or payment details.',inputSchema:{type:'object',properties:{app,text:{type:'string'}},required:['app','text']}},
 {name:'desktop_key',description:'Press a key or shortcut in the app, like enter, tab, escape, ctrl+s, alt+f4, cmd+s (Mac).',inputSchema:{type:'object',properties:{app,keys:{type:'string'}},required:['app','keys']}},
 {name:'desktop_scroll',description:'Scroll at x,y in the app; positive clicks scroll down.',inputSchema:{type:'object',properties:{app,x:{type:'integer'},y:{type:'integer'},clicks:{type:'integer'}},required:['app','x','y','clicks']}},
];

async function call(route,body){const r=await fetch(BASE+route,{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':TOKEN},body:JSON.stringify({...body,run:RUN})});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'The app did not respond.');return data}

async function run(name,a){
 if(name==='desktop_apps'){const {apps}=await call('/apps',{});return apps.length?'Open apps (id | app | window | allowed):\n'+apps.map(x=>x.pid+' | '+x.name+' | '+x.title+' | '+(x.allowed?'yes':'ask first')).join('\n'):'No app windows are open.'}
 if(name==='desktop_screenshot'){const s=await call('/screenshot',{app:a.app});return [{type:'text',text:'Screenshot of '+s.name+' ('+s.width+'×'+s.height+').'},{type:'image',data:s.png,mimeType:'image/png'}]}
 if(name==='desktop_click'){await call('/click',{app:a.app,x:a.x,y:a.y,button:a.button,double:a.double});return 'Clicked. Take a screenshot to see the result.'}
 if(name==='desktop_type'){await call('/type',{app:a.app,text:a.text});return 'Typed.'}
 if(name==='desktop_key'){await call('/key',{app:a.app,keys:a.keys});return 'Pressed '+a.keys+'.'}
 if(name==='desktop_scroll'){await call('/scroll',{app:a.app,x:a.x,y:a.y,clicks:a.clicks});return 'Scrolled.'}
 throw Error('Unknown tool '+name);
}

let buffer='';const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
process.stdin.on('data',async d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line)continue;let m;try{m=JSON.parse(line)}catch{continue}
 if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'code-by-aqeel-desktop',version:'0.1.0'}}});
 else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools:TOOLS}});
 else if(m.method==='tools/call'){try{const out=await run(m.params.name,m.params.arguments||{});send({jsonrpc:'2.0',id:m.id,result:{content:typeof out==='string'?[{type:'text',text:out}]:out}})}catch(e){send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'Error: '+e.message}],isError:true}})}}
 else if(m.method==='ping')send({jsonrpc:'2.0',id:m.id,result:{}});
 else if(m.id!==undefined)send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});
}});
process.stdin.on('end',()=>process.exit(0));
