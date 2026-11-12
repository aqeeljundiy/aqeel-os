// The key behind every agent's signed tool address, and how it is changed (security audit H-9 / E14, 12 Nov 2026).
//
// Each agent reaches aqeelOS's own tools at an address that ends in a signature (/mcp/notify/<agent>/<sig>, /run-gate/...,
// /event-hook/..., /posting-*/..., /google-files/..., /mcp/self/..., /mcp/code/...). The signature was made with the cookie
// key and could never be changed without signing everyone out and breaking every agent. Now:
//   - the key is its own file, <DATA>/relay-secret (mode 600). Until that file exists the cookie key is used, as before.
//   - scripts/rotate-secrets.mjs writes a new one and keeps the old key in <DATA>/relay-secret.prev (mode 600).
//   - at the next start aqeelOS re-issues every address: each old signature in the agents' settings and in the scripts
//     aqeelOS wrote for them is replaced by the new one (reissue). For a short time after the rotation (30 minutes unless
//     the command says otherwise) the old signatures are still accepted, so a run that started before is not cut off.
import {readFileSync,writeFileSync,existsSync,renameSync,unlinkSync,chmodSync,mkdirSync} from 'node:fs';
import {readFile,writeFile,readdir,rename,stat} from 'node:fs/promises';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';import path from 'node:path';
export const LABELS=['relay:','google-files:','self-runs:','code-bridge:'];
export const sigOf=(key,label,agent)=>createHmac('sha256',key).update(label+agent).digest('base64url').slice(0,32);
const FILE=d=>path.join(d,'relay-secret'),PREV=d=>path.join(d,'relay-secret.prev');
const readPrev=d=>{try{const p=JSON.parse(readFileSync(PREV(d),'utf8'));return p&&typeof p.key==='string'&&p.key.length>=32?p:null}catch{return null}};
// cur: the key signatures are made with. accept: an older key still accepted now (or null). old: the older key whose
// signatures are still to be replaced on disk (or null).
export function relayKeys(DATA,uiSecret,now=Date.now()){let cur=uiSecret,own=false;try{const s=readFileSync(FILE(DATA),'utf8').trim();if(s.length>=32){cur=s;own=true}}catch{}
 const p=readPrev(DATA),ok=p&&p.key!==cur;return {cur,own,accept:ok&&p.until>now?p.key:null,old:ok&&!p.reissued?p.key:null,until:ok?p.until:0}}
// what the server uses: sign(label, agent) and ok(given, label, agent) (constant time, the old key within its time too)
export function createRelayKeys(DATA,uiSecret,now=()=>Date.now()){let k=relayKeys(DATA,uiSecret,now());
 const same=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)};
 return {get cur(){return k.cur},get old(){return k.old},sign:(label,agent)=>sigOf(k.cur,label,agent),
  ok:(given,label,agent)=>same(given,sigOf(k.cur,label,agent))||(!!k.accept&&k.until>now()&&same(given,sigOf(k.accept,label,agent))),
  done(){const p=readPrev(DATA);if(!p)return;if(p.until<=now()){try{unlinkSync(PREV(DATA))}catch{}}else{writeFileSync(PREV(DATA)+'.tmp',JSON.stringify({...p,reissued:true}),{mode:0o600});renameSync(PREV(DATA)+'.tmp',PREV(DATA))}k=relayKeys(DATA,uiSecret,now())}}}
// A new key. oldKey: the key in use until now (the cookie key when there was no relay-secret yet). Returns what it did.
export function rotateRelay(DATA,oldKey,{graceMinutes=30,now=Date.now()}={}){mkdirSync(DATA,{recursive:true});const key=randomBytes(32).toString('hex');
 writeFileSync(PREV(DATA)+'.tmp',JSON.stringify({key:String(oldKey),until:now+Math.max(0,graceMinutes)*60e3,at:now,reissued:false}),{mode:0o600});renameSync(PREV(DATA)+'.tmp',PREV(DATA));chmodSync(PREV(DATA),0o600);
 writeFileSync(FILE(DATA)+'.tmp',key+'\n',{mode:0o600});renameSync(FILE(DATA)+'.tmp',FILE(DATA));chmodSync(FILE(DATA),0o600);return {file:FILE(DATA),graceMinutes}}
// Replaces every signature made with the old key by the one made with the new key, in each agent's settings and in the
// scripts aqeelOS wrote. agents: every agent id (copies such as a--whatsapp-2 included). Returns the files changed.
export async function reissue({HERMES_HOME,agents,cur,old,log=()=>{}}){if(!old||old===cur)return [];
 const pairs=[];for(const a of agents)for(const l of LABELS)pairs.push([sigOf(old,l,a),sigOf(cur,l,a)]);
 const files=[path.join(HERMES_HOME,'config.yaml')];const scripts=async d=>{for(const f of await readdir(d).catch(()=>[]))files.push(path.join(d,f))};await scripts(path.join(HERMES_HOME,'scripts'));
 for(const p of await readdir(path.join(HERMES_HOME,'profiles')).catch(()=>[])){files.push(path.join(HERMES_HOME,'profiles',p,'config.yaml'));await scripts(path.join(HERMES_HOME,'profiles',p,'scripts'))}
 const changed=[];for(const f of files){const st=await stat(f).catch(()=>null);if(!st?.isFile()||st.size>4e6)continue;const t=await readFile(f,'utf8').catch(()=>null);if(t==null)continue;
  let n=t;for(const [o,c] of pairs)if(n.includes(o))n=n.split(o).join(c);if(n===t)continue;
  try{const tmp=f+'.'+process.pid+'.rk.tmp';await writeFile(tmp,n,{mode:st.mode&0o777});await rename(tmp,f);changed.push(f)}catch(e){log('relay keys: could not re-issue '+f+': '+e.message)}}
 return changed}
// Every signed address of aqeelOS's own routes, hidden wherever text is shown or sent on (logs an agent or a person
// reads, evidence sent to a fixer). The signature is 32 characters, under what the general "long token" rule catches.
export const hideSigned=t=>String(t).replace(/(\/(?:mcp\/[\w-]+|run-gate|event-hook|posting-(?:gate|record|check|sending|cancel)|google-files)\/(?:[\w.-]+\/){1,2})[A-Za-z0-9_-]{16,}/g,'$1(hidden)');
export const hasRelayFile=DATA=>existsSync(FILE(DATA));
