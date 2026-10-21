// People in aqeelOS: the owner (super admin, signs in with the original UI password), admins, and members
// invited by link. Members only reach the agents shared with them, their own chats and their own folder.
// Hermes itself is single-user, so every rule here is enforced in front of it, on this server.
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {scryptSync,randomBytes,timingSafeEqual,randomInt} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';

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
const MAX_OWN_AGENTS=5;
const PEOPLE_DIR=path.join(homedir(),'people');      // members' own folders: ~/people/<id>

export function createUsers(DATA,mail){
 const FILE=path.join(DATA,'users.json');
 let db=null;
 const load=async()=>{if(db)return db;try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}
  db.users||=[];db.invites||=[];db.shares||={};db.owners||={};db.agentOwners||={};db.roles||=JSON.parse(JSON.stringify(DEFAULT_ROLES));db.ownerName||='Aqeel';return db};
 // saves run one after another so two never share the .tmp file; a failed one still lets the next run
 let saving=Promise.resolve();
 const save=()=>{const p=saving.then(async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)});saving=p.catch(()=>{});return p};
 const hash=pw=>{const salt=randomBytes(16);return 'scrypt:'+salt.toString('hex')+':'+scryptSync(String(pw),salt,64).toString('hex')};
 const check=(pw,h)=>{const [k,s,x]=String(h||'').split(':');if(k!=='scrypt'||!s||!x)return false;const a=scryptSync(String(pw),Buffer.from(s,'hex'),64),b=Buffer.from(x,'hex');return a.length===b.length&&timingSafeEqual(a,b)};
 const norm=s=>String(s||'').trim().toLowerCase();
 const owner=()=>({id:'owner',name:db.ownerName,username:db.ownerUsername||'aqeel',role:'owner',avatar:db.ownerAvatar||null,email:db.ownerEmail||'',emailVerified:!!db.ownerEmailVerified,twoStep:!!db.ownerTwoStep});
 // write one field on a person (the owner's live at the top level of users.json)
 const setF=(u,k,v)=>{if(u.id==='owner')db['owner'+k[0].toUpperCase()+k.slice(1)]=v;else{const x=db.users.find(y=>y.id===u.id);if(x)x[k]=v}};
 const USERNAME=/^[a-z0-9][a-z0-9._-]{2,31}$/;
 const slugName=s=>norm(s).replace(/[^a-z0-9._-]+/g,'.').replace(/^[._-]+|[._-]+$/g,'').slice(0,32);
 const userTaken=(un,id)=>id!=='owner'&&norm(un)===norm(db.ownerUsername||'aqeel')||db.users.some(u=>u.id!==id&&norm(u.username)===norm(un));
 let envOwnerCheck=()=>false;   // the original UI_PASSWORD_HASH, until the owner picks a new password here
 const byId=id=>id==='owner'?owner():db.users.find(u=>u.id===id)||null;
 const isAdmin=u=>u&&(u.role==='owner'||u.role==='admin');
 const pub=u=>({id:u.id,name:u.name,username:u.username||'',email:u.email||'',emailVerified:!!u.emailVerified,twoStep:!!u.twoStep,role:u.role,created:u.created,last:u.last,avatar:u.avatar?'/ui/people/avatar/'+u.id+'?v='+encodeURIComponent(u.avatar):null});
 const AVATARS=path.join(DATA,'people-avatars');
 const ownerPwOk=pw=>db.ownerPw?check(pw,db.ownerPw):envOwnerCheck(pw);
 const nameTaken=(name,id)=>norm(name)===norm(db.ownerName)&&id!=='owner'||db.users.some(u=>u.id!==id&&norm(u.name)===norm(name));

 /* which agents a person can use, and how far */
 // Every agent has one owner (the person who made it; older agents belong to the owner of aqeelOS).
 // An agent owned by a member is private: admins see it listed but can open it only when it is shared with them.
 const agentOwner=a=>db.agentOwners[a]||'owner';
 const isPrivate=a=>{const o=byId(agentOwner(a));return !!o&&!isAdmin(o)};
 function level(u,agent){
  if(typeof agent==='string'&&agent.includes('--'))agent=agent.split('--')[0];   // a copy has its agent's rights
  if(agentOwner(agent)===u.id)return 'owner';const shared=(db.shares[agent]||{})[u.id]||null;
  if(isAdmin(u))return isPrivate(agent)?shared:'owner';return shared}
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
 const ownsAny=u=>Object.keys({...db.agentOwners,...db.shares}).some(a=>level(u,a)==='owner');
 const ownCount=u=>Object.values(db.agentOwners).filter(id=>id===u.id).length;
 // a deleted agent no longer counts against its owner's allowance; who owned it and who had it come back if it is restored
 async function dropAgent(a){await load();if(!(a in db.agentOwners)&&!db.shares[a])return;(db.goneAgents??={})[a]={owner:db.agentOwners[a],shares:db.shares[a]};delete db.agentOwners[a];delete db.shares[a];await save()}
 async function restoreAgent(a){await load();const g=db.goneAgents?.[a];if(!g)return;if(g.owner)db.agentOwners[a]=g.owner;if(g.shares)db.shares[a]=g.shares;delete db.goneAgents[a];await save()}

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
 async function login(name,pw,ownerCheck){await load();envOwnerCheck=ownerCheck;const n=norm(name);
  if(!n||n===norm(db.ownerName)||n===norm(db.ownerUsername||'aqeel')){if(ownerPwOk(pw))return owner()}
  const u=db.users.find(x=>norm(x.username)===n||norm(x.name)===n);if(u&&check(pw,u.pw)){u.last=Date.now();await save();return u}
  return null}
 async function user(id){await load();return byId(id)}

 /* ---------- chat ownership: sessions belong to whoever started them ---------- */
 async function own(sessionId,u){await load();if(!sessionId||db.owners[sessionId])return;db.owners[sessionId]=u.id;await save()}
 const ownerOf=id=>db.owners[id]||'owner';
 const mine=(u,id)=>ownerOf(id)===u.id;

 /* ---------- what a member may call ----------
    Returns null (allowed), or {status,error}. `agent` is the profile the call is for. */
 function gate(u,p,method,query,agent){
  const no=(error='You do not have access to that.')=>({status:403,error});
  // dictation: the box's own speech-to-text (it runs on the main agent's setup) turns anyone's voice into text, nothing more
  if(p==='/hapi/audio/transcribe'&&method==='POST')return null;
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
   if(query.has('profile')&&!atLeast(u,a,'chat'))return no('That agent is not shared with you.');
   if(G&&/^\/(status|profiles|sessions|sessions\/search)$/.test(rest))return null;
   const s=/^\/sessions\/([^/]+)(\/.*)?$/.exec(rest);
   if(s&&!['search','prune','bulk-delete','empty','import','stats'].includes(s[1]))return mine(u,decodeURIComponent(s[1]))?null:no('That chat is not yours.');
   if(/^\/files(\/(read|download|stream|mkdir|upload-stream))?$/.test(rest))return null; // path checked by the caller
   // agents
   if(rest==='/profiles'&&method==='POST')return !can(u,'create')?no('Ask the owner to let you create agents.'):ownCount(u)>=eff(u).maxAgents?no(eff(u).maxAgents?'You already have '+eff(u).maxAgents+' agents, your limit. Delete one first or ask the owner.':'Your role does not include making agents.'):null;
   if(rest==='/profiles/active'&&G)return null;   // which agent is the CLI default: read-only, fine for anyone signed in
   const pr=/^\/profiles\/([^/]+)(\/(soul|description|describe-auto|model))?$/.exec(rest);
   if(pr){const ag=decodeURIComponent(pr[1]);if(!pr[2])return method==='DELETE'?(atLeast(u,ag,'owner')?null:no('Only an owner of this agent can delete it.')):G&&atLeast(u,ag,'chat')?null:no();
    if(pr[3]==='model')return atLeast(u,ag,'edit')&&can(u,'models')?null:no();return atLeast(u,ag,'edit')?null:no('You can chat with this agent but not change it.')}
   // abilities on an agent this person can edit
   if(/^\/skills(\/(content|toggle))?$/.test(rest))return edit('skills');
   if(/^\/mcp\/servers(\/[^/]+(\/(enabled|test))?)?$/.test(rest))return edit('mcp');   // a command server needs "unsafe": checked on the body
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
   if(/^\/ui\/code\/(pair|devices|unpair|online|download\/(windows|mac))$/.test(p))return null;
   if(p==='/ui/files/search'||p==='/ui/files/exist'||p==='/ui/code/usage'||p.startsWith('/ui/bottlenecks')||p==='/ui/apps'||p.startsWith('/ui/apps/')||p==='/ui/defaults'||p==='/ui/code/app-version')return null;   // the handler keeps members inside their own folder
   return no()}
  return no()}
 // A member's file calls must stay inside ~/people/<id>.
 function filePathOk(u,fp){if(isAdmin(u))return true;const base=home(u);const r=path.resolve(String(fp||''));return r===base||r.startsWith(base+path.sep)}

 /* ---------- filtering what comes back ---------- */
 function filter(u,p,data,agent){
  if(!data||typeof data!=='object')return data;
  const keep=id=>mine(u,id);   // chats are private per person; untracked (older, Telegram…) chats are the owner's
  if(/^\/hapi\/sessions$/.test(p)&&Array.isArray(data.sessions)){const s=data.sessions.filter(x=>keep(x.id));return {...data,sessions:s,total:s.length}}
  if(/^\/hapi\/sessions\/search$/.test(p)&&Array.isArray(data.results))return {...data,results:data.results.filter(x=>keep(x.session_id||x.id))};
  if(/^\/hapi\/cron\/jobs$/.test(p)&&!isAdmin(u)){const jobs=Array.isArray(data)?data:data.jobs;if(Array.isArray(jobs)){const f=jobs.filter(j=>atLeast(u,j.profile||'default','edit')&&canOn(u,'schedules',j.profile||'default'));return Array.isArray(data)?f:{...data,jobs:f}}}
  // the hidden copies behind extra connections (WhatsApp 2…) are not agents of their own
  if(/^\/hapi\/profiles$/.test(p)&&Array.isArray(data.profiles))data={...data,profiles:data.profiles.filter(x=>!String(x.name).includes('--'))};
  if(/^\/hapi\/profiles$/.test(p)&&Array.isArray(data.profiles)&&!isAdmin(u))return {...data,profiles:data.profiles.filter(x=>level(u,x.name))};
  return data}

 /* ---------- the People page API (admins only) ---------- */
 async function api(u,req,res,p,send,readBody){
  await load();
  const body=async()=>{try{return JSON.parse(await readBody(req,8192))}catch{return {}}};
  if(p==='/ui/me'&&req.method==='GET'){const shares={};for(const a of new Set([...Object.keys(db.shares),...Object.keys(db.agentOwners)])){const l=level(u,a);if(l)shares[a]=l}return send(res,200,{...pub(u),admin:isAdmin(u),caps:isAdmin(u)?Object.keys(CAPS):eff(u).caps,role_name:isAdmin(u)?null:(eff(u).role==='custom'?'Custom':db.roles[eff(u).role]?.name),home:isAdmin(u)?homedir():home(u),agents:shares})}
  if(p==='/ui/me/password'&&req.method==='PUT'){const b=await body();const x=u.role==='owner'?null:db.users.find(y=>y.id===u.id);
   if(u.role==='owner'?!ownerPwOk(b.current):!x||!check(b.current,x.pw))return send(res,400,{error:'Your current password is not right.'});if(String(b.next||'').length<8)return send(res,400,{error:'Use at least 8 characters.'});
   if(x)x.pw=hash(b.next);else db.ownerPw=hash(b.next);await save();return send(res,200,{ok:true})}
  if(p==='/ui/me/email'&&req.method==='PUT'){const b=await body();const email=String(b.email||'').trim().toLowerCase();
   if(!email){setF(u,'email','');setF(u,'emailVerified',false);setF(u,'twoStep',false);await save();return send(res,200,{ok:true})}
   if(!EMAIL.test(email))return send(res,400,{error:'That email address does not look right.'});if([owner(),...db.users].some(x=>x.id!==u.id&&norm(x.email)===email))return send(res,400,{error:'Someone already uses that email.'});
   setF(u,'email',email);setF(u,'emailVerified',false);setF(u,'twoStep',false);await save();
   try{const key=await sendCode(u,'verify',email);return send(res,200,{ok:true,key})}catch(e){return send(res,502,{error:'Saved, but the code could not be sent: '+e.message})}}
  if(p==='/ui/me/email/resend'&&req.method==='POST'){const me=byId(u.id);if(!me.email)return send(res,400,{error:'Add an email first.'});try{return send(res,200,{ok:true,key:await sendCode(me,'verify',me.email)})}catch(e){return send(res,502,{error:'The code could not be sent: '+e.message})}}
  if(p==='/ui/me/email/verify'&&req.method==='POST'){const b=await body();const v=checkCode(String(b.key||''),b.code,'verify');if(v.error)return send(res,400,{error:v.error});
   if(v.uid!==u.id||norm(byId(u.id).email)!==v.email)return send(res,400,{error:'That code was for another address.'});setF(u,'emailVerified',true);await save();return send(res,200,{ok:true})}
  if(p==='/ui/me/two-step'&&req.method==='PUT'){const b=await body();const me=byId(u.id);if(b.on&&!me.emailVerified)return send(res,400,{error:'Confirm your email first.'});setF(u,'twoStep',!!b.on);await save();return send(res,200,{ok:true})}
  if(p==='/ui/me'&&req.method==='PUT'){const b=await body();const name=String(b.name||'').trim().slice(0,60);const un=norm(b.username);if(!name)return send(res,400,{error:'Your name is empty.'});if(nameTaken(name,u.id))return send(res,400,{error:'Someone already uses that name.'});
   if(!USERNAME.test(un))return send(res,400,{error:'Usernames are 3–32 characters: letters, numbers, dots, dashes or underscores.'});if(userTaken(un,u.id))return send(res,400,{error:'That username is taken.'});
   if(u.role==='owner'){db.ownerName=name;db.ownerUsername=un}else{const x=db.users.find(y=>y.id===u.id);x.name=name;x.username=un}await save();return send(res,200,{ok:true,name,username:un})}
  // profile pictures: sent as a data URL (PNG, JPG, WebP or GIF, under 2 MB)
  if(p==='/ui/me/avatar'&&(req.method==='PUT'||req.method==='DELETE')){const x=u.role==='owner'?null:db.users.find(y=>y.id===u.id);const cur=x?x.avatar:db.ownerAvatar;
   let file=null;
   if(req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,3e6))}catch{return send(res,413,{error:'Pictures must be under 2 MB.'})}const m=/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data||''));if(!m)return send(res,415,{error:'Use a PNG, JPG, WebP or GIF image.'});
    file=u.id+'-'+Date.now()+'.'+(m[1]==='jpeg'?'jpg':m[1]);await mkdir(AVATARS,{recursive:true});await writeFile(path.join(AVATARS,file),Buffer.from(m[2],'base64'))}
   if(x)x.avatar=file;else db.ownerAvatar=file;await save();if(cur&&cur!==file)await unlink(path.join(AVATARS,cur)).catch(()=>{});return send(res,200,{ok:true,avatar:file?'/ui/people/avatar/'+u.id+'?v='+file:null})}
  const av=/^\/ui\/people\/avatar\/([\w-]+)$/.exec(p);if(av&&req.method==='GET'){const x=byId(av[1]);if(!x?.avatar)return send(res,404,'No picture');
   try{const buf=await readFile(path.join(AVATARS,x.avatar));const ext=x.avatar.split('.').pop();res.writeHead(200,{'content-type':'image/'+(ext==='jpg'?'jpeg':ext),'cache-control':'private, max-age=86400','x-content-type-options':'nosniff'});return res.end(buf)}catch{return send(res,404,'No picture')}}
  if(p==='/ui/people/list'&&req.method==='GET')return send(res,200,[owner(),...db.users].map(x=>({id:x.id,name:x.name,username:x.username||db.ownerUsername||'aqeel',avatar:pub(x).avatar})));
  if(p==='/ui/agents'&&req.method==='GET'){const names=String(new URL(req.url,'http://x').searchParams.get('names')||'').split(',').filter(Boolean).slice(0,200);const out={};
   for(const a of names){const lv=level(u,a);if(!lv&&!isAdmin(u))continue;const o=byId(agentOwner(a))||owner();
    out[a]={access:lv,private:isPrivate(a),owner:{id:o.id,name:o.name,avatar:pub(o).avatar},shared:lv?Object.entries(db.shares[a]||{}).filter(([id])=>id!==o.id&&byId(id)).map(([id,l])=>{const x=byId(id);return {id,name:x.name,avatar:pub(x).avatar,level:l}}):[]}}
   return send(res,200,out)}
  const ag=/^\/ui\/agents\/([^/]+)\/(share|owner)$/.exec(p);
  if(ag&&req.method==='PUT'){const a=decodeURIComponent(ag[1]),b=await body();if(level(u,a)!=='owner')return send(res,403,{error:'Only the owner of this agent can change who has it.'});
   const to=byId(String(b.user||''));if(!to)return send(res,400,{error:'Unknown person'});
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
  if(p==='/ui/people'&&req.method==='GET')return send(res,200,{caps:CAPS,presets:PRESETS,owner:pub(owner()),roles:db.roles,users:db.users.map(x=>({...pub(x),roleId:x.roleId||'custom',caps:x.caps||[],models:x.models||null,limit:x.limit||null})),invites:db.invites.filter(i=>!i.used&&i.expires>Date.now()).map(i=>({code:i.code,name:i.name,role:i.role,agents:i.agents,expires:i.expires})),shares:db.shares});
  if(p==='/ui/people/invite'&&req.method==='POST'){const b=await body();if(b.roleId&&unsafeRole(b.roleId))return send(res,403,UNSAFE_ROLE);const role=b.role==='admin'&&u.role==='owner'?'admin':'member';
   const inv={code:randomBytes(18).toString('base64url'),name:String(b.name||'').trim().slice(0,60),role,roleId:b.roleId&&db.roles[b.roleId]?b.roleId:null,caps:(Array.isArray(b.caps)?b.caps:[]).filter(k=>k in CAPS&&(k!=='unsafe'||u.role==='owner')),agents:b.agents&&typeof b.agents==='object'?Object.fromEntries(Object.entries(b.agents).filter(([a])=>!isPrivate(a)||level(u,a)==='owner')):{},expires:Date.now()+7*864e5,by:u.id};
   // the agent made for them in this invite becomes theirs (private) when they accept, if the inviter still owns it then
   if(typeof b.ownAgent==='string'&&inv.agents[b.ownAgent]==='owner'&&agentOwner(b.ownAgent)===u.id)inv.ownAgent=b.ownAgent;db.invites.push(inv);await save();return send(res,200,inv)}
  const iv=/^\/ui\/people\/invite\/([\w-]+)$/.exec(p);if(iv&&req.method==='DELETE'){db.invites=db.invites.filter(i=>i.code!==iv[1]);await save();return send(res,200,{ok:true})}
  if(p==='/ui/people/share'&&req.method==='PUT'){const b=await body();const a=String(b.agent||''),id=String(b.user||'');if(!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(a)||!byId(id)||id==='owner')return send(res,400,{error:'Unknown agent or person'});
   // a private agent's people are its owner's to change (admins included)
   if(isPrivate(a)&&level(u,a)!=='owner')return send(res,403,{error:'Only the owner of this agent can change who has it.'});
   db.shares[a]||={};if(LEVELS.includes(b.level))db.shares[a][id]=b.level;else delete db.shares[a][id];await save();return send(res,200,{ok:true,shares:db.shares[a]})}
  const um=/^\/ui\/people\/([\w-]+)$/.exec(p);
  if(um&&req.method==='PATCH'){const x=db.users.find(y=>y.id===um[1]);if(!x)return send(res,404,{error:'Not found'});const b=await body();if(b.roleId&&b.roleId!==x.roleId&&unsafeRole(b.roleId))return send(res,403,UNSAFE_ROLE);if(b.name)x.name=String(b.name).trim().slice(0,60);if(b.role&&u.role==='owner'&&['admin','member'].includes(b.role))x.role=b.role;if('roleId' in b)x.roleId=b.roleId&&db.roles[b.roleId]?b.roleId:null;if(Array.isArray(b.caps))x.caps=b.caps.filter(k=>k in CAPS&&(k!=='unsafe'||u.role==='owner'));
   if('models' in b)x.models=Array.isArray(b.models)?b.models.map(String).slice(0,200):null;
   if('limit' in b)x.limit=b.limit&&+b.limit.tokens>0?{tokens:Math.round(+b.limit.tokens)}:null;await save();return send(res,200,pub(x))}
  if(um&&req.method==='DELETE'){const id=um[1],x=byId(id);
   // their private agents stay private: nobody gets them by default. Only the owner of aqeelOS can take them over, on purpose (?agents=take)
   const owns=Object.entries(db.agentOwners).filter(([,o])=>o===id).map(([a])=>a);
   if(owns.length&&x&&!isAdmin(x)){if(!(u.role==='owner'&&new URL(req.url,'http://x').searchParams.get('agents')==='take'))return send(res,409,{code:'owns-agents',agents:owns,error:x.name+' still owns '+owns.join(', ')+', private to them. They can give '+(owns.length>1?'those agents':'it')+' to someone under the agent’s menu › Sharing and owner.'});
    for(const a of owns)delete db.agentOwners[a]}
   db.users=db.users.filter(y=>y.id!==id);for(const a of Object.values(db.shares))delete a[id];await save();return send(res,200,{ok:true})}
  return send(res,404,{error:'Not found'})}

 /* ---------- accepting an invite (no sign-in yet) ---------- */
 async function inviteInfo(code){await load();const i=db.invites.find(x=>x.code===code&&!x.used&&x.expires>Date.now());return i?{name:i.name,role:i.role,username:slugName(i.name)}:null}
 async function accept(code,name,pw,username){await load();const i=db.invites.find(x=>x.code===code&&!x.used&&x.expires>Date.now());if(!i)throw new Error('This invite link has expired or was already used.');
  name=String(name||i.name||'').trim().slice(0,60);if(!name)throw new Error('Tell us your name.');if(String(pw||'').length<8)throw new Error('Use a password of at least 8 characters.');
  if(norm(name)===norm(db.ownerName)||db.users.some(u=>norm(u.name)===norm(name)))throw new Error('That name is taken. Try another.');
  const un=norm(username||slugName(name));if(!USERNAME.test(un))throw new Error('Pick a username of 3–32 characters: letters, numbers, dots, dashes or underscores.');if(userTaken(un,null))throw new Error('That username is taken. Try another.');
  const u={id:randomBytes(6).toString('hex'),name,username:un,role:i.role,roleId:i.roleId||null,caps:i.caps||[],pw:hash(pw),created:Date.now(),last:Date.now()};db.users.push(u);
  for(const [a,l] of Object.entries(i.agents||{}))if(LEVELS.includes(l)){db.shares[a]||={};db.shares[a][u.id]=l}
  if(i.ownAgent&&agentOwner(i.ownAgent)===i.by){db.agentOwners[i.ownAgent]=u.id;delete db.shares[i.ownAgent]?.[u.id]}
  i.used=Date.now();await save();await mkdir(home(u),{recursive:true}).catch(()=>{});return u}

 async function created(u,agent){await load();db.agentOwners[agent]=u.id;await save()}
 // models: null = any model the owner has enabled; otherwise a list of "provider|model" keys (or bare model ids)
 const modelOk=(u,provider,model)=>{if(isAdmin(u))return true;const l=eff(u).models;if(!l)return true;return l.includes(provider+'|'+model)||l.includes(model)};
 const allowedModels=u=>isAdmin(u)?null:eff(u).models;
 const limitOf=u=>isAdmin(u)?null:eff(u).limit;
 async function loginCode(u){const me=byId(u.id);return sendCode(me,'login',me.email)}
 function finishLogin(key,code){const v=checkCode(String(key||''),code,'login');if(v.error)return v;const u=byId(v.uid);return u?{ok:true,user:u}:{error:'That person no longer exists.'}}
 const expiredInvites=()=>(db?.invites||[]).filter(i=>!i.used&&i.expires<Date.now()&&i.expires>Date.now()-30*86400e3).map(i=>({code:i.code,name:i.name,role:i.role,roleId:i.roleId||null,caps:i.caps||[],agents:i.agents||{},ownAgent:i.ownAgent||null,expired:i.expires}));
 return {expiredInvites,agentOwner,byId,ownerOf,modelOk,allowedModels,limitOf,people:()=>[owner(),...db.users],loginCode,finishLogin,created,can,load,login,user,own,gate,filter,filePathOk,api,inviteInfo,accept,isAdmin,home,level,dropAgent,restoreAgent};
}
