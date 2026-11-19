// Tests for the terminal self-check (app/terminal-check.mjs, SV-1/EN-16) and stale agent reports (app/bottlenecks.mjs, CH-2).
// Run: node --test scripts/terminal-check.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sshTerminal,decide,REFUSED,createTerminalCheck} from '../app/terminal-check.mjs';
import {createBottlenecks,reportStale,REPORT_DAYS} from '../app/bottlenecks.mjs';

const CFG=u=>'model:\n  default: m\nterminal:\n  cwd: /w\n  backend: ssh\n  ssh_host: 127.0.0.1\n  ssh_user: '+u+'\n  ssh_port: 22\n  ssh_key: /k/id_ed25519\nmemory:\n  x: 1\n';
test('sshTerminal: only an ssh terminal with a user; host and port have defaults',()=>{
 assert.deepEqual(sshTerminal(CFG('ag-cove')),{user:'ag-cove',host:'127.0.0.1',port:22,key:'/k/id_ed25519'});
 assert.deepEqual(sshTerminal('terminal:\n  backend: "ssh"\n  ssh_user: ag-bay # its own user\n'),{user:'ag-bay',host:'127.0.0.1',port:22,key:''});
 for(const y of ['terminal:\n  backend: local\n  ssh_user: ag-x\n','terminal:\n  backend: ssh\n','model:\n  default: m\n',''])assert.equal(sshTerminal(y),null,y)});
test('decide: first failure asks the root script once, the second round tells a person; a dead root script is told at once',()=>{
 const T=Date.parse('2026-11-19T09:00:00Z'),f=new Map([['cove','Permission denied (publickey)']]);
 const r1=decide({},f,['bay'],{now:T});assert.equal(r1.repair,true);assert.deepEqual(r1.report,[]);assert.equal(r1.next.cove.n,1);
 const r2=decide(r1.next,f,['bay'],{now:T+5*60e3,lastRepair:T});assert.equal(r2.repair,false,'not again within 30 minutes');assert.equal(r2.report.length,1);
 assert.match(r2.report[0].fix,/09:00 UTC[\s\S]*publickey/);
 const r3=decide({},f,[],{now:T,rootAlive:false});assert.equal(r3.repair,false,'nobody to ask');assert.match(r3.report[0].text,/root script is not running/);assert.match(r3.report[0].fix,/AQEELOS_HOME=/);
 const r4=decide(r2.next,new Map(),['cove','bay'],{now:T+10*60e3});assert.deepEqual(r4.clear,['cove']);assert.deepEqual(r4.next,{});assert.equal(r4.repair,false)});
test('REFUSED: the agents\' own "terminal refused" reports, not other permission problems',()=>{
 for(const t of ['SSH login for ag-x@127.0.0.1 is rejected (publickey)','Terminal backend SSH login fails for ag-x@127.0.0.1','My terminal is down: every call fails','Working SSH publickey authentication for ag-x'])assert.ok(REFUSED.test(t),t);
 for(const t of ['Google says permission denied on the sheet','The n8n tool server is refused by the proxy','Access to the Finance folder'])assert.ok(!REFUSED.test(t),t)});

async function box({alive=true,results}){const HOME=await mkdtemp(path.join(tmpdir(),'term-')),HH=path.join(HOME,'.hermes');
 for(const a of ['cove','bay','plain']){await mkdir(path.join(HH,'profiles',a),{recursive:true});await writeFile(path.join(HH,'profiles',a,'config.yaml'),a==='plain'?'terminal:\n  backend: local\n':CFG('ag-'+a))}
 await writeFile(path.join(HOME,'.aqeelos-agent-users'),'cove\nbay\n');let clock=Date.parse('2026-11-19T09:00:00Z');
 if(alive)await writeFile(path.join(HOME,'.aqeelos-agent-users.alive'),String(Math.floor(clock/1000)-20));
 const probs=[],oks=[],closed=[],tried=[];
 const c=createTerminalCheck({HOME,HERMES_HOME:HH,listAgents:async()=>['cove','bay','plain','cove--sub'],log:()=>{},now:()=>clock,
  problem:async(...x)=>{probs.push(x)},ok:async(...x)=>{oks.push(x)},closeReports:async(a,re)=>{closed.push([a,re===REFUSED]);return 0},
  probe:async s=>{tried.push(s.user);return results[s.user]}});
 return {c,HOME,probs,oks,closed,tried,later:ms=>{clock+=ms},alive:async()=>writeFile(path.join(HOME,'.aqeelos-agent-users.alive'),String(Math.floor(clock/1000)-20))}}
