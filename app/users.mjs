// People in aqeelOS: the owner (super admin, signs in with the original UI password), admins, and members
// invited by link. Members only reach the agents shared with them, their own chats and their own folder.
// Hermes itself is single-user, so every rule here is enforced in front of it, on this server.
import {readFile,writeFile,mkdir,rename,unlink,copyFile} from 'node:fs/promises';
import {scryptSync,randomBytes,timingSafeEqual,randomInt,createHash} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {readPicture,emojiSlugs,AVATAR_TYPES} from './avatar-file.mjs';
import {HELP_AGENT} from './agentops.mjs';

export const LEVELS=['chat','edit','owner'];           // per-agent share levels, weakest first
// What a member may do beyond chatting. Admins can do everything. Each one only ever applies to agents
// the person can edit (their own, or shared with "Can edit" / "Owner").
export const CAPS={
 create:'Create their own agents',
 skills:'Add and edit skills',
 mcp:'Connect outside tools by URL (MCP)',
 schedules:'Make schedules',
 models:'Change an agent\'s model',
 tools:'Turn safe tools on or off on their agents',
 usage:'See account usage',
 unsafe:'Terminal, files and code tools on their agents',
};
export const PRESETS={member:[],creator:['create','skills','mcp','schedules','models','tools','usage']};
// Roles bundle what someone may do: permissions, which models, a daily limit and how many agents they may own.
// The owner defines them once (People › Roles) and gives each person one. "Custom" = per-person settings.
const DEFAULT_ROLES={member:{name:'Member',caps:[],models:null,limit:null,maxAgents:0},creator:{name:'Creator',caps:PRESETS.creator,models:null,limit:null,maxAgents:5}};
export const UNSAFE_TOOLSETS=['terminal','file','code_execution','computer_use'];
const PEOPLE_DIR=path.join(homedir(),'people');      // members' own folders: ~/people/<id>

