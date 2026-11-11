// Tests for restoring from a backup (app/backup.mjs, switched on 7 Nov 2026). Run: node --test scripts/backup-restore.test.mjs
// Everything runs on scratch folders: the preview, the journaled copy, an exact roll back (also after a copy that was cut
// off), the whole restore with the agents stopping and starting, the key check, the settings and the "Connect Google
// first" state. No network: Google is never reached.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync,readdirSync,lstatSync,symlinkSync,readlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {excluded,preview,copyOver,rollBack,commit,applyRestore,headOpens,createBackups} from '../app/backup.mjs';

const w=(f,t)=>{mkdirSync(path.dirname(f),{recursive:true});writeFileSync(f,t)};
// a folder as {path: content | '<dir>' | '-> target'}, to compare before and after
function tree(d,rel=''){const out={};for(const n of readdirSync(path.join(d,rel)).sort()){const r=rel?rel+'/'+n:n,f=path.join(d,r),s=lstatSync(f);
 if(s.isSymbolicLink())out[r]='-> '+readlinkSync(f);else if(s.isDirectory()){out[r]='<dir>';Object.assign(out,tree(d,r))}else out[r]=readFileSync(f,'utf8')}return out}
// today's box and an older backup of it
function scene(){const T=mkdtempSync(path.join(tmpdir(),'aq-restore-')),HOME=path.join(T,'home'),H=path.join(HOME,'.hermes'),src=path.join(T,'b','.hermes');
 w(path.join(H,'config.yaml'),'today');w(path.join(H,'state.db'),'db today');w(path.join(H,'state.db-wal'),'wal today');w(path.join(H,'profiles/new/config.yaml'),'made after');
 w(path.join(H,'profiles/a/config.yaml'),'a today');w(path.join(H,'profiles/a/skill.md'),'made after');w(path.join(H,'gateway.pid'),'2');w(path.join(H,'hermes-agent/run.py'),'program');
 w(path.join(H,'clash1'),'a file today');mkdirSync(path.join(H,'clash2/inner'),{recursive:true});w(path.join(H,'clash2/inner/x'),'a folder today');
 w(path.join(src,'config.yaml'),'backup');w(path.join(src,'state.db'),'db backup!');w(path.join(src,'profiles/a/config.yaml'),'a backup');w(path.join(src,'profiles/gone/config.yaml'),'deleted since');
 w(path.join(src,'gateway.pid'),'1');w(path.join(src,'clash1/y'),'a folder in the backup');w(path.join(src,'clash2'),'a file in the backup');symlinkSync('config.yaml',path.join(src,'link'));
 return {T,HOME,H,src,done:()=>rmSync(T,{recursive:true,force:true})}}

test('the backup\'s left-out parts are known inside .hermes, at any depth like tar',()=>{
 for(const r of ['hermes-agent','installs','profiles/a/cache','x/node_modules','logs/agent.log','profiles/a/home/.cache'])assert.ok(excluded(r),r);
 for(const r of ['config.yaml','profiles/a/config.yaml','profiles/a/memories','logs'])assert.ok(!excluded(r),r)});

test('preview: what comes back, what is replaced or added, what stays, which agents',async()=>{const s=scene();try{const p=await preview(s.src,s.H);
 assert.deepEqual(p.agents.back,['gone']);assert.deepEqual(p.agents.stay,['new']);assert.ok(p.agents.both.includes('a'));
 assert.ok(p.sample.change.includes('config.yaml'));assert.ok(p.sample.add.includes('profiles/gone/config.yaml'));
 assert.ok(p.stay>=3,'made after: profiles/new, profiles/a/skill.md, state.db-wal');assert.ok(!p.sample.stay.some(x=>x.startsWith('hermes-agent')),'programs are not "kept" files');
 assert.ok(p.bytes>0&&p.copyBytes>0);assert.equal(tree(s.H)['config.yaml'],'today','nothing changed')}finally{s.done()}});

