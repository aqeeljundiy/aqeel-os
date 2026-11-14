// Headless screenshots of the test copy, signed in. Run on the box:
//   node scripts/shot.mjs <out.png> <hash route> [name] [password] [width] [height] [js to run before the shot]
// No password: the test owner password from /tmp/box-test.pw. Uses Hermes' bundled Chromium over CDP.
import {spawn} from 'node:child_process';import {readdirSync,writeFileSync,readFileSync} from 'node:fs';import {homedir} from 'node:os';
const [out='/tmp/shot.png',hash='#/chat',name='',pw0,w='1280',h='800',js='']=process.argv.slice(2);
const BASE=process.env.BASE||'http://127.0.0.1:4402',pw=pw0||readFileSync(process.env.PWFILE||'/tmp/ppl/pw','utf8').trim();
const tools=homedir()+'/.hermes/tools',dir=readdirSync(tools).find(d=>d.startsWith('chromium'));
const port=9400+Math.floor(Math.random()*400);
const chrome=spawn(`${tools}/${dir}/chrome-linux64/chrome`,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port='+port,'--user-data-dir=/tmp/shot-'+port,`--window-size=${w},${h}`,'about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const login=await fetch(BASE+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,password:pw})});
 const ck=(login.headers.get('set-cookie')||'').split(';')[0].split('=');if(!login.ok)throw new Error('could not sign in to the test copy at '+BASE+' (HTTP '+login.status+': '+(await login.text().catch(()=>'')).slice(0,160)+')');
 let tgt;for(let i=0;i<120&&!tgt;i++){await sleep(250);try{tgt=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page')}catch{}}
 const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const wait=new Map();
 ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&wait.has(d.id)){wait.get(d.id)(d);wait.delete(d.id)}};
 const cdp=(method,params={})=>new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
 await cdp('Network.enable');await cdp('Network.setCookie',{name:ck[0],value:ck.slice(1).join('='),url:BASE});
 await cdp('Emulation.setDeviceMetricsOverride',{width:+w,height:+h,deviceScaleFactor:1,mobile:+w<700});
 await cdp('Page.enable');await cdp('Page.navigate',{url:BASE+'/'+hash});await sleep(3500);
 if(js){const r=await cdp('Runtime.evaluate',{expression:js,awaitPromise:true,returnByValue:true});if(r.result?.result?.value!==undefined)console.log('js:',JSON.stringify(r.result.result.value));await sleep(1500)}
 const errs=await cdp('Runtime.evaluate',{expression:'JSON.stringify([...document.querySelectorAll(".toast")].map(t=>t.textContent))',returnByValue:true});console.log('toasts:',errs.result?.result?.value);
 const s=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync(out,Buffer.from(s.result.data,'base64'));console.log('saved',out);ws.close();
}catch(e){
 // one line with the reason (15 Nov 2026: box-check keeps only the first line of this output, which was node's "file:///…/shot.mjs:13"
 // stack header, so two nights of "fast page switching found problems" never said that the sign-in had failed, nor why)
 console.log('shot failed: '+String(e?.message||e).replace(/\s+/g,' ').slice(0,300));process.exitCode=1
}finally{chrome.kill('SIGKILL')}
