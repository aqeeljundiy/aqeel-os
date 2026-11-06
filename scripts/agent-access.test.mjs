// Tests for agents as a shared resource (app/agent-access.mjs) and the main agent rule.
// Run: node --test scripts/agent-access.test.mjs. Temp folders and made-up agents only (main, alpha, beta, gamma).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSharing} from '../app/sharing.mjs';
import {createAgentAccess,MAIN_RULE_LINES,MAIN_RULE_NOTE,redact,redactText,MAIN_ONLY_SETTING} from '../app/agent-access.mjs';

async function setup(){const H=await mkdtemp(path.join(tmpdir(),'aa-'));const DATA=path.join(H,'data');
 await writeFile(path.join(H,'config.yaml'),'x: 1\n');
 for(const a of ['alpha','beta','gamma']){await mkdir(path.join(H,'profiles',a,'logs'),{recursive:true});await writeFile(path.join(H,'profiles',a,'config.yaml'),'x: 1\n');
  await writeFile(path.join(H,'profiles',a,'logs','agent.log'),'start\napi_key=sk-abcdefghijklmnop123 used\nok\n')}
 const s=createSharing({DATA,env:{}});await s.setEnabled(true,'t');const changes=[],souls={},cfg={alpha:{timezone:'UTC',mcp_servers:{n8n:{url:'https://x/mcp/AAAAAAAAAAAAAAAAAAAAAAAAAAAA',headers:{Authorization:'Bearer zz'}}}}};
 const jobs={alpha:[{id:'j1',name:'Loop',schedule:'every 15m'}]};
 const acc=createAgentAccess({sharing:s,HERMES_HOME:H,MAIN:'default',
  instructions:{change:async(a,args,{by})=>{souls[a]=(args.edits||[]).map(e=>e.new_text).join('|');return {text:'Saved as version 2 of your instructions. It is in your history.'}}},
  readConfig:async a=>cfg[a]||{},setKey:async(a,k,v)=>{(cfg[a]||={})[k]=v;return {ok:true}},versions:{record:async e=>changes.push(e)},
  cron:{list:async a=>jobs[a]||[],create:async(a,b)=>{(jobs[a]||=[]).push({id:'n'+Date.now(),...b});return {id:'new1'}},update:async()=>{},pause:async()=>{},resume:async()=>{},remove:async(a,id)=>{jobs[a]=jobs[a].filter(j=>j.id!==id)}}});
 return {H,s,acc,changes,souls,cfg}}

test('every agent owns itself; the main agent acts as owner of all',async()=>{const {acc,s}=await setup();
 assert.equal(await acc.levelOn('alpha','alpha'),'owner');assert.equal(await acc.levelOn('default','alpha'),'owner');assert.equal(await acc.levelOn('beta','alpha'),'none');
 assert.equal((await s.get('agent','alpha')).owner,'alpha')});

test('no access: everything refused',async()=>{const {acc}=await setup();
 for(const part of ['show','logs','instructions','skill','schedule','settings','share']){const r=await acc.call('beta',{agent:'alpha',part});assert.equal(r.isError,true,part);assert.match(r.text,/not shared with you/)}});

test('viewer reads setup and logs, keys hidden; cannot edit',async()=>{const {acc}=await setup();await acc.call('default',{agent:'alpha',part:'share',to:'beta',level:'viewer'});
 const sh=await acc.call('beta',{agent:'alpha',part:'show'});assert.ok(!sh.isError);assert.doesNotMatch(sh.text,/Bearer|AAAAAAAAAAAAAAAAAAAAAAAA/);assert.match(sh.text,/j1/);
 const lg=await acc.call('beta',{agent:'alpha',part:'logs'});assert.doesNotMatch(lg.text,/sk-abcdefghijklmnop123/);
 const ed=await acc.call('beta',{agent:'alpha',part:'instructions',edits:[{old_text:'a',new_text:'b'}],why:'x'});assert.equal(ed.isError,true);assert.match(ed.text,/viewer.*editor/)});

