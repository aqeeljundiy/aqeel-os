// Gemini CLI as a third provider, driven over the Agent Client Protocol (ACP): JSON-RPC 2.0, one message per line on stdio.
// The CLI runs the agent loop in the project folder; this module maps ACP updates onto the app's shared run events
// and answers permission requests through the same approval cards as Claude and GPT.
import {spawn} from 'node:child_process';
import {readFile,access} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {INSTRUCTIONS,PLAN_PROMPT} from './agent.mjs';
import {isWindows,killTree} from './platform.mjs';

// Model aliases the Gemini CLI resolves to the newest model of each tier; replaced by the CLI's own list when it reports one.
export const GEMINI_MODELS=[
 {id:'',name:'Default',description:'Gemini CLI chooses the model for your plan.',efforts:[],defaultEffort:''},
 {id:'pro',name:'Pro',description:'Most capable Gemini model.',efforts:[],defaultEffort:''},
 {id:'flash',name:'Flash',description:'Fast and capable.',efforts:[],defaultEffort:''},
 {id:'flash-lite',name:'Flash Lite',description:'Quickest and lightest.',efforts:[],defaultEffort:''},
];

const exists=async p=>{try{await access(p);return true}catch{return false}};
// The npm package's JavaScript entry, run with this Node (avoids .cmd shims on Windows).
async function packageEntry(dir){try{const pkg=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.gemini;if(bin&&await exists(path.join(dir,bin)))return path.join(dir,bin)}catch{}return null}

// {command,args} that starts the Gemini CLI, or null when it is not installed.
export async function locateGemini({appRoot,findOnPath}={}){
 if(process.env.GEMINI_CLI_PATH&&await exists(process.env.GEMINI_CLI_PATH))return /\.(c|m)?js$/.test(process.env.GEMINI_CLI_PATH)?{command:process.execPath,args:[process.env.GEMINI_CLI_PATH]}:{command:process.env.GEMINI_CLI_PATH,args:[]};
 const dirs=[appRoot&&path.join(appRoot,'node_modules','@google','gemini-cli'),isWindows&&path.join(process.env.APPDATA||'','npm','node_modules','@google','gemini-cli'),'/opt/homebrew/lib/node_modules/@google/gemini-cli','/usr/local/lib/node_modules/@google/gemini-cli',path.join(os.homedir(),'.npm-global','lib','node_modules','@google','gemini-cli')].filter(Boolean);
 for(const d of dirs){const entry=await packageEntry(d);if(entry)return {command:process.execPath,args:[entry]}}
 if(!isWindows&&findOnPath){const p=await findOnPath('gemini');if(p)return {command:p,args:[]}}
 for(const p of ['/opt/homebrew/bin/gemini','/usr/local/bin/gemini'])if(!isWindows&&await exists(p))return {command:p,args:[]};
 return null}

// Signed in when Google sign-in credentials are cached or an API key is set.
export async function geminiAuth(env=process.env,home=os.homedir()){
 if(env.GEMINI_API_KEY)return {ready:true,method:'gemini-api-key',message:'Using a Gemini API key (billed per token).'};
 if(env.GOOGLE_GENAI_USE_VERTEXAI==='true')return {ready:true,method:'vertex-ai',message:'Using Vertex AI.'};
 const dir=path.join(env.GEMINI_CLI_HOME||home,'.gemini');let email=null;try{email=JSON.parse(await readFile(path.join(dir,'google_accounts.json'),'utf8')).active||null}catch{}
 if(await exists(path.join(dir,'oauth_creds.json')))return {ready:true,method:'oauth-personal',email,message:'Signed in with Google'};
 return {ready:false,message:'Sign in to Gemini with your Google account.'}}

