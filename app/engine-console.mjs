// System › Health › Engine console: an admin types the engine's own commands (config, skills, gateway status…) and
// sees the answers live. The browser talks to this server, never to the engine directly; this server relays only
// the console's four message kinds and refuses anything that would open a shell, start a chat run or start or stop
// a server, so it can never be more than the engine's command line. Every command is written to the server log.
import {acceptWs} from './localbrowser.mjs';

// first words that would open a shell, run the agent, or start a long-running server inside the console
const DENY=new Set(['shell','sh','bash','zsh','exec','terminal','tui','pty','acp','chat','run','dashboard','web','serve','uninstall','claw']);
const DENY2=[/^mcp\s+serve\b/,/^cron\s+run\b/];
// aqeelOS keeps the engine running itself (and restarts it when it stops), so these go through the page's buttons
const GW=/^gateway\s+(run|start|stop|restart|install|uninstall)\b/;
export function consoleRefusal(line){const l=String(line||'').trim();
 if(!l)return null;
 if(l.length>1000)return 'That command is too long.';
 if(/[\x00-\x08\x0b-\x1f\x7f]/.test(l))return 'That command has characters the console does not accept.';
 if(/^[!$]/.test(l)||/[;|&`<>]|\$\(/.test(l))return 'The console runs engine commands only, not shell commands.';
 const low=l.toLowerCase(),w=low.split(/\s+/)[0];
 if(GW.test(low))return 'Use Start, Stop and Restart on the Health page for that: aqeelOS keeps the agents running itself.';
 if(DENY.has(w)||DENY2.some(r=>r.test(low)))return '"'+(DENY.has(w)?w:low.split(/\s+/).slice(0,2).join(' '))+'" is not available here: it would start a shell, a chat or a server. Use the app for that.';
 return null}

export function createEngineConsole({DASH,DASH_TOKEN}){
 let open=0;
 async function upgrade(req,sock,head,{agent,user}){
  if(open>=4){sock.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');return}
  const ws=acceptWs(req,sock,head);if(!ws)return;open++;
  const say=o=>ws.send(JSON.stringify(o));
  let up=null,closed=false,pending=null,idle;
  const bump=()=>{clearTimeout(idle);idle=setTimeout(()=>{say({type:'error',message:'Closed after 30 minutes without a command.'});end()},30*60e3)};
  const end=()=>{if(closed)return;closed=true;open--;clearTimeout(idle);try{up?.close()}catch{}ws.close()};
  ws.ev.onclose=end;bump();
  // a short-lived ticket when the engine asks for one, else its session token
  let auth='token='+encodeURIComponent(DASH_TOKEN);
  try{const r=await fetch(DASH.origin+'/api/auth/ws-ticket',{method:'POST',headers:{'x-hermes-session-token':DASH_TOKEN},signal:AbortSignal.timeout(5000)});if(r.ok){const j=await r.json();if(j?.ticket)auth='ticket='+encodeURIComponent(j.ticket)}}catch{}
  if(closed)return;
  const url=DASH.origin.replace(/^http/,'ws')+'/api/console?profile='+encodeURIComponent(agent)+'&'+auth;
  try{up=new WebSocket(url,{headers:{'x-hermes-session-token':DASH_TOKEN}})}catch(e){say({type:'error',message:'The engine console could not be reached.'});return end()}
  let ready=false;
  up.onmessage=ev=>{let f;try{f=JSON.parse(String(ev.data))}catch{return}
   if(f?.type==='ready')ready=true;
   if(f?.type==='confirm_required')pending=String(f.command||'');
   if(f?.type==='complete'&&f.status!=='confirm_required')pending=null;
   ws.send(JSON.stringify(f))};
  up.onerror=()=>{};
  up.onclose=ev=>{if(closed)return;say({type:'error',message:ready?'The engine closed the console.':'This engine has no console, or it refused the connection ('+(ev.code||'no answer')+').'});end()};
  ws.ev.onmessage=t=>{let f;try{f=JSON.parse(t)}catch{return}if(!up||up.readyState!==1)return;bump();
   if(f?.type==='ping')return up.send('{"type":"ping"}');
   if(f?.type==='cancel'){pending=null;return up.send('{"type":"cancel"}')}
   if(f?.type==='confirm'){if(pending==null||String(f.command)!==pending)return say({type:'complete',status:'cancelled'});const c=pending;pending=null;console.log('engine console:',user,'confirmed',JSON.stringify(c),'on',agent);return up.send(JSON.stringify({type:'confirm',command:c}))}
   if(f?.type==='input'){const line=String(f.line||'').trim().replace(/^(hermes|aqeelos)\s+/i,'');const no=consoleRefusal(line);
    if(no){say({type:'error',message:no});return say({type:'complete',status:'refused'})}
    console.log('engine console:',user,'ran',JSON.stringify(line),'on',agent);return up.send(JSON.stringify({type:'input',line}))}}}
 return {upgrade}}
