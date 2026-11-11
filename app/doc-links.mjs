// One-purpose public links for a file WhatsApp has to fetch (12 Nov 2026, issue i19b649d9): Kirimdev's document message wants a
// public https link, not bytes. A customer's protocol PDF is health data, so the link is made for ONE file, is 32 random bytes
// (only the hash is kept), works for 15 minutes and 6 downloads at most (Kirimdev and Meta each fetch it once), and is dropped
// the moment the send is done or failed. Not a general file share (that is public-files.mjs): PDFs only, nothing listed, nothing
// kept across a restart (the folder is emptied at start). Served at <PUBLIC_URL>/doc/<token>/<name>.pdf without a sign-in.
import {writeFile,mkdir,rm,readdir,readFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';

export const DOC_TTL=15*60e3,DOC_MAX_HITS=6,DOC_MAX_BYTES=20*1024*1024;
const hash=t=>createHash('sha256').update(String(t)).digest('hex');
export const safeName=n=>String(n||'file.pdf').replace(/[^\w.\- ()]+/g,'-').replace(/^[.\s-]+/,'').replace(/(\.pdf)?$/i,'.pdf').slice(0,120);

export function createDocLinks({DATA,PUBLIC_URL,now=()=>Date.now(),random=n=>randomBytes(n)}){
 const DIR=path.join(DATA,'doc-links'),links=new Map();let ready=null;
 const base=()=>String(typeof PUBLIC_URL==='function'?PUBLIC_URL():PUBLIC_URL||'').replace(/\/+$/,'');
 const init=()=>ready||=(async()=>{await rm(DIR,{recursive:true,force:true});await mkdir(DIR,{recursive:true,mode:0o700})})();
 const drop=async h=>{links.delete(h);await rm(path.join(DIR,h+'.pdf'),{force:true}).catch(()=>{})};
 const sweep=async()=>{for(const [h,l] of [...links])if(now()>=l.exp||l.hits>=DOC_MAX_HITS)await drop(h)};
 // buffer: the PDF itself. Returns {url, exp, revoke()}; refuses anything that is not a PDF
 async function put({buffer,name,agent='',ttl=DOC_TTL}){
  if(!Buffer.isBuffer(buffer)||buffer.length<8||!buffer.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('That is not a PDF.');
  if(buffer.length>DOC_MAX_BYTES)throw Error('The PDF is larger than 20 MB.');
  if(!/^https:\/\//.test(base()))throw Error('The app has no public https address (System > Settings), so a file link cannot be made.');
  await init();await sweep();const token=random(32).toString('base64url'),h=hash(token),fname=safeName(name);
  await writeFile(path.join(DIR,h+'.pdf'),buffer,{mode:0o600});links.set(h,{name:fname,agent,exp:now()+Math.min(ttl,DOC_TTL),hits:0,size:buffer.length});
  return {url:base()+'/doc/'+token+'/'+encodeURIComponent(fname),exp:links.get(h).exp,revoke:()=>drop(h)}}
 // GET/HEAD /doc/<token>/<name>: anything unknown, used up or past its time is the same plain 404
 async function serve(req,res,token,name){await sweep();
  const nf=()=>{res.writeHead(404,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});res.end('This link does not exist or has expired.')};
  if(!/^[A-Za-z0-9_-]{43}$/.test(String(token)))return nf();
  const h=hash(token),l=links.get(h);let nm;try{nm=decodeURIComponent(name||'')}catch{return nf()}
  if(!l||nm!==l.name)return nf();
  const buf=await readFile(path.join(DIR,h+'.pdf')).catch(()=>null);if(!buf)return nf();
  if(req.method!=='HEAD')l.hits++;
  res.writeHead(200,{'content-type':'application/pdf','content-length':buf.length,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex',
   'content-disposition':"inline; filename*=UTF-8''"+encodeURIComponent(l.name),'content-security-policy':"sandbox; default-src 'none'"});
  res.end(req.method==='HEAD'?undefined:buf)}
 return {put,serve,sweep,count:()=>links.size,files:()=>readdir(DIR).catch(()=>[])}}
