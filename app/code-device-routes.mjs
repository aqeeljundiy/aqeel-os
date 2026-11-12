// The routes the aqeelOS Code desktop app calls with the key it got when it was paired (Authorization: Bearer aqc_..., /ui/code/*): no cookie, the
// key is the sign-in. They used to sit in server.mjs. Same checks in the same order; server.mjs hands the request over just before the /ui/ gate
// and this answers true when it handled it, as signin-routes.mjs does.
import {stat,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {accountHooks} from './accounts.mjs';
import {readConfig} from './agentops.mjs';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {hostSetting,onlineCodeOn,ONLINE_CODE_MSG} from './install-routes.mjs';
export function createCodeDeviceRoutes({API_KEY,GATE,NAMES,accountsApi,agentDefaults,agentModel,code,codeAgents,codeAsk,codeBridge,codeOnline,codeProvName,codeRuns,displayName,googleContext,isTestAgent,listAgents,listAllProfiles,live,liveEnd,liveStart,longFetch,readBody,runOwner,security,send,sign,teamFolders,usage,users}){
 return async function handle(req,res,p,url){
  // aqeelOS Code (the desktop app) calls these with the key it got when it was paired; nothing else may
  if(p.startsWith('/ui/code/')&&/^Bearer aqc_/.test(req.headers.authorization||'')){const dev=await code.who(String(req.headers.authorization).slice(7));if(!dev)return send(res,401,{error:'This computer is not paired any more. Open Code in aqeelOS to pair it again.'}),true;
   let who=users.byId(dev.user);if(!who)return send(res,401,{error:'The person this computer was paired for no longer exists.'}),true;
   // the box's own Code copy is paired as the owner but used by everyone on Code online: listing and asking agents and
   // publishing, models and engine runs act only as a person aqeelOS signed for (x-aq-act: <uid>.<exp>.<sig>, a few
   // minutes), never as the owner. The box's copy is known by the flag aqeelOS set when it paired it, not by its name.
   const BOX=dev.user==='owner'&&dev.box===true;
   if(BOX&&!onlineCodeOn())return send(res,410,{error:ONLINE_CODE_MSG}),true;   // a leftover workspace on the server is refused too
   if(BOX&&/^\/ui\/code\/(ask|publish|agents|agent-model|run-ticket|engine\/(run|stop|approval))$/.test(p)){const [uid,exp,sg]=String(req.headers['x-aq-act']||'').split('.');
    const ok=!!uid&&Number(exp)>Date.now()&&Number(exp)<Date.now()+600e3&&!!sg&&(()=>{const x=Buffer.from(sg),y=Buffer.from(sign('code-act:'+uid+'.'+exp));return x.length===y.length&&timingSafeEqual(x,y)})();
    who=ok?users.byId(uid):null;if(!who)return send(res,403,{error:'Online Code can do this only for a signed-in person. Use Code on your own computer for now.'}),true}
   /* Team folders (Plan 4, 25 Oct 2026): a person's own Code shares a project folder, pushes and pulls, as the person the
      device key is for. git's smart HTTP is at /ui/code/team/git/<id>.git/...; the rest are small JSON calls. The box's own
      copy is used by everyone, so it has no team folders: they live on each person's computer. */
   if(p.startsWith('/ui/code/team')){if(BOX)return send(res,403,{error:'Team folders work in Code on your own computer.'}),true;
    if(p.startsWith('/ui/code/team/git/'))return teamFolders.serve(req,res,who.id,p.slice(18),url.searchParams),true;
    let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,65536)||'{}')}catch{}}const q=url.searchParams;
    try{if(p==='/ui/code/team'&&req.method==='GET')return send(res,200,{me:who.id,folders:await teamFolders.list(who.id)}),true;
     if(p==='/ui/code/team/folder'&&req.method==='GET')return send(res,200,await teamFolders.get(String(q.get('id')||''),who.id)),true;
     if(p==='/ui/code/team/history'&&req.method==='GET')return send(res,200,{pushes:await teamFolders.history(String(q.get('id')||''),who.id)}),true;
     if(p==='/ui/code/team/share'&&req.method==='POST'){const f=await teamFolders.create(who.id,{name:b.name,members:b.members,chats:b.chats});console.log('team folders: '+(who.name||who.id)+' shared',f.id);return send(res,200,f),true}
     if(p==='/ui/code/team/update'&&req.method==='POST')return send(res,200,await teamFolders.update(String(b.id||''),who.id,{name:b.name,members:b.members,chats:b.chats})),true;
     if(p==='/ui/code/team/unshare'&&req.method==='POST')return send(res,200,await teamFolders.unshare(String(b.id||''),who.id)),true}catch(e){return send(res,e.status||400,{error:e.message}),true}
    return send(res,404,{error:'Not found'}),true}
   const mine=a=>!users.gate(who,'/gapi/api/model/options','GET',new URLSearchParams(),a);   // the agents this person may chat with (shared, owned, not someone's private one)
   if(p==='/ui/code/whoami')return send(res,200,{name:who.name||who.id,user:who.id,liveDomain:hostSetting('liveDomain')}),true;
   // the agents this person may use in Code; intro=1 adds each one's introduction for a run (what it is for, its skills by
   // name, and for an agent they own a short digest of its work notes), for the ids asked (ids=a,b) only
   if(p==='/ui/code/agents'){const intro=url.searchParams.get('intro')==='1',want=intro?new Set(String(url.searchParams.get('ids')||'').split(',').filter(Boolean).slice(0,8)):null;const out=[];
    for(const a of await listAgents()){if(!mine(a)||await isTestAgent(a)||want&&!want.has(a))continue;const c=await readConfig(a).catch(()=>null)||{};
     out.push({id:a,name:NAMES[a]||await displayName(a),apps:Object.keys(c.mcp_servers||{}).filter(n=>n!=='aqeelos-notify'),google:(await googleContext(a).catch(()=>[])).length,...(intro?await codeAgents.intro(a,{memory:users.level(who,a)==='owner'}):{})})}return send(res,200,{agents:out}),true}
   // a run's ticket: the agents attached to one Code message, each one this person may chat with; aqeelos_ask may then
   // ask only those (checked here again on every ask)
   if(p==='/ui/code/run-ticket'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const all=await listAgents();
    const list=[...new Set((Array.isArray(b.agents)?b.agents:[]).map(String))].slice(0,6);for(const a of list)if(!all.includes(a)||!mine(a)||await isTestAgent(a))return send(res,403,{error:'You can’t use one of those agents.'}),true;
    return send(res,200,{ticket:codeAgents.ticket(who.id,list,b.project),agents:await Promise.all(list.map(async a=>({id:a,name:NAMES[a]||await displayName(a)})))}),true}
   // one ask from a run: only an agent attached to it (the ticket), that this person may still chat with; files come
   // back with the answer (Code saves them in the project; nothing is written on the person's computer from here)
   if(p==='/ui/code/ask'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,65536))}catch{}const a=String(b.agent||'');const t=codeAgents.ticketAgents(b.ticket,who.id);
    if(!t||!t.agents.includes(a))return send(res,403,{error:'Only the agents attached to this message in Code can be asked'+(t?.agents.length?' ('+t.agents.join(', ')+')':'')+'.'}),true;
    if(!(await listAgents()).includes(a)||!mine(a))return send(res,403,{error:'You can’t ask that agent.'}),true;const task=String(b.task||'').slice(0,20000);if(!task)return send(res,400,{error:'Say what the agent should do.'}),true;
    try{const r=await codeAsk(who,a,task,{project:b.project,plan:!!b.plan});console.log('code: '+(who.name||who.id)+' asked',a,'from aqeelOS Code'+(r.files.length?' ('+r.files.length+' files)':''));
     return send(res,200,{agent:a,agentName:r.agentName,text:r.text,files:b.plan?r.files.map(f=>({name:f.name,size:f.data.length})):r.files.map(f=>({name:f.name,size:f.data.length,data:f.data.toString('base64')}))}),true}catch(e){return send(res,e.status||502,{error:e.message}),true}}
   // Code's models and account for one agent: the models the chat's menu lists for that agent (a member: only the ones
   // they may use) and the account it is on (Models page), asked again for every run, so a switch counts at once. Only
   // the box's own copy, on this machine, gets the Claude account's folder; a person's computer keeps its own
   // sign-in and is never sent an account path or secret. No agent: the models of the agent this person would chat with.
   if(p==='/ui/code/agent-model'&&req.method==='GET'){const box=BOX;const may=(await listAgents()).filter(mine),want=String(url.searchParams.get('agent')||'');
    if(want&&!may.includes(want))return send(res,403,{error:'You can’t use that agent.'}),true;const a=want||(may.includes('default')?'default':may[0]||'');
    const r=want?await accountsApi.codeRoute(want).catch(()=>null):null;let models=null,engineModels=null;
    try{const o=await fetch(GATE.origin+(a&&a!=='default'?'/p/'+encodeURIComponent(a):'')+'/api/model/options',{headers:{authorization:'Bearer '+API_KEY},signal:AbortSignal.timeout(20000)}).then(x=>x.ok?x.json():null);
     // every model the chat's menu has (any provider): Code's one model list, for a person's computer too (25 Oct 2026);
     // Code runs Claude models on Claude Code, ChatGPT models on Codex and the rest on the engine (the box's copy only)
     const allow=await accountHooks.allowList?.().catch(()=>[])||[];if(o)engineModels=(o.providers||[]).filter(pv=>pv.authenticated&&pv.slug!=='gemini-subscription'&&(pv.models||[]).length&&(!/nous/i.test((pv.slug||'')+' '+(pv.name||''))||allow.includes(pv.slug))&&(pv.slug!=='anthropic'||allow.includes('anthropic'))).map(pv=>({provider:pv.slug,name:codeProvName(pv),models:(pv.models||[]).filter(m=>typeof m==='string'&&users.modelOk(who,pv.slug,m))})).filter(x=>x.models.length);
     if(o){models={claude:[],codex:[],gemini:[]};for(const pv of o.providers||[]){if(!pv.authenticated)continue;const k=pv.slug==='claude-subscription-directsdk-experimental'?'claude':pv.slug==='openai-codex'?'codex':/^gemini/.test(pv.slug)?'gemini':'';if(!k)continue;
      for(const m of pv.models||[])if(typeof m==='string'&&users.modelOk(who,pv.slug,m)&&!models[k].includes(m))models[k].push(m)}}}catch{}
    // engine: every model (and Default with the priority list) runs on the engine; a computer's projects through the code bridge
    return send(res,200,{agent:want,where:box?'box':'computer',restricted:!!users.allowedModels(who),models,engineModels,agentDefault:a?await agentModel(a):null,engine:box?!codeOnline.remote():true,...(r?{provider:r.provider,model:r.model,account:{label:r.account.label,kind:r.account.kind},...(box&&r.provider==='claude'?{main:r.main,configDir:r.configDir}:{})}:{})}),true}
   /* Code's "aqeelOS models" engine (the box's own Code copy; a computer's below): one turn for an agent, run by the engine exactly
      like a chat message (the agent's own model and account, the Models page's priority list and auto-switch, any
      provider, its tools and their locks), in the project's folder on the box. The chat's rules apply to the person
      who sent it (x-aq-act): the agents they may use, their models, their daily limit. The engine's events stream
      back as they come (also to /ui/live, so the chat page can follow the same turn); stop and approvals go by the
      handle sent first, so they keep working after the person's short note has run out. */
   /* A person's computer (25 Oct 2026): the same turn, for a project in a folder there. The engine's chat starts in an
      empty folder of the agent's own here and reaches the project only through the code bridge (app/code-bridge.mjs):
      this turn is bound to that computer's run (b.bridge) while it goes on, and nothing of the project is on the box. */
   if(p.startsWith('/ui/code/engine/')){const box=BOX,far=!BOX;
    if(p==='/ui/code/engine/run'&&req.method==='POST'){if(box&&codeOnline.remote())return send(res,409,{error:'Online Code runs in its own container here, so agents cannot reach its folders. Use Claude Code, Codex or Gemini CLI.'}),true;
     let b={};try{b=JSON.parse(await readBody(req,40e6))}catch{return send(res,400,{error:'The request was not valid JSON.'}),true}
     // no agent picked in Code: the one this person would chat with (as agent-model answers)
     const may=(await listAgents()).filter(mine),a=String(b.agent||'')||(may.includes('default')?'default':may[0]||'');if(!may.includes(a)||await isTestAgent(a))return send(res,403,{error:'You can’t use that agent.'}),true;
     const name=NAMES[a]||await displayName(a);if(await agentDefaults.codeLocked(a))return send(res,403,{error:name+'’s terminal and file tools are locked, so it cannot work on code. Pick a Claude or ChatGPT model, or ask an admin.'}),true;
     // the other agents attached to this message: the engine may ask them (code_ask_agent) while the turn goes on
     const attached=[a,...new Set((Array.isArray(b.agents)?b.agents:[]).map(String).filter(x=>x!==a))].slice(0,6);for(const x of attached.slice(1))if(!may.includes(x)||await isTestAgent(x))return send(res,403,{error:'You can’t use one of the attached agents.'}),true;
     // a member: within their daily limit (Chat and Code together) and only on models they may use, as in Chat
     let provider=String(b.provider||''),model=String(b.model||'');if(!/^[\w.:/@+-]{0,120}$/.test(provider+model))return send(res,400,{error:'Invalid model name.'}),true;
     if(!users.isAdmin(who)){const lim=users.limitOf(who);if(lim?.tokens){const t=await usage.today(await listAllProfiles(),who.id,users.ownerOf);if(t.tokens+await code.usedToday(who.id)>=lim.tokens)return send(res,429,{error:'You reached today\'s limit. It resets at midnight.'}),true}
      const allowed=users.allowedModels(who);if(allowed){const d=await agentModel(a),isDef=!model||model===d.model&&(!provider||provider===d.provider);
       if(!isDef){if(!users.modelOk(who,provider,model))return send(res,403,{error:'You can\'t use that model. Ask the owner.'}),true}
       else if(!users.modelOk(who,d.provider,d.model)){const [pv,...m]=String(allowed[0]).split('|');if(m.length){provider=pv;model=m.join('|')}else{model=pv;provider=''}}}}
     // the project folder: one of online Code's own (~/code-projects/<name>), as it really is (no link out of it)
     const AREA=path.join(homedir(),'code-projects');let dir='';const bridgeId=String(b.bridge||''),project=String(b.projectName||'').replace(/[\u0000-\u001f]/g,'').slice(0,80)||'project';
     if(far){if(!/^[0-9a-f]{24}$/.test(bridgeId))return send(res,400,{error:'Update aqeelOS Code on this computer to run this model.'}),true;try{dir=await codeBridge.room(a,who.id,project)}catch(e){return send(res,500,{error:'Could not make the agent’s folder for this run: '+e.message}),true}}
     else{try{dir=await realpath(String(b.path||''))}catch{}
     // a folder right inside it: the agent is let through that one folder only
     if(!dir.startsWith(AREA+path.sep)||dir.slice(AREA.length+1).includes(path.sep)||!(await stat(dir).catch(()=>null))?.isDirectory())return send(res,400,{error:'Only projects right inside online Code’s project folder (~/code-projects) can run on aqeelOS models.'}),true}
     const pre=a!=='default'?'/p/'+encodeURIComponent(a):'',H={authorization:'Bearer '+API_KEY,'content-type':'application/json'};
     // Plan only: the turn works in a read-only copy of the project in a chat of its own (codeAgents.planCopy), so it can
     // only read and propose; the copy goes when the turn ends
     const real=dir;let planDir='';if(b.plan&&!far){try{planDir=await codeAgents.planCopy(dir,AREA)}catch(e){return send(res,413,{error:e.message}),true}dir=planDir}
     // the same engine chat again for the same Code chat (only the person's own), else a new one that is theirs
     let sid=planDir?'':String(b.session||'');if(sid&&(!/^[\w.:-]{1,128}$/.test(sid)||users.ownerOf(sid)!==who.id))sid='';
     if(!sid){try{const d=await fetch(GATE.origin+pre+'/api/sessions',{method:'POST',headers:H,body:JSON.stringify({cwd:dir}),signal:AbortSignal.timeout(30000)}).then(async x=>x.ok?x.json():Promise.reject(Error((await x.text()).slice(0,200)||'HTTP '+x.status)));
       sid=String(d.session?.id||d.id||d.session_id||'');if(!sid)throw Error('no chat id');await users.own(sid,who)}catch(e){void codeAgents.planDrop(planDir);return send(res,502,{error:'The engine could not start a chat for '+name+': '+e.message}),true}}
     let text=String(b.prompt||'').slice(0,400000);if(!text.trim()){void codeAgents.planDrop(planDir);return send(res,400,{error:'Say what to do.'}),true}
     if(far&&b.plan)text='PLAN ONLY: change nothing; read with the project tools, then propose.\n\n'+text;
     if(planDir)text='PLAN ONLY: you are in a read-only copy of the project. Change nothing; read, then propose.\n\n'+text.split(String(b.path)).join(planDir).split(real).join(planDir);
     const imgs=(Array.isArray(b.images)?b.images:[]).slice(0,6).map(String).filter(u=>/^data:image\/(png|jpeg|webp|gif);base64,/.test(u));
     const msg={message:imgs.length?[{type:'text',text},...imgs.map(u=>({type:'image_url',image_url:{url:u}}))]:text};
     // a model picked in Code is locked for this turn on its own account; "Default" leaves the agent's own choice (and auto-switch) in charge
     if(model){msg.model=model;if(provider)msg.provider=provider;msg.require_model_lock=true}
     if(/^(none|minimal|low|medium|high|xhigh|max|ultra)$/.test(String(b.effort||'')))msg.model_options={reasoning_effort:b.effort};
     // the agent's own user is let into the folder for this turn only (taken away again when it ends, also when it does not start)
     let unrun=()=>{};if(!far)try{await agentDefaults.codeAccess(a,dir,AREA,{read:!!planDir})}catch(e){void codeAgents.planDrop(planDir);return send(res,409,{error:e.message}),true}
     // a computer's turn is bound to its run until it ends, also when it does not start (unbound at once then)
     const bound=far?codeBridge.bind({agent:a,user:who.id,dev:dev.key,devName:dev.name,project,mode:b.plan?'plan':'run',bridge:bridgeId}):'';
     const after=async()=>{unrun();if(bound)codeBridge.unbind(bound);if(!far)await agentDefaults.codeAccessAfter(a,dir,AREA).catch(()=>{});await codeAgents.planDrop(planDir)};
     const up=await fetch(GATE.origin+pre+'/api/sessions/'+encodeURIComponent(sid)+'/chat/stream',{method:'POST',headers:{...H,accept:'text/event-stream'},body:JSON.stringify(msg),...longFetch()}).catch(e=>({ok:false,status:502,text:async()=>e.message}));
     if(!up.ok||!up.body){void after();const t=await up.text().catch(()=>'');let said=t;try{const j=JSON.parse(t);said=j.error?.message||j.error||j.detail||t}catch{}return send(res,up.status===429?429:502,{error:'The engine did not take the turn ('+up.status+')'+(said?': '+String(said).slice(0,200):'')}),true}
     const route=await accountsApi.codeRoute(a).catch(()=>null),handle=randomBytes(18).toString('base64url'),h={agent:a,pre,user:who.id,runId:'',stop:false};codeRuns.set(handle,h);
     // (a computer's project is not on the box: an ask's files are named in the answer, not saved, see code_ask_agent)
     unrun=codeAgents.runStart(a,{user:who.id,agents:attached,dir:far?'':real,plan:!!planDir||far&&!!b.plan,project:far?project:path.basename(real)});
     res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no',...security});res.socket?.setNoDelay(true);
     res.write('event: aqeelos.code\ndata: '+JSON.stringify({type:'aqeelos.code',handle,session:sid,plan:!!planDir,agent:a,agentName:name,provider:provider||route?.engine||'',model:model||route?.model||'',account:model&&provider&&route?.engine!==provider?'':route?.account?.label||''})+'\n\n');
     const key=a+'|'+sid,rec=liveStart(key,who.id);console.log('code: '+(who.name||who.id)+' ran',a,'on aqeelOS models'+(far?' for '+project+' on '+dev.name:''));
     // the turn goes on on the engine when Code goes away (like a chat reply): read to its end either way
     // a comment line every 20 s while the engine is quiet (a pending approval, a long command), so no reader times out
     const beat=setInterval(()=>{if(!res.writableEnded&&!res.destroyed)res.write(': keep-alive\n\n')},20000);beat.unref?.();
     // the events read whole (one may span network chunks): the run id from run.started, approvals by their type
     const dec=new TextDecoder();let pend='';const onEvent=raw=>{let ev='',data='';for(const line of raw.split(/\r?\n/)){if(line.startsWith('event:'))ev=line.slice(6).trim();else if(line.startsWith('data:'))data+=line.slice(5).trimStart()}
      let d=null;try{d=JSON.parse(data)}catch{}const type=d?.type||ev;
      if(!rec.runId&&(type==='run.started'||d?.run_id)){const id=String(d?.run_id||d?.run?.id||d?.id||'');if(id&&/^[\w.:-]{1,200}$/.test(id)){rec.runId=h.runId=id;runOwner.set(id,{user:who.id,t:Date.now()});if(h.stop)fetch(GATE.origin+pre+'/v1/runs/'+encodeURIComponent(id)+'/stop',{method:'POST',headers:H}).catch(()=>{})}}
      if(type==='approval.request')rec.asking=true;else if(type==='approval.responded')rec.asking=false;if(bound&&/^tool\./.test(type))codeBridge.event(bound,type,d)};
     try{for await(const c of up.body){const buf=Buffer.from(c);rec.last=Date.now();rec.size+=buf.length;rec.chunks.push(buf);if(rec.size>8e6){rec.size-=rec.chunks.splice(40,Math.max(0,rec.chunks.length-200)).reduce((x,y)=>x+y.length,0)}
       pend+=dec.decode(buf,{stream:true});let i;while((i=pend.search(/\r?\n\r?\n/))>=0){const raw=pend.slice(0,i);pend=pend.slice(i).replace(/^\r?\n\r?\n/,'');onEvent(raw)}if(pend.length>4e6)pend='';
       if(!res.writableEnded&&!res.destroyed)res.write(buf);for(const sub of rec.subs)sub.write(buf)}}catch{}
     clearInterval(beat);liveEnd(key,rec);if(!res.writableEnded)res.end();setTimeout(()=>codeRuns.delete(handle),600e3).unref?.();
     await after();return true}
    let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const h=codeRuns.get(String(b.handle||''));if(!h)return send(res,404,{error:'That run has already finished.'}),true;
    if(h.user!==who.id)return send(res,403,{error:'Only the person who started this run can stop it or answer it.'}),true;   // (who: the person on the note)
    const go=(what,body)=>fetch(GATE.origin+h.pre+'/v1/runs/'+encodeURIComponent(h.runId)+'/'+what,{method:'POST',headers:{authorization:'Bearer '+API_KEY,'content-type':'application/json'},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(20000)}).then(async r=>send(res,r.ok?200:502,r.ok?{ok:true}:{error:'The engine answered '+r.status+': '+(await r.text()).slice(0,200)}),e=>send(res,502,{error:e.message}));
    if(p==='/ui/code/engine/stop'&&req.method==='POST'){if(!h.runId){h.stop=true;return send(res,200,{ok:true,later:true}),true}return go('stop'),true}
    if(p==='/ui/code/engine/approval'&&req.method==='POST'){const choice=String(b.choice||'');if(!/^(once|session|always|deny)$/.test(choice)||!h.runId)return send(res,400,{error:'Nothing to answer.'}),true;return go('approval',{choice,...(b.request_id?{request_id:String(b.request_id).slice(0,200)}:{})}),true}
    return send(res,404,{error:'Not found'}),true}
   if(p==='/ui/code/version')return send(res,200,{version:await code.version()}),true;
   // Live: Code publishes a project as a zip (the body), as the person this computer is paired for
   // Live from Code: is an address free, and how is a publish going
   if(p==='/ui/code/live-name'&&req.method==='GET')return send(res,200,await live.nameCheck(who,url.searchParams.get('slug')||'')),true;
   if(p==='/ui/code/live-status'&&req.method==='GET'){try{const a=await live.check(String(url.searchParams.get('id')||''));return send(res,200,{status:a.stopped?'offline':a.status,error:a.error||'',url:live.urlOf(a.slug)}),true}catch(e){return send(res,404,{error:e.message}),true}}
   if(p==='/ui/code/publish'&&req.method==='POST'){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>90e6)return send(res,413,{error:'The project is over 90 MB. Leave big files (videos, data) out of it.'}),true;chunks.push(c)}
    const q=url.searchParams;try{const a=await live.publish(who,{name:q.get('name'),slug:q.get('slug'),repo:q.get('repo'),database:q.get('db')==='1',visibility:q.get('visibility')||undefined,zip:Buffer.concat(chunks)});console.log('live: '+(who.name||who.id)+' published',a.slug);return send(res,200,a),true}catch(e){return send(res,400,{error:e.message}),true}}
   // the people an online project can be shared with (names only)
   if(p==='/ui/code/people'&&req.method==='GET')return send(res,200,{people:users.people().filter(x=>x&&x.id&&!x.disabled).map(x=>({id:x.id,name:x.name||x.username||'Someone',username:x.username||''}))}),true;
   if(p==='/ui/code/report'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}await code.report(dev,b);return send(res,200,{ok:true}),true}
   if(p==='/ui/code/run-usage'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}await code.addRun(dev,b);return send(res,200,{ok:true}),true}
   if(p==='/ui/code/update'){const u=await code.update();res.writeHead(200,{'content-type':'application/zip','content-length':u.zip.length,'x-code-version':u.version,'cache-control':'no-store'});return res.end(u.zip),true}
   // the long-poll for browser jobs (computer_browser); the box's copy has no browser jobs to run for a person
   if(p==='/ui/code/poll'&&req.method==='POST'){await readBody(req,262144).catch(()=>'');let gone=false;res.once('close',()=>{gone=true});const job=await code.poll(dev);if(gone||res.destroyed){code.requeue(dev,job);return true}return send(res,200,{job}),true}
   if(p==='/ui/code/bridge-done'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4e6))}catch{}return send(res,200,{ok:codeBridge.done(dev,b)}),true}
   if(p==='/ui/code/done'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,262144))}catch{}return send(res,200,{ok:code.done(dev,b.id,{state:String(b.state||''),text:String(b.text||'').slice(0,20000),files:(b.files||[]).slice(0,200).map(String),chat:String(b.chat||'')})}),true}
   return send(res,404,{error:'Not found'}),true}
  return false}}