test('a refused terminal: the users list is touched for the root script, then a Health item; once it logs in the item clears',async()=>{
 const results={'ag-cove':{ok:false,err:'Permission denied (publickey).'},'ag-bay':{ok:true}};const b=await box({results});
 const before=(await stat(path.join(b.HOME,'.aqeelos-agent-users'))).mtimeMs;b.later(1000);
 const r=await b.c.once();assert.deepEqual(b.tried.sort(),['ag-bay','ag-cove'],'only agents with an ssh terminal, each once');assert.deepEqual(r.fails,['cove']);assert.equal(r.repair,true);
 assert.ok((await stat(path.join(b.HOME,'.aqeelos-agent-users'))).mtimeMs>before,'the root script sees the list changed');assert.equal(b.probs.length,0,'not yet: the repair gets one round');
 b.later(5*60e3);await b.alive();await b.c.once();assert.equal(b.probs.length,1);assert.deepEqual(b.probs[0].slice(0,2),['cove','terminal']);
 results['ag-cove']={ok:true};b.later(5*60e3);await b.alive();await b.c.once();assert.deepEqual(b.oks,[['cove','terminal']]);
 assert.ok(b.closed.some(([a,re])=>a==='cove'&&re),'its own "refused" reports are closed')});
test('the root script not running: told at once, nothing touched; tick runs at most every 5 minutes',async()=>{
 const b=await box({alive:false,results:{'ag-cove':{ok:false,err:'Connection refused'},'ag-bay':{ok:false,err:'Connection refused'}}});
 const before=(await stat(path.join(b.HOME,'.aqeelos-agent-users'))).mtimeMs;const r=await b.c.tick();assert.equal(r.repair,false);assert.equal(b.probs.length,2);
 assert.equal((await stat(path.join(b.HOME,'.aqeelos-agent-users'))).mtimeMs,before);assert.equal(await b.c.tick(),null,'too soon');b.later(5*60e3);assert.ok(await b.c.tick())});

test('agent reports: one not repeated for 3 days is no longer shown, a new report of it shows again; closeReports closes only what matches',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'bn-'));let clock=Date.parse('2026-11-12T09:00:00Z');
 const bn=createBottlenecks({DATA,dash:async()=>[],listAgents:async()=>[],names:a=>a,now:()=>clock});const shown=async()=>(await bn.list({admin:false,mayUse:()=>true})).filter(x=>x.kind==='report').map(x=>x.missing);
 await bn.report('cove',{missing:'The payment keys are missing from my folder'});await bn.report('cove',{missing:'SSH login for ag-cove is rejected (publickey)'});await bn.report('bay',{missing:'SSH login for ag-bay is rejected (publickey)'});
 assert.equal((await shown()).length,3);
 clock+=REPORT_DAYS*864e5+60e3;assert.deepEqual(await shown(),[],'all three are older than 3 days');assert.equal(reportStale({updated:clock-60e3},clock),false);
 await bn.report('cove',{missing:'The payment keys are missing from my folder'});assert.deepEqual(await shown(),['The payment keys are missing from my folder'],'reported again: shown again');
 assert.equal(await bn.closeReports('cove',REFUSED),1);assert.equal(await bn.closeReports('cove',REFUSED),0,'already closed');
 clock-=REPORT_DAYS*864e5;assert.deepEqual((await shown()).sort(),['SSH login for ag-bay is rejected (publickey)','The payment keys are missing from my folder'],'the other agent\'s and the other report stay')});
