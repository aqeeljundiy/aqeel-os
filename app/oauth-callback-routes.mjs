// Where sign-ins come back, without a sign-in to aqeelOS (the one-time state is the check): Microsoft (Connect Microsoft), Google (Connect
// Google, or the Google Workspace skill's pending sign-in, finished with its --auth-code step) and an MCP app's OAuth return, which the engine
// trades and this page then reports plainly (/microsoft-oauth/callback, /google-oauth/callback, /mcp-oauth/api/mcp/oauth/callback/<tool>).
// They used to sit in server.mjs before the sign-in gate and still run there: server.mjs calls this where the Microsoft one was, before /auth/
// and /ui/, and it answers true when it handled the request. Same checks in the same order. The MCP return used to come a few routes later,
// after the Code app's key routes (/ui/code/*), the brand's GET routes and /aqeelos-login: none of those takes a /mcp-oauth/ path, so which
// runs first changes nothing.
import {LIVE_APP} from './agentops.mjs';
import path from 'node:path';
import {readdir,readFile} from 'node:fs/promises';
export function createOAuthCallbackRoutes({DASH,DASH_TOKEN,deliverToGateway,esc,gconnect,googleConnected,HERMES_HOME,listAllProfiles,msconnect,NAMES,PUBLIC_URL,security,sharing,signinFlows,writeAgentContext}){
 return async function handle(req,res,p,url){
  // MCP sign-in (OAuth) returns here from Slack, Notion…; the engine checks the one-time state. No sign-in needed.
  // Google sign-ins (Google Workspace skill with a Web-application client) return here, and aqeelOS finishes them:
  // it finds the agent and account whose pending sign-in has this state and runs the skill's --auth-code step.
  // Microsoft sign-ins started with Connect Microsoft (microsoft-connect.mjs) come back here; the one-time state is the check
  if(p==='/microsoft-oauth/callback'&&req.method==='GET'){
   const page=(t,m)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8',...security});return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>aqeelOS</title><style>@font-face{font-family:'Plus Jakarta Sans';font-weight:200 800;font-display:swap;src:url('/assets/plus-jakarta-sans.woff2') format('woff2')}@font-face{font-family:'Plus Jakarta Sans';font-weight:200 800;font-display:swap;src:url('/assets/google-sans-flex-digits.woff2') format('woff2');unicode-range:U+30-39}</style><body style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;max-width:440px;margin:15vh auto;text-align:center;color:#111;line-height:1.5"><h2>${t}</h2><p>${m}</p></body>`)};
   if(!await msconnect.has(url.searchParams.get('state')||''))return page('Not connected','This sign-in link has expired or was already used. Go back to aqeelOS and press Connect Microsoft again.'),true;
   try{const r=await msconnect.finish(url.search);if(LIVE_APP)writeAgentContext().catch(()=>{});return page('Microsoft account connected',(r.email?'<b>'+esc(r.email)+'</b> is':'Your Microsoft account is')+' connected to '+esc(NAMES[r.agent]||r.agent)+'. You can close this tab and go back to aqeelOS.'),true}catch(e){return page('Not connected',esc(e.message)),true}}
  if(p==='/google-oauth/callback'&&req.method==='GET'){const st=url.searchParams.get('state')||'';
   const page=(t,m)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8',...security});return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>aqeelOS</title><style>@font-face{font-family:'Plus Jakarta Sans';font-weight:200 800;font-display:swap;src:url('/assets/plus-jakarta-sans.woff2') format('woff2')}@font-face{font-family:'Plus Jakarta Sans';font-weight:200 800;font-display:swap;src:url('/assets/google-sans-flex-digits.woff2') format('woff2');unicode-range:U+30-39}</style><body style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;max-width:440px;margin:15vh auto;text-align:center;color:#111;line-height:1.5"><h2>${t}</h2><p>${m}</p></body>`)};
   // a sign-in started in the app (Connect Google): finished here, nothing for an agent to do
   if(await gconnect.has(st)){try{const r=await gconnect.finish(url.search);googleConnected(r);return page('Google account connected',(r.email?'<b>'+esc(r.email)+'</b> is':'Your Google account is')+' connected to '+esc(NAMES[r.agent]||r.agent)+'. You can close this tab and go back to aqeelOS.'),true}catch(e){return page('Not connected',esc(e.message)),true}}
   if(url.searchParams.get('error'))return page('Not connected','You clicked Cancel (or Google said no). Ask your agent for a new link if you want to connect.'),true;
   let hit=null;for(const a of await listAllProfiles()){const home=a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
    for(const fn of await readdir(home).catch(()=>[])){const m=/^google_oauth_pending(?:_(.+))?\.json$/.exec(fn);if(!m)continue;
     try{const j=JSON.parse(await readFile(path.join(home,fn),'utf8'));if(j.state&&j.state===st){hit={a,home,acct:m[1]||''};break}}catch{}}if(hit)break}
   if(!hit)return page('This link has expired','A newer link replaced it, or it was already used. Ask your agent for a new Google sign-in link and open it right away.'),true;
   const py=await sharing.python();const script=path.join(hit.home,'skills','productivity','google-workspace','scripts','setup.py');const {execFile}=await import('node:child_process');
   const r=await new Promise(done=>execFile(py,[script,...(hit.acct?['--account',hit.acct]:[]),'--auth-code',PUBLIC_URL+'/google-oauth/callback'+url.search],{timeout:90000,env:{...process.env,HERMES_HOME:hit.home}},(e,o,er)=>done({ok:!e,out:String(o||'')+String(er||'')})));
   if(!r.ok||/ERROR/.test(r.out))return page('Google sign-in did not finish',esc((r.out.trim().split('\n').filter(Boolean).pop()||'Unknown error').slice(0,300))+' Ask your agent for a new link.'),true;
   return page('Google account connected',(hit.acct?'<b>'+esc(hit.acct)+'</b> is ':'Your Google account is ')+'connected to '+esc(NAMES[hit.a]||hit.a)+'. You can close this tab and go back to aqeelOS.'),true}
  if(p.startsWith('/mcp-oauth/api/mcp/oauth/callback/')&&req.method==='GET'){
   const tool=decodeURIComponent(p.split('/').pop()||'');let r=await fetch(DASH.origin+p.slice('/mcp-oauth'.length)+url.search).catch(()=>null);if(r)await r.text();
   if(r&&r.status===404&&url.searchParams.get('code')){const g=await deliverToGateway(url.search);if(g)r={ok:true,status:200,viaGateway:true}}
   // say what really happened: wait for the engine to finish trading the code, then report it plainly
   let title='Signed in',msg='You can close this tab and go back to aqeelOS.';
   if(url.searchParams.get('error'))[title,msg]=['Not connected','You clicked Cancel (or the service said no). Go back to aqeelOS and press Sign in again if you want to connect.'];
   else if(!r)[title,msg]=['aqeelOS is not reachable','Try again in a minute.'];
   else if(r.status===404)[title,msg]=['This link has expired','It was replaced by a newer one or is older than a few minutes. Go back to aqeelOS, press Sign in (or ask your agent to connect it) and use the newest link right away.'];
   else if(!r.ok)[title,msg]=['Sign-in did not finish','The service sent back something unexpected. Press Sign in again.'];
   else{const ids=[...signinFlows().entries()].filter(([k])=>k.endsWith('|'+tool)).map(([,v])=>v);const h={'x-hermes-session-token':DASH_TOKEN};let st=null;
    for(let i=0;i<20&&ids.length;i++){for(const id of ids){const f=await fetch(DASH.origin+'/api/mcp/oauth/flows/'+encodeURIComponent(id),{headers:h}).then(x=>x.ok?x.json():null).catch(()=>null);if(f&&!/authorization_required|pending|exchang|connecting/i.test(f.status||'')){st=f;break}}if(st)break;await new Promise(x=>setTimeout(x,750))}
    if(st&&/error|fail/i.test(st.status||''))[title,msg]=['Sign-in did not finish',esc(String(st.error||'The service refused the sign-in.').slice(0,300))+' Press Sign in again; if it keeps happening, ask your agent to connect it with the app’s own API key instead.'];
    else if(st&&st.tools?.length)msg=`${esc(tool)} is connected with ${st.tools.length} tools. You can close this tab and go back to aqeelOS.`}
   res.writeHead(r?.status&&r.status<500?200:502,{'content-type':'text/html; charset=utf-8',...security});
   return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>aqeelOS</title><style>@font-face{font-family:'Plus Jakarta Sans';font-weight:200 800;font-display:swap;src:url('/assets/plus-jakarta-sans.woff2') format('woff2')}@font-face{font-family:'Plus Jakarta Sans';font-weight:200 800;font-display:swap;src:url('/assets/google-sans-flex-digits.woff2') format('woff2');unicode-range:U+30-39}</style><body style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;max-width:440px;margin:15vh auto;text-align:center;color:#111;line-height:1.5"><h2>${title}</h2><p>${msg}</p></body>`),true}
  return false}}
