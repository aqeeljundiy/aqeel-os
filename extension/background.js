// aqeelOS: use my browser. Keeps one connection to aqeelOS; when you choose "My browser" for a chat, the agent's
// browser actions (open, read, click, type, keys, scroll, back) arrive here and run in a separate window, so
// your own tabs are never touched. It only does those actions: no scripts of the agent's own, no downloads.
const S={ws:null,alive:null,tab:null};

async function settings(){return chrome.storage.local.get(['base','token'])}
const badge=on=>{chrome.action.setBadgeText({text:on?'on':''});chrome.action.setBadgeBackgroundColor({color:on?'#2f7d32':'#888'})};

async function connect(){const {base,token}=await settings();if(!base||!token)return badge(false);
 if(S.ws&&S.ws.readyState<=1)return;
 const ws=new WebSocket(base.replace(/^http/,'ws')+'/ui/local-browser/ws?t='+encodeURIComponent(token));S.ws=ws;
 ws.onopen=()=>{badge(true);clearInterval(S.alive);S.alive=setInterval(()=>{try{ws.send('{"type":"ping"}')}catch{}},20000)};
 ws.onmessage=async e=>{let m;try{m=JSON.parse(e.data)}catch{return}
  if(m.type==='unpaired'){await chrome.storage.local.remove('token');badge(false);return}
  if(m.type!=='command')return;
  let reply;try{reply={ok:true,result:await act(m.action,m.arguments||{})}}catch(err){reply={ok:false,error:String(err?.message||err)}}
  try{ws.send(JSON.stringify({type:'result',id:m.id,...reply}))}catch{}};
 ws.onclose=()=>{badge(false);clearInterval(S.alive);if(S.ws===ws)S.ws=null};ws.onerror=()=>{}}

// the agent's own window and tab (kept across restarts of this extension)
async function agentTab(){if(!S.tab)S.tab=(await chrome.storage.session.get('tab')).tab;
 if(S.tab){try{return await chrome.tabs.get(S.tab)}catch{}}
 const w=await chrome.windows.create({url:'about:blank',focused:true,width:1280,height:900});S.tab=w.tabs[0].id;await chrome.storage.session.set({tab:S.tab});return w.tabs[0]}
const loaded=id=>new Promise(ok=>{const t=setTimeout(done,30000);function done(){clearTimeout(t);chrome.tabs.onUpdated.removeListener(on);ok()}
 function on(tid,info){if(tid===id&&info.status==='complete')done()}chrome.tabs.onUpdated.addListener(on)});
const inPage=async(func,args=[])=>{const t=await agentTab();const [r]=await chrome.scripting.executeScript({target:{tabId:t.id},func,args});return r?.result};
const cleanRef=r=>String(r||'').replace(/^@/,'').replace(/^ref=/,'').trim();

async function act(action,a){
 if(action==='controller.noop')return {success:true};
 if(action==='browser_navigate'){let url=String(a.url||'');if(!/^[a-z]+:/i.test(url))url='https://'+url;const t=await agentTab();const w=loaded(t.id);await chrome.tabs.update(t.id,{url});await w;
  const tab=await chrome.tabs.get(t.id);const snap=await inPage(snapshot,[false]);return {success:true,url:tab.url,title:tab.title,snapshot:snap.text,element_count:snap.count}}
 if(action==='browser_snapshot'){const snap=await inPage(snapshot,[!!a.full]);return {success:true,snapshot:snap.text,element_count:snap.count}}
 if(action==='browser_click'){const r=await inPage(clickRef,[cleanRef(a.ref)]);if(!r.ok)throw new Error(r.error);await new Promise(z=>setTimeout(z,600));return {success:true,clicked:a.ref}}
 if(action==='browser_type'){const r=await inPage(typeRef,[cleanRef(a.ref),String(a.text??'')]);if(!r.ok)throw new Error(r.error);return {success:true,typed:String(a.text??''),element:a.ref}}
 if(action==='browser_press'){const r=await inPage(pressKey,[String(a.key||'Enter')]);await new Promise(z=>setTimeout(z,600));return {success:true,pressed:a.key,...r}}
 if(action==='browser_scroll'){await inPage(d=>window.scrollBy({top:(d==='up'?-1:1)*innerHeight*.8,behavior:'instant'}),[a.direction]);return {success:true,scrolled:a.direction}}
 if(action==='browser_back'){const t=await agentTab();const w=loaded(t.id);await chrome.tabs.goBack(t.id).catch(()=>{});await w;const tab=await chrome.tabs.get(t.id);return {success:true,url:tab.url,title:tab.title}}
 throw new Error('This browser cannot do '+action+' yet.')}

