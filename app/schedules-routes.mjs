// Schedules and Run rules: the list's folders, descriptions, triggers and costs, one schedule's detail, its folder and note, the run rules
// (one run at a time, posting limits), folders, and which chat each schedule's result goes to (/ui/schedules/*, /ui/run-rules,
// /ui/channels/job-relays). They used to sit in server.mjs inside the signed-in /ui/ gate. Same checks in the same order; server.mjs calls this
// where the block was (the person `u` is already signed in and the x-hui header already checked) and it answers true when it handled the request.
import {isAgent} from './agentops.mjs';
export function createSchedulesRoutes({designGuard,postingLimits,readBody,relay,schedules,send,users}){
 return async function handle(req,res,p,url,u){
   // Schedules: folders, plain descriptions, recipients by name and what each run cost
   // only the schedules this person may see in the list (the same rule as the cron list: users.schedOk), admins included
   if(p==='/ui/schedules/info'&&req.method==='GET'){try{const d0=await schedules.info();const d={...d0,meta:{...d0.meta},runs:{...d0.runs},names:{...d0.names}};const ok=a=>users.schedOk(u,a);
    // how each schedule starts and why (design-guard.mjs): an event, a script with no AI, a check first, or the AI on a timer
    d.triggers=await schedules.jobs().then(l=>designGuard.triggers(l.filter(j=>ok(j.profile||'default')))).catch(()=>({}));
    for(const k of Object.keys(d.meta))if(!ok(k.split('|')[0]))delete d.meta[k];for(const k of Object.keys(d.runs))if(!ok(k.split('|')[0]))delete d.runs[k];
    // a member sees only the folders their schedules are in, and keeps their own open and shut folders (in the browser)
    if(!users.isAdmin(u)){d.names={};const f=new Set(Object.values(d.meta).map(m=>m.folder).filter(Boolean));d.folders=d.folders.filter(x=>f.has(x));d.order=d.order.filter(x=>f.has(x));d.colors=Object.fromEntries(Object.entries(d.colors).filter(([x])=>f.has(x)));d.folds={}}
    return send(res,200,d),true}catch(e){return send(res,500,{error:e.message}),true}}
   if(p==='/ui/schedules/detail'&&req.method==='GET'){const a=url.searchParams.get('profile')||'default';if(!users.schedOk(u,a))return send(res,403,{error:'Not your agent'}),true;
    try{return send(res,200,await schedules.detail(a,url.searchParams.get('id')||'')),true}catch(e){return send(res,404,{error:e.message}),true}}
   if(p==='/ui/schedules/meta'&&req.method==='PUT'){let b={};try{b=JSON.parse(await readBody(req,8192))}catch{}const a=String(b.profile||'default');if(!users.isAdmin(u)&&users.gate(u,'/hapi/cron/jobs','POST',new URLSearchParams('profile='+a),a))return send(res,403,{error:'Not your agent'}),true;
    return send(res,200,await schedules.setMeta(a,String(b.id||''),b)),true}
   // Run rules (posting-limits.mjs): one run at a time and posting limits per agent; admins change them, anyone who sees its schedules may look
   if(p==='/ui/run-rules'&&req.method==='GET'){const a=url.searchParams.get('agent')||'default';if(!users.schedOk(u,a))return send(res,403,{error:'Not your agent'}),true;
    try{return send(res,200,await postingLimits.view(a)),true}catch(e){return send(res,500,{error:e.message}),true}}
   if(p==='/ui/run-rules'&&req.method==='PUT'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins can change run rules.'}),true;let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}const a=String(b.agent||'');
    if(!await isAgent(a))return send(res,404,{error:'No such agent'}),true;try{const v=await postingLimits.set(a,{serial:b.serial,rules:b.rules});console.log('run rules: '+a+(b.serial!==undefined?' one at a time '+(b.serial?'on':'off'):'')+(b.rules?' limits '+(v.rules.on?'on':'off'):''));return send(res,200,v),true}catch(e){return send(res,400,{error:e.message}),true}}
   if(p==='/ui/schedules/folder'&&req.method==='POST'&&!users.isAdmin(u))return send(res,403,{error:'Only admins can rename folders.'}),true;
   if(p==='/ui/schedules/folder'&&req.method==='POST'){let b={};try{b=JSON.parse(await readBody(req,65536))}catch{}try{return send(res,200,await schedules.folderOp(b)),true}catch(e){return send(res,400,{error:e.message}),true}}
   if(p==='/ui/channels/job-relays'&&req.method==='GET'){const all=await relay.jobRelays();if(users.isAdmin(u))return send(res,200,all),true;const out={};for(const [k,v] of Object.entries(all||{})){const a=k.split('|')[0];if(!users.gate(u,'/ui/screens/'+a,'GET',new URLSearchParams(),a))out[k]=v}return send(res,200,out),true}
  return false}}
