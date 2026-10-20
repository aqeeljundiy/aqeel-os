// Asking for access (20 Oct 2026): every agent can see WHAT the other agents have (an app, a Google account, a
// plugin, a key: names only, never values), but not use it. To use one it asks: "get" (an agent, or a person who
// uses that agent, asks for something another agent owns) or "give" (an agent offers something it has to another
// agent). Either way an admin decides under Bottlenecks; "Allow" shares it through Access (the same as the switch
// under "Who can use"), "Decline" closes the request. Nothing is shared until an admin allows it.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

const KINDS={mcp:'app',google:'Google account',plugin:'plugin',key:'key'};
export function createAccessRequests({DATA,access,names,listAgents}){
 const FILE=path.join(DATA,'access-requests.json');let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.items||=[]}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)};
 // what the other agents have that this agent does not (names only)
 async function others(agent){const out=[];for(const kind of Object.keys(KINDS)){let l;try{l=await access.list(kind)}catch{continue}
  for(const it of l.items)if(!it.bot&&!it.own&&!it.users.some(u=>u.id===agent))out.push({kind,what:KINDS[kind],id:it.id,label:it.label,detail:kind==='key'?'':String(it.detail||'').slice(0,120),owner:it.owner,ownerName:it.ownerName})}
  return out}
 // what this agent has (to offer to another agent)
 async function mine(agent){const out=[];for(const kind of Object.keys(KINDS)){let l;try{l=await access.list(kind)}catch{continue}
  for(const it of l.items)if(!it.bot&&!it.own&&it.users.some(u=>u.id===agent))out.push({kind,what:KINDS[kind],id:it.id,label:it.label,owner:it.owner,ownerName:it.ownerName,users:it.users.map(u=>u.id)})}
  return out}
 // dir "get": `to` wants item; dir "give": `by` (who has it) offers it to `to`
 async function ask({kind,id,to,by,dir='get',why='',person=''}){if(!KINDS[kind])throw Error('Ask for an app, a Google account, a plugin or a key.');
  const agents=await listAgents();if(!agents.includes(to))throw Error('No agent called '+to+'.');
  const l=await access.list(kind);const it=l.items.find(x=>x.id===id||x.label===id);if(!it)throw Error('No '+KINDS[kind]+' called '+id+'. List what exists first.');
  if(it.bot)throw Error(it.label+' answers as one agent only, so it can’t be shared.');
  if(it.users.some(u=>u.id===to))return {already:true,text:names(to)+' can already use '+it.label+'.'};
  if(dir==='give'&&by&&!it.users.some(u=>u.id===by))throw Error(names(by)+' does not have '+it.label+', so it can’t offer it.');
  await load();let r=db.items.find(x=>!x.done&&x.kind===kind&&x.id===it.id&&x.to===to);
  if(r){r.count=(r.count||1)+1;r.updated=Date.now();if(why)r.why=String(why).slice(0,300)}
  else{r={rid:'q'+randomBytes(6).toString('hex'),kind,id:it.id,label:it.label,owner:it.owner,to,by:by||to,dir,why:String(why||'').slice(0,300),person:String(person||'').slice(0,80),created:Date.now(),updated:Date.now(),count:1};db.items.unshift(r);db.items=db.items.slice(0,300)}
  await save();return r}
 // the open ones, as Bottlenecks items
 async function open(mayUse=()=>true){await load();return db.items.filter(r=>!r.done&&(mayUse(r.to)||mayUse(r.by))).map(r=>({id:'access|'+r.rid,kind:'access',rid:r.rid,agent:r.to,agentName:names(r.to),
  title:r.dir==='give'?names(r.by)+' offers '+r.label+' to '+names(r.to):names(r.to)+' asks to use '+r.label,
  text:(r.dir==='give'?names(r.by)+' has this '+KINDS[r.kind]+' and thinks '+names(r.to)+' needs it.':'Owned by '+names(r.owner)+'. '+names(r.to)+' can see it exists but can’t use it yet.')+(r.person?' Asked by '+r.person+'.':'')+(r.why?' Why: '+r.why:''),req:r}))}
 async function decide(rid,ok,admin){await load();const r=db.items.find(x=>x.rid===rid&&!x.done);if(!r)throw Error('That request was already answered.');
  if(ok)await access.grant(r.kind,r.id,r.to);r.done=Date.now();r.ok=!!ok;r.decidedBy=admin||'';await save();return r}
 // what an agent's own requests came to (so it can tell the person)
 async function of(agent){await load();return db.items.filter(r=>r.to===agent||r.by===agent).slice(0,20)}
 return {others,mine,ask,open,decide,of,KINDS}}