// ---- functions that run inside the page ----
function snapshot(full){
 document.querySelectorAll('[data-aq-ref]').forEach(e=>e.removeAttribute('data-aq-ref'));
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
 const walk=el=>{for(const e of el.children){if(n>=500)return;const tag=e.tagName.toLowerCase();if(['script','style','noscript','svg','template'].includes(tag))continue;
   if(e.matches(SEL)&&vis(e)&&!e.disabled){n++;const ref='e'+n;e.setAttribute('data-aq-ref',ref);const role=roleOf(e);let line='- '+role+' "'+nameOf(e)+'"';
    if(role==='textbox'||role==='searchbox'||role==='combobox'){const v=e.isContentEditable?text(e.innerText):text(e.value);if(v&&e.type!=='password')line+=' value="'+v+'"';if(e.type==='password')line+=' (password)'}
    if(e.type==='checkbox'||e.type==='radio')line+=e.checked?' (checked)':'';lines.push(line+' [ref='+ref+']');if(role!=='heading')continue}
   else if(/^h[1-6]$/.test(tag)&&vis(e)){lines.push('- heading "'+text(e.innerText)+'"');continue}
   else if(full&&['p','li','td','th','span','div','label','dt','dd','pre','code'].includes(tag)&&!e.children.length&&vis(e)){const t=text(e.innerText);if(t)lines.push('  '+t)}
   walk(e)}};
 walk(document.body||document.documentElement);if(n>=500)lines.push('(more elements below: scroll and take a new snapshot)');
 return {text:lines.join('\n'),count:n}}
function clickRef(ref){const e=document.querySelector('[data-aq-ref="'+ref+'"]');if(!e)return {ok:false,error:'No element '+ref+' on the page now. Take a new snapshot.'};
 e.scrollIntoView({block:'center'});e.focus?.();e.click();return {ok:true}}
function typeRef(ref,value){const e=document.querySelector('[data-aq-ref="'+ref+'"]');if(!e)return {ok:false,error:'No element '+ref+' on the page now. Take a new snapshot.'};
 e.scrollIntoView({block:'center'});e.focus();
 if(e.isContentEditable){document.execCommand('selectAll');document.execCommand('insertText',false,value);return {ok:true}}
 const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
 Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true}}
function pressKey(key){const e=document.activeElement||document.body;const o={key,code:key.length===1?'Key'+key.toUpperCase():key,bubbles:true,cancelable:true};
 const go=e.dispatchEvent(new KeyboardEvent('keydown',o));e.dispatchEvent(new KeyboardEvent('keyup',o));
 if(go&&key==='Enter'){const f=e.form||e.closest?.('form');if(f){f.requestSubmit?f.requestSubmit():f.submit();return {submitted:true}}if(e.tagName==='BUTTON'||e.getAttribute?.('role')==='button')e.click()}
 if(go&&key==='Tab'){const all=[...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled);const i=all.indexOf(e);all[i+1]?.focus()}
 return {}}

chrome.runtime.onStartup.addListener(connect);chrome.runtime.onInstalled.addListener(connect);
chrome.alarms.create('keep',{periodInMinutes:1});chrome.alarms.onAlarm.addListener(connect);
chrome.runtime.onMessage.addListener((m,_s,reply)=>{if(m==='connect'){S.ws?.close();S.ws=null;connect().then(()=>reply(true));return true}
 if(m==='status'){reply({connected:!!S.ws&&S.ws.readyState===1});return true}});
connect();
