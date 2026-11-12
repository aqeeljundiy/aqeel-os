// What the agents' engines and scripts on this box call, from this box only (loopback) and signed per agent: the code bridge during a Code
// run, run_self and its tool server (srMcp), Kirimdev calls without a key, the confined fixer's routes, a person's message in the team's
// Telegram topic, an agent's Google files, the run gate, an event hook's fallback run and the posting guard and gate (/mcp/code/*,
// /mcp/self/*, /agent-ops/*, /fixer-ops/*, /team-message/*, /google-files/*, /run-gate/*, /event-hook/*, /posting-*). They used to sit in
// server.mjs before the sign-in gate and still run there: server.mjs calls this at the same place (after /healthz, before the agent tool
// server) and it answers true when it handled the request. Same checks in the same order.
import path from 'node:path';
import {homedir} from 'node:os';
import {safeLock} from './self-runs.mjs';
import {timingSafeEqual} from 'node:crypto';
export function createBoxRoutes({agentOps,codeBridge,eventHooks,fixerSandbox,googleFiles,kirimdev,postingLimits,readBody,relayKeys,runGates,selfRuns,send,sign,SR_STATE,SR_TOOLS,SR_WAIT,srDur,srEligible,srOrigin,srText}){
async function srMcp(req,res,ms){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only');if(req.method!=='POST')return send(res,405,'POST only');
 let msg={};try{msg=JSON.parse(await readBody(req,262144))}catch{return send(res,400,{error:'bad json'})}
 const a=ms[1];if(!relayKeys.ok(ms[2],'self-runs:',a))return send(res,403,{error:'bad token'});
 const rpc=result=>send(res,200,{jsonrpc:'2.0',id:msg.id,result}),reply=(text,isError)=>rpc({content:[{type:'text',text}],...(isError?{isError:true}:{})});
 if(msg.method==='initialize')return rpc({protocolVersion:msg.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'aqeelos-self',version:'1.0.0'}});
 if(msg.method==='notifications/initialized'||msg.id==null)return send(res,202,'');
 if(msg.method==='ping')return rpc({});
 if(msg.method==='tools/list')return rpc({tools:await srEligible(a)?SR_TOOLS:[]});
 if(msg.method!=='tools/call')return send(res,200,{jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}});
 const name=String(msg.params?.name||''),args=msg.params?.arguments&&typeof msg.params.arguments==='object'?msg.params.arguments:{};
 if(!SR_TOOLS.some(t=>t.name===name))return reply('Unknown tool.',true);
 if(!await srEligible(a))return reply('Running yourself is not available for this agent.',true);
 let origin=await srOrigin(a,name,args);
 try{if(name==='run_self'){const ws=path.join(homedir(),'workspaces',a);let lockPath=null;
   if(origin.ok&&args.lock)try{lockPath=await safeLock(ws,args.lock)}catch(e){origin={ok:false,by:origin.by,why:e.message}}
   const r=await selfRuns.start({agent:a,args,origin,ws,lockPath});console.log('self-run',r.id,'started by',a,'for',origin.by?.kind||'?');
   return reply('Started run '+r.id+' ('+r.minutes+' minutes at most'+(r.state==='waiting'?', it first waits for the lock':'')+'). It runs on its own, so carry on. Call run_self_status with id '+r.id+' and wait true for the result; the person who asked also hears when it ends.')}
  if(!origin.ok){await selfRuns.start({agent:a,args:{prompt:'('+name+')',reason:'('+name+')'},origin}).catch(()=>{});return reply(origin.why,true)}
  if(name==='run_self_status'){// a short wait only: the engine runs one call at a time per tool server, so a long one held up every other call to it
   // (5 Nov 2026: a run's own run_self waited 3 minutes behind its parent's run_self_status)
   const r=args.wait?await selfRuns.wait(a,args.id,SR_WAIT):await selfRuns.status(a,args.id);return r?reply(srText(r)):reply('You have no run with id '+String(args.id||'').slice(0,40)+'. run_self_list shows yours.',true)}
  const m=await selfRuns.mine(a);
  return reply('Today: '+m.today+' of '+m.cap+' runs.'+(m.paused?' Self-runs are PAUSED ('+(m.paused.why==='cap'?'daily limit reached, until tomorrow':'3 failed runs in a row, until an admin resumes them')+').':'')+(m.on?'':' Running yourself is switched off for you in aqeelOS.')+'\n'+(m.runs.map(r=>'- '+r.id+' · '+(SR_STATE[r.state]||r.state)+(r.secs!=null?' · '+srDur(r.secs):'')+' · '+r.reason).join('\n')||'No runs yet.'))}
 catch(e){return reply(e.message,true)}}
 return async function handle(req,res,p,url){
  // the code bridge agents' engines call during a Code run for a computer project (app/code-bridge.mjs)
  if(p.startsWith('/mcp/code/')&&await codeBridge.handle(req,res,{send,readBody}))return true;
  // run_self and the rest (aqeelos-self): from this box only, each agent's address signed
  {const ms=/^\/mcp\/self\/([\w-]+)\/([\w-]+)$/.exec(p);if(ms)return await srMcp(req,res,ms),true}
  // an agent's Kirimdev calls without a key (agent-ops.mjs, audit H3): from this box only, signed per agent, its own line only, sends through the guards
  {const mo=/^\/agent-ops\/([\w-]+)\/([\w-]+)$/.exec(p);if(mo){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only'),true;if(req.method!=='POST')return send(res,405,'POST only'),true;
   const x=Buffer.from(String(mo[2])),y=Buffer.from(sign('agent-ops:'+mo[1]).slice(0,32));if(x.length!==y.length||!timingSafeEqual(x,y))return send(res,403,{error:'bad signature'}),true;
   let body;try{body=JSON.parse(await readBody(req,1e6))}catch{return send(res,400,{error:'bad json'}),true}const r=await agentOps.call(mo[1],body).catch(e=>({status:500,json:{error:e.message}}));return send(res,r.status,r.json),true}}
  // the confined fixer's routes (fixer-sandbox.mjs, CR-7): from this box only, signed for one run, closed when the run ends
  {const mf=/^\/fixer-ops\/([\w-]+)\/([\w-]+)\/([A-Za-z0-9_-]{32})\/(\w+)$/.exec(p);if(mf){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only'),true;if(req.method!=='POST')return send(res,405,'POST only'),true;
   let body={};try{body=JSON.parse(await readBody(req,65536)||'{}')}catch{return send(res,400,{error:'bad json'}),true}
   const r=await fixerSandbox.ops(mf[4],mf[1],mf[2],mf[3],body).catch(e=>({status:500,json:{error:String(e.message).slice(0,200)}}));return send(res,r.status,r.json),true}}
  // a person's message in the team's Telegram topic, from the engine's hook (audit H5): from this box only, signed per agent. The sender
  // is checked against the line's approvers in kirimdev.teamMessage; nothing here trusts the text alone.
  {const mt=/^\/team-message\/([\w-]+)\/([\w-]+)$/.exec(p);if(mt){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only'),true;if(req.method!=='POST')return send(res,405,'POST only'),true;
   const x=Buffer.from(String(mt[2])),y=Buffer.from(sign('team-message:'+mt[1]).slice(0,32));if(x.length!==y.length||!timingSafeEqual(x,y))return send(res,403,{error:'bad signature'}),true;
   let body;try{body=JSON.parse(await readBody(req,65536))}catch{return send(res,400,{error:'bad json'}),true}
   const r=await kirimdev.teamMessage(mt[1].split('--')[0],{chatId:body.chatId,threadId:body.threadId,userId:body.userId,text:String(body.text||'')}).catch(e=>({handled:false,why:e.message}));return send(res,200,{handled:!!r.handled}),true}}
  // an agent's Google files (google-files.mjs): from this box only, signed per agent, only the files listed for it
  {const mf=/^\/google-files\/([\w-]+)\/([\w-]+)$/.exec(p);if(mf){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only'),true;if(req.method!=='POST')return send(res,405,'POST only'),true;
   if(!relayKeys.ok(mf[2],'google-files:',mf[1]))return send(res,403,{error:'bad signature'}),true;
   let body;try{body=JSON.parse(await readBody(req,4e6))}catch{return send(res,400,{error:'bad json'}),true}const r=await googleFiles.call(mf[1],body);return send(res,r.status,r.json),true}}
  // the run gate every schedule runs first (run-gates.mjs): from this box only, signed per agent; always answers
  {const mr=/^\/run-gate\/([\w-]+)\/([\w-]+)\/([\w-]+)$/.exec(p);if(mr){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only'),true;
   if(!relayKeys.ok(mr[3],'relay:',mr[1]))return send(res,403,'bad signature'),true;
   const t=await runGates.check(mr[1],mr[2],{nothing:url.searchParams.get('nothing')==='1'}).catch(()=>'aqeelOS run check: clear to run.\n{"wakeAgent": true}');res.writeHead(200,{'content-type':'text/plain; charset=utf-8'});return res.end(t+'\n'),true}}
  // the slow fallback run of an event hook (event-hooks.mjs, scripts/hooks-wire.mjs): from this box only, signed per agent; 200 when the run went well, else 500 with the error
  {const mh=/^\/event-hook\/([\w-]+)\/([\w-]+)\/([\w-]+)$/.exec(p);if(mh){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only'),true;
   if(!relayKeys.ok(mh[3],'relay:',mh[1]))return send(res,403,'bad signature'),true;
   const e=await eventHooks.runNow(mh[1],mh[2]).catch(e=>e.message);res.writeHead(e?500:200,{'content-type':'text/plain; charset=utf-8'});return res.end((e||'ok')+'\n'),true}}
  // for a script that posts without a model (the comment queue, 12 Nov 2026): GET ?json=1&kind=comment on the gate says {allow,n,reason} (it reserves nothing); POST /posting-record does what the record_post tool does.
  // The guard of every script that posts (scripts/posting-guard.py, posting-limits.mjs): POST /posting-check {kind} -> {allow,ticket,reason}, /posting-sending {ticket}, /posting-record {ticket,kind,ref,text}, /posting-cancel {ticket}
  {const mj=/^\/posting-(gate|record|check|sending|cancel)\/([\w-]+)\/([\w-]+)$/.exec(p);if(mj&&(mj[1]!=='gate'||url.searchParams.get('json')==='1')){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only'),true;
   if(!relayKeys.ok(mj[3],'relay:',mj[2])){postingLimits.staleKey(mj[2]);return send(res,403,'bad signature'),true}
   if(mj[1]==='gate')return send(res,200,await postingLimits.allowNow(mj[2].split('--')[0],url.searchParams.get('kind')||'').catch(e=>({allow:false,n:0,reason:'aqeelOS could not check the limits ('+e.message+')'}))),true;
   if(req.method!=='POST')return send(res,405,{error:'POST only'}),true;let b={};try{b=JSON.parse(await readBody(req,65536))}catch{return send(res,400,{error:'bad json'}),true}
   const ag=mj[2].split('--')[0];
   if(mj[1]==='check'){const g=await postingLimits.guard(ag,b.kind).catch(e=>({allow:false,reason:'aqeelOS could not check the limits ('+e.message+'), so nothing may be posted.'}));return send(res,g.allow?200:409,g),true}
   if(mj[1]==='sending'||mj[1]==='cancel'){const g=await postingLimits.mark(ag,b.ticket,mj[1]).catch(e=>({ok:false,text:e.message}));return send(res,g.ok?200:409,g),true}
   const r=await postingLimits.record(ag,b).catch(e=>({isError:true,text:e.message}));return send(res,r.isError?409:200,{ok:!r.isError,text:r.text}),true}}
  // the posting gate an agent's posting schedule runs first (posting-limits.mjs): from this box only, signed per agent
  {const mg=/^\/posting-gate\/([\w-]+)\/([\w-]+)$/.exec(p);if(mg){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only'),true;
   if(!relayKeys.ok(mg[2],'relay:',mg[1])){postingLimits.staleKey(mg[1]);return send(res,403,'bad signature'),true}
   const t=await postingLimits.gate(mg[1]).catch(e=>'aqeelOS could not check the limits ('+e.message+'), so no post this run.\n{"wakeAgent": false}');res.writeHead(200,{'content-type':'text/plain; charset=utf-8'});return res.end(t+'\n'),true}}
  return false}}