test('copy then commit: the backup\'s files come back, nothing on the box is deleted, running programs\' files stay',async()=>{const s=scene();try{const J=path.join(s.T,'j.jsonl');
 const n=await copyOver({src:s.src,dest:s.H,journal:J});await commit({dest:s.H,journal:J});const t=tree(s.H);
 assert.equal(t['config.yaml'],'backup');assert.equal(t['state.db'],'db backup!');assert.equal(t['profiles/a/config.yaml'],'a backup');assert.equal(t['profiles/gone/config.yaml'],'deleted since');
 assert.equal(t['profiles/new/config.yaml'],'made after');assert.equal(t['profiles/a/skill.md'],'made after');assert.equal(t['gateway.pid'],'2');assert.equal(t['hermes-agent/run.py'],'program');
 assert.equal(t['state.db-wal'],undefined,'the box\'s -wal of a restored database goes');assert.equal(t['clash1/y'],'a folder in the backup');assert.equal(t['clash2'],'a file in the backup');assert.equal(t['link'],'-> config.yaml');
 assert.ok(!Object.keys(t).some(k=>k.endsWith('.aqeelos-held')),'nothing held is left');assert.ok(!existsSync(J));assert.ok(n.files>=6)}finally{s.done()}});

test('copy then roll back: the box is exactly as before, file and folder clashes too',async()=>{const s=scene();try{const J=path.join(s.T,'j.jsonl'),before=tree(s.H);
 await copyOver({src:s.src,dest:s.H,journal:J});assert.notDeepEqual(tree(s.H),before);await rollBack({dest:s.H,journal:J});assert.deepEqual(tree(s.H),before);assert.ok(!existsSync(J))}finally{s.done()}});

test('a copy that fails halfway rolls back exactly from its journal',async()=>{const s=scene();try{const J=path.join(s.T,'j.jsonl'),before=tree(s.H);
 w(path.join(s.src,'zz/locked'),'x');chmodSync(path.join(s.src,'zz/locked'),0);   // read fails late in the walk
 if(process.getuid?.()===0)return;   // root reads anything
 await assert.rejects(()=>copyOver({src:s.src,dest:s.H,journal:J}));assert.ok(existsSync(J));await rollBack({dest:s.H,journal:J});assert.deepEqual(tree(s.H),before)}finally{s.done()}});

// the box has GNU tar; a Mac's bsdtar lacks --ignore-failed-read, so here a small stand-in leaves that one option out
let gnu=true;try{gnu=/GNU/.test(execFileSync('tar',['--version'],{encoding:'utf8'}))}catch{}
const shim=T=>{if(gnu)return 'tar';const f=path.join(T,'tar-gnuish');writeFileSync(f,'#!/bin/sh\nfor a; do shift; [ "$a" = --ignore-failed-read ] || set -- "$@" "$a"; done; exec tar "$@"\n');chmodSync(f,0o755);return f};
const run=(s,x={})=>{const n={stop:0,start:0,hold:[]};return {n,o:{src:s.src,HERMES_HOME:s.H,HOME:s.HOME,journal:path.join(s.T,'j.jsonl'),tar:shim(s.T),stopEngine:async()=>{n.stop++},startEngine:async()=>{n.start++},hold:on=>n.hold.push(on),...x}}};

test('restore: agents stop, a safety copy is made, the backup is copied, agents start again',async()=>{const s=scene();try{const {n,o}=run(s);
 const r=await applyRestore(o);assert.deepEqual([n.stop,n.start],[1,1]);assert.deepEqual(n.hold,[true,false]);assert.ok(existsSync(r.safety));assert.equal(tree(s.H)['config.yaml'],'backup');
 const list=execFileSync('tar',['-tzf',r.safety],{encoding:'utf8'});assert.match(list,/\.hermes\/config\.yaml/);assert.doesNotMatch(list,/hermes-agent/)}finally{s.done()}});
