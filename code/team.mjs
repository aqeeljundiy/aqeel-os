// Team folders in Code (Plan 4, 25 Oct 2026): a project folder shared with team members through aqeelOS. Each person
// works in their own folder on their own computer; Push sends their version up, Pull brings the others' latest down.
// Underneath it is git (the git Code already needs), talking only to aqeelOS's hub for this folder (a remote named
// "team"), with this computer's aqeelOS key sent as a header for the team address only: no git accounts, no GitHub, and
// the key is never written to the repo's settings. A project that already has its own repo keeps its remotes and
// branches; only the team remote is added. Junk stays out (node_modules, build output, caches, .env and key files, and
// the project's own .gitignore), with size limits. "Files and chats" adds the chats in a hidden folder (.code-team/chats/
// <person>/), one folder per person so chats never conflict; secrets in them are hidden first.
import {readFile,writeFile,mkdir,readdir,stat,unlink,access} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {tool} from './github.mjs';

export const MAX_FILE=50*1024*1024,MAX_PUSH=200*1024*1024;
// kept out of every team folder (git's own ignore rules, written to the repo's info/exclude; the project's .gitignore
// comes on top and can bring one back with a ! line)
export const JUNK=['node_modules/','bower_components/','dist/','build/','out/','.next/','.nuxt/','.svelte-kit/','.astro/','.output/','.vercel/','.netlify/','.turbo/','.parcel-cache/','.cache/','coverage/','__pycache__/','*.pyc','.venv/','venv/',
 '.DS_Store','Thumbs.db','desktop.ini','*.log','.env','.env.*','!.env.example','*.pem','*.key','*.p12','*.pfx','id_rsa*','id_ed25519*','.npmrc','.claude/settings.local.json'];
const START='# aqeelOS team folder: kept out of the shared copy by Code',END='# end aqeelOS team folder';
export function excludeBlock(chats){return [START,...JUNK,...(chats?[]:['.code-team/']),END].join('\n')}
// the same rules as a check on one path (git applies them for real; this is for the tests and the size message)
export function junk(rel,chats=true){rel=String(rel);const segs=rel.split('/');let out=false;
 for(const p of [...JUNK,...(chats?[]:['.code-team/'])]){const neg=p[0]==='!',pat=neg?p.slice(1):p,dir=pat.endsWith('/'),name=dir?pat.slice(0,-1):pat;
  const re=new RegExp('^'+name.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'[^/]*')+'$');
  const hit=name.includes('/')?rel===name||rel.startsWith(name+'/'):segs.some((s,i)=>re.test(s)&&(!dir||i<segs.length-1));if(hit)out=!neg}return out}
const mb=n=>Math.round(n/1048576)+' MB';
// files about to go up: none over 50 MB, all together at most 200 MB, with a clear message naming them
export function checkSizes(list){const big=list.filter(f=>f.size>MAX_FILE);
 if(big.length)throw Error((big.length===1?big[0].path+' is '+mb(big[0].size):big.length+' files are over 50 MB ('+big.slice(0,3).map(f=>f.path).join(', ')+(big.length>3?'…':'')+')')+'. Files over 50 MB stay out of team folders: move '+(big.length===1?'it':'them')+' out of the project or add '+(big.length===1?'it':'them')+' to .gitignore.');
 const total=list.reduce((a,f)=>a+f.size,0);if(total>MAX_PUSH)throw Error('These changes add up to '+mb(total)+'. One push can be 200 MB at most: push in smaller parts, or leave big files out (add them to .gitignore).')}
// a short line from name-status pairs: "Changed index.html and styles.css", "Added about.html, changed 4 files"
export function summarize(files){const by={A:[],M:[],D:[]};let chats=false;for(const [s,p] of files){if(String(p).startsWith('.code-team/')){chats=true;continue}(by[s[0]]||by.M).push(String(p).split('/').pop())}
 const list=a=>a.length===1?a[0]:a.length===2?a[0]+' and '+a[1]:a.length+' files';
 const parts=[['Added',by.A],['changed',by.M],['removed',by.D]].filter(([,a])=>a.length).map(([w,a])=>w+' '+list(a));
 if(chats)parts.push(parts.length?'chats':'Updated chats');const t=parts.join(', ');return t?t[0].toUpperCase()+t.slice(1):'No file changes'}
