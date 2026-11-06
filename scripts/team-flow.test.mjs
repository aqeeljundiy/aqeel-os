// Team folders end to end at module level: Code's team.mjs on two computers (two Code stores) and the hub
// (app/team-folders.mjs) behind a stand-in aqeelOS that knows people by their device key. Real git throughout.
// Run: node --test scripts/team-flow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import path from 'node:path';
import {createTeamFolders} from '../app/team-folders.mjs';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
// Code lives in code/ in the repo; a deployed copy has no code/ (deploy.sh ships it to ~/apps/aqeel-code), so fall back there.
const CODE=[process.env.AQEELOS_CODE_DIR,fileURLToPath(new URL('../code',import.meta.url)),path.join(homedir(),'apps','aqeel-code')].find(d=>d&&existsSync(path.join(d,'team.mjs')));
if(!CODE)throw new Error('team-flow test needs aqeelOS Code: no code/team.mjs here, set AQEELOS_CODE_DIR');
const {createTeam}=await import(pathToFileURL(path.join(CODE,'team.mjs')).href);
const {Workspace}=await import(pathToFileURL(path.join(CODE,'workspace.mjs')).href);

const NAMES={aqeel:'Aqeel',rina:'Rina',budi:'Budi',dewi:'Dewi'};
async function standIn(){const DATA=await mkdtemp(path.join(tmpdir(),'tfl-'));const hub=createTeamFolders({DATA,names:u=>NAMES[u]||u,known:u=>!!NAMES[u]});
 const srv=createServer(async(req,res)=>{const u=new URL(req.url,'http://x'),p=u.pathname,send=(c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
  const who=String(req.headers.authorization||'').replace(/^Bearer key-/,'');if(!NAMES[who])return send(401,{error:'not paired'});
  if(p.startsWith('/ui/code/team/git/'))return hub.serve(req,res,who,p.slice(18),u.searchParams);
  let b={};if(req.method==='POST'){let t='';for await(const c of req)t+=c;b=JSON.parse(t||'{}')}const q=u.searchParams;
  try{if(p==='/ui/code/team')return send(200,{me:who,folders:await hub.list(who)});if(p==='/ui/code/team/folder')return send(200,await hub.get(q.get('id'),who));
   if(p==='/ui/code/team/history')return send(200,{pushes:await hub.history(q.get('id'),who)});if(p==='/ui/code/team/share')return send(200,await hub.create(who,b));
   if(p==='/ui/code/team/update')return send(200,await hub.update(b.id,who,b));if(p==='/ui/code/team/unshare')return send(200,await hub.unshare(b.id,who))}catch(e){return send(e.status||400,{error:e.message})}send(404,{error:'Not found'})});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));return {srv,base:'http://127.0.0.1:'+srv.address().port}}
