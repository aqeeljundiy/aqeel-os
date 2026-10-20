// What every agent gets from aqeelOS itself (decided 20 Oct 2026), not from each agent's own settings:
//  - every tool bundle on every channel: its own screen and browser (logins through the lock box, downloads), web,
//    files, terminal, code, images, voice, schedules; and all skills;
//  - its own Linux user (every agent but the main one, now and any made later; decided 20 Oct 2026): its commands, files and code then run as that
//    user over SSH to the box itself, so it can only reach its own folder (~/workspaces/<agent>), never the owner's
//    sign-ins, keys, aqeelOS's data or other agents' folders. The box's root startup (scripts/agent-users.sh, started
//    from the AI box's compose in Dokploy) makes those users for the names aqeelOS lists.
// The owner's own accounts (Slack, Notion, Google and so on) are never handed out by these defaults; each agent can
// connect apps with its own sign-in. Applied at every start (an engine update can reset settings) and to new agents.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {setKey,readConfig,pick,agentNames,HERMES_HOME} from './agentops.mjs';

const PLATFORMS=['whatsapp','telegram','slack','discord','signal','api_server'];
const bundle=p=>p==='api_server'?'hermes-api-server':'hermes-'+p;
const run=(c,a)=>new Promise((res,rej)=>execFile(c,a,{timeout:30000},(e,o,er)=>e?rej(Error(String(er||e.message).trim())):res(String(o))));

