// SYS-50: scripts/uptime-check.mjs with a fake fetch and a fake clock: 2 tries 30 s apart, one issue per site, closed when it answers again.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseUrls,siteCode,issueTitle,isUp,run} from './uptime-check.mjs';

const A='https://one.example',B='https://two.example';
// a fake internet: answers[url] is a list of statuses (or 'fail') per try; a fake GitHub with a list of issues
function world({answers={},issues=[]}={}){const calls=[],naps=[],n={};let next=100;
 const f=async(url,o={})=>{url=String(url);calls.push((o.method||'GET')+' '+url);
  if(url.startsWith('https://api.github.com/')){const m=o.method||'GET',p=url.replace('https://api.github.com/repos/o/r','');
   if(m==='GET'&&p.startsWith('/issues?'))return {ok:true,status:200,json:async()=>issues.filter(i=>i.state!=='closed')};
   if(m==='POST'&&p==='/issues'){const b=JSON.parse(o.body);const i={number:next++,state:'open',...b};issues.push(i);return {ok:true,status:201,json:async()=>i}}
   const x=/^\/issues\/(\d+)(\/comments)?$/.exec(p);const i=issues.find(i=>i.number===+x[1]);
   if(x[2]){(i.comments||=[]).push(JSON.parse(o.body).body);return {ok:true,status:201,json:async()=>({})}}
   Object.assign(i,JSON.parse(o.body));return {ok:true,status:200,json:async()=>i}}
  const base=url.replace(/\/$/,'');const a=answers[base]||[200];const k=n[base]=(n[base]||0)+1;const s=a[Math.min(k,a.length)-1];
  if(s==='fail')throw new TypeError('fetch failed');return {status:s}};
 return {f,calls,naps,issues,sleep:async ms=>{naps.push(ms)}}}
const ENV={GITHUB_TOKEN:'t',GITHUB_REPOSITORY:'o/r'};

test('the list: comma separated, trimmed, trailing slashes cut, duplicates and junk dropped',()=>{
 assert.deepEqual(parseUrls(' https://a.example/ , https://b.example,https://a.example,not a url,,'),['https://a.example','https://b.example']);
 assert.deepEqual(parseUrls(''),[]);assert.deepEqual(parseUrls(undefined),[]);
 assert.equal(siteCode(A),siteCode(A.toUpperCase()));assert.notEqual(siteCode(A),siteCode(B));
 assert.ok(!issueTitle(A).includes('example'),'a public repository: the title does not name the address')});

test('up on the first try, or on the second: 200 is the only good answer',async()=>{
 let w=world();assert.deepEqual(await isUp(A,{fetch:w.f,sleep:w.sleep}),{up:true,tries:1});assert.deepEqual(w.naps,[]);
 w=world({answers:{[A]:['fail',200]}});assert.deepEqual(await isUp(A,{fetch:w.f,sleep:w.sleep}),{up:true,tries:2});assert.deepEqual(w.naps,[30000],'30 s between the tries');
 w=world({answers:{[A]:[503,302]}});const r=await isUp(A,{fetch:w.f,sleep:w.sleep});assert.equal(r.up,false);assert.equal(r.tries,2);assert.equal(r.why,'answered 302')});

test('down only after 2 failed tries: a single blip is not an outage',async()=>{
 const w=world({answers:{[A]:['fail',200]}});const r=await run({env:{...ENV,AQEELOS_URLS:A},fetch:w.f,sleep:w.sleep,log:()=>{}});
 assert.deepEqual(r.down,[]);assert.equal(w.issues.length,0)});

test('not set: skips quietly with a notice; the old AQEELOS_URL still works',async()=>{
 const out=[];let w=world();const r=await run({env:{},fetch:w.f,sleep:w.sleep,log:x=>out.push(x)});
 assert.deepEqual(r,{down:[],skipped:true});assert.match(out[0],/^::notice::.*AQEELOS_URLS/);assert.equal(w.calls.length,0);
 w=world({answers:{[A]:['fail','fail']}});assert.deepEqual((await run({env:{...ENV,AQEELOS_URL:A},fetch:w.f,sleep:w.sleep,log:()=>{}})).down,[siteCode(A)])});

