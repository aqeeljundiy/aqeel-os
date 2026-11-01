// Who can message (1-2 Nov 2026), the way the engine and the WhatsApp bridge decide it. Read on the box, read-only:
// gateway/authz_mixin.py (who may write, what unknown people get), gateway/whatsapp_identity.py (phone and LID are one
// person), gateway/pairing.py (the approvals store; its list also shows every .env list entry tagged `source`),
// gateway/run_inbound.py (an aqeelOS patch: an ignored stranger is still filed under People waiting, silently),
// gateway/config.py + config_loader.py (unauthorized_dm_behavior, dm_policy, allow_from, allow_all_users in config.yaml)
// and scripts/whatsapp-bridge/bridge.js (WhatsApp DMs are filtered before the engine).
// Someone may message a channel when any of these holds: its "anyone" switch (<PF>_ALLOW_ALL_USERS); an approval in its
// pairing store; its allowlist (<PF>_ALLOWED_USERS, "*" = anyone); the list for every channel (GATEWAY_ALLOWED_USERS);
// or, with no list at all, GATEWAY_ALLOW_ALL_USERS. WhatsApp first passes its bridge: under any DM policy but pairing
// the bridge lets in only WHATSAPP_ALLOWED_USERS (empty = nobody), before any of the rest.
// These parts only decide; scripts/allowlist.test.mjs tests them and server.mjs does the reading and writing.

// a list as the engine reads it: a JSON list literal, or comma separated
export function parseList(raw){if(raw==null)return {items:[],json:false};const s=String(raw).trim();
 if(s.startsWith('[')){try{const v=JSON.parse(s);if(Array.isArray(v))return {items:v.map(x=>String(x).trim()).filter(Boolean),json:true}}catch{}}
 return {items:s.split(',').map(x=>x.trim()).filter(Boolean),json:false}}
export const split=raw=>parseList(raw).items;
// written back the way it was found
export const formatList=(items,json)=>json?JSON.stringify(items):items.join(',');
// the engine's truthy words (authz_mixin _TRUTHY)
export const truthy=v=>/^(1|true|yes)$/i.test(String(v??'').trim());
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
// mapping: {file name: text}, or a function(file name) -> text|null that reads only the files asked for
const mapRead=(mapping,n)=>typeof mapping==='function'?mapping(n):mapping?.[n];
// every ID reachable through the lid-mapping files, the ID itself included
export function waAliases(id,mapping){const n=waNorm(id);if(!n)return new Set();const out=new Set(),q=[n];
 while(q.length){const c=q.shift();if(!c||out.has(c)||!SAFE.test(c))continue;out.add(c);
  for(const suf of ['','_reverse']){const t=mapRead(mapping,'lid-mapping-'+c+suf+'.json');if(t==null)continue;let m;try{m=waNorm(JSON.parse(String(t).replace(/^﻿/,'')))}catch{continue}if(m&&!out.has(m))q.push(m)}}
 return out}
const isWa=pf=>/^whatsapp/.test(String(pf));
// one person, however the ID is written: WhatsApp by any alias, others by the ID itself; pf 'any' (the list for every
// channel, which also applies to WhatsApp): either way
export function samePerson(pf,a,b,mapping){if(pf==='any')return samePerson('whatsapp',a,b,mapping)||samePerson('',a,b,mapping);
 if(isWa(pf)){const A=waAliases(a,mapping);for(const x of waAliases(b,mapping))if(A.has(x))return true;return false}
 return String(a??'').trim().toLowerCase()===String(b??'').trim().toLowerCase()}
// the ID a person is shown by: WhatsApp's shortest alias (the engine's canonical one: the phone number, not the LID)
const shown=(pf,id,mapping)=>isWa(pf)?[...waAliases(id,mapping)].sort((x,y)=>x.length-y.length||(x<y?-1:1))[0]||waNorm(id):String(id);
const isGroupId=id=>/@g\.us$/i.test(String(id));