test('editor edits instructions, skills, schedules (attributed); no settings, no sharing onward',async()=>{const {acc,changes,souls,H}=await setup();await acc.call('alpha',{agent:'alpha',part:'share',to:'beta',level:'editor'});
 const r=await acc.call('beta',{agent:'alpha',part:'instructions',edits:[{old_text:'a',new_text:'b'}],why:'fix'});assert.ok(!r.isError);assert.equal(souls.alpha,'b');assert.match(r.text,/Alpha|alpha's instructions/i);
 const sk=await acc.call('beta',{agent:'alpha',part:'skill',category:'ops',name:'fix-it',content:'---\nname: fix-it\ndescription: x\n---\nbody',why:'add'});assert.ok(!sk.isError,sk.text);
 assert.ok(await stat(path.join(H,'profiles','alpha','skills','ops','fix-it','SKILL.md')));
 assert.ok(!(await acc.call('beta',{agent:'alpha',part:'schedule',op:'pause',job_id:'j1',why:'dup'})).isError);
 const ed=changes.filter(c=>c.kind!=='access');assert.deepEqual(ed.map(c=>c.kind),['instructions','skill','schedule']);assert.ok(ed.every(c=>c.by.agent==='beta'&&c.agent==='alpha'));
 assert.match((await acc.call('beta',{agent:'alpha',part:'settings',key:'timezone',value:'X'})).text,/editor.*manager/);
 assert.equal((await acc.call('beta',{agent:'alpha',part:'share',to:'gamma',level:'viewer'})).isError,true);assert.equal(await acc.levelOn('gamma','alpha'),'none')});

test('manager: settings (not keys/permissions), shares as editor/viewer only, never above itself',async()=>{const {acc,cfg}=await setup();await acc.call('default',{agent:'alpha',part:'share',to:'beta',level:'manager'});
 assert.ok(!(await acc.call('beta',{agent:'alpha',part:'settings',key:'timezone',value:'Asia/Jakarta'})).isError);assert.equal(cfg.alpha.timezone,'Asia/Jakarta');
 for(const k of ['mcp_servers.n8n','approvals.mode','OPENAI_API_KEY','terminal.backend'])assert.match((await acc.call('beta',{agent:'alpha',part:'settings',key:k,value:'x'})).text,/only the main agent/,k);
 assert.ok(!(await acc.call('beta',{agent:'alpha',part:'share',to:'gamma',level:'editor'})).isError);
 assert.match((await acc.call('beta',{agent:'alpha',part:'share',to:'gamma',level:'manager'})).text,/editor or viewer/);
 const mine=await acc.managed('gamma');assert.deepEqual(mine,[{agent:'alpha',level:'editor'}])});

test('main agent rule: its edits of another agent get the reminder; its own and others do not',async()=>{const {acc}=await setup();
 const r=await acc.call('default',{agent:'alpha',part:'instructions',edits:[{old_text:'a',new_text:'b'}],why:'x'});assert.ok(r.text.includes(MAIN_RULE_NOTE));
 const own=await acc.call('alpha',{agent:'alpha',part:'instructions',edits:[{old_text:'a',new_text:'b'}],why:'x'});assert.ok(!own.text.includes(MAIN_RULE_NOTE));
 const sh=await acc.call('default',{agent:'alpha',part:'show'});assert.ok(!sh.text.includes(MAIN_RULE_NOTE))});

test('main rule text: generic, says grant-then-redirect',()=>{const t=MAIN_RULE_LINES.join('\n');
 assert.match(t,/## Main agent rule/);assert.match(t,/do not fix that agent's work for it/);assert.match(t,/I have given <agent> the access it needs to fix this itself/);
 assert.match(t,/already had everything/);assert.match(t,/explicitly asks you to fix it directly/);assert.match(t,/the main agent/)});

test('redact: keys never come back',()=>{const o=redact({mcp_servers:{a:{headers:{x:1},url:'https://u:p@h/x?token=abc'}},api_key:'k',ok:'v'});
 assert.equal(o.api_key,'(hidden)');assert.equal(o.mcp_servers.a.headers,'(hidden)');assert.doesNotMatch(o.mcp_servers.a.url,/u:p|abc/);assert.equal(o.ok,'v');
 assert.doesNotMatch(redactText('token: abcdef123 and ghp_1234567890abcdef'),/abcdef123|ghp_1234/);assert.ok(MAIN_ONLY_SETTING.test('mcp_servers.x'));assert.ok(!MAIN_ONLY_SETTING.test('timezone'))});

test('soft guard plugin: flags another agent\'s own files only',()=>{const here=path.dirname(fileURLToPath(import.meta.url));const plug=path.join(here,'..','engine','aqeelos-main-rule','__init__.py');
 const out=execFileSync('python3',['-I','-c',`import importlib.util,pathlib,sys;s=importlib.util.spec_from_file_location('m',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r=pathlib.Path('/h/.hermes');u=pathlib.Path('/h')
print(m.others_touched('sed -i x /h/.hermes/profiles/alpha/SOUL.md',r,u),m.others_touched('/h/workspaces/beta/a.md /h/workspaces/default/b',r,u),m.others_touched('/h/.hermes/profiles/alpha/config.yaml',r,u),m.others_touched('aqeelos -p gamma cron list',r,u))`,plug]).toString().trim();
 assert.equal(out,"['alpha'] ['beta'] [] ['gamma']")});
