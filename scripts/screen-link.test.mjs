// AUD-15 (13 Nov 2026): the screen viewer's own connection (app/screen-link.mjs, app/screens.mjs). A ticket opens one connection to one
// agent's screen for one sign-in within 30 s; the app speaks the WebSocket itself and connects to the screen's private socket (no
// websockify port any more); rights are looked at again while the screen is open; closing the viewer closes the screen's connection.
// The end-to-end part runs the real createScreens().upgrade against a stand-in VNC server on a Unix socket (Linux/macOS).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,createHash} from 'node:crypto';
import {createServer as httpServer} from 'node:http';
import {createServer as netServer,connect} from 'node:net';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createScreenTickets,createScreenLink,sessionOf,acceptWs,pipeWs,wsFrame,wsReader,TICKET_MS} from '../app/screen-link.mjs';

const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const SECRET=randomBytes(16);const sign=v=>createHmac('sha256',SECRET).update(v).digest('base64url');
const req=cookie=>({headers:{cookie:'hui='+cookie}});
const posix=process.platform!=='win32';

test('a ticket opens one connection to one agent for one sign-in, within 30 seconds',()=>{
 let t=1_000_000;const tk=createScreenTickets({sign,now:()=>t});const r=req('owner.1.aaa.sig'),sid=sessionOf(r);
 assert.equal(TICKET_MS,30000);
 const a=tk.issue(r,'agent-a');assert.ok(a);
 assert.deepEqual(tk.redeem(a,{agent:'agent-a',sid}),{ok:true});
 assert.equal(tk.redeem(a,{agent:'agent-a',sid}).why,'replay','used once only');
 const b=tk.issue(r,'agent-a');
 assert.equal(tk.redeem(b,{agent:'agent-b',sid}).why,'agent','another agent');
 assert.equal(tk.redeem(b,{agent:'agent-a',ads:true,sid}).why,'agent','the shared screen is not the agent\'s');
 assert.equal(tk.redeem(b,{agent:'agent-a',sid:sessionOf(req('owner.1.bbb.sig'))}).why,'session','another sign-in of the same person');
 assert.equal(tk.redeem(b,{agent:'agent-a',sid:''}).why,'session');
 t+=TICKET_MS+1;assert.equal(tk.redeem(b,{agent:'agent-a',sid}).why,'expired');
 const c=tk.issue(r,'agent-a');const [p]=c.split('.');
 assert.equal(tk.redeem(p+'.'+sign('x'),{agent:'agent-a',sid}).why,'bad','a signature that is not for this ticket');
 const forged=Buffer.from(['agent-a',0,sid,t+TICKET_MS,'n1'].join('|')).toString('base64url')+'.'+createHmac('sha256','another secret').update('x').digest('base64url');
 assert.equal(tk.redeem(forged,{agent:'agent-a',sid}).why,'bad');
 assert.equal(tk.redeem('',{agent:'agent-a',sid}).why,'missing');assert.equal(tk.redeem(null,{agent:'agent-a',sid}).why,'missing');
 assert.equal(tk.issue({headers:{}},'agent-a'),null,'no sign-in, no ticket');
 assert.notEqual(sid,'owner.1.aaa.sig');assert.equal(sid.length,32,'the cookie itself is never kept, only a hash')});

test('WebSocket frames: lengths of every size, masked frames split across reads, unmasked or oversized frames refused',()=>{
 for(const n of [0,125,126,65535,65536,70000]){const f=wsFrame(Buffer.alloc(n,7));assert.equal(f[0],0x82);
  const hl=n<126?2:n<65536?4:10;assert.equal(f.length,hl+n);if(n>=126&&n<65536)assert.equal(f.readUInt16BE(2),n);if(n>=65536)assert.equal(Number(f.readBigUInt64BE(2)),n)}
 const mask=Buffer.from([1,2,3,4]),masked=(op,data)=>{const p=Buffer.from(data);const h=p.length<126?Buffer.from([0x80|op,0x80|p.length]):Buffer.from([0x80|op,0x80|126,p.length>>8,p.length&255]);const m=Buffer.from(p.map((b,i)=>b^mask[i&3]));return Buffer.concat([h,mask,m])};
 const got=[],ctl=[];const read=wsReader(d=>got.push(d.toString()),(k,p)=>{ctl.push(k)});
 const all=Buffer.concat([masked(2,'hello'),masked(9,'pi'),masked(2,'x'.repeat(300))]);
 for(let i=0;i<all.length;i+=7)read(all.subarray(i,i+7));
 assert.deepEqual(got,['hello','x'.repeat(300)]);assert.deepEqual(ctl,['ping']);
 const bad=[];wsReader(()=>{},k=>{bad.push(k);return false})(Buffer.from([0x82,5,1,2,3,4,5]));assert.deepEqual(bad,['unmasked']);
 const big=[];wsReader(()=>{},k=>{big.push(k);return false})(Buffer.from([0x82,0xff,0,0,0,0,1,0,0,0]));assert.deepEqual(big,['too-big'])});

