// System › Health, Teams and the fixer's line: the issues list and filing one, teams and alerts, the cloud fixer, code changes git lacks, the
// fixer's queue, agent memory, graph and cost views (/ui/health/*, /ui/teams, /ui/alerts, /ui/cloud-fixer). They used to sit in server.mjs inside
// the signed-in /ui/ gate. Same checks in the same order; server.mjs calls this where the block was (the person `u` is already signed in and
// the x-hui header already checked) and it answers true when it handled the request.
import {personOf} from './issues.mjs';
import {isAgent,LIVE_APP,HELP_AGENT} from './agentops.mjs';
import {issueActs} from './need-action.mjs';
export function createHealthRoutes({agentGraph,agentMemory,agentName,chatHistory,cloudFixer,codeChanges,effView,escalations,health,issues,listAgents,listAllProfiles,memWatch,needCtx,ownerSend,questions,readBody,relay,resume,send,teamSettings,usage,users}){
 return async function handle(req,res,p,url,u){
   // System › Health: each agent fine or with its problems, and its failed messages this week (agent-health.mjs)
   if(p==='/ui/health/issues'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;const l=await issues.list();const nc=l.items.some(i=>i.state==='needs_human'||i.state==='stuck'&&i.need)?await needCtx().catch(()=>({})):{};const qm=Object.fromEntries((await questions.list().catch(()=>[])).filter(q=>q.state==='open'&&q.issue).map(q=>[q.issue,q]));return send(res,200,{items:l.items.map(i=>({question:qm[i.id]||null,acts:i.state==='needs_human'||i.state==='stuck'&&i.need?issueActs(i,nc):undefined,id:i.id,agent:i.agent,agentName:i.agentName,state:i.state,source:i.source||null,missing:i.missing,proposed_fix:i.proposed_fix,byName:i.byName,decision:i.decision,created:i.created,updated:i.updated,count:i.count,result:i.result||null,tries:i.tries??i.attempts??0,proof:i.proof||null,need:i.need||null,told:i.told||null,patch:i.patch||null,noRetry:!!i.noRetry,closeAfter:!!i.closeAfter,title:i.title||null,group:i.group||null,urgent:!!i.urgent,sorting:!!i.sorting,mergedInto:i.mergedInto||null,dupOf:i.dupOf||null,affects:i.affects||[],reports:(i.reports||[]).map(r=>({agent:r.agent,agentName:agentName(r.agent),at:r.at,id:r.id||null})),history:(i.history||[]).slice(-8).map(h=>({kind:h.kind,at:h.at,status:h.status,summary:h.summary||null,outcome:h.outcome||null}))})),spend:l.spend||null,fixer:l.fixer||null,escalations:await escalations.view().catch(()=>({agents:{}})),agents:(await listAgents().catch(()=>[])).map(a=>({id:a,name:agentName(a)})),sources:await chatHistory.sources().catch(()=>[]),policy:{teams:(l.policy.teams||[]).map(t=>({name:t.name,agents:t.agents,contact:t.contact||(t.members||[])[0]?.name||null,members:(t.members||[]).map(m=>m.name)})),fixer:l.policy.fixer||{}}}),true}
  // Report an issue, Stop retrying and Close (System › Health): a person files one for the fixer, or ends one
  if(/^\/ui\/health\/issues\/(report|close|stop)$/.test(p)&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}
   try{if(p.endsWith('/report')){const a=String(b.agent||'');if(!(await listAgents()).includes(a))return send(res,400,{error:'Pick the agent it is about.'}),true;
     const r=await issues.file({agent:a,missing:String(b.missing||''),evidence:String(b.evidence||''),source:'person',typed:true,origin:{who:u.name||'an admin'}});return send(res,200,{ok:true,id:r.issue.id,state:r.issue.state,again:!!r.again}),true}
    const i=await issues[p.endsWith('/close')?'close':'stop'](String(b.id||''),u.name||'an admin');if(!i)return send(res,404,{error:'No such issue.'}),true;return send(res,200,{ok:true,state:i.state,after:!!i.noRetry}),true}catch(e){return send(res,400,{error:e.message}),true}}
  // System › Teams (team-settings.mjs): teams and members, the fixer, where alerts go, Pause alerts, test agents
  if(/^\/ui\/(teams|alerts)(\/|$)/.test(p)){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;let b={};if(req.method!=='GET'){try{b=JSON.parse(await readBody(req,131072))}catch{}}
   const nm=a=>agentName(a),chans=async()=>(await relay.channelsFor('default').catch(()=>[])).map(c=>({id:c.id,name:c.name,platform:c.platform,owner:c.owner}));
   const full=async()=>{const v=await teamSettings.view();return {...v,agents:v.agents.map(a=>({id:a,name:nm(a)})),channels:await chans()}};
   try{
    if(p==='/ui/teams'&&req.method==='GET')return send(res,200,await full()),true;
    if(p==='/ui/teams'&&req.method==='PUT'){await teamSettings.setTeams(b);return send(res,200,await full()),true}
    if(p==='/ui/teams/fixer'&&req.method==='PUT'){const f=await teamSettings.setFixer(b);if(f.on&&LIVE_APP)issues.tick().catch(()=>{});return send(res,200,{fixer:f}),true}
    if(p==='/ui/teams/test'&&req.method==='PUT')return send(res,200,{tests:await teamSettings.setTest(b.agent,!!b.on)}),true;
    if(p==='/ui/alerts/chats'&&req.method==='POST'){const c=(await relay.channelsFor('default')).find(x=>x.id===String(b.channel||''));if(!c)return send(res,404,{error:'That channel is gone.'}),true;
     return send(res,200,{chats:await relay.recipients(c.owner,c.platform)}),true}
    if(p==='/ui/alerts'&&req.method==='PUT'){const id=String(b.channel||'');let name=null;
     if(id){const c=(await relay.channelsFor('default')).find(x=>x.id===id);if(!c)return send(res,400,{error:'That channel is not connected.'}),true;name=c.name+(b.chatName?', '+String(b.chatName).slice(0,60):'')}
     return send(res,200,{alerts:await teamSettings.setAlerts({channel:id,chat:b.chat,name})}),true}
    if(p==='/ui/alerts/test'&&req.method==='POST'){const r=await ownerSend('Test from '+(globalThis.AQ_BRAND||'aqeelOS')+': alerts for you arrive here. Sent by '+(u.name||'an admin')+' from System › Teams.','telegram');return send(res,200,r),true}
    if(p==='/ui/alerts/pause'&&req.method==='PUT')return send(res,200,{pause:await teamSettings.setPause(b)}),true;
   }catch(e){return send(res,400,{error:e.message}),true}
   return send(res,404,{error:'Not found'}),true}
  // the cloud fixer's routines (System › Settings › Cloud fixer): the view never carries a token; the token is write-only
  if(p==='/ui/cloud-fixer'||p==='/ui/cloud-fixer/test'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;let b={};if(req.method!=='GET'){try{b=JSON.parse(await readBody(req,16384))}catch{}}
   try{if(p==='/ui/cloud-fixer'&&req.method==='GET')return send(res,200,{...await cloudFixer.view(),status:(await issues.fixerView()).cloud}),true;
    if(p==='/ui/cloud-fixer'&&req.method==='PUT'){const v=await cloudFixer.save(b.routines);if(LIVE_APP)issues.tick().catch(()=>{});return send(res,200,v),true}
    if(req.method==='POST')return send(res,200,await cloudFixer.test(b.trigId)),true}catch(e){return send(res,400,{error:e.message}),true}}
  // "Try again" (after a person did what was needed, or for a stuck issue): a fresh set of tries
  // code changes on the box that git lacks (code-changes.mjs): the list, one patch's text, and "taken into git"
  if(p==='/ui/health/resume'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;return send(res,200,{line:resume.line(),last:resume.last()}),true}
  if(p==='/ui/health/code-changes'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;
   if(url.searchParams.get('name')){try{return send(res,200,{text:await codeChanges.read(url.searchParams.get('kind'),url.searchParams.get('name'))}),true}catch(e){return send(res,404,{error:e.code==='ENOENT'?'That patch is gone.':e.message}),true}}
   return send(res,200,{items:await codeChanges.list()}),true}
  if(p==='/ui/health/code-changes/done'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;let b={};try{b=JSON.parse(await readBody(req,2048))}catch{}
   try{await codeChanges.done(String(b.kind||''),String(b.name||''));return send(res,200,{ok:true}),true}catch(e){return send(res,400,{error:e.code==='ENOENT'?'That patch is gone.':e.message}),true}}
  // the fixer's line (HEALTH-2): move up or down, skip for today and put back, pause and resume
  if(/^\/ui\/health\/fixer\/(move|skip|unskip|pause|resume)$/.test(p)&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;let b={};try{b=JSON.parse(await readBody(req,2048))}catch{}
   const k=p.split('/').pop(),id=String(b.id||'');let r;
   if(k==='move')r=await issues.move(id,b.dir==='down'?'down':'up');else if(k==='skip'||k==='unskip')r=await issues.skip(id,k==='skip');else{r=await issues.pause(k==='pause',u.name||'an admin');if(k==='resume'&&LIVE_APP)issues.tick().catch(()=>{});return send(res,200,{ok:true,paused:r}),true}
   if(!r)return send(res,404,{error:'That issue is not in the line any more.'}),true;if(LIVE_APP)issues.tick().catch(()=>{});return send(res,200,{ok:true,fixer:await issues.fixerView()}),true}
  // memory per agent (HEALTH-6) and this week's cost by agent and by person (HEALTH-7)
  if(p==='/ui/health/memory'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;const v=await agentMemory.view();const box=await memWatch.view().catch(()=>null);return send(res,200,{...v,box,names:Object.fromEntries(Object.keys(v.agents).map(a=>[a,agentName(a)]))}),true}
  // size of what each agent sends on every call, its map, and sections a person may move out of its instructions (agent-graph.mjs)
  if(p==='/ui/health/graph'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;return send(res,200,await agentGraph.view()),true}
  if(p==='/ui/health/graph/enable'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;let b={};try{b=JSON.parse(await readBody(req,20000))}catch{}
   const r=await agentGraph.setEnabled({all:typeof b.all==='boolean'?b.all:undefined,agents:Array.isArray(b.agents)?b.agents:undefined});console.log('graph: maps on for',r.all?'every agent':r.agents.join(', '),'by',u.id||u.name||'?');return send(res,200,{ok:true,...r}),true}
  if((p==='/ui/health/graph/accept'||p==='/ui/health/graph/dismiss')&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;
   let b={};try{b=JSON.parse(await readBody(req,20000))}catch{}const a=String(b.agent||'');if(!await isAgent(a))return send(res,404,{error:'No such agent.'}),true;
   try{if(p.endsWith('/dismiss'))return send(res,200,{ok:await agentGraph.dismiss(a)}),true;
    const r=await agentGraph.accept(a,(Array.isArray(b.ids)?b.ids:[]).map(String),{by:u.name||u.id||'an admin'});console.log('graph: sections moved for',a,'by',u.id||u.name||'?');return send(res,200,{ok:true,...r}),true}
   catch(e){return send(res,e.status||400,{error:e.message}),true}}
  if(p==='/ui/health/efficiency'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;return send(res,200,await effView.view({fresh:url.searchParams.get('fresh')==='1'})),true}
  if(p==='/ui/health/cost'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;
   // whose chat it was: the person who started it in aqeelOS, else a person the team policy knows on that channel (the owner
   // on Telegram), else what started it: a schedule, a customer on a channel, or background work (the fixer, helpers)
   const pol=await issues.policy().catch(()=>({})),CH=['telegram','whatsapp','slack','discord','signal'];
   const who=(id,s)=>{const o=users.sessionOwner(id);if(o)return o;const src=String(s?.source||'');
    if(s?.user_id&&CH.includes(src)){const x=personOf(pol,src,s.user_id);if(x)return x.owner?'owner':'@'+x.name}
    return src==='cron'?'_cron':[...CH,'webhook','local','api_server'].includes(src)?'_chan':'_bg'};
   const AUTO={_cron:'Schedules',_chan:'Customers and channels',_bg:'Background work (fixer, helpers)'};
   const all=await usage.breakdown([...await listAllProfiles(),HELP_AGENT],7,who);const ppl=Object.fromEntries(users.people().map(x=>[x.id,x.name]));
   const agentOf=a=>String(a).split('--')[0],ba={};for(const [a,o] of Object.entries(all.byAgent||{})){const k=agentOf(a);ba[k]=(ba[k]||0)+(o.cost||0)}
   const rows=o=>Object.entries(o).map(([k,c])=>({id:k,cost:Math.round(c*100)/100})).filter(r=>r.cost>0).sort((a,b)=>b.cost-a.cost);
   return send(res,200,{days:7,byAgent:rows(ba).map(r=>({...r,name:r.id===HELP_AGENT?'Help':agentName(r.id)})),byPerson:rows(Object.fromEntries(Object.entries(all.byPerson||{}).map(([k,o])=>[k,o.cost||0]))).map(r=>({...r,name:AUTO[r.id]||(r.id.startsWith('@')?r.id.slice(1):ppl[r.id]||r.id),auto:!!AUTO[r.id]})),failed:all.failed||null}),true}
  if(p==='/ui/health/issues/retry'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;let b={};try{b=JSON.parse(await readBody(req,2048))}catch{}const i=await issues.retry(String(b.id||''));if(!i)return send(res,404,{error:'No such issue.'}),true;return send(res,200,{ok:true,state:i.state}),true}
   if(p==='/ui/health/agents'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;return send(res,200,await health.view()),true}
  return false}}
