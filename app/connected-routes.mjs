// System › Connected accounts and settings: the Kirimdev lines, the team group, one-time secret links, automations, backups, engine updates,
// self runs, Tebar, Slack and Microsoft, Google, MCP servers and the app version check (/ui/kirimdev, /ui/team-group, /ui/secret-links,
// /ui/automations, /ui/backups, /ui/engine-updates, /ui/self-runs, /ui/tebar, /ui/slack, /ui/microsoft, /ui/google, /ui/mcp/server,
// /ui/code/app-version...). They used to sit in server.mjs inside the signed-in /ui/ gate. Same checks in the same order; server.mjs calls
// this where the block was (the person `u` is already signed in and the x-hui header already checked) and it answers true when it handled it.
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {peopleOf,approverState,buildApprovers,catalogRows,catalogFromRows,leftOut} from './kirimdev-settings.mjs';
import {RUNS_CODE_MSG} from './addons.mjs';
import {agentNames,LIVE_APP} from './agentops.mjs';
import {publicReach} from './kirimdev.mjs';
import {ROLES as TEAM_ROLES} from './team-group.mjs';
import path from 'node:path';
export function createConnectedRoutes({DASH,DASH_TOKEN,HERMES_HOME,NAMES,PUBLIC_URL,backupModels,backups,engineUpd,gconnect,googleConnected,guard,kirimdev,kirimdevChanged,kirimdevSetup,listAgents,localAppVersions,mcpEdit,msconnect,newerApp,ownsAgent,priceCatalog,privateAddress,readBody,releaseAppVersions,secretLinks,selfRuns,send,slackc,srEligible,syncNotifyTool,teamGroups,teamSettings,tebar,users,whyOf,writeAgentContext}){
 return async function handle(req,res,p,url,u){
   // backups to Google Drive (admins): the state, back up now, a restore test, and the key that unlocks them
   // engine updates (engine-updates.mjs): the setting, "Update tonight", and the list of attempts
   if(p.startsWith('/ui/engine-updates')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}}
    try{if(p==='/ui/engine-updates'&&req.method==='GET')return send(res,200,await engineUpd.status()),true;
     if(p==='/ui/engine-updates/mode'&&req.method==='POST')return send(res,200,await engineUpd.setMode(String(b.mode||''))),true;
     if(p==='/ui/engine-updates/tonight'&&req.method==='POST')return send(res,200,await engineUpd.setTonight(!!b.on)),true}catch(e){return send(res,400,{error:e.message}),true}}
   // run_self (admins, Automations › Runs itself): per-agent switches and limits, trusted people, runs, Stop and Resume
   if(p==='/ui/self-runs'||p.startsWith('/ui/self-runs/')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}}
    const who=u.name||u.username||u.id,ag=String(b.agent||'');
    try{if(req.method==='GET'&&p==='/ui/self-runs'){const all=[];for(const a of await listAgents())if(await srEligible(a))all.push(a);return send(res,200,await selfRuns.overview(all)),true}
     if(req.method==='GET'&&p==='/ui/self-runs/run'){const r=await selfRuns.detail(url.searchParams.get('id'));return r?send(res,200,r):send(res,404,{error:'No such run.'}),true}
     if(req.method!=='POST')return send(res,405,{error:'Not here.'}),true;
     if((p==='/ui/self-runs/settings'||p==='/ui/self-runs/resume')&&!await srEligible(ag))return send(res,400,{error:'That agent cannot run itself.'}),true;
     if(p==='/ui/self-runs/settings')return send(res,200,await selfRuns.setSettings(ag,b,who)),true;
     if(p==='/ui/self-runs/resume')return send(res,200,{ok:await selfRuns.resume(ag,who)}),true;
     if(p==='/ui/self-runs/stop')return send(res,200,{ok:await selfRuns.stop(String(b.id||''),who)}),true;
     if(p==='/ui/self-runs/code'){const c=await selfRuns.newCode({name:b.name,by:who});return send(res,200,{code:c.code,exp:c.exp}),true}
     if(p==='/ui/self-runs/code/cancel')return send(res,200,{ok:await selfRuns.cancelCode(String(b.code||''))}),true;
     if(p==='/ui/self-runs/untrust'){const ok=await selfRuns.untrust(String(b.id||''),who);if(ok)syncNotifyTool().catch(()=>{});return send(res,200,{ok}),true}
     return send(res,404,{error:'Not here.'}),true}catch(e){return send(res,400,{error:e.message}),true}}
   // one-time secret links (admins, System › Keys and secrets): open links (cancel) and what happened, never a value
   // Kirimdev lines (kirimdev.mjs): the API key and its check, each line's status, Test/Draft/Live, the optional webhook
   // Channels › Kirimdev, per line (kirimdev-settings.mjs): who may approve drafts, the price list; admins only
   if(/^\/ui\/kirimdev\/(settings|approvers|prices)$/.test(p)){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;let b={};if(req.method!=='GET'){try{b=JSON.parse(await readBody(req,262144)||'{}')}catch{}}
    try{const a=String(b.agent||url.searchParams.get('agent')||''),L=await kirimdev.lines();if(!L[a])return send(res,404,{error:'No Kirimdev line for that agent.'}),true;
     const people=peopleOf(await teamSettings.policy(),a),cur=L[a].approvers||[];
     if(req.method==='GET'&&p.endsWith('/settings')){const cat=await priceCatalog.of(a);return send(res,200,{people:people.map(x=>({name:x.name,team:x.team})),approvers:approverState(people,cur),prices:{...catalogRows(cat),leftOut:await leftOut({home:homedir(),agent:a,cat})}}),true}
     if(req.method==='PUT'&&p.endsWith('/approvers')){const list=buildApprovers(people,cur,b.people,b.dropOthers);await kirimdev.saveLine(a,{approvers:list});console.log('kirimdev: approvers of',a,'set by',u.id,'('+list.length+')');return send(res,200,{ok:true,approvers:approverState(people,list)}),true}
     if(req.method==='PUT'&&p.endsWith('/prices')){const old=await priceCatalog.of(a),c=catalogFromRows(old,b);await priceCatalog.set(a,{...c,source:old?.source||''});console.log('kirimdev: price list of',a,'saved by',u.id);const cat=await priceCatalog.of(a);return send(res,200,{ok:true,prices:{...catalogRows(cat),leftOut:await leftOut({home:homedir(),agent:a,cat})}}),true}
     return send(res,405,{error:'Not allowed'}),true}catch(e){return send(res,400,{error:e.message}),true}}
   if(p==='/ui/kirimdev'||p==='/ui/kirimdev/setup'||p==='/ui/kirimdev/line'||p==='/ui/kirimdev/disconnect'||p==='/ui/kirimdev/renew'||p==='/ui/kirimdev/test'||p==='/ui/kirimdev/mode'||p==='/ui/kirimdev/release'||p==='/ui/kirimdev/connect'||p==='/ui/kirimdev/pause'||p==='/ui/kirimdev/draft'||p==='/ui/kirimdev/check'||p==='/ui/kirimdev/key'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;
    if(req.method==='GET'&&p==='/ui/kirimdev'){const [lines,account,keySaved,numbers]=await Promise.all([kirimdev.status(),kirimdev.account(),readFile(path.join(HERMES_HOME,'secrets','kirimdev.env'),'utf8').then(t=>/^KIRIMDEV_API_KEY=\S/m.test(t),()=>false),kirimdev.numbers({fresh:url.searchParams.get('fresh')==='1'})]);return send(res,200,{lines,account,keySaved,numbers,reach:publicReach(PUBLIC_URL)}),true}
    if(req.method==='GET'&&p==='/ui/kirimdev/setup')return send(res,200,await kirimdevSetup(String(url.searchParams.get('agent')||''))),true;
    let b={};try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}
    try{if(req.method==='POST'&&p==='/ui/kirimdev/mode')return send(res,200,{ok:await kirimdev.setMode(String(b.agent||''),String(b.mode||''),u.name||'an admin')}),true;
     // release a chat held for the team after a handoff: the agent answers there again
     if(req.method==='POST'&&p==='/ui/kirimdev/release')return send(res,200,{released:b.ref?await kirimdev.releaseRef(String(b.agent||''),String(b.ref),u.name||'an admin'):await kirimdev.release(String(b.agent||''),String(b.phone||''),u.name||'an admin')}),true;
     if(req.method==='POST'&&p==='/ui/kirimdev/pause')return send(res,200,{pauseMin:await kirimdev.setPause(String(b.agent||''),b.min)}),true;
     if(req.method==='POST'&&p==='/ui/kirimdev/draft')return send(res,200,await kirimdev.draft(String(b.agent||''),b.id,String(b.action||''),b.text,u.name||'an admin',{human:true,via:'page',user:u.id||''})),true;
     if(req.method==='POST'&&p==='/ui/kirimdev/connect'){const r=await kirimdev.connectWebhook(String(b.agent||''));kirimdev.check().catch(()=>{});return send(res,200,r),true}
     if(req.method==='POST'&&p==='/ui/kirimdev/check')return send(res,200,await kirimdev.check()),true;
     if(req.method==='POST'&&p==='/ui/kirimdev/key')return send(res,200,await kirimdev.setKey(String(b.key||''))),true;
     // Connect (a new line) or the line's settings changed; the team group is saved with it when one was picked
     if(req.method==='POST'&&p==='/ui/kirimdev/line'){const a=String(b.agent||'');if(!(await listAgents()).includes(a))throw Error('Pick the agent that answers this number.');
      if(b.team&&String(b.team.chatId||'').trim()){const cur=await teamGroups.get(a).catch(()=>null);await teamGroups.set(a,{chatId:b.team.chatId,...(b.team.name?{name:b.team.name}:{}),topics:{...(cur?.topics||{}),questions:b.team.questions??''}},u.name||'an admin')}
      const {team,agent,...rest}=b;const r=await kirimdev.saveLine(a,rest);if(r.isNew)kirimdevChanged();return send(res,200,r),true}
     if(req.method==='POST'&&p==='/ui/kirimdev/disconnect'){const r=await kirimdev.disconnect(String(b.agent||''));kirimdevChanged();return send(res,200,r),true}
     if(req.method==='POST'&&p==='/ui/kirimdev/renew')return send(res,200,await kirimdev.renewSecret(String(b.agent||''))),true;
     if(req.method==='POST'&&p==='/ui/kirimdev/test')return send(res,200,await kirimdev.testSend(String(b.agent||''),b.tester)),true}catch(e){return send(res,400,{error:e.message}),true}}
   // Team group per agent (team-group.mjs): admins read and change it on the Channels page
   if(p==='/ui/team-group'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;
    if(req.method==='GET'){const a=url.searchParams.get('agent')||'';return send(res,200,{group:await teamGroups.get(a),roles:TEAM_ROLES.map(([k,l,what])=>({key:k,label:l,what}))}),true}
    let b={};try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}
    try{const {agent,...patch}=b;if(!(await listAgents()).includes(String(agent||'')))throw Error('Unknown agent.');return send(res,200,{group:await teamGroups.set(String(agent),patch,u.name||'an admin')}),true}catch(e){return send(res,400,{error:e.message}),true}}
   if(p==='/ui/secret-links'||p==='/ui/secret-links/cancel'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;
    if(req.method==='GET'&&p==='/ui/secret-links')return send(res,200,await secretLinks.list()),true;
    if(req.method==='POST'&&p==='/ui/secret-links/cancel'){let b={};try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}return send(res,200,{ok:await secretLinks.cancel(String(b.id||''),u.id)}),true}
    return send(res,405,{error:'Not here.'}),true}
   // automations (automation-guard.mjs): every agent's tool servers and schedules that hit a missing tool; Fix now, Run now
   if(p.startsWith('/ui/automations')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}}
    // with each agent's backup models and an outage switch going on (backup-models.mjs); Check now writes the lists at once
    try{if(p==='/ui/automations'&&req.method==='GET')return send(res,200,{...await guard.status(),models:await backupModels.status().catch(()=>null)}),true;
     if(p==='/ui/automations/models'&&req.method==='POST'){const r=await backupModels.sync('Check now');await backupModels.tick();return send(res,200,{lists:r,...await backupModels.status()}),true}const a=String(b.agent||'');if(!(await agentNames({copies:true})).includes(a))return send(res,400,{error:'Unknown agent'}),true;
     if(p==='/ui/automations/fix'&&req.method==='POST')return send(res,200,guard.startFix(a,String(b.server||''))),true;   // runs in the background; the card shows Fixing until it is done
     if(p==='/ui/automations/run'&&req.method==='POST')return send(res,200,await guard.runJob(a,String(b.job||''))),true}catch(e){return send(res,400,{error:e.message}),true}}
   if(p.startsWith('/ui/backups')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;
    if(p==='/ui/backups'&&req.method==='GET')return send(res,200,await backups.status()),true;
    if(p==='/ui/backups/key'&&req.method==='GET'){try{return send(res,200,{key:await backups.key()}),true}catch(e){return send(res,409,{error:e.message}),true}}
    if(p==='/ui/backups/run'&&req.method==='POST'){if(backups.busy())return send(res,409,{error:'A restore is running. Back up after it finishes.'}),true;backups.run('by hand').catch(()=>{});return send(res,200,{started:true}),true}
    if(p==='/ui/backups/test'&&req.method==='POST'){try{return send(res,200,await backups.test()),true}catch(e){return send(res,400,{error:e.message}),true}}
    if(p==='/ui/backups/list'&&req.method==='GET'){try{return send(res,200,await backups.list()),true}catch(e){return send(res,400,{error:e.message}),true}}
    if(p==='/ui/backups/estimate'&&req.method==='GET'){try{return send(res,200,await backups.estimate(url.searchParams.get('id'))),true}catch(e){return send(res,e.status||400,{error:e.message}),true}}
    // an existing key typed in, the settings, and the two steps of a restore: Prepare (a preview, nothing changes) and Restore now
    if(req.method!=='GET'){let b={};try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}const ok=x=>send(res,200,x),bad=e=>send(res,e.status||400,{error:e.message,...(e.replace?{replace:true}:{})});
     if(p==='/ui/backups/key'&&req.method==='POST')return backups.setKey(b.key,{replace:!!b.replace}).then(ok,bad),true;
     if(p==='/ui/backups/settings'&&req.method==='PUT')return backups.setSettings(b).then(x=>ok({settings:x}),bad),true;
     if(p==='/ui/backups/prepare'&&req.method==='POST')return backups.prepare(String(b.id||'')).then(ok,bad),true;
     if(p==='/ui/backups/cancel'&&req.method==='POST')return backups.cancel().then(ok,bad),true;}
    // a restore stops and starts the real agents, so only the live app does it (a test copy shares the box's engine)
    if(p==='/ui/backups/restore'&&req.method==='POST'){if(!LIVE_APP)return send(res,409,{error:'Only the live app restores backups.'}),true;if(engineUpd.busy())return send(res,409,{error:'The engine is updating. Restore after it finishes.'}),true;try{return send(res,200,await backups.apply()),true}catch(e){return send(res,e.status||400,{error:e.message}),true}}}
   // Connect Google (google-connect.mjs): the OAuth client file, Connect and Reconnect, a pasted address, check, remove.
   // 11 Nov 2026 (Fakhri, an employee on P&P, could not connect Google for his own agent): the install's Google client is
   // an admin's one-time setup; connecting a Google account is for admins and for the agent's own owner, on that agent only.
   // Tebar webhook settings (tebar.mjs, 11 Nov 2026): the address to give Tebar, the whsec_ secret it showed once (never sent
   // back), the events. One agent's own connection: an admin or that agent's owner
   if(p==='/ui/tebar/hook'){let b={};if(req.method!=='GET'){try{b=JSON.parse(await readBody(req,16384)||'{}')}catch{return send(res,400,{error:'Bad request'}),true}}
    const a=String(b.agent||url.searchParams.get('agent')||'');if(!(await agentNames()).includes(a))return send(res,400,{error:'Unknown agent'}),true;
    if(!ownsAgent(u,a))return send(res,403,{error:'Only an admin or this agent’s owner sets up its Tebar webhook.'}),true;
    try{if(req.method==='GET')return send(res,200,await tebar.view(a)),true;if(req.method==='POST')return send(res,200,await tebar.set(a,{secret:b.secret,events:b.events})),true;if(req.method==='DELETE')return send(res,200,await tebar.remove(a)),true}catch(e){return send(res,e.status||400,{error:e.message}),true}
    return send(res,405,{error:'GET, POST or DELETE'}),true}
   // Set up Slack and Connect Microsoft (slack-connect.mjs, microsoft-connect.mjs), 11 Nov 2026: the same rules as Google.
   // The install's app (ID and secret) is an admin's one-time setup; connecting an account is for admins and the
   // agent's own owner, on that agent only. A secret is never sent back or logged.
   if(p.startsWith('/ui/slack/')||p.startsWith('/ui/microsoft/')){const admin=users.isAdmin(u),slack=p.startsWith('/ui/slack/');let b={};
    if(req.method!=='GET'){try{b=JSON.parse(await readBody(req,16384)||'{}')}catch{return send(res,400,{error:'Bad request'}),true}}
    const ok=x=>send(res,200,x),bad=e=>send(res,e.status||400,{error:e.message}),ag=String(b.agent||url.searchParams.get('agent')||(admin?'default':''));
    const mine=a=>admin||users.level(u,a)==='owner',all=await agentNames(),own=all.filter(mine),sub=p.replace(/^\/ui\/(slack|microsoft)/,'');
    if(sub==='/client'&&!admin)return send(res,403,{error:'Only an admin sets this up for the install (once).'}),true;
    if(['/connect','/check','/account','/flow'].includes(sub)){if(!all.includes(ag))return send(res,400,{error:'Unknown agent'}),true;if(!mine(ag))return send(res,403,{error:'You can connect accounts only for your own agents.'}),true}
    const agentsOut=async()=>Promise.all(own.map(async a=>({id:a,name:NAMES[a]||a,...(slack?{slack:await slackc.slackOf(a).catch(()=>null)}:{})})));
    if(slack){
     if(sub==='/state'&&req.method==='GET')return ok({...await slackc.info(all),agents:await agentsOut(),canSetUp:admin}),true;
     if(sub==='/client'&&req.method==='POST')return slackc.saveClient(b,all).then(ok,bad),true;
     if(sub==='/client'&&req.method==='DELETE')return slackc.removeClient(all).then(ok,bad),true;
     if(sub==='/connect'&&req.method==='POST'){const s=await slackc.slackOf(ag).catch(()=>null);await whyOf.noteApp(ag,s?.name||'slack',{by:'person',admin,who:u.name||u.username||''}).catch(()=>{});return slackc.connect(ag).then(ok,bad),true}
     if(sub==='/flow'&&req.method==='GET'){const id=String(url.searchParams.get('id')||'');if(!/^[\w.-]{1,120}$/.test(id))return send(res,400,{error:'Bad flow'}),true;
      const f=await fetch(DASH.origin+'/api/mcp/oauth/flows/'+encodeURIComponent(id)+'?profile='+encodeURIComponent(ag),{headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(15000)}).then(r=>r.json()).catch(()=>({}));
      return ok({status:String(f.status||''),error:f.error?String(f.error).slice(0,300):''}),true}}
    else{
     if(sub==='/state'&&req.method==='GET'){const accounts=(await Promise.all(own.map(a=>msconnect.accounts(a)))).flat().map(x=>({...x,agentName:NAMES[x.agent]||x.agent}));return ok({...await msconnect.info(),accounts,agents:await agentsOut(),canSetUp:admin}),true}
     if(sub==='/client'&&req.method==='POST')return msconnect.saveClient(b).then(ok,bad),true;
     if(sub==='/client'&&req.method==='DELETE')return msconnect.removeClient().then(ok,bad),true;
     if(sub==='/connect'&&req.method==='POST')return msconnect.start({agent:ag,name:b.name,services:Array.isArray(b.services)?b.services:undefined,reconnect:!!b.reconnect}).then(ok,bad),true;
     if(sub==='/result'&&req.method==='GET')return msconnect.result(String(url.searchParams.get('state')||'')).then(ok,bad),true;
     if(sub==='/check'&&req.method==='POST')return msconnect.check(ag,String(b.name||'')).then(ok,bad),true;
     if(sub==='/account'&&req.method==='DELETE')return msconnect.remove(ag,String(b.name||'')).then(r=>{if(LIVE_APP)writeAgentContext().catch(()=>{});return ok(r)},bad),true}
    return send(res,404,{error:'Not found'}),true}
   if(p.startsWith('/ui/google/')){const admin=users.isAdmin(u);let b={};if(req.method!=='GET'){try{b=JSON.parse(await readBody(req,65536)||'{}')}catch{return send(res,400,{error:'Bad request'}),true}}
    const ok=x=>send(res,200,x),bad=e=>send(res,e.status||400,{error:e.message}),ag=String(b.agent||url.searchParams.get('agent')||(admin?'default':''));
    if(p==='/ui/google/client'&&!admin)return send(res,403,{error:'Only an admin sets up Google for this install (once, in Connections › Connect Google).'}),true;
    if(p==='/ui/google/client/check'&&!admin)return send(res,403,{error:'Only an admin sets up Google for this install.'}),true;
    const mine=a=>admin||users.level(u,a)==='owner';
    if(p!=='/ui/google/result'&&p!=='/ui/google/finish'&&p!=='/ui/google/client'&&p!=='/ui/google/client/check'&&p!=='/ui/google/state'&&!(await agentNames()).includes(ag))return send(res,400,{error:'Unknown agent'}),true;
    if(['/ui/google/connect','/ui/google/check','/ui/google/account'].includes(p)&&!mine(ag))return send(res,403,{error:'You can connect Google only for your own agents.'}),true;
    if(p==='/ui/google/state'&&req.method==='GET'&&!admin){const own=(await agentNames()).filter(mine);const accounts=(await Promise.all(own.map(a=>gconnect.accounts(a)))).flat().map(x=>({...x,agentName:NAMES[x.agent]||x.agent}));const inf=await gconnect.info();return ok({...inf,accounts,agents:own.map(a=>({id:a,name:NAMES[a]||a})),canSetUp:false}),true}
    if(p==='/ui/google/state'&&req.method==='GET'){const all=await agentNames();const accounts=(await Promise.all(all.map(a=>gconnect.accounts(a)))).flat().map(x=>({...x,agentName:NAMES[x.agent]||x.agent}));return ok({...await gconnect.info(),accounts,agents:all.map(a=>({id:a,name:NAMES[a]||a}))}),true}
    // the guided setup (11 Nov 2026): check a client file against this install without saving it, and ask Google whether it takes it
    if(p==='/ui/google/client/check'&&req.method==='POST')return gconnect.checkFile({json:b.json==null?'':String(b.json),project:String(b.project||''),test:!!b.test}).then(ok,bad),true;
    if(p==='/ui/google/client'&&req.method==='POST')return gconnect.saveClient(String(b.json||'')).then(ok,bad),true;
    if(p==='/ui/google/client'&&req.method==='DELETE')return gconnect.removeClient().then(ok,bad),true;
    if(p==='/ui/google/connect'&&req.method==='POST')return gconnect.start({agent:ag,name:b.name,services:Array.isArray(b.services)?b.services:undefined,reconnect:!!b.reconnect}).then(ok,bad),true;
    if(p==='/ui/google/result'&&req.method==='GET')return gconnect.result(String(url.searchParams.get('state')||'')).then(ok,bad),true;
    if(p==='/ui/google/finish'&&req.method==='POST')return gconnect.finish(String(b.address||'')).then(r=>{googleConnected(r,u.name||u.email||'');return ok(r)},bad),true;
    if(p==='/ui/google/check'&&req.method==='POST')return gconnect.check(ag,String(b.name||'')).then(ok,bad),true;
    if(p==='/ui/google/account'&&req.method==='DELETE')return gconnect.remove(ag,String(b.name||'')).then(r=>{if(LIVE_APP)writeAgentContext().catch(()=>{});return ok(r)},bad),true;
    return send(res,404,{error:'Not found'}),true}
   // an app that is already added: edit its address, sign-in and key, or its command; its key and keys nothing reads (admins)
   if(p==='/ui/mcp/server'||p==='/ui/mcp/keys'){let b={};if(req.method!=='GET'){try{b=JSON.parse(await readBody(req,65536)||'{}')}catch{return send(res,400,{error:'Bad request'}),true}}
    const ag=String(b.agent||url.searchParams.get('agent')||'default'),ok=x=>send(res,200,x),bad=e=>send(res,e.status||400,{error:e.message});if(!(await agentNames()).includes(ag))return send(res,400,{error:'Unknown agent'}),true;
    if(!ownsAgent(u,ag)||url.searchParams.get('all')==='1'&&!users.isAdmin(u))return send(res,403,{error:'Only an admin or this agent’s owner changes its apps and keys.'}),true;
    if(p==='/ui/mcp/server'&&req.method==='GET')return mcpEdit.get(ag,String(url.searchParams.get('name')||''),{own:users.isAdmin(u)}).then(ok,bad),true;
    // the same rules as adding an app (/hapi/mcp/servers): a command needs the "unsafe" permission, an address must be public (audit H-3)
    if(p==='/ui/mcp/server'&&req.method==='PUT')return mcpEdit.save(ag,b,{mayRunCode:users.isAdmin(u)||users.can(u,'unsafe'),own:users.isAdmin(u),privateAddress:users.isAdmin(u)?null:privateAddress,runsCodeMsg:RUNS_CODE_MSG}).then(ok,bad),true;
    if(p==='/ui/mcp/keys'&&req.method==='GET'){if(url.searchParams.get('all')==='1'){const out=[];for(const a of await agentNames())for(const k of await mcpEdit.keys(a).catch(()=>[]))out.push({...k,agent:a,agentName:NAMES[a]||a});return ok({keys:out}),true}return mcpEdit.keys(ag).then(k=>ok({keys:k}),bad),true}
    if(p==='/ui/mcp/keys'&&req.method==='DELETE')return mcpEdit.removeKey(ag,String(b.key||'')).then(ok,bad),true;
    return send(res,405,{error:'Not allowed'}),true}
   // which aqeelOS app version is current (the app offers to update itself when it is older)
   if(p==='/ui/code/app-version'&&req.method==='GET'){const [l,r]=await Promise.all([localAppVersions(),releaseAppVersions()]);const v={};for(const k of ['mac','windows']){const n=newerApp(r?.[k],l[k])?r[k]:l[k];if(n)v[k]=n}return send(res,200,v),true}
  return false}}
