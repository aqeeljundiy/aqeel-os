// aqeelOS: use my browser. Keeps one connection to aqeelOS; when you choose "My browser" for a chat, the agent's
// browser actions (open, read, click, type, keys, scroll, back) arrive here and run in the agent's own tab, so
// your own tabs are never touched. It only does those actions: no scripts of the agent's own, no downloads.
// While the agent works, its tab glows and shows what it is doing, with Stop and Take over; the toolbar icon's dot
// says the same (blue working, amber needs you, red failed, grey not connected).
const S={ws:null,alive:null,tab:null,panelWin:null,retry:0,mode:'idle',text:'',agent:'',blockUntil:0,blockWhy:'',idleT:null,inflight:null,newTab:null};
const VERSION=chrome.runtime.getManifest().version;

async function settings(){return chrome.storage.local.get(['base','token'])}
const online=()=>!!S.ws&&S.ws.readyState===1;

// ---- the toolbar icon: the round white mark, with a dot for what the agent is doing ----
const DOT={work:'#2563eb',need:'#d97706',fail:'#dc2626',offline:'#9ca3af'};
function drawIcon(size,dot){const c=new OffscreenCanvas(size,size),g=c.getContext('2d'),k=size/32;g.scale(k,k);
 g.beginPath();g.arc(16,16,15.4,0,7);g.fillStyle='#fff';g.fill();g.lineWidth=1;g.strokeStyle='#d6d9e0';g.stroke();
 g.fillStyle='#111';g.beginPath();g.moveTo(16,5.6);g.lineTo(26.4,16);g.lineTo(16,26.4);g.lineTo(5.6,16);g.closePath();g.moveTo(16,8.4);g.lineTo(8.4,16);g.lineTo(16,23.6);g.lineTo(23.6,16);g.closePath();g.fill('evenodd');
 g.beginPath();g.moveTo(16,12.4);g.lineTo(19.6,16);g.lineTo(16,19.6);g.lineTo(12.4,16);g.closePath();g.fill();
 if(dot){g.beginPath();g.arc(25,25,6.4,0,7);g.fillStyle='#fff';g.fill();g.beginPath();g.arc(25,25,4.8,0,7);g.fillStyle=dot;g.fill()}
 return g.getImageData(0,0,size,size)}
const TITLE={work:'aqeelOS: the agent is working',need:'aqeelOS: the agent needs you',fail:'aqeelOS: a step failed',offline:'aqeelOS: not connected',idle:'aqeelOS: connected'};
function paintIcon(){const st=!online()?'offline':S.mode==='control'?'idle':S.mode;const dot=DOT[st];
 try{chrome.action.setIcon({imageData:{16:drawIcon(16,dot),32:drawIcon(32,dot)}})}catch{}chrome.action.setBadgeText({text:''});chrome.action.setTitle({title:TITLE[st]||TITLE.idle})}

// ---- the layer over the agent's tab ----
async function layer(tabId,state){if(!tabId)return;try{await chrome.scripting.executeScript({target:{tabId},files:['overlay.js']});
 await chrome.scripting.executeScript({target:{tabId},func:s=>window.__aq?.set(s),args:[state]})}catch{}}
const pushLayer=()=>layer(S.tab,{mode:S.mode,text:S.text,agent:S.agent});
function setMode(mode,text){S.mode=mode;S.text=text||'';clearTimeout(S.idleT);paintIcon();const p=pushLayer();chrome.storage.session.set({mode,text:S.text}).catch(()=>{});
 // between steps the agent is thinking; if no step comes for a while it has finished
 if(mode==='work')S.idleT=setTimeout(()=>setMode('idle'),45000);
 if(mode==='idle-soon')S.idleT=setTimeout(()=>setMode('idle'),4000);return p}
const who=()=>S.agent||'The agent';
// the agent's error, said for the person (no refs, no instructions meant for the agent)
const forPerson=e=>String(e||'').replace(/\s*(Take a new snapshot|Pick a text box from the snapshot)\.?/g,'').replace(/element [ef0-9-]+/g,'that part of the page').replace(/\s+/g,' ').trim()||'something went wrong.';

