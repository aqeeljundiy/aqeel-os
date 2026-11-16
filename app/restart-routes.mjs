// Restarting agents from the app: one agent (POST /ui/agent/restart, 16 Nov 2026: that agent alone, app/agent-reload.mjs) and the whole
// engine (POST /ui/gateway/restart, moved here verbatim from server.mjs). Called inside the /ui/ gate with the signed-in person.
export function createRestartRoutes({users,send,readBody,agentNames,backups,agentReload,waitingNow,restartGateway}){
 return async function handle(req,res,p,u){
   // one agent (16 Nov 2026): that agent alone; the main agent is the engine, so for it every agent restarts. An admin, or the agent's owner
   if(p==='/ui/agent/restart'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,2048))}catch{}const ag=String(b.agent||'');
    if(!users.isAdmin(u)&&(!ag||ag==='default'||users.level(u,ag)!=='owner'))return send(res,403,{error:'Only an admin or the owner of this agent can restart it.'}),true;   // rights first, whatever was sent
    if(!/^[a-z0-9][a-z0-9_-]{0,63}(--[a-z0-9_-]{1,64})?$/.test(ag)||!(await agentNames({copies:true})).includes(ag))return send(res,400,{error:'Unknown agent.'}),true;
    if(backups.busy())return send(res,409,{error:'A restore is running. The agents start again by themselves when it finishes.'}),true;
    const r=await agentReload.agent(ag,'restart of '+ag+' from the app ('+(u.name||u.id)+')');return send(res,200,{ok:true,whole:!!r.whole}),true}
   if(p==='/ui/gateway/restart'&&req.method==='POST'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can restart the gateway.'}),true;if(backups.busy())return send(res,409,{error:'A restore is running. The agents start again by themselves when it finishes.'}),true;
    const waiting=await waitingNow();restartGateway('restart from the app ('+(u.name||u.id)+')').catch(()=>{});return send(res,200,{ok:true,waiting}),true}
 return false}}
