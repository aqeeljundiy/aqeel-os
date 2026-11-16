// One agent, not the whole engine (owner, 16 Nov 2026: "why not restart the specific agent? ... I want Donna to have control of it").
// app/agent-reload.mjs decides; scripts/engine-agent.py is the engine side (its verbs were tried on the box: aq-livetest unserved and
// served again in 7.9 s, same engine process; `plugins enable` answered "Gateway reloaded plugins").
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createAgentReload,enableReloaded,isMain} from '../app/agent-reload.mjs';
import {createSharing} from '../app/sharing.mjs';import {createAgentAccess,AGENT_NEEDS} from '../app/agent-access.mjs';

const rig=(answers={})=>{const calls=[],restarts=[],later=[];const r=createAgentReload({homeOf:a=>'/h/'+a,HERMES_HOME:'/h',restartGateway:async w=>{restarts.push(w)},restartLater:async w=>{later.push(w)},log:()=>{},
 run:async args=>{calls.push(args);const k=args[0]+':'+(args[0]==='cycle'?args[2]:args[2].split('/').pop());return k in answers?answers[k]:{ok:true}}});return {r,calls,restarts,later}};

test('a plugin switched on for some agents: each reloads its own, only one that cannot waits for the maintenance window, nobody restarts now',async()=>{
 const {r,calls,restarts,later}=rig({'reload-plugins:sesa':{ok:false,error:'no gateway'}});
 const out=await r.plugins(['shop','sesa','shop'],'a sign-in');assert.deepEqual(out.reloaded,['shop']);assert.deepEqual(out.left,['sesa']);
 assert.equal(calls.length,2,'each agent once');assert.deepEqual(restarts,[]);assert.equal(later.length,1);assert.match(later[0],/sesa/)});
test('restart one agent: that agent alone; the main agent, or an agent the engine cannot cycle, restarts the engine, without waiting for it',async()=>{
 let {r,calls,restarts}=rig();assert.deepEqual(await r.agent('shop','asked'),{whole:false,agent:'shop'});assert.deepEqual(calls[0],['cycle','/h','shop']);assert.deepEqual(restarts,[]);
 ({r,calls,restarts}=rig());assert.equal((await r.agent('default','asked')).whole,true);assert.equal(calls.length,0);assert.equal(restarts.length,1);
 ({r,restarts}=rig({'cycle:shop':{ok:false,error:'old engine'}}));assert.equal((await r.agent('shop','asked')).whole,true);assert.equal(restarts.length,1);
 const slow=createAgentReload({homeOf:a=>a,HERMES_HOME:'/h',restartGateway:()=>new Promise(()=>{}),log:()=>{},run:async()=>({ok:true})});
 assert.equal((await Promise.race([slow.agent('default','x'),new Promise(z=>setTimeout(()=>z('waited'),200))])).whole,true,'a whole restart is started, not waited for');
 assert.equal(isMain('default'),true);assert.equal(isMain('shop'),false)});
test('the engine\'s own words after an enable: loaded = no restart for it',()=>{assert.equal(enableReloaded('✓ Plugin x enabled.\nGateway reloaded plugins; nothing of this plugin needs a session or restart.'),true);assert.equal(enableReloaded('✓ Plugin x enabled.\nRestart the gateway to load it.'),false)});

test('manage_agent restart: the main agent restarts any agent, an agent itself, a manager its agent; a viewer cannot',async()=>{
 const H=await mkdtemp(path.join(tmpdir(),'ar-'));const DATA=path.join(H,'data');await writeFile(path.join(H,'config.yaml'),'x: 1\n');
 for(const a of ['alpha','beta'])await mkdir(path.join(H,'profiles',a),{recursive:true}).then(()=>writeFile(path.join(H,'profiles',a,'config.yaml'),'x: 1\n'));
 const s=createSharing({DATA,env:{}});await s.setEnabled(true,'t');const done=[],rec=[];
 const acc=createAgentAccess({sharing:s,HERMES_HOME:H,MAIN:'default',versions:{record:async e=>rec.push(e)},restartAgent:async(a,why)=>{done.push([a,why]);return {whole:a==='default'}}});
 assert.equal(AGENT_NEEDS.restart,'manager');
 let r=await acc.call('default',{agent:'alpha',part:'restart',why:'stuck'});assert.ok(!r.isError,r.text);assert.match(r.text,/on its own/);assert.match(done[0][1],/stuck/);assert.equal(rec[0].kind,'restart');
 r=await acc.call('alpha',{agent:'alpha',part:'restart'});assert.ok(!r.isError,'itself');
 r=await acc.call('beta',{agent:'alpha',part:'restart'});assert.equal(r.isError,true,'no access');
 await acc.call('default',{agent:'alpha',part:'share',to:'beta',level:'viewer'});r=await acc.call('beta',{agent:'alpha',part:'restart'});assert.equal(r.isError,true,'a viewer');
 await acc.call('default',{agent:'alpha',part:'share',to:'beta',level:'manager'});r=await acc.call('beta',{agent:'alpha',part:'restart'});assert.ok(!r.isError,'a manager');
 assert.equal(done.length,3)});

test('wired: sign-ins and the Code agent restart only when the engine did not load the plugin; Slack, Trusted and the per-agent plugins use the agent alone; a route and two buttons',async()=>{
 const src=f=>readFile(new URL('../app/'+f,import.meta.url),'utf8');const [acc,ca,srv,ab,core,more,rr]=await Promise.all(['accounts.mjs','code-agent.mjs','server.mjs','abilities-routes.mjs','core.js','all-agents-more.js','restart-routes.mjs'].map(src));
 assert.match(acc,/if\(!enableReloaded\(r\.out\)\)on\.push\(p\)/);assert.match(ca,/if\(!\/Gateway reloaded plugins\/i\.test\(String\(r\.out\|\|''\)\)\)switched\+\+/);
 assert.match(srv,/agentReload\.agent\(a,'Slack channel settings updated for '\+a\)/);assert.match(srv,/agentReload\.plugins\(c,'billion-context plugin installed'\)/);
 assert.match(srv,/restartAgent:\(a,why\)=>agentReload\.agent\(a,why\)/);assert.match(rr,/p==='\/ui\/agent\/restart'&&req\.method==='POST'/);assert.match(rr,/users\.level\(u,ag\)!=='owner'/);assert.match(srv,/if\(await restartRoutes\(req,res,p,u\)\)return;/);
 assert.match(ab,/agentReload\?agentReload\.agent\(ag,'Trusted changed for '\+ag\)/);assert.match(core,/async function restartAgentNow\(a\)/);assert.match(more,/ACT\['agent-restart'\]=/)});
// 16 Nov 2026 on the live box: serve-profile did its work but answered after its own 8 s limit, and the app restarted the whole engine.
// The script now asks the engine which agents it serves (its rescan) for up to 45 s before calling it a failure.
test('the engine side waits for the agent to be served again before it says the restart failed',async()=>{
 const py=await readFile(new URL('./engine-agent.py',import.meta.url),'utf8');
 assert.match(py,/while a and not served and time\.time\(\) - t < 45:/);assert.match(py,/rescan_gateway_profiles\(home, timeout=8\.0\)/);assert.match(py,/"ok": bool\(a and served\)/)});
