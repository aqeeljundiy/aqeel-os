import {spawn} from 'node:child_process';

// Effort levels each CLI accepts; the build request is validated against these.
export const EFFORTS={codex:['none','minimal','low','medium','high','xhigh','max','ultra'],claude:['low','medium','high','xhigh','max'],gemini:[],aqeelos:['none','minimal','low','medium','high','xhigh','max','ultra']};   // aqeelos: the chat's effort levels (engine runs)

// A model id: letters, digits and . _ : / -, plus the context suffix the engine's Claude sign-in names its models with
// (claude-sonnet-5-5[1m]). Code's checks had no brackets, so every such model was left out of the list and refused as a run's model:
// with the Claude sign-in only Haiku 4.5 was offered (15 Nov 2026).
export const modelIdOk=id=>/^[a-zA-Z0-9._:/-]{1,80}(\[[0-9]{1,4}[km]\])?$/.test(String(id));
// claude-opus-4-5-20251101 → Opus 4.5, gpt-5.1-codex-max → GPT-5.1 Codex Max, claude-sonnet-5-5[1m] → Sonnet 5.5 1M (a model Code has no name for)
export const niceModel=id=>{const s=String(id),x=/\[(\d+)([km])\]$/i.exec(s),b=x?s.slice(0,x.index):s;
 return b.replace(/^claude-/,'').replace(/-\d{8}$/,'').replace(/-(\d+)-(\d+)(?=-|$)/g,' $1.$2').split(/[-\s]+/).map(w=>/^gpt$/i.test(w)?'GPT':w.charAt(0).toUpperCase()+w.slice(1)).join(' ').replace(/^GPT (\d)/,'GPT-$1')+(x?' '+x[1]+x[2].toUpperCase():'')};

// Claude Code takes aliases that always resolve to the newest model of each family.
export const CLAUDE_MODELS=[
 {id:'',name:'Default',description:'Claude Code’s default model for your plan.',efforts:EFFORTS.claude,defaultEffort:''},
 {id:'fable',name:'Fable',description:'Most capable Claude model.',efforts:EFFORTS.claude,defaultEffort:''},
 {id:'opus',name:'Opus',description:'Deep reasoning for complex builds.',efforts:EFFORTS.claude,defaultEffort:''},
 {id:'sonnet',name:'Sonnet',description:'Fast, strong everyday coding.',efforts:EFFORTS.claude,defaultEffort:''},
 {id:'haiku',name:'Haiku',description:'Quickest and lightest.',efforts:EFFORTS.claude,defaultEffort:''}
];

// Asks the installed Codex for its live model catalog over the app-server protocol.
export function listCodexModels(executable,env,cwd){return new Promise(resolve=>{
 let child;try{child=spawn(executable,['app-server','--listen','stdio://'],{env,cwd,windowsHide:true,shell:false})}catch{return resolve([])}
 let buffer='',done=false;
 const finish=list=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolve(list)};
 const send=data=>child.stdin.write(JSON.stringify(data)+'\n');
 const timer=setTimeout(()=>finish([]),15000);
 child.on('error',()=>finish([]));child.on('close',()=>finish([]));child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
 child.stdout.on('data',data=>{buffer+=data;if(buffer.length>2000000)return finish([]);let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let message;try{message=JSON.parse(line)}catch{continue}
  if(message.id===0){if(message.error)return finish([]);send({method:'initialized'});send({id:1,method:'model/list',params:{}})}
  if(message.id===1){const data=message.result?.data;if(!Array.isArray(data))return finish([]);
   finish(data.filter(m=>!m.hidden&&typeof m.model==='string').map(m=>({id:m.model,name:m.displayName||m.model,description:m.description||'',efforts:(m.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort).filter(e=>EFFORTS.codex.includes(e)),defaultEffort:m.defaultReasoningEffort||'',isDefault:Boolean(m.isDefault)})))}
 }});
 send({id:0,method:'initialize',params:{clientInfo:{name:'code_by_aqeel',title:'aqeelOS Code',version:'0.1.0'}}});
})}
