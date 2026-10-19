import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {shell} from './platform.mjs';

// Agent runs: Codex (app-server JSON-RPC) and Claude Code (stream-json with host permission prompts)
// work directly in the project folder. Both adapters emit the same event shapes so the UI renders one timeline:
//  message {text, final}  · command {command, status, output, exitCode}  · file {paths, status}
//  tool {name, detail, status}  · approval {kind, title, detail, status}  · error {text}
export const INSTRUCTIONS=`You are working inside "aqeelOS Code", a local app and website builder that is part of the person's aqeelOS. When the aqeelos tools are available, use aqeelos_ask for anything outside this project folder (read or update a Google Sheet, run or build an n8n workflow, send a WhatsApp or Slack message, set up a schedule, look something up in Notion or memory): one of the person's agents does it with its own access and tells you the result. aqeelos_agents lists who can help.
The current working directory is the user's project folder: keep every change inside it.
For new websites prefer static HTML, CSS and JavaScript with index.html as the entry point, unless the project already uses another stack.
You may run shell commands (${shell('').label} on ${process.platform==='win32'?'Windows':process.platform==='darwin'?'macOS':'Linux'}). The user approves commands and edits from the app, so run what the task needs and explain briefly why.
For anything on the web, use the browser_* tools of the 'browser' MCP server (browser_open, browser_snapshot, browser_click, browser_type, browser_read, browser_screenshot). They drive the shared side browser the user watches live in the app's Browser tab, so prefer them over curl, fetch, web search or any other browser or computer-use tool. Never enter passwords or payment details and never complete purchases; ask the user to do that.
git and the GitHub CLI (gh) are installed and signed in; use them for GitHub tasks such as clone, pull, status, commit and pull requests. Never push or open a pull request unless the user asked.
To show a small chart in a reply, write a fenced code block with the language chart containing JSON: {"type":"bar|line|pie","title":"…","labels":[…],"series":[{"name":"…","values":[…]}]}.
Finish with a short plain-language summary of what you did and what the user should check.`;

// TodoWrite (older Claude Code) and TaskCreate/TaskUpdate (newer) both feed the live checklist.
const CLAUDE_TOOLS='Bash,PowerShell,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,TodoWrite,TaskCreate,TaskUpdate,TaskList,TaskGet,AskUserQuestion';
const TASK_STATUS={pending:'pending',in_progress:'inProgress',completed:'completed',deleted:'deleted'};
// Permission modes: ask = approve every change, auto = edits/commands inside the project run freely,
// plan = read-only investigation that ends in a plan, full = no prompts at all (explicit opt-in).
export const MODES=['ask','auto','plan','full'];
export const PLAN_PROMPT='PLAN MODE: do not modify files or run commands that change anything. Investigate with read-only commands if needed, then reply with a concise numbered implementation plan, the files you would change, and any questions for the user. The user will approve the plan before you build it.\n\n';
export function codexPolicy(mode,cwd,extra=[]){if(mode==='full')return {approvalPolicy:'never',sandbox:'danger-full-access',sandboxPolicy:{type:'dangerFullAccess'}};
 if(mode==='plan')return {approvalPolicy:'never',sandbox:'read-only',sandboxPolicy:{type:'readOnly',networkAccess:true}};
 return {approvalPolicy:mode==='auto'?'on-request':'untrusted',sandbox:'workspace-write',sandboxPolicy:{type:'workspaceWrite',writableRoots:[cwd,...extra],networkAccess:true,excludeTmpdirEnvVar:false,excludeSlashTmp:false}}}
export const claudeMode=mode=>({ask:'default',auto:'acceptEdits',plan:'plan',full:'bypassPermissions'})[mode]||'default';
const MAX_EVENTS=600,MAX_OUTPUT=20000;

