import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {killTree} from './platform.mjs';

export class LoginConsole {
 constructor({cwd,env,findExecutable,spawnProcess=spawn,geminiSignIn}){Object.assign(this,{cwd,env,findExecutable,spawnProcess,geminiSignIn});this.session=null}
 snapshot(){const s=this.session;return s?{id:s.id,provider:s.provider,profileId:s.profileId,profileLabel:s.profileLabel,state:s.state,output:s.output,error:s.error}:null}
 async start(provider,options={}){
  if(!['claude','codex','gemini'].includes(provider))throw Error('Choose Claude, Codex or Gemini.');
  if(this.starting||this.session?.state==='running')throw Error('A sign-in is already running. Finish or stop it first.');
  // Gemini signs in through the browser (ACP authenticate); there is nothing to type here
  if(provider==='gemini'){if(!this.geminiSignIn)throw Error('Gemini CLI is not installed.');const s={id:randomUUID(),provider,state:'running',output:'Starting Gemini sign-in…\n',gemini:true};this.session=s;const add=t=>{s.output=(s.output+String(t).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')).slice(-32000)};
   let p;try{p=(await this.geminiSignIn(add)).promise}catch(e){s.state='failed';s.error=e.message;return this.snapshot()}s.child={kill:()=>killTree(p.child?.()),stdin:{write(){}}};p.then(()=>{if(s.state==='running'){s.state='complete';add('Signed in.\n')}},e=>{if(s.state==='running'){s.state='failed';s.error=e.message}});return this.snapshot()}
  this.starting=true;let executable;try{executable=await this.findExecutable(provider)}finally{this.starting=false}if(!executable)throw Error('The provider tool was not found.');
  const s={id:randomUUID(),provider,profileId:options.profileId,profileLabel:options.profileLabel,state:'running',output:'Starting '+(provider==='claude'?'Claude':'Codex')+' subscription sign-in…\n'};this.session=s;
  const child=this.spawnProcess(executable,provider==='claude'?['auth','login','--claudeai']:['login'],{cwd:this.cwd,env:options.env||this.env,windowsHide:true,shell:false});s.child=child;
  const add=data=>{s.output=(s.output+data.toString().replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')).slice(-32000)};
  child.stdout.on('data',add);child.stderr.on('data',add);child.stdin.on('error',()=>{});
  const finish=(state,error)=>{if(s.state!=='running')return;s.state=state;s.error=error;clearTimeout(s.timer)};
  child.on('error',e=>finish('failed',e.message));child.on('close',code=>finish(code===0?'complete':'failed',code===0?undefined:'Sign-in ended without confirming success. You can retry.'));
  s.timer=setTimeout(()=>{finish('failed','Sign-in timed out after 10 minutes. Please retry.');child.kill()},600000);s.timer.unref?.();return this.snapshot();
 }
 input(id,value){const s=this.session;if(!s||s.id!==id||s.state!=='running')throw Error('No active sign-in.');if(s.gemini)throw Error('Finish Gemini sign-in in your browser.');if(typeof value!=='string'||!value.trim()||value.length>4096)throw Error('Enter the code requested by the provider.');s.child.stdin.write(value.trim()+'\n');return this.snapshot()}
 stop(id){const s=this.session;if(!s||s.id!==id)throw Error('Sign-in not found.');if(s.state==='running'){s.state='stopped';clearTimeout(s.timer);s.child.kill()}return this.snapshot()}
}