/* ---------- end to end: the real screens.upgrade behind the real screenLink.upgrade ---------- */
async function rig(){
 const T=mkdtempSync(path.join(tmpdir(),'aq-scr-')),H=path.join(T,'hermes'),bin=path.join(T,'bin');
 mkdirSync(bin);for(const n of ['Xvnc','fluxbox']){writeFileSync(path.join(bin,n),'#!/bin/sh\nexit 0\n');chmodSync(path.join(bin,n),0o755)}
 // the agents' screens: each a profile with a running launcher (this process) and the screen's socket, answered by a stand-in VNC
 const vnc={a:[],b:[]};
 for(const [a,list] of [['agent-a',vnc.a],['agent-b',vnc.b]]){const d=path.join(H,'profiles',a,'bot-desktop');mkdirSync(d,{recursive:true});
  writeFileSync(path.join(H,'profiles',a,'config.yaml'),'model: x\n');writeFileSync(path.join(d,'launcher.pid'),String(process.pid));
  const srv=netServer(s=>{const c={sock:s,got:'',closed:false};list.push(c);s.on('data',d=>c.got+=d);s.on('close',()=>c.closed=true);s.on('error',()=>{});s.write('RFB 003.008\n')});
  await new Promise(r=>srv.listen(path.join(d,'rfb.sock'),r));list.srv=srv}
 Object.assign(process.env,{HERMES_HOME:H,AQEELOS_LIVE:'0',PATH:bin+path.delimiter+process.env.PATH});
 const {createScreens}=await import('../app/screens.mjs?'+Date.now());
 // people: the owner, an admin, and a member who may see agent-a only (rights can change mid-connection)
 const people={own:{id:'owner',admin:true,agents:null},mem:{id:'m1',admin:false,agents:['agent-a']},adm:{id:'a1',admin:true,agents:null}};
 const cookies={'owner.1.x.s':'own','owner.1.y.s':'own','m1.1.x.s':'mem','a1.1.x.s':'adm'};
 const cookieOf=r=>(/(?:^|;\s*)hui=([^;]+)/.exec(r.headers.cookie||'')||[])[1];
 const users={isAdmin:u=>!!u.admin,gate:(u,p,m,q,agent)=>u.admin||u.agents?.includes(agent)?null:{status:403,error:'no'}};
 const me=async r=>{const k=cookies[cookieOf(r)];return k?people[k]:null};
 const tickets=createScreenTickets({sign});
 const screens=createScreens({tickets,recheckMs:150});
 const link=createScreenLink({tickets,me,users,screens,validCookie:r=>!!cookies[cookieOf(r)],sameOrigin:r=>{const o=r.headers.origin;return !o||new URL(o).host===r.headers.host},screenUrl:new URL('http://127.0.0.1:9')});
 const http=httpServer((q,s)=>{s.writeHead(404);s.end()});http.on('upgrade',(q,s,h)=>link.upgrade(q,s,h).catch(()=>s.destroy()));
 await new Promise(r=>http.listen(0,'127.0.0.1',r));const port=http.address().port;
 // a browser's WebSocket: the handshake's answer, then the frames it receives
 const opened=[];
 function open(agent,{cookie,ticket,origin,ads}={}){return new Promise(res=>{const s=connect(port,'127.0.0.1');opened.push(s);let buf=Buffer.alloc(0),status=null;const frames=[];
  const q=new URLSearchParams({agent,...(ticket?{ticket}:{}),...(ads?{screen:'ads'}:{})});
  s.on('connect',()=>s.write(`GET /screen/websockify?${q} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Protocol: binary\r\n${cookie?'Cookie: hui='+cookie+'\r\n':''}${origin?'Origin: '+origin+'\r\n':''}\r\n`));
  s.on('data',d=>{buf=Buffer.concat([buf,d]);if(status===null){const i=buf.indexOf('\r\n\r\n');if(i<0)return;const head=buf.subarray(0,i).toString();status=Number(head.split(' ')[1]);buf=buf.subarray(i+4);res({s,status,head,frames})}
   while(buf.length>=2){let len=buf[1]&127,off=2;if(len===126){len=buf.readUInt16BE(2);off=4}if(buf.length<off+len)break;frames.push({op:buf[0]&15,data:buf.subarray(off,off+len)});buf=buf.subarray(off+len)}});
  s.on('close',()=>{if(status===null)res({s,status:0,frames})});s.on('error',()=>{})})}
 const send=(s,text)=>{const p=Buffer.from(text),m=randomBytes(4);s.write(Buffer.concat([Buffer.from([0x82,0x80|p.length]),m,Buffer.from(p.map((b,i)=>b^m[i%4]))]))};
 const ticketFor=(cookie,agent,ads=false)=>tickets.issue(req(cookie),agent,{ads});
 const close=()=>{for(const s of opened)s.destroy();http.close();http.closeAllConnections?.();vnc.a.srv.close();vnc.b.srv.close()};
 return {open,send,ticketFor,vnc,people,close}}
