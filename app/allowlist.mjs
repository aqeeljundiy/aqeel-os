// Who can message (1 Nov 2026), the way the engine decides it (read on the box: gateway/authz_mixin.py,
// gateway/whatsapp_identity.py, gateway/platforms/_shared.py and each platform's adapter.py and gateway_env.py).
// Someone may message a channel when any of these holds: its "anyone" switch (<PF>_ALLOW_ALL_USERS); an approval in its
// pairing store; its allowlist (<PF>_ALLOWED_USERS, "*" = anyone); the list for every channel (GATEWAY_ALLOWED_USERS); or,
// with no list at all, GATEWAY_ALLOW_ALL_USERS. WhatsApp people have two IDs, a phone number and a LID, tied together by
// the bridge's lid-mapping files; the engine treats every alias as the same person, so this does too.
// New people: WhatsApp, WeCom, QQ and Weixin follow their DM policy (missing = pairing: they ask); every other big platform
// stops pairing once it has a list (allowlist_suppresses_pairing), email never pairs.
// These parts only decide; scripts/allowlist.test.mjs tests them and server.mjs does the reading and writing.

// a list as the engine reads it: a JSON list literal, or comma separated (spaces are part of an entry's edges only)
export function parseList(raw){if(raw==null)return {items:[],json:false};const s=String(raw).trim();
 if(s.startsWith('[')){try{const v=JSON.parse(s);if(Array.isArray(v))return {items:v.map(x=>String(x).trim()).filter(Boolean),json:true}}catch{}}
 return {items:s.split(',').map(x=>x.trim()).filter(Boolean),json:false}}