async function connect(){const {base,token,replaced}=await chrome.storage.local.get(['base','token','replaced']);if(!base||!token||replaced){paintIcon();return}
 if(S.ws&&S.ws.readyState<=1)return;
 const ws=new WebSocket(base.replace(/^http/,'ws')+'/ui/local-browser/ws?t='+encodeURIComponent(token));S.ws=ws;
 ws.onopen=()=>{S.retry=0;paintIcon();try{ws.send(JSON.stringify({type:'hello',version:VERSION}))}catch{}clearInterval(S.alive);S.alive=setInterval(()=>{try{ws.send('{"type":"ping"}')}catch{}},20000)};
 ws.onmessage=async e=>{let m;try{m=JSON.parse(e.data)}catch{return}
  if(m.type==='replaced'){await chrome.storage.local.set({replaced:Date.now()});paintIcon();return}
  if(m.type==='unpaired'){await chrome.storage.local.remove('token');paintIcon();return}
  if(m.type==='frame'||m.type==='focus'){let r={};try{r=await (m.type==='frame'?frame():focus())}catch(err){r={error:String(err?.message||err)}}try{ws.send(JSON.stringify({type:'reply',id:m.id,...r}))}catch{}return}
  if(m.type!=='command')return;
  if(m.agent&&m.agent!==S.agent){S.agent=m.agent;renameGroup()}
  const reply=r=>{if(S.inflight?.id===m.id)S.inflight=null;if(r.ignored)return;try{ws.send(JSON.stringify({type:'result',id:m.id,...r}))}catch{}};
  const gate=blocked(m.action);if(gate)return reply({ok:false,error:gate});
  const job={id:m.id,reply};S.inflight=job;if(m.action!=='controller.noop'&&S.mode!=='need')S.mode='work';
  let r;try{r={ok:true,result:await act(m.action,m.arguments||{})}}catch(err){r={ok:false,error:String(err?.message||err)};if(!job.done&&m.action!=='controller.noop')setMode('fail',who()+' couldn’t '+VERB[m.action]+': '+forPerson(r.error))}
  if(job.done)return;job.done=true;
  if(r.ok&&!['need','fail'].includes(S.mode)&&m.action!=='controller.noop')setMode('work',who()+' is thinking…');
  reply(r)};
 ws.onclose=()=>{clearInterval(S.alive);if(S.ws===ws)S.ws=null;paintIcon();
  // back again by itself: soon at first, then less often
  const wait=Math.min(30000,2000*2**S.retry++);setTimeout(connect,wait)};
 ws.onerror=()=>{}}

// Stop, Take over and robot checks: the agent is told plainly, and nothing more runs until the person says so
function blocked(action){
 if(S.mode==='control')return 'The person has taken over the browser. Stop using it now, and wait until they tell you in chat to continue.';
 if(Date.now()<S.blockUntil){S.blockUntil=Date.now()+20000;return S.blockWhy}
 if(S.mode==='need'&&action!=='browser_snapshot')return 'The person is still finishing the step you handed them in their browser. Wait until they tell you in chat that it is done.';
 return null}
function cutInflight(error){const j=S.inflight;if(!j||j.done)return;j.done=true;j.reply({ok:false,error})}
const STOPPED='The person pressed Stop in their browser. Stop this task now: do not use the browser again in this turn. Tell them in one or two lines what you had done.';
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(m&&m.aq){if(sender.tab?.id!==S.tab)return;
  if(m.aq==='stop'){S.blockUntil=Date.now()+20000;S.blockWhy=STOPPED;cutInflight(STOPPED);setMode('idle-soon','Stopped. '+who()+' won’t use the browser until you ask again.')}
  if(m.aq==='takeover'){cutInflight('The person has taken over the browser. Stop using it now, and wait until they tell you in chat to continue.');setMode('control','You’re in control. '+who()+' waits until you hand back.')}
  if(m.aq==='handback'||m.aq==='continue'){S.blockUntil=0;setMode('idle-soon','Handed back. Tell '+who()+' in chat to carry on.')}
  if(m.aq==='dismiss')setMode('idle');
  return}
 if(m==='connect'){chrome.storage.local.remove('replaced').then(()=>{S.ws?.close();S.ws=null;S.retry=0;return connect()}).then(()=>reply(true));return true}
 if(m==='status'){chrome.storage.local.get('replaced').then(v=>reply({connected:online(),replaced:!!v.replaced,mode:S.mode,text:S.text,version:VERSION}));return true}});

