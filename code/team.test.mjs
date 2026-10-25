// Team folders in Code (team.mjs): the junk rules, size limits, conflict detection, and chats that are shared.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {junk,excludeBlock,checkSizes,parseUnmerged,mergeChats,cleanChat,redact,summarize,MAX_FILE} from './team.mjs';

const ENV={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'T',GIT_AUTHOR_EMAIL:'t@t',GIT_COMMITTER_NAME:'T',GIT_COMMITTER_EMAIL:'t@t'};
const run=(cwd,...a)=>new Promise(r=>execFile('git',a,{cwd,env:ENV},(e,out,err)=>r({code:e?e.code||1:0,out:String(out),err:String(err)})));
const git=async(cwd,...a)=>{const r=await run(cwd,...a);if(r.code&&!/^(merge|check-ignore)$/.test(a[0]))throw Error(a.join(' ')+': '+r.err);return r};

test('junk: dependencies, build output, caches, secrets and key files stay out; work stays in',()=>{
 for(const p of ['node_modules/react/index.js','web/node_modules/x.js','dist/app.js','build/index.html','.next/cache/a','.DS_Store','img/.DS_Store','.env','.env.local','config/.env.production','server.key','certs/site.pem','id_rsa','id_ed25519.pub','__pycache__/a.pyc','npm-debug.log','.cache/x','coverage/lcov.info','.claude/settings.local.json'])assert.ok(junk(p),p);
 for(const p of ['index.html','src/app.js','.env.example','docs/build-notes.md','outputs/deck/slides.json','.code-team/chats/rina/1.json','builder.js','key.txt'])assert.ok(!junk(p),p);
 assert.ok(junk('.code-team/chats/rina/1.json',false),'files only: chats stay out')});
test('junk: git itself agrees with the rules written to info/exclude',async()=>{const d=await mkdtemp(path.join(tmpdir(),'tj-'));await git(d,'init','-q');await writeFile(path.join(d,'.git','info','exclude'),excludeBlock(false)+'\n');
 const paths=['node_modules/a.js','dist/x.js','.env','.env.local','.env.example','a.key','id_rsa','index.html','src/x.js','.code-team/chats/a/1.json','x/.DS_Store','build/a.html','docs/build-notes.md'];
 const r=await git(d,'check-ignore','--no-index',...paths);const ignored=new Set(r.out.split('\n').filter(Boolean));for(const p of paths)assert.equal(ignored.has(p),junk(p,false),p)});
test('sizes: one file over 50 MB, or a push over 200 MB, is refused with a clear message',()=>{
 assert.throws(()=>checkSizes([{path:'video/intro.mp4',size:MAX_FILE+1},{path:'a',size:10}]),/video\/intro\.mp4 is 50 MB.*\.gitignore/);
 assert.throws(()=>checkSizes(Array.from({length:5},(_,i)=>({path:'f'+i,size:45*1048576}))),/add up to 225 MB.*200 MB at most/);
 assert.doesNotThrow(()=>checkSizes([{path:'a',size:1000},{path:'b',size:MAX_FILE}]))});
