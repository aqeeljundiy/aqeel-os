// The screen viewer's own connection (BACKLOG AUD-15, 13 Nov 2026). Until now the browser's noVNC opened /screen/websockify with
// the session cookie alone, and the app passed it to a websockify it started per agent on 127.0.0.1:<random port>, a port with no
// password in front of a screen that has none (Xvnc -SecurityTypes None): while anyone watched, and a minute after, every user on
// the box (each agent's own Linux user among them) could connect to that port and watch and type on that agent's screen.
// Now:
//  - no port at all: the app speaks the WebSocket itself and connects straight to the screen's private socket (only the agent's
//    user and the app's may open it; the old shared screen :99 is x11vnc on 127.0.0.1:5900, behind the box's local firewall);
//  - a viewer first asks for a ticket (POST /ui/screens/<agent>/ticket, the same rights as seeing that agent's screen). A ticket
//    is signed with the app's secret, names that agent (and whether it is the shared screen), is bound to the sign-in cookie that
//    asked for it, lives 30 seconds and opens one connection: a second use, another agent, another sign-in or a late one is refused;
//  - the rights are looked at again every minute while the screen is open: signed out everywhere, the agent no longer shared, the
//    connection closes. Closing the viewer closes the screen's connection at once (no bridge is left running).
// noVNC itself gets its tickets from app/vnc-ticket.js, which page() puts into its page.
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {request as httpRequest} from 'node:http';

export const TICKET_MS=30000;
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME=4*1024*1024;   // what a viewer may send in one frame (keys, pointer, a clipboard of at most 256 KB)
const b64=s=>Buffer.from(s).toString('base64url');
// the sign-in a request carries: a hash of its session cookie (the cookie itself is never kept)
export const sessionOf=req=>{const m=/(?:^|;\s*)hui=([^;]+)/.exec(req?.headers?.cookie||'');return m?createHash('sha256').update(m[1]).digest('base64url').slice(0,32):''};

export function createScreenTickets({sign,now=()=>Date.now(),ttl=TICKET_MS}){
 const used=new Map();   // nonce -> expiry: a ticket opens one connection
 const prune=t=>{for(const [k,exp] of used)if(exp<=t)used.delete(k)};
 function issue(req,agent,{ads=false}={}){const sid=sessionOf(req);if(!sid)return null;
  const body=[agent,ads?1:0,sid,now()+ttl,randomBytes(12).toString('base64url')].join('|');return b64(body)+'.'+sign(body)}
 // {ok:true} or {ok:false,why}: why is for the log and the tests, never shown to the caller
 function redeem(ticket,{agent,ads=false,sid}){
  const t=now();prune(t);
  const [p,sig]=String(ticket||'').split('.');if(!p||!sig)return {ok:false,why:'missing'};
  let body;try{body=Buffer.from(p,'base64url').toString('utf8')}catch{return {ok:false,why:'bad'}}
  const a=Buffer.from(sign(body)),b=Buffer.from(sig);if(a.length!==b.length||!timingSafeEqual(a,b))return {ok:false,why:'bad'};
  const [ag,ad,s,exp,nonce]=body.split('|');
  if(ag!==agent||ad!==(ads?'1':'0'))return {ok:false,why:'agent'};
  if(!sid||s!==sid)return {ok:false,why:'session'};
  if(!(Number(exp)>t))return {ok:false,why:'expired'};
  if(used.has(nonce))return {ok:false,why:'replay'};
  used.set(nonce,Number(exp));return {ok:true}}
 return {issue,redeem}}

/* ---------- the WebSocket, server side (RFC 6455), enough for noVNC: binary frames both ways, ping, close ---------- */
export function acceptWs(req,sock){
 const key=req.headers['sec-websocket-key'];
 if(!key||String(req.headers.upgrade||'').toLowerCase()!=='websocket'||req.headers['sec-websocket-version']!=='13'){sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');return false}
 // noVNC asks for "binary"; websockify's old "base64" is not spoken
 const proto=String(req.headers['sec-websocket-protocol']||'').split(',').map(s=>s.trim()).includes('binary')?'\r\nSec-WebSocket-Protocol: binary':'';
 sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+createHash('sha1').update(key+GUID).digest('base64')+proto+'\r\n\r\n');return true}
export function wsFrame(buf,op=2){const n=buf.length;let h;
 if(n<126)h=Buffer.from([0x80|op,n]);else if(n<65536){h=Buffer.alloc(4);h[0]=0x80|op;h[1]=126;h.writeUInt16BE(n,2)}else{h=Buffer.alloc(10);h[0]=0x80|op;h[1]=127;h.writeBigUInt64BE(BigInt(n),2)}
 return Buffer.concat([h,buf])}
