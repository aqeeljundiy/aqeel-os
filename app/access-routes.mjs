// Access and sharing: which agents may look after an agent, sharing levels, the owner's connected accounts, connections and their levels,
// asking another agent for access, answers to conflicts and questions, the fixer's GitHub token and who uses each connection
// (/ui/agent-access, /ui/sharing/*, /ui/connected-accounts/*, /ui/connections/*, /ui/access/*, /ui/conflicts/decide, /ui/health/fixer-token,
// /ui/questions/answer). They used to sit in server.mjs inside the signed-in /ui/ gate. Same checks in the same order; server.mjs calls this
// where the block was (the person `u` is already signed in and the x-hui header already checked) and it answers true when it handled the request.
import {agentNames} from './agentops.mjs';
import {LEVELS as SHARE_LEVELS} from './sharing.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
export function createAccessRoutes({access,accessAsk,agentAccess,bottlenecks,conflicts,connAccounts,connections,DATA,keysId,labels,listAgents,NAMES,questions,readBody,send,shareLevels,users}){
 return async function handle(req,res,p,url,u){
   // Access: who owns each connection and which agents may use it (see access.mjs). Admins only.
   // asking for access: anyone may see what the other agents have (names only) and ask for it for an agent they use; admins decide
   // Sharing levels (sharing.mjs): per resource (GET ?type&id) and per agent (GET ?agent); admins act as the owner,
   // others may change a share only through an agent they are allowed to manage (its level on the resource decides)
   // Agents › Edit agent › Access (agent-access.mjs): which agents may look after this one, at which level. Admins change it
   // (as the main agent); a person who owns the agent may read it. Never shows a key.
   if(p==='/ui/agent-access'){const ag=String(url.searchParams.get('agent')||'');let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,4096)||'{}')}catch{}}const t=String(b.agent||ag);
    if(!users.isAdmin(u)&&users.level(u,t)!=='owner')return send(res,403,{error:'Only an admin or the agent\'s owner sees this.'}),true;
    try{await agentAccess.ensure(t);if(req.method==='GET'){const r=await shareLevels.get('agent',t);const all=(await agentNames({copies:false})).filter(x=>x!==t&&x!==agentAccess.MAIN);
      return send(res,200,{agent:t,main:agentAccess.MAIN,owner:r?.owner||t,grants:r?.grants||{},agents:all.map(x=>({id:x,name:NAMES[x]||x})),levels:['manager','editor','viewer','none']}),true}
     if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'}),true;const r=await shareLevels.share('agent',t,{person:u.name||u.email||u.id,admin:true},String(b.to||''),String(b.level||''));console.log('agent access:',t,'->',b.to,b.level);return send(res,200,{ok:true,...r}),true}
    catch(e){return send(res,e.status||409,{error:e.message}),true}}
   if(p.startsWith('/ui/sharing')){let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}}
    const type=String(b.type||url.searchParams.get('type')||''),rid=String(b.id||url.searchParams.get('id')||''),ag=String(b.as||url.searchParams.get('agent')||'');
    try{if(req.method==='GET'){if(p==='/ui/sharing/audit'){if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'}),true;return send(res,200,{items:await shareLevels.audit({k:type&&rid?type+':'+rid:undefined})}),true}
      if(ag){if(!users.isAdmin(u)&&!users.level(u,ag))return send(res,403,{error:'This agent is private to its owner.'}),true;return send(res,200,{enabled:await shareLevels.enabled(),items:await shareLevels.forAgent(ag)}),true}
      if(!users.isAdmin(u))return send(res,403,{error:'Admins only.'}),true;return send(res,200,{enabled:await shareLevels.enabled(),levels:SHARE_LEVELS,resource:type?await shareLevels.get(type,rid):null,items:type?undefined:await shareLevels.list()}),true}
     if(req.method!=='POST')return send(res,405,{error:'POST only'}),true;
     const actor=users.isAdmin(u)?{person:u.name||u.email||u.id,admin:true}:(ag&&users.level(u,ag)==='owner'?{agent:ag}:null);if(!actor)return send(res,403,{error:'Only an admin, or the person who owns the acting agent, can change sharing.'}),true;
     let r;if(p==='/ui/sharing/share')r=await shareLevels.share(type,rid,actor,String(b.agent||''),String(b.level||''));
     else if(p==='/ui/sharing/revoke')r=await shareLevels.revoke(type,rid,actor,String(b.agent||''));
     else if(p==='/ui/sharing/transfer')r=await shareLevels.transfer(type,rid,actor,String(b.agent||''));
     else if(p==='/ui/sharing/claim'){if(!actor.admin)return send(res,403,{error:'Admins only.'}),true;r=await shareLevels.claim(type,rid,String(b.agent||''),{label:b.label||'',by:'person:'+actor.person})}
     else if(p==='/ui/sharing/enabled'){if(!actor.admin)return send(res,403,{error:'Admins only.'}),true;r=await shareLevels.setEnabled(!!b.on,'person:'+actor.person)}
     else return send(res,404,{error:'Not found'}),true;
     console.log('sharing:',p.split('/').pop(),type+':'+rid,b.agent||'',b.level||'');return send(res,200,{ok:true,...r}),true}catch(e){return send(res,e.status||409,{error:e.message}),true}}
   // Abilities › Connected accounts (connected-accounts.mjs): the owner's own logins the agents use; admins only
   if(p.startsWith('/ui/connected-accounts')){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can see the logins agents use as the owner.'}),true;let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}}
    const id=String(b.id||url.searchParams.get('id')||'');
    try{if(p==='/ui/connected-accounts'&&req.method==='GET')return send(res,200,await connAccounts.list({fresh:url.searchParams.get('fresh')==='1'})),true;
     if(p==='/ui/connected-accounts/actions'&&req.method==='GET')return send(res,200,await connAccounts.actions(id)),true;
     if(req.method!=='POST')return send(res,405,{error:'POST only'}),true;
     const who=u.name||u.email||'';let r;
     if(p==='/ui/connected-accounts/pause')r=await connAccounts.pause(id,!!b.on,who);
     else if(p==='/ui/connected-accounts/can')r=await connAccounts.setCan(id,b.can);
     else if(p==='/ui/connected-accounts/approve')r=await connAccounts.approve(id,who);
     else if(p==='/ui/connected-accounts/check'){await connAccounts.check(id);r={ok:true}}
     else if(p==='/ui/connected-accounts/disconnect')r=await connAccounts.disconnect(id);
     // Add › A login: the owner adds a login an agent uses as them (until 7 Nov 2026 only an agent's register_account could)
     else if(p==='/ui/connected-accounts/add'){const ag=String(b.agent||'default');if(!(await agentNames()).includes(ag))return send(res,400,{error:'Unknown agent'}),true;
      r=await connAccounts.register(ag,{kind:b.kind,label:b.label,where:b.where,can:b.can,note:b.note},{owner:who});if(r.isError)return send(res,400,{error:r.text}),true}   // no restart: the engine drops a removed app at its next look
     else return send(res,404,{error:'Not found'}),true;
     console.log('connected accounts:',p.split('/').pop(),id,'by',who);return send(res,200,{ok:true,...r}),true}catch(e){return send(res,409,{error:e.message}),true}}
   // Abilities › Connections (connections.mjs): everyone sees the agents they may use; changes are checked per row and agent
   if(p.startsWith('/ui/connections')){const perm={admin:users.isAdmin(u),level:a=>users.level(u,a),canOn:(cap,a)=>users.canOn(u,cap,a)};let b={};if(req.method==='POST'){try{b=JSON.parse(await readBody(req,8192)||'{}')}catch{}}
    const key=String(b.key||url.searchParams.get('key')||''),agent=String(b.agent||'');
    try{if(p==='/ui/connections'&&req.method==='GET')return send(res,200,await keysId.decorate(await labels.applyRows(await connections.list(perm,{fresh:url.searchParams.get('fresh')==='1',check:url.searchParams.get('check')==='1'})))),true;
     if(p==='/ui/connections/detail'&&req.method==='GET')return send(res,200,await keysId.decorate(await labels.applyRows(await connections.detail(key,perm)))),true;
     if(req.method!=='POST')return send(res,405,{error:'POST only'}),true;if(!key)return send(res,400,{error:'Which connection?'}),true;
     if(p!=='/ui/connections/disconnect'&&!(await listAgents()).includes(agent))return send(res,400,{error:'Unknown agent'}),true;let r;
     if(p==='/ui/connections/level')r=await connections.setLevel(key,agent,String(b.level||''),perm);
     else if(p==='/ui/connections/add')r=await connections.add(key,agent,perm);
     else if(p==='/ui/connections/remove')r=await connections.remove(key,agent,perm);
     else if(p==='/ui/connections/owner')r=await connections.setOwner(key,agent,perm);
     else if(p==='/ui/connections/disconnect')r=await connections.disconnect(key,perm);
     else return send(res,404,{error:'Not found'}),true;
     console.log('connections:',p.split('/').pop(),key,agent,b.level||'','by',u.name||u.email||u.id);return send(res,200,{ok:true,...r}),true}catch(e){return send(res,e.status||409,{error:e.message}),true}}
   if(p==='/ui/access/others'&&req.method==='GET'){const agent=String(url.searchParams.get('agent')||'default');const mayU=a=>users.isAdmin(u)||!users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),a);if(!mayU(agent))return send(res,403,{error:'Not your agent.'}),true;
    return send(res,200,{items:await accessAsk.others(agent),asked:(await accessAsk.of(agent)).filter(r=>!r.done).map(r=>r.kind+'|'+r.id)}),true}
   if(p==='/ui/access/ask'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const to=String(b.agent||''),by=String(b.by||to);const mayU=a=>users.isAdmin(u)||!users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),a);
    if(!mayU(b.dir==='give'?by:to))return send(res,403,{error:'Not your agent.'}),true;try{const r=await accessAsk.ask({kind:String(b.kind||''),id:String(b.id||''),to,by,dir:b.dir==='give'?'give':'get',why:b.why,person:u.name||u.email||''});console.log('access asked:',b.dir||'get',b.kind,b.id,'for',to);return send(res,200,{ok:true,...r}),true}catch(e){return send(res,409,{error:e.message}),true}}
   // an answer to a conflict (rule-conflicts.mjs): admins any; a member only for an agent they may use and not when people disagree
   if(p==='/ui/conflicts/decide'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{const cid=String(b.cid||'');const r=(await conflicts.list()).find(x=>x.cid===cid);if(!r)return send(res,404,{error:'That one is already gone.'}),true;
     if(!users.isAdmin(u)&&(r.people||users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),r.agent)))return send(res,403,{error:'Only the owner answers this one.'}),true;
     const a=await conflicts.decide(cid,{choice:String(b.choice||''),value:b.value,text:b.text},u.name||u.email||'');return send(res,200,{ok:true,cid:a.cid,applied:a.answered.applied}),true}catch(e){return send(res,409,{error:e.message}),true}}
   // the fixer's GitHub token, pasted in the item that asks for it (fixer-git.mjs reads DATA/fixer-github-token); admins only, never echoed
   if(p==='/ui/health/fixer-token'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'}),true;let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const tok=String(b.token||'').trim();
    if(!/^[A-Za-z0-9_.-]{20,255}$/.test(tok))return send(res,400,{error:'That does not look like a GitHub token.'}),true;await writeFile(path.join(DATA,'fixer-github-token'),tok+String.fromCharCode(10),{mode:0o600});await bottlenecks.resolve('github_token').catch(()=>{});console.log('fixer token saved by',u.name||u.email||'admin');return send(res,200,{ok:true}),true}
   // an answer to a question (questions.mjs): admins any; a member only for an agent they may use
   if(p==='/ui/questions/answer'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{const qid=String(b.qid||'');const r=(await questions.list()).find(x=>x.qid===qid);if(!r)return send(res,404,{error:'That question is gone.'}),true;
     if(!users.isAdmin(u)&&(!r.agent||users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),r.agent)))return send(res,403,{error:'Only the owner answers this one.'}),true;
     const a=await questions.answer(qid,{choice:String(b.choice||''),text:b.text},u.name||u.email||'');return send(res,200,{ok:true,qid:a.qid,answer:a.answered.text}),true}catch(e){return send(res,409,{error:e.message}),true}}
   if(p==='/ui/access/decide'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can allow access.'}),true;let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}
    try{const r=await accessAsk.decide(String(b.rid||''),!!b.ok,u.name||u.email||'');console.log('access request',r.rid,r.ok?'allowed':'declined');return send(res,200,{ok:true,...r}),true}catch(e){return send(res,409,{error:e.message}),true}}
   if(p==='/ui/access'||p==='/ui/access/owner'){const KINDS=['mcp','google','plugin','key'];
    // everyone sees the agents they may use (admins: every agent); only admins change who uses what, and see keys
    if(req.method==='GET'){const kind=String(url.searchParams.get('kind')||'');if(!KINDS.includes(kind))return send(res,400,{error:'Unknown kind'}),true;
     if(users.isAdmin(u))return send(res,200,{...await access.list(kind),canEdit:true}),true;if(kind==='key')return send(res,403,{error:'Only admins can see keys.'}),true;
     {const l=await access.list(kind,new Set((await listAgents()).filter(a=>!users.gate(u,'/gapi/api/model/options','GET',new URLSearchParams(),a))));
      const host=d=>{try{return new URL(String(d)).host}catch{return String(d||'').split(/\s+/)[0].split('/').pop().slice(0,40)}};
      return send(res,200,{...l,items:(l.items||[]).filter(x=>!/^aqeelos-/.test(String(x.id))).map(x=>kind==='mcp'?{...x,detail:host(x.detail)}:x),canEdit:false}),true}}
    if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change who uses a connection.'}),true;
    if(req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const kind=String(b.kind||''),id=String(b.id||''),agent=String(b.agent||'');
     if(!KINDS.includes(kind)||!id||!(await listAgents()).includes(agent))return send(res,400,{error:'Bad request'}),true;
     try{const r=p==='/ui/access/owner'?await access.setOwner(kind,id,agent):b.on?await access.grant(kind,id,agent,b.from?String(b.from):undefined):await access.revoke(kind,id,agent);console.log('access:',kind,id,p==='/ui/access/owner'?'owner →':b.on?'on for':'off for',agent);return send(res,200,{ok:true,...r}),true}catch(e){return send(res,409,{error:e.message}),true}}}
  return false}}