test('summary line for a commit',()=>{assert.equal(summarize([['A','about.html']]),'Added about.html');assert.equal(summarize([['M','.code-team/chats/x/1.json']]),'Updated chats')});
test('conflicts: both changed the same file, one deleted what the other changed',async()=>{const hub=await mkdtemp(path.join(tmpdir(),'th-'));await git(hub,'init','-q','--bare','-b','main');
 const a=await mkdtemp(path.join(tmpdir(),'ta-')),b=await mkdtemp(path.join(tmpdir(),'tb-'));await git(a,'init','-q','-b','main');await writeFile(path.join(a,'index.html'),'<h1>Hello</h1>\n');await writeFile(path.join(a,'about.html'),'about\n');await writeFile(path.join(a,'notes.md'),'n\n');
 await git(a,'add','-A');await git(a,'commit','-qm','first');await git(a,'push','-q',hub,'HEAD:refs/heads/main');await git(b,'clone','-q',hub,'.');
 await writeFile(path.join(a,'index.html'),'<h1>Hello from A</h1>\n');await writeFile(path.join(a,'about.html'),'about A\n');await git(a,'commit','-qam','a');await git(a,'push','-q',hub,'HEAD:refs/heads/main');
 await writeFile(path.join(b,'index.html'),'<h1>Hello from B</h1>\n');await git(b,'rm','-q','about.html');await writeFile(path.join(b,'notes.md'),'n by B\n');await git(b,'commit','-qam','b');
 await git(b,'fetch','-q','origin');const m=await git(b,'merge','--no-edit','origin/main');assert.notEqual(m.code,0);
 const c=parseUnmerged((await git(b,'ls-files','-u','-z')).out).sort((x,y)=>x.path.localeCompare(y.path));
 assert.deepEqual(c,[{path:'about.html',mine:false,theirs:true},{path:'index.html',mine:true,theirs:true}]);assert.deepEqual(parseUnmerged(''),[])});
test('chats: secrets hidden, only what a teammate needs',()=>{const c=cleanChat({id:'c1',title:'Hero',sessions:{claude:'s-123'},messages:[{role:'user',text:'use key sk-ant-api03-abcdefghijklmnop and Bearer abcdefghijklmnopqrstuv',time:5,by:'x',account:'work'},{role:'assistant',text:'ok',files:['index.html'],billing:'$1',savedTo:'/Users/x',time:9}]});
 assert.equal(c.sessions,undefined);assert.equal(c.updated,9);assert.match(c.messages[0].text,/\[hidden\].*Bearer \[hidden\]/);assert.equal(c.messages[0].account,undefined);assert.equal(c.messages[1].billing,undefined);assert.equal(c.messages[1].savedTo,undefined);assert.deepEqual(c.messages[1].files,['index.html']);
 assert.equal(redact('aqc_ABCDEFGHIJKLMNOPQRSTUVWX ghp_abcdefghijklmnopqrstuvwxyz'),'[hidden] [hidden]')});
test('chats: imported with who wrote them, updated until continued here, then kept as mine',()=>{let n=0;const id=()=>'new'+(++n);const chats=[{id:'own',title:'Mine',messages:[{role:'user',text:'a'}]}];
 const inc=(msgs,title='Hero')=>[{uid:'rina',name:'Rina',chat:{id:'c1',title,messages:msgs}},{uid:'me',name:'Me',chat:{id:'own',title:'x',messages:[]}},{uid:'bad/../x',chat:{id:'c2',messages:[]}},{uid:'rina',chat:{id:'../x',messages:[]}}];
 let r=mergeChats(chats,inc([{role:'user',text:'1'}]),'me',id);assert.equal(r.added,1);assert.equal(chats.length,2);const t=chats.find(c=>c.id==='t-rina-c1');assert.equal(t.shared.fromName,'Rina');assert.equal(t.shared.count,1);
 r=mergeChats(chats,inc([{role:'user',text:'1'},{role:'assistant',text:'2'}]),'me',id);assert.equal(r.updated,1);assert.equal(chats.find(c=>c.id==='t-rina-c1').messages.length,2);
 chats.find(c=>c.id==='t-rina-c1').messages.push({role:'user',text:'mine now'});
 r=mergeChats(chats,inc([{role:'user',text:'1'},{role:'assistant',text:'2'},{role:'user',text:'3'}]),'me',id);assert.deepEqual(r.renamed,{'t-rina-c1':'new1'});
 const kept=chats.find(c=>c.id==='new1');assert.equal(kept.shared,undefined);assert.equal(kept.messages.at(-1).text,'mine now');assert.equal(chats.find(c=>c.id==='t-rina-c1').messages.length,3);assert.equal(chats.length,3)});
