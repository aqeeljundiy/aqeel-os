// "aqeelOS models": a run that the aqeelOS engine does for an agent (the box's own Code copy only). aqeelOS runs the
// turn like a chat message (the agent's model and account, the Models page's priority list and auto-switch, any
// provider, the agent's own tools) in the project's folder on the box, and streams the engine's events, which are
// turned here into the same timeline the CLI engines give (agent.mjs): message, thinking, command, file, tool,
// approval, error. Stop and approvals go back to aqeelOS by the handle it sends first.
import {readFile} from 'node:fs/promises';

// a tool call as Code shows it: a command, a file change, or another tool
const COMMAND=/^(terminal|shell|bash|run_command|execute_command|exec|process)$/i,FILE=/^(write_file|patch|apply_patch|edit_file|create_file|str_replace|replace_in_file|multi_edit)$/i;
const clip=(s,n=20000)=>{s=String(s??'');return s.length>n?'…'+s.slice(-n):s};
const outText=v=>typeof v==='string'?v:v==null?'':Array.isArray(v)?v.map(x=>x?.text??(typeof x==='string'?x:JSON.stringify(x))).join('\n'):v.output??v.stdout??v.text??JSON.stringify(v);
const contentText=c=>typeof c==='string'?c:Array.isArray(c)?c.map(p=>p?.text||'').join(''):'';
// Code's decisions → the engine's choices (chat.js sends the same)
const CHOICE={accept:'once',acceptForSession:'session',decline:'deny'};

// one SSE stream, event by event ({type, ...data}), as chat.js reads it
async function readSSE(body,on){const dec=new TextDecoder();let buf='';
 for await(const c of body){buf+=dec.decode(c,{stream:true});let i;
  while((i=buf.search(/\r?\n\r?\n/))>=0){const raw=buf.slice(0,i);buf=buf.slice(i).replace(/^\r?\n\r?\n/,'');let ev='message',data='';
   for(const line of raw.split(/\r?\n/)){if(line.startsWith(':'))continue;if(line.startsWith('event:'))ev=line.slice(6).trim();else if(line.startsWith('data:'))data+=line.slice(5).trimStart()}
   if(!data)continue;let d;try{d=JSON.parse(data)}catch{d={text:data}}on({...d,type:d.type||ev})}}}

