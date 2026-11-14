// An agent's instructions and changes, Bottlenecks, Code's devices and app download, n8n and Models: an agent's own changes and undo, its
// instructions (history, a version, save, bring back, proposals, check), what is stuck until a person acts, Team folders, paired devices and
// unpairing, the aqeelOS app installer, n8n spaces, sharing, base, owner login and opening it, and every agent's model and fallbacks
// (/ui/agent-versions, /ui/instructions, /ui/bottlenecks, /ui/team-folders, /ui/code/devices, /ui/code/unpair, /ui/code/download, /ui/n8n/*,
// /ui/models/agents, /ui/models/fallbacks). They used to sit in server.mjs inside the signed-in /ui/ gate. Same checks in the same order;
// server.mjs calls this where the block was (the person `u` is already signed in and the x-hui header already checked) and it answers true
// when it handled the request.
import path from 'node:path';
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {readConfig,listedAgent} from './agentops.mjs';
export function createInstructionsRoutes({accountsApi,backupModels,bottlenecks,cfgLimit,channelAttention,code,DATA,DESKTOP_RELEASES,displayName,help,instructions,listAgents,localAppVersions,n8n,NAMES,needsFor,newerApp,readBody,releaseAppVersions,security,send,signinsDue,teamFolders,users,versions}){
 return async function handle(req,res,p,url,u){
   // an agent's instructions (instructions.mjs): history, a version with its changes, save, bring back, rewrites waiting for approval, flags
   // an agent's own changes (agent-versions.mjs): list, and undo one (Edit agent › Changes); same rights as its instructions
   {const vm=/^\/ui\/agent-versions\/([^/]+)(?:\/(undo))?$/.exec(p);if(vm){const ag=decodeURIComponent(vm[1]),who=u.name||u.username||'Someone';
    if(!(await listAgents()).includes(ag))return send(res,404,{error:'No such agent.'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can chat with this agent but not change it.'}),true;
    try{if(!vm[2]&&req.method==='GET')return send(res,200,await versions.changes(ag,{limit:60})),true;
     if(vm[2]==='undo'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const x=await versions.undo(ag,String(b.id||''),{by:who});console.log('agent-versions:',who,'undid',ag,b.id);return send(res,200,x),true}
     return send(res,405,{error:'Not allowed'}),true}catch(e){return send(res,400,{error:e.message}),true}}}
   {const im=/^\/ui\/instructions\/([^/]+)(?:\/(v\/\d+|p\/[a-z0-9]+|save|restore|propose|decide|check))?$/.exec(p);if(im){const ag=decodeURIComponent(im[1]),act=im[2]||'',who=u.name||u.username||'Someone';
    if(!(await listAgents()).includes(ag))return send(res,404,{error:'No such agent.'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can chat with this agent but not change it.'}),true;
    if(act==='decide'&&!users.isAdmin(u)&&users.agentOwner(ag)!==u.id)return send(res,403,{error:'Only an owner of this agent can approve its instructions.'}),true;
    let b={};if(req.method==='POST'||req.method==='PUT'){try{b=JSON.parse(await readBody(req,400e3)||'{}')}catch{return send(res,400,{error:'bad json'}),true}}
    try{if(!act&&req.method==='GET')return send(res,200,await instructions.history(ag)),true;
     if(act.startsWith('v/')&&req.method==='GET')return send(res,200,await instructions.version(ag,+act.slice(2))),true;
     if(act.startsWith('p/')&&req.method==='GET')return send(res,200,await instructions.proposal(ag,act.slice(2))),true;
     if(act==='save'&&req.method==='PUT'){const x=await instructions.write(ag,b.content,{kind:'edit',by:who,why:b.why||'',said:b.said||''});console.log('instructions:',who,'saved',ag,'v'+x.v);return send(res,200,x),true}
     if(act==='restore'&&req.method==='POST'){const x=await instructions.restore(ag,+b.v,who);console.log('instructions:',who,'brought back',ag,'v'+b.v);return send(res,200,x),true}
     if(act==='propose'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;return send(res,200,await instructions.propose(ag,{content:b.content,why:b.why,said:b.said,by:b.by||who})),true}
     if(act==='decide'&&req.method==='POST'){const r=await instructions.decide(ag,String(b.id||''),!!b.ok,who);console.log('instructions:',who,r.state,'a rewrite of',ag);return send(res,200,r),true}
     if(act==='check'&&req.method==='POST'){await instructions.check(ag,{force:true});return send(res,200,await instructions.history(ag)),true}}
    catch(e){return send(res,400,{error:e.message}),true}
    return send(res,405,{error:'Not allowed'}),true}}
   if(p==='/ui/bottlenecks'&&req.method==='GET')return send(res,200,{items:await needsFor(u)}),true;
   if((p==='/ui/bottlenecks/done'||p==='/ui/bottlenecks/later')&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const id=String(b.id||'').slice(0,300);if(!id)return send(res,400,{error:'Which one?'}),true;const admin=users.isAdmin(u);
    // a Help ticket: admins resolve it (the person is told in their Help chat) or put it off a day
    if(id.startsWith('ticket|')){try{return send(res,200,await help.decide(id,p.endsWith('/done')?'done':'later',u)),true}catch(e){return send(res,e.status||400,{error:e.message}),true}}
    // only what this person is shown: a report from an agent they may use, anything else for admins and only when it is there
    if(id.startsWith('report|')){const r=await bottlenecks.find(id);if(!r)return send(res,404,{error:'That one is already gone.'}),true;if(users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),r.agent))return send(res,403,{error:'That agent is not shared with you.'}),true}
    else{if(!admin)return send(res,403,{error:'Only admins.'}),true;const cur=await bottlenecks.list({admin:true,mayUse:()=>false,signins:[...signinsDue.values()],invites:users.expiredInvites(),accounts:await accountsApi.signedOut().catch(()=>[]),channels:await channelAttention(false).catch(()=>[])});if(!cur.some(x=>x.id===id))return send(res,404,{error:'That one is already gone.'}),true}
    await (p.endsWith('done')?bottlenecks.done(id):bottlenecks.later(id,admin?null:u.id));return send(res,200,{ok:true}),true}
   // Code › Live › Team folders: the shared folders a person is in (admins see every one), read only
   if(p==='/ui/team-folders'&&req.method==='GET')return send(res,200,{folders:await teamFolders.list(u.id,{all:users.isAdmin(u)})}),true;
   if(p==='/ui/code/devices'&&req.method==='GET')return send(res,200,{devices:await code.devices(u.id)}),true;
   if(p==='/ui/code/unpair'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const n=await code.unpair(u.id,String(b.id||''));return n?send(res,200,{ok:true}):send(res,400,{error:'That computer was not found.'}),true}
   {const dm=/^\/ui\/code\/download\/(windows|mac)$/.exec(p);if(dm&&req.method==='GET'){
    // the aqeelOS app installer (Windows: aqeelOS-Setup.exe, Mac: aqeelOS.dmg). ?check=1 says whether it is there; without one
    // there is nothing to give (the older zip ran Code outside the app, which the browser no longer opens)
    {const f=path.join(DATA,'desktop',dm[1]==='mac'?'aqeelOS.dmg':'aqeelOS-Setup.exe');const st=await stat(f).catch(()=>null);
     // the public release, unless this install has its own newer build (or none is published)
     const rel=await releaseAppVersions(),mine=await localAppVersions(),useRel=rel?.[dm[1]]&&(!st||newerApp(rel[dm[1]],mine[dm[1]]));
     if(url.searchParams.get('check'))return send(res,200,{ok:Boolean(st||useRel)}),true;
     if(useRel){res.writeHead(302,{location:DESKTOP_RELEASES+'/'+path.basename(f),'cache-control':'no-store',...security});return res.end(),true}
     if(st){res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="'+(dm[1]==='mac'?'aqeelOS.dmg':'aqeelOS Setup.exe')+'"','content-length':st.size,...security});return createReadStream(f).pipe(res),true}}
    return send(res,404,{error:'The aqeelOS app for '+(dm[1]==='mac'?'Mac':'Windows')+' isn’t ready yet.'}),true}}
   // an agent's n8n is its workflows, signed in as it: a member needs to be able to change that agent, chatting is not enough
   if(p==='/ui/n8n/spaces'&&req.method==='GET'){const mine=users.isAdmin(u)?null:new Set((await listAgents()).filter(a=>users.atLeast(u,a,'edit')));const all=await n8n.spaces({fresh:url.searchParams.has('fresh')}),l=all.filter(x=>!mine||mine.has(x.agent));
    return send(res,200,{spaces:l.map(x=>({...x,name:NAMES[x.agent]||x.agent,shared:x.shared.filter(a=>!mine||mine.has(a))})),agents:(await listAgents()).filter(a=>!mine||mine.has(a)).map(a=>({id:a,name:NAMES[a]||a})),canEdit:users.isAdmin(u),...(all.partial?{partial:true}:{})}),true}
   if(p==='/ui/n8n/share'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can share an agent’s n8n.'}),true;let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{return send(res,200,await n8n.share(String(b.space||''),String(b.agent||''),!!b.on)),true}catch(e){return send(res,409,{error:e.message}),true}}
   if(p==='/ui/n8n/base'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change the n8n address.'}),true;let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}try{return send(res,200,await n8n.setBase(b.url)),true}catch(e){return send(res,400,{error:e.message}),true}}
   if(p==='/ui/n8n/owner'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can connect n8n.'}),true;let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{await n8n.setOwner(String(b.email||'').trim(),String(b.password||''));console.log('n8n: owner login saved');return send(res,200,{ok:true}),true}catch(e){return send(res,400,{error:e.message}),true}}
   if(p==='/ui/n8n/open'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const a=String(b.agent||'default');
    // admins can open n8n as its owner, to see every agent's workflows
    if(b.owner){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can open n8n as its owner.'}),true;if(!await n8n.ready())return send(res,409,{error:'n8n is not connected yet.'}),true;const st=await n8n.status(a);return send(res,200,{url:st.base+'/aqeelos-login?t='+n8n.ticket('__owner')}),true}if(!(await listAgents()).includes(a))return send(res,400,{error:'Unknown agent'}),true;
    if(!users.isAdmin(u)&&!users.atLeast(u,a,'edit'))return send(res,403,{error:'You can chat with this agent but not open its n8n.'}),true;
    try{const r=await n8n.ensure(a);const st=await n8n.status(a);return send(res,200,{url:st.base+'/aqeelos-login?t='+n8n.ticket(a),email:r.email}),true}catch(e){return send(res,409,{error:e.message}),true}}
   if(p==='/ui/models/agents'&&req.method==='GET'){const ag=(await listAgents()).filter(a=>listedAgent(a)&&(users.isAdmin(u)||users.level(u,a)));   // the agents this person may use (owned or shared)
    // side by side, a few at a time (each a config read; it was one after another)
    const out=await Promise.all(ag.map(a=>cfgLimit(async()=>{const c=await readConfig(a).catch(()=>null)||{};return {id:a,name:NAMES[a]||await displayName(a),model:c.model?.default||'',provider:c.model?.provider||''}})));return send(res,200,{agents:out}),true}
   // Models › AI accounts › If an account fails: each agent's fallback models, as backup-models.mjs keeps them (admins; 1 Nov 2026)
   if(p==='/ui/models/fallbacks'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;const st=await backupModels.status().catch(()=>({agents:[],outages:[]}));return send(res,200,{...st,agents:(st.agents||[]).filter(x=>users.level(u,x.agent))}),true}   // like /ui/models/agents: not a member's private agent
  return false}}