// git ls-files -u -z: which side of each conflicted file still exists (stage 2 is mine, 3 is theirs)
export function parseUnmerged(text){const by=new Map();for(const e of String(text).split('\0')){const m=/^\d+ [0-9a-f]+ ([123])\t(.+)$/.exec(e);if(!m)continue;const c=by.get(m[2])||{path:m[2],mine:false,theirs:false};if(m[1]==='2')c.mine=true;if(m[1]==='3')c.theirs=true;by.set(m[2],c)}return [...by.values()]}
const pairs=t=>{const a=String(t).split('\0').filter(Boolean),o=[];for(let i=0;i+1<a.length;i+=2)o.push([a[i],a[i+1]]);return o};
// chats that leave this computer: only what a teammate needs to read and continue them, with keys and tokens hidden
export const redact=t=>String(t||'').replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,'[hidden key]').replace(/\b(aqc_[\w-]{10,}|sk-ant-[\w-]{10,}|sk-[\w-]{16,}|gh[pousr]_\w{20,}|github_pat_\w{20,}|xox[abpr]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,})/g,'[hidden]').replace(/(Bearer\s+)[\w.~+/-]{16,}=*/gi,'$1[hidden]');
const KEEP=['role','text','time','agent','provider','model','mode','steered','by'];
// (each request keeps who wrote it, so a teammate's copy shows their name instead of "You")
export function cleanChat(c,me=''){return {id:c.id,title:String(c.title||'Chat').slice(0,120),updated:Math.max(0,...(c.messages||[]).map(m=>+m.time||0)),
 messages:(c.messages||[]).slice(-500).map(m=>{const o={};for(const k of KEEP)if(m[k]!==undefined)o[k]=k==='text'?redact(m[k]).slice(0,100000):m[k];if(m.role==='user'&&!o.by&&me)o.by=me;for(const k of ['files','outputs'])if(Array.isArray(m[k]))o[k]=m[k].slice(0,100).map(String);return o})}}
/* Chats coming in from teammates ({uid,name,chat}), merged into this project's chats. An imported chat is "t-<who>-<id>"
   here, labelled with who wrote it; a newer version replaces it while nobody here wrote in it. Once someone here
   continues it, it becomes theirs (a new id, so the next import of the original has its own place again). */
export function mergeChats(chats,incoming,me,newId=randomUUID,people={}){const renamed={};let added=0,updated=0;
 for(const {uid,name,chat:x} of incoming){if(!/^[\w-]{1,80}$/.test(String(uid||''))||uid===me||!x||!/^[\w-]{1,100}$/.test(String(x.id||''))||!Array.isArray(x.messages))continue;const id='t-'+uid+'-'+x.id;const cur=chats.find(c=>c.id===id);
  const msgs=x.messages.map(m=>{if(m?.role!=='user')return m;const by=/^[\w-]{1,80}$/.test(String(m.by||''))?m.by:uid;return {...m,by,...(by!==me?{byName:people[by]||(by===uid?name:'')||'Someone'}:{})}});
  const fresh=()=>({id,title:String(x.title||'Chat').slice(0,120),messages:msgs,shared:{from:uid,fromName:name||'Someone',count:x.messages.length}});
  if(!cur){chats.unshift(fresh());added++;continue}
  if(cur.messages.length<=(cur.shared?.count??0)){if(JSON.stringify(cur.messages)!==JSON.stringify(msgs)||cur.title!==x.title){Object.assign(cur,fresh());updated++}continue}
  const old=cur.id;cur.id=newId();cur.forkedFrom=old;delete cur.shared;renamed[old]=cur.id;chats.unshift(fresh());added++}
 return {added,updated,renamed}}

