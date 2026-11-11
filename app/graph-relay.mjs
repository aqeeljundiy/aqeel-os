// The free route for reading documents into an agent's map (owner, 11 Nov 2026: "graphify reads documents through the
// FREE Gemini route, never a paid key and never forced Claude").
// graphify's document pass needs an OpenAI-style HTTP endpoint (OPENAI_BASE_URL) or a key. The owner's free route is the
// Google AI plan through Antigravity's `agy` command (engine/antigravity-subscription), which is a program, not an endpoint,
// and its Gemini CLI route is closed ("no longer supported", checked 11 Nov on Elkiya). So this is a tiny relay that lives
// only while a map run lasts: it listens on 127.0.0.1 on a random port with a one-run key, turns each
// /v1/chat/completions request into one `agy --print` call, and hands the text back. Same safety as the engine plugin:
// agy runs in a fresh empty folder with a text-only agent that has no tools, a tool step ends the request, and agy's own
// copy of the conversation is deleted afterwards. Only Gemini models are accepted (a Claude or GPT name is refused), so
// nothing can be sent to a paid or other-vendor route by mistake; the relay passes nothing but the prompt graphify built
// from the document (never the agent's instructions or memory). A quota answer from the plan is reported, not retried.
import {spawn as nodeSpawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';

export const FREE_MODEL='gemini-3.8-flash-low';   // agy's own default model was out of quota on 11 Nov; a model is always named
export const isFreeModel=m=>/^gemini-[a-z0-9.-]+$/i.test(String(m||''));
export const isQuota=t=>/RESOURCE_EXHAUSTED|quota reached|\b429\b|rate.?limit/i.test(String(t||''));
const AGENT='aqeelos-relay';
const AGENT_MD=`---
name: ${AGENT}
description: Text-only relay for aqeelOS. Writes the reply as text and never uses tools of its own.
mainAgent: true
subagent: false
excludeDefaultComponents: true
inheritMcp: false
commandExecutionPolicy: "off"
tools: []
---
You are the language model behind aqeelOS. You have no tools of your own in this session: never call, request or
mention tools such as files, terminal or browsing. Everything you need is in the prompt. Reply with exactly what the prompt asks for.
`;

// one prompt from the chat messages (system first, in order)
export function promptOf(messages){return (Array.isArray(messages)?messages:[]).map(m=>{const c=Array.isArray(m?.content)?m.content.map(p=>p?.text||'').join(''):String(m?.content??'');
 return (m?.role==='system'?'[Instructions]\n':m?.role==='assistant'?'[Earlier answer]\n':'')+c}).join('\n\n')}

export function createRelay({spawn=nodeSpawn,home=homedir(),agy=null,env=process.env,log=()=>{},timeoutMs=5*60e3}={}){
 const bin=agy||path.join(home,'.local','bin','agy'),AGY_HOME=path.join(home,'.gemini','antigravity-cli');
 const childEnv={PATH:path.join(home,'.local','bin')+path.delimiter+(env.PATH||'/usr/bin:/bin'),HOME:home,AGY_CLI_DISABLE_AUTO_UPDATE:'true'};
 // one agy call: the text it answers, or an Error (.quota when the plan's limit is reached)
 async function ask(prompt,model){const work=await mkdtemp(path.join(tmpdir(),'aqeelos-agy-'));let conv='';
  try{await mkdir(path.join(work,'.agents','agents'),{recursive:true});await writeFile(path.join(work,'.agents','agents',AGENT+'.md'),AGENT_MD);
   const args=['--agent',AGENT,'--input-format','stream-json','--output-format','stream-json','--disable-slash-commands','--log-file',path.join(work,'agy.log'),'--print-timeout',Math.round(timeoutMs/1000)+'s','--model',model];
   const p=spawn(bin,args,{cwd:work,env:childEnv,stdio:['pipe','pipe','pipe']});
   return await new Promise((res,rej)=>{let buf='',done=false,final=null,bad='',err='';
    const end=(e,v)=>{if(done)return;done=true;clearTimeout(timer);e?rej(e):res(v)};
    const timer=setTimeout(()=>{try{p.kill()}catch{}end(new Error('The model did not answer in time.'))},timeoutMs+30e3);
    p.stderr?.on('data',d=>{err=(err+d).slice(-600)});
    p.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);let ev;try{ev=JSON.parse(line)}catch{continue}
     if(ev.event==='init'){conv=String(ev.conversation_id||conv);if((ev.init||{}).agent&&ev.init.agent!==AGENT)bad='agy started a different agent'}
     else if(ev.event==='step_update'){const st=ev.step_update||{},n=String(st.tool_name||st.tool_info?.name||'');if(st.step_type==='tool'&&n!=='manage_task')bad='agy tried to use its own tool '+n}
     else if(ev.event==='result')final=ev.result||{};
     if(bad){try{p.kill()}catch{}}}});
    p.on('error',e=>end(new Error('agy could not start: '+e.message)));
    p.on('close',()=>{if(bad)return end(new Error('Stopped for safety: '+bad+'.'));
     if(!final){const e=new Error('Antigravity gave no answer'+(err.trim()?': '+err.trim():'.'));e.quota=isQuota(err);return end(e)}
     if(String(final.status)!=='SUCCESS'){const m=String(final.error||final.status||'unknown error');const e=new Error('Antigravity: '+m);e.quota=isQuota(m);return end(e)}
     end(null,String(final.response||'').trim())});
    p.stdin.on('error',()=>{});p.stdin.end(JSON.stringify({event:'user',message:{content:prompt}})+'\n')})}
  finally{await rm(work,{recursive:true,force:true}).catch(()=>{});
   // agy's own copy of the conversation: aqeelOS keeps what it needs, agy keeps nothing
   if(conv&&/^[\w-]+$/.test(conv))for(const d of ['conversations','brain','annotations'])for(const f of await readdir(path.join(AGY_HOME,d)).catch(()=>[]))if(f.startsWith(conv))await rm(path.join(AGY_HOME,d,f),{recursive:true,force:true}).catch(()=>{})}}
 // start(): {url (the /v1 base), key, model, stats, stop()}. onQuota() is called once when the plan says its limit is reached.
 async function start({model=FREE_MODEL,onQuota=()=>{}}={}){if(!isFreeModel(model))throw new Error('Only a Gemini model may be used for documents ("'+model+'" is not).');
  const key=randomBytes(24).toString('hex'),stats={requests:0,quota:false,error:null};let chain=Promise.resolve();
  const server=createServer((req,res)=>{const send=(c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
   if(req.headers.authorization!=='Bearer '+key)return send(401,{error:{message:'Wrong key.'}});
   if(req.method==='GET'&&/\/models$/.test(req.url))return send(200,{object:'list',data:[{id:model,object:'model'}]});
   if(req.method!=='POST'||!/\/chat\/completions$/.test(req.url))return send(404,{error:{message:'Not here.'}});
   let b='';req.on('data',d=>{b+=d;if(b.length>8e6)req.destroy()});
   req.on('end',()=>{let j;try{j=JSON.parse(b)}catch{return send(400,{error:{message:'Not JSON.'}})}
    // graphify names the model it was told to use; anything but a Gemini name is refused
    const m=j.model&&isFreeModel(j.model)?j.model:model;if(j.model&&!isFreeModel(j.model))return send(400,{error:{message:'Only Gemini models are available here.'}});
    const prompt=promptOf(j.messages);stats.requests++;
    chain=chain.then(()=>stats.quota?Promise.reject(Object.assign(new Error('The plan\'s limit was reached.'),{quota:true})):ask(prompt,m)).then(text=>{
     const body={id:'chatcmpl-'+randomBytes(6).toString('hex'),object:'chat.completion',created:Math.floor(Date.now()/1000),model:m,choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}],usage:{prompt_tokens:Math.ceil(prompt.length/4),completion_tokens:Math.ceil(text.length/4),total_tokens:Math.ceil((prompt.length+text.length)/4)}};
     if(j.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({...body,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({...body,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return res.end()}
     send(200,body)},e=>{stats.error=e.message;if(e.quota&&!stats.quota){stats.quota=true;try{onQuota()}catch{}}log('graph relay: '+e.message);send(e.quota?429:502,{error:{message:e.message,type:e.quota?'insufficient_quota':'upstream_error'}})})})});
  await new Promise((res,rej)=>{server.once('error',rej);server.listen(0,'127.0.0.1',res)});
  const port=server.address().port;
  return {url:'http://127.0.0.1:'+port+'/v1',key,model,stats,stop:()=>new Promise(r=>{server.close(()=>r());server.closeAllConnections?.()})}}
 return {start,ask}}
