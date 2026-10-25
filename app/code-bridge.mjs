// The code bridge (25 Oct 2026): every aqeelOS model works for Code projects on a person's own computer. The turn runs
// on the engine here like any Code engine run (the agent's model and account, the Models page's priority list and
// auto-switch); the engine reaches the project only through this MCP server ("aqeelos-code", one signed address per
// agent like aqeelos-notify, from this box only), and each call is relayed over the link the desktop app already keeps
// (its long-poll, app/code.mjs) to that computer, which does it in the run's folder with the run's permission mode
// (code/bridge.mjs). No account key ever goes to a computer.
// One way stays: a call counts only when the engine announced that very call (tool.started, same tool and arguments)
// in the event stream of a Code run bound to it here, so the same agent chatting on WhatsApp or anywhere else is told
// "not available outside a Code run". The computer checks again that the run is its own and still going. Every call is
// logged with the person, the computer and the project (data/code-bridge.jsonl, shown to admins under System › Usage).
import {readFile,appendFile,mkdir} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import path from 'node:path';

const P={type:'string',description:'A path in the project, relative to its folder (for example src/app.js); "." is the project folder'};
export const TOOLS=[
 {name:'project_read',description:'Read a text file of the Code project (on the person\'s computer). Gives the text with line numbers; offset and limit pick lines in a long file.',inputSchema:{type:'object',properties:{path:P,offset:{type:'number',description:'First line, from 1'},limit:{type:'number',description:'How many lines'}},required:['path']},annotations:{readOnlyHint:true}},
 {name:'project_list',description:'List a folder of the Code project: folders end with /, files show their size. depth 1 to 4 (default 2). node_modules, .git and build folders are named but not opened.',inputSchema:{type:'object',properties:{path:P,depth:{type:'number'}}},annotations:{readOnlyHint:true}},
 {name:'project_search',description:'Search the text files of the Code project for a word or a regular expression; gives file:line: text for each match.',inputSchema:{type:'object',properties:{pattern:{type:'string'},path:P,glob:{type:'string',description:'Only files whose name matches, e.g. *.css'},regex:{type:'boolean',description:'Treat pattern as a regular expression'}},required:['pattern']},annotations:{readOnlyHint:true}},
 {name:'project_write',description:'Write a whole file in the Code project (made with its folders when new, replaced when it is there). Use project_edit for a small change to a file that exists.',inputSchema:{type:'object',properties:{path:P,content:{type:'string'}},required:['path','content']}},
 {name:'project_edit',description:'Change part of a file in the Code project: old_text (exactly as in the file, once, unless replace_all) becomes new_text.',inputSchema:{type:'object',properties:{path:P,old_text:{type:'string'},new_text:{type:'string'},replace_all:{type:'boolean'}},required:['path','old_text','new_text']}},
 {name:'project_run',description:'Run a command in the Code project\'s folder on the person\'s computer (their shell; it says which in the run\'s note) and get its output and exit code. timeout_s up to 270 (default 120). For a dev server, start it in the background and return.',inputSchema:{type:'object',properties:{command:{type:'string'},timeout_s:{type:'number'}},required:['command']}}];
const NAMES=TOOLS.map(t=>t.name),READ=['project_read','project_list','project_search'];
const OUTSIDE='Not available outside a Code run. These tools work only while aqeelOS Code runs a turn for a project on the person\'s computer, and only in that turn.';
// the tool a name in the engine's events stands for (it adds its own prefix, e.g. mcp_aqeelos_code_project_read)
const toolOf=n=>{const m=/(?:^|_)(project_(?:read|list|search|write|edit|run))$/.exec(String(n||''));return m?m[1]:''};
// one call's arguments as a fixed string (keys sorted, plain values as text, so a number sent as "3" still matches)
const fp=a=>{if(!a||typeof a!=='object')return '';return Object.keys(a).sort().map(k=>k+'='+(a[k]!==null&&typeof a[k]==='object'?JSON.stringify(a[k]):String(a[k]))).join('\u0001')};
const main=a=>String(a?.path??a?.command??a?.pattern??'');

