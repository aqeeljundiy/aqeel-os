// node scripts/fixer-git.test.mjs — GIT-2: the fixer ships through GitHub. Its own git checkout and branch per issue
// (fixer-git.mjs, real git on temp repos), the pull request call, the fixer loop with no token / a token that appears later
// (issues.mjs), the Health list of fixes waiting for review, and the hand-edit check of the live folder (live-drift.mjs)
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,utimes,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createFixerGit,repoSlug,unsafeFile,branchOf} from '../app/fixer-git.mjs';
import {createLiveDrift,liveDrift,blobId} from '../app/live-drift.mjs';
import {createIssues,confinedPrompt,repairPrompt} from '../app/issues.mjs';
import {fakeFixerSandbox} from './lib/fake-fixer-sandbox.mjs';
import {createCodeChanges} from '../app/code-changes.mjs';
import {personNeed} from '../app/bottlenecks.mjs';
let n=0;const t=async(name,f)=>{await f();n++;console.log('ok',name)};
const tmp=p=>mkdtemp(path.join(tmpdir(),p));
const G=(cwd,...a)=>execFileSync('git',['-c','user.name=t','-c','user.email=t@t',...a],{cwd,encoding:'utf8'}).trim();
const fwd=p=>p.replace(/\\/g,'/');

// a "GitHub": a bare repo the box's checkout reaches through its https address (insteadOf), with main already pushed
async function world(){const bare=await tmp('bare-'),seed=await tmp('seed-'),home=await tmp('home-'),DATA=await tmp('data-');
 G(bare,'init','-q','--bare','-b','main');G(seed,'init','-q','-b','main');await mkdir(path.join(seed,'app'));await writeFile(path.join(seed,'app','a.mjs'),'one\n');await writeFile(path.join(seed,'app','b.mjs'),'two\n');
 G(seed,'add','-A');G(seed,'commit','-q','-m','first');G(seed,'push','-q',fwd(bare),'main');
 const src=path.join(home,'apps','aqeel-os-src');await mkdir(path.dirname(src),{recursive:true});G(home,'clone','-q',fwd(bare),src);
 G(src,'remote','set-url','origin','https://github.com/acme/os.git');G(src,'config','url.'+fwd(bare)+'.insteadOf','https://github.com/acme/os.git');G(src,'fetch','-q','origin');
 return {bare,home,DATA,src,main:G(seed,'rev-parse','HEAD')}}
const PRS=[];const fakeFetch=(status=201)=>async(url,o)=>{PRS.push({url,o});const body=o.body?JSON.parse(o.body):null;
 return {status,json:async()=>status===201?{html_url:'https://github.com/acme/os/pull/7',number:7}:status===422?{message:'A pull request already exists'}:{message:'Bad credentials'}}};

await t('names: the branch per issue, the repo from an address, files a fix may never carry',()=>{
 assert.equal(branchOf('i5b25e818'),'fix/i5b25e818');assert.throws(()=>branchOf('../x y'),/Unknown issue/);
 assert.equal(repoSlug('https://github.com/aqeeljundiy/aqeel-os.git'),'aqeeljundiy/aqeel-os');assert.equal(repoSlug('git@github.com:a/b.git'),'a/b');assert.equal(repoSlug('/srv/bare'),'');
 for(const f of ['.env','app/.env.local','key.pem','data/users.json','node_modules/x/y.js','a/id_rsa'])assert.equal(unsafeFile(f),true,f);
 for(const f of ['app/issues.mjs','.env.example','scripts/data-check.mjs','engine/patches/2026-11-12-fixer-i1.patch'])assert.equal(unsafeFile(f),false,f)});

