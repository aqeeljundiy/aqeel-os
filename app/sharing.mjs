// Sharing levels (Nov 2026): every resource an agent has (a connected account, a saved secret, later MCP tools,
// integrations, skills, schedules, bots) has exactly one owner agent, who can share it with other agents at a level,
// like a Google Drive file:
//   owner   - use, change settings, share at any level below owner, hand ownership over, delete
//   manager - use, change settings, share as editor or viewer (never manager/owner), take those shares away
//   editor  - use, including writing (send, create, change); cannot share
//   viewer  - read-only use
//   none    - the default: nothing
// One registry (DATA/sharing.json) decides; every place an action happens asks can() right then, so a change or a
// revoke counts on the very next call. Every change is written to the audit list (who, what, when; never a value).
// Off unless switched on (setting `enabled` in DATA/sharing.json, or SHARING_LEVELS=1): with it off nothing changes.
// Nothing here knows any user, agent or path: the caller passes DATA and the list of agents.
import {readStore,writeStore} from './store.mjs';
import {readFile,writeFile,rename,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';

export const LEVELS=['none','viewer','editor','manager','owner'];
export const rank=l=>Math.max(0,LEVELS.indexOf(String(l||'none').toLowerCase()));
export const TYPES=['account','secret','mcp','integration','skill','schedule','bot','agent'];   // agent: one agent looking after another (agent-access.mjs)
// the least level each action needs
export const NEEDS={read:'viewer',use:'viewer',write:'editor',send:'editor',create:'editor',settings:'manager',share:'manager',revoke:'manager',transfer:'owner',delete:'owner'};
export const AGENT=/^[a-z0-9][a-z0-9_-]{0,63}$/;
export const base=a=>String(a||'').split('--')[0];   // an agent's extra copies (name--2) count as the agent
export const key=(type,id)=>type+':'+id;

// may actor (at level `mine`) give `target` level `to`, when target now has `theirs`? (pure, tested)
export function mayShare(mine,to,theirs='none'){const m=rank(mine),t=rank(to),c=rank(theirs);
 if(m>=rank('owner'))return t<rank('owner')||{error:'Use transfer to make another agent the owner.'};
 if(m>=rank('manager')){if(t>rank('editor'))return {error:'A manager can share as editor or viewer only.'};if(c>rank('editor'))return {error:'A manager cannot change another manager or the owner.'};return true}
 return {error:'Only the owner or a manager can share this.'}}

export function createSharing({DATA,listAgents=async()=>[],now=()=>Date.now(),env=process.env,onChange=async()=>{}}={}){
 const FILE=path.join(DATA,'sharing.json');let db=null,mtime=0,chain=Promise.resolve();
 // read again when the file changed on disk (another process, or a person editing it), so a revoke is never stale
 async function load(){const st=await stat(FILE).catch(()=>null);if(db&&(!st||st.mtimeMs===mtime))return db;
  let d=await readStore(FILE);d.resources||={};d.audit||=[];db=d;mtime=st?.mtimeMs||0;return db}
 async function save(){await mkdir(DATA,{recursive:true});const t=FILE+'.'+process.pid+'.tmp';db.audit=db.audit.slice(-5000);
  await writeStore(FILE,JSON.stringify(db,null,1),{mode:0o600});mtime=(await stat(FILE)).mtimeMs}
 const serial=f=>{const r=chain.then(f,f);chain=r.catch(()=>{});return r};
 const log=(e)=>{db.audit.push({at:now(),...e})};
 async function enabled(){const d=await load();return env.SHARING_LEVELS==='1'||d.enabled===true}
 const actorOf=a=>typeof a==='object'&&a?a:{agent:base(a)};   // {agent} or {person, admin:true}
 const who=a=>a.agent?'agent:'+a.agent:'person:'+(a.person||'?');

 // the level an agent has on a resource (an admin person acts as the owner)
 async function levelOf(type,id,agent){const r=(await load()).resources[key(type,id)];if(!r)return 'none';const b=base(agent);
  if(r.owner===b)return 'owner';return LEVELS.includes(r.grants?.[b])?r.grants[b]:'none'}
 async function levelFor(type,id,actor){const a=actorOf(actor);if(a.admin)return 'owner';return levelOf(type,id,a.agent)}
 // can this agent do this action on this resource right now: {ok, level, need, why}
 async function check(type,id,agent,action){const need=NEEDS[action];if(!need)throw new Error('Unknown action '+action);const level=await levelOf(type,id,agent);
  const ok=rank(level)>=rank(need);return {ok,level,need,why:ok?'':(level==='none'?'This '+type+' is not shared with you.':'You have '+level+' access; this needs '+need+'.')}}
 const can=async(...a)=>(await check(...a)).ok;
 const exists=async(type,id)=>!!(await load()).resources[key(type,id)];

 // the first owner: whoever made or signed in to it; once set, only transfer changes it
 function claim(type,id,owner,{label='',by='system'}={}){return serial(async()=>{if(!TYPES.includes(type))throw new Error('Unknown type '+type);const o=base(owner);if(!AGENT.test(o))throw new Error('Bad agent name');
  await load();const k=key(type,id);if(db.resources[k])return {ok:true,existed:true,owner:db.resources[k].owner};
  db.resources[k]={type,id:String(id),label:String(label).slice(0,120),owner:o,grants:{},at:now()};log({k,op:'claim',by,owner:o});await save();await onChange(db.resources[k]);return {ok:true,owner:o}})}
 function share(type,id,actor,target,level){return serial(async()=>{const a=actorOf(actor),t=base(target),l=String(level||'').toLowerCase();
  if(!AGENT.test(t))throw new Error('Bad agent name');if(!LEVELS.includes(l)||l==='owner')throw new Error('Level must be manager, editor, viewer or none.');
  await load();const k=key(type,id),r=db.resources[k];if(!r)throw new Error('Nobody owns that yet.');if(r.owner===t)throw new Error('That agent is the owner.');
  const mine=a.admin?'owner':(r.owner===a.agent?'owner':r.grants[a.agent]||'none');const ok=mayShare(mine,l==='none'?'viewer':l,r.grants[t]||'none');if(ok!==true)throw Object.assign(new Error(ok.error),{status:403});
  const from=r.grants[t]||'none';if(l==='none')delete r.grants[t];else r.grants[t]=l;log({k,op:l==='none'?'revoke':'share',by:who(a),agent:t,from,to:l});await save();await onChange(r);return {ok:true,level:l,from}})}
 const revoke=(type,id,actor,target)=>share(type,id,actor,target,'none');
 function transfer(type,id,actor,target){return serial(async()=>{const a=actorOf(actor),t=base(target);if(!AGENT.test(t))throw new Error('Bad agent name');await load();const k=key(type,id),r=db.resources[k];if(!r)throw new Error('Nobody owns that yet.');
  if(!a.admin&&r.owner!==a.agent)throw Object.assign(new Error('Only the owner can hand it over.'),{status:403});const old=r.owner;delete r.grants[t];r.grants[old]='manager';r.owner=t;
  log({k,op:'transfer',by:who(a),from:old,to:t});await save();await onChange(r);return {ok:true,owner:t}})}
 function remove(type,id,actor){return serial(async()=>{const a=actorOf(actor);await load();const k=key(type,id),r=db.resources[k];if(!r)return {ok:true};
  if(!a.admin&&r.owner!==a.agent)throw Object.assign(new Error('Only the owner can delete it.'),{status:403});delete db.resources[k];log({k,op:'delete',by:who(a)});await save();await onChange({...r,deleted:true});return {ok:true}})}
 function setEnabled(on,by){return serial(async()=>{await load();db.enabled=!!on;log({op:on?'enable':'disable',by});await save();return {ok:true,enabled:db.enabled}})}
 // for the page: one resource with everyone's level, or all of one agent's
 async function get(type,id){const r=(await load()).resources[key(type,id)];return r?structuredClone(r):null}
 async function forAgent(agent){const b=base(agent),out=[];for(const r of Object.values((await load()).resources)){const l=r.owner===b?'owner':r.grants?.[b];if(l)out.push({type:r.type,id:r.id,label:r.label,owner:r.owner,level:l})}return out}
 async function list(type){return Object.values((await load()).resources).filter(r=>!type||r.type===type).map(r=>structuredClone(r))}
 async function audit({k,limit=200}={}){return (await load()).audit.filter(e=>!k||e.k===k).slice(-limit)}
 // a person's request: an admin acts as the owner; anyone else needs the agent they act for (handled by the route)
 return {enabled,setEnabled,levelOf,levelFor,check,can,exists,claim,share,revoke,transfer,remove,get,forAgent,list,audit,FILE}}

// connected accounts: what a level lets an agent do with a login (read, edit, draft, send: connected-accounts.mjs)
export const canOfLevel=l=>rank(l)>=rank('editor')?['read','edit','draft','send']:rank(l)>=rank('viewer')?['read']:[];

// saved secrets (the lock box, ~/workspaces/<agent>/.secrets/<NAME>): an agent's own, or one shared with it.
// resolve() says which file to use for an action, or why not. Without sharing on, only the agent's own.
export function createSecretAccess({sharing,secretDir,exists}){
 const id=(owner,name)=>base(owner)+'/'+name;
 async function resolve(agent,name,action='use'){const me=base(agent);
  if(await exists(path.join(secretDir(me),name)))return {ok:true,owner:me,file:path.join(secretDir(me),name),level:'owner'};
  if(!sharing||!await sharing.enabled())return {ok:false,why:'No saved secret called '+name+'.'};
  const hits=(await sharing.list('secret')).filter(r=>r.id.endsWith('/'+name));
  for(const r of hits){const c=await sharing.check('secret',r.id,me,action);if(c.ok)return {ok:true,owner:r.owner,file:path.join(secretDir(r.owner),name),level:c.level};
   if(c.level!=='none')return {ok:false,why:name+' is shared with you as '+c.level+'; this needs '+c.need+'.'}}
  return {ok:false,why:'No saved secret called '+name+'.'}}
 // a saved secret gets its owner the moment it is saved
 const saved=(agent,name)=>sharing?.claim('secret',id(agent,name),agent,{label:name,by:'agent:'+base(agent)});
 return {resolve,saved,id}}