test('restore: agents that do not stop: nothing changes, they start again',async()=>{const s=scene();try{const before=tree(s.H);const {n,o}=run(s,{stopEngine:async()=>{throw Error('the dashboard still answers')}});
 await assert.rejects(()=>applyRestore(o),/did not stop.*nothing was changed/);assert.equal(n.start,1);assert.deepEqual(tree(s.H),before)}finally{s.done()}});
test('restore: a safety copy that fails leaves no half file and changes nothing',async()=>{const s=scene();try{const before=tree(s.H);const bad=path.join(s.T,'badtar');writeFileSync(bad,'#!/bin/sh\necho half > "$2"; exit 2\n');chmodSync(bad,0o755);
 const {n,o}=run(s,{tar:bad});await assert.rejects(()=>applyRestore(o),/could not be saved first/);
 assert.deepEqual(readdirSync(s.HOME).filter(f=>f.startsWith('aqeelos-before-restore')),[]);assert.deepEqual(tree(s.H),before);assert.deepEqual([n.stop,n.start],[1,1])}finally{s.done()}});
test('restore: a copy that fails is rolled back and says nothing changed',async()=>{const s=scene();try{if(process.getuid?.()===0)return;const before=tree(s.H);w(path.join(s.src,'zz/locked'),'x');chmodSync(path.join(s.src,'zz/locked'),0);
 const {n,o}=run(s);await assert.rejects(()=>applyRestore(o),/put back as it was, so nothing changed/);assert.deepEqual(tree(s.H),before);assert.equal(n.start,1)}finally{s.done()}});
test('restore: refuses while an earlier cut-off copy is not rolled back',async()=>{const s=scene();try{const {n,o}=run(s);writeFileSync(o.journal,'{"start":1}\n');
 await assert.rejects(()=>applyRestore(o),/cut off/);assert.equal(n.stop,0)}finally{s.done()}});

test('a typed key is checked on the first bytes of a backup',async()=>{const T=mkdtempSync(path.join(tmpdir(),'aq-key-'));try{const f=path.join(T,'b.enc');
 execFileSync('bash',['-c','head -c 200000 /dev/urandom | gzip | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:K -out "$F"'],{env:{...process.env,K:'k'.repeat(32),F:f}});
 const head=readFileSync(f).subarray(0,65536);assert.equal(await headOpens(head,'k'.repeat(32)),true);assert.equal(await headOpens(head,'x'.repeat(32)),false)}finally{rmSync(T,{recursive:true,force:true})}});

// the whole flow through createBackups, with the safety copy on the box as the backup (no Google needed)
function app(s,x={}){const DATA=path.join(s.T,'data');mkdirSync(DATA,{recursive:true});const n={stop:0,start:0,told:[]};const TMP=path.join(s.T,'tmp');mkdirSync(TMP,{recursive:true});
 const b=createBackups({DATA,HOME:s.HOME,HERMES_HOME:s.H,TMP,tar:shim(s.T),fetchImpl:async()=>{throw Error('no network in tests')},disk:async()=>({free:1e12,dev:'d'}),mem:async()=>20e9,notify:(...a)=>n.told.push(a),
  stopEngine:async()=>{n.stop++},startEngine:async()=>{n.start++},restored:(ok,t)=>n.told.push([ok,t]),...x});return {b,n,DATA,TMP}}
// polls a condition; the 60 s is only a guard against hanging, a busy box (tar, openssl, parallel tests) can be slow. Background Prepare/Restore are awaited with b.settled() instead
const until=async f=>{for(let i=0;i<2400;i++){if(await f())return;await new Promise(r=>setTimeout(r,25))}throw Error('timed out')};

test('no Google: the backup stays on the box (12 Nov 2026), nobody told; the Drive list says Connect Google first',async()=>{const s=scene();try{const {b,n}=app(s,{MIN:1});const st=await b.status();
 assert.equal(st.google.connected,false);await b.run('by hand');const l1=(await b.status()).last;assert.equal(l1.ok,true);assert.equal(l1.local,true);assert.deepEqual(n.told,[]);
 const l=await b.list();assert.equal(l.google,false);assert.match(l.error,/Connect Google first/)}finally{s.done()}});