export function runEngine(run,{aqeelos,act,path:dir,prompt,session,onSession}){return new Promise(async resolve=>{
 const ctl=new AbortController();let done=false,handle='',msg=null,think=null,finalText='',all='',completed=false,failure='';const steps=[];
 const finish=(state,error)=>{if(done)return;done=true;run.denyAll();if(error&&state==='failed')run.emit({type:'error',text:error});if(msg)run.update(msg,{final:true});ctl.abort();resolve({state,error:error||null,text:finalText||all.trim()})};
 run.stop=async()=>{run.stopped=true;run.denyAll();if(handle)await aqeelos.engine('stop',{handle},act).catch(()=>{});setTimeout(()=>finish('stopped'),15000).unref?.()};
 const say=t=>{if(!t)return;think=null;all+=t;if(!msg)msg=run.emit({type:'message',text:'',final:false});run.update(msg,{text:msg.text+t})};
 const on=e=>{switch(e.type){
  case 'aqeelos.code':handle=e.handle;if(e.session)onSession?.(e.session);run.engineInfo={agent:e.agent,agentName:e.agentName,provider:e.provider,model:e.model,account:e.account};if(e.account)run.account=e.account+' (aqeelOS Models)';break;
  case 'run.started':if(e.runtime?.model)run.actualModel=e.runtime.model;if(e.runtime?.provider)run.engineInfo={...run.engineInfo,provider:e.runtime.provider};break;
  case 'assistant.delta':say(e.delta||e.text||'');break;
  case 'assistant.commentary':if(!e.already_streamed&&e.text)say((msg?.text?'\n\n':'')+e.text);break;
  case 'reasoning.delta':case 'assistant.reasoning':{const t=e.delta||e.text||'';if(!t)break;if(!think)think=run.emit({type:'thinking',text:''});run.update(think,{text:clip(think.text+t,6000)});break}
  case 'tool.progress':if(e.tool_name==='_thinking'&&e.delta){if(!think)think=run.emit({type:'thinking',text:''});run.update(think,{text:clip(think.text+e.delta,6000)})}break;
  case 'tool.started':{if(msg){run.update(msg,{final:false});msg=null}think=null;const n=String(e.tool_name||'tool'),a=e.args||{};
   const ev=COMMAND.test(n)?run.emit({type:'command',command:String(a.command||a.cmd||e.preview||''),status:'running',output:''})
    :FILE.test(n)?run.emit({type:'file',paths:[String(a.path||a.file_path||a.file||e.preview||'')].filter(Boolean),status:'running'})
    :run.emit({type:'tool',name:n.replace(/^mcp_/,'').replace(/_/g,' '),detail:String(e.preview||JSON.stringify(a)).slice(0,300),status:'running'});
   steps.push({ev,name:n});break}
  case 'tool.completed':case 'tool.failed':{const i=steps.map(s=>s.name===e.tool_name).lastIndexOf(true),s=steps.splice(i>=0?i:steps.length-1,1)[0];if(!s)break;
   run.update(s.ev,{status:e.type==='tool.failed'?'failed':'completed',...(s.ev.type==='command'?{output:clip(outText(e.result??e.output))}:{})});break}
  case 'approval.request':{const rid=e.request_id,choices=e.choices||['once','deny'];
   const answer=d=>{const c=CHOICE[d]||'deny';aqeelos.engine('approval',{handle,choice:choices.includes(c)?c:c==='session'?'once':c,...(rid?{request_id:rid}:{})},act).catch(er=>run.emit({type:'error',text:'The answer did not reach the engine: '+er.message}))};
   // Full access: no prompts (blocked commands stay blocked on the engine), as Allow all in the chat
   if(run.mode==='full'){answer('acceptForSession');break}
   const ev=run.ask('command',e.title||e.description||e.reason||'Allow this command?',String(e.command||e.description||'(command)'),answer);const pe=run.pending.get(ev.key);if(pe)pe.rid=rid||'';break}
  // only the approval that was answered (by request id; none given: the engine has one at a time, so every open one)
  case 'approval.responded':for(const [k,p] of run.pending)if(!p.question&&(!e.request_id||!p.rid||p.rid===e.request_id)){run.pending.delete(k);run.update(p.event,{status:e.choice==='deny'?'denied':'approved'})}if(!run.pending.size&&run.state==='waiting')run.state='running';break;
  case 'assistant.completed':{const c=contentText(e.content);if(c)finalText=c;if(e.runtime?.model)run.actualModel=e.runtime.model;break}
  case 'run.completed':{completed=true;const u=e.usage||e.run?.usage;if(u){const x=run.usage,inp=u.input_tokens??u.prompt_tokens??0,out=u.output_tokens??u.completion_tokens??0;x.calls++;x.input+=inp;x.output+=out;x.cachedInput+=u.cache_read_tokens??u.cached_tokens??0}finish(run.stopped?'stopped':'complete');break}
  case 'run.failed':failure=String(e.error?.message||e.error||'The engine stopped with an error.');finish(run.stopped?'stopped':'failed',run.stopped?null:failure);break;
  case 'run.cancelled':case 'run.interrupted':finish('stopped');break}};
 try{const images=[];for(const i of run.images||[])images.push('data:'+i.type+';base64,'+(await readFile(i.path)).toString('base64'));
  const r=await aqeelos.engineRun({agent:run.agent||'',provider:run.engineProvider||'',model:run.engineModel||'',effort:run.effort||'',path:dir,session:session||'',prompt,images},act,ctl.signal);
  await readSSE(r.body,e=>{try{on(e)}catch(er){console.warn('engine event',e.type,er.message)}});
  finish(run.stopped?'stopped':completed?'complete':'failed',failure||'The engine stopped before finishing this turn.')}
 catch(e){finish(run.stopped?'stopped':'failed',e.name==='AbortError'?null:e.message)}})}