/* ---------- names and settings per platform ---------- */
const PFX={qqbot:'QQ'};   // gateway_env.py: QQ's keys are QQ_*, not QQBOT_*
const up=pf=>PFX[pf]||String(pf).toUpperCase();
export const listKey=pf=>up(pf)+'_ALLOWED_USERS';
const OWN_POLICY=new Set(['whatsapp','wecom','qqbot','weixin','yuanbao']);   // adapters with their own DM policy, "pairing" when unset
// config.yaml's say, read the way config_loader does: the root key, else under gateway:; per channel platforms.<pf>.<key>,
// else a root <pf>: block
const cfgTop=(c,k)=>c?.[k]??c?.gateway?.[k];
const cfgPf=(c,pf,k)=>c?.platforms?.[pf]?.[k]??c?.[pf]?.[k];
const policyOf=(env,pf,conf)=>{const v=String(env[up(pf)+'_DM_POLICY']||cfgPf(conf,pf,'dm_policy')||'').trim().toLowerCase();return v||(OWN_POLICY.has(pf)?'pairing':'')};
// the channel's own list: the .env, else config.yaml's allow_from
const ownList=(env,pf,conf)=>{const e=split(env[listKey(pf)]);if(e.length)return e;const a=cfgPf(conf,pf,'allow_from');return Array.isArray(a)?a.map(x=>String(x).trim()).filter(Boolean):split(a)};
const allowAllEnv=(env,conf)=>env.GATEWAY_ALLOW_ALL_USERS!=null?truthy(env.GATEWAY_ALLOW_ALL_USERS):truthy(cfgTop(conf,'allow_all_users'));
// what the engine does with a stranger (gateway/config.py + authz_mixin _get_unauthorized_dm_behavior): pair, ignore, decline
export function dmBehavior(env,pf,conf){const valid=v=>['pair','ignore','decline'].includes(String(v||'').toLowerCase())?String(v).toLowerCase():null;
 const per=valid(cfgPf(conf,pf,'unauthorized_dm_behavior'));if(per)return per;if(pf==='email')return 'ignore';
 const glob=valid(cfgTop(conf,'unauthorized_dm_behavior'));if(glob&&glob!=='pair')return glob;
 const pol=policyOf(env,pf,conf);if(pol==='pairing')return 'pair';if(pol==='allowlist'||pol==='disabled')return 'ignore';
 return ownList(env,pf,conf).length||split(env.GATEWAY_ALLOWED_USERS).length?'ignore':'pair'}
// 'anyone' (anyone may write), 'ask' (strangers get a code and wait under People waiting), 'silent' (strangers get no reply
// and wait under People waiting: the aqeelOS patch files their request), or 'ignored' (strangers are turned away unseen)
export function newPeople(env,pf,conf){const list=ownList(env,pf,conf),global=split(env.GATEWAY_ALLOWED_USERS);
 // WhatsApp's bridge first: under any policy but pairing only its own list gets in ("*" = anyone, empty = nobody)
 if(isWa(pf)&&policyOf(env,pf,conf)!=='pairing')return list.includes('*')?'anyone':'ignored';
 if(truthy(env[up(pf)+'_ALLOW_ALL_USERS'])||list.includes('*')||global.includes('*')||(!list.length&&!global.length&&allowAllEnv(env,conf)))return 'anyone';
 const b=dmBehavior(env,pf,conf);return b==='pair'?'ask':b==='ignore'?'silent':'ignored'}
export const POLICY_WORDS={anyone:'Anyone who finds this channel can message it.',ask:'New people get a code and wait for your OK under People waiting.',
 silent:'New people get no reply; they show under People waiting for your OK.',ignored:'Only the people below. Anyone else is turned away and does not show under People waiting.'};
// the rows of one channel: one per person, whatever mix of approvals and list entries (every alias) they come from.
// The engine's own list of approvals also carries every .env list entry (tagged `source`): those are read from the .env
// here, never as approvals; group IDs are not people.
function rowsOf(env,pf,approved,mapping,conf){const rows=[],find=id=>rows.find(r=>r.ids.some(x=>samePerson(pf,x,id,mapping)));
 for(const u of approved){if(u.platform!==pf||u.source||isGroupId(u.user_id))continue;const r=find(u.user_id);if(r){r.approved=true;if(!r.ids.includes(u.user_id))r.ids.push(u.user_id);r.name||=u.user_name||'';continue}rows.push({ids:[u.user_id],name:u.user_name||'',approved:true,listed:false})}
 for(const x of ownList(env,pf,conf)){if(x==='*'||isGroupId(x))continue;const r=find(x);if(r){r.listed=true;if(!r.ids.includes(x))r.ids.push(x)}else rows.push({ids:[x],name:'',approved:false,listed:true})}
 const bridgeOnlyList=isWa(pf)&&policyOf(env,pf,conf)!=='pairing';
 for(const r of rows){const all=new Set();for(const i of r.ids)for(const a of isWa(pf)?waAliases(i,mapping):[String(i)])all.add(a);r.id=shown(pf,r.ids[0],mapping);r.raw=r.ids[0];r.aliases=[...all].filter(a=>a!==r.id);
  // WhatsApp under a non-pairing policy: an approval that is not on the list does not get past the bridge
  r.blocked=bridgeOnlyList&&!r.listed}
 return rows}
