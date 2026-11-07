// Which account each key belongs to (app/keys-identity.mjs): the service is asked read-only, the secret is never kept.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createKeysIdentity,autoName,serviceOf,last4,whereLabel,probeFor} from '../app/keys-identity.mjs';

const SECRET='ghp_abcdefghijklmnopqrstuvwxyz0123456789WXYZ',SECRET2='xoxp-1111-2222-3333-secretvaluehere9876',BOT='123456:AAbbccddeeffgghhiijjkk_TGBOT';
const real=globalThis.fetch;after(()=>{globalThis.fetch=real});
const seen=[];
globalThis.fetch=async(url,o={})=>{seen.push({url:String(url),method:o.method||'GET'});const h=(o.headers||{});
 const res=(status,body,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
 if(String(url).startsWith('https://api.github.com/user'))return h.authorization==='Bearer '+SECRET?res(200,{login:'acme-dev'},{'x-oauth-scopes':'repo, workflow'}):res(401,{});
 if(String(url).startsWith('https://slack.com/api/auth.test'))return res(200,h.authorization==='Bearer '+SECRET2?{ok:true,team:'Acme',user:'sam'}:{ok:false,error:'invalid_auth'});
 if(String(url).includes('api.telegram.org/bot'))return res(200,{ok:true,result:{username:'acme_bot'}});
 return res(500,{})};

async function box(){const d=await mkdtemp(path.join(tmpdir(),'kid-'));const H=path.join(d,'.hermes');await mkdir(path.join(H,'profiles','sales','skills','git','push'),{recursive:true});
 await writeFile(path.join(H,'.env'),'GITHUB_TOKEN='+SECRET+'\nSLACK_USER_TOKEN="'+SECRET2+'"\nHERMES_X_KEY=skip\nUNUSED_THING_KEY=abcdefghijklmnop\nTIMEZONE=Asia/Jakarta\n');
 await writeFile(path.join(H,'profiles','sales','.env'),'GITHUB_TOKEN='+SECRET+'\nTELEGRAM_BOT_TOKEN='+BOT+'\n');
 await writeFile(path.join(H,'profiles','sales','skills','git','push','SKILL.md'),'---\nname: push\ndescription: x\n---\nUse $GITHUB_TOKEN to push.\n');
 return {d,H,k:createKeysIdentity({DATA:path.join(d,'data'),HERMES_HOME:H,root:path.join(d,'app'),listAgents:async()=>['default','sales'],live:()=>true})}}

test('every key is found once, the same key on two agents is one entry, settings are not keys',async()=>{const {d,k}=await box();try{
 const l=(await k.list()).items;const names=l.map(x=>x.name).sort();
 assert.deepEqual(names,['GITHUB_TOKEN','SLACK_USER_TOKEN','TELEGRAM_BOT_TOKEN','UNUSED_THING_KEY']);
 assert.deepEqual(l.find(x=>x.name==='GITHUB_TOKEN').agents,['default','sales']);assert.equal(l.find(x=>x.name==='GITHUB_TOKEN').status,'unchecked');
}finally{await rm(d,{recursive:true,force:true})}});

test('a check names the account and scopes, shows the last 4 only, and never writes the secret',async()=>{const {d,k}=await box();try{
 await k.tick();const l=(await k.list()).items,g=l.find(x=>x.name==='GITHUB_TOKEN'),s=l.find(x=>x.name==='SLACK_USER_TOKEN'),t=l.find(x=>x.name==='TELEGRAM_BOT_TOKEN'),u=l.find(x=>x.name==='UNUSED_THING_KEY');
 assert.equal(g.account,'acme-dev');assert.equal(g.scopes,'repo, workflow');assert.equal(g.status,'works');assert.equal(g.last4,'WXYZ');assert.equal(g.label,'GitHub: acme-dev (repo, workflow)');
 assert.equal(s.account,'Acme · sam');assert.equal(t.account,'@acme_bot');
 assert.equal(u.status,'unknown');assert.match(u.detail,/No safe way/);
 assert.ok(g.usedBy.includes('Skill: push'),'the skill that names it');assert.ok(t.usedBy.includes('A channel the agent answers on'));
 assert.equal(u.unused,true,'nothing names it: Not used by anything');
 const file=await readFile(k.file,'utf8');for(const v of [SECRET,SECRET2,BOT,'abcdefghijklmnop'])assert.ok(!file.includes(v),'secret in keys-identity.json');
 assert.ok(seen.every(x=>x.method==='GET'||x.url.includes('auth.test')),'read-only calls only');
}finally{await rm(d,{recursive:true,force:true})}});

test('a rejected key says so; an unreachable service is "unknown", never an error',async()=>{const {d,H,k}=await box();try{
 await writeFile(path.join(H,'.env'),'GITHUB_TOKEN=ghp_wrongwrongwrongwrong\nOPENAI_API_KEY=sk-thisisnotreal123456\n');
 await k.tick();const l=(await k.list()).items;assert.equal(l.find(x=>x.name==='GITHUB_TOKEN'&&x.agents.includes('default')).status,'rejected');
 assert.equal(l.find(x=>x.name==='OPENAI_API_KEY').status,'unknown');
}finally{await rm(d,{recursive:true,force:true})}});

test('the same account on two keys is grouped',async()=>{const {d,H,k}=await box();try{
 await writeFile(path.join(H,'profiles','sales','.env'),'GH_TOKEN='+SECRET+'\n');await k.tick();
 const l=(await k.list()).items;const a=l.find(x=>x.name==='GITHUB_TOKEN'),b=l.find(x=>x.name==='GH_TOKEN');
 assert.equal(a.group,'GitHub|acme-dev');assert.deepEqual(b.sameAs,[a.id]);
}finally{await rm(d,{recursive:true,force:true})}});

test('what an agent said a key is for shows until the owner names it; Connections rows take the account name',async()=>{const {d,k}=await box();try{
 await k.note('UNUSED_THING_KEY',{label:'Thing service',description:'Reads the Thing service for the weekly report.',agent:'default'});
 const u=(await k.list()).items.find(x=>x.name==='UNUSED_THING_KEY');assert.equal(u.label,'Thing service');assert.equal(u.note.description,'Reads the Thing service for the weekly report.');
 await k.tick();const g=(await k.list()).items.find(x=>x.name==='GITHUB_TOKEN');
 const row=await k.decorate({key:'key:'+g.id,name:'GITHUB_TOKEN',what:''});assert.equal(row.name,'GitHub: acme-dev (repo, workflow)');assert.equal(row.rawName,'GITHUB_TOKEN');
 assert.deepEqual(await k.decorate({key:'key:'+g.id,name:'Mine',labelled:true}),{key:'key:'+g.id,name:'Mine',labelled:true},'an owner label wins');
}finally{await rm(d,{recursive:true,force:true})}});

test('names and places in plain words',()=>{
 assert.equal(serviceOf('FIRECRAWL_API_KEY'),'Firecrawl');assert.equal(serviceOf('GITHUB_TOKEN'),'GitHub');assert.equal(autoName('FIRECRAWL_API_KEY'),'Firecrawl');
 assert.equal(last4('short'),'');assert.equal(last4('abcdefghijkl1234'),'1234');assert.equal(probeFor('TIMEZONE'),null);
 const o={HERMES_HOME:'/h/.hermes',root:'/h/apps/hermes-ui',HOME:'/h'};
 assert.equal(whereLabel('/h/.hermes/profiles/x/skills/dev/push/SKILL.md',o),'Skill: push');assert.equal(whereLabel('/h/.hermes/cron/jobs.json',o),'Schedules');
 assert.equal(whereLabel('/h/.hermes/hermes-agent/tools/web.py',o),'The engine’s built-in tools');assert.equal(whereLabel('/h/apps/hermes-ui/app/kirimdev.mjs',o),'aqeelOS’s code');
 assert.equal(whereLabel('/h/.hermes/scripts/gapi.py',o),'Script: gapi.py');assert.equal(whereLabel('/h/.hermes/memories/MEMORY.md',o),'The agent’s memory')});

test('a key counts as used only by the work of the agents that hold it',async()=>{const {d,H,k}=await box();try{
 await writeFile(path.join(H,'profiles','sales','skills','git','push','other.md'),'Uses UNUSED_THING_KEY too.\n');   // sales does not hold it
 await k.tick();const u=(await k.list()).items.find(x=>x.name==='UNUSED_THING_KEY');assert.equal(u.unused,true);
 await mkdir(path.join(H,'scripts'),{recursive:true});await writeFile(path.join(H,'scripts','thing.py'),'os.environ["UNUSED_THING_KEY"]\n');   // shared scripts count for everyone
 await k.tick({force:true});const v=(await k.list()).items.find(x=>x.name==='UNUSED_THING_KEY');assert.deepEqual(v.usedBy,['Script: thing.py']);
}finally{await rm(d,{recursive:true,force:true})}});

test('a key is only ever sent to the service its name names',()=>{
 assert.equal(probeFor('SUPPORT_BOT_TOKEN'),null);assert.equal(probeFor('SLACK_MCP_CLIENT_SECRET'),null);assert.equal(probeFor('MY_API_KEY'),null);
 assert.equal(probeFor('SALES_TELEGRAM_BOT_TOKEN').service,'Telegram');assert.equal(probeFor('PIXEL_SLACK_BOT_TOKEN').service,'Slack')});
