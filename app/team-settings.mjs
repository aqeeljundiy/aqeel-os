// Plug and play (7 Nov 2026): what a new owner used to set by editing files on the box, now set on System › Teams.
//   - the team policy (DATA/team-policy.json): the owner, the teams, their members and contact, which agents each team
//     covers, and the fixer (on or off, which agent fixes, daily cap, minutes per run). Read by issues.mjs,
//     escalations.mjs, agent-live.mjs and agent-care through issues.policy(), so a save counts at once.
//   - where owner alerts go (DATA/alerts.json {target:{channel, chat}}); with nothing set, the main agent's own chat;
//     with no channel at all, the bell.
//   - Pause alerts until… (DATA/restart-hold.json {until, why}, alert-quiet.mjs): alerts are logged, not sent, and
//     automatic engine restarts and fixer reloads wait. An expired pause is ignored.
//   - test agents (HERMES_HOME/.aqeelos-test-agents): their problems still show on Health, nobody is alerted.
// Every write keeps the file before it as <file>.prev, so one step back is always there.
import {readFile,writeFile,mkdir,rename,copyFile} from 'node:fs/promises';
import {readStore,saveStore,storeBad} from './store.mjs';
import path from 'node:path';
import {holdUntil} from './alert-quiet.mjs';

export const FIXER_DEFAULTS={on:true,agent:'default',cap:20,minutes:25,proof_minutes:15};
const str=(v,n=80)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n);
const list=(v,n=80)=>[...new Set((Array.isArray(v)?v:String(v??'').split(/[,\n]/)).map(x=>str(x,n)).filter(Boolean))].slice(0,20);
const digits=v=>list(v).map(x=>x.replace(/[^\d+]/g,'')).filter(x=>x.replace(/\D/g,'').length>=5);
const int=(v,lo,hi,d)=>{const n=Math.round(Number(v));return Number.isFinite(n)?Math.min(hi,Math.max(lo,n)):d};

// a person: name, Telegram ids and names, WhatsApp numbers; members can also have full authority over some agents
export function cleanPerson(p,agents=null){const o={name:str(p?.name,60)};
 const tg=list(p?.telegram).filter(x=>/^-?\d{3,20}$/.test(x)),tn=list(list(p?.telegram_names).map(x=>x.replace(/^@/,''))),wa=digits(p?.whatsapp);
 if(tg.length)o.telegram=tg;if(tn.length)o.telegram_names=tn;if(wa.length)o.whatsapp=wa;
 if(agents){const fa=list(p?.full_authority).filter(a=>agents.includes(a));if(fa.length)o.full_authority=fa}
 return o}

// the fixer's settings, each kept in its range; the fixing agent must exist
export function cleanFixer(f,known=[],before={}){const o={...FIXER_DEFAULTS,...before};
 if(f?.on!=null)o.on=!!f.on;if(f?.agent!=null){const a=str(f.agent);if(known.length&&!known.includes(a))throw Error('That agent does not exist: '+a);o.agent=a||'default'}
 if(f?.cap!=null)o.cap=int(f.cap,1,100,o.cap);if(f?.minutes!=null)o.minutes=int(f.minutes,5,60,o.minutes);if(f?.proof_minutes!=null)o.proof_minutes=int(f.proof_minutes,5,60,o.proof_minutes);
 if(o.on)delete o.off_why;else if(f?.off_why!=null)o.off_why=str(f.off_why,200);
 return o}

// the teams as the page sends them: names unique, each agent in one team at most (the last team that lists it keeps
// it), aliases only for the team's own agents, the contact one of its members (or nobody, then the owner hears)
export function cleanTeams(teams,known=[]){const out=[],names=new Set(),taken=new Map();
 for(const t of (Array.isArray(teams)?teams:[]).slice(0,30)){const name=str(t?.name,40);if(!name)throw Error('Every team needs a name.');
  if(names.has(name.toLowerCase()))throw Error('Two teams are called '+name+'.');names.add(name.toLowerCase());
  const agents=list(t?.agents).filter(a=>!known.length||known.includes(a));
  out.push({name,agents,aliases:t?.aliases||{},members:t?.members||[],contact:str(t?.contact,60)});for(const a of agents)taken.set(a,name)}
 for(const t of out){t.agents=t.agents.filter(a=>taken.get(a)===t.name);
  const al={};for(const a of t.agents){const w=list(t.aliases?.[a],40);if(w.length)al[a]=w}t.aliases=al;if(!Object.keys(al).length)delete t.aliases;
  const seen=new Set();t.members=(Array.isArray(t.members)?t.members:[]).slice(0,40).map(m=>cleanPerson(m,t.agents)).filter(m=>m.name&&!seen.has(m.name.toLowerCase())&&seen.add(m.name.toLowerCase()));
  if(t.contact&&!t.members.some(m=>m.name===t.contact))t.contact='';if(!t.contact)delete t.contact}
 return out}

