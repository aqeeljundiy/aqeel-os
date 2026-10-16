import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function exhausted(limits,now=Date.now()/1000){
 const bucket=limits?.rateLimitsByLimitId?.codex||limits?.rateLimits;
 return [bucket?.primary,bucket?.secondary].some(w=>typeof w?.usedPercent==='number'&&w.usedPercent>=100&&(!w.resetsAt||w.resetsAt>now));
}

export function readCodexAccount(executable,env,cwd){return new Promise(resolve=>{
 const child=spawn(executable,['app-server','--listen','stdio://'],{env,cwd,windowsHide:true,shell:false});
 let buffer='',account=null,done=false;
 const finish=data=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolve(data)};
 const send=data=>child.stdin.write(JSON.stringify(data)+'\n');
 const timer=setTimeout(()=>finish({account,limits:null,detail:'Account or usage check timed out.'}),15000);
 child.on('error',()=>finish({account:null,limits:null,detail:'Account details unavailable.'}));
 child.on('close',()=>finish({account,limits:null,detail:'Account details unavailable.'}));
 child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
 child.stdout.on('data',data=>{buffer+=data;if(buffer.length>1000000)return finish({account,limits:null});let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let message;try{message=JSON.parse(line)}catch{continue}
  if(message.id===0){if(message.error)return finish({account:null,limits:null});send({method:'initialized'});send({id:1,method:'account/read',params:{refreshToken:false}})}
  if(message.id===1){const a=message.result?.account;account=a?{type:a.type,email:a.email||null,plan:a.planType||null}:null;if(account?.type!=='chatgpt')return finish({account,limits:null});send({id:2,method:'account/rateLimits/read'})}
  if(message.id===2){const r=message.result;finish({account,limits:r?{rateLimits:r.rateLimits,rateLimitsByLimitId:r.rateLimitsByLimitId}:null,detail:message.error?'Usage unavailable.':null})}
 }});
 send({id:0,method:'initialize',params:{clientInfo:{name:'aqeel_code',title:'code by aqeel',version:'0.1.0'}}});
})}

export class Accounts {
 constructor(root,env,provider='codex'){this.provider=provider;this.name=provider==='claude'?'Claude':'Codex';this.root=path.join(root,'data',provider==='codex'?'accounts':'accounts-claude');this.file=path.join(this.root,'profiles.json');this.baseEnv=env;this.queue=Promise.resolve()}
 async init(){await mkdir(this.root,{recursive:true});try{this.state=JSON.parse(await readFile(this.file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;this.state={profiles:[{id:'desktop',label:'Desktop account',provider:this.provider}],active:'desktop',autoSwitch:false};await this.save()}return this}
 async save(){await writeFile(this.file+'.tmp',JSON.stringify(this.state,null,2));await rename(this.file+'.tmp',this.file)}
 profile(id=this.state.active){const p=this.state.profiles.find(p=>p.id===id);if(!p)throw Error('Account profile not found.');return p}
 env(id){const p=this.profile(id);return p.id==='desktop'?{...this.baseEnv}:{...this.baseEnv,[this.provider==='codex'?'CODEX_HOME':'CLAUDE_CONFIG_DIR']:path.join(this.root,p.id)}}
 async update(input){const pending=this.queue.then(async()=>{
  if(input.action==='create'){if(typeof input.label!=='string'||!input.label.trim()||input.label.length>60)throw Error('Name the account (up to 60 characters).');if(this.state.profiles.length>=12)throw Error('Up to 12 profiles are supported.');const p={id:randomUUID(),label:input.label.trim(),provider:this.provider};await mkdir(path.join(this.root,p.id));if(this.provider==='codex')await writeFile(path.join(this.root,p.id,'config.toml'),'cli_auth_credentials_store = "file"\n');this.state.profiles.push(p)}
  else if(input.action==='select'){this.profile(input.id);this.state.active=input.id}
  else if(input.action==='settings'){if(typeof input.autoSwitch!=='boolean')throw Error('Invalid switching preference.');this.state.autoSwitch=input.autoSwitch}
  else throw Error('Unknown account action.');await this.save();return this.state
 });this.queue=pending.catch(()=>{});return pending}
 async choose(inspect,{exclude=[],preferred=this.state.active}={}){
  const primary=this.profile(preferred);const candidates=this.state.autoSwitch?[primary,...this.state.profiles.filter(p=>p.id!==primary.id)]:[primary];
  for(const p of candidates){if(exclude.includes(p.id))continue;const info=await inspect(p.id);if(p.id===preferred&&!info.ready)throw Error(info.message||'Sign in to the selected account.');if(info.ready&&!info.exhausted&&!exhausted(info.limits))return {...info,profileId:p.id,profileLabel:p.label,switched:p.id!==preferred};if(p.id===preferred&&!this.state.autoSwitch)throw Error('This '+this.name+' account has reached its usage limit. Choose another account or enable automatic switching.')}
  throw Error('No available '+this.name+' account. Add or sign in to another profile, or wait for the usage limit to reset.');
 }
}