export class AgentRun{
 constructor(job){Object.assign(this,job);this.id=randomUUID();this.usage={calls:0,input:0,cachedInput:0,cacheWrite:0,output:0,reasoning:0,models:{}};this.state='running';this.events=[];this.seq=0;this.pending=new Map();this.startedAt=Date.now()}
 emit(event){event.seq=++this.seq;event.key=event.seq;event.time=Date.now();this.events.push(event);if(this.events.length>MAX_EVENTS)this.events.splice(0,this.events.length-MAX_EVENTS);return event}
 update(event,patch){Object.assign(event,patch);event.seq=++this.seq}
 since(after){return this.events.filter(e=>e.seq>after)}
 view(after=0){return {id:this.id,projectId:this.projectId,chatId:this.chatId,provider:this.provider,team:this.team||null,draft:Boolean(this.cwd),model:this.model,effort:this.effort,account:this.account,state:this.state,error:this.error||null,warning:this.warning||null,seq:this.seq,events:this.since(after)}}
 ask(kind,title,detail,respond){const event=this.emit({type:'approval',kind,title,detail,status:'pending'});this.pending.set(event.key,{event,respond});this.state='waiting';return event}
 decide(key,decision){const p=this.pending.get(Number(key));if(!p)throw Error('This approval is no longer pending.');if(!['accept','acceptForSession','decline'].includes(decision))throw Error('Unknown decision.');
  this.pending.delete(Number(key));this.update(p.event,{status:decision==='decline'?'denied':'approved',decision});if(!this.pending.size&&this.state==='waiting')this.state='running';p.respond(decision)}
 // questions from the AI: [{id, header, question, options:[{label,description}], multi, other, secret}]
 askQuestions(questions,respond){const event=this.emit({type:'question',questions,status:'pending'});this.pending.set(event.key,{event,respond,question:true});this.state='waiting';return event}
 answer(key,answers){const p=this.pending.get(Number(key));if(!p?.question)throw Error('This question is no longer open.');if(!answers||typeof answers!=='object')throw Error('Send an answer.');
  const clean={};for(const q of p.event.questions){const a=[].concat(answers[q.id]??[]).map(x=>String(x).slice(0,2000)).filter(Boolean);clean[q.id]=a}
  this.pending.delete(Number(key));this.update(p.event,{status:'answered',answers:clean});if(!this.pending.size&&this.state==='waiting')this.state='running';p.respond(clean)}
 // the AI's to-do list, kept as one event that updates in place
 setPlan(items,explanation){if(this.planEvent)this.update(this.planEvent,{items,explanation});else this.planEvent=this.emit({type:'plan',items,explanation})}
 denyAll(){for(const [seq,p] of this.pending)try{p.question?(this.pending.delete(seq),this.update(p.event,{status:'cancelled'}),p.respond(null)):this.decide(seq,'decline')}catch{}}
}

const clip=s=>s.length>MAX_OUTPUT?'…'+s.slice(-MAX_OUTPUT):s;
// Codex wraps commands as: "C:\...\powershell.exe" -Command 'actual command'
// or "C:\\...\\powershell.exe" -Command "actual command" (with backslashes doubled)
export function displayCommand(command){const s=String(command||'');const m=s.match(/powershell(?:\.exe)?"?\s+(?:-\w+\s+)*-Command\s+(['"])([\s\S]*)\1\s*$/i);if(!m)return s;
 return m[1]==="'"?m[2].replace(/''/g,"'"):m[2].replace(/\\"/g,'"').replace(/\\\\/g,'\\')}
// Codex classifies each command; commands made only of read/list/search actions are approved automatically.
const READ_ONLY=new Set(['read','listFiles','search']);
export const readOnly=p=>Array.isArray(p.commandActions)&&p.commandActions.length>0&&p.commandActions.every(a=>READ_ONLY.has(a.type))&&!p.networkApprovalContext&&!p.proposedNetworkPolicyAmendments?.length;
const rel=(cwd,p)=>{const r=path.relative(cwd,p);return r&&!r.startsWith('..')?r.split(path.sep).join('/'):p};

function rpc(child,onRequest,onNotify){
 let buffer='',id=0;const waiting=new Map();
 const send=o=>{try{child.stdin.write(JSON.stringify(o)+'\n')}catch{}};
 child.stdout.on('data',d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let m;try{m=JSON.parse(line)}catch{continue}
  if(m.id!==undefined&&m.method===undefined){const w=waiting.get(m.id);if(w){waiting.delete(m.id);m.error?w.reject(Error(m.error.message||'Codex request failed.')):w.resolve(m.result)}continue}
  if(m.id!==undefined)onRequest(m,result=>send({id:m.id,result}),(message)=>send({id:m.id,error:{code:-32000,message}}));else onNotify(m)}});
 child.on('close',()=>{for(const w of waiting.values())w.reject(Error('Codex stopped unexpectedly.'));waiting.clear()});
 return {send,call:(method,params)=>new Promise((resolve,reject)=>{const n=++id;waiting.set(n,{resolve,reject});send({id:n,method,params})})};
}