// what the channel is like after taking this off: anyone can write, strangers can ask again, or nobody can reach it
function afterWords(before,env,pf,approved,mapping,conf){const np=newPeople(env,pf,conf),left=rowsOf(env,pf,approved,mapping,conf).filter(r=>!r.blocked).length+(isWa(pf)&&policyOf(env,pf,conf)!=='pairing'?0:split(env.GATEWAY_ALLOWED_USERS).filter(x=>x!=='*').length);
 if(np==='anyone'&&before!=='anyone')return 'Anyone can message it then.';
 if((np==='ask'||np==='silent')&&before!=='ask'&&before!=='silent')return 'New people can ask again then; they show under People waiting.';
 if(np!=='anyone'&&np!=='ask'&&np!=='silent'&&!left)return 'Nobody can message it then.';return ''}
const without=(env,key,rest,json)=>{const e={...env};if(rest.length)e[key]=formatList(rest,json);else delete e[key];return e};
// groups that may talk to the channel: not people, not changed here (its settings file and config.yaml hold them)
function groupsOf(env,pf,conf){const out=[];for(const k of Object.keys(env))if(new RegExp('^'+up(pf)+'_GROUP_ALLOWED_(USERS|CHATS)$').test(k)||k===up(pf)+'_GROUP_ALLOW_FROM')for(const x of split(env[k]))out.push({id:x,where:k});
 for(const k of ['group_allowed_chats','allowed_chats']){const v=cfgPf(conf,pf,k);for(const x of Array.isArray(v)?v:v!=null&&v!==''?[v]:[])out.push({id:String(x),where:'config.yaml '+k})}
 for(const x of ownList(env,pf,conf))if(isGroupId(x))out.push({id:x,where:listKey(pf)});return out}
// one channel's picture for Channels › Who can message; each row carries `after`, said in the confirm before removing it
export function channelWho(env,pf,approved=[],mapping,conf={}){const key=listKey(pf),{items:list,json}=parseList(env[key]),np=newPeople(env,pf,conf),rows=rowsOf(env,pf,approved,mapping,conf);
 for(const r of rows)r.after=afterWords(np,without(env,key,list.filter(x=>!r.ids.some(i=>samePerson(pf,x,i,mapping))),json),pf,approved.filter(u=>!(u.platform===pf&&!u.source&&r.ids.some(i=>samePerson(pf,u.user_id,i,mapping)))),mapping,conf);
 const star=list.includes('*');
 return {platform:pf,key,newPeople:np,words:POLICY_WORDS[np],star,starAfter:star?afterWords(np,without(env,key,list.filter(x=>x!=='*'),json),pf,approved,mapping,conf):'',
  allowAll:truthy(env[up(pf)+'_ALLOW_ALL_USERS']),policy:policyOf(env,pf,conf)||null,behavior:dmBehavior(env,pf,conf),groups:groupsOf(env,pf,conf),rows}}
// the list for every channel: one row per person (WhatsApp aliases merged), and what taking someone off leaves
export function globalWho(env,mapping,conf={}){const list=split(env.GATEWAY_ALLOWED_USERS),allowAll=allowAllEnv(env,conf),rows=[];
 for(const x of list){if(x==='*')continue;const r=rows.find(y=>y.ids.some(i=>samePerson('any',i,x,mapping)));if(r)r.ids.push(x);else rows.push({ids:[x]})}
 for(const r of rows){r.id=shown('whatsapp',r.ids[0],mapping)||r.ids[0];if(!/^\d+$/.test(r.id))r.id=r.ids[0];r.raw=r.ids[0];r.aliases=r.ids.filter(i=>i!==r.id)}
 return {list,rows,allowAll,star:list.includes('*'),after:allowAll&&rows.length===1?'With no list left, anyone may message every channel that has no list of its own.':''}}

/* ---------- Remove access ----------
   io.read() gives {env, approved, mapping, conf} read now; io.setList(key, fn) changes one list under the .env lock,
   computing from the value at that moment (fn(old) -> new, null = no change) and says whether it already applies (hot);
   io.revoke(platform, ids) removes real approvals (the pairing store's own, never the .env entries it also lists) in this
   agent's own store; io.mainEnv(), when given, reads the main agent's .env so the check can prove it was not touched.
   One row covers every alias and both sources. "Every channel" takes them off the list for every channel and off each
   channel's own list and approvals, as its dialog says. Afterwards everything is read again and every way in is checked.
   An ID must be one ID: '' (clear the whole list) only with clear:true on one channel, never on every channel. */