// frames from the browser: every one must be masked (a client that does not mask is not a browser); data frames' payloads go to onData
export function wsReader(onData,onControl){let buf=Buffer.alloc(0);
 return chunk=>{buf=buf.length?Buffer.concat([buf,chunk]):chunk;
  while(buf.length>=2){const op=buf[0]&15,masked=buf[1]&0x80;let len=buf[1]&127,off=2;
   if(len===126){if(buf.length<4)return;len=buf.readUInt16BE(2);off=4}else if(len===127){if(buf.length<10)return;const big=buf.readBigUInt64BE(2);if(big>BigInt(MAX_FRAME))return onControl('too-big');len=Number(big);off=10}
   if(len>MAX_FRAME)return onControl('too-big');if(!masked)return onControl('unmasked');
   if(buf.length<off+4+len)return;
   const mask=buf.subarray(off,off+4),p=Buffer.from(buf.subarray(off+4,off+4+len));for(let i=0;i<p.length;i++)p[i]^=mask[i&3];
   buf=buf.subarray(off+4+len);
   if(op<=2)onData(p);else if(onControl(op===8?'close':op===9?'ping':op===10?'pong':'bad',p)===false)return}}}
// the browser's socket <-> the screen's VNC connection; returns end(code): closes both (with a close frame when a code is given)
export function pipeWs(sock,up,head,onEnd){let done=false;
 const end=code=>{if(done)return;done=true;try{if(code&&sock.writable)sock.end(wsFrame(Buffer.from([code>>8,code&255]),8));else sock.destroy()}catch{}up.destroy();setTimeout(()=>sock.destroy(),2000).unref();onEnd?.()};
 const read=wsReader(d=>{if(!done&&!up.write(d))sock.pause()},(k,p)=>{if(k==='ping'){sock.write(wsFrame(p,10));return}if(k==='pong')return;end(k==='close'?1000:1002);return false});
 up.on('drain',()=>sock.resume());sock.on('drain',()=>up.resume());
 up.on('data',d=>{if(!sock.write(wsFrame(d)))up.pause()});
 // the upgraded socket comes paused from the HTTP server: a 'data' listener alone does not start it
 sock.on('data',read);if(head?.length)read(head);sock.resume();
 // 'end' too: the HTTP server's sockets are half-open ones, so a viewer that goes away ends its side and is never closed by itself
 up.on('close',()=>end(1000));sock.on('end',()=>end());sock.on('close',()=>end());up.on('error',()=>end(1011));sock.on('error',()=>end());
 return end}

/* ---------- the routes: the live connection (an upgrade) and noVNC's own page ---------- */
export function createScreenLink({tickets,me,users,screens,validCookie,sameOrigin,screenUrl,security={}}){
 const deny=(sock,why)=>{sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');if(why)console.log('screen viewer refused: '+why)};
 async function upgrade(req,sock,head){
  const url=new URL(req.url,'http://x');
  if(!validCookie(req)||!sameOrigin(req))return deny(sock);
  // screen=ads: the old shared :99 screen, no longer offered in the app (each agent has its own AdsPower); admins only
  const ads=url.searchParams.get('screen')==='ads',agent=url.searchParams.get('agent')||'default';
  const may=u=>!!u&&!users.gate(u,'/ui/screens/'+agent,'GET',new URLSearchParams(),agent)&&(!ads||users.isAdmin(u));
  const u=await me(req);if(!may(u))return deny(sock);
  const t=tickets.redeem(url.searchParams.get('ticket'),{agent,ads,sid:sessionOf(req)});if(!t.ok)return deny(sock,t.why+' ('+agent+')');
  // still allowed: the same person, still signed in and still allowed to see this screen (looked at every minute)
  const still=async()=>{const v=await me(req).catch(()=>null);return !!v&&v.id===u.id&&may(v)};
  return screens.upgrade(req,sock,head,ads?null:agent,users.isAdmin(u),still)}
 // noVNC's page and files (the shared noVNC on 127.0.0.1:6080 serves them); its page gets the ticket script
 function page(req,res){
  const url=new URL(req.url,'http://x'),rel=url.pathname.replace(/^\/screen/,'')||'/';
  const up=httpRequest({hostname:screenUrl.hostname,port:screenUrl.port,path:rel,method:'GET',headers:{host:screenUrl.host}},r=>{
   const head={'content-type':r.headers['content-type']||'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff','x-frame-options':'SAMEORIGIN','content-security-policy':"frame-ancestors 'self'",'referrer-policy':'same-origin'};
   if(!/^\/vnc(_lite)?\.html$/.test(rel)||r.statusCode!==200){res.writeHead(r.statusCode||502,head);r.pipe(res);return}
   const parts=[];r.on('data',c=>parts.push(c));r.on('end',()=>{const html=Buffer.concat(parts).toString('utf8').replace('</head>','<script src="/app/vnc-ticket.js"></script></head>');res.writeHead(200,head);res.end(html)})});
  up.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'content-type':'text/plain; charset=utf-8',...security});res.end('The screen is not running on the box.')}});up.end()}
 return {upgrade,page}}
