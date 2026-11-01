// Who can message (1 Nov 2026): the engine lets someone message a channel when any of these holds (gateway/authz_mixin.py):
// that channel's "anyone" switch (<PF>_ALLOW_ALL_USERS), an approval in its pairing store (approving also copies them into
// the allowlist), its allowlist (<PF>_ALLOWED_USERS, "*" = anyone), the list for every channel (GATEWAY_ALLOWED_USERS), or,
// with no list at all, GATEWAY_ALLOW_ALL_USERS. New people either ask (pairing), or get no answer once a list exists or
// the channel's DM policy says allowlist (WHATSAPP_DM_POLICY). These parts only decide; they are tested in
// scripts/allowlist.test.mjs and used by server.mjs for Channels › Who can message.
export const split=s=>[...new Set(String(s??'').trim().replace(/^["']|["']$/g,'').split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean))];
export const truthy=v=>/^(1|true|yes|on)$/i.test(String(v??'').trim().replace(/^["']|["']$/g,''));
// one person, however the ID is written (a WhatsApp number may carry @s.whatsapp.net or a :device part)
export const samePerson=(pf,a,b)=>pf==='whatsapp'?String(a).split('@')[0].split(':')[0].replace(/\D/g,'')===String(b).split('@')[0].split(':')[0].replace(/\D/g,''):String(a).toLowerCase()===String(b).toLowerCase();
export const listKey=pf=>String(pf).toUpperCase()+'_ALLOWED_USERS';
// the list once one person is taken off: '' clears it, '*' takes only the "anyone" mark off, else every way that ID is written
export function removeFrom(list,pf,id){if(id==='')return [];if(id==='*')return list.filter(x=>x!=='*');return list.filter(x=>x==='*'||!samePerson(pf,x,id))}
// a .env file's values (the last line wins, comments skipped)
export function parseEnv(text){const o={};for(const l of String(text||'').split('\n')){const m=/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(l);if(m)o[m[1]]=m[2].trim().replace(/^(["'])(.*)\1$/,'$2')}return o}
// what a channel lets new people do: 'anyone', 'ask' (they ask and wait for an OK) or 'ignored'
function newPeople(env,pf,list,global){
 if(truthy(env[String(pf).toUpperCase()+'_ALLOW_ALL_USERS'])||list.includes('*')||global.includes('*')||(!list.length&&!global.length&&truthy(env.GATEWAY_ALLOW_ALL_USERS)))return 'anyone';
 const pol=String(env[String(pf).toUpperCase()+'_DM_POLICY']||'').toLowerCase();
 if(pol==='open')return 'anyone';if(pol==='pairing')return 'ask';if(pol==='allowlist'||pol==='disabled')return 'ignored';
 if(pf==='email')return 'ignored';return list.length||global.length?'ignored':'ask'}
export const POLICY_WORDS={anyone:'Anyone who finds this channel can message it.',ask:'New people ask first and wait for your OK under People waiting.',ignored:'Only the people below. Anyone else gets no answer and can’t ask.'};
// one channel's picture: who may message it now (approved, on its list, or both), and what new people get. A row says
// `last` when taking it off leaves nobody able to reach the channel and nobody able to ask.
export function channelWho(env,pf,approved=[]){const key=listKey(pf),list=split(env[key]),global=split(env.GATEWAY_ALLOWED_USERS),rows=[];
 for(const u of approved){if(u.platform!==pf)continue;const r=rows.find(x=>samePerson(pf,x.id,u.user_id));if(r){r.approved=true;r.name||=u.user_name||'';continue}rows.push({id:String(u.user_id).split('@')[0].split(':')[0],raw:u.user_id,name:u.user_name||'',approved:true,listed:false})}
 for(const x of list){if(x==='*')continue;const r=rows.find(y=>samePerson(pf,y.raw||y.id,x));if(r)r.listed=true;else rows.push({id:x,raw:x,name:'',approved:false,listed:true})}
 const np=newPeople(env,pf,list,global),allowAll=truthy(env[String(pf).toUpperCase()+'_ALLOW_ALL_USERS']);
 for(const r of rows)r.last=np==='ignored'&&rows.length===1&&!global.length;
 return {platform:pf,key,newPeople:np,words:POLICY_WORDS[np],star:list.includes('*'),allowAll,policy:String(env[String(pf).toUpperCase()+'_DM_POLICY']||'').toLowerCase()||null,rows}}
// Remove access, with the reading and writing handed in (server.mjs gives the agent's .env and the engine): read now (never a
// cached copy, so a number the WhatsApp loop guard took off is not written back), take them off the list (this channel's or
// every channel's) and out of the approved list, then read again and say whether they still can message.
export async function removePerson(io,{pf,id,every=false}){const before=await io.read();let restart=false;
 if(every){const l=split(before.env.GATEWAY_ALLOWED_USERS),r=removeFrom(l,pf,id);if(r.length!==l.length){await io.setGlobal(r);restart=true}}
 else{const k=listKey(pf),l=split(before.env[k]),r=removeFrom(l,pf,id);if(r.length!==l.length&&!await io.setList(k,r))restart=true;
  if(id&&id!=='*')for(const x of (before.approved||[]).filter(x=>x.platform===pf&&samePerson(pf,x.user_id,id)))await io.revoke(x.user_id)}
 const after=await io.read(),list=split(every?after.env.GATEWAY_ALLOWED_USERS:after.env[listKey(pf)]);
 const still=id===''?list.length>0:id==='*'?list.includes('*'):list.some(x=>x!=='*'&&samePerson(pf,x,id))||(!every&&(after.approved||[]).some(x=>x.platform===pf&&samePerson(pf,x.user_id,id)));
 return {still,restart}}