// test agents file: one name per line, # comments kept
export function setTestLine(text,agent,on){const out=String(text||'').split('\n').filter(l=>l.trim()&&l.replace(/#.*$/,'').trim()!==agent);
 if(on)out.push(agent);return out.length?out.join('\n')+'\n':''}

export function createTeamSettings({DATA,HERMES_HOME,listAgents=async()=>[],now=()=>Date.now()}){
 const POL=path.join(DATA,'team-policy.json'),ALERTS=path.join(DATA,'alerts.json'),HOLD=path.join(DATA,'restart-hold.json'),TESTS=path.join(HERMES_HOME,'.aqeelos-test-agents');
 let chain=Promise.resolve();const queue=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p};
 // JSON through app/store.mjs: a file that cannot be read is not an empty one, and while it cannot be read nothing is saved over it (nor over its .prev)
 const readJson=(f,d)=>readStore(f,d);
 const write=async(f,v)=>{if(typeof v!=='string'){await readStore(f,null);if(!storeBad(f)){await mkdir(path.dirname(f),{recursive:true});await copyFile(f,f+'.prev').catch(()=>{})}return saveStore(f,v)}
  await mkdir(path.dirname(f),{recursive:true});await copyFile(f,f+'.prev').catch(()=>{});const t=f+'.'+process.pid+'.tmp';
  await writeFile(t,typeof v==='string'?v:JSON.stringify(v,null,1)+'\n');await rename(t,f)};
 const policy=()=>readJson(POL,{teams:[]});

 async function view(){const p=await policy(),agents=await listAgents().catch(()=>[]),tests=await testAgents();
  const hold=await readJson(HOLD,null),until=holdUntil(hold);
  return {owner:p.owner||{},teams:p.teams||[],fixer:{...FIXER_DEFAULTS,...(p.fixer||{})},agents,tests:[...tests],
   alerts:(await readJson(ALERTS,{})).target||null,pause:until>now()?{until,why:hold?.why||''}:null}}

 // owner and teams in one save; unknown keys (notes, _about) stay as they were
 const setTeams=b=>queue(async()=>{const p=await policy(),known=await listAgents().catch(()=>[]);
  const owner=cleanPerson(b?.owner??p.owner);if(!owner.name)owner.name=p.owner?.name||'Owner';
  const next={...p,owner,teams:cleanTeams(b?.teams??p.teams,known)};await write(POL,next);return next});
 const setFixer=b=>queue(async()=>{const p=await policy(),known=await listAgents().catch(()=>[]);const fixer=cleanFixer(b,known,p.fixer||{});
  await write(POL,{...p,fixer});return fixer});

 // where owner alerts go: a channel id from the main agent's list (relay.channelsFor) and, optionally, the chat on it
 const setAlerts=b=>queue(async()=>{const cur=await readJson(ALERTS,{});const ch=str(b?.channel,80);
  cur.target=ch?{channel:ch,chat:str(b?.chat,80)||null,name:str(b?.name,120)||null}:null;if(!cur.target)delete cur.target;await write(ALERTS,cur);return cur.target||null});
 const alertTarget=async()=>(await readJson(ALERTS,{})).target||null;

 // Pause alerts until…: until = epoch ms, or 0/null to end the pause now
 const setPause=b=>queue(async()=>{const u=Number(b?.until)||0;
  if(!u||u<=now()){const h=await readJson(HOLD,null);if(h)await write(HOLD,{...h,until:0,ended:new Date(now()).toISOString()});return null}
  if(u>now()+14*864e5)throw Error('Pause for two weeks at most.');
  const v={until:u,why:str(b?.why,160)||'paused on System › Teams',set:new Date(now()).toISOString()};await write(HOLD,v);return {until:u,why:v.why}});

 async function testAgents(){return new Set(String(await readFile(TESTS,'utf8').catch(()=>'')).split('\n').map(l=>l.replace(/#.*$/,'').trim()).filter(Boolean))}
 const setTest=(agent,on)=>queue(async()=>{const a=str(agent);if(!a)throw Error('Which agent?');
  const known=await listAgents().catch(()=>[]);if(on&&known.length&&!known.includes(a))throw Error('That agent does not exist: '+a);
  await write(TESTS,setTestLine(await readFile(TESTS,'utf8').catch(()=>''),a,!!on));return [...await testAgents()]});

 return {view,policy,setTeams,setFixer,setAlerts,alertTarget,setPause,setTest,testAgents}}
