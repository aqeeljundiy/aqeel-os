// An agent's abilities and Code: approvals (ask or Smart), Safe tools, quiet Slack channels, Trusted, Skills › Only these agents and who
// has a skill, the locks, copying abilities to other agents, an MCP provider's own client, n8n status, Open in Code, pairing Code and Code
// online, Files search, Code usage and Connected apps › Code (/ui/agent-approvals, /ui/agent-safe, /ui/slack-quiet, /ui/agent-trust,
// /ui/skills-policy, /ui/agent-locks, /ui/share, /ui/mcp/oauth-client, /ui/n8n/status, /ui/code/handoff, /ui/code/pair, /ui/code/online,
// /ui/files, /ui/code/usage, /ui/code/connected). They used to sit in server.mjs inside the signed-in /ui/ gate. Same checks in the same order;
// server.mjs calls this where the block was (the person `u` is already signed in and the x-hui header already checked) and it answers true
// when it handled the request.
import {readConfig,pick,setKey,isAgent,setStatus,getStatus} from './agentops.mjs';
import {rules as skillRules} from './skills-policy.mjs';
import {accountHooks} from './accounts.mjs';
import {onlineCodeOn,ONLINE_CODE_MSG} from './install-routes.mjs';
import path from 'node:path';
import {homedir} from 'node:os';
import {readdir,stat} from 'node:fs/promises';
export function createAbilitiesRoutes({agentDefaults,channelIdentity,code,codeAgents,codeBridge,codeOnline,displayName,envOf,isTestAgent,listAgents,listAllProfiles,live,lockedAgent,lockTools,MCP_OAUTH_BASE,n8n,NAMES,readBody,restartGateway,send,sharing,slackClientChannels,slackQuiet,unlockTools,users}){
 return async function handle(req,res,p,url,u){
   if(p==='/ui/agent-approvals'){const ag=req.method==='GET'?(url.searchParams.get('agent')||'default'):null;let b={};if(req.method==='PUT'){try{b=JSON.parse(await readBody(req,2048))}catch{}}
    const a=ag||String(b.agent||'default');if(!(await listAllProfiles()).includes(a))return send(res,400,{error:'Unknown agent'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))return send(res,403,{error:'Not your agent'}),true;
    if(req.method==='GET'){const c=await readConfig(a);return send(res,200,{mode:pick(c,'approvals.mode')||'manual'}),true}
    if(req.method==='PUT'){if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+a+'/soul','PUT',new URLSearchParams(),a))return send(res,403,{error:'You can chat with this agent but not change how it asks for approval.'}),true;const mode=b.mode==='smart'?'smart':'manual';const r=await setKey(a,'approvals.mode',mode);if(!r.ok)return send(res,500,{error:r.err||'Could not save'}),true;console.log('approvals for',a,'→',mode);return send(res,200,{mode}),true}}
   if(p==='/ui/agent-safe'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'');
    if(!await isAgent(ag)||ag==='default')return send(res,400,{error:'Unknown agent'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can only change agents you may edit.'}),true;
    // Unlock (admins): the admin's lock comes off; an agent whose owner may not have these tools stays locked by that
    if(b.safe===false){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can unlock an agent.'}),true;
     try{await setStatus(ag,{safe:false});if(lockedAgent(ag,await getStatus())){const ow=users.byId(users.agentOwner(ag));return send(res,200,{ok:true,still:(ow?.name||'Its owner')+' is not allowed terminal, files or code, so the agent keeps them off. Give them that under People first.'}),true}
      await unlockTools(ag);agentDefaults.ensure(ag).catch(()=>{});console.log('agent unlocked from safe tools:',ag,'by',u.id);return send(res,200,{ok:true}),true}catch(e){return send(res,400,{error:e.message}),true}}
    try{await setStatus(ag,{safe:true});await lockTools(ag);return send(res,200,{ok:true}),true}catch(e){return send(res,400,{error:e.message}),true}}
   // Channels › Slack: channels whose name starts with this stay quiet ('' = none)
   // quiet Slack channels, per workspace: GET {teams:{<id>:{prefix,name}}}; PUT {team,prefix,name}
   if(p==='/ui/slack-quiet'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;if(req.method==='GET'){const bots=[];for(const a of await listAgents()){const env=await envOf(a);if(!env.SLACK_BOT_TOKEN)continue;const r=await channelIdentity(a,{id:'slack'},env).catch(()=>null);if(r?.account?.team)bots.push({agent:a,team:r.account.team,name:r.account.name||''})}
     return send(res,200,{teams:await slackQuiet.get(),bots}),true}
    if(req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}try{const t=await slackQuiet.set(String(b.team||''),b.prefix,b.name);setTimeout(()=>slackClientChannels().catch(()=>{}),1000).unref();console.log('slack quiet for',b.team,'is now',JSON.stringify(t.prefix),'by',u.id);return send(res,200,t),true}catch(e){return send(res,400,{error:e.message}),true}}}
   // Trusted (runs as the main user): admins, for agents of admins. Others run as their own Linux user
   if(p==='/ui/agent-trust'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;const tr=await agentDefaults.trusted();
    if(req.method==='GET'){const out={};for(const a of String(url.searchParams.get('names')||'').split(',').filter(Boolean).slice(0,200))out[a]={trusted:tr.has(a),main:a==='default',may:a==='default'||users.tierOf(a)==='admin'};return send(res,200,out),true}
    let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'');if(!await isAgent(ag)||ag==='default'||ag.includes('--'))return send(res,400,{error:'Unknown agent'}),true;
    if(b.trusted&&users.tierOf(ag)!=='admin')return send(res,400,{error:'Only agents of admins can run as the main user.'}),true;
    await agentDefaults.setTrusted(ag,!!b.trusted);console.log('agent',ag,b.trusted?'trusted: runs as the main user':'runs as its own user','(by '+u.id+')');
    agentDefaults.added(ag).then(async n=>{if(n&&!await isTestAgent(ag).catch(()=>false))Promise.resolve(restartGateway('Trusted changed for '+ag)).catch(()=>{})}).catch(e=>console.warn('agent defaults',ag,e.message));return send(res,200,{ok:true,trusted:!!b.trusted}),true}
   // Abilities › Skills › Only these agents (admins): one skill's rule in skills-policy.json
   if(p==='/ui/skills-policy'){if(req.method==='GET')return send(res,200,skillRules()),true;if(!users.isAdmin(u))return send(res,403,{error:'Only admins decide which agents get a skill.'}),true;
    let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}
    try{const r=await accountHooks.skillShare({key:b.skill,agents:Array.isArray(b.agents)?b.agents.map(String):null,dry:!!b.dry});if(b.dry)return send(res,200,r),true;
     console.log('skill',b.skill,Array.isArray(b.agents)?'only for '+b.agents.join(', '):'for every agent','(by '+u.id+')');return send(res,200,{...skillRules(),done:r}),true}catch(e){return send(res,400,{error:e.message}),true}}
   // who has one skill right now and who built it (the Access block opens with this)
   if(p==='/ui/skills-policy/who'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;try{return send(res,200,await accountHooks.skillShare({key:url.searchParams.get('skill'),agents:[],dry:true})),true}catch(e){return send(res,400,{error:e.message}),true}}
   // which agents are locked to safe tools, and why (the Tool groups grid shows a lock with this reason instead of a switch)
   if(p==='/ui/agent-locks'&&req.method==='GET'){const st=await getStatus();const out={};
    for(const a of String(url.searchParams.get('names')||'').split(',').filter(Boolean).slice(0,200)){if(a==='default'||!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a)!==null||!lockedAgent(a,st))continue;
     const ow=users.byId(users.agentOwner(a));out[a]=st[a]?.safe?'An admin locked this agent to safe tools: terminal, files, code and computer use stay off.':'Its owner'+(ow?.name?' '+ow.name:'')+' isn’t allowed terminal, files, code or computer use, so this agent can’t have them either.'}
    return send(res,200,out),true}
   // abilities across agents: who has what, copy to other agents, rename an MCP tool (admins, or owners of both agents)
   if(p==='/ui/share/used'&&req.method==='GET'){const kind=url.searchParams.get('kind')||'';const all=await sharing.usedBy(kind);if(!users.isAdmin(u)){for(const k of Object.keys(all))all[k]=all[k].filter(a=>users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a)===null)}return send(res,200,all),true}
   if(p==='/ui/share'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const from=String(b.from||''),to=(Array.isArray(b.to)?b.to:[]).map(String);
    const may=a=>users.isAdmin(u)||users.gate(u,'/hapi/profiles/'+a+'/soul','PUT',new URLSearchParams(),a)===null;if(!may(from)||!to.every(may))return send(res,403,{error:'You can only share between agents you can edit.'}),true;
    if(!users.isAdmin(u)&&b.kind==='mcp')return send(res,403,{error:'Only admins can copy MCP tools between agents.'}),true;
    // the same rights as doing it on each agent directly: plugins on agents they own (addonCheck), skills and schedules need that permission
    if(!users.isAdmin(u)&&b.kind==='plugin'){const no=to.map(a=>users.addonCheck(u,a,'plugin')).find(Boolean);if(no)return send(res,403,{error:no}),true}
    if(!users.isAdmin(u)&&b.kind==='skill'&&!to.every(a=>users.canOn(u,'skills',a)))return send(res,403,{error:'Your role does not include adding skills to that agent.'}),true;
    if(!users.isAdmin(u)&&b.kind==='schedule'&&!to.every(a=>users.canOn(u,'schedules',a)))return send(res,403,{error:'Your role does not include schedules on that agent.'}),true;
    try{return send(res,200,await sharing.share(String(b.kind||''),String(b.name||''),from,to,b.replace===true)),true}catch(e){return send(res,400,{error:e.message}),true}}
   // a provider without automatic registration (Slack, Google…): its app's client ID/secret, and the return address to give it
   if(p==='/ui/mcp/oauth-client'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can set this.'}),true;let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}
    try{return send(res,200,await sharing.setOauthClient(String(b.agent||'default'),String(b.name||''),String(b.client_id||'').trim(),String(b.client_secret||'').trim(),MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(String(b.name||'')))),true}catch(e){return send(res,400,{error:e.message}),true}}
   // every agent's model and the account it runs on, for "All agents" on Agents' models
   if(p==='/ui/n8n/status'&&req.method==='GET'){const a=String(url.searchParams.get('agent')||'default');
    // every agent's n8n address is for admins only; a member sees an agent's own only when they have that agent
    // (the n8n page always asks for the main agent, so no access still answers, just without the address)
    const s=await n8n.status(a);if(!users.isAdmin(u)){delete s.users;if(users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))s.user=null}return send(res,200,s),true}
   // "Open in Code" from a chat: the request an agent kept, for a person who may chat with that agent
   if(p==='/ui/code/handoff'&&req.method==='GET'){const v=await codeAgents.handoffGet(url.searchParams.get('id'));if(!v)return send(res,404,{error:'This link has expired. Ask the agent again.'}),true;
    if(users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),v.agent))return send(res,403,{error:'You can’t use that agent.'}),true;return send(res,200,{agent:v.agent,agentName:NAMES[v.agent]||await displayName(v.agent),text:v.text}),true}
   if(p==='/ui/code/pair'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}return send(res,200,{token:await code.pair(u.id,b.name)}),true}
   if(p==='/ui/code/online'&&req.method==='GET'){if(!onlineCodeOn())return send(res,410,{error:ONLINE_CODE_MSG}),true;return send(res,200,{url:codeOnline.url(u.id),origin:new URL(codeOnline.url(u.id)).origin}),true}
   // Files: search a folder and everything inside it (names only), and which of the quick places exist
   if(p==='/ui/files/search'&&req.method==='GET'){const root=path.resolve(url.searchParams.get('path')||homedir()),q=String(url.searchParams.get('q')||'').trim().toLowerCase(),hid=url.searchParams.get('hidden')==='1';
    if(!q)return send(res,200,{results:[]}),true;if(!users.filePathOk(u,root))return send(res,403,{error:'You can only search your own files.'}),true;
    const SKIP=new Set(['node_modules','.git','__pycache__','.venv','venv','.cache','.npm','.local','browser-profile']);const out=[];let seen=0;const queue=[[root,0]];
    const t0=Date.now();while(queue.length&&seen<300000&&Date.now()-t0<4000&&out.length<200){const [dir,depth]=queue.shift();let list=[];try{list=await readdir(dir,{withFileTypes:true})}catch{continue}
     for(const e of list){seen++;if(!hid&&e.name.startsWith('.'))continue;const fp=path.join(dir,e.name);const isDir=e.isDirectory();
      if(e.name.toLowerCase().includes(q)){let st=null;try{st=await stat(fp)}catch{}out.push({name:e.name,path:fp,is_directory:isDir,size:st?.size||0,mtime:st?Math.floor(st.mtimeMs/1000):0,rel:path.relative(root,dir)||'.'});if(out.length>=200)break}
      if(isDir&&!SKIP.has(e.name)&&depth<8)queue.push([fp,depth+1])}}
    return send(res,200,{results:out,more:out.length>=200||queue.length>0}),true}
   if(p==='/ui/files/exist'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}const ok=[];for(const x of (Array.isArray(b.paths)?b.paths:[]).slice(0,20)){const fp=path.resolve(String(x));if(!users.filePathOk(u,fp))continue;try{if((await stat(fp)).isDirectory())ok.push(String(x))}catch{}}return send(res,200,{exist:ok}),true}
   if(p==='/ui/code/usage'&&req.method==='GET'){const days=Math.min(365,Math.max(1,+url.searchParams.get('days')||7));const d=await code.runs(days,users.isAdmin(u)?null:u.id);const people={};for(const id of Object.keys(d.byPerson)){const x=users.byId(id);people[id]={name:x?.name||id,avatar:x?.avatar?'/ui/people/avatar/'+id:null}}
    // admins: the latest calls agents made into projects on people's computers (the code bridge), newest first
    const bridge=users.isAdmin(u)?(await codeBridge.recent(40)).map(x=>({...x,userName:users.byId(x.user)?.name||x.user||''})):undefined;return send(res,200,{...d,people,...(bridge?{bridge}:{})}),true}
   // Bottlenecks: what is stuck until a person acts (admins also see what aqeelOS itself noticed)
   // Live: every published app (everyone sees them; publisher or admin takes one offline; admins connect the server)
   // Connected apps › Code (admins): every computer's Code with its GitHub accounts and tool servers, and Live's server
   if(p==='/ui/code/connected'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;const names=Object.fromEntries(users.people().map(x=>[x.id,x.name||x.username||'Someone']));
    return send(res,200,{devices:(await code.allDevices()).map(d=>({...d,person:names[d.user]||'Someone'})),live:{connected:(await live.list(u,true)).connected}}),true}
  return false}}