// Signing in is by email (7 Nov 2026, the owner: "username not enough"). The username stays as a handle shown to others.
// For 14 days after this version first runs, the old username (or name) still signs in, and the page says to use the email
// next time; an account with no email keeps signing in by username until it adds one (the app asks at sign-in), so nobody
// is locked out. relaxed: a test copy (deploy checks), where the owner may still sign in with the password alone.
export function createUsers(DATA,mail,{ownerCheck,envOwner=()=>false,brandName=async()=>'aqeelOS',relaxed=true,ownerSeesAll=()=>false}={}){
 const hooks={};   // onJoin(person): the server makes their lead agent
 const FILE=path.join(DATA,'users.json');
 let db=null;
 const load=async()=>{if(db)return db;try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}
  db.users||=[];db.invites||=[];db.shares||={};db.owners||={};db.agentOwners||={};db.privateAgents||={};db.roles||=JSON.parse(JSON.stringify(DEFAULT_ROLES));db.leads||={};db.resets||=[];
  // the owner's name and username: chosen at first run (OWNER_NAME / OWNER_USERNAME, else neutral), then kept in users.json.
  // Older data had only a name; its username was the name in lower case, so sign-in keeps working
  let first=false;if(!db.ownerName){db.ownerName=String(process.env.OWNER_NAME||'').trim().slice(0,60)||'Owner';first=true}
  if(!db.ownerUsername){db.ownerUsername=slugName(process.env.OWNER_USERNAME||db.ownerName)||'owner';first=true}
  if(!db.emailLoginSince){db.emailLoginSince=Date.now();first=true}
  if(first)save().catch(()=>{});await applyEmailMoves();return db};
 /* A one-time list of sign-in emails to set, DATA/login-emails.json: {"<username, name or owner>":"email", ...}. Read once
    at start; users.json is copied first (users.json.bak-emails-<time>); each email set is taken as confirmed (whoever runs
    the box vouches for it), passwords and two-step stay as they are. The file becomes login-emails.done.json (the ones it could not place go to login-emails.left.json, logged). */
 async function applyEmailMoves(){const F=path.join(DATA,'login-emails.json');let m;try{m=JSON.parse(await readFile(F,'utf8'))}catch(e){if(e.code!=='ENOENT')console.warn('login-emails.json:',e.message);return}
  await copyFile(FILE,FILE+'.bak-emails-'+Date.now()).catch(e=>{if(e.code!=='ENOENT')throw e});const left={};let done=0;
  for(const [who,raw] of Object.entries(m||{})){const em=norm(raw),w=norm(who);
   const x=w==='owner'||w===norm(db.ownerName)||w===norm(db.ownerUsername)?owner():db.users.find(y=>norm(y.username)===w||norm(y.name)===w);
   if(!x||!EMAIL.test(em)||[owner(),...db.users].some(y=>y.id!==x.id&&norm(y.email)===em)){console.warn('login email not set for',who,!x?'(no such person)':'(bad or taken email)');left[who]=raw;continue}
   if(norm(x.email)!==em){setF(x,'email',em);setF(x,'emailVerified',true)}console.log('sign-in email for',x.id,'is',em);done++}
  await save();await rename(F,path.join(DATA,'login-emails.done.json'));if(Object.keys(left).length)await writeFile(path.join(DATA,'login-emails.left.json'),JSON.stringify(left,null,1));return done}
 // saves run one after another so two never share the .tmp file; a failed one still lets the next run
 let saving=Promise.resolve();
 const save=()=>{const p=saving.then(async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)});saving=p.catch(()=>{});return p};
 const hash=pw=>{const salt=randomBytes(16);return 'scrypt:'+salt.toString('hex')+':'+scryptSync(String(pw),salt,64).toString('hex')};
 const check=(pw,h)=>{const [k,s,x]=String(h||'').split(':');if(k!=='scrypt'||!s||!x)return false;const a=scryptSync(String(pw),Buffer.from(s,'hex'),64),b=Buffer.from(x,'hex');return a.length===b.length&&timingSafeEqual(a,b)};
 const norm=s=>String(s||'').trim().toLowerCase();
 const owner=()=>({id:'owner',name:db.ownerName,username:db.ownerUsername||'owner',role:'owner',avatar:db.ownerAvatar||null,avatarV:db.ownerAvatarV||null,emoji:db.ownerEmoji||null,email:db.ownerEmail||'',emailVerified:!!db.ownerEmailVerified,twoStep:!!db.ownerTwoStep});
 // write one field on a person (the owner's live at the top level of users.json)
 const setF=(u,k,v)=>{if(u.id==='owner')db['owner'+k[0].toUpperCase()+k.slice(1)]=v;else{const x=db.users.find(y=>y.id===u.id);if(x)x[k]=v}};
 const USERNAME=/^[a-z0-9][a-z0-9._-]{2,31}$/;
 const slugName=s=>norm(s).replace(/[^a-z0-9._-]+/g,'.').replace(/^[._-]+|[._-]+$/g,'').slice(0,32);
 const userTaken=(un,id)=>id!=='owner'&&norm(un)===norm(db.ownerUsername||'owner')||db.users.some(u=>u.id!==id&&norm(u.username)===norm(un));
 let envOwnerCheck=ownerCheck||(()=>false);   // the original UI_PASSWORD_HASH, until the owner picks a new password here (given at start, so it works before any sign-in)
 const byId=id=>id==='owner'?owner():db.users.find(u=>u.id===id)||null;
 const isAdmin=u=>u&&(u.role==='owner'||u.role==='admin');
 const pub=u=>({id:u.id,name:u.name,disabled:u.disabled||null,username:u.username||'',email:u.email||'',emailVerified:!!u.emailVerified,twoStep:!!u.twoStep,role:u.role,created:u.created,last:u.last,...face(u)});
 // a person's picture: their photo (versioned, so a new one shows at once) or their emoji; the initial is drawn in the browser
 const face=u=>({avatar:u.avatar?'/ui/people/avatar/'+u.id+'?v='+encodeURIComponent(u.avatarV||u.avatar):null,emoji:u.emoji||null});
 const AVATARS=path.join(DATA,'people-avatars');
 const ownerPwOk=pw=>db.ownerPw?check(pw,db.ownerPw):envOwnerCheck(pw);
 const nameTaken=(name,id)=>norm(name)===norm(db.ownerName)&&id!=='owner'||db.users.some(u=>u.id!==id&&norm(u.name)===norm(name));

 /* which agents a person can use, and how far */
 // Every agent has one owner (the person who made it; older agents belong to the owner of aqeelOS).
 // The rule (owner, 10 Nov 2026; one rule by role on every install, no setting): admins are partners and manage every agent,
 // the ones members (employees) own too. Members see only their own and what is shared with them. "Private" = owned by a
 // member: closed to other members, never to admins.
 // An admin may also make their own agent private (Edit agent › Sharing, 11 Nov 2026): then other admins open it only when
 // it is shared with them. Members cannot hide theirs from admins. The owner of aqeelOS still gets in, and each time is logged.
 const agentOwner=a=>db.agentOwners[a]||'owner';
 const isPrivate=a=>{const o=byId(agentOwner(a));return !!o&&!isAdmin(o)};
 const lockedByOwner=a=>{a=String(a||'').split('--')[0];if(!db.privateAgents?.[a])return false;const o=byId(agentOwner(a));return !!o&&isAdmin(o)};
 function level(u,agent){
  if(typeof agent==='string'&&agent.includes('--'))agent=agent.split('--')[0];   // a copy has its agent's rights
  // the owner of aqeelOS goes everywhere (as the gate lets them), so every check built on this sees them as an agent's owner
  if(agentOwner(agent)===u.id||u.role==='owner')return 'owner';const shared=(db.shares[agent]||{})[u.id]||null;
  if(isAdmin(u))return lockedByOwner(agent)?shared:'owner';return shared}
 // which agent a call is about, when it is about one
 function agentTarget(p,query,a){let m;if((m=/^\/gapi\/p\/([^/]+)/.exec(p)))return decodeURIComponent(m[1]);if(p.startsWith('/gapi/'))return 'default';
  if((m=/^\/hapi\/profiles\/([^/]+)/.exec(p)))return decodeURIComponent(m[1]);if(p.startsWith('/hapi/')&&query.has('profile')&&query.get('profile')!=='all')return a;
  if((m=/^\/ui\/screens\/([^/]+)/.exec(p)))return decodeURIComponent(m[1]);if((m=/^\/ui\/(identities|avatar)\/([^/]+)$/.exec(p)))return decodeURIComponent(m[2]);return null}
 const atLeast=(u,agent,want)=>{const l=level(u,agent);return !!l&&LEVELS.indexOf(l)>=LEVELS.indexOf(want)};
 const home=u=>path.join(PEOPLE_DIR,u.id);
 const eff=u=>{const x=byId(u.id)||u;const role=x.roleId&&db.roles[x.roleId];return role?{caps:role.caps||[],models:role.models||null,limit:role.limit||null,maxAgents:role.maxAgents??5,role:x.roleId}:{caps:x.caps||[],models:x.models||null,limit:x.limit||null,maxAgents:5,role:'custom'}};
 const can=(u,cap)=>isAdmin(u)||eff(u).caps.includes(cap);
 // An agent's owner manages its schedules, skills and connected apps whatever their role; the role decides what they
 // may do on agents others share with them, and everything beyond (making agents, models, tools, usage)
 const OWNER_CAPS=['schedules','skills','mcp'];
 const canOn=(u,cap,agent)=>can(u,cap)||OWNER_CAPS.includes(cap)&&level(u,agent)==='owner';
 // whose schedules (with their runbooks, results and costs) a person may see
 const schedOk=(u,agent)=>isAdmin(u)?!!level(u,agent):atLeast(u,agent,'edit')&&canOn(u,'schedules',agent);
 const ownsAny=u=>Object.keys({...db.agentOwners,...db.shares}).some(a=>level(u,a)==='owner');
 // agents being made right now count too: two quick New agent clicks both passed the limit before either was recorded
 // a person's lead agent is given by aqeelOS, so it does not count against their allowance
 const making=new Map(),ownCount=u=>Object.entries(db.agentOwners).filter(([a,id])=>id===u.id&&db.leads?.[u.id]!==a).length+(making.get(u.id)||0);
 // holds a place under the limit until the engine has answered (release); null when the limit is reached
 const reserve=u=>{if(ownCount(u)>=eff(u).maxAgents)return null;making.set(u.id,(making.get(u.id)||0)+1);let on=true;return ()=>{if(!on)return;on=false;const n=(making.get(u.id)||1)-1;n?making.set(u.id,n):making.delete(u.id)}};
 // a deleted agent no longer counts against its owner's allowance; who owned it and who had it come back if it is restored
 async function dropAgent(a){await load();if(!(a in db.agentOwners)&&!db.shares[a])return;(db.goneAgents??={})[a]={owner:db.agentOwners[a],shares:db.shares[a]};delete db.agentOwners[a];delete db.shares[a];await save()}
 async function restoreAgent(a){await load();const g=db.goneAgents?.[a];if(!g)return;if(g.owner)db.agentOwners[a]=g.owner;if(g.shares)db.shares[a]=g.shares;delete db.goneAgents[a];await save()}

 /* ---------- lead agents (Nov 2026): every person has one agent that leads their agents ----------
    The owner's lead is the main agent. A lead's power is its person's role, never more, read live on every call (so a
    promotion to admin gives it admin powers at once, a demotion takes them away): tier 'admin' (the owner and admins:
    everything, aqeelOS itself included) or 'member' (itself and the agents its person owns, within the role's limits). */
 const leadOf=id=>id==='owner'?(db.leads.owner||'default'):db.leads[id]||null;
 const leadPerson=a=>{a=String(a||'').split('--')[0];if(a===leadOf('owner'))return 'owner';return Object.entries(db.leads).find(([id,x])=>x===a&&id!=='owner')?.[0]||null};
 async function setLead(id,agent){await load();if(agent)db.leads[id]=agent;else delete db.leads[id];await save()}
 // whose power an agent acts with: its owner (the person who owns it); a person who no longer exists gives nothing
 function agentPerson(a){a=String(a||'').split('--')[0];const o=byId(agentOwner(a));return o||null}
 const tierOf=a=>{const o=agentPerson(a);return !o?'none':isAdmin(o)?'admin':'member'};
 // may agent `a` (acting for its person) manage agent `target`? admin tier: any; member tier: only the agents its person owns
 function agentMayManage(a,target){const o=agentPerson(a);if(!o)return false;if(isAdmin(o))return true;target=String(target||'').split('--')[0];return agentOwner(target)===o.id}
 // what an agent's tier allows, for the agent and its page (the role's own limits: caps, models, number of agents)
 function powerOf(a){const o=agentPerson(a);if(!o)return {tier:'none'};const admin=isAdmin(o),e=eff(o);
  return {tier:admin?'admin':'member',person:{id:o.id,name:o.name},lead:leadPerson(a)===o.id,role:admin?o.role:(e.role==='custom'?'custom':e.role),caps:admin?Object.keys(CAPS):e.caps,models:admin?null:e.models,maxAgents:admin?null:e.maxAgents,owns:Object.values(db.agentOwners).filter(x=>x===o.id).length}}
 // people without a lead yet (made before leads existed, or whose lead failed to be made); the owner's is the main agent
 const needLead=()=>db.users.filter(u=>!db.leads[u.id]);

 /* ---------- 6-digit codes by email: to confirm an address, and for two-step sign-in ---------- */
 const codes=new Map();   // key → {hash, exp, tries, uid, purpose, email}
 const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
 async function sendCode(u,purpose,email){const code=String(randomInt(100000,1000000));const key=randomBytes(16).toString('hex');
  codes.set(key,{hash:hash(code),exp:Date.now()+10*60e3,tries:0,uid:u.id,purpose,email});for(const [k,v] of codes)if(v.exp<Date.now())codes.delete(k);
  const what=purpose==='login'?'sign in to aqeelOS':'confirm this email for aqeelOS';
  await mail.deliver(email,code+' is your aqeelOS code',`Hi ${u.name},\n\nYour code to ${what} is:\n\n    ${code}\n\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email.\n\naqeelOS`);
  return key}
 function checkCode(key,code,purpose){const v=codes.get(key);if(!v||v.purpose!==purpose||v.exp<Date.now()){codes.delete(key);return {error:'That code expired. Ask for a new one.'}}
  if(++v.tries>5){codes.delete(key);return {error:'Too many tries. Ask for a new code.'}}
  if(!check(String(code||'').trim(),v.hash))return {error:'That code is not right.'};codes.delete(key);return {ok:true,uid:v.uid,email:v.email}}
 /* ---------- signing in ---------- */
 const GRACE=14*864e5;
 const graceOn=()=>Date.now()<(db.emailLoginSince||0)+GRACE;
 // email (any case, spaces trimmed) for everyone; a username or name only in the 14 days, or while that account has no email
 async function login(name,pw,ownerCheck){await load();if(ownerCheck)envOwnerCheck=ownerCheck;const n=norm(name);let x=null;
  if(n.includes('@'))x=[owner(),...db.users].find(y=>y.email&&norm(y.email)===n)||null;
  else if(!n)x=relaxed||graceOn()||!db.ownerEmail?owner():null;
  else{x=n===norm(db.ownerName)||n===norm(db.ownerUsername||'owner')?owner():db.users.find(y=>norm(y.username)===n||norm(y.name)===n)||null;if(x?.email&&!graceOn())x=null}
  if(!x)return null;if(x.id==='owner')return ownerPwOk(pw)?owner():null;
  if(x.disabled||!check(pw,x.pw))return null;x.last=Date.now();await save();return x}
 // after a sign-in: the quiet note when they used the old username
 const loginNote=(u,name)=>u?.email&&!norm(name).includes('@')?'Use your email next time: '+u.email:null;
 const emailOnly=()=>!graceOn();
 // a free username from an email's first part (or a name): sam, sam2, sam3...
 const freeHandle=(s,id=null)=>{let b=slugName(String(s||'').split('@')[0]);if(b.length<3)b=(b+'user').slice(0,8);b=b.slice(0,28);let un=b,i=2;while(userTaken(un,id))un=b+i++;return un};
 const emailFree=(em,id)=>![owner(),...db.users].some(y=>y.id!==id&&y.email&&norm(y.email)===em);
 // a suspended person's cookies stop working at once (they are also signed out), and they cannot sign in
 async function user(id){await load();const x=byId(id);return x&&!x.disabled?x:null}

 /* ---------- chat ownership: sessions belong to whoever started them ---------- */
 async function own(sessionId,u){await load();if(!sessionId||db.owners[sessionId])return;db.owners[sessionId]=u.id;await save()}
 const ownerOf=id=>db.owners[id]||'owner';
 // who opened this chat in aqeelOS, or null when aqeelOS never saw it opened (run_self judges on this, never a default)
 const sessionOwner=id=>db.owners[id]||null;
 const mine=(u,id)=>ownerOf(id)===u.id;
 // a chat a member (employee) started: admins may read it
 const memberChat=id=>{const p=byId(sessionOwner(id));return !!p&&!isAdmin(p)};

 /* ---------- what a member may call ----------
    Returns null (allowed), or {status,error}. `agent` is the profile the call is for. */
 function gate(u,p,method,query,agent){
  const no=(error='You do not have access to that.')=>({status:403,error});
  // dictation: the box's own speech-to-text (it runs on the main agent's setup) turns anyone's voice into text, nothing more
  if(p==='/hapi/audio/transcribe'&&method==='POST')return null;
  // the owner of aqeelOS is never locked out of an agent, whoever holds it now
  if(u.role==='owner')return null;
  if(isAdmin(u)){const t=agentTarget(p,query,agent||'default');return t&&!level(u,t)&&!(method==='GET'&&/^\/ui\/(identities|avatar\/[^/]+)$/.test(p))?no('This agent is private to its owner. Ask them to share it.'):null}
  const a=agent||'default';
  if(p.startsWith('/gapi/')){
   if(!atLeast(u,a,'chat'))return no('That agent is not shared with you.');
   const rest=p.replace(/^\/gapi(\/p\/[^/]+)?/,'');
   if(/^\/api\/model\/options$|^\/v1\/models$/.test(rest)&&method==='GET')return null;
   if(rest==='/api/sessions'&&method==='POST')return null;
   const s=/^\/api\/sessions\/([^/]+)/.exec(rest);if(s)return mine(u,decodeURIComponent(s[1]))?null:no('That chat is not yours.');
   if(/^\/v1\/runs\/[^/]+\/(stop|approval|steer|events)$|^\/v1\/runs\/[^/]+$/.test(rest))return null;
   return no()}
  if(p.startsWith('/hapi/')){
   const rest=p.slice(5),G=method==='GET';
   const edit=(cap,msg)=>!atLeast(u,a,'edit')?no('You can chat with this agent but not change it.'):cap&&!canOn(u,cap,a)?no(msg||'You are not allowed to do that yet. Ask the owner.'):null;
   // every schedule list across agents: allowed, then filtered to the agents this person can edit
   if(G&&rest==='/cron/jobs'&&query.get('profile')==='all')return can(u,'schedules')||ownsAny(u)?null:no();
   // the agent list is trimmed to theirs (filter), whichever agent the page asks it through
   if(G&&rest==='/profiles')return null;
   // making an agent acts on no existing agent, whichever agent the page asks through: a member with none yet can make one
   if(rest==='/profiles'&&method==='POST')return !can(u,'create')?no('Ask the owner to let you create agents.'):ownCount(u)>=eff(u).maxAgents?no(eff(u).maxAgents?'You already have '+eff(u).maxAgents+' agents, your limit. Delete one first or ask the owner.':'Your role does not include making agents.'):null;
   if(query.has('profile')&&!atLeast(u,a,'chat'))return no('That agent is not shared with you.');
   if(G&&/^\/(status|profiles|sessions|sessions\/search)$/.test(rest))return null;
   const s=/^\/sessions\/([^/]+)(\/.*)?$/.exec(rest);
   if(s&&!['search','prune','bulk-delete','empty','import','stats'].includes(s[1]))return mine(u,decodeURIComponent(s[1]))?null:no('That chat is not yours.');
   if(/^\/files(\/(read|download|stream|mkdir|upload-stream))?$/.test(rest))return null; // path checked by the caller
   // agents
   if(rest==='/profiles/active'&&G)return null;   // which agent is the CLI default: read-only, fine for anyone signed in
   const pr=/^\/profiles\/([^/]+)(\/(soul|description|describe-auto|model))?$/.exec(rest);
   if(pr){const ag=decodeURIComponent(pr[1]);if(!pr[2])return method==='DELETE'?(atLeast(u,ag,'owner')?null:no('Only an owner of this agent can delete it.')):G&&atLeast(u,ag,'chat')?null:no();
    if(pr[3]==='model')return atLeast(u,ag,'edit')&&can(u,'models')?null:no();return atLeast(u,ag,'edit')?null:no('You can chat with this agent but not change it.')}
   // abilities on an agent this person can edit
   if(/^\/skills(\/(content|toggle))?$/.test(rest))return edit('skills');
   if(/^\/mcp\/servers(\/[^/]+(\/(enabled|test))?)?$/.test(rest))return edit('mcp');   // a command server needs "unsafe": checked on the body
   // a sign-in's progress and the catalog, on agents they can connect tools to; a catalog install is checked like adding a server
   if(G&&(/^\/mcp\/oauth\/flows\/[^/]+$/.test(rest)||rest==='/mcp/catalog')||rest==='/mcp/catalog/install'&&method==='POST')return edit('mcp');
   if(/^\/tools\/toolsets$/.test(rest)&&G)return edit();
   const ts=/^\/tools\/toolsets\/([^/]+)$/.exec(rest);if(ts&&method==='PUT')return edit(UNSAFE_TOOLSETS.includes(decodeURIComponent(ts[1]))?'unsafe':'tools',UNSAFE_TOOLSETS.includes(decodeURIComponent(ts[1]))?'Terminal, files and code tools are only for admins.':'Your role does not include turning tools on or off.');
   if(/^\/cron\/jobs(\/[^/]+(\/(pause|resume|trigger|runs))?)?$/.test(rest))return edit('schedules');
   if(/^\/cron\/(delivery-targets|blueprints(\/instantiate)?)$/.test(rest))return edit('schedules');
   if(rest==='/model/set'&&method==='POST')return edit('models');
   if(rest==='/model/info'&&G)return null;
   if(/^\/memory(\/.*)?$/.test(rest))return atLeast(u,a,'owner')?null:no('Only an owner of this agent can see its memory.');
   return no()}
  if(p.startsWith('/ui/')){
   if(method==='GET'&&/^\/ui\/(identities|avatar\/[^/]+|logo)$/.test(p))return null;
   if(p==='/ui/accounts'&&method==='GET')return can(u,'usage')?null:no();
   if(/^\/ui\/(identities|avatar)\/([^/]+)$/.test(p))return atLeast(u,decodeURIComponent(p.split('/')[3]),'edit')?null:no('You can chat with this agent but not change it.');
   if(p.startsWith('/ui/screens')||p==='/ui/screen/browser')return atLeast(u,a,'chat')?null:no();
   // Code on their own computer: pair it, see and unpair their computers, download the app (online projects are for admins)
   // "Open in Code" links (the handler checks the person may chat with the agent that made it)
   if(/^\/ui\/code\/(pair|devices|unpair|online|handoff|download\/(windows|mac))$/.test(p))return null;
   if(p==='/ui/supervision'&&method==='GET')return null;   // the team must be able to learn that admins can review chats
   if(p==='/ui/files/search'||p==='/ui/files/exist'||p==='/ui/code/usage'||p.startsWith('/ui/bottlenecks')||p==='/ui/apps'||p.startsWith('/ui/apps/')||p==='/ui/defaults'||p==='/ui/code/app-version')return null;   // the handler keeps members inside their own folder
   return no()}
  return no()}
 // A member's file calls must stay inside ~/people/<id>. A change (delete, rename, write) is for what is in it, never the folder itself.
 function filePathOk(u,fp,change){if(isAdmin(u))return true;const base=home(u);const r=path.resolve(String(fp||''));return !change&&r===base||r.startsWith(base+path.sep)}

 /* ---------- filtering what comes back ---------- */
 function filter(u,p,data,agent){
  if(!data||typeof data!=='object')return data;
  // chats are private per person; untracked (older, Telegram…) chats are the owner's. With Team view on, the owner's list has everyone's, each marked with whose it is
  // an admin's list also has every member's chats (the rule above), marked the same way
  const seeAll=u.role==='owner'&&ownerSeesAll(),staff=isAdmin(u)&&u.role!=='owner',keep=id=>seeAll||mine(u,id)||staff&&memberChat(id);
  const mark=x=>{const o=seeAll||staff?sessionOwner(x.session_id||x.id):null;return o&&o!==u.id?{...x,person:byId(o)?.name||'Someone'}:x};
  if(/^\/hapi\/sessions$/.test(p)&&Array.isArray(data.sessions)){inherit(data.sessions);const s=data.sessions.filter(x=>keep(x.id)).map(mark);return {...data,sessions:s,total:s.length}}
  if(/^\/hapi\/sessions\/search$/.test(p)&&Array.isArray(data.results)){inherit(data.results);return {...data,results:data.results.filter(x=>keep(x.session_id||x.id)).map(mark)}}
  // schedules: an admin sees every agent's but a private one's (as the gate does), a member those they may change
  if(/^\/hapi\/cron\/jobs$/.test(p)){const jobs=Array.isArray(data)?data:data.jobs;if(Array.isArray(jobs)){const f=jobs.filter(j=>schedOk(u,j.profile||'default'));return Array.isArray(data)?f:{...data,jobs:f}}}
  // the hidden copies behind extra connections (WhatsApp 2…) are not agents of their own
  // nor is Help's profile: it belongs to nobody's agent list (help.mjs)
  if(/^\/hapi\/profiles$/.test(p)&&Array.isArray(data.profiles))data={...data,profiles:data.profiles.filter(x=>!String(x.name).includes('--')&&x.name!==HELP_AGENT)};
  if(/^\/hapi\/profiles$/.test(p)&&Array.isArray(data.profiles)&&!isAdmin(u))return {...data,profiles:data.profiles.filter(x=>level(u,x.name))};
  return data}
 // a continuation (compacted chat, reset) or a fork made outside aqeelOS belongs to whoever owns the chat it came
 // from; recorded, so opening it passes the same check. Cron runs: the job's creator is not recorded, so they stay the owner's.
 function inherit(list){let n=0;const par=new Map(list.map(x=>[x.session_id||x.id,x.parent_session_id]));
  for(const x of list){const id=x.session_id||x.id;if(!id||db.owners[id])continue;let up=x.parent_session_id;for(let i=0;up&&i<20&&!db.owners[up];i++)up=par.get(up);
   if(up&&db.owners[up]){db.owners[id]=db.owners[up];n++}}
  if(n)save().catch(()=>{})}

 /* ---------- the People page API (admins only) ---------- */
 async function api(u,req,res,p,send,readBody){
  await load();
  const body=async()=>{try{return JSON.parse(await readBody(req,8192))}catch{return {}}};
  if(p==='/ui/me'&&req.method==='GET'){const shares={};for(const a of new Set([...Object.keys(db.shares),...Object.keys(db.agentOwners)])){const l=level(u,a);if(l)shares[a]=l}return send(res,200,{...pub(u),admin:isAdmin(u),caps:isAdmin(u)?Object.keys(CAPS):eff(u).caps,role_name:isAdmin(u)?null:(eff(u).role==='custom'?'Custom':db.roles[eff(u).role]?.name),home:isAdmin(u)?homedir():home(u),...(u.role==='owner'?{recovery:!!db.ownerRecovery}:{}),...(isAdmin(u)?{hermes_home:process.env.HERMES_HOME||path.join(homedir(),'.hermes'),workspaces:path.join(homedir(),'workspaces')}:{}),agents:shares,canMake:isAdmin(u)||can(u,'create')&&ownCount(u)<eff(u).maxAgents,lead:(l=>l&&(isAdmin(u)||shares[l])?l:null)(leadOf(u.id))})}   // lead: their own lead agent, once it is made (pages fall back to it)
  if(p==='/ui/me/password'&&req.method==='PUT'){const b=await body();const x=u.role==='owner'?null:db.users.find(y=>y.id===u.id);
   if(u.role==='owner'?!ownerPwOk(b.current):!x||!check(b.current,x.pw))return send(res,400,{error:'Your current password is not right.'});if(String(b.next||'').length<8)return send(res,400,{error:'Use at least 8 characters.'});
   if(x)x.pw=hash(b.next);else db.ownerPw=hash(b.next);await save();return send(res,200,{ok:true})}
  // turning two-step off and changing or clearing a set email (which turns it off) take the current password, like a new password does
  const pwOk=pw=>u.role==='owner'?ownerPwOk(pw):check(pw,db.users.find(y=>y.id===u.id)?.pw);const PW_BAD={error:'Your current password is not right.'};
  if(p==='/ui/me/email'&&req.method==='PUT'){const b=await body();const email=String(b.email||'').trim().toLowerCase();if(byId(u.id)?.email&&!pwOk(b.current))return send(res,400,PW_BAD);
   if(!email)return send(res,400,{error:'You sign in with your email, so it can be changed but not removed.'});
   if(!EMAIL.test(email))return send(res,400,{error:'That email address does not look right.'});if([owner(),...db.users].some(x=>x.id!==u.id&&norm(x.email)===email))return send(res,400,{error:'Someone already uses that email.'});
   setF(u,'email',email);setF(u,'emailVerified',false);setF(u,'twoStep',false);await save();
   try{const key=await sendCode(u,'verify',email);return send(res,200,{ok:true,key})}catch(e){return send(res,502,{error:'Saved, but the code could not be sent: '+e.message})}}
  if(p==='/ui/me/email/resend'&&req.method==='POST'){const me=byId(u.id);if(!me.email)return send(res,400,{error:'Add an email first.'});try{return send(res,200,{ok:true,key:await sendCode(me,'verify',me.email)})}catch(e){return send(res,502,{error:'The code could not be sent: '+e.message})}}
  if(p==='/ui/me/email/verify'&&req.method==='POST'){const b=await body();const v=checkCode(String(b.key||''),b.code,'verify');if(v.error)return send(res,400,{error:v.error});
   if(v.uid!==u.id||norm(byId(u.id).email)!==v.email)return send(res,400,{error:'That code was for another address.'});setF(u,'emailVerified',true);await save();return send(res,200,{ok:true})}
  if(p==='/ui/me/two-step'&&req.method==='PUT'){const b=await body();const me=byId(u.id);if(b.on&&!me.emailVerified)return send(res,400,{error:'Confirm your email first.'});if(!b.on&&me.twoStep&&!pwOk(b.current))return send(res,400,PW_BAD);setF(u,'twoStep',!!b.on);await save();return send(res,200,{ok:true})}
  // the owner's recovery code: a new one (the old one stops working), shown once; takes the current password
  if(p==='/ui/me/recovery'&&req.method==='POST'){if(u.role!=='owner')return send(res,403,{error:'Only the owner has a recovery code. An admin can set a new password for you.'});const b=await body();if(!pwOk(b.current))return send(res,400,PW_BAD);const c=newRecovery();await save();return send(res,200,{ok:true,code:c})}
  if(p==='/ui/me'&&req.method==='PUT'){const b=await body();const name=String(b.name||'').trim().slice(0,60);const un=norm(b.username);if(!name)return send(res,400,{error:'Your name is empty.'});if(nameTaken(name,u.id))return send(res,400,{error:'Someone already uses that name.'});
   if(!USERNAME.test(un))return send(res,400,{error:'Usernames are 3–32 characters: letters, numbers, dots, dashes or underscores.'});if(userTaken(un,u.id))return send(res,400,{error:'That username is taken.'});
   if(u.role==='owner'){db.ownerName=name;db.ownerUsername=un}else{const x=db.users.find(y=>y.id===u.id);x.name=name;x.username=un}await save();return send(res,200,{ok:true,name,username:un})}
  // your own picture only (/ui/me: nobody sets another person's). A photo arrives as the bytes of the browser's 256x256
  // crop, checked like agents' (avatar-file.mjs), one file per person; an emoji from the same set. Each replaces the other
  if(p==='/ui/me/avatar'&&(req.method==='PUT'||req.method==='DELETE')){const cur=byId(u.id)?.avatar;let file=null;
   if(req.method==='PUT'){const r=await readPicture(req);if(r.error)return send(res,r.status,{error:r.error});
    file=u.id+'.'+r.ext;await mkdir(AVATARS,{recursive:true});await writeFile(path.join(AVATARS,file+'.tmp'),r.buf);await rename(path.join(AVATARS,file+'.tmp'),path.join(AVATARS,file));setF(u,'emoji',null)}
   setF(u,'avatar',file);setF(u,'avatarV',file?Date.now():null);await save();if(cur&&cur!==file)await unlink(path.join(AVATARS,cur)).catch(()=>{});return send(res,200,{ok:true,...face(byId(u.id))})}
  if(p==='/ui/me/emoji'&&req.method==='PUT'){const b=await body();const e=String(b.emoji||'');if(e&&!(await emojiSlugs()).includes(e))return send(res,400,{error:'Pick one of the listed emoji.'});
   const cur=byId(u.id)?.avatar;if(e&&cur){await unlink(path.join(AVATARS,cur)).catch(()=>{});setF(u,'avatar',null);setF(u,'avatarV',null)}setF(u,'emoji',e||null);await save();return send(res,200,{ok:true,...face(byId(u.id))})}
  const av=/^\/ui\/people\/avatar\/([\w-]+)$/.exec(p);if(av&&req.method==='GET'){const x=byId(av[1]);if(!x?.avatar)return send(res,404,'No picture');
   try{const buf=await readFile(path.join(AVATARS,x.avatar));const ext=x.avatar.split('.').pop();res.writeHead(200,{'content-type':AVATAR_TYPES[ext]||'image/'+ext,'cache-control':'private, max-age=86400','x-content-type-options':'nosniff'});return res.end(buf)}catch{return send(res,404,'No picture')}}
  if(p==='/ui/people/list'&&req.method==='GET')return send(res,200,[owner(),...db.users].map(x=>({id:x.id,name:x.name,username:x.username||db.ownerUsername||'owner',...face(x)})));
  if(p==='/ui/agents'&&req.method==='GET'){const names=String(new URL(req.url,'http://x').searchParams.get('names')||'').split(',').filter(Boolean).slice(0,200);const out={};
   for(const a of names){const lv=level(u,a);if(!lv&&!isAdmin(u))continue;const o=byId(agentOwner(a))||owner();
    const iv=db.invites.find(i=>!i.used&&i.expires>Date.now()&&i.ownAgent===a&&agentOwner(a)===i.by);
    const lp=leadPerson(a);out[a]={access:lv,private:isPrivate(a)||lockedByOwner(a),privateOn:lockedByOwner(a),canPrivate:isAdmin(u)&&agentOwner(a)===u.id,invitee:iv?{name:iv.name}:null,tier:tierOf(a),lead:lp?{id:lp,name:byId(lp)?.name||''}:null,owner:{id:o.id,name:o.name,...face(o)},shared:lv?Object.entries(db.shares[a]||{}).filter(([id])=>id!==o.id&&byId(id)).map(([id,l])=>{const x=byId(id);return {id,name:x.name,...face(x),level:l}}):[]}}
   return send(res,200,out)}
  const pv=/^\/ui\/agents\/([^/]+)\/private$/.exec(p);
  if(pv&&req.method==='PUT'){const a=decodeURIComponent(pv[1]),b=await body();
   if(agentOwner(a)!==u.id||!isAdmin(u))return send(res,403,{error:'Only its owner can make this agent private, and only an admin’s agent can be private from admins.'});
   if(b.on)db.privateAgents[a]=true;else delete db.privateAgents[a];await save();console.log('agent',a,b.on?'made private':'no longer private','by',u.id);return send(res,200,{ok:true,private:!!b.on})}
  const ag=/^\/ui\/agents\/([^/]+)\/(share|owner)$/.exec(p);
  if(ag&&req.method==='PUT'){const a=decodeURIComponent(ag[1]),b=await body();if(level(u,a)!=='owner')return send(res,403,{error:'Only the owner of this agent can change who has it.'});
   const to=byId(String(b.user||''));if(!to)return send(res,400,{error:'Unknown person'});
   // handing the agent over is for its real owner (or the owner of aqeelOS), not someone shared it at "Owner": taking an
   // admin's agent would make it private and lock every admin out
   if(ag[2]==='owner'&&agentOwner(a)!==u.id&&u.role!=='owner')return send(res,403,{error:'Only the person who owns this agent can give it to someone else.'});
   if(ag[2]==='owner'&&!isAdmin(u)&&to.id===u.id&&isAdmin(byId(agentOwner(a))))return send(res,403,{error:'This agent belongs to an admin. Ask them to give it to you.'});
   if(ag[2]==='share'){if(to.id===agentOwner(a))return send(res,400,{error:'They already own it.'});db.shares[a]||={};if(LEVELS.includes(b.level))db.shares[a][to.id]=b.level;else delete db.shares[a][to.id]}
   else{const prev=agentOwner(a);db.agentOwners[a]=to.id;db.shares[a]||={};delete db.shares[a][to.id];if(prev!==to.id&&byId(prev))db.shares[a][prev]='edit'}
   await save();return send(res,200,{ok:true})}
  if(!isAdmin(u))return send(res,403,{error:'Only admins can manage people.'});
  // a role with terminal, file and code access is the owner's to hand out, like those permissions themselves
  const unsafeRole=id=>u.role!=='owner'&&!!id&&(db.roles[id]?.caps||[]).includes('unsafe');
  const UNSAFE_ROLE={error:'Only the owner can give a role that includes terminal, file and code access.'};
  const rl=/^\/ui\/roles(?:\/([\w-]+))?$/.exec(p);
  if(rl){const id=rl[1];const clean=b=>({name:String(b.name||'Role').trim().slice(0,40)||'Role',caps:(Array.isArray(b.caps)?b.caps:[]).filter(k=>k in CAPS&&(k!=='unsafe'||u.role==='owner')),models:Array.isArray(b.models)?b.models.map(String).slice(0,200):null,limit:b.limit&&+b.limit.tokens>0?{tokens:Math.round(+b.limit.tokens)}:null,maxAgents:Math.max(0,Math.min(50,+b.maxAgents||0))});
   if(!id&&req.method==='POST'){const b=await body();let k=String(b.name||'role').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'role';while(db.roles[k])k+='-2';db.roles[k]=clean(b);await save();return send(res,200,{id:k,...db.roles[k]})}
   if(id&&req.method==='PUT'){if(!db.roles[id])return send(res,404,{error:'Unknown role'});const keep=unsafeRole(id),r=clean({...db.roles[id],...await body()});
    // an admin editing an owner-made role keeps its terminal, file and code access as the owner set it
    if(keep&&!r.caps.includes('unsafe'))r.caps.push('unsafe');db.roles[id]={...db.roles[id],...r};await save();return send(res,200,db.roles[id])}
   if(id&&req.method==='DELETE'){if(db.users.some(x=>x.roleId===id)||db.invites.some(i=>!i.used&&i.expires>Date.now()&&i.roleId===id))return send(res,409,{error:'Someone or a waiting invite still has this role. Change them first.'});delete db.roles[id];await save();return send(res,200,{ok:true})}}
  if(p==='/ui/mail'&&req.method==='GET')return send(res,200,await mail.settings());
  if(p==='/ui/mail'&&req.method==='PUT'){await mail.update(await body());return send(res,200,await mail.settings())}
  if(p==='/ui/mail/test'&&req.method==='POST'){const b=await body();try{const r=await mail.deliver(String(b.to||'').trim(),'aqeelOS test email','This is a test from aqeelOS. If you can read it, email works.');return send(res,200,{ok:true,reply:r})}catch(e){return send(res,502,{error:e.message})}}
  const ie=/^\/ui\/people\/invite\/([\w-]+)\/email$/.exec(p);if(ie&&req.method==='POST'){const b=await body();const i=db.invites.find(x=>x.code===ie[1]&&!x.used);if(!i)return send(res,404,{error:'That invite is gone.'});
   try{await mail.deliver(String(b.to||'').trim(),(byId(u.id)?.name||'Someone')+' invited you to aqeelOS',`Hi${i.name?' '+i.name:''},\n\n${byId(u.id)?.name||'Someone'} invited you to aqeelOS. Open this link to pick a username and password:\n\n${String(b.link||'')}\n\nThe link works once and expires in 7 days.`);return send(res,200,{ok:true})}catch(e){return send(res,502,{error:e.message})}}
  if(p==='/ui/people'&&req.method==='GET')return send(res,200,{caps:CAPS,presets:PRESETS,owner:pub(owner()),roles:db.roles,users:db.users.map(x=>({...pub(x),lead:db.leads[x.id]||null,roleId:x.roleId||'custom',caps:x.caps||[],models:x.models||null,limit:x.limit||null})),invites:db.invites.filter(i=>!i.used&&i.expires>Date.now()).map(i=>({code:i.code,name:i.name,role:i.role,agents:i.agents,expires:i.expires})),expired:expiredInvites(),shares:db.shares});
  if(p==='/ui/people/invite'&&req.method==='POST'){const b=await body();if(b.roleId&&unsafeRole(b.roleId))return send(res,403,UNSAFE_ROLE);const role=b.role==='admin'&&u.role==='owner'?'admin':'member';
   const inv={code:randomBytes(18).toString('base64url'),name:String(b.name||'').trim().slice(0,60),role,roleId:b.roleId&&db.roles[b.roleId]?b.roleId:null,caps:(Array.isArray(b.caps)?b.caps:[]).filter(k=>k in CAPS&&(k!=='unsafe'||u.role==='owner')),agents:b.agents&&typeof b.agents==='object'?Object.fromEntries(Object.entries(b.agents).filter(([a])=>!(isPrivate(a)||lockedByOwner(a))||level(u,a)==='owner')):{},expires:Date.now()+7*864e5,by:u.id,...(EMAIL.test(norm(b.email))?{email:norm(b.email)}:{})};
   // the agent made for them in this invite becomes theirs (private) when they accept, if the inviter still owns it then
   if(typeof b.ownAgent==='string'&&inv.agents[b.ownAgent]==='owner'&&(agentOwner(b.ownAgent)===u.id||isAdmin(u)&&!(b.ownAgent in db.agentOwners)))inv.ownAgent=b.ownAgent;
   // "Also make them their own agent" unticked: no lead agent is made for them when they join (7 Nov 2026)
   if(b.noLead===true&&role!=='admin')inv.noLead=true;db.invites.push(inv);await save();return send(res,200,inv)}
  const iv=/^\/ui\/people\/invite\/([\w-]+)$/.exec(p);if(iv&&req.method==='DELETE'){db.invites=db.invites.filter(i=>i.code!==iv[1]);await save();return send(res,200,{ok:true})}
  if(p==='/ui/people/share'&&req.method==='PUT'){const b=await body();const a=String(b.agent||''),id=String(b.user||'');if(!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(a)||!byId(id)||id==='owner')return send(res,400,{error:'Unknown agent or person'});
   // a private agent's people are its owner's to change (admins included); an admin's own agent made Private too (AUDIT-2,
   // 11 Nov 2026: another admin could share it with themselves or put it in an invite, then open it)
   if((isPrivate(a)||lockedByOwner(a))&&level(u,a)!=='owner')return send(res,403,{error:'Only the owner of this agent can change who has it.'});
   db.shares[a]||={};if(LEVELS.includes(b.level))db.shares[a][id]=b.level;else delete db.shares[a][id];await save();return send(res,200,{ok:true,shares:db.shares[a]})}
  const um=/^\/ui\/people\/([\w-]+)$/.exec(p);
  // admins are the owner's to change or remove, not each other's
  if(um&&(req.method==='PATCH'||req.method==='DELETE')&&isAdmin(byId(um[1]))&&u.role!=='owner')return send(res,403,{error:'Only the owner can change or remove an admin.'});
  // an admin's tools for someone locked out or leaving: a new password, signing them out, suspending them (owner: never)
  const pa=/^\/ui\/people\/([\w-]+)\/(password|signout|suspend|two-step-off|email)$/.exec(p);
  if(pa&&req.method==='POST'){const x=db.users.find(y=>y.id===pa[1]);if(!x)return send(res,404,{error:'Not found'});
   if(x.id===u.id)return send(res,400,{error:'Use your own profile for that.'});if(isAdmin(x)&&u.role!=='owner')return send(res,403,{error:'Only the owner can change an admin.'});
   const b=await body();
   if(pa[2]==='password'){const pw=String(b.password||'');if(pw.length<8)return send(res,400,{error:'Use at least 8 characters.'});x.pw=hash(pw);if(b.twoStepOff)x.twoStep=false;await save();await hooks.revoke?.(x.id);console.log('password set for',x.id,'by',u.id);return send(res,200,{ok:true})}
   if(pa[2]==='two-step-off'){x.twoStep=false;await save();return send(res,200,{ok:true})}
   // their sign-in email, set by an admin (not confirmed until they confirm it; two-step is off until then)
   if(pa[2]==='email'){const em=norm(b.email);if(!EMAIL.test(em))return send(res,400,{error:'That email address does not look right.'});if(!emailFree(em,x.id))return send(res,400,{error:'Someone already uses that email.'});
    if(norm(x.email)!==em){x.email=em;x.emailVerified=false;x.twoStep=false;await save()}console.log('sign-in email changed for',x.id,'by',u.id);return send(res,200,{ok:true,email:em})}
   if(pa[2]==='signout'){await hooks.revoke?.(x.id);console.log('signed out everywhere:',x.id,'by',u.id);return send(res,200,{ok:true})}
   if(pa[2]==='suspend'){if(b.on){x.disabled=Date.now();await save();await hooks.revoke?.(x.id)}else{delete x.disabled;await save()}console.log(b.on?'suspended':'unsuspended',x.id,'by',u.id);return send(res,200,pub(x))}}
  const rn=/^\/ui\/people\/invite\/([\w-]+)\/renew$/.exec(p);
  if(rn&&req.method==='POST'){const i=db.invites.find(x=>x.code===rn[1]&&!x.used);if(!i)return send(res,404,{error:'That invite is gone.'});if(i.roleId&&unsafeRole(i.roleId))return send(res,403,UNSAFE_ROLE);
   i.expires=Date.now()+7*864e5;await save();return send(res,200,{ok:true,code:i.code,expires:i.expires})}
  if(um&&req.method==='PATCH'){const x=db.users.find(y=>y.id===um[1]);if(!x)return send(res,404,{error:'Not found'});const b=await body();if(b.roleId&&b.roleId!==x.roleId&&unsafeRole(b.roleId))return send(res,403,UNSAFE_ROLE);if(b.name)x.name=String(b.name).trim().slice(0,60);if(b.role&&u.role==='owner'&&['admin','member'].includes(b.role))x.role=b.role;if('roleId' in b)x.roleId=b.roleId&&db.roles[b.roleId]?b.roleId:null;if(Array.isArray(b.caps))x.caps=b.caps.filter(k=>k in CAPS&&(k!=='unsafe'||u.role==='owner'));
   if('models' in b)x.models=Array.isArray(b.models)?b.models.map(String).slice(0,200):null;
   if('limit' in b)x.limit=b.limit&&+b.limit.tokens>0?{tokens:Math.round(+b.limit.tokens)}:null;await save();return send(res,200,pub(x))}
  if(um&&req.method==='DELETE'){const id=um[1],x=byId(id);
   // their private agents stay private: nobody gets them by default. Only the owner of aqeelOS can take them over, on purpose (?agents=take)
   const owns=Object.entries(db.agentOwners).filter(([,o])=>o===id).map(([a])=>a);
   if(owns.length&&x&&!isAdmin(x)){if(!(u.role==='owner'&&new URL(req.url,'http://x').searchParams.get('agents')==='take'))return send(res,409,{code:'owns-agents',agents:owns,error:x.name+' still owns '+owns.join(', ')+', private to them. They can give '+(owns.length>1?'those agents':'it')+' to someone under Edit agent › Sharing.'});
    for(const a of owns)delete db.agentOwners[a]}
   db.users=db.users.filter(y=>y.id!==id);delete db.leads[id];for(const a of Object.values(db.shares))delete a[id];await save();return send(res,200,{ok:true})}
  return send(res,404,{error:'Not found'})}

 /* ---------- accepting an invite (no sign-in yet) ---------- */
 async function inviteInfo(code){await load();const i=db.invites.find(x=>x.code===code&&!x.used&&x.expires>Date.now());return i?{name:i.name,role:i.role,username:slugName(i.name),email:i.email||''}:null}
 async function accept(code,name,pw,username,email){await load();const i=db.invites.find(x=>x.code===code&&!x.used&&x.expires>Date.now());if(!i)throw new Error('This invite link has expired or was already used.');
  name=String(name||i.name||'').trim().slice(0,60);if(!name)throw new Error('Tell us your name.');if(String(pw||'').length<8)throw new Error('Use a password of at least 8 characters.');
  if(norm(name)===norm(db.ownerName)||db.users.some(u=>norm(u.name)===norm(name)))throw new Error('That name is taken. Try another.');
  const em=norm(email);if(em&&!EMAIL.test(em))throw new Error('That email address does not look right.');if(em&&!emailFree(em,null))throw new Error('Someone already uses that email. Sign in instead.');
  const un=username?norm(username):freeHandle(em||name);if(!USERNAME.test(un))throw new Error('Pick a username of 3–32 characters: letters, numbers, dots, dashes or underscores.');if(userTaken(un,null))throw new Error('That username is taken. Try another.');
  const u={id:randomBytes(6).toString('hex'),name,username:un,...(em?{email:em,emailVerified:false}:{}),role:i.role,roleId:i.roleId||null,caps:i.caps||[],pw:hash(pw),created:Date.now(),last:Date.now()};db.users.push(u);
  for(const [a,l] of Object.entries(i.agents||{}))if(LEVELS.includes(l)){db.shares[a]||={};db.shares[a][u.id]=l}
  if(i.ownAgent&&agentOwner(i.ownAgent)===i.by){db.agentOwners[i.ownAgent]=u.id;delete db.shares[i.ownAgent]?.[u.id];db.leads[u.id]=i.ownAgent}
  i.used=Date.now();await save();await mkdir(home(u),{recursive:true}).catch(()=>{});
  // every new person gets a lead agent (the server makes it, in the background: the engine takes a while)
  if(!db.leads[u.id]&&!i.noLead)Promise.resolve(hooks.onJoin?.(u)).catch(e=>console.warn('lead agent for',u.id,e.message));return u}

 // a new agent starts with no shares: ones left under that name (shared before it existed, or from an older agent) go
 async function created(u,agent){await load();db.agentOwners[agent]=u.id;delete db.shares[agent];await save()}
 // models: null = any model the owner has enabled; otherwise a list of "provider|model" keys (or bare model ids)
 const modelOk=(u,provider,model)=>{if(isAdmin(u))return true;const l=eff(u).models;if(!l)return true;return l.includes(provider+'|'+model)||l.includes(model)};
 const allowedModels=u=>isAdmin(u)?null:eff(u).models;
 const limitOf=u=>isAdmin(u)?null:eff(u).limit;
 async function loginCode(u){const me=byId(u.id);return sendCode(me,'login',me.email)}
 function finishLogin(key,code){const v=checkCode(String(key||''),code,'login');if(v.error)return v;const u=byId(v.uid);return u&&!u.disabled?{ok:true,user:u}:{error:'That person no longer exists.'}}
 const expiredInvites=()=>(db?.invites||[]).filter(i=>!i.used&&i.expires<Date.now()&&i.expires>Date.now()-30*86400e3).map(i=>({code:i.code,name:i.name,role:i.role,roleId:i.roleId||null,caps:i.caps||[],agents:i.agents||{},ownAgent:i.ownAgent||null,expired:i.expires}));
 /* ---------- first run: no owner password anywhere yet (no UI_PASSWORD_HASH, none saved here) ---------- */
 const needsOwner=async()=>{await load();return !db.ownerPw&&!envOwner()};
 // the first person to open a new install makes the owner account; it signs them in and gives them a recovery code
 async function createOwner(name,email,pw){await load();if(db.ownerPw||envOwner())throw Object.assign(new Error('This install already has an owner. Sign in instead.'),{status:409});
  name=String(name||'').trim().slice(0,60);const em=norm(email);
  if(!name)throw new Error('Tell us your name.');if(!EMAIL.test(em))throw new Error('Enter your email address. You sign in with it.');
  if(!emailFree(em,'owner'))throw new Error('Someone already uses that email.');if(String(pw||'').length<8)throw new Error('Use a password of at least 8 characters.');
  db.ownerName=name;db.ownerUsername=freeHandle(em,'owner');db.ownerEmail=em;db.ownerEmailVerified=false;db.ownerPw=hash(pw);const code=newRecovery();await save();return {user:owner(),recovery:code}}
 /* ---------- the owner's recovery code: signs in once without the password or two-step, then a new one is made ---------- */
 const RC='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 function newRecovery(){let c='';for(let i=0;i<20;i++)c+=RC[randomInt(RC.length)];c=c.match(/.{5}/g).join('-');db.ownerRecovery=hash(c);return c}
 const rcNorm=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/(.{5})(?=.)/g,'$1-');
 async function makeRecovery(){await load();const c=newRecovery();await save();return c}
 // a right code sets the new password, turns two-step off (the email may be what is lost) and is used up
 async function recoverOwner(code,pw){await load();if(!db.ownerRecovery||!check(rcNorm(code),db.ownerRecovery))return {error:'That recovery code is not right.'};
  if(String(pw||'').length<8)return {error:'Use a password of at least 8 characters.',keep:true};
  db.ownerPw=hash(pw);db.ownerTwoStep=false;const next=newRecovery();await save();return {ok:true,user:owner(),recovery:next}}
 /* ---------- "Forgot password": a one-hour link to a confirmed email ---------- */
 const tokHash=t=>createHash('sha256').update(String(t)).digest('hex');
 const sweep=()=>{db.resets=db.resets.filter(r=>r.exp>Date.now())};
 // always the same answer, so nobody learns which names or emails exist here
 async function forgot(who,link){await load();const n=norm(who);if(!n)return;sweep();
  const x=[owner(),...db.users].find(y=>!y.disabled&&(norm(y.username)===n||norm(y.name)===n||y.email&&norm(y.email)===n));
  if(!x||!x.email||!x.emailVerified){console.log('password reset asked for an unknown or unconfirmed address');return}
  if(db.resets.filter(r=>r.uid===x.id).length>=3)return;
  const tok=randomBytes(24).toString('base64url');db.resets.push({h:tokHash(tok),uid:x.id,exp:Date.now()+3600e3});await save();const bn=await brandName();
  await mail.deliver(x.email,'Reset your '+bn+' password',`Hi ${x.name},\n\nSomeone asked to reset your ${bn} password. Open this link to pick a new one:\n\n${link(tok)}\n\nIt works once, for one hour. If you didn't ask, you can ignore this email: your password stays as it is.\n\n${bn}`)}
 async function resetInfo(tok){await load();sweep();const r=db.resets.find(y=>y.h===tokHash(tok));const x=r&&byId(r.uid);return x&&!x.disabled?{name:x.name,username:x.username||''}:null}
 async function finishReset(tok,pw){await load();sweep();const r=db.resets.find(y=>y.h===tokHash(tok));const x=r&&byId(r.uid);if(!x||x.disabled)return {error:'This reset link has expired or was already used. Ask for a new one.'};
  if(String(pw||'').length<8)return {error:'Use a password of at least 8 characters.'};
  if(x.id==='owner')db.ownerPw=hash(pw);else db.users.find(y=>y.id===x.id).pw=hash(pw);db.resets=db.resets.filter(y=>y.uid!==x.id);await save();return {ok:true,user:byId(x.id)}}
 return {needsOwner,createOwner,makeRecovery,recoverOwner,forgot,resetInfo,finishReset,hooks,leadOf,leadPerson,setLead,agentPerson,tierOf,agentMayManage,powerOf,needLead,face,expiredInvites,agentOwner,byId,ownerOf,sessionOwner,memberChat,lockedByOwner,modelOk,allowedModels,limitOf,people:()=>[owner(),...db.users],loginNote,emailOnly,applyEmailMoves,loginCode,finishLogin,created,reserve,can,canOn,load,login,user,own,gate,filter,filePathOk,api,inviteInfo,accept,isAdmin,home,level,atLeast,schedOk,dropAgent,restoreAgent};
}