// ---- the agent's own window and tab (kept across restarts of this extension) ----
async function agentTab(){if(!S.tab)S.tab=(await chrome.storage.session.get('tab')).tab;
 if(S.tab){try{const t=await chrome.tabs.get(S.tab);
  // an agent tab left alone in a window of its own (older versions opened one): bring it into the window you use
  const win=S.panelWin||(await chrome.windows.getLastFocused({windowTypes:['normal']}).catch(()=>null))?.id;
  if(win&&t.windowId!==win&&(await chrome.tabs.query({windowId:t.windowId})).length===1){await chrome.tabs.move(t.id,{windowId:win,index:-1});await chrome.tabs.update(t.id,{active:true});const n=await chrome.tabs.get(t.id);await group(n);return n}
  return t}catch{}}
 // a new tab in the window you are using (the one with the side chat, if it is open), in a group named after the agent
 let win=S.panelWin;if(!win){try{win=(await chrome.windows.getLastFocused({windowTypes:['normal']})).id}catch{}}
 let tab;if(win){tab=await chrome.tabs.create({windowId:win,url:'about:blank',active:true})}
 else{const w=await chrome.windows.create({url:'about:blank',focused:true,width:1280,height:900});tab=w.tabs[0]}
 await group(tab);await useTab(tab.id);return tab}
async function useTab(id){S.tab=id;await chrome.storage.session.set({tab:id})}
const groupName=()=>'aqeelOS / '+(S.agent||'agent');
async function group(tab){try{let g=tab.groupId;if(!(g>0))g=await chrome.tabs.group({tabIds:[tab.id],createProperties:{windowId:tab.windowId}});await chrome.tabGroups.update(g,{title:groupName(),color:'blue'})}catch{}}
// another agent took over the tab: the group's name follows
async function renameGroup(){const t=await current();if(t)group(t)}
// a link that opens a new tab: the agent follows it there
chrome.tabs.onCreated.addListener(t=>{if(S.tab&&t.openerTabId===S.tab)S.newTab=t.id});
// a new page in the agent's tab: draw the layer again
chrome.tabs.onUpdated.addListener((id,info)=>{if(id===S.tab&&info.status==='complete'&&S.mode!=='idle')pushLayer()});

const loaded=(id,ms=30000)=>new Promise(ok=>{const t=setTimeout(done,ms);function done(){clearTimeout(t);chrome.tabs.onUpdated.removeListener(on);ok()}
 function on(tid,info){if(tid===id&&info.status==='complete')done()}chrome.tabs.onUpdated.addListener(on);chrome.tabs.get(id).then(t=>{if(t.status==='complete'&&ms<30000)done()}).catch(done)});
// after a click or a key: follow a new tab, wait for a page that starts loading, then for the page to settle
async function settle(){await new Promise(z=>setTimeout(z,350));
 if(S.newTab){const id=S.newTab;S.newTab=null;const old=S.tab;await useTab(id);try{const t=await chrome.tabs.get(id);await group(t)}catch{}await loaded(id,15000);layer(old,{mode:'idle'});pushLayer();return {new_tab:true}}
 const t=await chrome.tabs.get(S.tab).catch(()=>null);if(t?.status==='loading')await loaded(S.tab,15000);
 await inPage(quiet).catch(()=>{});return {}}
const inPage=async(func,args=[],frameId=0)=>{const t=await agentTab();const [r]=await chrome.scripting.executeScript({target:{tabId:t.id,frameIds:[frameId]},func,args});return r?.result};
// refs look like e12 (the page) or f5-e12 (a frame inside it)
const parseRef=r=>{const s=String(r||'').replace(/^@/,'').replace(/^ref=/,'').trim();const m=/^f(\d+)-(e\d+)$/.exec(s);return m?{frame:+m[1],ref:m[2]}:{frame:0,ref:s}};
const VERB={browser_navigate:'open the page',browser_snapshot:'read the page',browser_click:'click',browser_type:'type',browser_press:'press the key',browser_scroll:'scroll',browser_back:'go back',['controller.noop']:'connect'};