test('a Google account without Drive or a lasting sign-in is said plainly',async()=>{const s=scene();try{const {b}=app(s,{MIN:1});
 // 12 Nov 2026: the backup still happens, on the box, and the result says why Google was not used
 w(path.join(s.H,'google_token.json'),JSON.stringify({account:'a@b.test',refresh_token:'r',scopes:['https://www.googleapis.com/auth/gmail.readonly']}));await b.run();assert.match((await b.status()).last.googleWhy,/without Drive/);
 w(path.join(s.H,'google_token.json'),JSON.stringify({account:'a@b.test',scopes:['https://www.googleapis.com/auth/drive']}));await b.run();assert.match((await b.status()).last.googleWhy,/no lasting sign-in/);
 w(path.join(s.H,'google_token.json'),JSON.stringify({account:'a@b.test',refresh_token:'r',scopes:['https://www.googleapis.com/auth/drive']}));assert.equal((await b.status()).google.connected,true)}finally{s.done()}});

test('settings: account, hour, how many to keep, folder, each checked',async()=>{const s=scene();try{const {b}=app(s);w(path.join(s.H,'google_token_work.json'),JSON.stringify({account:'w@b.test',refresh_token:'r',scopes:['https://www.googleapis.com/auth/drive']}));
 assert.deepEqual((await b.status()).settings,{account:'',hour:3,keep:14,folder:'aqeelOS backups'});
 const r=await b.setSettings({account:'google_token_work.json',hour:5,keep:7,folder:'Box backups'});assert.deepEqual(r,{account:'google_token_work.json',hour:5,keep:7,folder:'Box backups'});
 const st=await b.status();assert.equal(st.google.email,'w@b.test');assert.equal(st.where,'Google Drive › Box backups');assert.equal(st.keep,7);
 for(const bad of [{hour:24},{keep:0},{keep:61},{folder:'a/b'},{account:'../x.json'},{account:'google_token_gone.json'}])await assert.rejects(()=>b.setSettings(bad),undefined,JSON.stringify(bad))}finally{s.done()}});

test('backup key: typed in, checked, never silently replaced',async()=>{const s=scene();try{const {b,DATA}=app(s);
 await assert.rejects(()=>b.setKey('short'),/32 or more/);const k='A'.repeat(40);const r=await b.setKey(k);assert.equal(r.saved,true);assert.equal(r.opens,null,'no Google: not checked');
 assert.equal(await b.key(),k);assert.equal((readFileSync(path.join(DATA,'backup-key'))).toString(),k);assert.equal(lstatSync(path.join(DATA,'backup-key')).mode&0o777,0o600);
 writeFileSync(path.join(DATA,'backups.json'),JSON.stringify({made:true}));const {b:b2}=app(s);   // backups were made with it
 await assert.rejects(()=>b2.setKey('B'.repeat(40)),e=>e.status===409&&e.replace);assert.equal((await b2.setKey('B'.repeat(40),{replace:true})).saved,true);assert.equal(await b2.key(),'B'.repeat(40))}finally{s.done()}});