const wait=(f,ms=3000)=>new Promise((res,rej)=>{const t0=Date.now();const i=setInterval(()=>{if(f()){clearInterval(i);res()}else if(Date.now()-t0>ms){clearInterval(i);rej(new Error('timed out'))}},20)});

test('end to end: only a signed-in person allowed to see that screen, with a fresh ticket for it, gets connected',{skip:!posix&&'Unix sockets'},async()=>{
 const r=await rig();
 try{
  // no ticket, a ticket for another agent, another sign-in's ticket, a member without rights, cross-site, no sign-in
  assert.equal((await r.open('agent-a',{cookie:'owner.1.x.s'})).status,403,'no ticket');
  assert.equal((await r.open('agent-a',{cookie:'owner.1.x.s',ticket:r.ticketFor('owner.1.x.s','agent-b')})).status,403,'a ticket for agent B does not open agent A');
  assert.equal((await r.open('agent-a',{cookie:'owner.1.x.s',ticket:r.ticketFor('owner.1.y.s','agent-a')})).status,403,'a ticket of another sign-in');
  assert.equal((await r.open('agent-b',{cookie:'m1.1.x.s',ticket:r.ticketFor('m1.1.x.s','agent-b')})).status,403,'a member without rights on agent B, even holding a ticket');
  assert.equal((await r.open('agent-a',{cookie:'owner.1.x.s',ticket:r.ticketFor('owner.1.x.s','agent-a'),origin:'https://evil.example'})).status,403,'another site');
  assert.equal((await r.open('agent-a',{ticket:r.ticketFor('owner.1.x.s','agent-a')})).status,403,'not signed in');
  assert.equal((await r.open('default',{cookie:'m1.1.x.s',ticket:r.ticketFor('m1.1.x.s','default',true),ads:true})).status,403,'the shared screen is for admins');
  assert.equal(r.vnc.a.length+r.vnc.b.length,0,'no refused viewer ever reached a screen');
  // the member's own screen, with a ticket: connected; the same ticket again is refused (replay)
  const t=r.ticketFor('m1.1.x.s','agent-a');const ok=await r.open('agent-a',{cookie:'m1.1.x.s',ticket:t});
  assert.equal(ok.status,101,ok.head);assert.match(ok.head,/Sec-WebSocket-Protocol: binary/);
  assert.equal((await r.open('agent-a',{cookie:'m1.1.x.s',ticket:t})).status,403,'replay');
  // bytes both ways: the screen's greeting arrives as a binary frame, what the viewer types reaches the screen
  await wait(()=>ok.frames.length>0);assert.equal(ok.frames[0].op,2);assert.equal(ok.frames[0].data.toString(),'RFB 003.008\n');
  r.send(ok.s,'RFB 003.008\n');await wait(()=>r.vnc.a[0]?.got==='RFB 003.008\n');
  // closing the viewer closes the screen's connection
  ok.s.destroy();await wait(()=>r.vnc.a[0].closed);
  // a ticket that waited too long
  const late=await r.open('agent-a',{cookie:'m1.1.x.s',ticket:Buffer.from(['agent-a',0,sessionOf(req('m1.1.x.s')),Date.now()-1,'n9'].join('|')).toString('base64url')+'.'+sign(['agent-a',0,sessionOf(req('m1.1.x.s')),Date.now()-1,'n9'].join('|'))});
  assert.equal(late.status,403,'expired');assert.equal(r.vnc.a.length,1)
 }finally{r.close()}});

