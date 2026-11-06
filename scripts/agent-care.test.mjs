// Tests for agents keeping their own work working (app/agent-care.mjs). Run: node --test scripts/agent-care.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAgentCare,scriptOnlyCommand,wrapperScript,namedFiles} from '../app/agent-care.mjs';

const WATCHDOG='Run exactly this terminal command: python3 /home/claude/workspaces/continue-support/test_chat_watchdog.py\nIf it prints nothing, your entire final response must be exactly: [SILENT]\nIf it prints text, your final response must be that text exactly, unchanged. Do nothing else: never send WhatsApp messages.';

test('only a prompt that just runs one command and passes its output on becomes script-only',()=>{
 assert.equal(scriptOnlyCommand(WATCHDOG),'python3 /home/claude/workspaces/continue-support/test_chat_watchdog.py');
 assert.equal(scriptOnlyCommand('Run exactly this terminal command and nothing else: bash /x/y.sh\nReply with its output unchanged, or [SILENT] if empty.'),'bash /x/y.sh');
 assert.equal(scriptOnlyCommand('Check the sheet and run exactly this terminal command: x\n[SILENT] exactly'),null);
 assert.equal(scriptOnlyCommand('Run exactly this terminal command: x\nThen summarize it for the team. [SILENT] if nothing, exactly.'),null);
 assert.equal(scriptOnlyCommand('Run exactly this terminal command: x\nPost the result.'),null);
 const w=wrapperScript({agent:'a',user:'ag-a',key:'/k',cwd:'/w/a',cmd:"python3 x.py 'q' && echo \"$HOME\""});
 const b64=/echo (\S+) \| base64/.exec(w)[1];assert.equal(Buffer.from(b64,'base64').toString(),"python3 x.py 'q' && echo \"$HOME\"");assert.match(w,/'ag-a@127\.0\.0\.1'/);
 assert.deepEqual(namedFiles('cd /x && python3 /home/claude/workspaces/a/run.py --x /home/claude/workspaces/a/*.json'),['/home/claude/workspaces/a/run.py'])});

async function make(){const H=await mkdtemp(path.join(tmpdir(),'ac-')),W=path.join(H,'work');const P=path.join(H,'profiles','continue-support');
 await mkdir(path.join(P,'skills','support','kirim'),{recursive:true});await mkdir(path.join(W,'continue-support','.secrets'),{recursive:true});await mkdir(path.join(W,'continue-support','.tools'),{recursive:true});
 await writeFile(path.join(P,'SOUL.md'),'You are Randy. If replies stop, ask Donna to restart the bridge.\n');
 await writeFile(path.join(P,'skills','support','kirim','SKILL.md'),'Send with .tools/kirim.\n');
 await writeFile(path.join(W,'continue-support','test_chat_watchdog.py'),'print("The test bridge looks down")\n');
 await writeFile(path.join(W,'continue-support','old.py.bak-20261107'),'bridge.py\n');
 await writeFile(path.join(W,'continue-support','.secrets','XENDIT_SECRET_KEY'),'x',{mode:0o600});await writeFile(path.join(W,'continue-support','.secrets','OK_KEY'),'x',{mode:0o660});
 const jobs=[{id:'9f44a475a77b',name:'test chats watchdog',prompt:WATCHDOG.replace('/home/claude/workspaces',W),enabled:true},{id:'b2',name:'gone',prompt:'Run python3 '+W+'/continue-support/missing.py and report.',enabled:true},{id:'b3',name:'paused',prompt:'python3 '+W+'/continue-support/missing2.py',enabled:false}];
 const updates=[],records=[],set={};let sshOut='';
 const cfg={terminal:{backend:'ssh',ssh_user:'ag-continue-support',cwd:path.join(W,'continue-support')}};
 const care=createAgentCare({HERMES_HOME:H,WORK:W,homes:async()=>['continue-support'],readConfig:async()=>cfg,pick:(c,k)=>k.split('.').reduce((o,x)=>o?.[x],c),jobs:async()=>jobs,
  updateJob:async(a,id,up)=>{updates.push([a,id,up]);Object.assign(jobs.find(j=>j.id===id),up)},record:async(a,e)=>records.push([a,e]),
  notices:{setNotices:async(a,k,l)=>{set[k]=l;return {}}},run:async(cmd,args)=>({ok:true,out:sshOut==='real'?((await stat(path.join(W,'continue-support','.secrets','XENDIT_SECRET_KEY'))).mode&0o040?'':'XENDIT_SECRET_KEY\n'):sshOut}),log:()=>{}});
 return {care,H,W,P,jobs,updates,records,set,setSsh:o=>{sshOut=o}}}

