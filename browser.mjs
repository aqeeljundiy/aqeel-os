// Side browser: a headless Chromium driven over the DevTools protocol. The UI shows a live screencast
// and forwards mouse/keyboard; the AI uses the same page through browser-mcp.mjs (navigate, snapshot, click…).
// Guarded for the AI: it may only open this computer's own pages (previews, dev servers) and the sites the person
// allowed; it works in one view (links that open a new tab or window open here, it can't make or switch tabs); no
// downloads; while it works the page shows a frame, a status line and a cursor that moves to what it clicks; and the
// person can take over at any time (the AI is told to wait) and hand back.
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {findBrowser,killTree} from './platform.mjs';
import {freePort} from './devservers.mjs';

// Viewport presets; "mobile" also turns on touch and a phone user agent so sites serve their mobile layout.
export const PRESETS={desktop:{width:1280,height:800,mobile:false},laptop:{width:1440,height:900,mobile:false},tablet:{width:820,height:1180,mobile:true},mobile:{width:390,height:844,mobile:true}};
const MOBILE_UA='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const SCHEMES=new Set(['light','dark','system']);

// What the address bar accepts: full http(s) URLs, local addresses, bare domains, otherwise a web search.
export function normalizeUrl(input){const s=String(input||'').trim();if(!s)throw Error('Enter an address.');
 if(/^https?:\/\//i.test(s)||s==='about:blank')return s;
 if(/^[a-z][a-z0-9+.-]*:/i.test(s)&&!/^(localhost|127\.0\.0\.1)(:\d+)/i.test(s))throw Error('Only http and https pages can be opened.');
 if(/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(s))return 'http://'+s;
 if(/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s))return 'https://'+s;
 return 'https://www.google.com/search?q='+encodeURIComponent(s)}

const LOCAL=/^(localhost|127\.0\.0\.1|\[::1\])$/i;
// the layer drawn over the page while the AI works (frame, status line, cursor), and moving its cursor
const OVERLAY=`(()=>{if(window.__cbaOv)return;const h=document.createElement('cba-ai-layer');h.style.cssText='all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';const r=h.attachShadow({mode:'closed'});
r.innerHTML='<style>*{box-sizing:border-box;font-family:"Plus Jakarta Sans",system-ui,sans-serif}.g{position:fixed;inset:0;box-shadow:inset 0 0 0 3px rgba(37,99,235,.55),inset 0 0 40px rgba(37,99,235,.16);opacity:0;transition:opacity .3s}.on .g{opacity:1}.p{position:fixed;left:50%;bottom:18px;transform:translate(-50%,12px);opacity:0;background:#111;color:#fff;border-radius:999px;padding:7px 14px;font-size:13px;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis;transition:opacity .3s,transform .3s;box-shadow:0 10px 30px -10px rgba(0,0,0,.5)}.on .p{opacity:1;transform:translate(-50%,0)}.c{position:fixed;left:0;top:0;width:22px;height:22px;opacity:0;transition:transform .45s cubic-bezier(.4,0,.2,1),opacity .3s;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}.on .c.s{opacity:1}.c span{position:absolute;left:17px;top:18px;background:#2563eb;color:#fff;font-size:11px;font-weight:600;border-radius:999px;padding:2px 8px}.rp{position:fixed;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;border:2px solid #2563eb;animation:k .6s ease-out forwards}@keyframes k{to{transform:scale(4.6);opacity:0}}</style><div class=w><div class=g></div><div class=c><svg viewBox="0 0 24 24" width=22 height=22><path d="M4 2l16 9.5-7 1.6-3.6 6.6z" fill="#2563eb" stroke="#fff" stroke-width=1.6 stroke-linejoin=round /></svg><span>AI</span></div><div class=p></div></div>';
const w=r.querySelector('.w'),p=r.querySelector('.p'),c=r.querySelector('.c');(document.body||document.documentElement).appendChild(h);let t=0;
window.__cbaOv={say(x){if(!h.isConnected)(document.body||document.documentElement).appendChild(h);w.className='w on';p.textContent=x;clearTimeout(t);t=setTimeout(()=>w.className='w',9000)},move(x,y,click){c.classList.add('s');c.style.transform='translate('+x+'px,'+y+'px)';if(click)setTimeout(()=>{const d=document.createElement('div');d.className='rp';d.style.left=x+'px';d.style.top=y+'px';w.appendChild(d);setTimeout(()=>d.remove(),700)},450)},off(){w.className='w'}}})()`;
// links that would open a new tab or window open in this one
const ONE_VIEW=`window.open=function(u){if(u)location.href=new URL(u,location.href).href;return window};document.addEventListener('click',e=>{const a=e.target&&e.target.closest&&e.target.closest('a[target]');if(a&&a.target!=='_self'&&a.target!=='_top')a.target='_self'},true);`;
const ROBOT_JS=`(()=>{const t=(document.title+' '+(document.body?document.body.innerText.slice(0,3000):'')).toLowerCase();
 if([...document.querySelectorAll('iframe')].some(f=>/recaptcha|hcaptcha|challenges\\.cloudflare|turnstile|arkoselabs|funcaptcha/.test(f.src||'')))return 'captcha';
 if(/just a moment|verify you are human|are you a robot|i'm not a robot|unusual traffic|press and hold|security check/.test(t))return 'check';return ''})()`;
