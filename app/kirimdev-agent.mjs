// One durable engine thread per agent + phone line + customer conversation.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
export function conversationSession(agent,line,conversation,epoch=''){
 return 'kirimdev-'+createHash('sha256').update(JSON.stringify([agent,String(line),String(conversation),epoch])).digest('hex');
}
// customer runs (7 Nov 2026, audit E7): with customer() (customer-tools.mjs) a run gets ONLY the aqeelos-customer tool server
// (engine -t aqeelos-customer: no shell, no files, no other tools) and its own key for this one conversation, given to the
// engine as TERMINAL_AQEELOS_CUSTOMER_RUN (the server's header in config.yaml is \${TERMINAL_AQEELOS_CUSTOMER_RUN})
export const CUSTOMER_TOOLSET='aqeelos-customer';
export function createKirimdevAgent({DATA,home,live,execute=execFile,customer=null}){
 return async(agent,query,{session,run}={})=>{
  if(!live)throw Error('not on the live box');
  if(!/^kirimdev-[a-f0-9]{64}$/.test(session||''))throw Error('Missing isolated Kirimdev session');
  await mkdir(DATA,{recursive:true});
  const file=path.join(DATA,'kirimdev-query-'+randomUUID()+'.txt');let token=null;
  try{
   await writeFile(file,query,{mode:0o600,flag:'wx'});
   const c=customer?.();token=c&&run?c.begin({agent,...run}):null;
   return await new Promise((resolve,reject)=>execute(path.join(home,'.local','bin','hermes'),
    ['-p',agent,'chat','--oneshot','-Q','--source','tool',...(token?['-t',CUSTOMER_TOOLSET]:[]),'--continue',session,'--create-if-missing','--no-restore-cwd','--query-file',file],
    {cwd:path.join(home,'workspaces',agent),timeout:400e3,maxBuffer:4e6,...(token?{env:{...process.env,TERMINAL_AQEELOS_CUSTOMER_RUN:token}}:{})},
    (error,out)=>error?reject(Error('the agent stopped ('+(error.code??error.signal)+')')):resolve(String(out||''))));
  }finally{await unlink(file).catch(()=>{});if(token)customer?.()?.end(token)}
 };
}