// one person's Code: its own project list and the link to aqeelOS with that person's key
async function computer(base,uid){const root=await mkdtemp(path.join(tmpdir(),'tfc-'+uid+'-'));const store=await new Workspace(root).init();const places=path.join(root,'places');let n=0;
 const aqeelos={async team(route,body){const r=await fetch(base+'/ui/code/team'+route,{method:body?'POST':'GET',headers:{authorization:'Bearer key-'+uid,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok){const e=Error(j.error);e.status=r.status;throw e}return j},
  teamGit:async()=>({base,token:'key-'+uid}),state:async()=>({user:NAMES[uid]}),people:async()=>Object.keys(NAMES).map(id=>({id,name:NAMES[id]}))};
 const handle=createTeam({store,aqeelos,gitPath:async()=>'git',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null'},busy:()=>false,placeFor:async name=>path.join(places,name+' '+(++n))});
 const call=async(route,data)=>{let out;const ok=await handle(new URL('http://x/api/workspace/team'+route),{method:data?'POST':'GET'},data,(code,o)=>{out={code,...o}});assert.ok(ok);return out};
 return {store,call,uid}}

test('two people: share, pull, both edit, push, conflict, resolve, history, rights, going back',async()=>{const {srv,base}=await standIn();
 try{const A=await computer(base,'aqeel'),B=await computer(base,'rina'),C=await computer(base,'budi'),D=await computer(base,'dewi');
  // Aqeel has a project with a site, some junk and a chat
  const pa=A.store.state.projects[0],dirA=await A.store.folder(pa.id);await writeFile(path.join(dirA,'index.html'),'<h1>Hello</h1>\n');await writeFile(path.join(dirA,'styles.css'),'body{}\n');
  await mkdir(path.join(dirA,'node_modules','x'),{recursive:true});await writeFile(path.join(dirA,'node_modules','x','i.js'),'junk');await writeFile(path.join(dirA,'.env'),'SECRET=1');
  pa.chats[0].title='Hero section';pa.chats[0].messages.push({role:'user',text:'Make the hero bigger, key sk-ant-api03-zzzzzzzzzzzzzzzz',time:1},{role:'assistant',text:'Done',time:2,account:'work'});
  const sh=await A.call('/share',{projectId:pa.id,name:'Client site',members:[{uid:'rina',role:'push'},{uid:'budi',role:'pull'}],chats:true});assert.equal(sh.code,200,sh.error);assert.ok(!sh.warning,sh.warning);const id=sh.team.id;
  // Rina sees it and gets it on her computer, with Aqeel's chat labelled
  const list=await B.call('/folders');assert.equal(list.folders.length,1);assert.equal(list.folders[0].name,'Client site');
  const j=await B.call('/join',{id});assert.equal(j.code,200,j.error);const pb=B.store.project(j.projectId),dirB=await B.store.folder(pb.id);
  assert.equal(await readFile(path.join(dirB,'index.html'),'utf8'),'<h1>Hello</h1>\n');await assert.rejects(readFile(path.join(dirB,'.env')));await assert.rejects(readFile(path.join(dirB,'node_modules','x','i.js')));
  const imp=pb.chats.find(c=>c.shared);assert.equal(imp.shared.fromName,'Aqeel');assert.equal(imp.title,'Hero section');assert.match(imp.messages[0].text,/\[hidden\]/);assert.equal(imp.messages[1].account,undefined);
  // both edit the same line; Rina pushes first
  await writeFile(path.join(dirA,'index.html'),'<h1>Hello from Aqeel</h1>\n');await writeFile(path.join(dirB,'index.html'),'<h1>Hello from Rina</h1>\n');await writeFile(path.join(dirB,'about.html'),'<p>About</p>\n');
  let s=await A.call('/status?projectId='+pa.id);assert.equal(s.files,1);assert.equal(s.n,0);
  const pr=await B.call('/push',{projectId:pb.id});assert.equal(pr.code,200,pr.error);assert.ok(pr.pushed>=2);
  s=await A.call('/status?projectId='+pa.id);assert.equal(s.n,1);assert.deepEqual(s.from,['Rina']);
  // Aqeel pushes: Code pulls first and stops at the conflict
  const pa2=await A.call('/push',{projectId:pa.id});assert.equal(pa2.code,200,pa2.error);assert.deepEqual(pa2.conflicts.map(c=>c.path),['index.html']);
  const v=await A.call('/conflict?projectId='+pa.id+'&path=index.html');assert.equal(v.mine.text,'<h1>Hello from Aqeel</h1>\n');assert.equal(v.theirs.text,'<h1>Hello from Rina</h1>\n');
  // only files git lists as conflicted can be read or resolved: nothing else in or outside the project
  await assert.rejects(A.call('/conflict?projectId='+pa.id+'&path=../../etc/passwd'),/no conflict/);await assert.rejects(A.call('/resolve',{projectId:pa.id,path:'../x',choice:'mine'}),/no conflict/);
  // combining by hand (or by the coding AI) needs the markers gone
  await assert.rejects(A.call('/resolve',{projectId:pa.id,path:'index.html',choice:'combined'}),/conflict markers/);
  await writeFile(path.join(dirA,'index.html'),'<h1>Hello from Aqeel and Rina</h1>\n');const rs=await A.call('/resolve',{projectId:pa.id,path:'index.html',choice:'combined'});assert.deepEqual(rs.left,[]);
  const pa3=await A.call('/push',{projectId:pa.id});assert.equal(pa3.code,200,pa3.error);assert.ok(pa3.pushed>=1);
  const pb2=await B.call('/pull',{projectId:pb.id});assert.equal(pb2.pulled,1);assert.equal(await readFile(path.join(dirB,'index.html'),'utf8'),'<h1>Hello from Aqeel and Rina</h1>\n');assert.equal(await readFile(path.join(dirA,'about.html'),'utf8'),'<p>About</p>\n');
  // history: who and what, newest first
  const h=await A.call('/history?projectId='+pa.id);assert.deepEqual(h.pushes.map(x=>x.name),['Aqeel','Rina','Aqeel']);assert.match(h.pushes[1].summary,/about\.html/);
  // Budi may pull but not push; Dewi is not in it at all
  const jc=await C.call('/join',{id});assert.equal(jc.code,200,jc.error);const pc=C.store.project(jc.projectId);await writeFile(path.join(await C.store.folder(pc.id),'x.html'),'x');
  await assert.rejects(C.call('/push',{projectId:pc.id}),/not push/);
  pc.team.role='push';await assert.rejects(C.call('/push',{projectId:pc.id}),/not push/,'the hub refuses even when the app thinks otherwise');
  await assert.rejects(D.call('/join',{id}),/not found, or you are not in it/);
  // going back makes a new push with the first version
  const first=h.pushes.at(-1).after;const back=await B.call('/restore',{projectId:pb.id,commit:first});assert.equal(back.code,200,back.error);
  assert.equal(await readFile(path.join(dirB,'index.html'),'utf8'),'<h1>Hello</h1>\n');await assert.rejects(readFile(path.join(dirB,'about.html')));
  const h2=await B.call('/history?projectId='+pb.id);assert.equal(h2.pushes.length,4);assert.match(h2.pushes[0].summary,/^Went back to the version of/);
  await assert.rejects(B.call('/restore',{projectId:pb.id,commit:'0'.repeat(40)}),/from the history/);
  // only the owner changes members or unshares
  await assert.rejects(B.call('/update',{projectId:pb.id,members:[]}),/Only Aqeel/);
 }finally{srv.close()}});
