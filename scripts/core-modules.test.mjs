// Core modules that had no own test: access.mjs (who owns/uses a connection, sharing keys), skills-policy.mjs
// (which skills reach which agent, trim moves never deletes), swr.mjs (stale-while-revalidate + limiter), brand.mjs.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,access as exists} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createAccess} from '../app/access.mjs';
import {allowed,restricted,baseOf,trim} from '../app/skills-policy.mjs';
// the box's own list is data (DATA/skills-policy.json); the tests use the example file
process.env.AQEELOS_SKILLS_POLICY=new URL('./fixtures/skills-policy.example.json',import.meta.url).pathname;
import {swr,limiter} from '../app/swr.mjs';
import {createBrand} from '../app/brand.mjs';

const tmp=p=>mkdtemp(path.join(tmpdir(),p));

test('skills-policy: open skills reach all, restricted only named agents, extra numbers count as the agent',()=>{
 assert.equal(allowed('productivity/pdf','sesa'),true);
 assert.equal(allowed('pixel/pixel-ops','pixel-agent'),true);
 assert.equal(allowed('pixel/pixel-ops','sesa'),false);
 assert.equal(allowed('other-cat/pixel-ops','sesa'),false,'a copy in another category is still covered');
 assert.equal(allowed('pixel/pixel-ops','default--whatsapp-2'),true);
 assert.equal(baseOf('default--whatsapp-2'),'default');
 assert.equal(allowed('apple/findmy','default'),false,'removed for every agent');
 assert.equal(restricted('productivity/pdf'),false);});

test('skills-policy: trim moves disallowed skills to the backup folder, nothing deleted',async()=>{
 const d=await tmp('skp-');const s=path.join(d,'skills'),b=path.join(d,'bak');
 for(const k of ['pixel/pixel-ops','productivity/pdf'])await mkdir(path.join(s,k),{recursive:true}).then(()=>writeFile(path.join(s,k,'SKILL.md'),'x'));
 const moved=await trim(s,'sesa',b);
 assert.deepEqual(moved,['pixel/pixel-ops']);
 await exists(path.join(b,'pixel/pixel-ops/SKILL.md'));await exists(path.join(s,'productivity/pdf/SKILL.md'));});

test('swr: fresh answer reused, stale answer served while it reloads, drop forces a new read',async()=>{
 const c=swr({fresh:20});let n=0;const fn=async()=>++n;
 assert.equal(await c.get('k',fn),1);assert.equal(await c.get('k',fn),1);
 await new Promise(r=>setTimeout(r,30));assert.equal(await c.get('k',fn),1,'stale served at once');
 await new Promise(r=>setTimeout(r,5));assert.equal(await c.get('k',fn),2,'reloaded behind the scenes');
 c.drop('k');assert.equal(await c.get('k',fn),3);});

test('swr: slow first read answers partial() after cap; a failed read never sticks',async()=>{
 const c=swr({cap:10});const v=await c.get('s',()=>new Promise(r=>setTimeout(()=>r('full'),50)),{partial:()=>'part'});
 assert.equal(v,'part');await assert.rejects(c.get('e',async()=>{throw new Error('down')}));assert.equal(c.peek('e'),undefined);});

test('limiter: never more than n at once',async()=>{
 const run=limiter(2);let on=0,max=0;
 await Promise.all([1,2,3,4,5].map(()=>run(async()=>{on++;max=Math.max(max,on);await new Promise(r=>setTimeout(r,5));on--})));
 assert.equal(max,2);});

test('brand: default name without a file, custom name and logo honoured',async()=>{
 const d=await tmp('brand-');assert.deepEqual(await createBrand({DATA:d}).get(),{name:'aqeelOS',logo:null,custom:false});
 await writeFile(path.join(d,'brand.json'),JSON.stringify({name:'Acme',logo:'png',v:3}));await writeFile(path.join(d,'brand-logo.png'),'PNG');
 const b=createBrand({DATA:d});assert.deepEqual(await b.get(),{name:'Acme',logo:'/ui/brand/logo?v=3',custom:true});
 assert.equal((await b.logo()).type,'image/png');});

async function accessFixture(){
 const H=await tmp('acc-');const DATA=path.join(H,'data');await mkdir(DATA);
 const home=a=>a==='default'?H:path.join(H,'profiles',a);for(const a of ['default','sesa'])await mkdir(home(a),{recursive:true});
 await writeFile(path.join(H,'.env'),'OPENAI_API_KEY=sk-one\nTELEGRAM_BOT_TOKEN=bot\nHERMES_X=1\n');
 await writeFile(path.join(home('sesa'),'.env'),'');
 const restarts=[];
 const editEnv=async(f,fn)=>writeFile(f,fn(await readFile(f,'utf8').catch(()=>'')));
 const acc=createAccess({HERMES_HOME:H,DATA,listAgents:async()=>['sesa','default'],readConfig:async()=>({}),setKey:async()=>({ok:true}),
  hermes:async()=>({ok:true}),editEnv,names:a=>a,writeJson:(f,v)=>writeFile(f,JSON.stringify(v)),restart:w=>restarts.push(w),dash:async()=>({})});
 return {H,home,acc,restarts};}

test('access: keys listed with owner, engine wiring skipped, sharing copies and revoking removes',async()=>{
 const {home,acc,restarts}=await accessFixture();
 const l=await acc.list('key');
 assert.deepEqual(l.agents.map(a=>a.id),['default','sesa'],'main agent first');
 assert.deepEqual(l.items.map(i=>i.label).sort(),['OPENAI_API_KEY','TELEGRAM_BOT_TOKEN']);
 const k=l.items.find(i=>i.label==='OPENAI_API_KEY');assert.equal(k.owner,'default');
 await acc.grant('key',k.id,'sesa');assert.match(await readFile(path.join(home('sesa'),'.env'),'utf8'),/^OPENAI_API_KEY=sk-one$/m);
 assert.equal(restarts.length,1);
 await assert.rejects(acc.revoke('key',k.id,'default'),/owns it/);
 await acc.revoke('key',k.id,'sesa');assert.doesNotMatch(await readFile(path.join(home('sesa'),'.env'),'utf8'),/OPENAI/);});

test('access: a chat bot token is never shared, and another agent\'s own key is not replaced',async()=>{
 const {home,acc}=await accessFixture();
 const bot=(await acc.list('key')).items.find(i=>i.label==='TELEGRAM_BOT_TOKEN');
 await assert.rejects(acc.grant('key',bot.id,'sesa'),/one agent only/);
 await writeFile(path.join(home('sesa'),'.env'),'OPENAI_API_KEY=sk-two\n');acc.fresh();
 const k=(await acc.list('key')).items.find(i=>i.label==='OPENAI_API_KEY'&&i.owner==='default');
 await assert.rejects(acc.grant('key',k.id,'sesa'),/already has its own/);
 assert.match(await readFile(path.join(home('sesa'),'.env'),'utf8'),/sk-two/);});