export class SideBrowser{
 constructor(dataDir){this.guardFile=path.join(dataDir,'browser-guard.json');this.guard={sites:[],paused:false};readFile(this.guardFile,'utf8').then(t=>{const g=JSON.parse(t);this.guard.sites=Array.isArray(g.sites)?g.sites:[]}).catch(()=>{});this.profile=path.join(dataDir,'browser-profile');this.pidFile=path.join(dataDir,'browser.pid');process.on('exit',()=>killTree(this.child));this.frame=null;this.frameSeq=0;this.waiters=[];this.log=[];this.state='stopped';this.preset='desktop';this.view={...PRESETS.desktop};this.scheme='light';this.tabs=[]}
 status(){return {guard:{sites:this.guard.sites,paused:this.guard.paused,reason:this.guard.reason||'',ask:this.guard.ask?{host:this.guard.ask.host}:null},state:this.state,url:this.url||'',title:this.title||'',width:this.view.width,height:this.view.height,preset:this.preset,scheme:this.scheme,tabs:this.tabs,tab:this.target||null,error:this.error||null,log:this.log.slice(-40)}}
 // may the AI open this address? This computer's own pages and the sites the person allowed
 allowed(u){try{const x=new URL(u);if(x.protocol==='about:')return true;const h=x.hostname.toLowerCase();return LOCAL.test(h)||this.guard.sites.some(s=>h===s||h.endsWith('.'+s))}catch{return false}}
 // a site the AI may not open yet: the browser asks the person (Allow this site / Not now) and the AI waits for the answer
 async permit(u){if(this.allowed(u))return true;let h='';try{const x=new URL(u);if(!/^https?:$/.test(x.protocol))return false;h=x.hostname.toLowerCase().replace(/^www\./,'')}catch{return false}
  if(this.guard.ask?.host===h)return this.guard.ask.wait;this.guard.ask?.done(false);
  const ask={host:h};ask.wait=new Promise(r=>{ask.done=v=>{clearTimeout(ask.timer);r(v)};ask.timer=setTimeout(()=>r(false),180000)});this.guard.ask=ask;
  this.note({by:'ai',action:'asks to open',detail:h});await this.say('The AI asks to open '+h+': allow it below the address bar').catch(()=>{});
  const ok=await ask.wait;if(this.guard.ask===ask)this.guard.ask=null;return ok}
 async answer(yes){const a=this.guard.ask;if(!a)return this.status();this.guard.ask=null;if(yes){this.guard.sites=[...new Set([...this.guard.sites,a.host])];await writeFile(this.guardFile,JSON.stringify({sites:this.guard.sites},null,1)).catch(()=>{});this.note({by:'user',action:'allowed',detail:a.host})}a.done(Boolean(yes));return this.status()}
 refuse(u,asked){let h=u;try{h=new URL(u).hostname}catch{}if(asked)return Error('The person did not allow '+h+' (or did not answer). Do it another way, or tell them what you need it for.');return Error(h+' is not on the allowed sites for this browser. Ask the person to allow it (Browser › Allowed sites), or use what is allowed: this computer\'s previews and '+(this.guard.sites.join(', ')||'no other sites')+'.')}
 async aiGate(){for(let i=0;i<60&&this.guard.paused;i++){
   if(this.guard.reason==='robot'){if(!(await this.robotOnPage())){this.resume('The robot check is done, so the AI carries on');break}}
   else if(Date.now()-this.lastPerson()>30000){this.resume('You left the browser for 30 seconds, so the AI carries on');break}
   await new Promise(r=>setTimeout(r,1000))}
  if(this.guard.paused)throw Error(this.guard.reason==='robot'?'A robot check is still on the page. The person solves those; wait, then try again.':'The person is still using the browser. Wait a little, then try again.')}
 lastPerson(){const l=this.log.filter(x=>x.by==='user');return Math.max(this.pausedAt||0,...l.map(x=>x.time))}
 resume(why){this.guard.paused=false;this.guard.reason='';this.note({by:'page',action:'handed back',detail:why});this.off().catch(()=>{})}
 async robotOnPage(){return await this.eval(ROBOT_JS).catch(()=>'')}
 async setGuard({sites,paused,answer}={}){if(answer!==undefined)return this.answer(answer);if(Array.isArray(sites))this.guard.sites=[...new Set(sites.map(s=>String(s).trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^www\./,'')).filter(s=>/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)))].slice(0,40);
  if(paused!==undefined){this.guard.paused=!!paused;this.guard.reason='';if(this.guard.paused){this.pausedAt=Date.now();this.say('You have control. The AI carries on after 30 seconds without your clicks, or when you hand back.').catch(()=>{})}else this.off().catch(()=>{})}
  await writeFile(this.guardFile,JSON.stringify({sites:this.guard.sites},null,1)).catch(()=>{});return this.status()}
 async layer(){try{await this.send('Runtime.evaluate',{expression:OVERLAY})}catch{}}
 async say(text){await this.layer();await this.send('Runtime.evaluate',{expression:'window.__cbaOv&&window.__cbaOv.say('+JSON.stringify(String(text).slice(0,120))+')'}).catch(()=>{})}
 async off(){await this.send('Runtime.evaluate',{expression:'window.__cbaOv&&window.__cbaOv.off()'}).catch(()=>{})}
 async point(x,y,click){await this.send('Runtime.evaluate',{expression:'window.__cbaOv&&window.__cbaOv.move('+Number(x)+','+Number(y)+','+(click?'true':'false')+')'}).catch(()=>{});await new Promise(r=>setTimeout(r,520))}
 // a robot check on the page: the AI stops and the person is asked to solve it, then hand back
 async robotCheck(){const found=await this.robotOnPage();
  if(!found)return;this.guard.paused=true;this.guard.reason='robot';this.note({by:'page',action:'robot check',detail:'Handed to you: solve it. The AI carries on by itself once it is gone.'});await this.say('Robot check: please solve it. The AI carries on once it is gone').catch(()=>{});
  throw Error('A robot check (CAPTCHA) appeared. The person has been asked to solve it. Stop using the browser and wait; try again after they hand it back.')}
 // after an AI click or key: if it led off the allowed sites, go back and say so
 async stayInside(){await this.robotCheck();const u=await this.eval('location.href').catch(()=>this.url);if(this.allowed(u))return;await this.send('Page.navigateToHistoryEntry',{entryId:(await this.send('Page.getNavigationHistory')).entries.slice(-2)[0].id}).catch(()=>{});await this.waitLoad(4000);if(await this.permit(u)){await this.send('Page.navigate',{url:u});await this.waitLoad();return}throw this.refuse(u,true)}
 note(entry){this.log.push({time:Date.now(),...entry});if(this.log.length>200)this.log.shift()}

 async start(){if(this.state==='running')return this.status();if(this.starting)return this.starting;
  this.starting=(async()=>{try{this.state='starting';this.error=null;const exe=await findBrowser();if(!exe)throw Error('No Chrome or Edge found on this computer.');
   await mkdir(this.profile,{recursive:true});const port=await freePort(9300);this.port=port;
   // a browser left over from a previous run would keep the profile locked
   try{const old=Number(await readFile(this.pidFile,'utf8'));if(old){try{process.kill(old,0);killTree({pid:old});await new Promise(r=>setTimeout(r,800))}catch{}}}catch{}
   this.child=spawn(exe,['--headless=new','--remote-debugging-port='+port,'--remote-allow-origins=*','--user-data-dir='+this.profile,'--window-size=1280,800','--no-first-run','--no-default-browser-check','--disable-features=Translate',...(process.platform==='linux'?['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']:[]),'about:blank'],{stdio:'ignore',windowsHide:true});
   this.child.on('exit',()=>{this.state='stopped';this.ws=null});writeFile(this.pidFile,String(this.child.pid)).catch(()=>{});
   let targets=[];for(let i=0;i<50;i++){try{targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(targets.some(t=>t.type==='page'))break}catch{}await new Promise(r=>setTimeout(r,200))}
   const page=targets.find(t=>t.type==='page');if(!page)throw Error('The browser did not start.');
   await this.connect(page);this.state='running';await this.refreshTabs();return this.status()}
  catch(e){this.state='failed';this.error=e.message;killTree(this.child);throw e}finally{this.starting=null}})();return this.starting}

 // Attach to one tab (a DevTools page target). Switching tabs swaps the connection; the old one is ignored.
 connect(page){return new Promise((resolve,reject)=>{
  const old=this.ws;const ws=new WebSocket(page.webSocketDebuggerUrl);this.ws=ws;this.target=page.id;this.url=page.url;this.title=page.title;this.id=0;this.pending=new Map();try{old?.close()}catch{}
  ws.onopen=async()=>{try{await this.send('Page.enable');await this.send('Runtime.enable');await this.send('Page.addScriptToEvaluateOnNewDocument',{source:ONE_VIEW}).catch(()=>{});await this.send('Page.setDownloadBehavior',{behavior:'deny'}).catch(()=>{});await this.send('Page.setInterceptFileChooserDialog',{enabled:true}).catch(()=>{});await this.applyView();resolve()}catch(e){reject(e)}};
  ws.onerror=()=>reject(Error('Could not connect to the browser.'));ws.onclose=()=>{if(this.ws===ws)this.state='stopped'};
  ws.onmessage=ev=>{if(this.ws!==ws)return;const m=JSON.parse(ev.data);if(m.id&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);return}
   if(m.method==='Page.screencastFrame'){this.frame=Buffer.from(m.params.data,'base64');this.frameSeq++;this.send('Page.screencastFrameAck',{sessionId:m.params.sessionId}).catch(()=>{});for(const w of this.waiters.splice(0))w()}
   if(m.method==='Page.frameNavigated'&&!m.params.frame.parentId){this.url=m.params.frame.url}
   if(m.method==='Page.loadEventFired')this.refreshTitle()
   // a page asking for a file from this computer gets none; downloads are refused too (set below)
   if(m.method==='Page.fileChooserOpened'){this.note({by:'page',action:'file picker blocked',detail:'This browser never hands files from this computer to a page.'});this.say('A file picker was blocked').catch(()=>{})}}
 })}
 send(method,params={}){if(!this.ws||this.ws.readyState!==1)return Promise.reject(Error('The side browser is not running.'));const id=++this.id;this.ws.send(JSON.stringify({id,method,params}));
  return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});setTimeout(()=>{if(this.pending.delete(id))reject(Error(method+' timed out.'))},30000)})}
 async eval(expression){const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||'Script error');return r.result.value}
 async refreshTitle(){try{this.title=await this.eval('document.title')}catch{}}
 async ensure(){if(this.state!=='running')await this.start()}

 // Apply the viewport preset and colour scheme to the current tab, then restart the screencast at that size.
 async applyView(){const {width,height,mobile}=this.view;
  await this.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
  await this.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:mobile?5:1});
  await this.send('Emulation.setUserAgentOverride',{userAgent:mobile?MOBILE_UA:''});
  await this.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:this.scheme==='system'?'':this.scheme}]});
  await this.send('Page.stopScreencast').catch(()=>{});
  await this.send('Page.startScreencast',{format:'jpeg',quality:70,maxWidth:width,maxHeight:height,everyNthFrame:1})}
 async setView({preset,rotate,scheme}={}){await this.ensure();
  if(preset){if(!PRESETS[preset])throw Error('Unknown screen size.');this.preset=preset;this.view={...PRESETS[preset]}}
  if(rotate)this.view={...this.view,width:this.view.height,height:this.view.width};
  if(scheme){if(!SCHEMES.has(scheme))throw Error('Unknown colour scheme.');this.scheme=scheme}
  await this.applyView();if(preset)await this.send('Page.reload').then(()=>this.waitLoad()).catch(()=>{});return this.status()}

 // Tabs: every page target of the one headless browser.
 async devtools(route,method='GET'){const r=await fetch('http://127.0.0.1:'+this.port+'/json/'+route,{method});if(!r.ok)throw Error('The browser refused: '+(await r.text()).slice(0,120));return r.headers.get('content-type')?.includes('json')?r.json():r.text()}
 async refreshTabs(){try{const list=await this.devtools('list');this.tabs=list.filter(t=>t.type==='page').reverse().map(t=>({id:t.id,title:t.id===this.target?this.title||t.title:t.title,url:t.id===this.target?this.url||t.url:t.url}));
  if(this.target&&!this.tabs.some(t=>t.id===this.target)&&this.tabs[0])await this.switchTab(this.tabs[0].id)}catch{}return this.tabs}
 async newTab(url='about:blank',by='user'){if(by==='ai')return this.navigate(url,'ai');await this.ensure();const u=normalizeUrl(url);
  const t=await this.devtools('new?'+encodeURI(u),'PUT');this.note({by,action:'new tab',detail:u});await this.switchTab(t.id,by,true);if(u!=='about:blank')await this.waitLoad();return this.status()}
 async switchTab(id,by='user',quiet=false){if(by==='ai')throw Error('This browser keeps you in one view: open the address you need instead of switching tabs.');await this.ensure();const list=await this.devtools('list');const page=list.find(t=>t.id===id&&t.type==='page');if(!page)throw Error('That tab is closed.');
  if(!quiet)this.note({by,action:'switch tab',detail:page.title||page.url});await this.devtools('activate/'+id).catch(()=>{});await this.connect(page);this.state='running';await this.refreshTitle();await this.refreshTabs();return this.status()}
 async closeTab(id,by='user'){if(by==='ai')throw Error('This browser keeps you in one view; there are no tabs to close.');await this.ensure();await this.refreshTabs();if(this.tabs.length<=1)return this.newTab('about:blank',by).then(()=>this.closeTab(id,by));
  const was=this.tabs.find(t=>t.id===id);if(!was)return this.status();this.note({by,action:'close tab',detail:was.title||was.url});
  if(id===this.target){const next=this.tabs.find(t=>t.id!==id);await this.switchTab(next.id,by,true)}await this.devtools('close/'+id).catch(()=>{});await this.refreshTabs();return this.status()}

 // Wait for the next screencast frame newer than `after` (long-poll for the UI).
 nextFrame(after,timeout=1500){if(this.frameSeq>after&&this.frame)return Promise.resolve();return new Promise(r=>{this.waiters.push(r);setTimeout(r,timeout)})}

 async navigate(url,by='user'){await this.ensure();const u=normalizeUrl(url);
  if(by==='ai'){await this.aiGate();if(!(await this.permit(u)))throw this.refuse(u,true);await this.say('AI is opening '+(()=>{try{return new URL(u).hostname}catch{return u}})())}
  this.note({by,action:'open',detail:u});await this.send('Page.navigate',{url:u});await this.waitLoad();if(by==='ai'){await this.robotCheck();await this.say('AI is reading '+(this.title||this.url))}return this.status()}
 async waitLoad(ms=8000){const start=Date.now();while(Date.now()-start<ms){try{if(await this.eval('document.readyState')==='complete')break}catch{}await new Promise(r=>setTimeout(r,150))}await this.refreshTitle();this.url=await this.eval('location.href').catch(()=>this.url);await this.refreshTabs()}
 async history(delta,by='user'){if(by==='ai')await this.aiGate();await this.ensure();const h=await this.send('Page.getNavigationHistory');const e=h.entries[h.currentIndex+delta];if(!e)return this.status();this.note({by,action:delta<0?'back':'forward',detail:e.url});await this.send('Page.navigateToHistoryEntry',{entryId:e.id});await this.waitLoad();return this.status()}
 async reload(by='user'){await this.ensure();this.note({by,action:'reload',detail:this.url});await this.send('Page.reload');await this.waitLoad();return this.status()}

 async mouse(x,y,{button='left',clickCount=1}={}){for(const type of ['mouseMoved','mousePressed','mouseReleased'])await this.send('Input.dispatchMouseEvent',{type,x,y,button,clickCount:type==='mouseMoved'?0:clickCount})}
 async clickAt(x,y,by='user'){await this.ensure();if(by==='ai'){await this.aiGate();await this.say('AI is clicking');await this.point(x,y,true)}this.note({by,action:'click',detail:Math.round(x)+','+Math.round(y)});await this.mouse(x,y);await new Promise(r=>setTimeout(r,250));await this.waitLoad(3000);if(by==='ai')await this.stayInside();return this.status()}
 async scroll(dx,dy,x=this.view.width/2,y=this.view.height/2){await this.ensure();await this.send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:dx,deltaY:dy});return this.status()}
 async type(text,by='user'){await this.ensure();if(by==='ai'){await this.aiGate();await this.say('AI is typing')}this.note({by,action:'type',detail:by==='ai'?String(text).slice(0,80):'(typed text)'});await this.send('Input.insertText',{text:String(text)});return this.status()}
 async key(key,by='user'){await this.ensure();if(by==='ai')await this.aiGate();const map={Enter:13,Tab:9,Backspace:8,Escape:27,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Delete:46,Home:36,End:35,PageUp:33,PageDown:34};const code=map[key];
  if(!code)throw Error('Unsupported key: '+key);this.note({by,action:'key',detail:key});
  for(const type of ['rawKeyDown','keyUp'])await this.send('Input.dispatchKeyEvent',{type,key,windowsVirtualKeyCode:code,code:key,...(key==='Enter'&&type==='rawKeyDown'?{text:'\r'}:{})});if(key==='Enter')await this.waitLoad(4000);if(by==='ai')await this.stayInside();return this.status()}

 // Numbered list of visible interactive elements for the AI (refs are stamped onto the page).
 async snapshot(){await this.ensure();return this.eval(`(()=>{const out=[];let n=0;const seen=new Set();
  const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>2&&r.height>2&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'};
  for(const e of document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[contenteditable=true],summary,label[for]')){if(seen.has(e)||!visible(e))continue;seen.add(e);
   const ref=++n;e.setAttribute('data-cba-ref',ref);const role=e.getAttribute('role')||e.tagName.toLowerCase()+(e.type?'['+e.type+']':'');
   const name=(e.getAttribute('aria-label')||e.innerText||e.value||e.placeholder||e.title||e.alt||'').trim().replace(/\\s+/g,' ').slice(0,80);out.push(ref+' | '+role+' | '+name+(e.href?' → '+e.href.slice(0,100):''));if(n>=150)break}
  return {url:location.href,title:document.title,elements:out}})()`)}
 async clickRef(ref,by='ai'){await this.ensure();const box=await this.eval(`(()=>{const e=document.querySelector('[data-cba-ref="${Number(ref)}"]');if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,name:(e.innerText||e.getAttribute('aria-label')||e.value||'').trim().slice(0,60)}})()`);
  if(!box)throw Error('Element '+ref+' is not on the page any more. Take a new snapshot.');if(by==='ai'){await this.aiGate();await this.say('AI is clicking '+(box.name?'“'+box.name+'”':''));await this.point(box.x,box.y,true)}this.note({by,action:'click',detail:'#'+ref+' '+box.name});await this.mouse(box.x,box.y);await new Promise(r=>setTimeout(r,300));await this.waitLoad(4000);if(by==='ai')await this.stayInside();return this.status()}
 async focusRef(ref){const ok=await this.eval(`(()=>{const e=document.querySelector('[data-cba-ref="${Number(ref)}"]');if(!e)return false;e.scrollIntoView({block:'center'});e.focus();if('value' in e&&e.select)e.select();return true})()`);if(!ok)throw Error('Element '+ref+' is not on the page any more. Take a new snapshot.')}
 // the element under a point: a short CSS selector, its text and a trimmed outerHTML
 async inspect(x,y){await this.ensure();return this.eval(`(()=>{const e=document.elementFromPoint(${Number(x)},${Number(y)});if(!e)return null;const sel=n=>{const parts=[];while(n&&n.nodeType===1&&parts.length<5){let s=n.tagName.toLowerCase();if(n.id){parts.unshift(s+'#'+CSS.escape(n.id));break}const cls=[...n.classList].slice(0,2).map(c=>'.'+CSS.escape(c)).join('');s+=cls;const sib=n.parentElement?[...n.parentElement.children].filter(c=>c.tagName===n.tagName):[];if(sib.length>1)s+=':nth-of-type('+(sib.indexOf(n)+1)+')';parts.unshift(s);n=n.parentElement}return parts.join(' > ')};
  const box=e.getBoundingClientRect();return {url:location.href,tag:e.tagName.toLowerCase(),rect:{x:box.left,y:box.top,w:box.width,h:box.height},selector:sel(e),text:(e.innerText||e.value||'').trim().replace(/\\s+/g,' ').slice(0,120),html:e.outerHTML.slice(0,600)}})()`)}
 async text(max=20000){await this.ensure();const t=await this.eval('document.body?document.body.innerText:""');return {url:this.url,title:this.title,text:String(t).replace(/\n{3,}/g,'\n\n').slice(0,max)}}
 async screenshot(){await this.ensure();const r=await this.send('Page.captureScreenshot',{format:'jpeg',quality:60});return r.data}
 stop(){try{this.ws?.close()}catch{}killTree(this.child);this.state='stopped'}
}