test('end to end: rights taken away while the screen is open close it; the screen closing closes the viewer cleanly',{skip:!posix&&'Unix sockets'},async()=>{
 const r=await rig();
 try{
  const v=await r.open('agent-a',{cookie:'m1.1.x.s',ticket:r.ticketFor('m1.1.x.s','agent-a')});assert.equal(v.status,101);
  await wait(()=>r.vnc.a.length===1);
  r.people.mem.agents=[];   // agent A is no longer shared with this member
  await wait(()=>v.frames.some(f=>f.op===8));const c=v.frames.find(f=>f.op===8);assert.equal(c.data.readUInt16BE(0),1008,'closed: not allowed any more');
  await wait(()=>r.vnc.a[0].closed);
  r.people.mem.agents=['agent-a'];
  const w=await r.open('agent-a',{cookie:'m1.1.x.s',ticket:r.ticketFor('m1.1.x.s','agent-a')});assert.equal(w.status,101);
  await wait(()=>r.vnc.a.length===2);r.vnc.a[1].sock.destroy();
  await wait(()=>w.frames.some(f=>f.op===8));assert.equal(w.frames.find(f=>f.op===8).data.readUInt16BE(0),1000,'a clean close, so noVNC reconnects with a new ticket')
 }finally{r.close()}});

test('an expired ticket is refused at the door',{skip:!posix&&'Unix sockets'},async()=>{
 let t=Date.now();const tk=createScreenTickets({sign,now:()=>t});const x=tk.issue(req('owner.1.x.s'),'agent-a');t+=TICKET_MS+5;
 assert.equal(tk.redeem(x,{agent:'agent-a',sid:sessionOf(req('owner.1.x.s'))}).why,'expired')});

test('no port is opened for a viewer: the app starts no websockify and the page asks for a ticket before it connects',()=>{
 const scr=readFileSync(path.join(ROOT,'app','screens.mjs'),'utf8'),js=readFileSync(path.join(ROOT,'app','screen.js'),'utf8'),vt=readFileSync(path.join(ROOT,'app','vnc-ticket.js'),'utf8');
 assert.doesNotMatch(scr,/spawn\('websockify'/);assert.doesNotMatch(scr,/freePort|listen\(0,'127\.0\.0\.1'/);
 assert.match(scr,/target=\{path:sockOf\(agent\)\}/,'straight to the screen\'s private socket');
 assert.equal((js.match(/vnc\.html\?autoconnect=0/g)||[]).length>=1,true);assert.doesNotMatch(js,/autoconnect=1/);
 assert.match(vt,/\/ticket'/);assert.match(vt,/noVNC_setting_path/);assert.match(vt,/noVNC_reconnecting/)});

test('acceptWs refuses what is not a WebSocket handshake; pipeWs answers a ping and ends both sides',{skip:!posix&&'sockets'},async()=>{
 const out=[];const fake={headers:{upgrade:'websocket','sec-websocket-version':'13'}};const s={end:x=>out.push(String(x)),write:x=>out.push(String(x))};
 assert.equal(acceptWs(fake,s),false);assert.match(out[0],/400/);
 const key='dGhlIHNhbXBsZSBub25jZQ==';out.length=0;assert.equal(acceptWs({headers:{...fake.headers,'sec-websocket-key':key}},s),true);
 assert.match(out[0],new RegExp('Sec-WebSocket-Accept: '+createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64').replace(/[+/=]/g,'\\$&')));
 // a pair of real sockets: browser side and screen side
 const srv=netServer();await new Promise(r=>srv.listen(0,'127.0.0.1',r));const p=srv.address().port;
 const pair=()=>new Promise(r=>{srv.once('connection',x=>r([c,x]));const c=connect(p,'127.0.0.1')});
 const [bc,bs]=await pair(),[uc,us]=await pair();let ended=false,usClosed=false;us.on('close',()=>usClosed=true);us.on('error',()=>{});us.resume();
 pipeWs(bs,uc,null,()=>ended=true);const got=[];bc.on('data',d=>got.push(d));
 const m=Buffer.from([9,9,9,9]);bc.write(Buffer.concat([Buffer.from([0x89,0x82]),m,Buffer.from([1^9,2^9])]));
 await wait(()=>Buffer.concat(got).includes(Buffer.from([0x8a,2,1,2])));
 bc.destroy();await wait(()=>ended);await wait(()=>usClosed,'the screen side is closed too');srv.close()});
