// The flicker check without a box: GitHub Actions (tests.yml) and any machine with Chrome.
//   node scripts/flicker-ci.mjs            exit 0 = passed, 1 = flicker found, 0 with "skipped" when there is no Chrome
// Starts this copy of the app on an empty data folder and its own port (no engine, no schedules, nothing sent), signs in
// as the owner with a password made here, and runs scripts/sweep.js in headless Chrome on the pages that draw without
// an engine. It checks what the nightly run on the box checks (box-check.sh, every page, real data): the shell is never
// drawn again while pages change, no page moves while it loads (layout shift), no replayed fades, pop-ups fade in.
// Pages that need the engine only show their "could not load" box here, so that text is not counted (SWEEP_LOOSE).
// CHROME=<path> picks the browser; FLICKER_PAGES="#/system/settings #/system/health" picks the pages.
import {spawn,spawnSync} from 'node:child_process';import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomBytes} from 'node:crypto';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chromeBin=()=>{if(process.env.CHROME)return process.env.CHROME;
 for(const c of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){const r=spawnSync('which',[c],{encoding:'utf8'});if(r.status===0&&r.stdout.trim())return r.stdout.trim()}
 for(const c of ['/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','C:/Program Files/Google/Chrome/Application/chrome.exe'])if(existsSync(c))return c;return null};
const bin=chromeBin();if(!bin){console.log('flicker check: skipped (no Chrome on this machine; set CHROME=<path>)');process.exit(process.env.CI?1:0)}
const PAGES=(process.env.FLICKER_PAGES||'#/chat #/system/settings #/system/health #/models/models #/system/keys #/system/people #/system/activity #/help').split(/\s+/).filter(Boolean);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// one run: its own data folder, ports and browser profile
async function attempt(){
const tmp=mkdtempSync(path.join(process.env.TMPDIR||tmpdir(),'aq-flicker-')),home=path.join(tmp,'home'),data=path.join(tmp,'data');
const port=4500+Math.floor(Math.random()*300),cport=9500+Math.floor(Math.random()*300),BASE='http://127.0.0.1:'+port,pw=randomBytes(9).toString('base64url');
const env={...process.env,HOME:home,USERPROFILE:home,UI_DATA_DIR:data,UI_PORT:String(port),UI_INSECURE_COOKIE:'1',AQEELOS_LIVE:'0'};
spawnSync('mkdir',['-p',home,data]);
const hash=spawnSync(process.execPath,[path.join(ROOT,'app','server.mjs'),'hash',pw],{encoding:'utf8',env}).stdout.trim();
let log='';const server=spawn(process.execPath,[path.join(ROOT,'app','server.mjs')],{env:{...env,UI_PASSWORD_HASH:hash},cwd:home,stdio:['ignore','pipe','pipe']});server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
const chrome=spawn(bin,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port='+cport,'--user-data-dir='+path.join(tmp,'chrome'),'--window-size=1280,900','about:blank'],{stdio:'ignore'});
let code=1;
try{
 let up=false;for(let i=0;i<60&&!up;i++){await sleep(500);up=await fetch(BASE+'/healthz').then(r=>r.ok,()=>false)}
 if(!up)throw new Error('the app did not start:\n'+log.slice(-800));
 const login=await fetch(BASE+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'',password:pw})});if(!login.ok)throw new Error('sign-in answered '+login.status);
 const ck=(login.headers.get('set-cookie')||'').split(';')[0].split('=');
 let tgt;for(let i=0;i<120&&!tgt;i++){await sleep(250);try{tgt=(await (await fetch(`http://127.0.0.1:${cport}/json`)).json()).find(t=>t.type==='page')}catch{}}
 if(!tgt)throw new Error('Chrome did not start');
 const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let id=0;const wait=new Map();
 ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&wait.has(d.id)){wait.get(d.id)(d);wait.delete(d.id)}};
 const cdp=(method,params={})=>new Promise(r=>{const i=++id;wait.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
 await cdp('Network.enable');await cdp('Network.setCookie',{name:ck[0],value:ck.slice(1).join('='),url:BASE});
 await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await cdp('Page.enable');await cdp('Page.navigate',{url:BASE+'/#/chat'});await sleep(4000);
 const js=`window.SWEEP_ONLY=${JSON.stringify(PAGES)};window.SWEEP_LOOSE=1;window.SWEEP_DWELL=[1500,2500];`+readFileSync(path.join(ROOT,'scripts','sweep.js'),'utf8');
 const r=await cdp('Runtime.evaluate',{expression:js,awaitPromise:true,returnByValue:true});ws.close();
 const v=r.result?.result?.value;if(typeof v!=='string')throw new Error('the check did not run: '+JSON.stringify(r.result?.exceptionDetails?.exception?.description||r).slice(0,600));
 const res=JSON.parse(v);
 if(res.bad){console.log('✗ flicker check: '+res.bad+' problem'+(res.bad>1?'s':'')+' on '+res.pages+' pages');for(const l of res.out)console.log('  '+l)}
 else{console.log(`✓ flicker check: ${res.pages} pages, the shell stayed as it was, most a page moved: ${res.worstShift} (limit 0.05)`);code=0}
}catch(e){console.log('✗ flicker check could not run: '+(e?.message||e))}
finally{chrome.kill('SIGKILL');server.kill('SIGKILL');await sleep(300);try{rmSync(tmp,{recursive:true,force:true})}catch{}}
return code}
// like the box's checks: a miss gets one more try before it counts (a slow runner, a browser that did not start)
let code=await attempt();if(code){console.log('· trying once more');code=await attempt()}
process.exit(code);
