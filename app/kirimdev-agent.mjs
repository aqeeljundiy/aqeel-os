// One durable engine thread per agent + phone line + customer conversation.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
export function conversationSession(agent,line,conversation,epoch=''){
 return 'kirimdev-'+createHash('sha256').update(JSON.stringify([agent,String(line),String(conversation),epoch])).digest('hex');
}
export function createKirimdevAgent({DATA,home,live,execute=execFile}){
 return async(agent,query,{session}={})=>{
  if(!live)throw Error('not on the live box');
  if(!/^kirimdev-[a-f0-9]{64}$/.test(session||''))throw Error('Missing isolated Kirimdev session');
  await mkdir(DATA,{recursive:true});
  const file=path.join(DATA,'kirimdev-query-'+randomUUID()+'.txt');
  try{
   await writeFile(file,query,{mode:0o600,flag:'wx'});
   return await new Promise((resolve,reject)=>execute(path.join(home,'.local','bin','hermes'),
    ['-p',agent,'chat','--oneshot','-Q','--source','tool','--continue',session,'--create-if-missing','--no-restore-cwd','--query-file',file],
    {cwd:path.join(home,'workspaces',agent),timeout:400e3,maxBuffer:4e6},
    (error,out)=>error?reject(Error('the agent stopped ('+(error.code??error.signal)+')')):resolve(String(out||''))));
  }finally{await unlink(file).catch(()=>{})}
 };
}