await t('a work dir of its own on fix/<id> cut from main; a fix is committed there and the live folder is never involved',async()=>{const W=await world();const F=createFixerGit({DATA:W.DATA,home:W.home});
 const p=await F.prepare('i1');assert.equal(p.ok,true,p.why);assert.equal(p.branch,'fix/i1');assert.equal(p.dir,path.join(W.home,'apps','aqeel-os-fixer','i1'));assert.equal(G(p.dir,'rev-parse','--abbrev-ref','HEAD'),'fix/i1');assert.equal(G(p.dir,'rev-parse','HEAD'),W.main);
 assert.equal(await F.dirty('i1'),false);await writeFile(path.join(p.dir,'app','a.mjs'),'one fixed\n');await writeFile(path.join(p.dir,'app','new.mjs'),'new\n');assert.equal(await F.dirty('i1'),true);
 const f=await F.finish('i1',{message:'Fixer: a thing',engine:[{name:'2026-11-12-fixer-i1.patch',text:'--- a/x\n+++ b/x\n'},{name:'../bad.patch',text:'x'}]});
 assert.equal(f.ok,true,f.why);assert.deepEqual(f.files.sort(),['app/a.mjs','app/new.mjs','engine/patches/2026-11-12-fixer-i1.patch']);
 assert.equal(G(W.src,'log','-1','--format=%an|%s','fix/i1'),'aqeelOS fixer|Fixer: a thing');assert.equal(G(W.src,'show','fix/i1:app/a.mjs'),'one fixed');assert.equal(G(W.src,'rev-parse','main'),W.main,'main is untouched');
 assert.match(await F.diff('i1'),/\+one fixed/);
 // a second try starts again from main
 const p2=await F.prepare('i1');assert.equal(p2.ok,true);assert.equal(G(p2.dir,'rev-parse','HEAD'),W.main);assert.equal((await F.finish('i1',{message:'x'})).empty,true)});

await t('a fix that carries a key or data is refused, nothing is committed',async()=>{const W=await world();const F=createFixerGit({DATA:W.DATA,home:W.home});const p=await F.prepare('i2');
 await writeFile(path.join(p.dir,'app','.env'),'KEY=abcdefghijk\n');await writeFile(path.join(p.dir,'app','a.mjs'),'x\n');const f=await F.finish('i2',{message:'x'});
 assert.equal(f.ok,false);assert.match(f.why,/never may: app\/\.env/);assert.equal(G(p.dir,'rev-parse','HEAD'),W.main)});

await t('no token: the branch waits (nothing pushed); with a token it is pushed and the pull request opened, the token only in headers',async()=>{const W=await world();PRS.length=0;let tok='';
 const F=createFixerGit({DATA:W.DATA,home:W.home,token:async()=>tok,fetchFn:fakeFetch()});const p=await F.prepare('i3');await writeFile(path.join(p.dir,'app','a.mjs'),'fixed\n');await F.finish('i3',{message:'m'});
 assert.equal(await F.hasToken(),false);assert.deepEqual(await F.publish('i3',{title:'T',body:'B'}),{state:'waiting'});assert.equal(PRS.length,0);assert.equal(G(W.bare,'branch','--list','fix/*'),'');
 tok='ghp_secret123';assert.equal(await F.hasToken(),true);const r=await F.publish('i3',{title:'Fixer: T',body:'B'});
 assert.deepEqual(r,{state:'pr',url:'https://github.com/acme/os/pull/7',number:7});assert.match(G(W.bare,'branch','--list','fix/*'),/fix\/i3/);
 assert.equal(PRS[0].url,'https://api.github.com/repos/acme/os/pulls');assert.equal(PRS[0].o.headers.Authorization,'Bearer ghp_secret123');
 assert.deepEqual([JSON.parse(PRS[0].o.body).head,JSON.parse(PRS[0].o.body).base,JSON.parse(PRS[0].o.body).title],['fix/i3','main','Fixer: T']);
 assert.doesNotMatch(G(W.src,'config','--local','-l'),/ghp_secret123|extraheader/i,'the token is not stored in the checkout');
 // main is protected on GitHub's side; the token may not push it. Here: only the fix branch was pushed
 assert.equal(G(W.bare,'rev-parse','main'),W.main)});

await t('the pull request call: already open is found, a refusal comes back as an error without the token',async()=>{const W=await world();
 const F=createFixerGit({DATA:W.DATA,home:W.home,token:async()=>'ghp_zzz',fetchFn:async(u,o)=>u.includes('?state=open')?{status:200,json:async()=>[{html_url:'https://github.com/acme/os/pull/3',number:3}]}:{status:422,json:async()=>({message:'exists'})}});
 const p=await F.prepare('i4');await writeFile(path.join(p.dir,'app','a.mjs'),'y\n');await F.finish('i4',{message:'m'});assert.deepEqual(await F.publish('i4',{}),{state:'pr',url:'https://github.com/acme/os/pull/3',number:3});
 const F2=createFixerGit({DATA:W.DATA,home:W.home,token:async()=>'ghp_zzz',fetchFn:async()=>({status:401,json:async()=>({message:'Bad credentials ghp_zzz'})})});
 const e=await F2.publish('i4',{});assert.equal(e.state,'error');assert.match(e.why,/401/);assert.doesNotMatch(e.why,/ghp_zzz/)});