test('down: the run reports it and opens ONE labelled issue; the next runs update it, no duplicates; up again closes it',async()=>{
 const out=[],w=world({answers:{[A]:['fail','fail','fail','fail',200],[B]:[200]}});
 const go=()=>run({env:{...ENV,AQEELOS_URLS:A+','+B},fetch:w.f,sleep:w.sleep,log:x=>out.push(x)});
 let r=await go();assert.deepEqual(r.down,[siteCode(A)]);
 assert.equal(w.issues.length,1);assert.deepEqual(w.issues[0].labels,['uptime']);assert.equal(w.issues[0].title,issueTitle(A));assert.ok(!JSON.stringify(w.issues).includes('example'),'no address in the issue');
 r=await go();assert.deepEqual(r.down,[siteCode(A)]);assert.equal(w.issues.length,1,'still one issue');assert.ok(w.calls.some(c=>c.startsWith('PATCH')));
 assert.ok(!out.join('\n').includes('example'),'no address in the log');
 r=await go();assert.deepEqual(r.down,[]);assert.equal(w.issues[0].state,'closed');assert.match(w.issues[0].comments.at(-1),/answers again/);
 assert.equal(w.issues.length,1);
 assert.ok(!w.issues.some(i=>i.title===issueTitle(B)),'B was up all along and never got an issue')});

test('without a token the job still fails when a site is down (no issue is opened)',async()=>{
 const w=world({answers:{[A]:['fail','fail']}});const out=[];
 const r=await run({env:{AQEELOS_URLS:A},fetch:w.f,sleep:w.sleep,log:x=>out.push(x)});assert.equal(r.down.length,1);assert.ok(out.some(x=>/^::warning::No GITHUB_TOKEN/.test(x)))});

test('the workflow: every 10 minutes and by hand, least permissions, the script it calls exists; the addresses come from a secret, never from a variable',()=>{
 const y=readFileSync(new URL('../.github/workflows/uptime.yml',import.meta.url),'utf8');
 assert.match(y,/cron: '\*\/10 \* \* \* \*'/);assert.match(y,/workflow_dispatch:/);
 assert.match(y,/permissions:\n  contents: read\n  issues: write\n/);// review of 12 Nov 2026: a run's log prints the env of each step, and this repository is public: a variable's value showed the servers' addresses there
 assert.match(y,/AQEELOS_URLS: \$\{\{ secrets\.AQEELOS_URLS \}\}/);assert.ok(!/\$\{\{\s*vars\.[A-Z_]+\s*\}\}/.test(y),'no variable is handed to a step as it is');
 for(const m of y.matchAll(/\$\{\{([^}]*)\}\}/g))if(/vars\./.test(m[1]))assert.match(m[1],/^ (vars\.[A-Z_]+ != '' (\|\| )?)+$/,'a variable is only asked whether it is set: '+m[1]);
 assert.match(y,/node scripts\/uptime-check\.mjs/)});

test('the list still in a repository variable: nothing is checked, the run fails and says to move it to a secret (never quietly off)',async()=>{
 const out=[];const w=world();const r=await run({env:{...ENV,AQEELOS_URLS_IN_VARIABLE:'true'},fetch:w.f,sleep:w.sleep,log:x=>out.push(x)});
 assert.equal(r.misplaced,true);assert.match(out[0],/^::error::.*SECRET named AQEELOS_URLS/);assert.equal(w.calls.length,0);
 assert.equal((await run({env:{...ENV,AQEELOS_URLS_IN_VARIABLE:'false'},fetch:w.f,sleep:w.sleep,log:()=>{}})).misplaced,undefined);
 assert.match(readFileSync(new URL('./uptime-check.mjs',import.meta.url),'utf8'),/process\.exit\(r\.down\.length\|\|r\.misplaced\?1:0\)/)});
