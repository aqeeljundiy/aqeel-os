// Team folders (Plan 4, 25 Oct 2026): a Code project folder shared with team members, "our own repo inside aqeelOS".
// aqeelOS keeps one bare git repo per shared folder (DATA/team-folders/<id>.git) and serves it only through itself, to
// a Code app with its device key, using git's own smart HTTP (git http-backend). So pushes and pulls are real git (resumable,
// only what changed is sent, history kept), with no git accounts, passwords or GitHub. Each person's Code does the git
// work on their own computer; nobody types git commands. The members list says who may pull and who may also push, and is
// checked on every request. History is aqeelOS's own record of each push (who, when, what changed), so a name written in
// a commit can never pretend to be someone else. Pushes only move main forward: no deleting, no rewriting history.
import {readStore,writeStore} from './store.mjs';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rename,chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

export const ROLES=['pull','push'];
export const MAX_PUSH=250*1024*1024;   // one push at most (Code says so first, with the file names)
const EMPTY_TREE='4b825dc642cb6eb9a060e54bf8d69288fbee4904';
export const validId=id=>typeof id==='string'&&/^[a-f0-9]{16}$/.test(id);
// the only git paths served: what smart HTTP needs, so no crafted path (.., %2e, objects/...) can reach outside the hub
export function gitPath(rest){const m=/^([a-f0-9]{16})\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(String(rest||''));return m?{id:m[1],what:m[2]}:null}
export function roleOf(f,uid){if(!f||!uid)return null;if(f.owner===uid)return 'owner';const r=f.members?.[uid];return ROLES.includes(r)?r:null}
// pull: every member; push: the owner and members with "Can push"; manage (members, unshare): the owner only
export function may(f,uid,what){const r=roleOf(f,uid);if(!r)return false;return what==='pull'?true:what==='push'?r==='owner'||r==='push':what==='manage'?r==='owner':false}
// the members a sharer sends: known people only, never the owner, a role each, at most 50
export function cleanMembers(list,owner,known=()=>true){const out={};for(const m of Array.isArray(list)?list:[]){const uid=String(m?.uid||'');if(!/^[\w-]{1,80}$/.test(uid)||uid===owner||!known(uid))continue;if(ROLES.includes(m.role))out[uid]=m.role;if(Object.keys(out).length>=50)break}return out}
// a short line from git's name-status: "Changed index.html and styles.css", "Added about.html, changed 4 files"; the
// hidden chats folder counts as "chats"
export function summarize(files){const by={A:[],M:[],D:[]};let chats=false;for(const [s,p] of files){if(String(p).startsWith('.code-team/')){chats=true;continue}(by[s[0]]||by.M).push(String(p).split('/').pop())}
 const list=a=>a.length===1?a[0]:a.length===2?a[0]+' and '+a[1]:a.length+' files';
 const parts=[['Added',by.A],['changed',by.M],['removed',by.D]].filter(([,a])=>a.length).map(([w,a])=>w+' '+list(a));
 if(chats)parts.push(parts.length?'chats':'Updated chats');const t=parts.join(', ');return t?t[0].toUpperCase()+t.slice(1):'No file changes'}

