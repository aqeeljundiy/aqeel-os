#!/usr/bin/env node
// Wake proxy (OPS-4/OPS-12, agreed 11 Nov 2026). An agent's screen and Chrome sleep after sitting idle; the engine's browser
// tool still connects to the agent's DevTools port (browser.cdp_url, 127.0.0.1:96xx). This listens on that port for every
// agent whose screen may sleep, and passes each connection through to Chrome, which now runs on an inner port (96xx+10000).
// When Chrome does not answer (asleep), it asks the root script to start the screen (<dir>/<agent>.wake), waits until Chrome
// answers (up to 90 s), then passes the connection on: the browser tool only sees a slower first answer.
// Bytes from a client mark the agent as in use (<dir>/<agent>.active, its time), which keeps it awake.
// Run by scripts/agent-users.sh as its own user (aq-wake), with the folder the root script shares with it:
//   node wake-proxy.mjs /var/lib/aqeelos/wake        (ports: "<agent> <outer> <inner>" per line in <dir>/ports)
import {createServer,connect} from 'node:net';
import {readFileSync,writeFileSync,utimesSync} from 'node:fs';
import path from 'node:path';

const DIR=process.argv[2]||'/var/lib/aqeelos/wake';
const NAME=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const WAIT_MS=Number(process.env.AQ_WAKE_WAIT_MS||90000);
export function parsePorts(text){const out=new Map();for(const l of String(text||'').split('\n')){const [n,o,i]=l.trim().split(/\s+/);
 if(NAME.test(n||'')&&/^\d{2,5}$/.test(o||'')&&/^\d{2,5}$/.test(i||'')&&o!==i)out.set(n,{outer:Number(o),inner:Number(i)})}return out}

const mark=(n,kind)=>{const f=path.join(DIR,n+'.'+kind),t=new Date();try{utimesSync(f,t,t)}catch{try{writeFileSync(f,'')}catch{}}};
const lastMark=new Map();
const active=n=>{const t=Date.now();if(t-(lastMark.get(n)||0)<20000)return;lastMark.set(n,t);mark(n,'active')};
const tryConnect=port=>new Promise(res=>{const s=connect(port,'127.0.0.1');s.once('connect',()=>res(s));s.once('error',()=>{s.destroy();res(null)})});

async function serve(n,inner,client){
 client.pause();client.on('error',()=>{});active(n);
 let up=await tryConnect(inner);
 if(!up){mark(n,'wake');console.log(new Date().toISOString()+' '+n+': asleep, waking it');const end=Date.now()+WAIT_MS;
  while(!up&&Date.now()<end&&!client.destroyed){await new Promise(r=>setTimeout(r,300));up=await tryConnect(inner);if(!up&&Date.now()%5000<300)mark(n,'wake')}}
 if(!up){client.destroy();return}
 if(client.destroyed){up.destroy();return}
 up.on('error',()=>client.destroy());client.on('error',()=>up.destroy());
 client.on('data',()=>active(n));client.pipe(up);up.pipe(client);client.resume();
 client.on('close',()=>up.destroy());up.on('close',()=>client.destroy())}

const servers=new Map();   // agent -> {outer,inner,srv}
function sync(){let want;try{want=parsePorts(readFileSync(path.join(DIR,'ports'),'utf8'))}catch{want=new Map()}
 for(const [n,s] of servers)if(!want.has(n)||want.get(n).outer!==s.outer||want.get(n).inner!==s.inner){s.srv.close();servers.delete(n)}
 for(const [n,p] of want){if(servers.has(n))continue;const srv=createServer(c=>serve(n,p.inner,c));const s={...p,srv};servers.set(n,s);
  // the port can still be held by a Chrome started before this layout: tried again on the next pass
  srv.once('error',e=>{if(servers.get(n)===s)servers.delete(n);if(e.code!=='EADDRINUSE')console.log(n+': '+e.message)});
  srv.listen(p.outer,'127.0.0.1',()=>console.log(new Date().toISOString()+' '+n+': '+p.outer+' -> '+p.inner))}}
if(process.argv[1]&&import.meta.url.endsWith(path.basename(process.argv[1]))){sync();setInterval(sync,5000)}
