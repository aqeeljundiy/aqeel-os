// Code: the aqeelOS Code desktop app (Code by Aqeel, running on a person's own computer) seen from aqeelOS.
// Pairing works like the browser extension: the person is signed in to aqeelOS, aqeelOS gives the desktop app its own
// key (no password ever typed into the app), and the app uses that key to reach the person's agents (abilities,
// channels, automations) and to fetch updates. Downloads are built here from the app's source on the box
// (~/apps/aqeel-code, filled from this repo's code/ folder by scripts/deploy.sh), with this install's address inside, plus a small installer for Windows and for Mac.
import {readStore,writeStore} from './store.mjs';
import {readFile,writeFile,mkdir,readdir,stat,rename} from 'node:fs/promises';
import {repoSlug,DEFAULT_REPO} from './fixer-git.mjs';
import {randomBytes,createHash} from 'node:crypto';
import path from 'node:path';

const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return b=>{let c=0xFFFFFFFF;for(const x of b)c=t[(c^x)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}})();
// a zip (stored, no compression) of [name, Buffer, mode] entries; mode marks scripts executable on a Mac
function zip(files){const parts=[],central=[];let off=0;
 for(const [name,data,exec] of files){const nb=Buffer.from(name);const crc=CRC(data);const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt32LE(crc,14);lh.writeUInt32LE(data.length,18);lh.writeUInt32LE(data.length,22);lh.writeUInt16LE(nb.length,26);
  parts.push(lh,nb,data);const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(0x0314,4);ch.writeUInt16LE(20,6);ch.writeUInt32LE(crc,16);ch.writeUInt32LE(data.length,20);ch.writeUInt32LE(data.length,24);ch.writeUInt16LE(nb.length,28);
  ch.writeUInt32LE(((exec?0o100755:0o100644)<<16)>>>0,38);ch.writeUInt32LE(off,42);central.push(ch,nb);off+=30+nb.length+data.length}
 const cd=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(off,16);
 return Buffer.concat([...parts,cd,end])}
// what goes into the download: the app's source, never its data, dependencies, git history or old Windows launcher
const SKIP=/^(\.git|node_modules|data|outputs|projects|\.claude|launcher|.*\.exe|.*\.png|.*\.log)$/i;
async function walk(dir,base=''){const out=[];for(const f of await readdir(dir).catch(()=>[])){if(SKIP.test(f))continue;const p=path.join(dir,f),rel=base?base+'/'+f:f;const s=await stat(p).catch(()=>null);if(!s)continue;
 if(s.isDirectory())out.push(...await walk(p,rel));else if(s.size<5e6)out.push([rel,await readFile(p)])}return out}

