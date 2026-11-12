// Calls that come in without a sign-in, each checked its own way: incoming webhooks (proxied to the engine's listener, an agent's own webhook
// checked with its saved key), WhatsApp Business (Meta), Tebar, Tripay and Xendit payments, Kirimdev; and from this box only, with a key: the
// customer-run tool server, the engine plugin aqeelos-live (team view, schedule review, a turn's context, a held error) and an issue's Telegram
// button (/webhooks/*, /whatsapp-cloud, /hooks/tebar/*, /hooks/pay/*, /kirimdev/*, /mcp/customer/*, /agent-live/*, /issue-press). They used to
// sit in server.mjs before the sign-in gate and still run there: server.mjs calls this at the same place, before /auth/ and /ui/, and it
// answers true when it handled the request. Same checks in the same order.
import {payHook} from './route-handlers.mjs';
import {LIVE_APP} from './agentops.mjs';
import {timingSafeEqual} from 'node:crypto';
export function createHooksRoutes({agentAccess,agentLive,customerTools,designGuard,HOOKS,issues,kirimdev,paymentCallbacks,pressKey,proxy,readBody,readRaw,send,smokeWatch,teamView,tebar,versions,WA_CLOUD}){
 return async function handle(req,res,p,url){
  // Incoming webhooks (GitHub, Stripe…) reach Hermes' webhook listener here. No sign-in: each
  // subscription checks its own secret signature, and nothing but POST /webhooks/<name> passes.
  if(/^\/webhooks\/[\w.-]{1,64}$/.test(p)&&req.method==='POST')return proxy(req,res,HOOKS,'',{}),true;
  {const wm=/^\/webhooks\/([a-z0-9][a-z0-9_-]{0,63})\/([\w.-]{1,64})$/.exec(p);if(wm&&req.method==='POST'){req.url='/p/'+wm[1]+'/webhooks/'+wm[2]+url.search;
   // an agent's own webhook for a provider that signs its own way (create_my_webhook): its signature is checked with the
   // agent's saved key and the call is signed again for the engine; any other route passes untouched
   let raw;try{raw=await readRaw(req,1e6)}catch{return send(res,413,{error:'too large'}),true}
   const g=await versions.hookGate(wm[1],wm[2],req.headers,raw).catch(e=>({pass:false,status:500,error:e.message}));if(!g.pass)return send(res,g.status||401,{error:g.error||'refused'}),true;
   if(g.headers){for(const h of ['x-webhook-signature','x-hub-signature-256','x-gitlab-token','linear-signature','webhook-signature','svix-signature','x-kirim-signature'])delete req.headers[h];Object.assign(req.headers,g.headers)}
   return proxy(req,res,HOOKS,'',{},{body:raw}),true}}
  // WhatsApp Business (Meta's Cloud API) calls here: GET is Meta's address check, POST the messages. No sign-in:
  // the engine checks Meta's signature with the app secret. The main agent's listener serves every agent (/p/<agent>/…).
  {const cm=/^\/whatsapp-cloud(?:\/([a-z0-9][a-z0-9_-]{0,63}))?$/.exec(p);if(cm&&(req.method==='GET'||req.method==='POST')){req.url=(cm[1]&&cm[1]!=='default'?'/p/'+cm[1]:'')+'/whatsapp/webhook'+url.search;return proxy(req,res,WA_CLOUD,'',{}),true}}
  // Tebar posts its events here, signed with the secret pasted for that agent (tebar.mjs): answered at once (Tebar waits 5 s), handled after
  {const tm=/^\/hooks\/tebar\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(p);if(tm){if(req.method!=='POST')return send(res,405,{error:'POST only'}),true;let raw;
   if(+req.headers['content-length']>1024*1024)return send(res,413,{error:'Too large'}),true;try{raw=await readRaw(req,1024*1024)}catch{return send(res,413,{error:'Too large'}),true}
   try{const r=await tebar.receive(tm[1],req.headers,raw);send(res,r.status,r.body);if(r.after)setImmediate(()=>r.after().catch(e=>console.warn('tebar event',e.message)));return true}catch(e){console.warn('tebar receive',e.message);return send(res,500,{error:'Try again'}),true}}}
  // Tripay and Xendit call here when a payment is paid, no sign-in: each call is checked with the agent's own provider secret (payment-callbacks.mjs)
  {const pm=/^\/hooks\/pay\/(tripay|xendit)\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(p);if(pm){if(req.method!=='POST')return send(res,405,{success:false}),true;let raw;
   if(+req.headers['content-length']>65536)return send(res,413,{success:false}),true;try{raw=await readRaw(req,65536)}catch{return send(res,413,{success:false}),true}
   {const r=await payHook({provider:pm[1],agent:pm[2],headers:req.headers,raw,receive:(...a)=>paymentCallbacks.receive(...a),live:LIVE_APP});send(res,r.status,r.body);if(r.after)setImmediate(r.after);return true}}}
  // one-time secret links (no sign-in: the token after # is the credential)
  // Kirimdev posts customer messages here, signed; nothing else is taken (kirimdev.mjs)
  {const km=/^\/kirimdev\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(p);if(km){if(req.method!=='POST')return send(res,405,{error:'POST only'}),true;let raw;
   if(+req.headers['content-length']>1024*1024)return send(res,413,{error:'Too large'}),true;try{raw=await readRaw(req,1024*1024)}catch{return send(res,413,{error:'Too large'}),true}
   try{const r=await kirimdev.receive(km[1],req.headers,raw);return send(res,r.status,r.body),true}catch(e){console.warn('kirimdev receive',e.message);return send(res,500,{error:'Try again'}),true}}}
  // a press on an issue's Telegram button, posted by the gateway plugin aqeelos-issue-buttons (this box only, with the key)
  // the engine plugin aqeelos-live (this box only, with the key in HERMES_HOME/secrets/agent-live.key): a turn's context, a held error
  // the customer-run tool server (local only; a run's own key in X-Aqeelos-Run)
  {const cm=/^\/mcp\/customer\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(p);if(cm){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra))return send(res,403,'local only'),true;
   if(req.method!=='POST')return send(res,405,'POST only'),true;let msg={};try{msg=JSON.parse(await readBody(req,262144))}catch{return send(res,400,{error:'bad json'}),true}
   {const w=msg.method==='tools/call'&&smokeWatch.get(String(msg.params?.arguments?.run||''));if(w)w.push({name:String(msg.params?.name||''),path:String(msg.params?.arguments?.path||'')})}
   const r=await customerTools().mcp(cm[1],String(req.headers['x-aqeelos-run']||''),msg);return r.status===202?send(res,202,''):send(res,r.status,r.body),true}}
  if(p.startsWith('/agent-live/')&&!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress||''))return send(res,403,{error:'local only'}),true;
  if(p==='/agent-live/team-view'){if(req.method!=='POST')return send(res,405,{error:'POST only'}),true;let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}
   if(!await agentLive.keyOk(b.key))return send(res,403,{error:'bad key'}),true;if(String(b.agent||'')!==agentAccess.MAIN)return send(res,403,{error:'Only the main agent has this.'}),true;
   try{return send(res,200,await teamView.call({session:String(b.session||'').slice(0,120)},b.args&&typeof b.args==='object'?b.args:{})),true}catch(e){return send(res,200,{error:e.message}),true}}
  if(p==='/agent-live/schedule-review'){if(req.method!=='POST')return send(res,405,{error:'POST only'}),true;let b={};try{b=JSON.parse(await readBody(req,65536))}catch{}
   if(!await agentLive.keyOk(b.key))return send(res,403,{error:'bad key'}),true;const ag=String(b.agent||'');if(!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(ag)||!(await agentLive.homes()).includes(ag))return send(res,404,{error:'no such agent'}),true;
   return send(res,200,{block:await designGuard.engineCall(ag,b.args&&typeof b.args==='object'?b.args:{}).catch(()=>null)}),true}
  if(p==='/agent-live/context'||p==='/agent-live/held'){if(req.method!=='POST')return send(res,405,{error:'POST only'}),true;let b={};try{b=JSON.parse(await readBody(req,16384))}catch{}
   if(!await agentLive.keyOk(b.key))return send(res,403,{error:'bad key'}),true;const ag=String(b.agent||'');if(!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(ag)||!(await agentLive.homes()).includes(ag))return send(res,404,{error:'no such agent'}),true;
   if(p==='/agent-live/held')return send(res,200,{ok:true,...await agentLive.hold(ag,{error:String(b.error||'').slice(0,8000),platform:String(b.platform||'').slice(0,40),session:String(b.session||'').slice(0,120)})}),true;
   try{const ch=b.chat&&typeof b.chat==='object'?Object.fromEntries(['chat_id','thread_id','chat_type','chat_name'].map(k=>[k,String(b.chat[k]||'').slice(0,200)])):{};return send(res,200,await agentLive.context(ag,{platform:String(b.platform||''),sender:String(b.sender||''),first:!!b.first,seen:String(b.seen||''),chat:ch})),true}catch(e){console.warn('agent-live context',ag,e.message);return send(res,200,{text:''}),true}}
  if(p==='/issue-press'){const ra=req.socket.remoteAddress||'';if(!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ra)||req.method!=='POST')return send(res,403,{error:'local only'}),true;
   let b={};try{b=JSON.parse(await readBody(req,4096))}catch{}const k=await pressKey();
   if(typeof b.key!=='string'||b.key.length!==k.length||!timingSafeEqual(Buffer.from(b.key),Buffer.from(k)))return send(res,403,{error:'bad key'}),true;
   const r=await issues.press(b.data,String(b.from||''));console.log('issue button',String(b.data||'').slice(0,15),'from',b.from,'→',r.toast);return send(res,200,r),true}
  return false}}