export function createTeamFolders({DATA,git='git',names=uid=>uid,known=()=>true}){
 const HUB=path.join(DATA,'team-folders'),FILE=path.join(DATA,'team-folders.json');let db=null;
 const load=async()=>{if(db)return db;db=await readStore(FILE);db.folders||={};return db};
 // one write at a time with its own temp name (as code.mjs)
 let saving=Promise.resolve();const save=()=>saving=saving.catch(()=>{}).then(async()=>{await mkdir(DATA,{recursive:true});await writeStore(FILE,JSON.stringify(db,null,1),{mode:0o600})});
 // git here never reads the box's own git settings or hooks from elsewhere
 const genv={PATH:process.env.PATH||'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',HOME:HUB,LANG:'C'};
 const run=(args,cwd)=>new Promise(res=>{let out='',err='';const c=spawn(git,args,{cwd,env:genv});c.stdout.on('data',d=>{out=(out+d).slice(-400000)});c.stderr.on('data',d=>{err=(err+d).slice(-4000)});c.on('error',e=>res({code:-1,out,err:e.message}));c.on('close',code=>res({code,out,err}))});
 const dirOf=id=>{if(!validId(id))throw Error('Unknown team folder.');return path.join(HUB,id+'.git')};
 const tip=async dir=>{const r=await run(['rev-parse','--verify','-q','refs/heads/main'],dir);return r.code===0?r.out.trim():''};
 const view=(f,uid)=>({id:f.id,name:f.name,owner:f.owner,ownerName:names(f.owner),role:roleOf(f,uid),chats:!!f.chats,created:f.created,
  members:Object.entries(f.members||{}).map(([u,r])=>({uid:u,name:names(u),role:r})),last:f.last?{...f.last,name:names(f.last.user)}:null});
 // a folder a person may see: a missing one and one they are not in look the same (404), so ids say nothing
 const mine=async(id,uid,what='pull')=>{await load();const f=validId(id)?db.folders[id]:null;if(!f||!roleOf(f,uid)){const e=Error('That team folder was not found, or you are not in it.');e.status=404;throw e}
  if(!may(f,uid,what)){const e=Error(what==='push'?'You can pull from this team folder but not push. Ask '+names(f.owner)+' to let you push.':'Only '+names(f.owner)+', who shared it, can change this.');e.status=403;throw e}return f};

 async function create(uid,{name,members,chats}){name=String(name||'').trim().slice(0,80);if(!name)throw Error('Name the team folder.');await load();
  const id=randomBytes(8).toString('hex'),dir=dirOf(id);await mkdir(HUB,{recursive:true});
  for(const args of [['init','--bare','-q',dir],['-C',dir,'symbolic-ref','HEAD','refs/heads/main'],['-C',dir,'config','receive.denyNonFastForwards','true'],['-C',dir,'config','receive.denyDeletes','true'],
   ['-C',dir,'config','receive.maxInputSize',String(MAX_PUSH)],['-C',dir,'config','http.receivepack','true'],['-C',dir,'config','core.hooksPath',path.join(dir,'hooks')]]){const r=await run(args,HUB);if(r.code)throw Error('Could not make the team folder: '+(r.err.trim().slice(-200)||'git failed'))}
  // one line of work: only main, so nobody's push lands somewhere nobody sees
  await writeFile(path.join(dir,'hooks','pre-receive'),'#!/bin/sh\nwhile read old new ref; do\n [ "$ref" = refs/heads/main ] || { echo "A team folder has one line of work (main). Push from Code."; exit 1; }\ndone\n');await chmod(path.join(dir,'hooks','pre-receive'),0o755);
  const f={id,name,owner:uid,chats:!!chats,members:cleanMembers(members,uid,known),created:Date.now(),pushes:[]};db.folders[id]=f;await save();return view(f,uid)}
 async function list(uid,{all=false}={}){await load();return Object.values(db.folders).filter(f=>all||roleOf(f,uid)).sort((a,b)=>(b.last?.at||b.created)-(a.last?.at||a.created)).map(f=>view(f,uid))}
 async function get(id,uid){return view(await mine(id,uid),uid)}
 // the owner changes who is in it and what it shares (files only, or files and chats)
 async function update(id,uid,{name,members,chats}){const f=await mine(id,uid,'manage');if(members!==undefined)f.members=cleanMembers(members,uid,known);if(chats!==undefined)f.chats=!!chats;
  if(name!==undefined){const n=String(name).trim().slice(0,80);if(n)f.name=n}await save();return view(f,uid)}
 // unsharing keeps the repo aside (team-folders/removed/), never deleted; everyone's own copies stay on their computers
 async function unshare(id,uid){const f=await mine(id,uid,'manage');const dir=dirOf(f.id),aside=path.join(HUB,'removed');await mkdir(aside,{recursive:true});await rename(dir,path.join(aside,f.id+'-'+Date.now()+'.git')).catch(()=>{});
  delete db.folders[f.id];await save();return {ok:true}}
 async function history(id,uid,n=100){const f=await mine(id,uid);return (f.pushes||[]).slice(0,n).map(x=>({...x,name:names(x.user)}))}
 // after a push: what moved, written down with the person aqeelOS knows sent it
 async function logPush(f,uid,before,after){const dir=dirOf(f.id);const d=await run(['diff','--no-renames','--name-status','-z',before||EMPTY_TREE,after],dir);const parts=d.out.split('\0').filter(Boolean),files=[];for(let i=0;i+1<parts.length;i+=2)files.push([parts[i],parts[i+1]]);
  const n=before?+(await run(['rev-list','--count',before+'..'+after],dir)).out.trim()||1:1;const msg=(await run(['log','-1','--format=%s',after],dir)).out.trim().slice(0,160);
  const e={at:Date.now(),user:uid,before,after,commits:n,total:files.length,files:files.slice(0,300),summary:/^Went back to /.test(msg)?msg:summarize(files)};f.pushes=[e,...(f.pushes||[])].slice(0,300);f.last={at:e.at,user:uid};await save();return e}
 const locks=new Map();const locked=(id,fn)=>{const p=(locks.get(id)||Promise.resolve()).catch(()=>{}).then(fn);locks.set(id,p);return p};
 const fail=(res,code,text)=>{res.writeHead(code,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end(text+'\n')};
 /* git smart HTTP for one folder, for the person a device key belongs to: info/refs (with the service), git-upload-pack
    (pull) and git-receive-pack (push). git http-backend does the git part; this checks who, streams both ways and limits
    the size. A push runs one at a time per folder, so the before/after record is exact. */
 async function serve(req,res,uid,rest,query){const g=gitPath(rest);if(!g)return fail(res,404,'Not found');await load();const f=db.folders[g.id];
  const svc=g.what==='info/refs'?String(query.get('service')||''):g.what;if(!/^git-(upload|receive)-pack$/.test(svc))return fail(res,404,'Not found');
  const push=svc==='git-receive-pack';if(!f||!roleOf(f,uid))return fail(res,404,'That team folder was not found, or you are not in it.');if(!may(f,uid,push?'push':'pull'))return fail(res,403,'You can pull from this team folder but not push.');
  if(g.what!=='info/refs'&&req.method!=='POST')return fail(res,405,'POST only');const dir=dirOf(g.id);
  const go=async()=>{const before=push&&g.what!=='info/refs'?await tip(dir):null;
   const proto=String(req.headers['git-protocol']||''),enc=String(req.headers['content-encoding']||'');
   const c=spawn(git,['http-backend'],{env:{...genv,GIT_PROJECT_ROOT:HUB,GIT_HTTP_EXPORT_ALL:'1',PATH_INFO:'/'+g.id+'.git/'+g.what,REQUEST_METHOD:req.method,QUERY_STRING:g.what==='info/refs'?'service='+svc:'',CONTENT_TYPE:String(req.headers['content-type']||''),
    REMOTE_USER:uid,REMOTE_ADDR:'127.0.0.1',GIT_HTTP_MAX_REQUEST_BUFFER:'100M',...(/^[\w=:.-]{1,100}$/.test(proto)?{GIT_PROTOCOL:proto}:{}),...(/^(gzip|x-gzip)$/.test(enc)?{HTTP_CONTENT_ENCODING:enc}:{})}});
   let n=0,started=false,head=Buffer.alloc(0),err='';const limit=push?MAX_PUSH+1e6:20e6;
   req.on('data',d=>{n+=d.length;if(n>limit){req.unpipe(c.stdin);c.kill();if(!started){started=true;fail(res,413,'This push is over '+Math.round(MAX_PUSH/1048576)+' MB. Leave big files out of the team folder.')}}});req.pipe(c.stdin);c.stdin.on('error',()=>{});
   c.stderr.on('data',d=>{err=(err+d).slice(-2000)});
   c.stdout.on('data',d=>{if(started){if(!res.writableEnded&&!res.write(d)){c.stdout.pause();res.once('drain',()=>c.stdout.resume())}return}head=Buffer.concat([head,d]);let i=head.indexOf('\r\n\r\n'),k=4;if(i<0){i=head.indexOf('\n\n');k=2}if(i<0)return;
    const hs={'cache-control':'no-store'};let status=200;for(const l of head.slice(0,i).toString().split(/\r?\n/)){const j=l.indexOf(':');if(j<1)continue;const name=l.slice(0,j).trim(),v=l.slice(j+1).trim();if(/^status$/i.test(name))status=parseInt(v)||200;else hs[name.toLowerCase()]=v}
    started=true;res.writeHead(status,hs);const more=head.slice(i+k);if(more.length)res.write(more)});
   await new Promise(r=>{c.on('close',r);c.on('error',r)});if(!started)fail(res,500,'git did not answer: '+err.trim().slice(-200));else if(!res.writableEnded)res.end();
   if(before!==null){const after=await tip(dir);if(after&&after!==before)await logPush(f,uid,before,after).catch(e=>console.warn('team folders: push record failed',e.message))}};
  return push&&g.what!=='info/refs'?locked(g.id,go):go()}
 return {create,list,get,update,unshare,history,serve,HUB}}