await t('the token comes from the env or DATA/fixer-github-token, read every time',async()=>{const W=await world();const F=createFixerGit({DATA:W.DATA,home:W.home});const was=process.env.AQEELOS_FIXER_GITHUB_TOKEN;delete process.env.AQEELOS_FIXER_GITHUB_TOKEN;
 try{assert.equal(await F.hasToken(),false);await writeFile(path.join(W.DATA,'fixer-github-token'),'tok\n');assert.equal(await F.hasToken(),true)}finally{if(was)process.env.AQEELOS_FIXER_GITHUB_TOKEN=was}});

await t('no checkout and no way to make one: prepare says so (the fixer then uses the older patch-file way)',async()=>{const home=await tmp('home-'),DATA=await tmp('data-');
 const F=createFixerGit({DATA,home,repo:()=>path.join(home,'nowhere.git')});const p=await F.prepare('i5');assert.equal(p.ok,false);assert.match(p.why,/no checkout/)});

// ---------- the fixer loop, with a fake git
const POL={owner:{name:'Owner',telegram:['1']},teams:[],fixer:{on:true,agent:'default',cap:20}};
function fakeGit(d,{token=false,dirty=true,finish=null}={}){const g={calls:[],token,prepare:async id=>{g.calls.push('prepare '+id);const dir=path.join(d,'work',id);await mkdir(dir,{recursive:true});return {ok:true,dir,branch:'fix/'+id}},
 hasToken:async()=>g.token,dirty:async()=>dirty,finish:async(id,o)=>{g.calls.push('finish '+id);g.engine=o.engine;g.message=o.message;return finish||{ok:true,sha:'abc123',files:['app/x.mjs']}},
 publish:async id=>{g.calls.push('publish '+id);return g.token?{state:'pr',url:'https://github.com/acme/os/pull/'+(g.calls.length),number:g.calls.length}:{state:'waiting'}},diff:async()=>'d'};return g}
async function loop({fix=[],proof=[],git={},codeRoots=[]}={}){const d=await tmp('is-');await writeFile(path.join(d,'team-policy.json'),JSON.stringify(POL));const runs=[],asked={need:0,ok:0};const g=fakeGit(d,git);
 const launch=async o=>{const p=await readFile(path.join(o.dir,'prompt.txt'),'utf8');const kind=/^You are the aqeelOS fixer's proof run/.test(p)?'proof':'fix';runs.push({kind,prompt:p});
  const ans=(kind==='fix'?fix:proof).shift();await writeFile(path.join(o.dir,'out.txt'),'RESULT: '+JSON.stringify(ans));await writeFile(path.join(o.dir,'exit'),'0');return 1};
 const I=createIssues({sandbox:fakeFixerSandbox(),DATA:d,bin:'x',fixerHome:d,log:()=>{},launch,alive:async()=>false,git:g,codeRoots,tz:()=>'UTC',busy:async()=>0,apply:async()=>({ok:true}),
  needToken:async()=>{asked.need++},tokenOk:async()=>{asked.ok++}});
 const file=async o=>{const r=await I.file(o);(await I._db()).items.find(x=>x.id===r.issue.id).sorted='code';return r};
 return {d,I,g,runs,asked,file,ticks:async k=>{for(let j=0;j<k;j++)await I.tick()},db:async()=>(await I._db()).items}}

