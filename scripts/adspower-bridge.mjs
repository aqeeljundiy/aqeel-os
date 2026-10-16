// AdsPower bridge: one fixed browser address (http://127.0.0.1:9333) for the facebook-manager agent.
// On the first connection it starts the chosen AdsPower profile (with its own fingerprint and proxy) through
// AdsPower's Local API, then passes Chrome DevTools traffic straight through to that browser.
// Settings (read fresh on every call from the facebook-manager and default .env, so you or the agent can change them):
//   ADSPOWER_API_KEY  Local API key (AdsPower › Automation › API)
//   ADSPOWER_PROFILE  the profile to use: its name, remark or id. Never guessed among business profiles.
//                     Not set: the profile that is already open (e.g. the agent opened it with its AdsPower tool).
// Env: ADSPOWER_API (default http://127.0.0.1:50325), BRIDGE_PORT (default 9333).
import {createServer,request} from 'node:http';
import {connect} from 'node:net';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';

const API=process.env.ADSPOWER_API||'http://127.0.0.1:50325';
const PORT=Number(process.env.BRIDGE_PORT)||9333;
const ENV_FILES=[homedir()+'/.hermes/profiles/facebook-manager/.env',homedir()+'/.hermes/.env'];
const setting=name=>{for(const file of ENV_FILES){try{const line=readFileSync(file,'utf8').split('\n').find(l=>l.startsWith(name+'='));const v=line?line.slice(name.length+1).trim().replace(/^["']|["']$/g,''):'';if(v)return v}catch{}}return process.env[name]||''};
const headers=()=>{const k=setting('ADSPOWER_API_KEY');return {'content-type':'application/json',...(k?{authorization:'Bearer '+k}:{})}};
const log=(...a)=>console.log(new Date().toISOString(),...a);

async function api(method,path,body){
 const r=await fetch(API+path,{method,headers:headers(),body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 const j=await r.json().catch(()=>({}));if(j.code!==0)throw new Error(`AdsPower ${path}: ${j.msg||r.status}`);return j.data||{};
}
let profileId='',chosenFor=null;
async function pickProfile(){
 const want=setting('ADSPOWER_PROFILE')||setting('ADSPOWER_PROFILE_ID');
 if(profileId&&chosenFor===want)return profileId;profileId='';chosenFor=want;
 if(!want)throw new Error('No profile chosen yet: set ADSPOWER_PROFILE to the AdsPower profile name.');
 const d=await api('POST','/api/v2/browser-profile/list',{page:1,limit:200});const list=d.list||[];
 const norm=v=>String(v??'').trim().toLowerCase();const w=norm(want);
 const p=list.find(x=>[x.profile_id,x.user_id,x.name,x.remark,x.serial_number,x.profile_no].some(v=>norm(v)===w))||list.find(x=>norm(x.name).includes(w)||norm(x.remark).includes(w));
 if(!p)throw new Error('No AdsPower profile matches ADSPOWER_PROFILE="'+want+'".');
 profileId=p.profile_id||p.user_id;log('using profile',profileId,p.name||'');return profileId;
}
const portOf=d=>{const ws=d.ws?.puppeteer||'';const m=/:(\d+)\//.exec(ws);return Number(d.debug_port)||(m?Number(m[1]):0)};
let starting=null;
// the profile that is open right now (newest last); none set and none open → say how to fix it
async function openPort(){const d=await api('GET','/api/v1/browser/local-active');const l=d.list||[];const a=l[l.length-1];
 if(!a)throw new Error('No AdsPower profile is open. Open one first (AdsPower tool), or set ADSPOWER_PROFILE to the profile to use.');
 if(chosenFor!=='(open) '+a.user_id){chosenFor='(open) '+a.user_id;profileId='';log('using the open profile',a.user_id)}return portOf(a)}
async function ensure(){ // → debug port of the running profile
 if(!(setting('ADSPOWER_PROFILE')||setting('ADSPOWER_PROFILE_ID')))return openPort();
 const id=await pickProfile();
 try{const a=await api('GET','/api/v2/browser-profile/active?profile_id='+encodeURIComponent(id));if(/active/i.test(a.status||'')&&portOf(a))return portOf(a)}catch(e){log('active check:',e.message)}
 if(!starting)starting=api('POST','/api/v2/browser-profile/start',{profile_id:id}).then(d=>{log('started profile',id);return portOf(d)}).finally(()=>setTimeout(()=>starting=null,3000));
 const port=await starting;if(!port)throw new Error('AdsPower started the profile but gave no debug port.');return port;
}
const rewrite=(s,port)=>s.split(`127.0.0.1:${port}`).join(`127.0.0.1:${PORT}`).split(`localhost:${port}`).join(`127.0.0.1:${PORT}`);

const server=createServer(async(req,res)=>{
 try{const port=await ensure();
  const up=request({host:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${port}`}},r=>{
   const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>{let body=Buffer.concat(chunks).toString('utf8');if(/json/.test(r.headers['content-type']||'')||req.url.startsWith('/json'))body=rewrite(body,port);
    res.writeHead(r.statusCode||502,{'content-type':r.headers['content-type']||'application/json'});res.end(body)})});
  up.on('error',e=>{res.writeHead(502);res.end(e.message)});req.pipe(up);
 }catch(e){log(e.message);res.writeHead(503,{'content-type':'text/plain'});res.end(e.message)}
});
server.on('upgrade',async(req,sock,head)=>{
 try{const port=await ensure();const up=connect(port,'127.0.0.1',()=>{
   const lines=[`${req.method} ${req.url} HTTP/1.1`];for(const [k,v] of Object.entries(req.headers))lines.push(`${k}: ${k==='host'?'127.0.0.1:'+port:v}`);
   up.write(lines.join('\r\n')+'\r\n\r\n');if(head?.length)up.write(head);sock.pipe(up);up.pipe(sock)});
  const end=()=>{sock.destroy();up.destroy()};up.on('error',end);sock.on('error',end);
 }catch(e){log(e.message);sock.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'+e.message)}
});
server.listen(PORT,'127.0.0.1',()=>log(`AdsPower bridge on http://127.0.0.1:${PORT} → ${API}`));