test('old setup in the agent\'s own instructions, scripts and schedules becomes a notice; backups are skipped',async()=>{const {care}=await make();
 const o=await care.oldSetup('continue-support');const where=o.map(x=>x.text.split(' still says')[0]).sort();
 assert.deepEqual(where,['test_chat_watchdog.py','your instructions (SOUL.md)']);assert.match(o[0].text,/there is no bridge/)});

test('checks: missing script files of running schedules, and keys the agent\'s own user cannot read (given back their rights)',async()=>{const {care,W,set,setSsh}=await make();
 setSsh('XENDIT_SECRET_KEY\n');const c=await care.checks('continue-support');
 assert.deepEqual(c.map(x=>x.key).sort(),['file|b2|'+W+'/continue-support/missing.py','secret|XENDIT_SECRET_KEY']);
 setSsh('real');const r=await care.tick({force:true});assert.equal(r['continue-support'].fixed,1);
 assert.equal((await stat(path.join(W,'continue-support','.secrets','XENDIT_SECRET_KEY'))).mode&0o070,0o060);
 assert.deepEqual(set.checks.map(x=>x.key),['file|b2|'+W+'/continue-support/missing.py']);assert.equal(set['old-setup'].length,2)});

test('a script-only schedule runs without a model, as the agent\'s own user, and is recorded as a version',async()=>{const {care,P,W,updates,records,jobs}=await make();
 assert.deepEqual(await care.scriptOnly('continue-support'),['9f44a475a77b']);
 assert.deepEqual(updates,[['continue-support','9f44a475a77b',{no_agent:true,script:'aq-job-9f44a475a77b.sh'}]]);
 const w=await readFile(path.join(P,'scripts','aq-job-9f44a475a77b.sh'),'utf8');assert.match(w,/ag-continue-support@127\.0\.0\.1/);assert.match(w,new RegExp("cd '"+W+"/continue-support'"));
 assert.equal((await stat(path.join(P,'scripts','aq-job-9f44a475a77b.sh'))).mode&0o777,0o700);assert.match(records[0][1].what,/without a model turn/);
 assert.deepEqual(await care.scriptOnly('continue-support'),[]);assert.equal(jobs[1].no_agent,undefined)});

test('the key register keeps no values; it finds keys gone, two different copies, and one key in several agents',async()=>{const {H,W}=await make();const D=path.join(H,'data');let t=1e12;const set={};
 await mkdir(path.join(H,'profiles','default--whatsapp-2'),{recursive:true});
 await writeFile(path.join(H,'.env'),'TELEGRAM_BOT_TOKEN=12345:abcdefghij\nANTHROPIC_API_KEY=sk-shared-123456\nSHORT_KEY=abc\n');
 await writeFile(path.join(H,'profiles','default--whatsapp-2','.env'),'TELEGRAM_BOT_TOKEN=12345:abcdefghij\nANTHROPIC_API_KEY=sk-shared-123456\n');
 await writeFile(path.join(H,'profiles','continue-support','.env'),'XENDIT_SECRET_KEY=xnd_one_value_123\nKIRIMDEV_API_KEY=kd_value_12345678\n');
 await writeFile(path.join(W,'continue-support','.secrets','XENDIT_SECRET_KEY'),'xnd_other_value_99\n');
 const care=createAgentCare({HERMES_HOME:H,WORK:W,DATA:D,fpKey:async()=>'k',homes:async()=>['default','continue-support','default--whatsapp-2'],readConfig:async()=>({}),pick:()=>null,jobs:async()=>[],updateJob:async()=>{},
  notices:{setNotices:async(a,k,l)=>{set[a+'/'+k]=l}},log:()=>{},now:()=>t});
 assert.deepEqual(await care.keysTick(),{shared:1});
 assert.match(set['default/keys-shared'][0].text,/default--whatsapp-2:TELEGRAM_BOT_TOKEN, default:TELEGRAM_BOT_TOKEN/);
 assert.deepEqual(set['continue-support/keys'].map(x=>x.key),['differ|XENDIT_SECRET_KEY']);
 const reg=await readFile(path.join(D,'agent-live','keys.json'),'utf8');assert.doesNotMatch(reg,/xnd_|kd_value|abcdefghij|sk-shared/);
 await writeFile(path.join(H,'profiles','continue-support','.env'),'XENDIT_SECRET_KEY=xnd_other_value_99\n');t+=60e3;await care.keysTick();
 assert.deepEqual(set['continue-support/keys'].map(x=>x.key),['gone|KIRIMDEV_API_KEY']);assert.match(set['continue-support/keys'][0].text,/gone from \.env since/)});