await t('no token: the fix waits as a committed branch, nothing live, one "needs a token" note however many fixes wait, then the pull requests open by themselves',async()=>{
 const L=await loop({fix:[{status:'patch',summary:'guard the push',proof:'tests pass; test copy answers'},{status:'patch',summary:'second one',proof:'ok'}]});
 await L.file({agent:'a1',missing:'tool server answers 500'});await L.ticks(3);
 let [i]=await L.db();assert.equal(i.state,'deploy');assert.equal(i.git.branch,'fix/'+i.id);assert.equal(i.git.state,'waiting');assert.equal(i.patch,'fix/'+i.id);assert.equal(L.runs.length,1,'no proof run before the merge and the deploy');
 assert.match(L.runs[0].prompt,/confined/);assert.match(L.runs[0].prompt,new RegExp('work.'+i.id));assert.match(L.runs[0].prompt,/testcopy/);assert.match(L.runs[0].prompt,/4402/);assert.doesNotMatch(L.runs[0].prompt,/you may change those files on the box/);
 assert.match(i.history[0].outcome,/branch fix\/.* committed; waits for review/);assert.equal(L.asked.need,1);
 await L.file({agent:'a2',missing:'a different problem entirely about payments'});await L.ticks(3);assert.equal(L.asked.need,1,'once, not one per fix');assert.equal((await L.db()).filter(x=>x.git).length,2);
 const rv=await L.I.reviews();assert.equal(rv.length,2);assert.deepEqual([rv[0].state,rv[0].url],['waiting',null]);assert.equal(rv[0].files[0],'app/x.mjs');
 // the token appears
 L.g.token=true;await L.ticks(1);const done=await L.db();assert.deepEqual(done.map(x=>x.git.state),['pr','pr']);assert.equal(L.asked.ok,1);
 const rv2=await L.I.reviews();assert.match(rv2[0].url,/^https:\/\/github\.com\/acme\/os\/pull\//);assert.equal(rv2[0].state,'pr');
 assert.equal(L.g.calls.filter(c=>c.startsWith('publish')).length,4,'two tries without a token, then each opened once');await L.ticks(2);assert.equal(L.g.calls.filter(c=>c.startsWith('publish')).length,4,'an open pull request is not pushed again')});

await t('with a token the pull request opens at once; the commit says what and why; urgent goes the same way',async()=>{
 const L=await loop({git:{token:true},fix:[{status:'patch',summary:'reset clears the pause',proof:'ok'}]});await L.file({agent:'a1',missing:'reset reply held by a pause',urgent:true});await L.ticks(3);
 const [i]=await L.db();assert.equal(i.git.state,'pr');assert.match(i.git.url,/pull\//);assert.equal(L.asked.need,0);assert.match(L.g.message,/^Fixer: reset reply held by a pause/);assert.match(L.g.message,/Opened by the aqeelOS fixer/);
 assert.match(i.git.body,/Proof \(test copy and tests\)/);assert.match(L.runs[0].prompt,/URGENT \(an outage\): say so/);assert.doesNotMatch(L.runs[0].prompt,/you may change those files on the box/)});

await t('nothing changed in the checkout: that is a failed try, the issue is queued again',async()=>{
 const L=await loop({git:{dirty:false,finish:{ok:true,empty:true,files:[]}},fix:[{status:'patch',summary:'did nothing'}]});await L.file({agent:'a1',missing:'something broke'});await L.ticks(2);
 const [i]=await L.db();assert.equal(i.state,'queued');assert.equal(i.tries,1);assert.match(i.history[0].outcome,/no code change in the checkout/);assert.equal(i.git,undefined)});

await t('a fix that is not a code change (status changed, nothing in the checkout) goes the normal way: reload and proof',async()=>{
 const L=await loop({git:{dirty:false},fix:[{status:'no_change',summary:'already works',check:'rerun it'}],proof:[{status:'proven',proof:'works'}]});await L.file({agent:'a1',missing:'looks broken'});await L.ticks(4);
 const [i]=await L.db();assert.equal(i.state,'fixed');assert.equal(L.g.calls.filter(c=>c.startsWith('finish')).length,0)});

await t('the confined code prompt names the checkout and the branch; nothing in it lets the run change the live folders',()=>{
 const i={id:'i1',agent:'a1',missing:'m'},p=confinedPrompt(i,{git:{dir:'/w/i1',branch:'fix/i1'},url:'http://127.0.0.1:4400/fixer-ops/i1/i1-1/'+'a'.repeat(32)});
 assert.match(p,/branch fix\/i1/);assert.match(p,/cd \/w\/i1/);assert.doesNotMatch(p,/you may change those files on the box|hot-patch/)});

// ---------- Health: fixes waiting for review, hand edits
await t('Health list: a fixer branch with its pull request link (or its wait for a token), one hand-edit item, the diff to view',async()=>{const D=await tmp('cc-');
 const C=createCodeChanges({DATA:D,fixes:async()=>[{issue:'i9',branch:'fix/i9',at:5,files:['app/a.mjs'],note:'guard it',url:'https://github.com/acme/os/pull/7',number:7,state:'pr'},{issue:'i8',branch:'fix/i8',at:4,files:[],state:'waiting'}],
  hand:async()=>({commit:'abcdef1234',at:9,count:2,files:['app/k.mjs','scripts/x.sh (removed)']}),diff:async id=>'diff of '+id});
 const l=await C.list();assert.deepEqual(l.map(x=>[x.kind,x.name]),[['hand','live-edits'],['pr','fix/i9'],['pr','fix/i8']]);
 assert.deepEqual([l[1].pr,l[1].number,l[1].issue,l[2].pr,l[2].state],['https://github.com/acme/os/pull/7',7,'i9',null,'waiting']);assert.match(l[0].note,/abcdef12.*\(2\)/);
 assert.equal(await C.read('pr','fix/i9'),'diff of i9');assert.equal(await C.read('hand','live-edits'),'app/k.mjs\nscripts/x.sh (removed)');
 await assert.rejects(C.done('pr','fix/i9'),/Unknown kind/);assert.deepEqual((await createCodeChanges({DATA:D}).list()),[])});

await t('the "Needs you" item for the token says what to do, in plain words',()=>{const x=personNeed({kind:'github_token',title:'The fixer needs a GitHub token'});assert.match(x,/Paste a GitHub token/);assert.match(x,/no admin/)});

// ---------- hand edits of the live folder (no model)
async function live(){const repo=await tmp('repo-'),L=await tmp('live-'),D=await tmp('ld-');G(repo,'init','-q','-b','main');
 for(const [f,x] of [['app/a.mjs','one\n'],['app/b.mjs','two\n'],['scripts/s.sh','echo\n'],['README.md','not deployed\n']]){await mkdir(path.dirname(path.join(repo,f)),{recursive:true});await writeFile(path.join(repo,f),x);await mkdir(path.dirname(path.join(L,f)),{recursive:true});await writeFile(path.join(L,f),x)}
 G(repo,'add','-A');G(repo,'commit','-q','-m','c');const sha=G(repo,'rev-parse','HEAD');await writeFile(path.join(L,'.deployed-commit'),sha+'\n');const old=new Date(Date.now()-3600e3);await utimes(path.join(L,'.deployed-commit'),old,old);
 return {repo,L,D,sha}}
await t('hand edits: a live folder equal to its commit is clean; leftovers, backups and files outside the packed folders are not edits',async()=>{const S=await live();
 await writeFile(path.join(S.L,'app','a.mjs.bak-20261107-i1-1'),'old\n');await mkdir(path.join(S.L,'app','node_modules'));await writeFile(path.join(S.L,'app','node_modules','x.js'),'x');await writeFile(path.join(S.L,'README.md'),'edited, but not a deployed folder\n');
 const old=new Date(Date.now()-7200e3);await writeFile(path.join(S.L,'app','left.mjs'),'leftover\n');await utimes(path.join(S.L,'app','left.mjs'),old,old);
 const r=await liveDrift({live:S.L,repo:S.repo});assert.equal(r.ok,true);assert.deepEqual([r.changed,r.removed,r.added],[[],[],[]]);assert.equal(blobId(Buffer.from('one\n')),G(S.repo,'hash-object','app/a.mjs'))});
await t('hand edits: a changed file, a removed file and a new one are found; one Health item once it lasted, gone when the folder matches again',async()=>{const S=await live();let clock=1e12;
 const C=createLiveDrift({DATA:S.D,live:S.L,repo:S.repo,settle:600e3,now:()=>clock});assert.equal((await C.check()).ok,true);assert.equal(await C.item(),null);
 await writeFile(path.join(S.L,'app','a.mjs'),'one hand-edited\n');await rm(path.join(S.L,'scripts','s.sh'));await writeFile(path.join(S.L,'app','new.mjs'),'brand new\n');
 const r=await C.check();assert.deepEqual([r.changed,r.removed,r.added],[['app/a.mjs'],['scripts/s.sh'],['app/new.mjs']]);assert.equal(await C.item(),null,'a deploy unpacks file by file: it must last first');
 clock+=700e3;await C.check();const it=await C.item();assert.deepEqual(it.files,['app/a.mjs','scripts/s.sh (removed)','app/new.mjs (new)']);assert.equal(it.count,3);assert.equal(it.commit,S.sha);
 await writeFile(path.join(S.L,'app','a.mjs'),'one\n');await writeFile(path.join(S.L,'scripts','s.sh'),'echo\n');await rm(path.join(S.L,'app','new.mjs'));await C.check();assert.equal(await C.item(),null)});
await t('hand edits: a commit the checkout does not have, or no commit on the box, reports nothing and says why',async()=>{const S=await live();
 await writeFile(path.join(S.L,'.deployed-commit'),'0123456789abcdef0123456789abcdef01234567\n');const a=await liveDrift({live:S.L,repo:S.repo});assert.equal(a.ok,false);assert.match(a.why,/does not have 01234567/);
 await rm(path.join(S.L,'.deployed-commit'));assert.match((await liveDrift({live:S.L,repo:S.repo})).why,/does not say/)});

console.log(n+' passed');