// Minimal ACP client: requests with ids, notifications, and handlers for requests the agent sends to us.
export class AcpClient{
 constructor(child){this.child=child;this.next=1;this.waiting=new Map();this.handlers={};this.notify=()=>{};let buf='';
  child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line)continue;let m;try{m=JSON.parse(line)}catch{continue}this.receive(m)}});
  child.on('close',()=>{for(const w of this.waiting.values())w.reject(Error('Gemini stopped unexpectedly.'));this.waiting.clear()});child.stdin.on('error',()=>{})}
 write(o){try{this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',...o})+'\n')}catch{}}
 call(method,params,timeout=0){const id=this.next++;this.write({id,method,params});return new Promise((resolve,reject)=>{this.waiting.set(id,{resolve,reject});if(timeout)setTimeout(()=>{if(this.waiting.delete(id))reject(Error('Gemini did not answer '+method+'.'))},timeout).unref?.()})}
 send(method,params){this.write({method,params})}
 async receive(m){if(m.id!==undefined&&!m.method){const w=this.waiting.get(m.id);if(!w)return;this.waiting.delete(m.id);m.error?w.reject(Error(m.error.message||'Gemini error')):w.resolve(m.result);return}
  if(m.id!==undefined&&m.method){const h=this.handlers[m.method];try{const result=h?await h(m.params||{}):null;if(!h)this.write({id:m.id,error:{code:-32601,message:'Not supported: '+m.method}});else this.write({id:m.id,result})}catch(e){this.write({id:m.id,error:{code:-32603,message:e.message}})}return}
  if(m.method)this.notify(m.method,m.params||{})}
}

// Start the CLI in ACP mode. The flag is --acp (older releases: --experimental-acp, set GEMINI_ACP_FLAG to use it).
export function startAcp({command,args},{cwd,env,model,flag=process.env.GEMINI_ACP_FLAG||'--acp'}){const child=spawn(command,[...args,flag,...(model?['-m',model]:[])],{cwd,env,windowsHide:true,shell:false});return child}

const KIND_TO_APPROVAL={execute:'command',edit:'file',delete:'file',move:'file'};
const textOf=c=>!c?'':Array.isArray(c)?c.map(textOf).join(''):c.type==='text'?c.text||'':c.type==='content'?textOf(c.content):c.type==='diff'?'':'';

// One agent turn. Resolves {state, text, error}; never rejects.
export function runGemini(run,{gemini,env,cwd,prompt,sessionId,onSession,browserMcp,extraMcp,onModels}){return new Promise(resolve=>{
 let done=false,text='',errText='',client,child;const tools=new Map();
 const finish=(state,error)=>{if(done)return;done=true;run.denyAll();if(error&&state==='failed')run.emit({type:'error',text:error});setTimeout(()=>killTree(child),1500);resolve({state,error,text:text.trim()})};
 try{child=startAcp(gemini,{cwd,env,model:run.model})}catch(e){return resolve({state:'failed',error:e.message,text:''})}
 child.on('error',e=>finish('failed',e.message));child.stderr.on('data',d=>{errText=(errText+d).slice(-4000)});child.on('close',()=>finish(run.stopped?'stopped':'failed',errText.trim().slice(-600)||'Gemini exited before finishing.'));
 client=new AcpClient(child);let message=null;
 run.stop=async()=>{run.stopped=true;run.denyAll();if(run.sessionId)client.send('session/cancel',{sessionId:run.sessionId});setTimeout(()=>finish('stopped'),3000)};
 // permission requests become approval cards (or are answered by the permission mode)
 client.handlers['session/request_permission']=async({toolCall={},options=[]})=>{const kind=KIND_TO_APPROVAL[toolCall.kind]||'tool';const pick=k=>options.find(o=>o.kind===k)?.optionId||options.find(o=>o.kind?.startsWith(k.split('_')[0]))?.optionId;
  const readOnly=['read','search','fetch','think'].includes(toolCall.kind);
  if(run.mode==='full'||(run.mode==='auto'&&kind!=='command')||(readOnly&&run.mode!=='plan')||(readOnly&&run.mode==='plan'))return {outcome:{outcome:'selected',optionId:pick('allow_once')}};
  if(run.mode==='plan')return {outcome:{outcome:'selected',optionId:pick('reject_once')}};
  const detail=[toolCall.title,...(toolCall.locations||[]).map(l=>l.path&&path.relative(cwd,l.path))].filter(Boolean).join('\n').slice(0,2000);
  return new Promise(res=>run.ask(kind,toolCall.title||'Gemini wants to use a tool',detail,decision=>res(decision==='decline'||!decision?{outcome:{outcome:'selected',optionId:pick('reject_once')}}:{outcome:{outcome:'selected',optionId:decision==='acceptForSession'?(pick('allow_always')||pick('allow_once')):pick('allow_once')}})))};
 // file system requests (only if advertised; we do not) and terminal requests are declined by default
 client.notify=(method,{update})=>{if(method!=='session/update'||!update)return;const u=update.sessionUpdate;
  if(u==='agent_message_chunk'){const t=textOf(update.content);if(!t)return;text+=t;if(!message)message=run.emit({type:'message',text:t});else run.update(message,{text:message.text+t})}
  else if(u==='agent_thought_chunk'){const t=textOf(update.content);if(t){if(!run.thought)run.thought=run.emit({type:'thinking',text:t});else run.update(run.thought,{text:(run.thought.text+t).slice(-4000)})}}
  else if(u==='tool_call'||u==='tool_call_update'){message=null;const id=update.toolCallId;let ev=tools.get(id);const status=update.status==='completed'?'completed':update.status==='failed'?'failed':'running';const out=textOf(update.content)?.slice(-4000);
   const paths=(update.locations||[]).map(l=>path.relative(cwd,l.path||'')).filter(Boolean);
   if(!ev){const kind=update.kind||'other';ev=kind==='execute'?run.emit({type:'command',command:update.title||'command',status,output:out||''}):kind==='edit'||kind==='delete'||kind==='move'?run.emit({type:'file',paths:paths.length?paths:[update.title||'file'],status}):run.emit({type:'tool',name:update.title||kind,detail:paths.join(', '),status});tools.set(id,ev)}
   else run.update(ev,{status:update.status?status:ev.status,...(ev.type==='command'&&out?{output:out}:{}),...(ev.type==='file'&&paths.length?{paths}:{})})}
  else if(u==='plan')run.setPlan((update.entries||[]).map(e=>({text:e.content,status:e.status==='in_progress'?'inProgress':e.status||'pending'})));
 };
 (async()=>{try{
  const init=await client.call('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}},60000);
  const auth=init?.authMethods||[];const method=env.GEMINI_API_KEY?'gemini-api-key':'oauth-personal';if(auth.some(a=>a.id===method))await client.call('authenticate',{methodId:method},120000).catch(()=>{});
  const mcp=[...(browserMcp&&run.webAccess!==false?[{name:'browser',...browserMcp}]:[]),...(extraMcp||[])].map(m=>({name:m.name,command:m.command,args:m.args||[],env:Object.entries(m.env||{}).map(([name,value])=>({name,value:String(value)}))}));
  let session;if(sessionId&&init?.agentCapabilities?.loadSession){try{await client.call('session/load',{sessionId,cwd,mcpServers:mcp},120000);session={sessionId}}catch{}}
  if(!session){session=await client.call('session/new',{cwd,mcpServers:mcp},120000);sessionId=null}
  run.sessionId=session.sessionId;onSession?.(session.sessionId);if(session.models?.availableModels?.length)onModels?.(session.models.availableModels);
  const content=[{type:'text',text:(sessionId?'':INSTRUCTIONS+(run.extraInstructions||'')+'\n\n')+(run.mode==='plan'?PLAN_PROMPT:'')+prompt}];
  if(init?.agentCapabilities?.promptCapabilities?.image)for(const img of run.images||[])content.push({type:'image',mimeType:img.type,data:readFileSync(img.path).toString('base64')});
  const result=await client.call('session/prompt',{sessionId:session.sessionId,prompt:content});
  const tc=result?._meta?.quota?.token_count||result?.usage;if(tc){run.usage.calls++;run.usage.input+=tc.input_tokens||tc.inputTokens||0;run.usage.output+=tc.output_tokens||tc.outputTokens||0}
  finish(result?.stopReason==='cancelled'||run.stopped?'stopped':result?.stopReason==='refusal'?'failed':'complete',result?.stopReason==='refusal'?'Gemini declined this request.':null)}
 catch(e){finish(run.stopped?'stopped':'failed',/auth|login|credential/i.test(e.message)?'Gemini needs you to sign in: '+e.message:e.message)}})();
})}

// Google sign-in: ACP "authenticate" with oauth-personal opens the browser; resolves when the CLI has stored credentials.
export function geminiSignIn(gemini,{cwd,env,onOutput=()=>{},timeout=600000}){let child;const p=new Promise((resolve,reject)=>{
 try{child=startAcp(gemini,{cwd,env})}catch(e){return reject(e)}const client=new AcpClient(child);
 child.stderr.on('data',d=>onOutput(String(d)));child.on('error',reject);child.on('close',()=>reject(Error('Gemini closed before sign-in finished.')));
 const timer=setTimeout(()=>reject(Error('Sign-in timed out after 10 minutes. Please retry.')),timeout);timer.unref?.();
 (async()=>{const init=await client.call('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}},60000);
  const methods=(init?.authMethods||[]).map(a=>a.id);if(methods.length&&!methods.includes('oauth-personal'))throw Error('This Gemini CLI does not offer Google sign-in ('+methods.join(', ')+').');
  onOutput('Opening Google sign-in in your browser. Choose your account there; this window updates when it is done.\n');await client.call('authenticate',{methodId:'oauth-personal'});clearTimeout(timer);resolve()})().catch(e=>{clearTimeout(timer);reject(e)})});
 p.child=()=>child;p.finally(()=>setTimeout(()=>killTree(child),500)).catch(()=>{});return p}