async function act(action,a){
 if(action==='controller.noop')return {success:true};
 if(action==='browser_navigate'){let url=String(a.url||'');if(!/^[a-z]+:/i.test(url))url='https://'+url;if(!/^https?:/i.test(url))throw new Error('only web addresses (http or https) can be opened.');
  setMode('work',who()+' is opening '+host(url));const t=await agentTab();const w=loaded(t.id);await chrome.tabs.update(t.id,{url});await w;
  const tab=await chrome.tabs.get(t.id);
  try{await inPage(quiet)}catch(err){if(/error page/i.test(String(err?.message)))throw new Error('the page didn’t load ('+host(url)+'). The address may be wrong, the site may be down, or the internet is off.')}pushLayer();const snap=await snapshotAll(false);return {success:true,url:tab.url,title:tab.title,snapshot:snap.text,element_count:snap.count}}
 if(action==='browser_snapshot'){setMode('work',who()+' is reading the page');const snap=await snapshotAll(!!a.full);return {success:true,snapshot:snap.text,element_count:snap.count}}
 if(action==='browser_click'){const {frame,ref}=parseRef(a.ref);await setMode('work',who()+' is clicking');const r=await inPage(clickRef,[ref,state()],frame);if(!r?.ok)throw new Error(r?.error||'the click didn’t happen.');
  const s=await settle();const tab=await chrome.tabs.get(S.tab);return {success:true,clicked:a.ref,...(s.new_tab?{note:'The click opened a new tab; you are in it now.',url:tab.url,title:tab.title}:{})}}
 if(action==='browser_type'){const {frame,ref}=parseRef(a.ref);await setMode('work',who()+' is typing');const r=await inPage(typeRef,[ref,String(a.text??''),state()],frame);if(!r?.ok)throw new Error(r?.error||'typing didn’t work.');return {success:true,typed:r.secret?'(hidden)':String(a.text??''),element:a.ref,...(r.chose?{chose:r.chose}:{})}}
 if(action==='browser_press'){setMode('work',who()+' is pressing '+(a.key||'Enter'));const r=await inPage(pressKey,[String(a.key||'Enter')]);const s=await settle();return {success:true,pressed:a.key,...r,...(s.new_tab?{note:'A new tab opened; you are in it now.'}:{})}}
 if(action==='browser_scroll'){setMode('work',who()+' is scrolling '+(a.direction==='up'?'up':'down'));await inPage(d=>window.scrollBy({top:(d==='up'?-1:1)*innerHeight*.8,behavior:'smooth'}),[a.direction]);await new Promise(z=>setTimeout(z,450));return {success:true,scrolled:a.direction}}
 if(action==='browser_back'){setMode('work',who()+' is going back');const t=await agentTab();const w=loaded(t.id);await chrome.tabs.goBack(t.id).catch(()=>{});await w;const tab=await chrome.tabs.get(t.id);pushLayer();return {success:true,url:tab.url,title:tab.title}}
 throw new Error('this browser can’t do '+action+' yet.')}
const host=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return u}};
const state=()=>({mode:'work',agent:S.agent});

// the page and its frames as one list; a robot check on the page is handed to the person
async function snapshotAll(full){const t=await agentTab();
 const res=await chrome.scripting.executeScript({target:{tabId:t.id,allFrames:true},func:snapshot,args:[full]}).catch(()=>[]);
 const top=res.find(r=>r.frameId===0)?.result||{text:'(This page can’t be read: it may be a browser page or still loading.)',count:0};let text=top.text,count=top.count,captcha=top.captcha;
 for(const r of res){if(r.frameId===0||!r.result?.count||count>=500)continue;captcha||=r.result.captcha;
  text+='\n- frame "'+r.result.title+'"\n'+r.result.text.split('\n').slice(1).map(l=>'  '+l.replace(/\[ref=(e\d+)\]/g,'[ref=f'+r.frameId+'-$1]')).join('\n');count+=r.result.count}
 if(captcha||res.some(r=>r.result?.captchaFrame)){setMode('need',who()+' needs you: solve the “I’m not a robot” check, then press Done');
  text+='\n\nNOTE: This page shows a robot check (CAPTCHA). Do not try to solve it. Tell the person in one line to solve it in their browser and press Done, then end your turn and wait for them.'}
 return {text,count}}

async function current(){if(!S.tab)S.tab=(await chrome.storage.session.get('tab')).tab;if(!S.tab)return null;try{return await chrome.tabs.get(S.tab)}catch{return null}}
async function frame(){const t=await current();if(!t)return {none:true};if(!t.active)return {inactive:true,url:t.url,title:t.title};
 const data=await chrome.tabs.captureVisibleTab(t.windowId,{format:'jpeg',quality:55});return {data,url:t.url,title:t.title}}
async function focus(){const t=await current();if(!t)return {none:true};await chrome.windows.update(t.windowId,{focused:true});await chrome.tabs.update(t.id,{active:true});return {ok:true}}