test('restore flow: prepare shows a preview and changes nothing; restore now copies, stops and starts the agents once',async()=>{const s=scene();try{
 // a safety copy on the box is a restore source like a Drive backup
 execFileSync('tar',['-czf',path.join(s.HOME,'aqeelos-before-restore-2026-11-01-02-03-04.tar.gz'),'-C',path.dirname(s.src),'.hermes']);
 const {b,n}=app(s);const l=await b.list();assert.equal(l.items[0].id,'local:aqeelos-before-restore-2026-11-01-02-03-04.tar.gz');const before=tree(s.H);
 await b.prepare(l.items[0].id);await b.settled();let st=await b.status();
 assert.equal(st.restore.phase,'ready',JSON.stringify(st.restore));assert.deepEqual(st.prepared.preview.agents.back,['gone']);assert.deepEqual(tree(s.H),before);assert.equal(n.stop,0);
 await b.apply();await b.settled();st=await b.status();
 assert.equal(st.restore.phase,'done',JSON.stringify(st.restore));assert.equal(tree(s.H)['config.yaml'],'backup');assert.equal(tree(s.H)['profiles/new/config.yaml'],'made after');assert.deepEqual([n.stop,n.start],[1,1]);
 assert.equal(st.prepared,null);await assert.rejects(()=>b.apply(),/Prepare the backup first/);assert.ok(n.told.some(t=>t[0]===true))}finally{s.done()}});
test('restore flow: Cancel throws the prepared copy away',async()=>{const s=scene();try{execFileSync('tar',['-czf',path.join(s.HOME,'aqeelos-before-restore-2026-11-01-02-03-04.tar.gz'),'-C',path.dirname(s.src),'.hermes']);
 const {b,TMP}=app(s);await b.prepare('local:aqeelos-before-restore-2026-11-01-02-03-04.tar.gz');await b.settled();
 assert.equal(readdirSync(TMP).length,1);await b.cancel();assert.equal(readdirSync(TMP).length,0);assert.equal((await b.status()).prepared,null)}finally{s.done()}});
test('restore flow: a cut-off copy is rolled back on start, the agents stopped meanwhile',async()=>{const s=scene();try{const {b,n,DATA}=app(s);const before=tree(s.H);
 await copyOver({src:s.src,dest:s.H,journal:path.join(DATA,'restore-journal.jsonl')});assert.notDeepEqual(tree(s.H),before);   // aqeelOS "stopped" here
 const r=await b.recover();assert.equal(r.recovered,true);assert.deepEqual(tree(s.H),before);assert.deepEqual([n.stop,n.start],[1,1]);assert.match((await b.status()).restore.error,/put back as it was/);
 assert.equal((await b.recover()).recovered,false)}finally{s.done()}});
test('prepare refuses a file that is not a safety copy',async()=>{const s=scene();try{const {b}=app(s);await assert.rejects(()=>b.prepare('local:../../etc/passwd'),/not one of the safety copies/)}finally{s.done()}});
test('a safety copy whose folder has another name than the engine folder still prepares',async()=>{const s=scene();try{const other=path.join(s.T,'pack','eng');mkdirSync(path.dirname(other),{recursive:true});
 execFileSync('cp',['-R',s.src,other]);execFileSync('tar',['-czf',path.join(s.HOME,'aqeelos-before-restore-2026-11-01-02-03-04.tar.gz'),'-C',path.dirname(other),'eng']);
 const {b}=app(s);await b.prepare('local:aqeelos-before-restore-2026-11-01-02-03-04.tar.gz');await b.settled();
 const st=await b.status();assert.equal(st.restore.phase,'ready',JSON.stringify(st.restore));assert.deepEqual(st.prepared.preview.agents.back,['gone'])}finally{s.done()}});

/* 7 Nov 2026: a 12.7 GB Prepare filled the container's memory with file cache. Memory is checked first, each piece is
   dropped from the cache, the size and time are shown before it starts, and Stop ends it at once. */
import {memFree,dropCache,MEM_NEED} from '../app/backup.mjs';
test('free memory: the container limit first, else MemAvailable, else unknown',async()=>{const T=mkdtempSync(path.join(tmpdir(),'aq-mem-'));try{
 writeFileSync(path.join(T,'memory.max'),'32000000000\n');writeFileSync(path.join(T,'memory.current'),'29000000000\n');assert.equal(await memFree(T,'/nope'),3e9);
 writeFileSync(path.join(T,'memory.max'),'max\n');writeFileSync(path.join(T,'mi'),'MemTotal: 1 kB\nMemAvailable:   2048 kB\n');assert.equal(await memFree(T,path.join(T,'mi')),2048*1024);
 assert.equal(await memFree(path.join(T,'none'),'/nope'),null);assert.equal(typeof await dropCache([T]),'boolean')}finally{rmSync(T,{recursive:true,force:true})}});