export function createAgentDefaults({DATA,giveSkills,log=m=>console.log(m)}){
 const TRUST=path.join(DATA,'agent-trust.json'),SEEN=path.join(DATA,'agents-seen.json');
 const REQ=path.join(homedir(),'.aqeelos-agent-users'),KEY=path.join(HERMES_HOME,'agent-ssh','id_ed25519');
 const userOf=a=>('ag-'+a).slice(0,32);
 // only the main agent keeps the box's main user; agent-trust.json may name others, but by default it names none
 async function trusted(){try{return new Set(['default',...(JSON.parse(await readFile(TRUST,'utf8')).trusted||[])])}catch{
  await writeFile(TRUST,JSON.stringify({trusted:[]},null,1)).catch(()=>{});return new Set(['default'])}}
 async function ensureKey(){if(await stat(KEY).catch(()=>null))return;await mkdir(path.dirname(KEY),{recursive:true,mode:0o700});await run('ssh-keygen',['-q','-t','ed25519','-N','','-f',KEY,'-C','aqeelos-agents'])}
 // the box itself as a known SSH host (the agents' commands go to 127.0.0.1)
 async function knownHost(){const f=path.join(homedir(),'.ssh','known_hosts');const cur=await readFile(f,'utf8').catch(()=>'');if(/^127\.0\.0\.1 /m.test(cur))return;
  const k=await run('ssh-keyscan',['-T','5','-t','ed25519','127.0.0.1']).catch(()=>'');if(k.trim()){await mkdir(path.dirname(f),{recursive:true,mode:0o700});await writeFile(f,cur+(cur&&!cur.endsWith('\n')?'\n':'')+k)}}
 // the root script makes a user for each name listed here (one per line) and writes the users it made to <file>.done
 async function requestUsers(names){const want=[...names].sort().join('\n')+'\n';if((await readFile(REQ,'utf8').catch(()=>''))!==want)await writeFile(REQ,want)}
 const ready=async a=>(await readFile(REQ+'.done','utf8').catch(()=>'')).split('\n').includes(userOf(a));
 // the Chrome on the agent's own screen (the root script keeps one per isolated agent; its port is in ~/.aqeelos-agent-ports)
 const chromePort=async a=>{const l=(await readFile(path.join(homedir(),'.aqeelos-agent-ports'),'utf8').catch(()=>'')).split('\n').find(x=>x.startsWith(a+' '));return l?l.trim().split(' ')[2]:null};
 // no withAgent around this: setKey takes the agent's lock itself (holding it here waited on itself forever)
 async function ensure(a){const c=await readConfig(a).catch(()=>null);if(!c)return 0;const changes=[];
  const own=!(await trusted()).has(a),ws=path.join(homedir(),'workspaces',a),isolated=own&&await ready(a);
  // the full bundles include the terminal: an agent meant to have its own user gets them only once that user exists
  const pts=pick(c,'platform_toolsets')||{};
  if(!own||isolated)for(const p of PLATFORMS){const cur=[].concat(pts[p]||[]);if(!cur.includes(bundle(p)))changes.push(['platform_toolsets.'+p,[bundle(p),...cur]])}
  if(!isolated&&pick(c,'bot_desktop.auto_start')!==true)changes.push(['bot_desktop.auto_start','true']);
  if(isolated){const want={'terminal.backend':'ssh','terminal.ssh_host':'127.0.0.1','terminal.ssh_user':userOf(a),'terminal.ssh_port':'22','terminal.ssh_key':KEY,'terminal.cwd':ws};
   // its browser is the Chrome on its own screen, which runs as its user; the engine then starts no screen of its own for it
   const port=await chromePort(a);if(port){want['browser.cdp_url']='http://127.0.0.1:'+port;want['bot_desktop.auto_start']='false'}
   for(const [k,v] of Object.entries(want))if(String(pick(c,k)??'')!==v)changes.push([k,v]);
   // walled off in its own user, it gets every tool group: tool groups switched off for it earlier come back on
   if([].concat(pick(c,'agent.disabled_toolsets')||[]).length)changes.push(['agent.disabled_toolsets',[]])}
  else if(!own&&pick(c,'terminal.backend')==='ssh')changes.push(['terminal.backend','local']);
  // voice notes: the language is detected each time, so every agent adapts to whoever speaks (the engine's own default
  // forces English when an agent sets none), with the same speech model as the main agent
  // aqeelOS's own tools for the agent (lock box, my_settings, browser choice, bottlenecks) are never cut down to a few
  if(pick(c,'mcp_servers.aqeelos-notify.tools.include')!==undefined)changes.push(['mcp_servers.aqeelos-notify.tools',{}]);
  if(pick(c,'stt.language')===undefined)changes.push(['stt.language','']);
  if(a!=='default'&&pick(c,'stt.local.model')===undefined){const m=pick(await readConfig('default').catch(()=>null),'stt.local.model');if(m)changes.push(['stt.local.model',String(m)])}
  for(const [k,v] of changes)await setKey(a,k,v);
  if(changes.length)log('agent defaults for '+a+': '+changes.map(x=>x[0]).join(', '));return changes.length}
 // every agent always has every skill the main agent (Donna) has: missing ones are copied, the agent's own copies and
 // extra skills of its own stay (decided 20 Oct 2026: no agent is treated differently; only the owner's signed-in
 // accounts are not handed out, and those aren't skills)
 async function skills(names){let n=0;for(const a of names)if(a!=='default')n+=await giveSkills(a).catch(()=>0)||0;return n}
 // about every minute: agents made any way (aqeelOS, the engine's command line, another agent) get the defaults once
 // when first seen (the list survives restarts), and every agent gets the main agent's skills it lacks
 // an agent first seen less than 5 minutes ago is still being set up by whoever made it (this aqeelOS, or the test copy
 // that shares the engine): settings and plugins written at the same moment collide (AdmissionRefused), so it waits
 const FIRST=path.join(DATA,'agents-first-seen.json');let first=null;
 async function settled(names){if(!first){try{first=JSON.parse(await readFile(FIRST,'utf8'))}catch{first={};for(const a of names)first[a]=0}}
  let ch=false;for(const a of names)if(!(a in first)){first[a]=Date.now();ch=true}if(ch)await writeFile(FIRST,JSON.stringify(first)).catch(()=>{});
  return names.filter(a=>a==='default'||Date.now()-first[a]>=300000)}
 async function tick(){const names=await settled(await agentNames());await skills(names);let seen;try{seen=new Set(JSON.parse(await readFile(SEEN,'utf8')))}catch{seen=null}
  if(!seen){await writeFile(SEEN,JSON.stringify(names));return 0}let n=0;
  for(const a of names)if(!seen.has(a)){log('new agent '+a+': giving it the defaults');n+=await added(a).catch(e=>{log('agent defaults '+a+': '+e.message);return 0});seen.add(a);await writeFile(SEEN,JSON.stringify([...seen]))}
  return n}
 async function all(){await ensureKey().catch(e=>log('agent key: '+e.message));await knownHost().catch(()=>{});const names=await agentNames(),tr=await trusted();
  await requestUsers(names.filter(a=>!tr.has(a)));await skills(names);
  let n=0;for(const a of await settled(names))n+=await ensure(a).catch(e=>{log('agent defaults '+a+': '+e.message);return 0});return n}
 // a new agent: its user (when it is not trusted), then the defaults
 async function added(a){const names=await agentNames(),tr=await trusted();await requestUsers(names.filter(x=>!tr.has(x)));
  if(!tr.has(a))for(let i=0;i<8&&!await ready(a);i++)await new Promise(r=>setTimeout(r,2000));return ensure(a)}
 return {all,tick,ensure,added,trusted,userOf}}