// ---- functions that run inside the page ----
function quiet(){return new Promise(ok=>{let t=setTimeout(done,350);const end=setTimeout(done,2500);const mo=new MutationObserver(()=>{clearTimeout(t);t=setTimeout(done,350)});
 mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});function done(){mo.disconnect();clearTimeout(t);clearTimeout(end);ok(true)}})}
function snapshot(full){
 document.querySelectorAll('[data-aq-ref]').forEach(e=>e.removeAttribute('data-aq-ref'));
 if(window!==top&&(innerWidth<40||innerHeight<30))return {count:0};
 const captchaFrame=window!==top&&/recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha/i.test(location.href);
 const captcha=!!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],iframe[src*="arkoselabs"],.g-recaptcha,.h-captcha,.cf-turnstile,#challenge-form');
 const vis=e=>{const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'};
 const text=s=>String(s||'').replace(/\s+/g,' ').trim().slice(0,100);
 const roleOf=e=>{const r=e.getAttribute('role');if(r)return r;const t=e.tagName.toLowerCase();if(t==='a')return 'link';if(t==='button')return 'button';if(t==='select')return 'combobox';if(t==='textarea')return 'textbox';
  if(t==='input'){const ty=(e.type||'text').toLowerCase();return {checkbox:'checkbox',radio:'radio',submit:'button',button:'button',reset:'button',search:'searchbox',range:'slider'}[ty]||'textbox'}
  if(e.isContentEditable)return 'textbox';if(/^h[1-6]$/.test(t))return 'heading';return t};
 const nameOf=e=>{const l=e.getAttribute('aria-label');if(l)return text(l);const lb=e.getAttribute('aria-labelledby');if(lb){const n=lb.split(' ').map(id=>document.getElementById(id)?.innerText||'').join(' ');if(n.trim())return text(n)}
  if(e.id){const f=document.querySelector('label[for="'+CSS.escape(e.id)+'"]');if(f)return text(f.innerText)}const pl=e.closest('label');if(pl&&pl!==e)return text(pl.innerText);
  return text(e.innerText||e.value||e.getAttribute('placeholder')||e.getAttribute('title')||e.getAttribute('alt')||'')};
 const SEL='a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=combobox],[role=textbox],[role=switch],[contenteditable=true],[onclick],summary';
 const lines=['Page: '+text(document.title)+' ('+location.href+')'];let n=0;
 const walk=el=>{for(const e of el.children){if(n>=500)return;const tag=e.tagName.toLowerCase();if(['script','style','noscript','svg','template','aqeelos-layer'].includes(tag))continue;
   if(e.matches(SEL)&&vis(e)&&!e.disabled){n++;const ref='e'+n;e.setAttribute('data-aq-ref',ref);const role=roleOf(e);let line='- '+role+' "'+nameOf(e)+'"';
    if(role==='textbox'||role==='searchbox'||role==='combobox'){const v=e.isContentEditable?text(e.innerText):e.tagName==='SELECT'?text(e.selectedOptions[0]?.text):text(e.value);if(v&&e.type!=='password')line+=' value="'+v+'"';if(e.type==='password')line+=' (password)'}
    if(e.tagName==='SELECT')line+=' options: '+[...e.options].slice(0,25).map(o=>'"'+text(o.text)+'"').join(', ')+(e.options.length>25?' …':'');
    if(e.type==='checkbox'||e.type==='radio')line+=e.checked?' (checked)':'';lines.push(line+' [ref='+ref+']');if(role!=='heading')continue}
   else if(/^h[1-6]$/.test(tag)&&vis(e)){lines.push('- heading "'+text(e.innerText)+'"');continue}
   else if(full&&['p','li','td','th','span','div','label','dt','dd','pre','code'].includes(tag)&&!e.children.length&&vis(e)){const t=text(e.innerText);if(t)lines.push('  '+t)}
   walk(e)}};
 walk(document.body||document.documentElement);if(n>=500)lines.push('(more elements below: scroll and take a new snapshot)');
 return {text:lines.join('\n'),count:n,captcha,captchaFrame,title:text(document.title||location.hostname)}}