export function createCodeBridge({PORT,DATA,sign,code,mayUse,workspaces,access}){
 const sig=a=>sign('code-bridge:'+a).slice(0,32);
 const url=a=>`http://127.0.0.1:${PORT}/mcp/code/${a}/${sig(a)}`;
 // the agent's engine config gets the bridge once (y: its config.yaml as it is; mcp: the engine's own MCP route)
 async function ensure(a,y,mcp){const u=url(a);if(!y||y.includes(u))return false;if(/^\s*aqeelos-code:/m.test(y))await mcp(a,'DELETE','/aqeelos-code');await mcp(a,'POST','',{name:'aqeelos-code',url:u});return true}

 /* A binding: one Code turn for a computer project (agent, person, computer, project, mode, and the id the computer gave
    its run), from when aqeelOS starts it on the engine to when it ends. seen: the bridge calls the engine announced in
    that turn's own event stream; each one may be used once (a read again while it is not finished, as the engine
    retries a read after a dropped connection). */
 const binds=new Map(),waits=new Set();
 function bind(b){const id=randomBytes(9).toString('hex');binds.set(id,{...b,seen:[],t:Date.now()});return id}
 function unbind(id){binds.delete(id);for(const w of waits)w()}
 function event(id,type,d){const b=binds.get(id);if(!b)return;const t=toolOf(d?.tool_name);if(!t)return;
  if(type==='tool.started'){b.seen.push({tool:t,fp:fp(d.args),main:main(d.args),used:false,done:false,t:Date.now()});if(b.seen.length>300)b.seen.splice(0,150);for(const w of waits)w()}
  else if(type==='tool.completed'||type==='tool.failed'){const s=b.seen.find(x=>x.tool===t&&!x.done&&x.used);if(s)s.done=true}}
 // the binding whose stream announced this call (exact arguments first, then the same path or command within a minute)
 function match(agent,tool,args){const f=fp(args),m=main(args);let hit=null;
  for(const b of binds.values()){if(b.agent!==agent)continue;const s=b.seen.find(x=>x.tool===tool&&x.fp===f&&(!x.used||READ.includes(tool)&&!x.done));if(s)return {b,s};
   if(!hit){const s2=b.seen.find(x=>x.tool===tool&&!x.used&&x.main===m&&Date.now()-x.t<60e3);if(s2)hit={b,s:s2}}}return hit}
 // the engine may make the call a moment before its announcement reaches us: wait for it a little
 function waitMatch(agent,tool,args,ms){return new Promise(res=>{let t=null;const w=()=>{const m=match(agent,tool,args);if(m||!t){waits.delete(w);clearTimeout(t);res(m)}};t=setTimeout(()=>{t=null;w()},ms);waits.add(w)})}

 // calls relayed to a computer: answered by it on /ui/code/bridge-done (dev: the computer that answers)
 const jobs=new Map();
 function relay(b,tool,args){const id='b'+randomBytes(9).toString('hex'),ms=READ.includes(tool)?60e3:290e3;
  if(Date.now()-code.seen(b.dev)>75e3)return Promise.resolve({state:'failed',text:'Code on '+b.devName+' is not connected right now (the link dropped), so this could not be done. Tell the person to check that Code is open on that computer.'});
  return new Promise(res=>{const t=setTimeout(()=>{if(jobs.delete(id))res({state:'failed',text:'Code on '+b.devName+' did not answer in time (the link may have dropped). Nothing is known about whether it was done; check before trying again.'})},ms);t.unref?.();
   jobs.set(id,{dev:b.dev,res:r=>{clearTimeout(t);res(r)}});
   if(!code.push(b.dev,{id,kind:'bridge',run:b.bridge,tool,args},()=>jobs.has(id))){jobs.delete(id);clearTimeout(t);res({state:'failed',text:'Code on '+b.devName+' is not connected right now.'})}})}
 function done(dev,r){const j=jobs.get(String(r?.id||''));if(!j||j.dev!==dev.key)return false;jobs.delete(String(r.id));j.res({state:r.state==='done'?'done':'failed',text:String(r.text??'').slice(0,400e3)});return true}

 // every call, kept for admins (System › Usage) and in the server log
 const LOG=path.join(DATA,'code-bridge.jsonl');
 async function log(x){const line={time:Date.now(),...x,what:String(x.what||'').slice(0,200)};console.log('code bridge: '+x.agent+' '+x.tool+' '+line.what.slice(0,80)+(x.device?' from Code on '+x.device:' (no Code run)')+(x.ok?'':' (refused: '+String(x.note||'').slice(0,80)+')'));
  await mkdir(DATA,{recursive:true}).catch(()=>{});await appendFile(LOG,JSON.stringify(line)+'\n').catch(()=>{})}
 async function recent(n=40){const t=await readFile(LOG,'utf8').catch(()=>'');return t.trim().split('\n').slice(-n).reverse().map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean)}

 // the MCP server itself (POST /mcp/code/<agent>/<signature>, from this box only)
 async function handle(req,res,{send,readBody}){const mm=/^\/mcp\/code\/([\w-]+)\/([\w-]+)$/.exec(new URL(req.url,'http://x').pathname);if(!mm)return false;
  if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress||''))return send(res,403,'local only'),true;if(req.method!=='POST')return send(res,405,'POST only'),true;
  const a=mm[1],x=Buffer.from(mm[2]),y=Buffer.from(sig(a));if(x.length!==y.length||!timingSafeEqual(x,y))return send(res,403,{error:'bad token'}),true;
  let msg={};try{msg=JSON.parse(await readBody(req,8e6))}catch{return send(res,400,{error:'bad json'}),true}
  const reply=result=>send(res,200,{jsonrpc:'2.0',id:msg.id,result}),text=(t,isError)=>reply({content:[{type:'text',text:t}],...(isError?{isError:true}:{})});
  if(msg.method==='initialize')return reply({protocolVersion:msg.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'aqeelos-code',version:'1.0.0'}}),true;
  if(msg.id==null){res.writeHead(202);res.end();return true}
  if(msg.method==='ping')return reply({}),true;
  // always listed (the engine keeps the list it read first); they answer only inside a bound Code turn
  if(msg.method==='tools/list')return reply({tools:TOOLS.map(t=>({...t,description:'Only in an aqeelOS Code run for a project on the person\'s computer. '+t.description}))}),true;
  if(msg.method!=='tools/call')return send(res,200,{jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}}),true;
  const tool=String(msg.params?.name||''),args=msg.params?.arguments&&typeof msg.params.arguments==='object'?msg.params.arguments:{};
  if(!NAMES.includes(tool))return text('Unknown tool.',true),true;
  let m=[...binds.values()].some(b=>b.agent===a)?match(a,tool,args)||await waitMatch(a,tool,args,8000):null;
  if(!m){await log({agent:a,tool,what:main(args),ok:false,note:'outside a Code run'});return text(OUTSIDE,true),true}
  m.s.used=true;const b=m.b,base={agent:a,user:b.user,device:b.devName,project:b.project,tool,what:main(args)};
  if(!mayUse(b.user,a)){await log({...base,ok:false,note:'no access to the agent'});return text('The person who started this run may not use this agent any more.',true),true}
  if(b.mode==='plan'&&!READ.includes(tool)){await log({...base,ok:false,note:'Plan only'});return text('Plan only: nothing is changed or run in this turn. Read what you need, then propose the change in your plan.',true),true}
  const t0=Date.now(),r=await relay(b,tool,args);await log({...base,ok:r.state==='done',ms:Date.now()-t0,...(r.state==='done'?{}:{note:r.text.slice(0,120)})});
  return text(r.text||'(nothing)',r.state!=='done'),true}

 /* Where the engine's chat for a computer project starts on the box: an empty folder of the agent's own, one per person
    and project, kept (the next turn goes on in the same chat). The project is not in it; the run's note says so. */
 async function room(a,user,project){const dir=path.join(workspaces(a),'code-computer',(String(user)+'-'+String(project||'project')).toLowerCase().replace(/[^a-z0-9-]+/g,'-').slice(0,80));
  await mkdir(dir,{recursive:true,mode:0o770});await access?.(a,dir).catch(()=>{});return dir}

 return {url,ensure,bind,unbind,event,done,handle,recent,room,TOOLS}}