// the GitHub repository an installed Code app checks its updates against (code/update-verify.mjs): this install's source
const UPDATE_REPO=repoSlug(process.env.AQ_REPO||DEFAULT_REPO);
export function createCode({DATA,SRC,PUBLIC_URL,ROOT}){
 const FILE=path.join(DATA,'code-devices.json');let db=null;
 const load=async()=>{if(db)return db;db=await readStore(FILE);db.devices||={};return db};
 // one write at a time with its own temp name: two quick saves shared one .tmp and the second rename failed (ENOENT, 25 Oct)
 let saving=Promise.resolve();const save=()=>saving=saving.catch(()=>{}).then(async()=>{await mkdir(DATA,{recursive:true});await writeStore(FILE,JSON.stringify(db,null,1),{mode:0o600})});
 const hash=t=>createHash('sha256').update(String(t)).digest('hex');
 // a new key for one person's computer; only its hash is kept here
 async function pair(user,name,{box=false}={}){await load();const token='aqc_'+randomBytes(24).toString('base64url');db.devices[hash(token)]={user,name:String(name||'Computer').slice(0,60),created:Date.now(),last:0,...(box?{box:true}:{})};await save();return token}
 // the box's own copy is known by this flag (set only by aqeelOS itself when it pairs it), never by the device's name
 async function markBox(token){await load();const d=db.devices[hash(token||'')];if(d&&!d.box){d.box=true;await save()}}
 async function who(token){await load();const h=hash(token||''),d=db.devices[h];if(!d)return null;if(Date.now()-d.last>60000){d.last=Date.now();save().catch(()=>{})}return {...d,key:h.slice(0,16)}}
 /* Every paired Code app (a person's computer, or the box's own copy) asks here for work about every 25 s: the guarded
    browser jobs agents send to a person's own computer (computer_browser). Code is one-way (25 Oct 2026): agents never
    change Code projects, so no project work comes this way any more; a Code run asks agents instead (/ui/code/ask). */
 const live=new Map(),jobs=new Map();let seq=0;
 function poll(dev){const k=dev.key,cur=live.get(k);if(cur?.wake)cur.wake(null);
  const e={user:dev.user,name:dev.name,box:!!dev.box,seen:Date.now(),queue:cur?.queue||[]};live.set(k,e);
  if(e.queue.length)return Promise.resolve(e.queue.shift());
  return new Promise(r=>{const t=setTimeout(()=>{e.wake=null;r(null)},25000);e.wake=j=>{clearTimeout(t);e.wake=null;r(j)}})}
 // a job handed to a long-poll whose connection had already dropped goes back to the front (or to the poll waiting now)
 function requeue(dev,job){const e=live.get(dev.key);if(!e||!job||!jobs.has(job.id)&&!pushed.get(job.id)?.())return;if(e.wake)e.wake(job);else e.queue.unshift(job)}
 /* A job for one computer's Code by its key, from another module (the code bridge, app/code-bridge.mjs, 25 Oct 2026):
    handed to its long-poll at once, or queued for the next one; alive() says whether it is still wanted, so a job given to
    a poll whose connection had dropped goes back only while its caller still waits. seen() is when it last asked. */
 const pushed=new Map();
 function push(key,job,alive){const e=live.get(key);if(!e)return false;pushed.set(job.id,alive);if(pushed.size>500)for(const [k,f] of pushed)if(!f())pushed.delete(k);if(e.wake)e.wake(job);else e.queue.push(job);return true}
 const seen=key=>live.get(key)?.seen||0;
 function done(dev,id,out){const j=jobs.get(String(id));if(!j||j.dev!==dev.key)return false;jobs.delete(j.id);j.resolve(out||{});return true}

 async function devices(user){await load();return Object.entries(db.devices).filter(([,d])=>d.user===user).map(([h,d])=>({id:h.slice(0,12),...d}))}
 // the id is the 12 characters devices() shows: an empty or short one used to match (and remove) every computer of theirs;
 // a removed computer also leaves the live list at once (its key is the hash's first 16), so agents stop sending it browser jobs
 async function unpair(user,id){id=String(id||'');if(!/^[0-9a-f]{12,64}$/.test(id))return 0;await load();let n=0;
  for(const [h,d] of Object.entries(db.devices))if(d.user===user&&h.startsWith(id)){delete db.devices[h];n++;const e=live.get(h.slice(0,16));if(e?.user===user){e.wake?.(null);live.delete(h.slice(0,16))}}
  if(n)await save();return n}
 // the version is the commit the box's copy of the source is at (it changes with every pull)
 const version=async()=>{const v=(await readFile(path.join(SRC,'VERSION'),'utf8').catch(()=>'')).trim();if(v)return v.slice(0,12);try{const head=(await readFile(path.join(SRC,'.git','HEAD'),'utf8')).trim();if(!head.startsWith('ref:'))return head.slice(0,12);const ref=head.slice(4).trim();
   const sha=await readFile(path.join(SRC,'.git',ref),'utf8').catch(async()=>((await readFile(path.join(SRC,'.git','packed-refs'),'utf8')).split('\n').find(l=>l.endsWith(' '+ref))||'').split(' ')[0]);return String(sha).trim().slice(0,12)||'0'}catch{return '0'}};
 // what an installed app fetches to update itself: the source, and this install's address and version
 async function update(){const v=await version();const files=await walk(SRC);files.push(['aqeelos.json',Buffer.from(JSON.stringify({aqeelos:{base:PUBLIC_URL,origins:[PUBLIC_URL],version:v,...(UPDATE_REPO?{repo:UPDATE_REPO}:{})}},null,1))]);return {version:v,zip:zip(files.map(f=>[f[0],f[1],/\.(command|sh)$/.test(f[0])]))}}
 // the download for one kind of computer
 async function download(os){const files=(await walk(SRC)).map(([n,b])=>['aqeelOS Code/'+n,b]);
  const cfg=JSON.stringify({aqeelos:{base:PUBLIC_URL,origins:[PUBLIC_URL],version:await version(),brand:globalThis.AQ_BRAND||'aqeelOS',...(UPDATE_REPO?{repo:UPDATE_REPO}:{})}},null,1);files.push(['aqeelOS Code/aqeelos.json',Buffer.from(cfg)]);
  const tpl=f=>readFile(path.join(ROOT,'code-installer',f));
  if(os==='windows'){files.push(['aqeelOS Code/Install aqeelOS Code.cmd',await tpl('install.cmd')],['aqeelOS Code/install.ps1',await tpl('install.ps1')],['aqeelOS Code/uninstall.ps1',await tpl('uninstall.ps1')])}
  else files.push(['aqeelOS Code/Install aqeelOS Code.command',await tpl('install.command'),true],['aqeelOS Code/Uninstall aqeelOS Code.command',await tpl('uninstall.command'),true]);
  return zip(files.map(f=>f.length===3?f:[f[0],f[1],/\.(command|sh)$/.test(f[0])]))}
 const UFILE=path.join(DATA,'code-usage.json');let ub=null;const day=()=>new Date().toISOString().slice(0,10);
 const uload=async()=>{if(!ub){ub=await readStore(UFILE)}if(ub.day!==day())ub={day:day(),u:{}};return ub};
 async function usedToday(uid){await uload();return ub.u[uid]||0}
 async function addUsage(uid,tokens){await uload();ub.u[uid]=(ub.u[uid]||0)+Math.max(0,Number(tokens)||0);await writeFile(UFILE,JSON.stringify(ub)).catch(()=>{})}
 // the guarded browser on a person's own computer: the most recently connected computer of these people (never the AI box's copy)
 function computerOf(uids){let best=null;for(const [k,e] of live)if(uids.includes(e.user)&&Date.now()-e.seen<120000&&!e.box&&!/AI box/.test(e.name||'')&&(!best||e.seen>best[1].seen))best=[k,e];return best?{key:best[0],name:best[1].name}:null}
 function browse(uids,payload,ms=150000){const c=computerOf(uids);if(!c)return Promise.reject(Error('No computer of yours has aqeelOS Code running right now.'));const e=live.get(c.key);
  const j={id:String(++seq)+'-'+Date.now().toString(36),dev:c.key,job:null};j.job={id:j.id,kind:'browser',...payload};
  const result=new Promise(res=>{j.resolve=res;setTimeout(()=>{if(jobs.has(j.id)){jobs.delete(j.id);res({state:'failed',text:'The computer did not answer in time.'})}},ms)});jobs.set(j.id,j);if(e.wake)e.wake(j.job);else e.queue.push(j.job);return result}
 // every Code run, reported by the app after it finishes: who started it, for which agent, in which project, and its tokens
 const RUNS=path.join(DATA,'code-runs.jsonl');
 async function addRun(dev,r){const line={time:Date.now(),user:dev.user,device:dev.name,agent:/^[a-z0-9][a-z0-9_-]{0,63}(--[a-z0-9_-]{1,64})?$/.test(String(r.agent||''))?String(r.agent):'',project:String(r.projectName||r.projectId||'').slice(0,80),provider:String(r.provider||'').slice(0,80),model:String(r.model||'').slice(0,120),input:Math.max(0,+r.input||0),output:Math.max(0,+r.output||0),cache:Math.max(0,+r.cachedInput||0),state:String(r.state||'').slice(0,40)};
  await mkdir(DATA,{recursive:true});await writeFile(RUNS,JSON.stringify(line)+'\n',{flag:'a'});await addUsage(dev.user,line.input+line.output)}
 async function runs(days,uid){const since=Date.now()-days*86400e3;const out={byPerson:Object.create(null),byAgent:Object.create(null),byProject:Object.create(null)};let text='';   // keys come from what a computer reportedtry{text=await readFile(RUNS,'utf8')}catch{}
  for(const l of text.split('\n')){if(!l)continue;let r;try{r=JSON.parse(l)}catch{continue}if(r.time<since||(uid&&r.user!==uid))continue;
   for(const [m,k] of [['byPerson',r.user],['byAgent',r.agent||'(no agent)'],['byProject',r.project||'(unnamed)']]){const o=out[m][k]??={runs:0,input:0,output:0,cache:0};o.runs++;o.input+=r.input;o.output+=r.output;o.cache+=r.cache}}return out}
 // what a computer's Code has connected (GitHub accounts, tool servers), shown under Connected apps › Code
 async function report(dev,r){await load();const e=Object.entries(db.devices).find(([h])=>h.slice(0,16)===dev.key);if(!e)return;e[1].report={at:Date.now(),github:(Array.isArray(r.github)?r.github:[]).slice(0,10).map(a=>({user:String(a.user||'').slice(0,60),active:Boolean(a.active)})),mcp:(Array.isArray(r.mcp)?r.mcp:[]).slice(0,40).map(m=>String(m).slice(0,60)),version:String(r.version||'').slice(0,40)};await save()}
 async function allDevices(){await load();return Object.entries(db.devices).map(([h,d])=>({id:h.slice(0,12),name:d.name,user:d.user,last:d.last,report:d.report||null}))}
 return {report,allDevices,addRun,runs,computerOf,browse,push,seen,usedToday,addUsage,pair,markBox,who,devices,unpair,version,update,download,poll,requeue,done}}
