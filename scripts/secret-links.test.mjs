// Tests for one-time secret links (app/secret-links.mjs). Run: node --test scripts/secret-links.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSecretLinks,createLimiter,LIFE} from '../app/secret-links.mjs';

async function make(o={}){const DATA=await mkdtemp(path.join(tmpdir(),'sl-'));let t=1e12;const saved=[],told=[],have=new Set(['biomarkers-support|OLD_KEY']);
 const s=createSecretLinks({DATA,PUBLIC_URL:'https://ai.example',now:()=>t,save:async(a,n,v)=>{if(o.fail)throw Error('disk full');saved.push([a,n,v]);have.add(a+'|'+n)},
  reserved:n=>/^TELEGRAM_/.test(n),isAgent:async a=>['default','biomarkers-support'].includes(a),exists:async(a,n)=>have.has(a+'|'+n),nameOf:a=>a==='default'?'Donna AI':a,tell:async(x)=>{told.push(x)}});
 return {s,DATA,saved,told,have,tick:ms=>{t+=ms}}}
const tok=u=>u.split('#')[1];

test('a link saves once, for its own agent and key only, and the value is never kept or shown',async()=>{const {s,DATA,saved,told}=await make();
 const {url}=await s.create({agent:'biomarkers-support',name:'test_secret_link',label:'Test key',by:'default'});
 assert.match(url,/^https:\/\/ai\.example\/secret#[A-Za-z0-9_-]{43}$/);
 const p=await s.peek(tok(url));assert.deepEqual([p.label,p.name,p.agentName],['Test key','TEST_SECRET_LINK','biomarkers-support']);
 assert.equal(JSON.stringify(p).includes('hunter2'),false);
 assert.deepEqual(await s.consume(tok(url),' hunter2 '),{ok:true,agentName:'biomarkers-support',name:'TEST_SECRET_LINK'});
 assert.deepEqual(saved,[['biomarkers-support','TEST_SECRET_LINK','hunter2']]);
 assert.equal((await s.consume(tok(url),'again')).gone,true);assert.equal(await s.peek(tok(url)),null);assert.equal(saved.length,1);
 const disk=await readFile(path.join(DATA,'secret-links.json'),'utf8');assert.equal(disk.includes('hunter2'),false);assert.equal(disk.includes(tok(url)),false);
 assert.equal((await s.status('biomarkers-support','TEST_SECRET_LINK')).state,'saved');assert.equal(told.length,2);assert.match(told[0],/made a secret link/);
 assert.deepEqual((await s.list()).audit.map(x=>x.event),['saved','created'])});

test('two taps at once save once',async()=>{const {s,saved}=await make();const {url}=await s.create({agent:'default',name:'A_KEY',label:'x'});
 const r=await Promise.all([s.consume(tok(url),'v1'),s.consume(tok(url),'v2')]);assert.deepEqual(r.map(x=>!!x.ok),[true,false]);assert.equal(saved.length,1)});

test('it expires after 30 minutes, and a used or unknown token says gone',async()=>{const {s,tick}=await make();const {url}=await s.create({agent:'default',name:'A_KEY',label:'x'});
 tick(LIFE+1);assert.equal(await s.peek(tok(url)),null);assert.equal((await s.consume(tok(url),'v')).gone,true);
 assert.equal((await s.status('default','A_KEY')).state,'expired');assert.equal((await s.consume('x'.repeat(43),'v')).gone,true);assert.equal((await s.consume('short','v')).gone,true)});

test('refused: wiring keys, bad names, unknown agents, empty or multi-line values; a failed save can be retried',async()=>{const {s}=await make();
 await assert.rejects(s.create({agent:'default',name:'TELEGRAM_BOT_TOKEN',label:'x'}),/changes how/);
 await assert.rejects(s.create({agent:'default',name:'1BAD',label:'x'}),/capitals/);
 await assert.rejects(s.create({agent:'nobody',name:'A_KEY',label:'x'}),/no agent/);
 for(const a of ['bob--x','x/../bob','..','default--whatsapp-2','Default'])await assert.rejects(s.create({agent:a,name:'A_KEY',label:'x'}),/no agent/);
 for(const n of ['BASH_ENV','LD_PRELOAD','PYTHONSTARTUP','PYTHONPATH','PERL5LIB','RUBYOPT','GIT_SSH_COMMAND','HTTPS_PROXY','NODE_EXTRA_CA_CERTS','OPENAI_API_KEY','ANTHROPIC_API_KEY','PATH','SOME_BASE_URL','LESSOPEN','MANPAGER','ZDOTDIR','CC','MAKEFLAGS','KIMI_API_KEY','GITHUB_COPILOT_TOKEN'])await assert.rejects(s.create({agent:'default',name:n,label:'x'}),/ends in|changes how/,n);
 await assert.rejects(s.create({agent:'biomarkers-support',name:'OLD_KEY',label:'x'}),/already set/);
 for(const n of ['LESSOPEN','MANPAGER','CC','SHOP_URL'])await assert.rejects(s.create({agent:'default',name:n,label:'x'}),/ends in|changes how/,n);
 for(const n of ['BIOMARKERS_SUPPORT_BOT_TOKEN','SHOPIFY_API_KEY','STRIPE_SECRET','DB_PASSWORD','GITHUB_PAT'])assert.ok((await s.create({agent:'biomarkers-support',name:n,label:'x'})).url,n);
 await assert.rejects(s.create({agent:'default',name:'A_KEY',label:' '}),/label/);
 const {url}=await s.create({agent:'default',name:'A_KEY',label:'x'});
 assert.match((await s.consume(tok(url),'  ')).error,/Paste/);assert.match((await s.consume(tok(url),'a\nb')).error,/one line/);assert.match((await s.consume(tok(url),'a\tb')).error,/one line/);assert.match((await s.consume(tok(url),'a\u2028b')).error,/one line/);assert.match((await s.consume(tok(url),'x'.repeat(5000))).error,/longer/);
 assert.equal((await s.peek(tok(url))).name,'A_KEY');
 const f=await make({fail:true});const l=await f.s.create({agent:'default',name:'A_KEY',label:'x'});const fr=await f.s.consume(tok(l.url),'v');assert.match(fr.error,/could not be saved/);assert.equal(fr.error.includes('disk'),false);assert.ok(await f.s.peek(tok(l.url)))});
test('a key set another way after the link was made is not overwritten',async()=>{const {s,have,saved}=await make();const {url}=await s.create({agent:'default',name:'B_KEY',label:'x'});have.add('default|B_KEY');assert.match((await s.consume(tok(url),'v')).error,/meanwhile/);assert.equal(saved.length,0)});
test('a link that was being saved when aqeelOS stopped stays closed after a restart',async()=>{const DATA=await mkdtemp(path.join(tmpdir(),'sl-'));const {writeFile}=await import('node:fs/promises');
 const {createHash}=await import('node:crypto');const t='a'.repeat(43);await writeFile(path.join(DATA,'secret-links.json'),JSON.stringify({links:{[createHash('sha256').update(t).digest('hex')]:{id:'i',base:'default',name:'A_KEY',label:'x',at:1e12,exp:1e12+LIFE,state:'saving'}},audit:[]}));
 const s=createSecretLinks({DATA,PUBLIC_URL:'x',now:()=>1e12+1000,save:async()=>{throw Error('must not save')}});assert.equal(await s.peek(t),null);assert.equal((await s.consume(t,'v')).gone,true);assert.equal((await s.status('default','A_KEY')).state,'interrupted')});
test('many reads while a save runs never break the file',async()=>{const {s,DATA}=await make();const {url}=await s.create({agent:'default',name:'C_KEY',label:'x'});
 await Promise.all([s.consume(tok(url),'v'),...Array.from({length:20},()=>s.status('default','C_KEY')),...Array.from({length:10},()=>s.list())]);JSON.parse(await readFile(path.join(DATA,'secret-links.json'),'utf8'));assert.equal((await s.status('default','C_KEY')).state,'saved')});

test('a new link for the same key replaces the old one; cancel closes a link; 5 open links at most',async()=>{const {s}=await make();
 const a=await s.create({agent:'default',name:'A_KEY',label:'x'}),b=await s.create({agent:'default',name:'A_KEY',label:'x'});
 assert.equal(await s.peek(tok(a.url)),null);assert.ok(await s.peek(tok(b.url)));
 assert.equal(await s.cancel(b.link.id,'owner'),true);assert.equal(await s.peek(tok(b.url)),null);
 for(const n of ['K1_KEY','K2_KEY','K3_KEY','K4_KEY','K5_KEY'])await s.create({agent:'default',name:n,label:'x'});await assert.rejects(s.create({agent:'default',name:'K6_KEY',label:'x'}),/5 open/);
 });

test('limiter: max hits per 10 minutes per address',()=>{let t=0;const l=createLimiter(3,600e3,()=>t);assert.deepEqual([l('a'),l('a'),l('a'),l('a'),l('b')],[false,false,false,true,false]);t=601e3;assert.equal(l('a'),false)});