const LIST_KEY=/^([A-Z0-9_]+?)_ALLOWED_USERS$/;
export function checkId(id,{clear=false,every=false}={}){const s=String(id??'');if(s==='')return clear&&!every?null:'Say who to remove.';
 if(clear)return 'Clear takes no ID.';if(s!=='*'&&!/^[^\s,;"'[\]]{1,200}$/.test(s))return 'That is not one ID.';return null}
export async function removePerson(io,{pf,id,every=false,clear=false}){const bad=checkId(id,{clear,every});if(bad)throw Object.assign(new Error(bad),{status:400});
 const mainBefore=io.mainEnv?await io.mainEnv():null;
 const before=await io.read();const mp=before.mapping;let restart=false;
 const keys=every?Object.keys(before.env).filter(k=>LIST_KEY.test(k)&&!/_GROUP_ALLOWED_USERS$/.test(k)):[listKey(pf)];
 for(const k of keys){const kp=k==='GATEWAY_ALLOWED_USERS'?'any':k==='QQ_ALLOWED_USERS'?'qqbot':k.replace(/_ALLOWED_USERS$/,'').toLowerCase();
  const r=await io.setList(k,old=>{const {items,json}=parseList(old);const rest=clear?[]:id==='*'?items.filter(x=>x!=='*'):items.filter(x=>x==='*'||!samePerson(kp,x,id,mp));return rest.length===items.length?null:formatList(rest,json)});
  if(r?.changed&&!r.hot)restart=true}
 if(id&&id!=='*'){const by=new Map();for(const x of (before.approved||[]))if(!x.source&&!isGroupId(x.user_id)&&(every||x.platform===pf)&&samePerson(x.platform,x.user_id,id,mp))(by.get(x.platform)||by.set(x.platform,[]).get(x.platform)).push(x.user_id);
  for(const [p,ids] of by)await io.revoke(p,ids)}
 const after=await io.read(),e=after.env,m2=after.mapping,why=[];
 const on=(k,p)=>split(e[k]).some(x=>x!=='*'&&samePerson(p,x,id,m2));
 const pfs=every?[...new Set([...(after.approved||[]).filter(x=>!x.source).map(x=>x.platform),...Object.keys(e).filter(k=>LIST_KEY.test(k)&&k!=='GATEWAY_ALLOWED_USERS'&&!/_GROUP_/.test(k)).map(k=>k==='QQ_ALLOWED_USERS'?'qqbot':k.replace(/_ALLOWED_USERS$/,'').toLowerCase())])]:[pf];
 if(clear){if(split(e[listKey(pf)]).length)why.push('its list still has people on it')}
 else if(id==='*'){if((every?split(e.GATEWAY_ALLOWED_USERS):split(e[listKey(pf)])).includes('*'))why.push('the list still says *')}
 else{if(on('GATEWAY_ALLOWED_USERS','any'))why.push('they are on the list for every channel');
  for(const p of pfs){if(on(listKey(p),p))why.push('they are still on the '+p+' list');if((after.approved||[]).some(x=>x.platform===p&&!x.source&&samePerson(p,x.user_id,id,m2)))why.push('their '+p+' approval is still there')}
  if(!every)for(const p of pfs){if(split(e[listKey(p)]).includes('*')||split(e.GATEWAY_ALLOWED_USERS).includes('*'))why.push('the list says * (anyone)');if(truthy(e[up(p)+'_ALLOW_ALL_USERS']))why.push('its settings let anyone write')}}
 const mainTouched=mainBefore!=null&&(await io.mainEnv())!==mainBefore;if(mainTouched)why.push('the main agent’s settings file changed too');
 return {still:why.length>0,why:[...new Set(why)],restart,mainTouched}}
// what aqeelOS sends the engine after a list changed: only that list, never `enabled`, so a paused channel stays paused
// even when its state could not be read
export const engineChange=(key,val)=>val?{env:{[key]:val}}:{env:{},clear_env:[key]};
// a pairing store's approved file ({id: {user_name, approved_at}}) without every alias of one person
export function approvedWithout(data,pf,ids,mapping){const out={},gone=[];for(const [k,v] of Object.entries(data||{})){if(ids.some(i=>samePerson(pf,k,i,mapping)))gone.push(k);else out[k]=v}return {data:out,gone}}
