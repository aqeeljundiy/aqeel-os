// ABIL-65: every agent has the main agent's skills and tools. Two gaps found on Elkiya (11 Nov 2026):
//  - a skill right at the top of the main agent's skills folder (skills/<skill>/SKILL.md, no category) never reached other agents;
//  - an agent made trusted after it had its own user kept browser.cdp_url to that user's Chrome port, which the root script
//    later handed to another agent (pepclub-social drove aq-livetest's Chrome).
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,access} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';

const HOME=await mkdtemp(path.join(tmpdir(),'eq-'));
process.env.HOME=HOME;process.env.HERMES_HOME=path.join(HOME,'.hermes');process.env.CLAUDE_BIN='/bin/false';
process.env.AQEELOS_SKILLS_POLICY=path.join(HOME,'skills-policy.json');
const H=process.env.HERMES_HOME,has=p=>access(p).then(()=>true,()=>false);

test('top-level and category skills both reach another agent; restricted ones do not',async()=>{
 await writeFile(process.env.AQEELOS_SKILLS_POLICY,JSON.stringify({restricted:{'ops/secret':['default']}}));
 for(const d of ['skills/top-skill','skills/cat/one','skills/ops/secret','profiles/a1'])await mkdir(path.join(H,d),{recursive:true});
 for(const d of ['top-skill','cat/one','ops/secret'])await writeFile(path.join(H,'skills',d,'SKILL.md'),'---\nname: x\n---\n');
 await writeFile(path.join(H,'profiles','a1','config.yaml'),'model: {}\n');
 const {createAccounts,accountHooks}=await import('../app/accounts.mjs');createAccounts(path.join(HOME,'data'),{codeRoot:path.join(HOME,'code')});
 const n=await accountHooks.giveSkills('a1');
 assert.equal(n,2);
 assert.ok(await has(path.join(H,'profiles','a1','skills','top-skill','SKILL.md')),'top-level skill copied');
 assert.ok(await has(path.join(H,'profiles','a1','skills','cat','one','SKILL.md')),'category skill copied');
 assert.ok(!await has(path.join(H,'profiles','a1','skills','ops','secret')),'restricted skill not copied');
 assert.equal(await accountHooks.giveSkills('a1'),0,'second pass copies nothing');
});

test('a link to an own-screen Chrome is recognised; AdsPower and remote browsers are not',async()=>{
 const {ownScreenCdp}=await import('../app/agent-defaults.mjs');
 for(const u of ['http://127.0.0.1:9600','http://127.0.0.1:9605/','http://localhost:9616','http://127.0.0.1:19602'])assert.equal(ownScreenCdp(u),true,u);
 for(const u of ['http://127.0.0.1:9333','','wss://connect.browserbase.com/x','http://10.0.0.5:9605',undefined])assert.equal(ownScreenCdp(u),false,String(u));
});