export const split=raw=>parseList(raw).items;
// written back the way it was found
export const formatList=(items,json)=>json?JSON.stringify(items):items.join(',');
export const truthy=v=>/^(1|true|yes|on)$/i.test(String(v??'').trim());
// a .env file's values (the last line wins, comments skipped, quotes taken off as dotenv does)
export function parseEnv(text){const o={};for(const l of String(text||'').split('\n')){const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);if(m)o[m[1]]=m[2].trim().replace(/^(["'])(.*)\1$/,'$2')}return o}
// one KEY's line in a .env text, changed by fn(oldValue) -> new value ('' takes the line out, null leaves the file alone);
// the quote the line had is kept
export function setEnvLine(text,key,fn){const lines=String(text||'').split('\n');let at=-1;for(let i=0;i<lines.length;i++)if(new RegExp('^\\s*(?:export\\s+)?'+key+'\\s*=').test(lines[i]))at=i;
 const raw=at<0?null:lines[at].replace(/^[^=]*=\s*/,'').trim(),q=raw&&/^(["'])(.*)\1$/.exec(raw),val=q?q[2]:raw,next=fn(val);if(next==null||next===val)return null;
 if(next===''){if(at<0)return null;lines.splice(at,1)}else{const line=key+'='+(q?q[1]+next+q[1]:next);if(at<0)lines.splice(lines.at(-1)===''?lines.length-1:lines.length,0,line);else lines[at]=line}
 return lines.join('\n')}

/* ---------- WhatsApp identity (gateway/whatsapp_identity.py) ---------- */
// "6012:47@s.whatsapp.net", "6012@lid" and "+6012" all become "6012" (the first + only)
export const waNorm=v=>String(v??'').trim().replace('+','').split(':')[0].split('@')[0];
const SAFE=/^[A-Za-z0-9@.+\-]+$/;
// every ID reachable through the lid-mapping files ({file name: its text}), the ID itself included
export function waAliases(id,mapping){const n=waNorm(id);if(!n)return new Set();const out=new Set(),q=[n];
 while(q.length){const c=q.shift();if(!c||out.has(c)||!SAFE.test(c))continue;out.add(c);
  for(const suf of ['','_reverse']){const t=mapping?.['lid-mapping-'+c+suf+'.json'];if(t==null)continue;let m;try{m=waNorm(JSON.parse(String(t).replace(/^﻿/,'')))}catch{continue}if(m&&!out.has(m))q.push(m)}}
 return out}
const isWa=pf=>/^whatsapp/.test(String(pf));
// one person, however the ID is written: WhatsApp by any alias, others by the ID itself
// pf 'any' (the list for every channel, which applies to WhatsApp too): either way
export function samePerson(pf,a,b,mapping){if(pf==='any')return samePerson('whatsapp',a,b,mapping)||samePerson('',a,b,mapping);if(isWa(pf)){const A=waAliases(a,mapping);for(const x of waAliases(b,mapping))if(A.has(x))return true;return false}
 return String(a??'').trim().toLowerCase()===String(b??'').trim().toLowerCase()}
// the ID a person is shown by: WhatsApp's shortest alias (the engine's canonical one: the phone number, not the LID)
const shown=(pf,id,mapping)=>isWa(pf)?[...waAliases(id,mapping)].sort((x,y)=>x.length-y.length||(x<y?-1:1))[0]||waNorm(id):String(id);

export const listKey=pf=>String(pf).toUpperCase()+'_ALLOWED_USERS';
const OWN_POLICY=new Set(['whatsapp','wecom','qqbot','weixin']);   // adapters with their own DM policy, "pairing" when unset
const policyOf=(env,pf)=>{const v=String(env[String(pf).toUpperCase()+'_DM_POLICY']||'').trim().toLowerCase();return v||(OWN_POLICY.has(pf)?'pairing':'')};
// the list once one person is taken off: '' clears it, '*' takes only the "anyone" mark off, else every alias of that person
export function removeFrom(list,pf,id,mapping){if(id==='')return [];if(id==='*')return list.filter(x=>x!=='*');return list.filter(x=>x==='*'||!samePerson(pf,x,id,mapping))}
// what new people get: 'anyone', 'ask' (they ask and wait for an OK) or 'ignored'
export function newPeople(env,pf){const list=split(env[listKey(pf)]),global=split(env.GATEWAY_ALLOWED_USERS),pol=policyOf(env,pf),hasList=list.length>0||global.length>0;
 if(truthy(env[String(pf).toUpperCase()+'_ALLOW_ALL_USERS'])||list.includes('*')||global.includes('*'))return 'anyone';
 if(OWN_POLICY.has(pf)){if(pol==='pairing')return 'ask';if(pol==='open')return hasList?'ignored':'anyone';return 'ignored'}   // allowlist, disabled
 if(pf==='email')return hasList||!truthy(env.GATEWAY_ALLOW_ALL_USERS)?'ignored':'anyone';
 if(pol==='pairing')return 'ask';if(pol==='allowlist'||pol==='disabled')return 'ignored';
 if(hasList)return 'ignored';return truthy(env.GATEWAY_ALLOW_ALL_USERS)?'anyone':'ask'}
export const POLICY_WORDS={anyone:'Anyone who finds this channel can message it.',ask:'New people ask first and wait for your OK under People waiting.',ignored:'Only the people below. Anyone else gets no answer and can’t ask.'};
// the rows of one channel: one per person, whatever mix of approvals and list entries (every alias) they come from
function rowsOf(env,pf,approved,mapping){const rows=[],find=id=>rows.find(r=>r.ids.some(x=>samePerson(pf,x,id,mapping)));
 for(const u of approved){if(u.platform!==pf)continue;const r=find(u.user_id);if(r){r.approved=true;r.ids.push(u.user_id);r.name||=u.user_name||'';continue}rows.push({ids:[u.user_id],name:u.user_name||'',approved:true,listed:false})}
 for(const x of split(env[listKey(pf)])){if(x==='*')continue;const r=find(x);if(r){r.listed=true;if(!r.ids.includes(x))r.ids.push(x)}else rows.push({ids:[x],name:'',approved:false,listed:true})}
 for(const r of rows){const all=new Set();for(const i of r.ids)for(const a of isWa(pf)?waAliases(i,mapping):[String(i)])all.add(a);r.id=shown(pf,r.ids[0],mapping);r.raw=r.ids[0];r.aliases=[...all].filter(a=>a!==r.id)}
 return rows}
// what the channel is like after taking this off: anyone can write, new people can ask again, or nobody can reach it
function afterWords(before,env,pf,approved,mapping){const np=newPeople(env,pf),left=rowsOf(env,pf,approved,mapping).length+split(env.GATEWAY_ALLOWED_USERS).filter(x=>x!=='*').length;
 if(np==='anyone'&&before!=='anyone')return 'Anyone can message it then.';if(np==='ask'&&before!=='ask')return 'New people can ask to message it again then.';
 if(np==='ignored'&&!left)return 'Nobody can message it then, and new people can’t ask.';return ''}
const without=(env,key,rest,json)=>{const e={...env};if(rest.length)e[key]=formatList(rest,json);else delete e[key];return e};
// one channel's picture for Channels › Who can message; each row carries `after`, said in the confirm before removing it
export function channelWho(env,pf,approved=[],mapping){const key=listKey(pf),{items:list,json}=parseList(env[key]),np=newPeople(env,pf),rows=rowsOf(env,pf,approved,mapping);
 for(const r of rows)r.after=afterWords(np,without(env,key,list.filter(x=>!r.ids.some(i=>samePerson(pf,x,i,mapping))),json),pf,approved.filter(u=>!(u.platform===pf&&r.ids.some(i=>samePerson(pf,u.user_id,i,mapping)))),mapping);
 const star=list.includes('*');
 return {platform:pf,key,newPeople:np,words:POLICY_WORDS[np],star,starAfter:star?afterWords(np,without(env,key,list.filter(x=>x!=='*'),json),pf,approved,mapping):'',
  allowAll:truthy(env[String(pf).toUpperCase()+'_ALLOW_ALL_USERS']),policy:String(env[String(pf).toUpperCase()+'_DM_POLICY']||'').toLowerCase()||null,rows}}
// the list for every channel: who is on it, and what taking someone off leaves
export function globalWho(env){const list=split(env.GATEWAY_ALLOWED_USERS),allowAll=truthy(env.GATEWAY_ALLOW_ALL_USERS);
 return {list,allowAll,star:list.includes('*'),after:allowAll&&list.filter(x=>x!=='*').length===1?'With no list left, anyone may message every channel that has no list of its own.':''}}

/* ---------- Remove access ----------
   io.read() gives {env, approved, mapping} read now; io.setList(key, fn) changes one list under the .env lock, computing
   from the value at that moment (fn(old) -> new, null = no change) and says whether it already applies (hot); io.revoke(
   platform, id) removes one approval. One row covers every alias and both sources. "Every channel" takes them off the
   list for every channel and off each channel's own list and approvals, as its dialog says. Afterwards everything is
   read again and every way in is checked: their aliases on any list that applies, "*", the anyone switches, approvals. */
const LIST_KEY=/^([A-Z0-9_]+?)_ALLOWED_USERS$/;
export async function removePerson(io,{pf,id,every=false}){const before=await io.read();const mp=before.mapping;let restart=false;
 const keys=every?Object.keys(before.env).filter(k=>LIST_KEY.test(k)):[listKey(pf)];
 for(const k of keys){const kp=k==='GATEWAY_ALLOWED_USERS'?'any':k.replace(/_(GROUP_)?ALLOWED_USERS$/,'').toLowerCase();
  const r=await io.setList(k,old=>{const {items,json}=parseList(old);const rest=removeFrom(items,kp,id,mp);return rest.length===items.length?null:formatList(rest,json)});
  if(r?.changed&&!r.hot)restart=true}
 if(id&&id!=='*')for(const x of (before.approved||[]).filter(x=>(every||x.platform===pf)&&samePerson(x.platform,x.user_id,id,mp)))await io.revoke(x.platform,x.user_id);
 const after=await io.read(),e=after.env,m2=after.mapping,why=[];
 const on=(k,p)=>split(e[k]).some(x=>x!=='*'&&samePerson(p,x,id,m2));
 const pfs=every?[...new Set([...(after.approved||[]).map(x=>x.platform),...Object.keys(e).filter(k=>LIST_KEY.test(k)&&k!=='GATEWAY_ALLOWED_USERS').map(k=>k.replace(/_(GROUP_)?ALLOWED_USERS$/,'').toLowerCase())])]:[pf];
 if(id===''){if(split(e[listKey(pf)]).length)why.push('its list still has people on it')}
 else if(id==='*'){if((every?split(e.GATEWAY_ALLOWED_USERS):split(e[listKey(pf)])).includes('*'))why.push('the list still says *')}
 else{if(on('GATEWAY_ALLOWED_USERS','any'))why.push('they are on the list for every channel');
  for(const p of pfs){if(on(listKey(p),p))why.push('they are still on the '+p+' list');if((after.approved||[]).some(x=>x.platform===p&&samePerson(p,x.user_id,id,m2)))why.push('their '+p+' approval is still there')}
  if(!every)for(const p of pfs){if(split(e[listKey(p)]).includes('*')||split(e.GATEWAY_ALLOWED_USERS).includes('*'))why.push('the list says * (anyone)');if(truthy(e[String(p).toUpperCase()+'_ALLOW_ALL_USERS']))why.push('its settings let anyone write')}}
 return {still:why.length>0,why:[...new Set(why)],restart}}
// what aqeelOS sends the engine after a list changed: only that list, never `enabled`, so a paused channel stays paused
// even when its state could not be read (1 Nov 2026: a failed read sent enabled:true and could switch it back on)
export const engineChange=(key,val)=>val?{env:{[key]:val}}:{env:{},clear_env:[key]};
