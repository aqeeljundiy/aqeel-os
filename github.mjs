import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';

const FALLBACK={gh:['C:/Program Files/GitHub CLI/gh.exe'],git:['C:/Program Files/Git/cmd/git.exe','C:/Program Files/Git/bin/git.exe']};
export async function locate(name,findExecutable){
 const found=await findExecutable(name);if(found)return found;
 for(const p of FALLBACK[name]||[]){try{await access(p);return p}catch{}}return null;
}

export function tool(exe,args,{cwd,env,timeout=180000}={}){return new Promise(resolve=>{
 let stdout='',stderr='',done=false;const child=spawn(exe,args,{cwd,env,windowsHide:true,shell:false});
 const finish=r=>{if(done)return;done=true;clearTimeout(timer);resolve(r)};
 const timer=setTimeout(()=>{child.kill();finish({code:-1,stdout,stderr:stderr+'\nTimed out.'})},timeout);
 child.stdout.on('data',d=>{stdout=(stdout+d).slice(-200000)});child.stderr.on('data',d=>{stderr=(stderr+d).slice(-20000)});
 child.on('error',e=>finish({code:-1,stdout,stderr:e.message}));child.on('close',code=>finish({code,stdout,stderr}));child.stdin.end();
})}

// Accepts owner/name, https://github.com/owner/name(.git) or git@github.com:owner/name(.git)
export function normalizeRepo(input){
 const s=String(input||'').trim().replace(/\.git$/,'').replace(/\/+$/,'');
 const m=s.match(/^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/);
 if(!m||m[2]==='.'||m[2]==='..')throw Error('Enter a GitHub repository like owner/name or its github.com link.');
 return m[1]+'/'+m[2];
}

// git status --porcelain=v2 --branch
export function parseStatus(text){
 const status={branch:null,upstream:null,ahead:0,behind:0,changed:0,conflicts:0};
 for(const line of String(text).split('\n')){
  if(line.startsWith('# branch.head '))status.branch=line.slice(14).trim();
  else if(line.startsWith('# branch.upstream '))status.upstream=line.slice(18).trim();
  else if(line.startsWith('# branch.ab ')){const m=line.match(/\+(\d+) -(\d+)/);if(m){status.ahead=+m[1];status.behind=+m[2]}}
  else if(/^[12u?] /.test(line)){status.changed++;if(line.startsWith('u '))status.conflicts++}
 }
 if(status.branch==='(detached)')status.branch='detached';
 return status;
}

// accounts from `gh auth status`: [{user, active}]
export function parseAccounts(text){const out=[];let cur=null;for(const line of String(text).split(/\r?\n/)){const m=line.match(/Logged in to github\.com (?:account|as) ([\w-]+)/);if(m){cur={user:m[1],active:false};out.push(cur);continue}if(cur&&/Active account:\s*true/.test(line))cur.active=true}if(out.length===1)out[0].active=true;return out}
