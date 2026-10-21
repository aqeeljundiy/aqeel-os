// The tab an agent works in comes to the front of its screen (21 Oct 2026). An agent's Chrome on its AI box screen often
// has several tabs and the agent drives one in the background, so the screen showed another page and the owner couldn't
// see what it did. This watches every Chrome that has a screen (not headless, with a control port) and, when a page tab
// opens or goes to a new address, brings that tab to the front. Only top-level navigations count, never a page updating
// itself in the same place, and a tab is not pulled forward more than once a second.
import {execFile} from 'node:child_process';

const run=(c,a)=>new Promise(res=>execFile(c,a,{timeout:10000},(e,o)=>res(String(o||''))));
const blank=u=>!u||/^(about:blank|chrome:|chrome-untrusted:|devtools:)/.test(u);

export function startScreenFollow({log=m=>console.log(m),every=5000}={}){
 const conns=new Map();   // port → {ws, urls: Map(targetId → url), front, at}
 async function ports(){const out=await run('ps',['-eo','args=']);const set=new Set();
  for(const l of out.split('\n')){if(!/chrom/i.test(l)||/--type=|--headless/.test(l))continue;const m=/--remote-debugging-port=(\d+)/.exec(l);if(m&&+m[1]>0)set.add(+m[1])}
  return set}
 async function attach(port){let v;try{v=await (await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(3000)})).json()}catch{return}
  if(!v.webSocketDebuggerUrl||typeof WebSocket!=='function')return;
  const c={ws:new WebSocket(v.webSocketDebuggerUrl),urls:new Map(),front:'',at:0,id:1};conns.set(port,c);
  const send=(method,params={})=>{try{c.ws.send(JSON.stringify({id:c.id++,method,params}))}catch{}};
  const front=id=>{if(c.front===id||Date.now()-c.at<1000)return;c.front=id;c.at=Date.now();send('Target.activateTarget',{targetId:id})};
  const seen=(t,isNew)=>{if(t.type!=='page')return;const was=c.urls.get(t.targetId);c.urls.set(t.targetId,t.url);
   // a new address (not the same page with another #part), or a new tab that already has one
   const base=u=>String(u||'').split('#')[0];if(blank(t.url))return;if(isNew||(was!==undefined&&base(was)!==base(t.url)))front(t.targetId)};
  c.ws.onopen=()=>send('Target.setDiscoverTargets',{discover:true});
  c.ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}
   if(m.method==='Target.targetCreated')seen(m.params.targetInfo,true);
   else if(m.method==='Target.targetInfoChanged')seen(m.params.targetInfo,false);
   else if(m.method==='Target.targetDestroyed'){c.urls.delete(m.params.targetId);if(c.front===m.params.targetId)c.front=''}};
  // the tabs already open when it attaches are known, not pulled forward
  const first=c.ws.onmessage;let warm=true;c.ws.onmessage=e=>{if(warm){try{const m=JSON.parse(e.data);if(m.method==='Target.targetCreated'){const t=m.params.targetInfo;if(t.type==='page')c.urls.set(t.targetId,t.url);return}}catch{}}first(e)};
  setTimeout(()=>{warm=false},1500);
  c.ws.onclose=c.ws.onerror=()=>{if(conns.get(port)===c)conns.delete(port)}}
 async function pass(){const now=await ports();for(const p of now)if(!conns.has(p))await attach(p).catch(()=>{});
  for(const [p,c] of conns)if(!now.has(p)){try{c.ws.close()}catch{}conns.delete(p)}}
 pass().catch(()=>{});const t=setInterval(()=>pass().catch(()=>{}),every);t.unref?.();
 log('screen follow: the tab an agent works in comes to the front of its screen');
 return {stop(){clearInterval(t);for(const c of conns.values())try{c.ws.close()}catch{}conns.clear()},ports:()=>[...conns.keys()]}}
