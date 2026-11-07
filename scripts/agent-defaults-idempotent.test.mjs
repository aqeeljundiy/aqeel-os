import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
// restart loop: a deleted agent whose folder lingers is not an agent, so agent defaults never retry (and restart) for it
const H=mkdtempSync(path.join(tmpdir(),'ad-'));process.env.HERMES_HOME=H;
for(const a of ['live','gone']){mkdirSync(path.join(H,'profiles',a),{recursive:true});writeFileSync(path.join(H,'profiles',a,'config.yaml'),'model: {}\n')}
mkdirSync(path.join(H,'profiles','.deleted'));writeFileSync(path.join(H,'profiles','.deleted','gone'),'deleted');
const ops=await import('../app/agentops.mjs');
assert.equal(await ops.isAgent('gone'),false,'tombstoned agent is not an agent');
assert.equal(await ops.isAgent('live'),true);
const names=await ops.agentNames();assert.ok(names.includes('live')&&!names.includes('gone'),'agentNames skips tombstoned: '+names);
// ensure() counts only writes that succeeded: a refused write cannot make every pass report changes again
const src=readFileSync(new URL('../app/agent-defaults.mjs',import.meta.url),'utf8');
assert.ok(/if\(r\?\.ok!==false\)done\.push\(k\)/.test(src)&&/return done\.length/.test(src),'ensure returns written count');
// hold accepts ms, digit string and ISO
const {holdActive}=await import('../app/alert-quiet.mjs');const now=Date.now();
assert.equal(holdActive({until:now+6e4},now),true);assert.equal(holdActive({until:String(now+6e4)},now),true);
assert.equal(holdActive({until:new Date(now+6e4).toISOString()},now),true);assert.equal(holdActive({until:new Date(now-6e4).toISOString()},now),false);
assert.equal(holdActive({until:'garbage'},now),false);
// 6-7 Nov 2026: each deploy check's throwaway agent restarted every agent. Test agents get the defaults, but their
// writes never count toward a restart, in the new-agent tick, the 10-minute pass, the plugin install and the tool lists
assert.ok(/if\(!await isTest\(a\)\.catch\(\(\)=>false\)\)n\+=k;seen\.add/.test(src),'tick skips test agents for restarts');
assert.ok(src.includes("if(!await isTest(a).catch(()=>false))n+=k}return n}"),'all() skips test agents for restarts');
const srv=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8');
assert.ok(srv.includes('createAgentDefaults({DATA,isTest:a=>isTestAgent(a),'),'server passes the test-agent list');
assert.ok(/agentLive\.install\(\)\.then\(async c0=>\{const c=\[\];for\(const a of c0\)if\(!await isTestAgent/.test(srv),'plugin install ignores test agents');
assert.ok(/async function toolSigs\(\)\{const out=\{\};for\(const a of await agentLive\.homes\(\)\)\{if\(await isTestAgent\(a\)/.test(srv),'tool lists ignore test agents');
assert.ok(srv.includes("restart:why=>{if(/^n8n connected for /.test(why)&&testAgentShown(why))return;"),'n8n setup for a test agent restarts nothing');
console.log('agent-defaults-idempotent ok');
