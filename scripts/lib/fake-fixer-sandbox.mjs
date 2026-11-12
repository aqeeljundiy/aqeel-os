// A fixer user that is always ready, for tests of the fixer loop (AUD-6: no fixer run starts without one, so a loop test needs one).
// It confines nothing: the tests' fake `launch` plays the engine. Every run is planned as confined, in the mode it asks for.
import path from 'node:path';import {tmpdir} from 'node:os';
export const fakeFixerSandbox=({journal={},added={}}={})=>({
 plan:async(pol,i,{mode='code'}={})=>({confine:true,mode,variant:{name:'env',args:[]}}),
 prepareDir:async()=>({ok:true}),clean:async()=>{},scratch:id=>path.join(tmpdir(),'fx-scratch-'+id),
 launch:({workDir,issue,run})=>({url:'http://127.0.0.1:4400/fixer-ops/'+issue+'/'+run+'/'+'a'.repeat(32),workDir,args:['-t','terminal,file'],env:{TERMINAL_ENV:'ssh',TERMINAL_SSH_USER:'aq-fixer'}}),
 help:()=>({repairs:[{action:'soul_rule',args:'agent, rule',does:'Add one rule.'}],checks:[{check:'agent_log',args:'agent',does:'A log tail.'}]}),
 journal:async run=>journal[run]||null,added:async run=>added[run]||[],recordCanary:async()=>{}});