async function clickRef(ref,st){const e=document.querySelector('[data-aq-ref="'+ref+'"]');if(!e)return {ok:false,error:'element '+ref+' isn’t on the page any more (the page changed). Take a new snapshot.'};
 e.scrollIntoView({block:'center',behavior:'instant'});const name=String(e.getAttribute('aria-label')||e.innerText||e.value||e.title||'').replace(/\s+/g,' ').trim().slice(0,40);
 if(window.__aq){window.__aq.set({...st,text:(st.agent||'The agent')+' is clicking '+(name?'“'+name+'”':'a button')});await window.__aq.move(e.getBoundingClientRect(),true)}
 if(!e.isConnected)return {ok:false,error:'element '+ref+' disappeared just before the click. Take a new snapshot.'};
 const r=e.getBoundingClientRect(),o={bubbles:true,cancelable:true,composed:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0,view:window};
 e.dispatchEvent(new PointerEvent('pointerdown',{...o,pointerType:'mouse'}));e.dispatchEvent(new MouseEvent('mousedown',o));e.focus?.({preventScroll:true});
 e.dispatchEvent(new PointerEvent('pointerup',{...o,pointerType:'mouse'}));e.dispatchEvent(new MouseEvent('mouseup',o));e.click();return {ok:true}}
async function typeRef(ref,value,st){const e=document.querySelector('[data-aq-ref="'+ref+'"]');if(!e)return {ok:false,error:'element '+ref+' isn’t on the page any more (the page changed). Take a new snapshot.'};
 e.scrollIntoView({block:'center',behavior:'instant'});const secret=e.type==='password';
 if(window.__aq){const label=String(e.getAttribute('aria-label')||e.getAttribute('placeholder')||e.name||'').trim().slice(0,30);
  window.__aq.set({...st,text:(st.agent||'The agent')+(e.tagName==='SELECT'?' is choosing “'+value.slice(0,30)+'”':secret?' is typing a password':' is typing'+(label?' in “'+label+'”':''))});await window.__aq.move(e.getBoundingClientRect(),false)}
 e.focus();
 if(e.tagName==='SELECT'){const want=value.trim().toLowerCase();const opts=[...e.options];const o=opts.find(x=>x.value.toLowerCase()===want||x.text.trim().toLowerCase()===want)||opts.find(x=>x.text.toLowerCase().includes(want));
  if(!o)return {ok:false,error:'no choice “'+value+'” in that list. The choices are: '+opts.slice(0,30).map(x=>'“'+x.text.trim()+'”').join(', ')};
  e.value=o.value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,chose:o.text.trim()}}
 if(e.isContentEditable){document.execCommand('selectAll');document.execCommand('insertText',false,value);return {ok:true}}
 if(!('value' in e))return {ok:false,error:'element '+ref+' isn’t something you can type in. Pick a text box from the snapshot.'};
 const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
 Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,secret}}
function pressKey(key){const e=document.activeElement||document.body;const o={key,code:key.length===1?'Key'+key.toUpperCase():key,bubbles:true,cancelable:true};
 const go=e.dispatchEvent(new KeyboardEvent('keydown',o));e.dispatchEvent(new KeyboardEvent('keyup',o));
 if(go&&key==='Enter'){const f=e.form||e.closest?.('form');if(f){f.requestSubmit?f.requestSubmit():f.submit();return {submitted:true}}if(e.tagName==='BUTTON'||e.getAttribute?.('role')==='button')e.click()}
 if(go&&key==='Tab'){const all=[...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled);const i=all.indexOf(e);all[i+1]?.focus()}
 if(go&&key==='Escape')e.blur?.();
 return {}}

// the side panel says which window it is in while it is open
chrome.runtime.onConnect.addListener(p=>{const m=/^panel:(\d+)$/.exec(p.name);if(!m)return;S.panelWin=+m[1];p.onDisconnect.addListener(()=>{if(S.panelWin===+m[1])S.panelWin=null})});
chrome.runtime.onStartup.addListener(connect);chrome.runtime.onInstalled.addListener(connect);
chrome.alarms.create('keep',{periodInMinutes:1});chrome.alarms.onAlarm.addListener(connect);
// Alt+A opens the side chat
chrome.commands?.onCommand.addListener(async c=>{if(c==='open-chat'){const w=await chrome.windows.getCurrent();chrome.sidePanel.open({windowId:w.id}).catch(()=>{})}});
chrome.storage.session.get(['mode','text']).then(v=>{if(v.mode&&v.mode!=='work'){S.mode=v.mode;S.text=v.text||''}paintIcon()}).catch(()=>{});
connect();
