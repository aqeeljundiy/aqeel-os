// Public links: an agent makes a file it made (an image, a PDF, a video…) open for anyone with the link, when the
// person asks for it. The file is copied as it is now into the UI's data folder and served at
// <PUBLIC_URL>/pub/<code>/<name> without a sign-in; the agent can list its links and stop one.
// Served in a sandbox (no scripts, no forms) so a web page or SVG shared this way can never act as aqeelOS.
import {writeStore} from './store.mjs';
import {readFile,writeFile,mkdir,rename,rm,stat,copyFile,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';

const MAX=500*1024*1024;
// never shared, wherever they sit: secrets, sign-ins, keys
const PRIVATE=/(^|\/)(\.secrets|\.ssh|\.gnupg|mcp-tokens)(\/|$)|(^|\/)(\.env[\w.-]*|auth\.json|[\w.-]*\.env|google_(token|client_secret)[\w.-]*\.json|id_(rsa|ed25519|ecdsa)[\w.-]*|[\w.-]+\.(pem|key|p12|pfx)|config\.ya?ml|[\w.-]+\.db(-wal|-shm|-journal)?)$/i;

export function createPublicFiles({DATA,HERMES_HOME,PUBLIC_URL,types={}}){
 const DIR=path.join(DATA,'public'),FILE=path.join(DATA,'public.json');let db=null;
 const load=async()=>db||=await readFile(FILE,'utf8').then(JSON.parse).catch(()=>({links:{}}));
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeStore(FILE,JSON.stringify(db,null,1))};
 const urlOf=(code,l)=>PUBLIC_URL+'/pub/'+code+'/'+encodeURIComponent(l.name);
 // where an agent's files can come from: its own folder and engine home (the main agent: the whole main user), and /tmp
 const roots=a=>a==='default'?[homedir(),'/tmp']:[path.join(homedir(),'workspaces',a),path.join(HERMES_HOME,'profiles',a),'/tmp'];
 const expired=l=>l.until&&Date.now()>l.until;

 async function make(agent,{path:p,days,name}={}){
  if(!p||typeof p!=='string')throw new Error('Give path: the full path of the file to share.');
  let real;try{real=await realpath(path.resolve(p))}catch{throw new Error('No file at '+p+'.')}
  // the roots as real paths too (macOS: /tmp is /private/tmp)
  const rs=[];for(const r of roots(agent)){rs.push(r);const x=await realpath(r).catch(()=>null);if(x&&x!==r)rs.push(x)}
  if(!rs.some(r=>real===r||real.startsWith(r+path.sep)))throw new Error('Only files in your own folders (or /tmp) can be made public. Copy it there first.');
  if(real.startsWith(path.resolve(DATA)+path.sep)||PRIVATE.test(real.split(path.sep).join('/')))throw new Error('That file holds secrets or sign-ins and is never made public.');
  const st=await stat(real);if(!st.isFile())throw new Error('That is a folder, not a file. Zip it first if the person wants the whole folder.');
  // in /tmp, which every agent shares: only a file the agent made itself (owned by its own user, the owner of its folder)
  if(agent!=='default'&&real.startsWith('/tmp/')){const own=await stat(path.join(homedir(),'workspaces',agent)).catch(()=>null);if(!own||own.uid!==st.uid)throw new Error('That file in /tmp is not yours. Only files you made can be made public.')}
  if(st.size>MAX)throw new Error('The file is larger than 500 MB.');
  const fname=String(name||path.basename(real)).replace(/[^\w.\- ()]+/g,'-').replace(/^[.\s-]+/,'').slice(0,120)||'file';
  const code=randomBytes(12).toString('base64url'),dir=path.join(DIR,code);
  await mkdir(dir,{recursive:true});await copyFile(real,path.join(dir,fname));
  const d=+days>0?Math.min(+days,3650):0;
  await load();db.links[code]={agent,name:fname,from:real,size:st.size,at:Date.now(),...(d?{until:Date.now()+d*864e5}:{})};await save();
  return {url:urlOf(code,db.links[code]),name:fname,size:st.size,until:db.links[code].until||null}}

 async function list(agent){await load();return Object.entries(db.links).filter(([,l])=>!agent||l.agent===agent).map(([code,l])=>({code,url:urlOf(code,l),...l,expired:!!expired(l)})).sort((a,b)=>b.at-a.at)}

 async function stop(agent,ref){await load();const code=String(ref||'').match(/\/pub\/([\w-]{8,})/)?.[1]||String(ref||'').trim();const l=db.links[code];
  if(!l||(agent&&l.agent!==agent))throw new Error('No public link of yours matches that. Use list_public to see them.');
  delete db.links[code];await save();await rm(path.join(DIR,code),{recursive:true,force:true});return l}

 // GET /pub/<code>/<name>: no sign-in; anything unknown, stopped or expired is a plain 404. Never kept by Cloudflare
 // or other caches (private), so stopping a link works at once
 async function serve(req,res,code,name){await load();const l=db.links[code];
  const nf=()=>{res.writeHead(404,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end('This link does not exist or was stopped.')};
  if(!l||expired(l)||decodeURIComponent(name)!==l.name)return nf();
  const file=path.join(DIR,code,l.name);const st=await stat(file).catch(()=>null);if(!st)return nf();
  const ext=path.extname(l.name).toLowerCase(),risky=/^\.(html?|svg|xml|xhtml|js|mjs)$/.test(ext);
  const ct=risky?'text/plain; charset=utf-8':(types[ext]||'application/octet-stream');
  const head={'content-type':ct,'content-length':st.size,'cache-control':'private, no-cache','x-content-type-options':'nosniff',
   'content-security-policy':"sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",'referrer-policy':'no-referrer','x-robots-tag':'noindex',
   'content-disposition':(risky?'attachment':'inline')+"; filename*=UTF-8''"+encodeURIComponent(l.name)};
  // byte ranges, so videos can be scrubbed
  const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range||'');
  if(m&&(m[1]||m[2])){let s=m[1]?+m[1]:Math.max(0,st.size-+m[2]),e=m[1]&&m[2]?Math.min(+m[2],st.size-1):st.size-1;if(s>e||s>=st.size){res.writeHead(416,{'content-range':'bytes */'+st.size});return res.end()}
   res.writeHead(206,{...head,'content-length':e-s+1,'content-range':`bytes ${s}-${e}/${st.size}`,'accept-ranges':'bytes'});if(req.method==='HEAD')return res.end();return createReadStream(file,{start:s,end:e}).pipe(res)}
  res.writeHead(200,{...head,'accept-ranges':'bytes'});if(req.method==='HEAD')return res.end();createReadStream(file).pipe(res)}

 const TOOLS=[
  {name:'make_public',description:'Make a file you made (image, PDF, video, document, any file) open to anyone with a link, and get that link. Only when the person asks for a public or shareable link ("make this public", "give me a link I can send"): the file becomes visible to anyone who has the URL. It shares a copy of the file as it is now; share it again after changing the file. Say in your reply that anyone with the link can open it, and that you can stop it.',inputSchema:{type:'object',properties:{path:{type:'string',description:'Full path of the file on the AI box'},days:{type:'number',description:'Optional: stop the link by itself after this many days. Leave out to keep it until stopped.'},name:{type:'string',description:'Optional file name shown in the link'}},required:['path']}},
  {name:'list_public',description:'List the public links you made: link, file, when, and when each stops.',inputSchema:{type:'object',properties:{}}},
  {name:'stop_public',description:'Stop a public link you made (the link or its code): it stops working at once for everyone.',inputSchema:{type:'object',properties:{link:{type:'string'}},required:['link']}}];
 const kb=n=>n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
 async function call(agent,name,a={}){
  if(name==='make_public'){const r=await make(agent,a);console.log('public link made by',agent+':',r.name);return 'Public link (anyone with it can open the file): '+r.url+'\n'+r.name+', '+kb(r.size)+(r.until?', stops '+new Date(r.until).toISOString().slice(0,10):', until stopped')}
  if(name==='list_public'){const l=await list(agent);return l.length?l.map(x=>'- '+x.url+' ('+kb(x.size)+', made '+new Date(x.at).toISOString().slice(0,10)+(x.expired?', expired':x.until?', stops '+new Date(x.until).toISOString().slice(0,10):'')+')').join('\n'):'You have no public links.'}
  if(name==='stop_public'){const l=await stop(agent,a.link);console.log('public link stopped by',agent+':',l.name);return 'Stopped. '+l.name+' is no longer public; the link now shows "does not exist".'}}
 return {make,list,stop,serve,TOOLS,call,names:new Set(TOOLS.map(t=>t.name))}}
