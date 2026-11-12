// Connected apps' sign-ins, secrets and the person's own browser: sign-ins that ran out, a connected app copied to other agents, starting and
// preparing a sign-in, duplicating or renaming an ability, every channel (admins), giving a secret and the ones an agent waits for, the local
// browser extension, the browser choice and a secret typed in for an agent (/ui/mcp/signins, /ui/mcp/share, /ui/mcp/start-signin,
// /ui/mcp/prepare-signin, /ui/mcp/oauth-redirect, /ui/share/duplicate, /ui/share/rename-mcp, /ui/channels, /ui/secrets/*, /ui/local-browser/*,
// /ui/browser-choice/<id>). They used to sit in server.mjs inside the signed-in /ui/ gate. Same checks in the same order; server.mjs calls this
// where the block was (the person `u` is already signed in and the x-hui header already checked) and it answers true when it handled the request.
import path from 'node:path';
import {readConfig,pick,setKey} from './agentops.mjs';
import {readdir,mkdir,copyFile,readFile,stat} from 'node:fs/promises';
export function createMcpSecretsRoutes({access,browserAsks,channelList,displayName,freshSignins,HERMES_HOME,listAgents,localBrowser,MCP_OAUTH_BASE,memberSecretName,NAMES,optins,ownsAgent,readBody,saveSecret,secretAsks,secretDir,secretHow,security,send,sharing,signinsAt,signinsDue,slackClientFor,startSignin,users,useSecret,whyOf}){
 return async function handle(req,res,p,url,u){
   if(p==='/ui/mcp/signins'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,200,{items:[]}),true;await freshSignins();
    // for each, the other agents that are signed in to the same app (their sign-in can be used instead)
    const l=await access.list('mcp').catch(()=>({items:[]}));
    return send(res,200,{checked:signinsAt(),items:await Promise.all([...signinsDue.values()].map(async x=>{const it=l.items.find(y=>y.id===x.name);
     const siblings=await Promise.all((x.siblings||[]).map(async s=>({...s,account:await whyOf.accountOf(x.agent,s.name)})));
     return {...x,account:x.account||await whyOf.accountOf(x.agent,x.name),siblings,others:(it?.users||[]).filter(u2=>u2.signed&&u2.id!==x.agent).map(u2=>({id:u2.id,name:u2.name}))}}))}),true}
   // "Use on other agents": a connected app (its settings and its sign-in) copied to other agents, so a second
   // agent can use n8n, Notion… without signing in again. The agents restart once nobody is mid-reply.
   if(p==='/ui/mcp/share'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can share connected apps between agents.'}),true;
    const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);const all=await listAgents();
    if(req.method==='GET'){const from=String(url.searchParams.get('from')||'default'),name=String(url.searchParams.get('name')||'');
     const out=[];for(const a of all){if(a===from)continue;const c=await readConfig(a).catch(()=>null);out.push({id:a,name:NAMES[a]||await displayName(a),has:!!pick(c||{},'mcp_servers.'+name)})}return send(res,200,{agents:out}),true}
    if(req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const from=String(b.from||'default'),name=String(b.name||'');const to=(Array.isArray(b.to)?b.to:[]).map(String).filter(a=>all.includes(a)&&a!==from);
     if(!/^[\w.-]{1,64}$/.test(name)||name==='aqeelos-notify')return send(res,400,{error:'This app can’t be shared.'}),true;
     const src=pick(await readConfig(from).catch(()=>null)||{},'mcp_servers.'+name);if(!src||typeof src!=='object')return send(res,404,{error:'That app isn’t set up on this agent.'}),true;
     const tokDir=path.join(homeOf(from),'mcp-tokens');const toks=(await readdir(tokDir).catch(()=>[])).filter(f=>f===name+'.json'||f.startsWith(name+'.')&&/\.(meta|client)\.json$/.test(f));
     const done=[];for(const a of to){const r=await setKey(a,'mcp_servers.'+name,src);if(!r.ok)return send(res,500,{error:(NAMES[a]||a)+': '+(r.err||'could not save')}),true;
      const dst=path.join(homeOf(a),'mcp-tokens');await mkdir(dst,{recursive:true,mode:0o700});for(const f of toks)await copyFile(path.join(tokDir,f),path.join(dst,f)).catch(()=>{});done.push(NAMES[a]||a)}
     if(done.length){console.log('connected app',name,'from',from,'now also on',done.join(', '),'(applied by the engine itself, no restart)');for(const a of to)await optins.setApp(a,name,true).catch(()=>{})}
     return send(res,200,{ok:true,agents:done}),true}}
   if(p==='/ui/mcp/start-signin'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default'),tool=String(b.name||'');
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'Not your agent.'}),true;
    // who started it: an admin's own sign-in is never asked about as an unknown login (connected-accounts.mjs ownerMade)
    await whyOf.noteApp(ag,tool,{by:'person',admin:users.isAdmin(u),who:u.name||u.username||''}).catch(()=>{});
    try{const pr=await sharing.prepareSignin(ag,tool,MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(tool),null,slackClientFor);if(pr.changed)await new Promise(r=>setTimeout(r,2500));return send(res,200,await startSignin(ag,tool)),true}catch(e){return send(res,400,{error:e.message}),true}}
   if(p==='/ui/mcp/prepare-signin'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default');
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'Not your agent.'}),true;
    try{const r=await sharing.prepareSignin(ag,String(b.name||''),MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(String(b.name||'')),null,slackClientFor);if(r.changed)await new Promise(r=>setTimeout(r,2500));return send(res,200,r),true}catch(e){return send(res,400,{error:e.message}),true}}
   if(p==='/ui/mcp/oauth-redirect'&&req.method==='GET')return send(res,200,{redirect:MCP_OAUTH_BASE+'/api/mcp/oauth/callback/'+encodeURIComponent(url.searchParams.get('name')||'')}),true;
   if(p==='/ui/share/duplicate'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const ag=String(b.agent||'default');
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+ag+'/soul','PUT',new URLSearchParams(),ag)!==null)return send(res,403,{error:'You can only change agents you may edit.'}),true;
    if(b.kind==='schedule'&&!users.isAdmin(u)&&!users.can(u,'schedules'))return send(res,403,{error:'Your role does not include schedules.'}),true;
    if(b.kind==='mcp'&&!users.can(u,'unsafe')&&!users.isAdmin(u))return send(res,403,{error:'Ask an admin to duplicate MCP tools.'}),true;
    try{return send(res,200,await sharing.duplicate(String(b.kind||''),ag,String(b.name||''),String(b.to||''))),true}catch(e){return send(res,400,{error:e.message}),true}}
   if(p==='/ui/share/rename-mcp'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}if(!ownsAgent(u,b.agent||'default'))return send(res,403,{error:'Only an admin or this agent’s owner renames its apps.'}),true;try{return send(res,200,await sharing.renameMcp(String(b.agent||'default'),String(b.from||''),String(b.to||''))),true}catch(e){return send(res,400,{error:e.message}),true}}
   // channels across all agents (admins), and handing one to another agent
   if(p==='/ui/channels'&&req.method==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can see every channel.'}),true;return send(res,200,await channelList(url.searchParams.has('fresh'))),true}
   // WhatsApp: clear a login that WhatsApp has ended, so a fresh QR can link the phone again
   if(p==='/ui/secrets/give'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,20000))}catch{}const base=String(b.agent||'default').split('--')[0];
    if(!(await listAgents()).includes(base))return send(res,400,{error:'Unknown agent'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+base,'GET',new URLSearchParams(),base))return send(res,403,{error:'Not your agent.'}),true;
    const label=String(b.label||'').trim().slice(0,140),value=String(b.value||'');if(!label)return send(res,400,{error:'Say what it is, so the agent knows when to use it.'}),true;if(!value||value.length>8000)return send(res,400,{error:'Type or paste the value.'}),true;
    let name=String(b.name||'').trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40);if(!/^[A-Z]/.test(name))name='SECRET_'+name;if(name.length<3)name='SECRET_'+Date.now().toString(36).toUpperCase();
    // anyone but an admin writes SECRET_<NAME> only: never a name the engine, a shell or the app reads (BASH_ENV, HTTPS_PROXY, PUBLIC_URL...)
    if(!users.isAdmin(u))name=memberSecretName(name);
    // a member who may only chat cannot replace a key that already exists and was not given as a secret
    if(!users.isAdmin(u)&&users.gate(u,'/hapi/profiles/'+base+'/soul','PUT',new URLSearchParams(),base)){const envT=await readFile(path.join(base==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',base),'.env'),'utf8').catch(()=>'');if(new RegExp('^'+name+'=','m').test(envT)&&!await stat(path.join(secretDir(base),name)).catch(()=>null))name='SECRET_'+name}
    try{await saveSecret(base,name,value,{admin:users.isAdmin(u)})}catch(e){return send(res,400,{error:e.message}),true}console.log('secret saved for',base,'('+name+')');
    return send(res,200,{ok:true,name,message:'🔒 '+label+' — saved for you as '+name+'. You cannot see the value. '+secretHow(base,name)}),true}
   if(p==='/ui/secrets/pending'&&req.method==='GET'){const ag=String(url.searchParams.get('agent')||'default').split('--')[0];
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+ag,'GET',new URLSearchParams(),ag))return send(res,200,{items:[]}),true;
    return send(res,200,{items:[...[...secretAsks.values()].filter(x=>x.base===ag).map(x=>({id:x.id,label:x.label,mode:x.mode,name:x.name,enter:x.enter,t:x.t,expires:x.t+270000})),
     ...[...browserAsks.values()].filter(x=>x.base===ag).map(x=>({id:x.id,kind:'browser',task:x.task,suggest:x.suggest,why:x.why,t:x.t,expires:x.t+270000,connected:localBrowser.connected(u.id)}))]}),true}
   if(p==='/ui/local-browser/pair'&&req.method==='POST')return send(res,200,{token:await localBrowser.pair(u.id)}),true;
   if(p==='/ui/local-browser/version'&&req.method==='GET')return send(res,200,{latest:await localBrowser.latest()}),true;
   if(p==='/ui/local-browser/status'&&req.method==='GET')return send(res,200,{connected:localBrowser.connected(u.id),version:localBrowser.version(u.id),latest:await localBrowser.latest(),session:url.searchParams.get('session')?localBrowser.linked(url.searchParams.get('session')):undefined}),true;
   if(p==='/ui/local-browser/extension.zip'&&req.method==='GET'){const z=await localBrowser.zip();res.writeHead(200,{'content-type':'application/zip','content-disposition':'attachment; filename="aqeelos-browser.zip"','content-length':z.length,...security});return res.end(z),true}
   if(p==='/ui/local-browser/frame'&&req.method==='GET'){const ses=url.searchParams.get('session')||'';if(ses)localBrowser.retitle(ses,url.searchParams.get('title')||'');const r=await localBrowser.ask(u.id,'frame',6000,ses?{session:ses}:{});res.writeHead(200,{'content-type':'application/json','cache-control':'no-store',...security});return res.end(JSON.stringify({connected:!r.offline,...r,type:undefined,id:undefined})),true}
   if(p==='/ui/local-browser/focus'&&req.method==='POST'){const ses=url.searchParams.get('session')||'';return send(res,200,await localBrowser.ask(u.id,'focus',6000,ses?{session:ses}:{})),true}
   if(p==='/ui/local-browser/off'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}return send(res,200,{ok:localBrowser.unlink(String(b.session||''),users.isAdmin(u)?null:u.id)}),true}
   {const bm=/^\/ui\/browser-choice\/([\w-]+)$/.exec(p);if(bm&&req.method==='POST'){const rec=browserAsks.get(bm[1]);if(!rec)return send(res,404,{error:'This question has ended. Ask the agent again.'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+rec.base,'GET',new URLSearchParams(),rec.base))return send(res,403,{error:'Not your agent.'}),true;
    let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const session=String(b.session||'');
    // the chat named must be the caller's own, whichever browser they pick
    if(session&&!users.isAdmin(u)&&users.ownerOf(session)!==u.id)return send(res,403,{error:'That chat is not yours.'}),true;
    if(b.where==='yours'){if(!session)return send(res,400,{error:'Open the chat the agent is working in, then choose.'}),true;
     try{await localBrowser.link(u.id,rec.base,session,String(b.title||''))}catch(e){return send(res,409,{error:e.message}),true}
     browserAsks.delete(rec.id);rec.resolve({text:'The person chose their own browser. Its tools (browser_navigate, browser_snapshot, browser_click, browser_type, browser_press, browser_scroll, browser_back) are added from your next turn and run in their Chrome, in a separate window they can watch, with the sign-ins they already have there. End this turn now with one short line saying you are ready; aqeelOS then tells you to go ahead. In this chat do not use browser_exec (that one runs on the AI box). Screenshots and browser_vision are not available in their browser; read pages with browser_snapshot. Ask before you submit anything that sends, pays, deletes or invites.'});return send(res,200,{ok:true}),true}
    if(session)localBrowser.unlink(session,users.isAdmin(u)?null:u.id);browserAsks.delete(rec.id);rec.resolve({text:'The person chose your screen on the AI box. Use your browser as usual there.'});return send(res,200,{ok:true}),true}}
   {const sm=/^\/ui\/secrets\/([\w-]+)$/.exec(p);if(sm&&req.method==='POST'){const rec=secretAsks.get(sm[1]);if(!rec)return send(res,404,{error:'This request has ended. Ask the agent again.'}),true;
    if(!users.isAdmin(u)&&users.gate(u,'/ui/screens/'+rec.base,'GET',new URLSearchParams(),rec.base))return send(res,403,{error:'Not your agent.'}),true;
    let b={};try{b=JSON.parse(await readBody(req,20000))}catch{}
    if(b.cancel){secretAsks.delete(rec.id);rec.resolve({text:'The person chose not to give it. Do not ask again unless they say so.',isError:true});return send(res,200,{ok:true}),true}
    const value=String(b.value||'');if(!value||value.length>8000)return send(res,400,{error:'Type or paste the value first.'}),true;
    try{const text=await useSecret(rec,value,{admin:users.isAdmin(u)});secretAsks.delete(rec.id);rec.resolve({text});console.log('secret given to',rec.agent,'('+rec.mode+(rec.name?' '+rec.name:'')+')');return send(res,200,{ok:true,text:rec.mode==='type'?'Typed into the screen.':'Saved as '+rec.name+'.'}),true}
    catch(e){return send(res,409,{error:e.message}),true}}}   // stays open: the person can fix it (open the screen) and send again
  return false}}