export function runCodex(run,{executable,env,cwd,prompt,threadId,onSession,browserMcp,extraMcp}){return new Promise(resolve=>{
 const child=spawn(executable,['app-server','--listen','stdio://'],{cwd,env,windowsHide:true,shell:false});
 const items=new Map();let turnId=null,finalText='',done=false;
 const finish=(state,error)=>{if(done)return;done=true;run.denyAll();if(error&&state==='failed')run.emit({type:'error',text:error});setTimeout(()=>child.kill(),300);resolve({state,error,text:finalText})};
 child.on('error',e=>finish('failed',e.message));child.on('close',()=>finish(run.stopped?'stopped':'failed','Codex exited before finishing.'));child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
 const client=rpc(child,(m,ok,fail)=>{
  const p=m.params||{};
  if(m.method==='item/commandExecution/requestApproval'){if(readOnly(p)){const e=items.get(p.itemId);if(e)run.update(e,{auto:true});return ok({decision:'accept'})}const cmd=displayCommand(p.command);run.ask('command',p.reason?'Run this command? '+p.reason:'Run this command?',cmd||'(command)',d=>ok({decision:d}))}
  else if(m.method==='item/fileChange/requestApproval'){const item=items.get(p.itemId);run.ask('file',p.reason||'Apply these file changes?',(item?.paths||[]).join('\n')||'Project files',d=>ok({decision:d}))}
  else if(m.method==='execCommandApproval'||m.method==='applyPatchApproval'){run.ask(m.method==='execCommandApproval'?'command':'file','Allow this action?',displayCommand([].concat(p.command||[]).join(' '))||'Project files',d=>ok({decision:d==='decline'?'denied':d==='acceptForSession'?'approved_for_session':'approved'}))}
  else if(m.method==='item/tool/requestUserInput'){run.askQuestions((p.questions||[]).map(q=>({id:q.id,header:q.header,question:q.question,options:q.options||[],other:q.isOther,secret:q.isSecret})),a=>ok({answers:Object.fromEntries(Object.entries(a||{}).map(([id,v])=>[id,{answers:v}]))}))}
  else if(m.method==='mcpServer/elicitation/request'){
   // Codex asks before MCP tool calls. The shared browser is approved automatically outside Ask mode.
   const answer=d=>ok({action:d==='decline'?'decline':'accept',content:d==='decline'?null:{},_meta:null});
   if(p.serverName==='app'||(p.serverName==='browser'&&run.mode!=='ask')||(run.extraMcp||[]).some(m=>m.name===p.serverName&&m.permission==='allow'))answer('accept'); // the app's own tools only show things in the app
   else if(p.mode==='url')answer('decline');
   else run.ask('tool',p.message||('Allow '+p.serverName+'?'),p.serverName+(p.message?' — '+p.message:''),answer)}
  else fail('aqeelOS Code cannot answer '+m.method+' yet.');
 },m=>{
  const p=m.params||{},item=p.item;
  if(m.method==='item/started'&&item){
   if(item.type==='commandExecution')items.set(item.id,run.emit({type:'command',command:displayCommand(item.command),status:'running',output:''}));
   else if(item.type==='fileChange'){const paths=(item.changes||[]).map(c=>rel(cwd,c.path));items.set(item.id,run.emit({type:'file',paths,status:'running'}))}
   else if(item.type==='mcpToolCall')items.set(item.id,run.emit({type:'tool',name:item.server+' · '+item.tool,detail:JSON.stringify(item.arguments||{}).slice(0,300),status:'running'}));
   else if(item.type==='webSearch')items.set(item.id,run.emit({type:'tool',name:'Web search',detail:item.query||'',status:'running'}));
   else if(item.type==='agentMessage')items.set(item.id,run.emit({type:'message',text:item.text||'',final:item.phase==='final_answer'}));
   else if(item.type==='collabAgentToolCall')items.set(item.id,run.emit({type:'tool',name:'Sub-agent · '+(item.tool||'delegate'),detail:(item.prompt||'').slice(0,200),status:'running'}));
  }
  else if(m.method==='item/agentMessage/delta'){const e=items.get(p.itemId);if(e)run.update(e,{text:e.text+p.delta})}
  else if(m.method==='item/commandExecution/outputDelta'){const e=items.get(p.itemId);if(e)run.update(e,{output:clip(e.output+p.delta)})}
  else if(m.method==='item/completed'&&item){const e=items.get(item.id);
   if(item.type==='reasoning'&&(item.summary||[]).join('').trim())run.emit({type:'thinking',text:item.summary.join('\n\n').slice(0,6000)});
   if(item.type==='collabAgentToolCall'&&e)run.update(e,{status:item.status==='failed'?'failed':'completed'});
   if(item.type==='agentMessage'){const final=item.phase==='final_answer';if(final)finalText=item.text;e?run.update(e,{text:item.text,final}):run.emit({type:'message',text:item.text,final})}
   else if(item.type==='commandExecution'&&e)run.update(e,{status:item.status==='completed'&&item.exitCode===0?'completed':item.status==='declined'?'declined':'failed',exitCode:item.exitCode,output:clip(item.aggregatedOutput??e.output)});
   else if(item.type==='fileChange'&&e)run.update(e,{status:item.status==='completed'?'completed':item.status==='declined'?'declined':'failed'});
   else if((item.type==='mcpToolCall'||item.type==='webSearch')&&e)run.update(e,{status:item.error?'failed':'completed'});
  }
  else if(m.method==='turn/started')turnId=p.turn?.id;
  else if(m.method==='account/rateLimits/updated'&&p.rateLimits)run.rateLimits=p.rateLimits;
  else if(m.method==='turn/plan/updated')run.setPlan((p.plan||[]).map(s=>({text:s.step,status:s.status})),p.explanation||null);
  else if(m.method==='thread/compacted'){run.compacted=true;if(run.compact)finish('complete')}
  else if(m.method==='thread/tokenUsage/updated'&&p.tokenUsage?.last){if(p.tokenUsage.modelContextWindow)run.context={used:p.tokenUsage.last.inputTokens+p.tokenUsage.last.outputTokens,window:p.tokenUsage.modelContextWindow};const l=p.tokenUsage.last,u=run.usage;u.calls++;u.input+=(l.inputTokens||0)-(l.cachedInputTokens||0);u.cachedInput+=l.cachedInputTokens||0;u.output+=(l.outputTokens||0)-(l.reasoningOutputTokens||0);u.reasoning+=l.reasoningOutputTokens||0;const model=run.actualModel||run.model||'default';u.models[model]=(u.models[model]||0)+(l.totalTokens||0)}
  else if(m.method==='thread/started'&&p.thread?.model)run.actualModel=p.thread.model;
  else if(m.method==='error'&&!p.willRetry)run.emit({type:'error',text:p.error?.message||'Codex reported an error.'});
  else if(m.method==='turn/completed'){const s=p.turn?.status;finish(s==='completed'?'complete':s==='interrupted'?'stopped':'failed',p.turn?.error?.message||(s==='failed'?'Codex could not finish this turn.':null))}
 });
 run.stop=async()=>{run.stopped=true;run.denyAll();try{if(turnId)await client.call('turn/interrupt',{threadId:run.threadId,turnId})}catch{}setTimeout(()=>finish('stopped'),3000)};
 run.steer=async text=>{if(!turnId||done)throw Error('This run has already finished.');await client.call('turn/steer',{threadId:run.threadId,expectedTurnId:turnId,input:[{type:'text',text,text_elements:[]}]});run.emit({type:'steer',text})};
 (async()=>{try{
  await client.call('initialize',{clientInfo:{name:'code_by_aqeel',title:'aqeelOS Code',version:'0.2.0'}});client.send({method:'initialized'});
  const policy=codexPolicy(run.mode,cwd,run.writeDirs||[]);const options={cwd,approvalPolicy:policy.approvalPolicy,sandbox:policy.sandbox,developerInstructions:INSTRUCTIONS+(run.extraInstructions||''),...(run.model?{model:run.model}:{}),...(browserMcp&&run.mode!=='plan'?{config:{mcp_servers:{browser:browserMcp,...Object.fromEntries((extraMcp||[]).map(m=>[m.name,{command:m.command,args:m.args,env:m.env}]))}}}:{})};
  let thread;if(threadId){try{thread=(await client.call('thread/resume',{threadId,...options})).thread}catch{}}
  if(!thread)thread=(await client.call('thread/start',{...options,serviceName:'code_by_aqeel'})).thread;
  run.threadId=thread.id;onSession?.(thread.id);
  if(run.compact){await client.call('thread/compact/start',{threadId:thread.id});return}
  await client.call('turn/start',{threadId:thread.id,input:[{type:'text',text:(run.mode==='plan'?PLAN_PROMPT:'')+prompt,text_elements:[]},...(run.images||[]).map(i=>({type:'localImage',path:i.path}))],approvalPolicy:policy.approvalPolicy,sandboxPolicy:policy.sandboxPolicy,...(run.effort?{effort:run.effort}:{}),
   // web work goes through the shared side browser; Codex's own computer-use plugin stays off unless the user opts in (EXT-05)
   ...(browserMcp?{disabledPluginIds:['unified-computer-use@openai-bundled',...(run.disabledPlugins||[])]}:run.disabledPlugins?.length?{disabledPluginIds:run.disabledPlugins}:{}),...(run.fast?{serviceTierForTurn:'priority'}:{})});
 }catch(e){finish('failed',e.message)}})();
})}

