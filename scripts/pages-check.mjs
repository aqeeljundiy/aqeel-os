// Every page of a running copy, signed in: a full-length screenshot and its visible text (/tmp/aud/<width>_<route>.png|.txt),
// plus how long each page took to show its content. Env: W, H, BASE, PWFILE, NAME (sign in as someone else), ONLY.
import {spawn} from 'node:child_process';import {readdirSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';import {homedir} from 'node:os';
const W=+(process.env.W||1280),H=+(process.env.H||900);const BASE=process.env.BASE||'http://127.0.0.1:4400';const pw=readFileSync(process.env.PWFILE||'/tmp/.ppw','utf8').trim();
const only=(process.env.ONLY||'').split(',').filter(Boolean);const OUT=process.env.OUT||'/tmp/aud';
const tools=homedir()+'/.hermes/tools',dir=readdirSync(tools).find(d=>d.startsWith('chromium'));const port=9500+Math.floor(Math.random()*300);
const chrome=spawn(`${tools}/${dir}/chrome-linux64/chrome`,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port='+port,`--window-size=${W},${H}`,'about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));mkdirSync(OUT,{recursive:true});
try{
 const login=await fetch(BASE+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:process.env.NAME||undefined,password:pw})});const ck=(login.headers.get('set-cookie')||'').split(';')[0];const [cn,cv]=ck.split('=');
 // headless Chrome can take well over 10 s to start on a busy box: wait up to 30 s, and say so instead of crashing
 let tgt;for(let i=0;i<120&&!tgt;i++){await sleep(250);try{tgt=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page')}catch{}}
 if(!tgt)throw new Error('headless Chrome did not start within 30 s');
 const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const wait=new Map();const errs=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&wait.has(m.id)){wait.get(m.id)(m);wait.delete(m.id)}if(m.method==='Runtime.exceptionThrown')errs.push(cur+': '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text||'').split('\n')[0])};
 // every browser step has 30 s: a stalled one says which page and step instead of the whole run being cut off with no
 // output by the deploy's time limit (1 Nov 2026: a run stalled after Skills and printed nothing)
 const cdp=(method,params={})=>new Promise((r,j)=>{const i=++id;const t=setTimeout(()=>{wait.delete(i);j(new Error(method+' took over 30 s'))},30000);wait.set(i,m=>{clearTimeout(t);r(m)});ws.send(JSON.stringify({id:i,method,params}))});
 await cdp('Network.enable');await cdp('Runtime.enable');await cdp('Network.setCookie',{name:cn,value:cv,domain:new URL(BASE).hostname,path:'/'});
 await cdp('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:W<700});
 const ev=async js=>(await cdp('Runtime.evaluate',{expression:js,awaitPromise:true,returnByValue:true})).result?.result?.value;
 await cdp('Page.navigate',{url:BASE+'/#/chat'});await sleep(4000);
 let routes=await ev(`(()=>{const out=['/chat'];for(const s of SECTIONS)for(const p of s.pages||[])out.push('/'+s.id+'/'+p.id);return out})()`)||[];if(only.length)routes=only;
 const times={};let cur='';
 for(const r of routes){cur=r;const t0=Date.now();try{await cdp('Page.navigate',{url:BASE+'/#'+r});
  // ready = the page has content and no loading placeholders left (an inline <i class="skel"> is a detail filled in
  // later, like a schedule's description being written, not the page loading: the same rule as core.js)
  for(let i=0;i<80;i++){await sleep(100);const ok=await ev(`!!document.querySelector('.page,.chat')&&![...document.querySelectorAll('#pg .skel,.page .skel')].some(n=>n.tagName!=='I')`);if(ok)break}
  times[r]=Date.now()-t0;await sleep(1200);
  const name=W+r.split('/').join('_');writeFileSync(OUT+'/'+name+'.txt',String(await ev(`(document.querySelector('.main')||document.body).innerText`)||''));
  const h=Math.min(4000,Math.max(H,Number(await ev(`Math.max(document.querySelector('.view,#view,.main')?.scrollHeight||0,document.body.scrollHeight)`))||H));
  await cdp('Emulation.setDeviceMetricsOverride',{width:W,height:h,deviceScaleFactor:1,mobile:W<700});await sleep(400);
  const s=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync(OUT+'/'+name+'.png',Buffer.from(s.result.data,'base64'));
  await cdp('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:W<700})}catch(e){errs.push(r+': stalled: '+e.message);times[r]=Date.now()-t0;await cdp('Page.navigate',{url:'about:blank'}).catch(()=>{});await sleep(500)}}
 console.log(JSON.stringify({pages:routes.length,ms:times,errors:[...new Set(errs)]}));
}finally{chrome.kill('SIGKILL')}