// a fake Google Drive with one backup of `size` bytes, answering media ranges slowly
function drive(size,{slow=0}={}){const calls={pieces:0};return {calls,fetchImpl:async(u,o={})=>{u=String(u);
 if(u.includes('oauth2'))return {ok:true,json:async()=>({access_token:'t'})};
 if(u.includes('files?q='))return {ok:true,json:async()=>({files:[{id:'fold'}]})};
 if(/files\/b1\?fields/.test(u))return {ok:true,json:async()=>({id:'b1',name:'aqeelos-2026-11-07-03-04.tar.gz.enc',parents:['fold'],size:String(size)})};
 if(u.includes('alt=media')){const [a,b]=/bytes=(\d+)-(\d+)/.exec(o.headers.range).slice(1).map(Number);calls.pieces++;if(slow)await new Promise((r,j)=>{const t=setTimeout(r,slow);o.signal?.addEventListener('abort',()=>{clearTimeout(t);j(Error('aborted'))})});
  return {ok:true,status:206,body:new Blob([Buffer.alloc(b-a+1,7)]).stream()}}
 throw Error('unexpected '+u)}}}
const signIn=s=>w(path.join(s.H,'google_token.json'),JSON.stringify({account:'a@b.test',refresh_token:'r',client_id:'c',client_secret:'s',scopes:['https://www.googleapis.com/auth/drive']}));
test('Prepare refuses plainly when the box is short on memory, before any download',async()=>{const s=scene();try{signIn(s);const d=drive(1e6);const {b,TMP}=app(s,{fetchImpl:d.fetchImpl,mem:async()=>2e9});
 await assert.rejects(()=>b.prepare('b1'),e=>/short on memory right now: 2\.0 GB free/.test(e.message)&&/Nothing was changed/.test(e.message));assert.equal(d.calls.pieces,0);assert.deepEqual(readdirSync(TMP),[]);
 const e=await b.estimate('b1');assert.equal(e.ok,false);assert.match(e.why,/short on memory/);assert.equal(e.memNeed,MEM_NEED)}finally{s.done()}});
test('the estimate says the download, the time and the space before anything starts',async()=>{const s=scene();try{signIn(s);const {b,TMP}=app(s,{fetchImpl:drive(50e6).fetchImpl,mem:async()=>20e9});
 const e=await b.estimate('b1');assert.equal(e.ok,true);assert.equal(e.size,50e6);assert.equal(e.secs,Math.round(50e6/5e6)+60);assert.equal(e.measured,false);assert.equal(e.tmpNeed,50e6*3.5+1e9);assert.deepEqual(readdirSync(TMP),[])}finally{s.done()}});
test('each downloaded piece is dropped from the cache; Stop ends the download at once and leaves nothing',async()=>{const s=scene();try{signIn(s);const d=drive(10*1024,{slow:150});const dropped=[];
 const {b,TMP}=app(s,{fetchImpl:d.fetchImpl,mem:async()=>20e9,PIECE:1024,drop:async p=>{dropped.push(p[0])}});
 await b.prepare('b1');await until(async()=>dropped.length>=2);let st=await b.status();assert.equal(st.restore.phase,'preparing');assert.ok(st.restore.got>=2048,'progress is shown');
 assert.ok(dropped.every(f=>f.endsWith('.enc')));const r=await b.cancel();assert.equal(r.stopped,true);
 st=await b.status();assert.equal(st.restore,null);assert.equal(st.preparing,false);assert.ok(d.calls.pieces<10,'it stopped early: '+d.calls.pieces);assert.deepEqual(readdirSync(TMP),[])}finally{s.done()}});