// Browser tools that only look are allowed without asking; acting tools follow the permission mode.
const BROWSER_READ=['browser_snapshot','browser_read','browser_screenshot','browser_scroll','browser_back','browser_open'].map(t=>'mcp__browser__'+t);
export function runClaude(run,{executable,env,cwd,prompt,sessionId,onSession,browserMcp,extraMcp}){return new Promise(resolve=>{
 const toolList=(CLAUDE_TOOLS+',Task'+(run.mode==='plan'?',ExitPlanMode':'')).split(',').filter(t=>run.webAccess!==false||!/^Web(Fetch|Search)$/.test(t)).join(',');
 const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--permission-prompt-tool','stdio','--permission-mode',claudeMode(run.mode),'--setting-sources','','--strict-mcp-config','--tools',toolList,'--append-system-prompt',INSTRUCTIONS+(run.extraInstructions||'')];
 if(run.mode==='full')args.push('--dangerously-skip-permissions');
 for(const d of run.writeDirs||[])args.push('--add-dir',d);   // a task's results folder
 if(browserMcp&&run.mode!=='plan'){args.push('--mcp-config',JSON.stringify({mcpServers:{browser:{type:'stdio',...browserMcp},...Object.fromEntries((extraMcp||[]).map(m=>[m.name,{type:'stdio',command:m.command,args:m.args,env:m.env}]))}}));args.push('--allowedTools',...(run.mode==='ask'?BROWSER_READ:['mcp__browser']),'mcp__app',...(extraMcp||[]).filter(m=>m.permission==='allow').map(m=>'mcp__'+m.name))}
 if(run.agents?.length)args.push('--agents',JSON.stringify(Object.fromEntries(run.agents.map(a=>[a.name,{description:a.description,prompt:a.instructions||a.description,...(a.model?{model:a.model}:{})}]))));if(run.addDirs?.length)args.push('--add-dir',...run.addDirs);if(run.fast)args.push('--settings',JSON.stringify({fastMode:true}));if(run.model)args.push('--model',run.model);if(run.effort)args.push('--effort',run.effort);if(sessionId)args.push('--resume',sessionId);
 const child=spawn(executable,args,{cwd,env,windowsHide:true,shell:false});
 const tools=new Map(),tasks=[],taskCalls=new Map();let buffer='',finalText='',done=false,lastText=null,errText='',planText='';
 const showTasks=()=>run.setPlan(tasks.filter(t=>t.status!=='deleted').map(t=>({text:t.status==='inProgress'&&t.activeForm?t.activeForm:t.text,status:t.status})));
 const send=o=>{try{child.stdin.write(JSON.stringify(o)+'\n')}catch{}};
 const finish=(state,error,extra={})=>{if(done)return;done=true;run.denyAll();if(error&&state==='failed')run.emit({type:'error',text:error});try{child.stdin.end()}catch{}setTimeout(()=>child.kill(),1500);resolve({state,error,text:finalText,...extra})};
 child.on('error',e=>finish('failed',e.message));child.on('close',()=>finish(run.stopped?'stopped':'failed',errText.trim().slice(-600)||'Claude exited before finishing.'));child.stdin.on('error',()=>{});
 child.stderr.on('data',d=>{errText=(errText+d).slice(-4000)});
 child.stdout.on('data',d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let m;try{m=JSON.parse(line)}catch{continue}
  if(m.type==='rate_limit_event'&&m.rate_limit_info)run.rateLimits=m.rate_limit_info;
  if(m.type==='system'&&m.subtype==='init'&&m.session_id){run.threadId=m.session_id;onSession?.(m.session_id)}
  else if(m.type==='control_request'&&m.request?.subtype==='can_use_tool'&&m.request.tool_name==='ExitPlanMode'){planText=m.request.input?.plan||'';if(planText)run.emit({type:'message',text:planText,final:true});send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{behavior:'deny',message:'Plan received. The user is reviewing it in code by aqeel; stop here and wait.'}}})}
  else if(m.type==='control_request'&&m.request?.subtype==='can_use_tool'&&m.request.tool_name==='AskUserQuestion'){const input=m.request.input||{},qs=input.questions||[];
   run.askQuestions(qs.map((q,i)=>({id:String(i),header:q.header||'',question:q.question,options:q.options||[],multi:Boolean(q.multiSelect),other:true})),a=>send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:a?{behavior:'allow',updatedInput:{...input,answers:Object.fromEntries(qs.map((q,i)=>[q.question,(a[String(i)]||[]).join(', ')]))}}:{behavior:'deny',message:'The user did not answer.'}}}))}
  else if(m.type==='control_request'&&m.request?.subtype==='can_use_tool'){const r=m.request,input=r.input||{};
   const kind=/^(Bash|PowerShell)$/.test(r.tool_name)?'command':/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(r.tool_name)?'file':'tool';
   const detail=kind==='command'?input.command:kind==='file'?rel(cwd,input.file_path||input.notebook_path||''):r.tool_name+' '+JSON.stringify(input).slice(0,300);
   run.ask(kind,kind==='command'?'Run this command?':kind==='file'?'Allow this file change?':'Allow '+(r.display_name||r.tool_name)+'?',detail,dec=>send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:dec==='decline'?{behavior:'deny',message:'The user declined this action in code by aqeel.'}:{behavior:'allow',updatedInput:input,...(dec==='acceptForSession'&&r.permission_suggestions?{updatedPermissions:r.permission_suggestions.map(s=>({...s,destination:'session'}))}:{})}}}))}
  else if(m.type==='control_request')send({type:'control_response',response:{subtype:'error',request_id:m.request_id,error:'Not supported by aqeelOS Code.'}});
  else if(m.type==='assistant'&&!m.parent_tool_use_id){const us=m.message?.usage;if(us)run.context={used:(us.input_tokens||0)+(us.cache_read_input_tokens||0)+(us.cache_creation_input_tokens||0)+(us.output_tokens||0),window:run.context?.window||null};for(const block of m.message?.content||[]){
   if(block.type==='text'&&block.text.trim()){lastText=run.emit({type:'message',text:block.text,final:false})}
   else if(block.type==='thinking'&&block.thinking?.trim())run.emit({type:'thinking',text:block.thinking.slice(0,6000)})
   else if(block.type==='tool_use'){const input=block.input||{};
    if(/^(Bash|PowerShell)$/.test(block.name))tools.set(block.id,run.emit({type:'command',command:input.command||'',status:'running',output:''}));
    else if(/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(block.name))tools.set(block.id,run.emit({type:'file',paths:[rel(cwd,input.file_path||input.notebook_path||'')],status:'running'}));
    else if(block.name==='TaskCreate'){const t={text:input.subject||input.description||'Task',activeForm:input.activeForm,status:'pending'};tasks.push(t);taskCalls.set(block.id,t);showTasks()}
    else if(block.name==='TaskUpdate'){const t=tasks.find(x=>String(x.id)===String(input.taskId));if(t){if(input.status)t.status=TASK_STATUS[input.status]||t.status;if(input.subject)t.text=input.subject;if(input.activeForm)t.activeForm=input.activeForm;showTasks()}}
    else if(/^Task(List|Get)$/.test(block.name)){}
    else if(block.name==='Task'||block.name==='Agent')tools.set(block.id,run.emit({type:'tool',name:'Sub-agent'+(input.subagent_type?' · '+input.subagent_type:''),detail:(input.description||input.prompt||'').slice(0,200),status:'running'}));
    else if(block.name==='TodoWrite')run.setPlan((input.todos||[]).map(t=>({text:t.status==='in_progress'&&t.activeForm?t.activeForm:t.content,status:t.status==='in_progress'?'inProgress':t.status})));
    else if(block.name!=='AskUserQuestion')tools.set(block.id,run.emit({type:'tool',name:block.name,detail:(input.pattern||input.file_path||input.url||input.query||JSON.stringify(input)).toString().slice(0,300),status:'running'}));}}}
  else if(m.type==='user'&&!m.parent_tool_use_id){for(const block of m.message?.content||[]){if(block.type!=='tool_result')continue;const created=taskCalls.get(block.tool_use_id);if(created){const text=typeof block.content==='string'?block.content:(block.content||[]).map(c=>c.text||'').join(' ');const id=(m.tool_use_result?.task?.id)??text.match(/#?(\d+)/)?.[1];if(id!=null)created.id=String(id);taskCalls.delete(block.tool_use_id)}const e=tools.get(block.tool_use_id);if(!e)continue;
   const text=typeof block.content==='string'?block.content:(block.content||[]).map(c=>c.text||'').join('\n');const declined=block.is_error&&/declined|haven't granted|denied/i.test(text);
   run.update(e,{status:declined?'declined':block.is_error?'failed':'completed',...(e.type==='command'?{output:clip(text)}:{})})}}
  else if(m.type==='result'){if(lastText)run.update(lastText,{final:true});finalText=planText||m.result||lastText?.text||'';const cost=typeof m.total_cost_usd==='number'?m.total_cost_usd:null;
   const u=run.usage;for(const [model,mu] of Object.entries(m.modelUsage||{})){if(mu.contextWindow&&run.context)run.context.window=mu.contextWindow;u.calls++;u.input+=mu.inputTokens||0;u.cachedInput+=mu.cacheReadInputTokens||0;u.cacheWrite+=mu.cacheCreationInputTokens||0;u.output+=mu.outputTokens||0;u.models[model]=(mu.inputTokens||0)+(mu.outputTokens||0)+(mu.cacheReadInputTokens||0)+(mu.cacheCreationInputTokens||0);}u.reportedCost=cost;
   // the model that did the work: the one you asked for if it ran, otherwise the one that used the most tokens (Claude Code also calls helper models)
   {const names=Object.keys(m.modelUsage||{});run.actualModel=run.actualModel||(run.model&&names.find(n=>n.includes(run.model)))||names.sort((a,b)=>u.models[b]-u.models[a])[0]}
   finish(run.stopped?'stopped':m.is_error?'failed':'complete',m.is_error&&!run.stopped?(m.result||'Claude request failed.'):null,{cost})}
 }});
 run.stop=()=>{run.stopped=true;run.denyAll();send({type:'control_request',request_id:randomUUID(),request:{subtype:'interrupt'}});setTimeout(()=>finish('stopped'),3000)};
 send({type:'control_request',request_id:randomUUID(),request:{subtype:'initialize'}});
 send({type:'user',message:{role:'user',content:run.images?.length?[{type:'text',text:prompt},...run.images.map(i=>({type:'image',source:{type:'base64',media_type:i.type,data:readFileSync(i.path).toString('base64')}}))]:prompt}});
})}