export function createTeam({store,aqeelos,gitPath,env,busy,placeFor}){
 const exists=f=>access(f).then(()=>true,()=>false);
 const G=async(cwd,args,extra={},timeout=300000)=>{const git=await gitPath();if(!git)throw Error('git is not installed. Install it from git-scm.com, then try again.');return tool(git,args,{cwd,env:{...env,...extra},timeout})};
 // the team address gets this computer's key as a header (only for that address); no saved passwords, no pop-ups
 const auth=async()=>{const l=await aqeelos.teamGit();return {GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never',GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'credential.helper',GIT_CONFIG_VALUE_0:'',GIT_CONFIG_KEY_1:'http.'+l.base+'/ui/code/team/.extraHeader',GIT_CONFIG_VALUE_1:'Authorization: Bearer '+l.token}};
 const friendly=t=>{t=String(t||'');if(/\b401\b|could not read Username|Authentication failed/i.test(t))return 'This computer is not paired with aqeelOS any more. Open Code in aqeelOS to pair it again.';
  if(/\b403\b|not push/i.test(t))return 'You can pull from this team folder but not push. Ask the person who shared it to let you push.';
  if(/\b404\b|not in it/i.test(t))return 'This team folder is gone from aqeelOS, or you were removed from it.';
  if(/\b413\b|too large|maxInputSize|over \d+ MB/i.test(t))return 'This push is too big for a team folder (200 MB at most). Leave big files out: add them to .gitignore.';
  if(/non-fast-forward|fetch first|\[rejected\]/.test(t))return 'Someone pushed just now. Pull their changes, then push again.';
  if(/one line of work/.test(t))return 'A team folder has one line of work (main). Push from Code.';
  if(/Could not resolve|Failed to connect|timed out|Connection refused/i.test(t))return 'Cannot reach aqeelOS right now. Check the internet connection and try again.';
  if(/untracked working tree files would be overwritten/.test(t))return 'Some files here have the same names as new files from the team ('+(t.match(/\n\t(.+)/g)||[]).slice(0,3).map(s=>s.trim()).join(', ')+'). Move or rename yours, then pull again.';
  return t.trim().split('\n').filter(Boolean).pop()?.slice(0,300)||'git did not finish.'};
 const ok=r=>{if(r.code!==0)throw Error(friendly(r.stderr||r.stdout));return r.stdout};
 const rev=async(cwd,ref)=>{const r=await G(cwd,['rev-parse','--verify','-q',ref+'^{commit}']);return r.code===0?r.stdout.trim():''};
 const merging=async cwd=>Boolean(await rev(cwd,'MERGE_HEAD'));
 const conflicts=async cwd=>parseUnmerged((await G(cwd,['ls-files','-u','-z'])).stdout);
 // one team action at a time per project (a status check fetches too)
 const locks=new Map();const one=(id,fn)=>{const p=(locks.get(id)||Promise.resolve()).catch(()=>{}).then(fn);locks.set(id,p);return p};
 const save=()=>store.serialize(()=>store.persist());
 // the repo's own exclude file gets one block of ours, replaced each time; the rest of the file stays as it was
 const excludeFile=async cwd=>path.resolve(cwd,(await G(cwd,['rev-parse','--git-path','info/exclude'])).stdout.trim()||'.git/info/exclude');
 const without=t=>t.includes(START)?(t.split(START)[0].trimEnd()+'\n'+(t.split(END)[1]||'').replace(/^\n/,'')).replace(/^\n$/,''):t;
 async function writeExclude(cwd,chats){const f=await excludeFile(cwd);const t=without(await readFile(f,'utf8').catch(()=>'')).trimEnd();await mkdir(path.dirname(f),{recursive:true});await writeFile(f,(t?t+'\n\n':'')+excludeBlock(chats)+'\n')}
 // git needs a name on each commit: the person's own git name when they have one, otherwise their aqeelOS name
 async function ident(cwd,p){const n=(await G(cwd,['config','user.name'])).stdout.trim(),e=(await G(cwd,['config','user.email'])).stdout.trim();if(n&&e)return {};const name=n||(await aqeelos.state()).user||'Someone',mail=e||(p.team?.me||'someone')+'@team.aqeelos';
  return {GIT_AUTHOR_NAME:name,GIT_COMMITTER_NAME:name,GIT_AUTHOR_EMAIL:mail,GIT_COMMITTER_EMAIL:mail}}
 const teamUrl=async id=>(await aqeelos.teamGit()).base+'/ui/code/team/git/'+id+'.git';
 // the project's folder as a repo with the team remote: an existing repo keeps everything else it has
 async function setup(p,f,me){const cwd=await store.folder(p.id);if(!await exists(path.join(cwd,'.git'))){ok(await G(cwd,['init','-q']));ok(await G(cwd,['symbolic-ref','HEAD','refs/heads/main']))}
  const url=await teamUrl(f.id),cur=await G(cwd,['remote','get-url','team']);
  if(cur.code===0&&!cur.stdout.includes('/ui/code/team/git/'))throw Error('This project already has a git remote called "team". Rename it (git remote rename team other), then share again.');
  ok(await G(cwd,cur.code===0?['remote','set-url','team',url]:['remote','add','team',url]));await writeExclude(cwd,f.chats);link(p,f,me)}
 function link(p,f,me){p.team={id:f.id,name:f.name,chats:!!f.chats,role:f.role,owner:f.owner,ownerName:f.ownerName,me:me||p.team?.me||'',people:{[f.owner]:f.ownerName,...Object.fromEntries((f.members||[]).map(m=>[m.uid,m.name]))},members:f.members||[]}}
 // my chats into .code-team/chats/<me>/ (a chat I continued from someone else becomes mine first)
 async function exportChats(p,cwd){const me=p.team.me;if(!/^[\w-]{1,80}$/.test(me))return {};const dir=path.join(cwd,'.code-team','chats',me),renamed={};await mkdir(dir,{recursive:true});const keep=new Set();
  for(const c of p.chats){if(c.temporary||!c.messages?.length)continue;if(c.shared&&c.shared.from!==me){if(c.messages.length<=c.shared.count)continue;const old=c.id;c.id=randomUUID();c.forkedFrom=old;delete c.shared;renamed[old]=c.id}
   if(!/^[\w-]{1,100}$/.test(c.id))continue;const f=path.join(dir,c.id+'.json'),text=JSON.stringify(cleanChat(c,me),null,1)+'\n';keep.add(c.id+'.json');if(await readFile(f,'utf8').catch(()=>'')!==text)await writeFile(f,text)}
  for(const n of await readdir(dir).catch(()=>[]))if(n.endsWith('.json')&&!keep.has(n))await unlink(path.join(dir,n)).catch(()=>{});
  if(Object.keys(renamed).length)await save();return renamed}
 async function importChats(p,cwd){if(!p.team.chats)return {};const base=path.join(cwd,'.code-team','chats'),incoming=[];
  for(const uid of await readdir(base).catch(()=>[])){if(!/^[\w-]{1,80}$/.test(uid)||uid===p.team.me)continue;for(const n of await readdir(path.join(base,uid)).catch(()=>[])){if(!n.endsWith('.json'))continue;try{incoming.push({uid,name:p.team.people?.[uid]||'Someone',chat:JSON.parse(await readFile(path.join(base,uid,n),'utf8'))})}catch{}}}
  const r=mergeChats(p.chats,incoming,p.team.me,randomUUID,p.team.people||{});if(r.added||r.updated)await save();return r.renamed}
 // everything changed here goes into one local commit (not sent yet), after the size check
 async function commitLocal(p,cwd){let renamed={};if(p.team.chats)renamed=await exportChats(p,cwd);else await G(cwd,['rm','-r','-q','--cached','--ignore-unmatch','.code-team']);
  const cand=(await G(cwd,['ls-files','-z','-o','-m','--exclude-standard'])).stdout.split('\0').filter(Boolean);const sizes=[];for(const f of [...new Set(cand)]){const s=await stat(path.join(cwd,f)).catch(()=>null);if(s?.isFile())sizes.push({path:f,size:s.size})}checkSizes(sizes);
  ok(await G(cwd,['add','-A']));const staged=pairs((await G(cwd,['diff','--cached','--no-renames','--name-status','-z'])).stdout);if(!staged.length)return renamed;
  ok(await G(cwd,['commit','-q','--no-verify','-m',summarize(staged)],await ident(cwd,p)));return renamed}
 async function fetchTeam(cwd){const r=await G(cwd,['fetch','-q','team','+refs/heads/main:refs/remotes/team/main'],await auth(),120000);if(r.code===0)return true;if(/couldn't find remote ref/i.test(r.stderr))return false;throw Error(friendly(r.stderr))}
 // the pushes from the hub this copy does not have yet, and who made them
 async function behind(p,cwd){const head=await rev(cwd,'HEAD');let list=[];try{list=(await aqeelos.team('/history?id='+p.team.id)).pushes||[]}catch{}const out=[];
  for(const x of list.slice(0,30)){if(head&&(await G(cwd,['merge-base','--is-ancestor',x.after,'HEAD'])).code===0)break;out.push(x)}return {n:out.length,from:[...new Set(out.map(x=>x.name))]}}
 async function changesHere(cwd){const theirs=await rev(cwd,'refs/remotes/team/main'),head=await rev(cwd,'HEAD');const base=theirs&&head?(await G(cwd,['merge-base','HEAD',theirs])).stdout.trim():'';
  const tracked=base?(await G(cwd,['diff','--name-only','-z',base])).stdout:(await G(cwd,['ls-files','-z'])).stdout,other=(await G(cwd,['ls-files','-z','-o','--exclude-standard'])).stdout;
  const all=[...new Set((tracked+'\0'+other).split('\0').filter(Boolean))];return {files:all.filter(f=>!f.startsWith('.code-team/')).length,chats:all.some(f=>f.startsWith('.code-team/'))}}
 async function refresh(p){try{const f=await aqeelos.team('/folder?id='+p.team.id);link(p,f);delete p.team.gone;return true}catch(e){if(e.status===404||e.status===403){p.team.gone=true;return false}throw e}}
 async function status(p){const cwd=await store.folder(p.id);await refresh(p);await save();if(p.team.gone)return {team:p.team,gone:true};await writeExclude(cwd,p.team.chats);
  await fetchTeam(cwd);const mid=await merging(cwd);return {team:p.team,...(await behind(p,cwd)),...(await changesHere(cwd)),merging:mid,conflicts:mid?await conflicts(cwd):[]}}
 async function pull(p){const cwd=await store.folder(p.id);if(await merging(cwd))return {conflicts:await conflicts(cwd)};const renamed=await commitLocal(p,cwd);
  if(!await fetchTeam(cwd))return {pulled:0,from:[],renamed};const theirs=await rev(cwd,'refs/remotes/team/main'),head=await rev(cwd,'HEAD');
  if(head&&(await G(cwd,['merge-base','--is-ancestor',theirs,'HEAD'])).code===0)return {pulled:0,from:[],renamed};
  const b=await behind(p,cwd),before=await store.snapshot(p.id),who=b.from.join(', ')||'the team';
  const shared=head?(await G(cwd,['merge-base','HEAD',theirs])).code===0:true;
  const r=await G(cwd,['merge','-q','--no-edit','--no-verify','-m','Pulled changes from '+who,...(shared?[]:['--allow-unrelated-histories']),theirs],await ident(cwd,p));
  if(r.code!==0){const c=await conflicts(cwd);if(c.length){await store.serialize(()=>store.record(p.id,before,'Pulled from '+who+' (with conflicts)'));return {conflicts:c,from:b.from,renamed}}throw Error(friendly(r.stderr||r.stdout))}
  Object.assign(renamed,await importChats(p,cwd));await store.serialize(()=>store.record(p.id,before,'Pulled from '+who));return {pulled:b.n||1,from:b.from,renamed}}
 // Push: pull first when the team has something new (stop at conflicts), then send this copy's work up
 async function push(p){const cwd=await store.folder(p.id);if(await merging(cwd))throw Error('Finish the conflicts first, then push.');if(p.team.role==='pull')throw Error('You can pull from this team folder but not push. Ask '+(p.team.ownerName||'the person who shared it')+' to let you push.');
  const r=await pull(p);if(r.conflicts?.length)return r;const head=await rev(cwd,'HEAD');if(!head)throw Error('Nothing to push yet. Add some files first.');const theirs=await rev(cwd,'refs/remotes/team/main');if(theirs===head)return {...r,pushed:0};
  const names=pairs((await G(cwd,['diff','--no-renames','--name-status','-z',...(theirs?[theirs]:['4b825dc642cb6eb9a060e54bf8d69288fbee4904']),'HEAD'])).stdout);
  const sizes=[];for(const [,f] of names){const s=await stat(path.join(cwd,f)).catch(()=>null);if(s?.isFile())sizes.push({path:f,size:s.size})}checkSizes(sizes);
  ok(await G(cwd,['push','-q','team','HEAD:refs/heads/main'],await auth(),600000));await G(cwd,['fetch','-q','team','+refs/heads/main:refs/remotes/team/main'],await auth(),60000);
  return {...r,pushed:names.filter(([,f])=>!f.startsWith('.code-team/')).length,summary:summarize(names)}}
 async function conflictView(p,file){const cwd=await store.folder(p.id);const c=(await conflicts(cwd)).find(x=>x.path===file);if(!c)throw Error('That file has no conflict any more.');
  const side=async n=>{const s=await G(cwd,['cat-file','-s',':'+n+':'+file]);if(s.code)return {gone:true};const size=+s.stdout.trim();if(size>150000)return {big:true,size};const t=(await G(cwd,['cat-file','-p',':'+n+':'+file])).stdout;return {text:t,binary:t.includes('\0')||/\.(png|jpe?g|gif|webp|avif|ico|pdf|mp4|webm|zip|woff2?|ttf|otf)$/i.test(file)}};
  const theirsBy=(await behind(p,cwd)).from;return {path:file,mine:await side(2),theirs:await side(3),from:theirsBy}}
 async function resolve(p,file,choice){const cwd=await store.folder(p.id);const c=(await conflicts(cwd)).find(x=>x.path===file);if(!c)throw Error('That file has no conflict any more.');
  const full=path.resolve(cwd,file);if(!full.startsWith(path.resolve(cwd)+path.sep))throw Error('That file is outside the project.');
  if(choice==='mine'||choice==='theirs'){if(choice==='mine'?c.mine:c.theirs){ok(await G(cwd,['checkout','--'+(choice==='mine'?'ours':'theirs'),'--',file]));ok(await G(cwd,['add','--',file]))}else ok(await G(cwd,['rm','-q','--',file]))}
  else if(choice==='combined'){const t=await readFile(full,'utf8').catch(()=>null);if(t===null)throw Error('The combined file is not there yet.');if(/^(<{7}|>{7})( |$)/m.test(t))throw Error('The file still has conflict markers (<<<<<<<). Finish combining it first.');ok(await G(cwd,['add','--',file]))}
  else throw Error('Choose mine, theirs or combined.');
  const left=await conflicts(cwd);if(!left.length){ok(await G(cwd,['commit','-q','--no-edit','--no-verify'],await ident(cwd,p)));await importChats(p,cwd)}return {left}}
 // going back makes a new push with that version's files; nothing in the history is removed or rewritten
 async function restore(p,commit){if(!/^[0-9a-f]{40}$/.test(String(commit)))throw Error('Choose a version from the history.');const cwd=await store.folder(p.id);
  const list=(await aqeelos.team('/history?id='+p.team.id)).pushes||[];const x=list.find(y=>y.after===commit);if(!x)throw Error('Choose a version from the history.');
  if(await merging(cwd))throw Error('Finish the conflicts first.');await fetchTeam(cwd);const theirs=await rev(cwd,'refs/remotes/team/main');
  const ahead=theirs?+(await G(cwd,['rev-list','--count',theirs+'..HEAD'])).stdout.trim():0;
  if(ahead||(await G(cwd,['status','--porcelain'])).stdout.trim())throw Error('You have changes that are not pushed yet. Push them first, so they stay in the history, then go back.');
  const r=await pull(p);if(r.conflicts?.length)return r;const before=await store.snapshot(p.id);
  ok(await G(cwd,['restore','--source='+commit,'--staged','--worktree','--','.',':(exclude).code-team']));
  if(!(await G(cwd,['diff','--cached','--name-only'])).stdout.trim())throw Error('This is already the version the team has.');
  const when=new Date(x.at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  ok(await G(cwd,['commit','-q','--no-verify','-m','Went back to the version of '+when+' by '+(x.name||'someone')],await ident(cwd,p)));await store.serialize(()=>store.record(p.id,before,'Went back to the version of '+when));return push(p)}
 async function unlinkLocal(p){const cwd=await store.folder(p.id);const cur=await G(cwd,['remote','get-url','team']);if(cur.code===0&&cur.stdout.includes('/ui/code/team/git/'))await G(cwd,['remote','remove','team']);
  const f=await excludeFile(cwd);const t=await readFile(f,'utf8').catch(()=>null);if(t!==null&&t.includes(START))await writeFile(f,without(t));delete p.team;await save()}

 return async function handle(url,req,data,send){if(!url.pathname.startsWith('/api/workspace/team'))return false;const r=url.pathname.slice(19),q=url.searchParams,GET=req.method==='GET';
  if(process.env.CBA_ONLINE)throw Error('Team folders work in Code on your own computer.');
  const proj=()=>{const p=store.project(data?.projectId||q.get('projectId'));if(!p.team)throw Error('This project is not shared with your team.');return p};
  const free=p=>{if(busy(p.id))throw Error('Wait for the AI to finish in this project first.');return p};
  if(r==='/folders'&&GET){const j=await aqeelos.team('');return send(200,{me:j.me,folders:j.folders.map(f=>({...f,here:store.state.projects.find(p=>p.team?.id===f.id)?.id||null}))}),true}
  // the project's other remotes (GitHub and so on): team pushes go to its main branch, so "files and chats" would carry
  // the .code-team chats there too on its next push; the share dialog says so (25 Oct 2026)
  if(r==='/remotes'&&GET){const p=store.project(q.get('projectId'));const g=await G(await store.folder(p.id),['remote']);return send(200,{remotes:g.code===0?g.stdout.split('\n').map(s=>s.trim()).filter(s=>s&&s!=='team'):[]}),true}
  if(r==='/people'&&GET){const j=await aqeelos.team('');return send(200,{me:j.me,people:(await aqeelos.people()).filter(x=>x.id!==j.me)}),true}
  if(r==='/share'&&!GET){const p=store.project(data.projectId);if(p.team)throw Error('This project is already shared with your team.');free(p);const me=(await aqeelos.team('')).me;
   const f=await aqeelos.team('/share',{name:String(data.name||p.name),members:data.members,chats:Boolean(data.chats)});
   try{await one(p.id,()=>setup(p,f,me));await save()}catch(e){await aqeelos.team('/unshare',{id:f.id}).catch(()=>{});throw e}
   let out={};try{out=await one(p.id,()=>push(p))}catch(e){return send(200,{team:p.team,warning:'Shared, but the first push did not go: '+e.message}),true}return send(200,{team:p.team,...out}),true}
  if(r==='/join'&&!GET){const id=String(data.id||'');const had=store.state.projects.find(p=>p.team?.id===id);if(had)return send(200,{projectId:had.id}),true;
   const me=(await aqeelos.team('')).me;const f=await aqeelos.team('/folder?id='+encodeURIComponent(id));const place=await placeFor(f.name);await mkdir(place,{recursive:true});
   const p=await store.serialize(()=>store.addFolder(place,{name:f.name}));await one(p.id,()=>setup(p,f,me));await save();const out=await one(p.id,()=>pull(p));return send(200,{projectId:p.id,...out}),true}
  if(r==='/status'&&GET){const p=proj();return send(200,await one(p.id,()=>status(p))),true}
  if(r==='/pull'&&!GET){const p=free(proj());return send(200,await one(p.id,()=>pull(p))),true}
  if(r==='/push'&&!GET){const p=free(proj());return send(200,await one(p.id,()=>push(p))),true}
  if(r==='/conflict'&&GET){const p=proj();return send(200,await one(p.id,()=>conflictView(p,String(q.get('path')||'')))),true}
  if(r==='/resolve'&&!GET){const p=free(proj());return send(200,await one(p.id,()=>resolve(p,String(data.path||''),String(data.choice||'')))),true}
  if(r==='/abort'&&!GET){const p=free(proj());const cwd=await store.folder(p.id);await one(p.id,async()=>ok(await G(cwd,['merge','--abort'])));return send(200,{ok:true}),true}
  if(r==='/history'&&GET){const p=proj();const cwd=await store.folder(p.id);const head=await rev(cwd,'HEAD');const pushes=(await aqeelos.team('/history?id='+p.team.id)).pushes||[];return send(200,{pushes,head}),true}
  if(r==='/restore'&&!GET){const p=free(proj());return send(200,await one(p.id,()=>restore(p,String(data.commit||'')))),true}
  if(r==='/update'&&!GET){const p=proj();const f=await aqeelos.team('/update',{id:p.team.id,members:data.members,chats:data.chats,name:data.name});link(p,f);await save();await writeExclude(await store.folder(p.id),f.chats);return send(200,{team:p.team}),true}
  if(r==='/unshare'&&!GET){const p=proj();await aqeelos.team('/unshare',{id:p.team.id});await one(p.id,()=>unlinkLocal(p));return send(200,{ok:true}),true}
  if(r==='/leave'&&!GET){const p=proj();await one(p.id,()=>unlinkLocal(p));return send(200,{ok:true}),true}
  send(404,{error:'Team route not found.'});return true}}
