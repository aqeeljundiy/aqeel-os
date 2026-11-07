// the box's home folder as the server reported it at sign-in (no fixed user name); '~' until then
function boxHome(){const h=(typeof S!=='undefined'&&S.me&&S.me.home)||(typeof FILE_HOME!=='undefined'&&FILE_HOME!=='~'&&FILE_HOME)||'~';return String(h).replace(/\/+$/,'')}
// Core of the real app: API access, routing, shell, floating layers and sign-in.
const $=(s,el=document)=>el.querySelector(s);
const $$=(s,el=document)=>[...el.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isMac=/Mac|iPhone|iPad/.test(navigator.platform);
const MOD=isMac?'⌘':'Ctrl';
const store={get(k,d){try{const v=localStorage.getItem('hui-'+k);return v===null?d:JSON.parse(v)}catch{return d}},set(k,v){try{localStorage.setItem('hui-'+k,JSON.stringify(v))}catch{}}};
// Costs are worked out in US dollars; each person can see them in another currency, at today's rate (account menu, or Usage)
const FX={rates:store.get('fxRates',{IDR:store.get('idrRate',16500)}),get rate(){return this.rates[currency()]||this.rates.IDR||1},loaded:false,load(){if(this.loaded)return;this.loaded=true;UI('/ui/fx').then(r=>{if(r.rates){this.rates=r.rates;this.day=r.updated;store.set('fxRates',r.rates)}}).catch(()=>{})}};
const currency=()=>store.get('currency',null)||S.defaults?.currency||'USD';
function money(c,opt={}){if(c==null||isNaN(c))return '';c=+c;
 if(currency()==='IDR'){FX.load();const v=c*FX.rate;if(v>0&&v<1)return '<Rp1';return 'Rp'+(v>=1e6&&!opt.full&&!opt.cents?(v/1e6).toLocaleString('id-ID',{maximumFractionDigits:v>=1e7?0:1})+' jt':Math.round(v).toLocaleString('id-ID'))}
 const cur=currency();if(cur!=='USD'&&FX.rates[cur]){FX.load();const v=c*FX.rates[cur];try{return new Intl.NumberFormat(undefined,{style:'currency',currency:cur,maximumFractionDigits:opt.cents||v<10?2:0}).format(v)}catch{}}else if(cur!=='USD')FX.load();
 if(opt.cents)return '$'+c.toFixed(2);return c>0&&c<0.01?'<$0.01':'$'+(c<10?c.toFixed(2):Math.round(c).toLocaleString('en-US'))}
function setCurrency(c){store.set('currency',c);if(typeof CodeUI!=='undefined')CodeUI.post({aq:'currency',code:c,rate:FX.rate});if(c!=='USD')FX.load();toast(c==='USD'?'Costs now in US dollars':'Costs now in '+c+(FX.rates[c]?', at about '+FX.rates[c].toLocaleString(undefined,{maximumFractionDigits:2})+' per dollar':''));if(typeof reload==='function')reload()}
// Your settings follow you: what this browser remembers for you (drafts, Allow all per chat, folded sections,
// filters, theme, notifications you have seen) is also saved to your account on the box and loaded once at sign-in,
// so every device shows the same. Rules: a change made here and not sent yet always wins; another person signing in
// on this browser never sees (or inherits) yours; deletions stay deleted; sends are small batches.
const Prefs={q:{},gone:new Set(),t:0,ready:false,loaded:null,
 mine:k=>/^(hui-|draft:|cronSeen:|chAlert:|cronFail:)/.test(k)&&k!=='hui-prefs-owner',
 push(k,v){if(!this.ready)return;this.q[k]=v;this.gone.delete(k);this.later()},
 drop(k){if(!this.ready)return;delete this.q[k];this.gone.add(k);this.later()},
 later(){clearTimeout(this.t);this.t=setTimeout(()=>this.flush(),1200)},
 flush(closing){const set=this.q,del=[...this.gone];if(!Object.keys(set).length&&!del.length)return;this.q={};this.gone.clear();
  // batches under 60 KB (a closing tab can only send that much)
  const batches=[];let cur={set:{},del},size=0;for(const [k,v] of Object.entries(set)){const n=k.length+String(v).length+8;if(size+n>60000&&Object.keys(cur.set).length){batches.push(cur);cur={set:{},del:[]};size=0}cur.set[k]=v;size+=n}batches.push(cur);
  for(const b of batches)fetch('/ui/prefs',{method:'PUT',headers:{'x-hui':'1','content-type':'application/json'},body:JSON.stringify(b),keepalive:!!closing}).then(r=>{if(!r.ok)throw new Error(r.status)}).catch(()=>{
   // put the batch back unless a newer change to the same key is already waiting, and try again later
   for(const [k,v] of Object.entries(b.set))if(!(k in this.q)&&!this.gone.has(k))this.q[k]=v;b.del.forEach(k=>{if(!(k in this.q))this.gone.add(k)});if(!closing){clearTimeout(this.t);this.t=setTimeout(()=>this.flush(),15000)}})},
 load(uid){return this.loaded??=(async()=>{try{const r=await fetch('/ui/prefs',{headers:{'x-hui':'1'}});if(!r.ok)return;const {prefs={}}=await r.json();
   const keys=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(this.mine(k))keys.push(k)}
   // someone else used this browser before: their settings leave with them
   const owner=localStorage.getItem('hui-prefs-owner');const other=owner&&uid&&owner!==String(uid);if(other)for(const k of keys)try{rawDel.call(localStorage,k)}catch{}
   if(uid)try{rawSet.call(localStorage,'hui-prefs-owner',String(uid))}catch{}
   for(const [k,v] of Object.entries(prefs))if(!(k in this.q)&&!this.gone.has(k))try{rawSet.call(localStorage,k,v)}catch{}
   this.ready=true;
   // a brand-new account takes what this browser already had (its first device); after that, the account is the source
   if(!Object.keys(prefs).length&&!other)for(const k of keys){const v=localStorage.getItem(k);if(v!=null)this.push(k,v)}
   if(prefs['hui-theme'])document.documentElement.classList.toggle('dark',prefs['hui-theme']==='dark')}catch{}})()},
 // signing out: this browser keeps nothing of yours
 clear(){const keys=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(this.mine(k)&&k!=='hui-theme')keys.push(k)}this.flush(true);for(const k of keys)try{rawDel.call(localStorage,k)}catch{}try{rawDel.call(localStorage,'hui-prefs-owner')}catch{}this.ready=false;this.loaded=null}};
const rawSet=Storage.prototype.setItem,rawDel=Storage.prototype.removeItem;
Storage.prototype.setItem=function(k,v){rawSet.call(this,k,v);if(this===window.localStorage&&Prefs.mine(k))Prefs.push(k,String(v))};
Storage.prototype.removeItem=function(k){rawDel.call(this,k);if(this===window.localStorage&&Prefs.mine(k))Prefs.drop(k)};
addEventListener('pagehide',()=>Prefs.flush(true));

/* ---------- API ---------- */
class ApiError extends Error{constructor(msg,status,data){super(msg);this.status=status;this.data=data}}
// A page that is still loading when you move to another page must not draw into the new one: a read (GET) that
// started on an earlier page is dropped when it comes back (a quiet "stale" error nobody sees). Changes (POST,
// PUT, DELETE) always finish.
// What went wrong in this tab lately (failed requests, error toasts, "Couldn't load" lines, chat errors), newest last:
// Help sends it with each question so it can tell what happened. Only this tab, only the last few, no query strings.
const Oops={list:[],add(kind,text){text=String(text||'').replace(/\s+/g,' ').trim().slice(0,240);if(!text)return;const page=location.hash.split('?')[0].slice(1,80),l=this.list,x=l[l.length-1];
 if(x&&x.text===text&&x.page===page){x.n=(x.n||1)+1;x.t=Date.now();return}l.push({t:Date.now(),at:new Date().toTimeString().slice(0,5),kind,text,page});if(l.length>12)l.shift()},
 recent(){const t=Date.now()-3600e3;return this.list.filter(x=>x.t>t).map(({at,kind,text,page,n})=>({at,kind,text:n>1?text+' ('+n+' times)':text,page}))}};
const STALE=()=>Object.assign(new Error('That page was left before it finished loading.'),{stale:true});
// A button you press shows a spinner while what it started is still talking to the server (anything it starts within
// 0.6 s of the click), so it never looks like nothing happened. Works for every button, however its click is wired.
const Press={btn:null,at:0};document.addEventListener('click',e=>{const b=e.target.closest?.('button,.btn,[role=button]');if(b&&!b.disabled){Press.btn=b;Press.at=Date.now()}},true);
function pressBusy(p){const b=Press.btn;if(!b||Date.now()-Press.at>600||!b.isConnected)return;b._busyN=(b._busyN||0)+1;
 const t=setTimeout(()=>{if(b._busyN&&b.isConnected){b.classList.add('is-busy');b.setAttribute('aria-busy','true')}},120);
 p.finally(()=>{if(--b._busyN<=0){b._busyN=0;clearTimeout(t);b.classList.remove('is-busy');b.removeAttribute('aria-busy')}}).catch(()=>{})}
// The same read asked for by several parts of one page (every wrapper of a page used to fetch the agents, identities,
// status, config or channels again) is one request: identical reads in flight share it, and a short list of lookups is
// kept 5 s. Cleared by every page draw (reload too) and by any change, so a save never shows old data. Each caller gets
// its own copy: one part sorting a list can't change another's. opt.fresh: a polling loop (waiting for a restart) always asks the server.
const ReadShare={m:new Map(),keep:/^(\/ui\/(identities|agents|access|channels|box)|\/hapi\/(profiles|status|config|skills|messaging\/platforms))(\?|$)/,clear(){this.m.clear()}};
async function call(base,path,opt={}){const read=(!opt.method||opt.method==='GET')&&!opt.raw&&!opt.signal;if(!read)ReadShare.clear();
 const k=read&&!opt.fresh&&(S._nav||0)+'|'+base+path,hit=k&&ReadShare.m.get(k);
 if(hit&&(hit.live||Date.now()-hit.t<5000))return hit.p.then(d=>d&&typeof d==='object'?structuredClone(d):d);
 const req=callRaw(base,path,opt);pressBusy(req);if(!read){req.finally(()=>ReadShare.clear()).catch(()=>{});return req}if(!k)return req;
 const e={p:req,live:true,t:0};ReadShare.m.set(k,e);
 req.then(()=>{e.live=false;e.t=Date.now();if(!ReadShare.keep.test(base+path)&&ReadShare.m.get(k)===e)ReadShare.m.delete(k)},()=>{if(ReadShare.m.get(k)===e)ReadShare.m.delete(k)});
 return req.then(d=>d&&typeof d==='object'?structuredClone(d):d)}
// Leaving a page cancels the reads it still waits for (their answers would be dropped anyway): the browser has only a
// few connections per site, and slow leftovers made the next page queue behind them
let NavAbort=new AbortController();
function navNext(){S._nav=(S._nav||0)+1;NavAbort.abort();NavAbort=new AbortController();document.querySelector('[data-still]')?.removeAttribute('data-still')}   // a new visit animates in again
async function callRaw(base,path,opt={}){const nav=S._nav,read=!opt.method||opt.method==='GET';
 const init={method:opt.method||'GET',headers:{'x-hui':'1',...(opt.fresh?{'x-fresh':'1'}:{}),...(opt.headers||{})},credentials:'same-origin',signal:opt.signal||(read&&!opt.keep&&!opt.raw?NavAbort.signal:undefined)};
 if(opt.body!==undefined){if(opt.body instanceof FormData||opt.body instanceof Blob)init.body=opt.body;else{init.body=JSON.stringify(opt.body);init.headers['content-type']='application/json'}}
 let r;try{r=await fetch(base+path,init)}catch(e){if(e?.name==='AbortError'&&!opt.signal&&nav!==S._nav)throw STALE();if(e?.name!=='AbortError')Oops.add('request',init.method+' '+path.split('?')[0]+': '+(e?.message||e));throw e}
 if(read&&!opt.keep&&nav!==S._nav)throw STALE();
 // Only this app's own server says "sign in again"; a 401 from Hermes itself is an ordinary error.
 if(r.status===401&&r.headers.get('x-hui-auth')==='required'){signedOut();throw new ApiError('Signed out',401)}
 if(opt.raw)return r;
 let text;try{text=await r.text()}catch(e){if(e?.name==='AbortError'&&nav!==S._nav)throw STALE();throw e}let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
 if(!r.ok){const d=data&&typeof data==='object'?data:{};if(Array.isArray(d.detail))d.detail=d.detail.map(x=>(x.loc?x.loc.slice(-1)[0]+': ':'')+(x.msg||'')).join('; ');const msg=d.detail?.message||d.detail||d.error?.message||d.error||d.message||('The server answered '+r.status);if(!path.startsWith('/ui/help/'))Oops.add('request',init.method+' '+path.split('?')[0]+' answered '+r.status+': '+(typeof msg==='string'?msg:JSON.stringify(msg)));throw new ApiError(typeof msg==='string'?msg:JSON.stringify(msg),r.status,data)}
 return data;
}
// The active agent (Hermes profile): dashboard calls get ?profile=, gateway calls go through /p/<profile>/.
// pages that belong to one agent: a picker in the header shows another agent's without switching who you chat with
const VIEW_RE=/^#\/(abilities\/(skills|mcp|plugins)|agents\/(files|memory)|automations\/(webhooks|n8n)|channels\/channels|models\/models|system\/(keys|logs|settings|usage))(\/|$)/;
const agentProfile=()=>{if(S.chOverride)return S.chOverride;   // chOverride: setting up an extra connection (WhatsApp 2…)
 if(S.viewAgent){if(VIEW_RE.test(location.hash))return S.viewAgent==='default'?'':S.viewAgent;S.viewAgent=null}
 return S.profile&&S.profile!=='default'?S.profile:''};
// Every dashboard call names its agent, the main one too: Hermes serves several agents from one backend
// and refuses some writes (e.g. deleting a webhook) that don't say which.
const withProfile=p=>{if(/[?&]profile=/.test(p))return p;return p+(p.includes('?')?'&':'?')+'profile='+encodeURIComponent(agentProfile()||'default')};
// one agent's copy of a path (an All agents row acting on its owner); no agent: the page's own (withProfile)
const prof=(p,a)=>a?p+(p.includes('?')?'&':'?')+'profile='+encodeURIComponent(a):p;
const H=(p,o)=>call('/hapi',withProfile(p),o);          // Hermes dashboard API (settings, sessions, admin)
const G=(p,o)=>call('/gapi'+(agentProfile()?'/p/'+encodeURIComponent(agentProfile()):''),p,o);          // Hermes gateway API (chat, runs)
const post=(fn,p,body)=>fn(p,{method:'POST',body:body===undefined?{}:body});
const put=(fn,p,body)=>fn(p,{method:'PUT',body});
const del=(fn,p,body)=>fn(p,{method:'DELETE',body});
const qp=o=>{const q=new URLSearchParams();for(const[k,v]of Object.entries(o))if(v!==undefined&&v!==null&&v!=='')q.set(k,v);const s=q.toString();return s?'?'+s:''};

// Background actions (doctor, backup, update…): poll their log until they finish.
async function followAction(name,onLines){for(let i=0;i<600;i++){let st;try{st=await H('/actions/'+encodeURIComponent(name)+'/status?lines=400')}catch(e){onLines([e.message],true);return}onLines(st.lines||[],!st.running,st.exit_code);if(!st.running)return st;await sleep(1500)}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ---------- formatting ---------- */
function ago(sec){if(!sec)return '';const m=Math.round((Date.now()/1000-sec)/60);if(m<1)return 'just now';if(m<60)return m+' min ago';const h=Math.round(m/60);if(h<24)return h+' h ago';const d=Math.round(h/24);return d<30?d+' d ago':new Date(sec*1000).toLocaleDateString()}
function when(iso){if(!iso)return '—';const d=new Date(iso);if(isNaN(d))return esc(iso);const diff=(d-Date.now())/1000;const abs=Math.abs(diff);const rel=abs<3600?Math.round(abs/60)+' min':abs<86400?Math.round(abs/3600)+' h':Math.round(abs/86400)+' d';return diff>0?'in '+rel:rel+' ago'}
function groupOf(sec){const d=(Date.now()/1000-sec)/86400;const today=new Date();today.setHours(0,0,0,0);const t=sec*1000;return t>=today.getTime()?'Today':t>=today.getTime()-864e5?'Yesterday':d<7?'Previous 7 days':'Older'}
const num=n=>n==null?'—':n>=1e6?(n/1e6).toFixed(1).replace(/\.0$/,'')+'M':n>=1e3?(n/1e3).toFixed(n>=1e4?0:1).replace(/\.0$/,'')+'k':String(n);
// a reply as one line of text for notices, previews and snippets: its tagged thinking left out (a cut-off one too), action/result tags to their text
const noThink=s=>String(s??'').replace(/<(thinking|reflection)>[\s\S]*?(?:<\/\1>|$)/gi,' ').replace(/<\/?(?:thinking|reflection|action|result)>/gi,' ').replace(/[ \t]{2,}/g,' ').trim();
const bytes=n=>n==null?'—':n>=1e9?(n/1e9).toFixed(1)+' GB':n>=1e6?(n/1e6).toFixed(1)+' MB':n>=1e3?(n/1e3).toFixed(1)+' KB':n+' B';
const plural=(n,w)=>n+' '+w+(n===1?'':'s');
// Short provider names, the way people say them (Claude, ChatGPT…), not Hermes' plugin titles.
// an object with an empty slug is '' (it read "[object Object]", 25 Oct 2026)
const provLabel=p=>{const s=String(typeof p==='object'&&p?p.slug||'':p||''),n=String((typeof p==='object'&&p?p.name:'')||s);if(s==='moa')return 'Team of models';if(/claude-subscription|^claude-code/.test(s))return 'Claude';if(/codex/.test(s))return 'ChatGPT';if(s==='openrouter')return 'OpenRouter';if(/gemini/.test(s))return 'Gemini';return n.replace(/\s*\((experimental|beta)\)$/i,'')};
const modelLabel=m=>{if(!m)return 'Default';const s=String(m).replace(/\[1m\]$/,'').replace(/^(?:anthropic\/)?claude-/,'');const mm=/^(opus|sonnet|haiku|fable)-(\d+)(?:[-.](\d+))?(?:-\d{8})?$/.exec(s.replace(/^anthropic\//,''));if(mm)return mm[1][0].toUpperCase()+mm[1].slice(1)+' '+mm[2]+(mm[3]?'.'+mm[3]:'');if(/^(opus|sonnet|haiku|fable)$/.test(s))return s[0].toUpperCase()+s.slice(1);return niceModel(s)};
// any other model id in plain words: "gpt-6.1-sol" → "GPT-6.1 Sol", "gpt-6-luna-900k" → "GPT-6 Luna · 900k",
// "gemini-2.5-pro" → "Gemini 2.5 Pro", "qwen3-coder-plus" → "Qwen3 Coder Plus"
function niceModel(id){let s=String(id||'').replace(/^.*\//,'').replace(/\[[^\]]*\]$/,'').replace(/-(?:20\d{2}-\d{2}-\d{2}|\d{8})$/,'');
 let ctx='';const c=/-(\d+(?:\.\d+)?[km])$/i.exec(s);if(c){ctx=c[1].toLowerCase();s=s.slice(0,-c[0].length)}
 const BRAND={gpt:'GPT',gemini:'Gemini',gemma:'Gemma',grok:'Grok',qwen:'Qwen',deepseek:'DeepSeek',llama:'Llama',mistral:'Mistral',kimi:'Kimi',glm:'GLM',minimax:'MiniMax',claude:'Claude',command:'Command',sonar:'Sonar',nova:'Nova',phi:'Phi'};
 const parts=s.split('-').filter(Boolean);if(!parts.length)return String(id||'');
 const word=w=>/^\d/.test(w)?w:/^(mini|nano|micro)$/i.test(w)?w.toLowerCase():/^[a-z]\d/i.test(w)||/^\d+[a-z]$/i.test(w)?w.toUpperCase():w[0].toUpperCase()+w.slice(1);
 let head=parts.shift();const b=/^([a-z]+)(\d.*)?$/i.exec(head);let out;
 if(b&&BRAND[b[1].toLowerCase()]){const name=BRAND[b[1].toLowerCase()];
  if(name==='GPT'&&/^\d/.test(parts[0]||''))out='GPT-'+parts.shift();else if(name==='GPT'&&b[2])out='GPT-'+b[2];else out=name+(b[2]||'')}
 else out=/^o\d/i.test(head)?head.toLowerCase():word(head);
 const rest=parts.map(word).join(' ').replace(/\bCodex\b/,'Codex');
 return (out+(rest?' '+rest:'')+(ctx?' · '+ctx:'')).trim()}
const srcIcon=s=>({telegram:'telegram',whatsapp:'whatsapp',cron:'cron',api_server:'chat',tui:'terminal',cli:'terminal',oneshot:'terminal',webhook:'hook',discord:'chat',slack:'chat',email:'chat'}[s]||'chat');

// Links show as small labelled buttons (named links keep their name; a bare link says what it is: Google Doc, Sheet…)
// Each shows the site's own icon, the name at text weight and the site in muted text (agreed mock-up, part 2).
const LK_SITES=[[/docs\.google\.com\/document/,'Google Docs','Google Doc'],[/docs\.google\.com\/spreadsheets/,'Google Sheets','Google Sheet'],[/docs\.google\.com\/presentation/,'Google Slides','Google Slides'],[/docs\.google\.com\/forms/,'Google Forms','Google Form'],[/drive\.google\.com/,'Google Drive','Google Drive'],[/calendar\.google\.com/,'Google Calendar','Calendar'],[/mail\.google\.com/,'Gmail','Gmail'],[/notion\.(so|site)/,'Notion','Notion page'],[/github\.com/,'GitHub','GitHub'],[/figma\.com/,'Figma','Figma file'],[/slack\.com/,'Slack','Slack'],[/(youtube\.com|youtu\.be)/,'YouTube','YouTube video'],[/canva\.com/,'Canva','Canva design'],[/ai\.elkiya\.com/,'aqeelOS','aqeelOS']];
function lkInfo(u){const raw=u.replace(/&amp;/g,'&');let host='',deep=false;try{const x=new URL(raw);host=x.hostname.replace(/^www\./,'');deep=x.pathname.length>1}catch{}
 const s=LK_SITES.find(([re])=>re.test(raw));const site=s?s[1]:host.split('.').slice(-2,-1)[0]?.replace(/^./,c=>c.toUpperCase())||host;
 return {raw,host,site,fallback:s?s[2]:host+(deep?'/…':'')}}
const lkFav=host=>host?`<img class="lk-fav" src="/ui/logo?d=${encodeURIComponent(host)}&v=3" alt="" loading="lazy">`:'';
// "Open in Code" from an agent (its open_in_code tool): a link to this aqeelOS's Code page opens Code here, not a new tab
function codeOpen(u,text){const m=/^(https?:\/\/[^/]+)\/#\/code\/code\/([\w-]{10,40})$/.exec(String(u).replace(/&amp;/g,'&'));if(!m||m[1]!==location.origin)return '';
 return `<a class="btn small code-open" href="#/code/code/${m[2]}">${icon('terminal',14)}<span>${text||'Open in Code'}</span></a>`}
function linkChip(u,text){const {host,site,fallback}=lkInfo(u);const label=text||fallback;
 return `<a class="lk" href="${u}" target="_blank" rel="noopener" title="${u}">${lkFav(host)}${icon('link',13)}<span>${label}</span>${text&&site&&site.toLowerCase()!==String(label).toLowerCase()?`<small>${esc(site)}</small>`:''}</a>`}
// a link on a line of its own becomes a small card: icon, name, site, Open
function linkCard(u,text){const {host,site,fallback}=lkInfo(u);
 return `<a class="lk-card" href="${u}" target="_blank" rel="noopener" title="${u}"><span class="lk-ic">${lkFav(host)}${icon('link',16)}</span><span class="lk-t"><b>${text||fallback}</b><small>${esc(site)}</small></span><span class="lk-go">Open ${icon('popout',13)}</span></a>`}
// a file the agent made: its name with a small type badge, opening it from the box
function fileChip(p){const name=p.split('/').pop(),ext=(name.split('.').pop()||'').slice(0,4).toUpperCase();const href=typeof fileUrl==='function'?fileUrl(p):'#';
 return `<a class="fchip" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(p)}"><i class="fx-${esc(ext.toLowerCase())}">${esc(ext)}</i>${esc(name)}</a>`}
// [[Done]] / [[Needs you]] / [[Failed]]: a status label, its colour from the word
function statusChip(w){const k=/^(done|ok|ready|sent|live|passed|paid|fixed|connected)$/i.test(w)?'ok':/^(failed|error|blocked|broken|overdue|missed|down)$/i.test(w)?'bad':/^(needs you|waiting|pending|to do|todo|in progress|review|soon|paused)$/i.test(w)?'wait':'';return `<span class="stl ${k}">${esc(w)}</span>`}
// Small, safe Markdown: paragraphs, lists, headings, bold, italics, inline code, fenced code, links, tables, quotes.
function md(src){
 // MEDIA:/path/picture.png (how agents hand over pictures they made) shows the picture itself
 src=String(src||'').replace(/(^|\s)MEDIA:\s*(\/[^\s)]+\.(?:png|jpe?g|gif|webp|bmp))/gi,(m,pre,p)=>pre+'![image](/ui/media?path='+encodeURIComponent(p)+')');
 const out=[];const lines=String(src||'').replace(/\r/g,'').split('\n');let i=0;
 // inline: code and images are lifted out first so nothing inside them gets rewritten
 const inline=t=>{const keep=[];const put=h=>'\u0000'+(keep.push(h)-1)+'\u0000';
  const FILE=/^(?:\/home\/[\w.-]+|~)\/[^\s`<>"']*[^\s`<>"'/]\.[A-Za-z0-9]{1,6}$/;
  t=t.replace(/`([^`]+)`/g,(m,c)=>put(FILE.test(c)?fileChip(c.replace(/^~/,boxHome())):'<code>'+esc(c)+'</code>'))
   .replace(/(^|[\s(])((?:\/home\/[\w.-]+|~)\/[^\s`<>"']*[^\s`<>"'/.,;:)]\.[A-Za-z0-9]{1,6})(?=$|[\s.,;:)])/g,(m,pre,f)=>pre+put(fileChip(f.replace(/^~/,boxHome()))))
   .replace(/\[\[([^\[\]\n]{1,24})\]\]/g,(m,w)=>put(statusChip(w.trim())))
   .replace(/!\[([^\]]*)\]\(((?:data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+)|(?:https?:\/\/[^)\s]+)|(?:\/ui\/media\?path=[^)\s]+))\)/g,(m,alt,u)=>put(`<img class="md-img" src="${esc(u)}" alt="${esc(alt)}" loading="lazy">`));
  t=esc(t).replace(/(?<![\w\/.-])Hermes Agent\b/g,'aqeelOS').replace(/(?<![\w\/.-])Hermes(?![\w-])/g,'aqeelOS').replace(/(?<![\w\/.-])hermes(?=[\s-])/g,'aqeelos').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/__([^_]+)__/g,'<b>$1</b>').replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g,'$1<i>$2</i>').replace(/~~([^~]+)~~/g,'<s>$1</s>')
   .replace(/\[([^\]]+)\]\((mailto:[^)\s"]+)\)/g,(m,t,u)=>`<a href="${u}">${t}</a>`).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,(m,t,u)=>codeOpen(u,t)||linkChip(u,t)).replace(/(^|\s)(https?:\/\/[^\s<]+)/g,(m,pre,u)=>pre+linkChip(u));
  return t.replace(/\u0000(\d+)\u0000/g,(m,n)=>keep[+n])};
 const isItem=l=>/^\s*(?:[-*+]|\d+[.)])\s+/.test(l),indent=l=>l.match(/^\s*/)[0].replace(/\t/g,'  ').length;
 // a list block, nested by indentation; indented lines under an item continue it
 const list=()=>{const root={kids:[]};const stack=[{ind:-1,node:root,ordered:null}];
  while(i<lines.length){const l=lines[i];
   if(/^\s*$/.test(l)){const nx=lines[i+1]||'';
    // a blank line then a different kind of list (numbers → bullets) starts a new list
    if(isItem(nx)&&indent(nx)===0&&root.kids.length&&/^\s*\d/.test(nx)!==root.kids[0].ordered)break;
    if(isItem(nx)||(indent(nx)>=2&&stack.length>1)){i++;continue}break}
   if(isItem(l)){const ind=indent(l),ordered=/^\s*\d/.test(l);while(stack.length>1&&ind<=stack[stack.length-1].ind)stack.pop();
    const parent=stack[stack.length-1].node;const item={n:(/^\s*(\d+)/.exec(l)||[])[1]||null,text:[l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/,'')],kids:[],ordered,task:null};
    const m=/^\[( |x|X)\]\s+/.exec(item.text[0]);if(m){item.task=m[1]!==' ';item.text[0]=item.text[0].slice(m[0].length)}
    parent.kids.push(item);stack.push({ind,node:item});i++;continue}
   if(indent(l)>=2&&stack.length>1){stack[stack.length-1].node.text.push(l.trim());i++;continue}
   break}
  const html=kids=>{if(!kids.length)return '';const tag=kids[0].ordered?'ol':'ul';
   return `<${tag}>${kids.map(k=>`<li${k.task!==null?' class="task"':''}${k.n?` data-n="${k.n}"`:''}>${k.task!==null?`<span class="tick ${k.task?'on':''}">${k.task?'✓':''}</span>`:''}${k.text.map(inline).join('<br>')}${html(k.kids)}</li>`).join('')}</${tag}>`};
  return html(root.kids)};
 while(i<lines.length){const l=lines[i];
  if(/^\s*```/.test(l)){const lang=l.trim().slice(3).trim();const buf=[];i++;while(i<lines.length&&!/^\s*```/.test(lines[i]))buf.push(lines[i++]);i++;out.push(`<div class="codeblock"><div class="cb-head"><span>${esc(lang||'code')}</span><button data-act="copycode">${icon('copy',13)}Copy</button></div><pre>${esc(buf.join('\n'))}</pre></div>`);continue}
  if(/^\s*$/.test(l)){i++;continue}
  if(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)){out.push('<hr>');i++;continue}
  // a clear heading scale like Claude / ChatGPT: # big, ## medium, ### small, deeper = bold line
  const h=/^(#{1,6})\s+(.*)$/.exec(l);if(h){const n=Math.min(h[1].length,4);out.push(`<h${n+1} class="md-h${n}">${inline(h[2])}</h${n+1}>`);i++;continue}
  if(isItem(l)){out.push(list());continue}
  if(/^\|.*\|\s*$/.test(l)&&/^\|[\s:|-]+\|\s*$/.test(lines[i+1]||'')){const row=r=>r.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());const head=row(l);i+=2;const body=[];while(i<lines.length&&/^\|.*\|\s*$/.test(lines[i]))body.push(row(lines[i++]));out.push(`<div class="table-wrap"><table><thead><tr>${head.map(h=>`<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);continue}
  if(/^>\s?/.test(l)){const b=[];while(i<lines.length&&/^>\s?/.test(lines[i]))b.push(lines[i++].replace(/^>\s?/,''));const warn=/^\s*(⚠|❗|\*\*(warning|heads up|careful|note)\b)/i.test(b[0]||'');out.push('<blockquote'+(warn?' class="warn"':'')+'>'+md(b.join('\n'))+'</blockquote>');continue}
  {const lc=/^\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/.exec(l);if(lc&&/^\s*$/.test(lines[i+1]||'')){out.push(codeOpen(lc[2],esc(lc[1]))&&'<p>'+codeOpen(lc[2],esc(lc[1]))+'</p>'||linkCard(esc(lc[2]),esc(lc[1])));i++;continue}}
  const p=[];while(i<lines.length&&!/^\s*$/.test(lines[i])&&!/^\s*```|^#{1,6}\s|^>\s?|^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])&&!(isItem(lines[i])&&p.length===0)&&!(isItem(lines[i])))p.push(inline(lines[i++]));out.push('<p>'+p.join('<br>')+'</p>');
 }
 return out.join('');
}

/* ---------- agent identity (name, title, picture per profile) ---------- */
function ident(p=S.profile||'default'){const i=S.identities[p]||{};return {name:i.name||(p==='default'?'aqeelOS':p[0].toUpperCase()+p.slice(1)),title:i.title||'',avatar:i.avatar?'/ui/avatar/'+encodeURIComponent(p)+'?v='+encodeURIComponent(i.avatarV||i.avatar):'',emoji:EMOJI.some(e=>e.slug===i.emoji)?i.emoji:''}}
const AGENT=()=>ident().name;
/* ---------- agent avatars: one look everywhere ----------
   photo > chosen emoji > an automatic emoji from the agent's id (stable across renames; the same hash as the server's
   emojiAuto), so no agent shows a bare letter. Round, one set of sizes, fixed width and height so nothing moves while
   the picture loads. data-ava lets repaintAvatars swap them in place after an edit, without repainting the page. */
let EMOJI=[];   // [{slug,name,keywords}] from /assets/emoji/list.json, loaded with the identities
const AVA_STEPS=[16,20,24,28,32,40,56,72,84];
const avaPx=s=>AVA_STEPS.reduce((a,b)=>Math.abs(b-s)<Math.abs(a-s)?b:a);
const emojiAuto=id=>{if(!EMOJI.length)return '';let h=2166136261;for(const c of String(id))h=Math.imul(h^c.charCodeAt(0),16777619);return EMOJI[(h>>>0)%EMOJI.length].slug};
const emojiSrc=slug=>slug?'/assets/emoji/'+encodeURIComponent(slug)+'.png':'';
// an avatar or emoji that failed to load (the server restarting during a deploy) tries once more 2 s later instead of
// staying a broken picture until the window is reopened
document.addEventListener('error',e=>{const im=e.target;if(im?.tagName!=='IMG'||im.dataset.retried||!/\/assets\/emoji\/|\/ui\/(avatar|me\/avatar|people-avatar)/.test(im.src))return;im.dataset.retried='1';setTimeout(()=>{if(im.isConnected)im.src=im.src+(im.src.includes('?')?'&':'?')+'r=1'},2000)},true);
// the bare markup, also for previews in the editor (a picked file or emoji before it is saved)
const avaHtml=(src,photo,px,alt,attrs='',cls='')=>`<span class="ag-ava ${photo?'photo':'emo'}${cls?' '+cls:''}" style="width:${px}px;height:${px}px"${attrs}>${src?`<img src="${esc(src)}" alt="${esc(alt)}" width="${px}" height="${px}" loading="lazy" decoding="async">`:''}</span>`;
// agentAvatar(agent id or {id,name}, size, {cls, name, plain: skip the photo and chosen emoji (a private agent), title:false})
function agentAvatar(a,size=28,o={}){const id=(a&&typeof a==='object'?a.id:a)||'default',i=ident(id),px=avaPx(size),n=o.name||(a&&typeof a==='object'&&a.name)||i.name;
 const photo=!o.plain&&i.avatar,src=photo||emojiSrc(!o.plain&&i.emoji||emojiAuto(id));
 return avaHtml(src,!!photo,px,n,` data-ava="${esc(id)}" data-sz="${px}"${o.cls?` data-cls="${esc(o.cls)}"`:''}${o.plain?' data-plain':''}${o.title===false?'':` title="${esc(n)}"`}`,[o.cls,o.anim&&'ava-in'].filter(Boolean).join(' '))}
// personAvatar({id,name,avatar,emoji}, size): the same component for people. Their photo > their emoji > their initial on
// a soft colour from their id (people get no automatic emoji: the letter says who it is at a glance)
function personAvatar(u,size=28,o={}){u=u||{};const px=avaPx(size),n=u.name||'?',src=u.avatar||emojiSrc(EMOJI.some(e=>e.slug===u.emoji)?u.emoji:'');
 const attrs=` data-person="${esc(u.id||'')}" data-name="${esc(n)}" data-sz="${px}"${o.cls?` data-cls="${esc(o.cls)}"`:''}${o.title===false?'':` title="${esc(n)}"`}`,cls=[o.cls,o.anim&&'ava-in'].filter(Boolean).join(' ');
 if(src)return avaHtml(src,!!u.avatar,px,n,attrs,cls);
 return `<span class="ag-ava ini${cls?' '+cls:''}" style="width:${px}px;height:${px}px;--h:${[...String(u.id||n)].reduce((h,c)=>(h*31+c.charCodeAt(0))%360,7)};font-size:${Math.round(px*.42)}px"${attrs} role="img" aria-label="${esc(n)}">${esc(n.trim()[0]?.toUpperCase()||'?')}</span>`}
// after someone changes their own picture: their avatars on screen take it, with the same fade
function repaintPeople(id,face){for(const el of document.querySelectorAll(`[data-person="${CSS.escape(id)}"]`))el.outerHTML=personAvatar({id,name:el.dataset.name,...face},+el.dataset.sz,{cls:el.dataset.cls,title:el.hasAttribute('title')?undefined:false,anim:true})}

/* ---------- picture editing, shared by the agent editor and Your profile ----------
   avatarCrop: the picked photo in a round frame (drag to move; slider, wheel or pinch to zoom; arrows and + or - from the
   keyboard), exported as a square 256 px WebP (PNG where the browser can't write WebP), so uploads are small and square.
   It opens inside the window (no second dialog) and slides open and shut. Resolves the Blob, or null if cancelled */
const AVA_OK=f=>/^image\/(png|jpeg|webp|heic|heif)$/.test(f.type)||/\.(png|jpe?g|webp|heic|heif)$/i.test(f.name);
const AVA_ACCEPT='image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif';
function avatarCrop(host,file){return new Promise(done=>{
 if(!AVA_OK(file)){toast('Use a JPG, PNG or WebP photo.','err');return done(null)}
 if(file.size>30e6){toast('That photo is over 30 MB. Pick a smaller one.','err');return done(null)}
 const url=URL.createObjectURL(file),img=new Image(),V=220;
 img.onerror=()=>{URL.revokeObjectURL(url);toast(/hei[cf]/i.test(file.type+file.name)?'This browser can’t open HEIC photos. Save it as JPG or PNG first.':'That photo could not be opened.','err');done(null)};
 img.onload=()=>{const w=img.naturalWidth,h=img.naturalHeight,base=Math.max(V/w,V/h);let z=1,x=0,y=0,fin=false;
  host.innerHTML=`<div><div class="crop-in"><div class="crop-vp" tabindex="0" role="group" aria-label="Photo position: drag or use the arrow keys to move, plus and minus to zoom"><img alt="" draggable="false"></div>
   <div class="crop-side"><label for="cropZ">Zoom</label><input type="range" id="cropZ" min="1" max="4" step="0.01" value="1"><p class="hint">Drag to move. Pinch, scroll or use the slider to zoom.</p><div class="crop-acts"><button type="button" class="ghost" data-c="no">Cancel</button><button type="button" class="primary" data-c="ok">Use photo</button></div></div></div></div>`;
  const vp=host.querySelector('.crop-vp'),pic=vp.querySelector('img'),zr=host.querySelector('#cropZ');pic.src=url;pic.style.width=w*base+'px';pic.style.height=h*base+'px';
  const draw=()=>{const s=base*z,mx=Math.max(0,(w*s-V)/2),my=Math.max(0,(h*s-V)/2);x=Math.min(mx,Math.max(-mx,x));y=Math.min(my,Math.max(-my,y));   // the photo always covers the circle
   pic.style.transform=`translate(-50%,-50%) translate(${x}px,${y}px) scale(${z})`;zr.value=z};
  const zoomTo=(nz,cx=0,cy=0)=>{nz=Math.min(4,Math.max(1,nz));x=cx-(cx-x)*nz/z;y=cy-(cy-y)*nz/z;z=nz;draw()};   // the point under the finger stays put
  const pts=new Map();
  vp.onpointerdown=e=>{vp.setPointerCapture(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});vp.classList.add('drag')};
  vp.onpointermove=e=>{const p=pts.get(e.pointerId);if(!p)return;
   if(pts.size===2){const [a,b]=[...pts.values()],d0=Math.hypot(a.x-b.x,a.y-b.y);p.x=e.clientX;p.y=e.clientY;const d1=Math.hypot(a.x-b.x,a.y-b.y);if(d0)zoomTo(z*d1/d0);return}
   x+=e.clientX-p.x;y+=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;draw()};
  const up=e=>{pts.delete(e.pointerId);if(!pts.size)vp.classList.remove('drag')};vp.onpointerup=up;vp.onpointercancel=up;
  vp.addEventListener('wheel',e=>{e.preventDefault();const r=vp.getBoundingClientRect();zoomTo(z*Math.exp(-e.deltaY/400),e.clientX-r.left-V/2,e.clientY-r.top-V/2)},{passive:false});
  const close=r=>{if(fin)return;fin=true;host.classList.remove('open');setTimeout(()=>{if(!host.classList.contains('open'))host.innerHTML='';URL.revokeObjectURL(url)},300);done(r)};
  const ok=()=>{const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d'),s=base*z,sw=V/s;g.imageSmoothingQuality='high';
   g.drawImage(img,w/2-x/s-sw/2,h/2-y/s-sw/2,sw,sw,0,0,256,256);c.toBlob(b=>b&&b.type==='image/webp'?close(b):c.toBlob(close,'image/png'),'image/webp',.9)};
  vp.onkeydown=e=>{const st=e.shiftKey?32:8,m={ArrowLeft:[-st,0],ArrowRight:[st,0],ArrowUp:[0,-st],ArrowDown:[0,st]}[e.key];
   if(m){e.preventDefault();x+=m[0];y+=m[1];draw()}else if(e.key==='+'||e.key==='='){e.preventDefault();zoomTo(z*1.1)}else if(e.key==='-'){e.preventDefault();zoomTo(z/1.1)}
   else if(e.key==='Enter'){e.preventDefault();ok()}};
  // Escape from anywhere in the editor (the photo, the slider, the buttons) cancels it alone; the window under it stays
  host.querySelector('.crop-in').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(null)}};
  zr.oninput=()=>zoomTo(+zr.value);host.querySelector('[data-c="no"]').onclick=()=>close(null);host.querySelector('[data-c="ok"]').onclick=ok;
  draw();requestAnimationFrame(()=>{host.classList.add('open');vp.focus({preventScroll:true})})};
 img.src=url})}
/* emojiPicker: the searchable grid of the emoji set. One tab stop (roving focus); arrows by one or by a row, Home/End,
   up from the first row back to the search, Enter in the search picks the first match. A fixed height, so filtering never
   moves the window. auto: the slug shown on an "Auto" tile (agents), or none (people). onPick(slug, '' for Auto).
   Returns set(slug or null) to move the highlight from outside (null: a photo stands, nothing highlighted) */
function emojiPicker(host,{cur=null,auto='',label='Emoji',onPick}){
 const tile=(e,k,name,extra='')=>`<button type="button" role="radio" class="emo${extra}" data-e="${esc(e)}" data-k="${esc(k)}" aria-label="${esc(name)}" title="${esc(name)}"><img src="${esc(emojiSrc(e||auto))}" alt="" width="34" height="34" loading="lazy">${e?'':'<small>Auto</small>'}</button>`;
 host.innerHTML=`<label for="emoQ">${esc(label)}</label><div class="emo-pick"><div class="emo-q">${icon('search',15)}<input id="emoQ" placeholder="Search, for example owl or rocket" autocomplete="off" aria-controls="emoGrid"></div>
  <div class="emo-grid" id="emoGrid" role="radiogroup" aria-label="${esc(label)}">${auto?tile('','','Automatic: picked from its name',' auto'):''}${EMOJI.map(e=>tile(e.slug,(e.name+' '+e.keywords.join(' ')).toLowerCase(),e.name)).join('')}</div>
  <p class="hint emo-none" hidden>No emoji match. Try another word.</p></div>`;
 const grid=host.querySelector('.emo-grid'),q=host.querySelector('#emoQ'),all=[...grid.children],vis=()=>all.filter(b=>!b.hidden);
 const set=v=>{cur=v;all.forEach(b=>{const on=v!==null&&b.dataset.e===v;b.classList.toggle('on',on);b.setAttribute('aria-checked',on)});const f=vis().find(b=>b.classList.contains('on'))||vis()[0];all.forEach(b=>b.tabIndex=b===f?0:-1)};
 const pick=b=>{set(b.dataset.e);onPick(b.dataset.e)};
 grid.onclick=e=>{const b=e.target.closest('.emo');if(b)pick(b)};
 grid.onkeydown=e=>{const v=vis(),i=v.indexOf(document.activeElement);if(i<0)return;const cols=v.filter(b=>b.offsetTop===v[0].offsetTop).length||1;
  if(e.key==='ArrowUp'&&i<cols){e.preventDefault();return q.focus()}
  const k={ArrowRight:1,ArrowLeft:-1,ArrowDown:cols,ArrowUp:-cols,Home:-i,End:v.length-1-i}[e.key];if(k===undefined)return;e.preventDefault();
  const n=v[Math.min(v.length-1,Math.max(0,i+k))];all.forEach(b=>b.tabIndex=-1);n.tabIndex=0;n.focus();n.scrollIntoView({block:'nearest'})};
 q.oninput=()=>{const w=q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);all.forEach(b=>b.hidden=!!w.length&&!(b.dataset.k&&w.every(t=>b.dataset.k.split(' ').some(k=>k.startsWith(t)))));
  host.querySelector('.emo-none').hidden=!!vis().length;grid.scrollTop=0;set(cur)};
 q.onkeydown=e=>{const f=vis()[0];if(!f)return;if(e.key==='ArrowDown'){e.preventDefault();f.focus()}else if(e.key==='Enter'){e.preventDefault();pick(f);f.focus()}};
 set(cur);return set}
// after an identity changes: every avatar of that agent (or all) on screen takes the new picture, with a short fade
function repaintAvatars(id,empty){for(const el of document.querySelectorAll(id?`[data-ava="${CSS.escape(id)}"]`:'[data-ava]'))if(!empty||!el.querySelector('img'))el.outerHTML=agentAvatar(el.dataset.ava,+el.dataset.sz,{cls:el.dataset.cls,plain:'plain' in el.dataset,title:el.hasAttribute('title')?undefined:false,anim:true})}
async function loadIdentities(){const [ids,em]=await Promise.all([call('','/ui/identities').catch(()=>null),EMOJI.length?null:fetch('/assets/emoji/list.json').then(r=>r.ok?r.json():[]).catch(()=>[])]);if(ids)S.identities=ids;if(Array.isArray(em)&&em.length){EMOJI=em;repaintAvatars('',true)}}   // anything painted before the list arrived gets its emoji now

// Model providers worth showing: signed in, and not Nous or the pay-per-use Anthropic API (no key on this box).
// Gemini via the Google AI plan counts only once someone signed in to it (the engine lists it as soon as the CLI exists)
// gemini-subscription: the Gemini CLI plugin some agents still have on; Google retired it for personal plans (17 Oct)
// Nous and Anthropic only once connected on purpose through Add account (S.acctAllow, accounts.mjs SKIP)
const usableProvider=p=>p.authenticated&&p.slug!=='gemini-subscription'&&(p.models||[]).length&&(!/nous/i.test((p.slug||'')+' '+(p.name||''))||(S.acctAllow||[]).includes(p.slug))&&(p.slug!=='anthropic'||(S.acctAllow||[]).includes('anthropic'));

/* ---------- navigation model ---------- */
const SECTIONS=[
 {id:'chat',label:'Chat',icon:'chat',key:'1'},
 {id:'agents',label:'Agents',icon:'user',key:'2',pages:[
  {id:'profiles',label:'Agents',icon:'user',desc:'Each agent has its own name, picture, personality, model, skills, memory and chats.'},
  {id:'memory',label:'Memory',icon:'brain',desc:'What each agent remembers about you and its work, between chats.'},
  {id:'files',label:'Files',icon:'folder',desc:'Files on the AI box that your agents work with.'}]},
 {id:'code',label:'Code',icon:'terminal',key:'8',pages:[
  {id:'code',label:'Code',icon:'terminal',desc:'Build apps, websites, decks, docs and designs with your agents, a live preview and a guarded browser. Runs in the aqeelOS Code app on this computer.'}]},
 {id:'automations',label:'Automations',icon:'zap',key:'3',pages:[
  {id:'schedules',label:'Schedules',icon:'clock',desc:'Prompts that run on a timetable and deliver the result where you want it.'},
  {id:'webhooks',label:'Webhooks',icon:'hook',desc:'Let other services trigger aqeelOS with an event.'},
  {id:'selfruns',label:'Runs itself',icon:'retry',desc:'Agents can start a fresh run of themselves to test or redo their work: who may ask, how often, and every run.'},
  {id:'n8n',label:'n8n',icon:'layers',desc:'Every agent’s n8n space: who owns it, who can use it. Opens without signing in.'},
  {id:'kanban',label:'Task board',icon:'list',desc:'Tasks your agents pick up and work through on their own.'}]},
 {id:'channels',label:'Channels',icon:'radio',key:'4',pages:[
  {id:'channels',label:'Channels',icon:'radio',desc:'Talk to your agents on WhatsApp, Telegram, Slack and more, and choose who may message them.'}]},
 {id:'abilities',label:'Abilities',icon:'puzzle',key:'5',pages:[
  {id:'skills',label:'Skills',icon:'wand',desc:'Reusable know-how aqeelOS can pick up for a task.'},
  {id:'mcp',label:'Connected apps',icon:'plug',desc:'Outside apps and services your agents can use, like Notion, Slack or GitHub.'},
  {id:'logins',label:'Connected accounts',icon:'shield',desc:'Logins where an agent acts as you.'},
  {id:'plugins',label:'Plugins',icon:'layers',desc:'Extensions for aqeelOS itself, such as model providers.'},
  {id:'achievements',label:'Achievements',icon:'trophy',desc:'Badges for what you and your agents have done, from your whole history.'}]},
 {id:'models',label:'Models',icon:'cpu',key:'6',pages:[
  {id:'models',label:'Models and accounts',icon:'cpu',desc:'The accounts that do the thinking, and which model each agent uses.'}]},
 {id:'system',label:'System',icon:'gauge',key:'7',pages:[
  {id:'usage',label:'Usage',icon:'chart',desc:'Tokens, cache and cost over time.'},
  {id:'health',label:'Health',icon:'activity',desc:'Is everything running, and the AI box itself: resources, updates and maintenance.'},
  {id:'logs',label:'Logs',icon:'list',desc:'What aqeelOS wrote while working.'},
  {id:'keys',label:'Keys and secrets',icon:'key',desc:'API keys, tokens and passwords, stored on the box and never shown in full.'},
  {id:'settings',label:'Settings',icon:'sliders',desc:'Every aqeelOS setting, grouped and searchable.'}]},
 // Help: a chat of the person's own about how aqeelOS works and what went wrong (help.js); replaced System › Guide
 {id:'help',label:'Help',icon:'help',key:'9'},
];

const S={identities:{},collapsed:store.get('collapsed',false),tab:{},status:null,sessions:[],sessionsLoaded:false,chatFilter:['chats','automation','all'].includes(store.get('chatFilter','chats'))?store.get('chatFilter','chats'):'chats',search:'',signedIn:false};

// pages that moved keep their old addresses: [new section, page, tab]
const ROUTE_MOVED={'automations/channels':['channels','channels','Connections'],'automations/pairing':['channels','channels','Who can message'],'system/status':['system','health'],'system/host':['system','health'],'abilities/memory':['agents','memory'],'abilities/files':['agents','files'],'models/keys':['system','keys'],'system/guide':['help',''],'abilities/accounts':['abilities','logins']};
function route(){let p=location.hash.replace(/^#\/?/,'').split('/').map(decodeURIComponent);{const mv=ROUTE_MOVED[p[0]+'/'+p[1]];if(mv){if(mv[2])S.tab[mv[1]]=mv[2];p=[mv[0],mv[1],...p.slice(2)];history.replaceState(null,'','#/'+p.map(encodeURIComponent).join('/'))}}if(p[0]==='signin')return{signin:true};if(p[0]==='invite')return{invite:p[1]||''};const sec=SECTIONS.find(s=>s.id===p[0])||SECTIONS[0];if(sec.id==='chat')return{sec,chat:p[1]||null};if(sec.id==='help')return{sec,help:true,page:{id:'help',label:'Help'},arg:p.slice(1)};const page=sec.pages.find(x=>x.id===p[1])||sec.pages[0];return{sec,page,arg:p.slice(2)}}
// aqeelOS inside the browser extension's side panel: a compact chat, with the full app one click away
const PANEL=new URLSearchParams(location.search).has('panel');if(PANEL){document.documentElement.classList.add('in-panel');if(!location.hash.startsWith('#/chat'))history.replaceState(null,'','#/chat')}
function go(h){if(location.hash==='#'+h)render();else location.hash=h}

/* ---------- shell ---------- */
function render(){
 const r=route(),root=$('#root');closeLayers();ReadShare.clear();
 {const k=location.hash.split('?')[0];if(k!==S._navKey){S._navKey=k;navNext()}}
 if(r.invite!==undefined){root.innerHTML='';inviteView(root,r.invite);return}
 if(r.signin||!S.signedIn){root.innerHTML=signinHtml();bindSignin();return}
 if(!$('.app'))root.innerHTML=`<div class="app"><aside class="side" aria-label="Navigation"></aside><div class="main"><div class="topbar"></div><div id="bannerSlot"></div><div class="view" id="view"></div></div><aside class="screen-pane" id="screenPane" aria-label="Live screen" hidden></aside></div>`;
 const app=$('.app');app.classList.toggle('collapsed',S.collapsed);const sw=store.get('sideW',null);if(sw)app.style.setProperty('--side-open',sw+'px');app.classList.remove('nav-open');
 paintSide(r);paintTop(r);paintBanner();if(typeof Screen!=='undefined')Screen.paint();
 const v=$('#view');{const key=location.hash.split('?')[0];if(v._key!==key){v._key=key;Calm.opening();v.classList.remove('enter');void v.offsetWidth;v.classList.add('enter')}}watchReveal(v);
 if(r.chat!==undefined)Chat.view(v,r.chat);
 else if(r.help){S._pageKey=null;Help.view(v)}
 else{const P=PAGES[r.page.id];const key=r.sec.id+'/'+r.page.id+'/'+(r.arg||[]).join('/')+'@'+(agentProfile()||'')+'/'+String(S.viewAll);
  // Same page again (after a save, a toggle…): update in place. No skeleton flash, no replayed entrance animations.
  const same=S._pageKey===key&&$('#pg');S._pageKey=key;
  // another agent on the same address: answers still on the way for the old one are dropped
  if(!same)navNext();
  if(same){const pg=$('#pg');pg.classList.add('soft');if(P)runPage(P,r,pg).finally(()=>setTimeout(()=>pg.classList.remove('soft'),400))}
  else{v.innerHTML=`<div class="page">${head(r.page)}<div id="pg">${skeleton()}</div></div>`;const pg=$('#pg');if(P)runPage(P,r,pg)}}
 // plugin slots on this page, when some plugin fills one (plugin-host.js)
 if(Plugins.slotNames.size)Plugins.patch();
// draw a page; if it fails (the engine busy for a moment), try once more quietly before saying so
// a drawing that failed after a newer one began says nothing: the newer one owns the page
function runPage(P,r,pg){const nav=S._nav;let gone=pageRun(pg);return Promise.resolve(P(r.page,pg,r)).catch(async e=>{if(e?.stale||gone()||nav!==S._nav||!pg.isConnected)return;if(e?.status&&e.status<500&&e.status!==429)return showError(pg,e);
 await sleep(1200);if(gone()||nav!==S._nav||!pg.isConnected)return;gone=pageRun(pg);return Promise.resolve(P(r.page,pg,r)).catch(e2=>{if(!gone())showError(pg,e2)})})}
}
function paintSide(r){const el=$('.side'),h=sidebar(r||route());if(el._h!==h){el._h=h;el.innerHTML=h}}
function paintTop(r){const el=$('.topbar'),h=topbar(r||route());if(el._h!==h){el._h=h;el.innerHTML=h}}
/* Calm motion. Things fade in when they first appear: a page you open, a menu, a toast, a dialog. When a view redraws
   itself (a refresh, a save, a status update) nothing fades again: any entrance animation on redrawn content is finished
   at once, so nothing flickers. Spinners and other endless animations are left alone. Opt in with data-anim. */
const Calm={until:0,names:null,
 opening(ms=900){this.until=performance.now()+ms},
 entry(){if(this.names)return this.names;const s=new Set();for(const ss of document.styleSheets){let rules;try{rules=ss.cssRules}catch{continue}
  for(const r of rules)if(r.type===7){const f=[...r.cssRules].find(k=>k.keyText==='0%'||k.keyText==='from');if(f&&f.style.opacity!==''&&Number(f.style.opacity)<.6)s.add(r.name)}}return this.names=s},
 calm(n){if(performance.now()<this.until||n.closest?.('.menu,.toast,dialog,.drawer,.notice,[data-anim],.aq-menu'))return;
  for(const a of n.getAnimations?.({subtree:true})||[]){const t=a.effect?.getTiming?.();if(a.animationName&&t&&t.iterations!==Infinity&&this.entry().has(a.animationName))a.finish()}}};
new MutationObserver(list=>{for(const m of list)for(const n of m.addedNodes)if(n.nodeType===1)Calm.calm(n)}).observe(document.documentElement,{childList:true,subtree:true});
Calm.opening(1500);
function sidebar(r){
 const sec=r.sec;
 const sections=SECTIONS.map(s=>`<button class="sec ${s.id===sec.id?'on':''}" data-go="/${s.id}" title="${s.label} (${MOD}+${s.key})" aria-current="${s.id===sec.id?'page':'false'}">${icon(s.icon,19)}<span class="label">${s.label}</span>${s.id==='help'&&typeof Help!=='undefined'&&Help.unseen?'<i class="sec-dot" title="News about your tickets"></i>':''}<span class="kbd">${MOD} ${s.key}</span></button>`).join('');
 let sub='';
 if(sec.id==='chat')sub=Chat.sidebar(r);
 else if(sec.id==='help')sub=Help.sidebar(r);
 else if(sec.id==='code'&&typeof CodeUI!=='undefined')sub=CodeUI.sidebar(r);
 else sub=`<div class="side-sub"><div class="side-sub-head"><span class="th">${sec.label}</span></div><div class="side-list">${sec.pages.filter(p=>!p.hidden).map(p=>`<button class="item ${r.page.id===p.id?'on':''}" data-go="/${sec.id}/${p.id}">${icon(p.icon,16)}<span class="t">${p.label}</span></button>`).join('')}</div></div>`;
 const gs=gwState(S.status);
 return `<div class="resizer side-rz" data-drag="side" title="Drag to resize · double-click to reset"></div><div class="side-top"><span class="wordmark"><img class="mark" src="${Brand.mark()}" alt=""><span>${esc(Brand.name)}</span></span><button class="ghost icon collapse-btn" data-act="collapse" title="Collapse sidebar (${MOD}+B)" aria-label="Collapse sidebar">${icon('panel',18)}</button></div>
 <nav class="sections">${S.collapsed?`<button class="sec" data-act="collapse" title="Expand sidebar (${MOD}+B)">${icon('panel',19)}</button>`:''}${sections}</nav>${sub}
 ${(()=>{const cd=r.sec?.id==='code'&&typeof CodeUI!=='undefined'&&CodeUI.state==='on'?CodeUI.agentCard():null;return cd?`<div class="side-foot"><button class="status-btn" data-menu="profile" aria-label="Account and Code's agent">${cd.none?`<span class="avatar none">${icon('user',15)}</span>`:agentAvatar({id:cd.id,name:cd.name},32,{cls:'avatar',title:false})}<span class="who" title="${esc(cd.name)} · Code · ${esc(cd.model)}"><b>${esc(cd.name)}</b><span><i class="dot" style="color:var(--ok)"></i><em>Code · ${esc(cd.model)}</em></span></span>`:''})()||`<div class="side-foot"><button class="status-btn" data-menu="profile" aria-label="Account and status">${agentAvatar(S.profile||'default',32,{cls:'avatar',title:false})}<span class="who" title="${esc(AGENT())} · ${gs.label} · ${esc(modelLabel(S.model))}"><b>${esc(AGENT())}</b><span${gs.say?` title="${esc(gs.say)}"`:''}><i class="dot" style="color:${gs.c}"></i><em>${gs.label} · ${esc(modelLabel(S.model))}</em></span></span>`}${icon('chevUD',16)}</button></div>`;
}
function topbar(r){
 if(PANEL)return panelTop(r);
 let crumbs;
 if(r.chat==='manage')crumbs=`<span>Chat</span>${icon('chevR',14)}<b>Manage chats</b>`;
 else if(r.chat!==undefined){const c=S.sessions.find(x=>x.id===r.chat);crumbs=`<b data-act="rename-current" title="Rename" style="cursor:text">${c?esc(c.title||c.preview||'Chat'):'New chat'}</b>`}
 else if(r.help)crumbs=r.arg?.[0]==='admin'?`<span>${esc(r.sec.label)}</span>${icon('chevR',14)}<b>Tickets and settings</b>`:`<b>${esc(r.sec.label)}</b>`;
 else crumbs=`<span>${r.sec.label}</span>${icon('chevR',14)}<b>${r.page.label}</b>`;
 return `<button class="ghost icon menu-btn" data-act="nav" aria-label="Open navigation">${icon('menu',20)}</button><div class="crumbs">${crumbs}</div>
 <div class="top-actions"><button class="ghost icon ${Screen.open&&Screen.src_!=='mine'?'on':''}" data-act="screen-box" title="The agent's screen on the AI box" aria-label="The agent's screen on the AI box" aria-pressed="${Screen.open&&Screen.src_!=='mine'}">${icon('monitor',18)}</button><button class="ghost icon ${Screen.open&&Screen.src_==='mine'?'on':''}" data-act="screen-mine" title="My browser: the agent's tab in your own Chrome" aria-label="My browser" aria-pressed="${Screen.open&&Screen.src_==='mine'}">${icon('globe',18)}</button><button class="ghost icon bn-btn" data-act="bottlenecks" title="Bottlenecks: what is stuck until you act" aria-label="Bottlenecks" ${typeof Bottlenecks!=='undefined'&&Bottlenecks.items.length?'':'data-none'}>${icon('alert',18)}<span class="bn-n">${typeof Bottlenecks!=='undefined'&&Bottlenecks.items.length?Math.min(Bottlenecks.items.length,9):''}</span></button><button class="ghost icon bell" data-act="inbox" title="Notifications" aria-label="Notifications">${icon('bell',18)}<span class="bell-n"></span></button><button class="k-btn" data-act="palette" aria-label="Search and commands">${icon('search',15)}<span class="k-label">Search or run a command</span><kbd>${MOD} K</kbd></button>
 <button class="ghost icon" data-act="theme" title="Light or dark" aria-label="Switch light and dark">${icon(document.documentElement.classList.contains('dark')?'sun':'moon',18)}</button></div>`;
}
function panelTop(r){const c=r.chat&&S.sessions.find(x=>x.id===r.chat);const t=r.chat===undefined?r.page.label:c?esc(c.title||c.preview||'Chat'):'New chat';
 return `<button class="ghost icon menu-btn" data-act="nav" aria-label="Past chats and pages" title="Past chats and pages">${icon('menu',19)}</button><div class="crumbs"><b>${t}</b></div>
 <div class="top-actions"><button class="ghost icon" data-act="new" title="New chat" aria-label="New chat">${icon('plus',18)}</button><button class="ghost icon bell" data-act="inbox" title="Notifications" aria-label="Notifications">${icon('bell',18)}<span class="bell-n"></span></button><button class="ghost icon" data-act="panel-full" title="Open the full aqeelOS in a tab" aria-label="Open the full aqeelOS">${icon('popout',17)}</button></div>`}
/* Calm banners at the top: agents nobody answers for (a box with several agents whose engine came up serving only one),
   then low memory / disk / out-of-memory restarts, most severe first. Dismissing hides that one incident for this browser
   tab only: an engine restart (new boot), a worse level, or the same trouble coming back after it cleared shows it again,
   and hiding the worst one lets the next one show. */
const BannerOff={get(){try{const l=JSON.parse(sessionStorage.getItem('hui-bannerOff')||'[]');return Array.isArray(l)?l:[]}catch{return []}},set(l){try{sessionStorage.setItem('hui-bannerOff',JSON.stringify(l.slice(-20)))}catch{}},add(k){const l=this.get();if(!l.includes(k))this.set([...l,k])}};
function paintBanner(){const slot=$('#bannerSlot');if(!slot)return;const st=S.status||{};const rp=st.resource_pressure||st.resources||((st.memory||st.disk||S.box)?{memory:st.memory,disk:st.disk}:null);const list=[];let off=BannerOff.get();
 const mux=st.multiplex_standalone_reason;if(mux){const ad=S.me?.admin!==false,quiet=(st.profiles||[]).filter(n=>n!=='default').map(n=>ident(n).name);
  list.push({key:'mux:'+mux,msg:`<b>Only one agent is answering messages.</b> ${quiet.length?'Not answering: '+esc(quiet.join(', '))+'. ':''}${ad?'Run every agent from one engine to fix it.':'Ask the owner to fix it on System › Health.'} <small style="opacity:.75">Why: ${esc(String(mux).replace(/\bhermes\b/gi,'the engine'))}</small>`,btn:ad?`<button data-act="banner-mux">Fix on Health</button>`:''})}
 if(rp&&typeof rp==='object'){const d=rp.disk?.level||rp.disk?.pressure||rp.disk_level,m=S.box?.memory?.level||rp.memory?.level||rp.memory?.pressure||rp.memory_level,oom=rp.oom_restart||rp.suspected_oom||rp.memory?.last_boot_suspected_oom;
  // back to normal: dismissals of that kind belong to an episode that is over, so the next one shows
  const n0=off.length;if(m==='ok')off=off.filter(k=>!k.startsWith('mem-'));if(d==='ok')off=off.filter(k=>!k.startsWith('disk-'));if(off.length!==n0)BannerOff.set(off);
  const mb=rp.disk?.free_mb??st.disk?.free_mb,free=mb!=null?' ('+bytes(Math.round(mb*1e6))+' free)':'',boot=st.memory?.boot_id||rp.memory?.boot_id||st.gateway_pid||'';const at=k=>k+':'+boot;
  if(d==='critical')list.push({key:at('disk-c'),msg:`<b>Disk is almost full${free}.</b> Free space on the AI box from System › Health.`});
  if(m==='critical')list.push({key:at('mem-c'),msg:'<b>aqeelOS is almost out of memory</b> and may restart.'});
  if(oom)list.push({key:at('oom'),msg:'<b>aqeelOS restarted unexpectedly</b>, most likely because it ran out of memory.'});
  if(d==='elevated')list.push({key:at('disk-e'),msg:`<b>Disk is getting full</b> on the AI box${free}.`});
  if(m==='elevated')list.push({key:at('mem-e'),msg:`<b>Memory is running low</b> on the AI box${S.box?.memory?.pct?' ('+S.box.memory.pct+'% of its '+bytes(S.box.memory.limit)+')':''}. See System › Health for what uses it.`})}
 const show=list.filter(x=>!off.includes(x.key)),res=show.find(x=>!x.key.startsWith('mux:'));
 const h=[show.find(x=>x.key.startsWith('mux:')),res].filter(Boolean).map(x=>`<div class="banner" role="alert">${icon('alert',16)}<span>${x.msg}</span>${x.btn||''}<button data-act="banner" data-key="${esc(x.key)}">Dismiss</button></div>`).join('');
 if(slot._h!==h){slot._h=h;slot.innerHTML=h}}
// what the engine is doing, in plain words (gateway_state); a live process that stopped checking in is "Not responding"
function gwState(s){if(!s)return {label:'Connecting…',c:'var(--ok)',say:''};const run=s.gateway_running,stale=s.gateway_heartbeat_stale_s;
 if(stale!=null)return {label:'Not responding',c:'var(--warn)',say:'Running, but it has not checked in for '+(stale<120?Math.round(stale)+' s':Math.round(stale/60)+' min')};
 const m={running:['Online','var(--ok)',''],starting:['Starting','var(--warn)','Starting up…'],startup_failed:['Could not start','var(--bad)','See System › Logs for why'],degraded:run?['Partly working','var(--warn)','Some channels are offline: see System › Logs']:['Stopped','var(--bad)','A safety check stopped it because it hung: see System › Logs'],stopped:['Offline','var(--bad)','Chats and channels are off']}[s.gateway_state];
 const [label,c,say]=m&&(run||s.gateway_state!=='running')?m:run?['Online','var(--ok)','']:['Offline','var(--bad)',''];return {label,c,say}}

/* ---------- page helpers ---------- */
function head(p,actions=''){return `<div class="page-head"><div><span class="eyebrow">${route().sec.label}</span><h1>${p.label}</h1><p>${p.desc||''}</p></div><div class="head-actions" style="display:flex;gap:8px;flex-wrap:wrap">${actions}</div></div>`}
function setActions(html){const a=$('.head-actions');if(!a)return;const vp=a.querySelector('.view-pick');a.innerHTML=html;if(vp)a.prepend(vp)}
function tabs(key,list,cur){cur=cur||S.tab[key]||list[0];return `<div class="tabs" data-tabs="${key}">${list.map(t=>`<button class="${t===cur?'on':''}" data-tab="${esc(t)}">${esc(t)}</button>`).join('')}<span class="pill"></span></div>`}
const toggle=(on,label,attrs='')=>`<input type="checkbox" class="switch" ${on?'checked':''} aria-label="${esc(label)}" ${attrs}>`;
const st=i=>`style="animation-delay:${Math.min(i,10)*30}ms"`;
const skeleton=()=>`<div class="skel loading" role="status" aria-label="Loading"><span class="ring"></span></div>`;
const skeletonRows=(n=4)=>`<div class="card list sk-list" style="padding:6px 22px">${Array.from({length:n},(x,i)=>`<div class="sk-item" style="--d:${i*90}ms"><span class="skel sk-ic"></span><span class="sk-lines"><span class="skel sk-l1" style="width:${[46,58,38,52,44,60][i%6]}%"></span><span class="skel sk-l2" style="width:${[72,64,80,68,76,58][i%6]}%"></span></span><span class="skel sk-end"></span></div>`).join('')}</div>`;
function showError(el,e,retry){if(!el||e?.stale||!el.isConnected)return;Oops.add('page','Couldn’t load this page: '+(e?.message||e));el.innerHTML=`<div class="card state-box err"><b>Couldn’t load this</b>${esc(e?.message||e)}<br><button data-act="reload">${icon('refresh',15)}Try again</button></div>`}
// who an account or connection is, said one way everywhere: the name you gave it (else the account's own name) · its
// handle (@bot, +phone, email); nothing known: the name agents use to pick it ("agents call it whatsapp")
const accountText=(a,{label='',id=''}={})=>{const h=a?a.phone||a.username||a.email||'':'',n=label||a?.name||'';return [n,h].filter(Boolean).join(' · ')||(id?'agents call it '+id:'')};
// a sign-in that has to be done again, said one way everywhere: the warn chip, and Sign in where the page has one
// (act: that button's data attributes); tip: what it is about, on hover; label: the button's word (Reconnect on Models)
const signChip=(act='',tip='',label='Sign in')=>`<span class="chip warn sign-chip"${tip?` title="${esc(tip)}"`:''}>Needs signing in again</span>${act?`<button class="link sign-go" ${act}>${esc(label)}</button>`:''}`;
// what this person may change on an agent, as users.mjs decides: admins every agent; members the agents they own, and
// the ones they may edit (for a right such as 'skills' or 'tools', only when their role has it)
const mayEdit=(a,cap)=>{const me=S.me||{},l=me.agents?.[a];return me.admin!==false||l==='owner'||l==='edit'&&(!cap||(me.caps||[]).includes(cap))};
// one soft warning box for every failed or incomplete part: icon, the message (html, already escaped) and a small
// Try again on the same line (wraps under when narrow); act:'' for none, id for a button a flow wires itself; attrs: more
// data attributes on that button (already escaped), icon: its icon
const alertBox=(html,{act='reload',id='',label='Try again',style='',cls='',attrs='',ic='refresh'}={})=>`<div class="alert${cls?' '+cls:''}" role="alert"${style?` style="${style}"`:''}>${icon('alert',16)}<span class="alert-t">${html}</span>${act||id?`<button class="ghost small"${id?` id="${id}"`:` data-act="${act}"`}${attrs?' '+attrs:''}>${icon(ic,14)}${esc(label)}</button>`:''}</div>`;
// each drawing of a page gets a number; work that ends after a newer drawing began is dropped (two quick reloads drew
// the Agents page twice, a slow Files answer replaced a newer folder). pageRun starts a drawing (render does, in runPage;
// a search box or a timer that redraws the page itself calls it first), pageTok joins the current one: every page and every
// layer wrapped round it takes const gone=pageTok(el) before its first await and stops after each await if gone()
const pageRun=el=>{const t=el._rt=(el._rt||0)+1;return ()=>el._rt!==t||!el.isConnected};
const pageTok=el=>{const t=el._rt;return ()=>el._rt!==t||!el.isConnected};
// a part of a page that failed to load: says what, with Try again (never drawn as an empty list)
const errLine=(what,style='',cls='')=>(Oops.add('page','Couldn’t load '+what),alertBox(`Couldn’t load ${esc(what)}.`,{style,cls}));
const emptyBox=(title,text,btn='')=>`<div class="empty-hero"><b style="display:block;font-size:17px;margin-bottom:6px">${esc(title)}</b><span style="color:var(--ink-2)">${esc(text)}</span>${btn?`<div style="margin-top:16px">${btn}</div>`:''}</div>`;
// Tab bars are often re-rendered on switch, so each bar remembers where its pill was and a fresh pill
// glides from there instead of appearing in place.
const pillAt={};
// a tab bar drawn while hidden (the phone's closed sidebar) is measured again as soon as it shows
const pillRO=typeof ResizeObserver==='function'?new ResizeObserver(()=>requestAnimationFrame(placePills)):null;
function placePills(){$$('.tabs').forEach(t=>{if(pillRO&&!t._ro){t._ro=1;pillRO.observe(t)}const on=t.querySelector('button.on'),pill=t.querySelector('.pill');if(!on||!pill||!on.offsetWidth)return;
 const key=t.dataset.tabs||'',to={left:on.offsetLeft,width:on.offsetWidth},from=pillAt[key];
 if(!pill.style.left&&from&&(from.left!==to.left||from.width!==to.width)){pill.style.transition='none';pill.style.left=from.left+'px';pill.style.width=from.width+'px';pill.offsetWidth;pill.style.transition=''}
 pill.style.left=to.left+'px';pill.style.width=to.width+'px';pillAt[key]=to})}

/* ---------- floating layers ---------- */
/* Closing a layer: it eases out first. Opening a replacement (another drawer, the palette) removes the old one at
   once and keeps the dimmed background as it is, so nothing flashes. Reduced motion: gone at once. */
const calm=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function leave(e,ms=200){if(!e?.isConnected)return;if(calm()){e.remove();return}if(e.classList.contains('closing'))return;e.classList.add('closing');e.style.pointerEvents='none';setTimeout(()=>e.remove(),ms)}
// a pop-up remembers what had focus when it opened (a replacement keeps the first one's), and closing gives focus back to it
const Layer={back:null};
function closeLayers(animate=true,{keepScrim=false}={}){const back=animate?document.querySelector('.drawer:not(.closing)')?._back:null;
 document.querySelectorAll('.scrim,.palette,.drawer,.menu').forEach(e=>{if(keepScrim&&e.classList.contains('scrim')&&!e.classList.contains('closing'))return;animate?leave(e,e.classList.contains('menu')?150:210):e.remove()});
 if(back)setTimeout(()=>{if(back.isConnected&&!document.querySelector('.drawer:not(.closing),.palette:not(.closing)')&&(!document.activeElement||document.activeElement===document.body||!document.activeElement.isConnected||document.activeElement.closest('.drawer')))try{back.focus({preventScroll:true})}catch{}},0)}
const openLayer=()=>{const had=document.querySelector('.scrim:not(.closing)'),open=document.querySelector('.drawer:not(.closing)'),a=document.activeElement;
 Layer.back=open?open._back||null:a&&a!==document.body&&!a.closest('.drawer,.palette,.menu')?a:null;closeLayers(false,{keepScrim:true});if(!had)scrim()};
function toast(msg,kind){if(kind==='err')Oops.add('toast',msg);const t=document.createElement('div');t.className='toast';t.innerHTML=icon(kind==='err'?'alert':'check',15)+esc(msg);$('#toasts').append(t);setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),260)},kind==='err'?6000:2800)}
const fail=e=>{if(e?.stale)return;if(e?.status!==401)toast(e?.message||String(e),'err')};
// copying works without the clipboard API too (plain http, older browsers): a hidden text box is copied instead
async function copyText(text,done='Copied'){text=String(text??'');let ok=false;try{if(navigator.clipboard&&isSecureContext){await navigator.clipboard.writeText(text);ok=true}}catch{}
 if(!ok){const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;top:-1000px;opacity:0';document.body.append(ta);ta.select();try{ok=document.execCommand('copy')}catch{}ta.remove()}
 if(done)toast(ok?done:"Couldn't copy. Select the text and copy it yourself.",ok?undefined:'err');return ok}
function scrim(){const s=document.createElement('div');s.className='scrim';s.onclick=closeLayers;document.body.append(s)}
// Pop-ups open in the middle with rounded corners (small for a question, larger for an editor); the side panel
// stays only where the page beside it matters (sideDrawer: Link WhatsApp, Use my browser).
function drawer(title,body,foot='',opt={}){openLayer();const d=document.createElement('div');const size=opt.size||(/<textarea|data-big/.test(body)||/schedule|SOUL|config.yaml|Shell hooks|MCP server|identity/i.test(title)?'lg':String(body).length<700?'sm':'md');d.className=opt.side?'drawer':'drawer pop '+size;d.setAttribute('role','dialog');d.setAttribute('aria-label',title);d.innerHTML=`<div class="drawer-head"><h2>${esc(title)}</h2><button class="ghost icon" data-act="close" aria-label="Close">${icon('x',18)}</button></div><div class="drawer-body">${body}</div>${foot?`<div class="drawer-foot">${foot}</div>`:''}`;d._back=Layer.back;document.body.append(d);trapTab(d);setTimeout(()=>d.querySelector('input:not([type=checkbox]),textarea,select')?.focus(),30);return d}
// Tab and Shift+Tab go round inside an open panel instead of reaching the page behind it
function trapTab(el){el.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const f=[...el.querySelectorAll('button,input,select,textarea,[tabindex]')].filter(x=>!x.disabled&&x.offsetParent&&x.tabIndex>=0);if(!f.length)return;const i=f.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus()}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus()}})}
// opt.html: content of its own instead of items (the date grid), wired by opt.onOpen(menu) once it is placed
function menu(anchor,items,opt={}){$$('.menu').forEach(e=>e.remove());const m=document.createElement('div');m.className='menu';m.setAttribute('role','menu');const list=items.filter(Boolean);
 m.innerHTML=opt.html||list.map((i,ix)=>i==='-'?'<hr>':i.header?`<div class="mh"${i.title?` title="${esc(i.title)}"`:''}>${esc(i.header)}</div>`:`<button class="item ${i.bad?'bad':''} ${i.on?'cur':''}" role="menuitem" data-mi="${ix}" ${i.disabled?'disabled':''}${i.title?` title="${esc(i.title)}"`:''}${i.find?` data-find="${esc(String(i.find).toLowerCase())}"`:''}>${i.ava||(i.icon?icon(i.icon,16):'')}<span class="t"><span class="mi-l">${esc(i.label)}</span>${i.sub?`<small class="mi-sub">${esc(i.sub)}</small>`:''}</span>${i.on?`<span style="color:var(--blue)">${icon('check',15)}</span>`:''}${i.kbd?`<small style="margin-left:auto;color:var(--muted)">${esc(i.kbd)}</small>`:''}</button>`).join('');
 // long lists get a search box that narrows the items as you type (Enter picks the first one left); the letters found are marked
 if(opt.search){m.insertAdjacentHTML('afterbegin',`<div class="mi-find">${icon('search',14)}<input placeholder="Search" aria-label="Search the list"></div>`);const inp=m.querySelector('.mi-find input');
  inp.oninput=()=>{const q=inp.value.trim().toLowerCase();$$('button.item',m).forEach(b=>{const l=b.querySelector('.mi-l'),txt=l?l.textContent:'';b.hidden=!!q&&!(b.textContent.toLowerCase().includes(q)||(b.dataset.find||'').includes(q));
   if(l){const at=q?txt.toLowerCase().indexOf(q):-1;l.innerHTML=at<0?esc(txt):esc(txt.slice(0,at))+'<mark>'+esc(txt.slice(at,at+q.length))+'</mark>'+esc(txt.slice(at+q.length))}});$$('.mh,hr',m).forEach(x=>x.hidden=!!q)};
  inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$$('button.item',m).find(b=>!b.hidden)?.click()}if(e.key==='ArrowDown'){e.preventDefault();$$('button.item',m).find(b=>!b.hidden)?.focus()}}}
 if(opt.matchWidth)m.style.minWidth=Math.max(220,anchor.offsetWidth)+'px';document.body.append(m);
 const r=anchor.getBoundingClientRect(),w=m.offsetWidth;let h=m.offsetHeight;let x=Math.min(r.left,innerWidth-w-12),y=r.bottom+6;const below=innerHeight-r.bottom-18,above=r.top-18;if(h>below&&above>below){m.style.maxHeight=Math.min(h,above)+'px';h=m.offsetHeight;y=r.top-h-6}else m.style.maxHeight=Math.max(160,below)+'px';m.style.left=Math.max(12,x)+'px';m.style.top=Math.max(12,y)+'px';
 m.onclick=e=>{const b=e.target.closest('[data-mi]');if(!b)return;const it=list[+b.dataset.mi];leave(m,150);it?.run?.();opt.onClose?.()};
 m.onkeydown=e=>{const bs=$$('button.item:not([disabled])',m);const i=bs.indexOf(document.activeElement);if(e.key==='ArrowDown'){e.preventDefault();bs[Math.min(i+1,bs.length-1)]?.focus()}if(e.key==='ArrowUp'){e.preventDefault();bs[Math.max(i-1,0)]?.focus()}if(e.key==='Escape'){e.stopPropagation();leave(m,150);anchor.focus();opt.onClose?.()}if(e.key==='Tab')leave(m,150)};
 (m.querySelector('.mi-find input')||m.querySelector('.cur')||m.querySelector('button.item'))?.focus();m.querySelector('.cur')?.scrollIntoView({block:'nearest'});opt.onOpen?.(m)}

/* ---------- brand dropdowns: every <select> becomes an Elkiya menu button ---------- */
function enhanceSelect(sel){if(sel.dataset.enhanced||sel.multiple)return;sel.dataset.enhanced='1';
 const btn=document.createElement('button');btn.type='button';btn.className='sel-btn'+(sel.style.width==='auto'?' inline':'');btn.setAttribute('aria-haspopup','listbox');if(sel.id)btn.dataset.for=sel.id;if(sel.getAttribute('aria-label'))btn.setAttribute('aria-label',sel.getAttribute('aria-label'));
 const sync=()=>{const o=sel.options[sel.selectedIndex];btn.innerHTML=`<span class="sv">${esc(o?o.textContent:'Choose…')}</span>${icon('chevD',15)}`;btn.disabled=sel.disabled};sync();
 sel.classList.add('sel-native');sel.tabIndex=-1;sel.setAttribute('aria-hidden','true');sel.after(btn);
 sel.addEventListener('change',sync);sel._sync=sync;
 // set from code (a cancelled or failed change put back, a picker held while saving): the button follows at once
 for(const k of ['value','selectedIndex','disabled']){const pd=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,k);if(pd?.set)Object.defineProperty(sel,k,{configurable:true,get(){return pd.get.call(this)},set(v){pd.set.call(this,v);sync()}})}
 btn.onclick=e=>{e.stopPropagation();const items=[];let grp=null;for(const o of sel.options){const g=o.parentElement.tagName==='OPTGROUP'?o.parentElement.label:null;if(g!==grp){grp=g;if(g)items.push({header:g})}items.push({label:o.textContent,on:o.selected,disabled:o.disabled,run:()=>{if(sel.value===o.value)return;sel.value=o.value;sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}))}})}
  btn.classList.add('open');menu(btn,items,{matchWidth:true,search:sel.options.length>12,onClose:()=>{btn.classList.remove('open');btn.focus()}});const obs=new MutationObserver(()=>{if(!$('.menu')){btn.classList.remove('open');obs.disconnect()}});obs.observe(document.body,{childList:true})};
 btn.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();btn.click()}}}
new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes){if(n.nodeType!==1)continue;if(n.tagName==='SELECT')enhanceSelect(n);else n.querySelectorAll?.('select').forEach(enhanceSelect)}}).observe(document.documentElement,{childList:true,subtree:true});
/* ---------- time and date: the app's own pickers, never the browser's. Values stay what the code sends: "HH:MM",
   "YYYY-MM-DD", and "YYYY-MM-DDTHH:MM" for both together (what datetime-local gave). ---------- */
const pad2=n=>String(n).padStart(2,'0');
// typed times tidied: "8" "830" "8.5" "20:15" → "08:00" "08:30" "08:05" "20:15"; '' when it is not a time
const timeNorm=v=>{v=String(v||'').trim();const m=/^(\d{1,2})(?:[:.hH ](\d{1,2}))?$/.exec(v)||/^(\d{1,2})(\d{2})$/.exec(v);if(!m)return '';const h=+m[1],mi=+(m[2]||0);return h<24&&mi<60?pad2(h)+':'+pad2(mi):''};
// a time field: type it, or pick from the 5-minute slots (searchable: "830" finds 08:30); Alt+Down or the clock opens them
function timePick(inp,step=5){if(inp.dataset.picked)return;inp.dataset.picked='1';inp.type='text';inp.inputMode='numeric';inp.autocomplete='off';if(!inp.placeholder)inp.placeholder='08:00';
 const wrap=document.createElement('span');wrap.className='tp-wrap';inp.before(wrap);wrap.append(inp);
 const b=document.createElement('button');b.type='button';b.className='ghost icon tp-btn';b.setAttribute('aria-label','Pick a time');b.setAttribute('aria-haspopup','listbox');b.innerHTML=icon('clock',15);wrap.append(b);
 const set=v=>{if(v===inp.value)return;inp.value=v;inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}))};
 const open=()=>{const cur=timeNorm(inp.value),items=[];for(let t=0;t<1440;t+=step){const v=pad2(t/60|0)+':'+pad2(t%60);items.push({label:v,on:v===cur,find:v.replace(':','')+' '+(t/60|0)+':'+pad2(t%60),run:()=>{set(v);last=v}})}
  if(cur&&!items.some(i=>i.on))items.unshift({label:cur,on:true,run:()=>{}});wrap.classList.add('open');menu(wrap,items,{search:true,matchWidth:true,onClose:()=>{wrap.classList.remove('open');inp.focus()}});
  // closed by an outside click or Tab too: the field stops looking open
  const m=$('.menu'),obs=new MutationObserver(()=>{if(!m?.isConnected){wrap.classList.remove('open');obs.disconnect()}});obs.observe(document.body,{childList:true})};
 b.onclick=e=>{e.stopPropagation();open()};inp.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&e.altKey){e.preventDefault();open()}});
 // typed: tidied when you leave the field; something that is not a time goes back to the last good one
 let last=timeNorm(inp.value)||inp.value;inp.addEventListener('blur',()=>{const v=timeNorm(inp.value);if(v){last=v;if(v!==inp.value)set(v)}else if(inp.value!==last){set(last);toast('Type a time like 08:30','err')}})}
// a small month grid in a menu: arrows move by day and week (into the next month too), Enter picks, Escape closes
function datePop(anchor,cur,pick){const today=new Date(),ymd=d=>d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());let view=cur?new Date(cur+'T00:00'):today;if(isNaN(view))view=today;view=new Date(view.getFullYear(),view.getMonth(),1);
 const grid=()=>{const start=new Date(view.getFullYear(),view.getMonth(),1-(view.getDay()+6)%7),t=ymd(today);   // always six weeks: the grid never changes size
  return `<div class="dp-head"><button type="button" class="ghost icon" data-dp="-1" aria-label="Previous month">${icon('chevL',16)}</button><b>${esc(view.toLocaleDateString([],{month:'long',year:'numeric'}))}</b><button type="button" class="ghost icon" data-dp="1" aria-label="Next month">${icon('chevR',16)}</button></div>
   <div class="dp-grid" role="grid">${['Mo','Tu','We','Th','Fr','Sa','Su'].map(w=>`<span class="dp-w">${w}</span>`).join('')}${Array.from({length:42},(_,i)=>{const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i),v=ymd(d);return `<button type="button" class="dp-d${d.getMonth()!==view.getMonth()?' out':''}${v===t?' today':''}${v===cur?' cur':''}" data-day="${v}" tabindex="-1" aria-label="${esc(d.toLocaleDateString([],{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}"${v===cur?' aria-selected="true"':''}>${d.getDate()}</button>`}).join('')}</div>`};
 const focus=(m,v)=>{const b=m.querySelector(`[data-day="${v}"]`)||m.querySelector('.dp-d.cur:not(.out)')||m.querySelector('.dp-d.today:not(.out)')||m.querySelector('.dp-d:not(.out)');if(b){b.tabIndex=0;b.focus()}};
 menu(anchor,[],{html:grid(),onOpen:m=>{m.classList.add('date-menu');m.setAttribute('role','dialog');m.setAttribute('aria-label','Pick a day');focus(m);
  const paint=v=>{m.innerHTML=grid();focus(m,v)};
  m.onclick=e=>{e.stopPropagation();const n=e.target.closest('[data-dp]'),d=e.target.closest('[data-day]');if(n){view=new Date(view.getFullYear(),view.getMonth()+ +n.dataset.dp,1);paint()}else if(d){leave(m,150);pick(d.dataset.day);anchor.focus()}};
  m.addEventListener('keydown',e=>{const d=e.target.closest?.('[data-day]');if(!d)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();d.click();return}
   const mv={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];if(!mv)return;e.preventDefault();e.stopPropagation();const x=new Date(d.dataset.day+'T00:00');x.setDate(x.getDate()+mv);const v=ymd(x);
   if(x.getMonth()!==view.getMonth()||x.getFullYear()!==view.getFullYear()){view=new Date(x.getFullYear(),x.getMonth(),1);paint(v)}else focus(m,v)},true)}})}
// a day and a time together (the field keeps "YYYY-MM-DDTHH:MM" and tells the form when it changes)
function dateTimePick(inp){if(inp.dataset.picked)return;inp.dataset.picked='1';inp.type='hidden';const [d0,t0]=String(inp.value||'').split('T');let day=d0||'',time=timeNorm(t0)||'09:00';
 const box=document.createElement('span');box.className='dtp';inp.after(box);box.innerHTML=`<button type="button" class="sel-btn dtp-day" aria-haspopup="dialog" aria-label="Day"><span class="sv"></span>${icon('chevD',15)}</button><input class="dtp-time" value="${esc(time)}" aria-label="Time">`;
 const db=box.querySelector('.dtp-day'),ti=box.querySelector('.dtp-time');
 const label=()=>{const d=day&&new Date(day+'T00:00');db.querySelector('.sv').textContent=d&&!isNaN(d)?d.toLocaleDateString([],{weekday:'short',day:'numeric',month:'short',year:'numeric'}):'Pick a day'};
 const push=()=>{inp.value=day+'T'+time;inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}))};
 for(const ev of ['input','change'])ti.addEventListener(ev,e=>{e.stopPropagation();const v=timeNorm(ti.value);if(v&&v!==time){time=v;push()}});
 timePick(ti);label();db.onclick=e=>{e.stopPropagation();db.classList.add('open');datePop(db,day,v=>{day=v;label();push()})};
 new MutationObserver((r,o)=>{if(!db.isConnected)return o.disconnect();if(!$('.date-menu'))db.classList.remove('open')}).observe(document.body,{childList:true})}
// fields drawn with data-pick="time" / "datetime" become these pickers, like every <select> becomes a menu
new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes){if(n.nodeType!==1)continue;for(const i of [n,...(n.querySelectorAll?.('input[data-pick]')||[])])if(i.tagName==='INPUT'&&i.dataset.pick)(i.dataset.pick==='datetime'?dateTimePick:timePick)(i)}}).observe(document.documentElement,{childList:true,subtree:true});
const sideDrawer=(t,b,f)=>drawer(t,b,f,{side:true});
// A question on top of whatever is open (an editor keeps its edits when you answer or cancel), closing only itself.
// The text is shown as plain text: names people chose can never turn into markup.
function stackPop(title,body,foot){const sc=document.createElement('div');sc.className='scrim stack';const d=document.createElement('div');d.className='drawer pop sm stack';d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.setAttribute('aria-label',title);
 d.innerHTML=`<div class="drawer-head"><h2>${esc(title)}</h2><button class="ghost icon" data-x aria-label="Close">${icon('x',18)}</button></div><div class="drawer-body">${body}</div><div class="drawer-foot">${foot}</div>`;
 const back=document.activeElement;document.body.append(sc,d);let done=false;
 const close=()=>{if(done)return;done=true;document.removeEventListener('keydown',key,true);leave(d,200);leave(sc,200);try{back?.focus?.()}catch{}};
 const key=e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();d.dispatchEvent(new Event('cancel'));close()}
  if(e.key==='Tab'){const f=[...d.querySelectorAll('button,input,select,textarea,[tabindex]')].filter(x=>!x.disabled&&x.offsetParent);if(!f.length)return;const i=f.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus()}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus()}}};
 document.addEventListener('keydown',key,true);sc.onclick=()=>{d.dispatchEvent(new Event('cancel'));close()};d.querySelectorAll('[data-x]').forEach(b=>b.onclick=e=>{e.stopPropagation();d.dispatchEvent(new Event('cancel'));close()});
 return {d,close}}
const plainText=t=>{const x=document.createElement('template');x.innerHTML=String(t??'');return x.content.textContent};
function confirmBox(title,text,okLabel='Delete',danger=true){return new Promise(res=>{const {d,close}=stackPop(title,'<p style="margin:0;color:var(--ink-2);line-height:1.55"></p>',`<button class="ghost" data-x>Cancel</button><button class="primary" id="cfm-ok" ${danger?'style="background:var(--bad);box-shadow:none"':''}>${esc(okLabel)}</button>`);
 d.querySelector('p').textContent=plainText(text);const ok=d.querySelector('#cfm-ok');ok.onclick=e=>{e.stopPropagation();close();res(true)};d.addEventListener('cancel',()=>res(false));d.querySelectorAll('[data-x]').forEach(b=>b.addEventListener('click',()=>res(false)));setTimeout(()=>ok.focus(),30)})}
// type 'password' asks for a password (current-password autofill, nothing shown)
function promptBox(title,label,value='',okLabel='Save',type='text'){return new Promise(res=>{const {d,close}=stackPop(title,`<label>${esc(label)}</label><input id="pb-in"${type==='password'?' type="password" autocomplete="current-password"':type==='secret'?' type="password" autocomplete="new-password" spellcheck="false"':''}>`,`<button class="ghost" data-x>Cancel</button><button class="primary" id="pb-ok">${esc(okLabel)}</button>`);
 const inp=d.querySelector('#pb-in');inp.value=value;const ok=()=>{const v=inp.value;close();res(v)};d.querySelector('#pb-ok').onclick=e=>{e.stopPropagation();ok()};inp.onkeydown=e=>{if(e.key==='Enter')ok()};d.addEventListener('cancel',()=>res(null));d.querySelectorAll('[data-x]').forEach(b=>b.addEventListener('click',()=>res(null)));setTimeout(()=>{inp.focus();inp.select()},30)})}
// Live log of a Hermes background action in a drawer.
// Long tasks show their steps: the current one turns, finished ones tick, a failed one says why, and the time so far
// shows after a few seconds. progressView(box,['Making it','Setting it up',…]) → {doing(i,note),done(i,note),fail(i,msg),end()}
function progressView(box,steps){box.innerHTML=`<div class="prog" role="status" aria-live="polite"><ol>${steps.map((s,i)=>`<li data-i="${i}" class="wait"><span class="pi" aria-hidden="true"></span><div><b>${esc(s)}</b><small></small></div></li>`).join('')}</ol><p class="prog-time"></p></div>`;
 const t0=Date.now(),li=i=>box.querySelector(`.prog li[data-i="${i}"]`);
 const tm=setInterval(()=>{const el=box.querySelector('.prog-time');if(!el||!el.isConnected)return clearInterval(tm);const s=Math.round((Date.now()-t0)/1000);el.textContent=s<4?'':'Working for '+(s<60?s+' s':Math.floor(s/60)+' min '+(s%60)+' s')+'…'},1000);
 const set=(i,c,note)=>{const e=li(i);if(!e)return;e.className=c;if(note!=null)e.querySelector('small').textContent=note};
 return {doing:(i,n)=>set(i,'doing',n),done:(i,n)=>set(i,'done',n),fail:(i,m)=>set(i,'fail',m),end(){clearInterval(tm);const el=box.querySelector('.prog-time');if(el){const s=Math.round((Date.now()-t0)/1000);el.textContent=s>=4?'Took '+(s<60?s+' s':Math.floor(s/60)+' min '+(s%60)+' s'):''}}}}
function actionDrawer(title,name){const d=drawer(title,`<div class="prog-head"><span class="spinner tiny"></span><b>Working…</b><span class="hint"></span></div><div class="action-log" id="alog">Starting…</div>`,`<button class="primary" data-act="close">Done</button>`);const t0=Date.now();
 const tick=setInterval(()=>{const h=d.querySelector('.prog-head .hint');if(!h||!h.isConnected)return clearInterval(tick);const s=Math.round((Date.now()-t0)/1000);h.textContent=s<4?'':s<60?s+' s':Math.floor(s/60)+' min '+(s%60)+' s'},1000);
 return followAction(name,(lines,done,code)=>{const el=d.querySelector('#alog');if(!el)return;el.textContent=(lines.join('').trim()||'(no output yet)')+(done?'\n\n'+(code===0||code==null?'✓ Finished':'✕ Exited with code '+code):'');el.scrollTop=el.scrollHeight;
  if(done){clearInterval(tick);const h=d.querySelector('.prog-head');if(h){const ok=code===0||code==null;h.classList.add(ok?'ok':'bad');h.querySelector('.spinner')?.remove();h.querySelector('b').textContent=ok?'Finished':'Stopped with an error'}}})}
async function runAction(title,path,body){try{const r=await post(H,path,body);if(r?.ok===false)throw new Error(r.error||r.message||'Failed');if(r?.name)actionDrawer(title,r.name);else toast(title+' done');return r}catch(e){fail(e)}}

function palette(){openLayer();const p=document.createElement('div');p.className='palette';p.setAttribute('role','dialog');p.setAttribute('aria-label','Search and commands');
 const actions=[{g:'Actions',l:'New chat',ic:'plus',run:()=>Chat.newChat()},{g:'Actions',l:'Restart agents',ic:'refresh',run:()=>restartGateway()},{g:'Actions',l:'Use my browser (set up the extension)',ic:'globe',run:()=>BrowserSetup.open()},{g:'Actions',l:'Toggle light / dark',ic:'moon',run:()=>theme()},{g:'Actions',l:'Check for updates',ic:'download',run:()=>{go('/system/health');const t=setInterval(()=>{const b=document.querySelector('[data-act="upd-check"]');if(b){clearInterval(t);b.click()}},400);setTimeout(()=>clearInterval(t),15000)}},{g:'Actions',l:'Sign out',ic:'logout',run:()=>signOut()},{g:'Actions',l:'Sign out on every device',ic:'logout',run:()=>signOutAll()}];
 const models=(Chat.models||[]).slice(0,12).map(m=>({g:'Switch model',l:m.label+' · '+m.providerName,ic:'cpu',run:()=>Chat.setModel(m)}));
 const pages=SECTIONS.flatMap(s=>s.pages?s.pages.filter(x=>!x.hidden).map(x=>({g:'Pages',l:s.label+' › '+x.label,ic:x.icon,run:()=>go('/'+s.id+'/'+x.id)})):s.id==='chat'?[{g:'Pages',l:'Chat',ic:'chat',run:()=>go('/chat')},{g:'Pages',l:'Chat › Manage chats',ic:'list',run:()=>go('/chat/manage')}]:[{g:'Pages',l:s.label,ic:s.icon,run:()=>go('/'+s.id)}]);
 const chats=S.sessions.slice(0,60).map(c=>({g:'Chats',l:c.title||c.preview||c.id,ic:srcIcon(c.source),run:()=>go('/chat/'+c.id)}));
 const all=[...actions,...pages,...models,...chats];let sel=0,list=all,remote=[];
 p.innerHTML=`<div class="p-in">${icon('search',18)}<input placeholder="Search pages, chats, skills or run a command" aria-label="Search"></div><div class="p-list"></div><div class="p-foot"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>`;document.body.append(p);trapTab(p);
 const inp=p.querySelector('input'),box=p.querySelector('.p-list');
 // only 50 are shown, so moving and Enter use the same 50 (room is kept for skill and inside-chat hits)
 const items=()=>[...list.slice(0,50-remote.length),...remote];
 const paint=()=>{const L=items();let g='',h='';L.forEach((it,i)=>{if(it.g!==g){g=it.g;h+=`<div class="p-group">${esc(g)}</div>`}h+=`<button class="item ${i===sel?'sel':''}" data-i="${i}">${icon(it.ic,16)}<span class="t">${esc(it.l)}</span>${it.sub?`<small style="margin-left:auto;color:var(--muted);font-weight:400">${esc(it.sub)}</small>`:''}</button>`});box.innerHTML=h||'<p style="padding:20px;color:var(--muted);text-align:center">Nothing found</p>';box.querySelector('.sel')?.scrollIntoView({block:'nearest'})};
 let t;inp.oninput=()=>{const q=inp.value.toLowerCase().trim();list=q?all.filter(x=>x.l.toLowerCase().includes(q)):all;sel=0;remote=[];paint();clearTimeout(t);
  if(q.length>=2)t=setTimeout(async()=>{try{const [sk,found]=await Promise.all([Pages.skillsCache(),H('/sessions/search'+qp({q})).catch(()=>null)]);if(inp.value.toLowerCase().trim()!==q)return;remote=[...sk.filter(s=>(s.name+' '+(s.description||'')).toLowerCase().includes(q)).slice(0,6).map(s=>({g:'Skills',l:s.name,sub:s.category,ic:'sparkle',run:()=>{go('/abilities/skills');setTimeout(()=>Pages.openSkill(s.name),300)}})),...((found?.results||found?.sessions||[]).slice(0,8).map(r=>({g:'Inside chats',l:r.title||r.session_title||noThink(r.snippet).replace(/>>>|<<</g,'')||r.session_id,sub:ago(r.last_active||r.timestamp),ic:'search',run:()=>{S.chatHit={id:r.session_id||r.id,q};go('/chat/'+(r.session_id||r.id))}})))];paint()}catch{}},250)};
 inp.onkeydown=e=>{const L=items();if(e.key==='ArrowDown'){sel=Math.min(sel+1,L.length-1);paint();e.preventDefault()}if(e.key==='ArrowUp'){sel=Math.max(sel-1,0);paint();e.preventDefault()}if(e.key==='Enter'){const it=L[sel];closeLayers();it?.run()}};
 box.onclick=e=>{const b=e.target.closest('[data-i]');if(!b)return;const it=items()[+b.dataset.i];closeLayers();it.run()};paint();inp.focus()}
function theme(){const d=document.documentElement.classList.toggle('dark');try{localStorage.setItem('hui-theme',d?'dark':'light')}catch{};const tb=$('.topbar');if(tb)paintTop()}
// a running engine is restarted only after you saw which agents it interrupts (all of them, when they share one engine)
async function restartGateway(){try{const s=await H('/status',{keep:true,fresh:true}).catch(()=>S.status);if(s)S.status=s;
 if(s?.gateway_running){const shared=[...new Set((s.gateway_shared_with||[]).map(n=>String(n).trim()).filter(Boolean))].sort((a,b)=>a==='default'?-1:b==='default'?1:a.localeCompare(b));const wait=' Replies in progress finish first'+(s.active_agents>0?', and so does the work '+(s.active_agents===1?'1 agent is':s.active_agents+' agents are')+' doing right now (this can take a while).':'.');
  const ok=shared.length>1?await confirmBox('Restart all agents?','They share one engine, so every one of them stops for about 25 seconds and its channels reconnect: '+shared.map(n=>ident(n).name).join(', ')+'.'+wait,'Restart all',false):await confirmBox('Restart the agents?','Chats and channels stop for about 25 seconds and reconnect by themselves.'+wait,'Restart',false);if(!ok)return}
 const r=await post(UI,'/ui/gateway/restart');const n=r?.waiting||0;
 toast(n?'Restarting the engine as soon as '+(n===1?'the reply in progress finishes':n+' replies in progress finish'):'Restarting the engine… back in about 25 seconds');setTimeout(()=>refreshStatus(),n?60000:26000)}catch(e){fail(e)}}
async function refreshStatus(){try{S.status=await H('/status',{fresh:true});if(S.me?.admin!==false)S.box=await UI('/ui/box').catch(()=>S.box);const r=route();if(!r.signin&&$('.side'))paintSide(r),paintBanner()}catch{}}

/* ---------- sign-in ---------- */
function signinHtml(){return `<div class="signin"><form class="card" id="signin"><span class="wordmark"><img class="mark" src="${Brand.mark()}" alt="">${esc(Brand.name)}</span><h1>Welcome back</h1><p>Sign in to aqeelOS.</p><label for="nm">Username</label><input id="nm" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="aqeel"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" placeholder="Your password"><p class="err" id="err" role="alert"></p><button class="primary" type="submit">Sign in</button><p class="foot">${icon('lock',13)} Private · ${esc(location.host)}</p></form></div>`}
function bindSignin(){const f=$('#signin');$('#nm').focus();f.onsubmit=async e=>{e.preventDefault();const pw=$('#pw').value;const err=$('#err');const shake=()=>{f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake')};if(!pw){err.textContent='Enter your password.';return shake()}
 const b=f.querySelector('button');b.disabled=true;try{const r=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('#nm').value.trim(),password:pw})});const d=await r.json().catch(()=>({}));if(!r.ok){err.textContent=d.error||'Sign-in failed.';shake();return}if(d.needCode){codeStep(f,d);return}S.signedIn=true;if(location.hash==='#/signin')location.hash='#/chat';await boot()}catch{err.textContent='Could not reach aqeelOS. Check your connection and try again.';shake()}finally{b.disabled=false}}}
// Two-step sign-in: the password was right, now the code from their email.
function codeStep(f,d){f.querySelector('h1').textContent='Check your email';f.querySelector('h1').nextElementSibling.textContent='We sent a 6-digit code to '+d.to+'. It may land in spam.';
 f.querySelectorAll('label,input').forEach(e=>e.hidden=true);const i=document.createElement('input');i.id='code';i.inputMode='numeric';i.autocomplete='one-time-code';i.placeholder='123456';i.maxLength=6;f.querySelector('#err').before(i);i.focus();
 f.onsubmit=async e=>{e.preventDefault();const err=$('#err'),b=f.querySelector('button');b.disabled=true;try{const r=await fetch('/auth/code',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:d.key,code:i.value})});const j=await r.json().catch(()=>({}));
  if(!r.ok){err.textContent=j.error||'That code is not right.';f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake');return}S.signedIn=true;if(location.hash==='#/signin')location.hash='#/chat';await boot()}catch{err.textContent='Could not reach aqeelOS. Check your connection and try again.';f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake')}finally{b.disabled=false}}}
function signedOut(){if(!S.signedIn)return;S.signedIn=false;location.href='/'}
async function signOut(){try{Prefs.clear()}catch{}await fetch('/auth/logout',{method:'POST'}).catch(()=>{});S.signedIn=false;location.href='/'}

/* Loading → loaded: wherever loading placeholders (.skel) are replaced, the new content fades and rises in,
   a little staggered, instead of snapping into place. Works for whole pages and for panels that load later. */
function watchReveal(root){if(!root||root._reveal)return;root._reveal=new MutationObserver(ms=>{for(const m of ms){
 // one loaded fade per visit to a page: the first content that arrives may fade in; later redraws never do
 {const key=location.hash.split('?')[0]+'#'+(S._nav||0);if(root._fadeKey!==key){root._fadeKey=key;root._fadeUntil=0}if(root._fadeUntil&&performance.now()>root._fadeUntil)continue}
 // what was on screen is noted, but its text is read only when something is about to fade in (reading every removed
 // block's text on every redraw cost about a second on Schedules)
 {const key=location.hash.split('?')[0];if(root._seenKey!==key){root._seenKey=key;root._seen=new Map();root._gone=[]}for(const r of m.removedNodes)if(r.nodeType===1&&!r.classList?.contains('skel'))(root._gone??=[]).push(r);if(root._gone.length>400)root._gone.splice(0,root._gone.length-400)}
 // only a page that was loading fades in: a block skeleton went away (small inline placeholders, such as a summary still
 // being written, do not count, or a later redraw would fade everything in again)
 if(![...m.removedNodes].some(n=>n.nodeType===1&&(n.classList?.contains('skel')&&!n.closest?.('.sched-desc')&&n.tagName!=='I'||n.classList?.contains('skel-row')||n.querySelector?.('div.skel,.skel.loading,.skel-row'))))continue;
 const sig=x=>(x.textContent||'').replace(/\s+/g,' ').trim().slice(0,80);root._seen??=new Map();
 {const key=location.hash.split('?')[0];if(root._seenKey!==key){root._seenKey=key;root._seen=new Map();root._gone=[]}}
 for(const r of root._gone||[]){const sg=sig(r);if(sg)root._seen.set(sg,1)}root._gone=[];
 // one layout for the whole batch (not one per element) restarts their fade
 const fade=[];for(const n of m.addedNodes)if(n.nodeType===1&&!/^(SELECT|SCRIPT|STYLE|TEMPLATE)$/.test(n.tagName)&&!n.hidden&&!n.classList.contains('skel')&&!n.classList.contains('sel-native')&&!n.querySelector?.('.skel')){const sg=sig(n);if(sg&&root._seen.has(sg))continue;if(sg)root._seen.set(sg,1);fade.push(n)}
 if(!fade.length)continue;if(!root._fadeUntil)root._fadeUntil=performance.now()+700;
 for(const n of fade)n.classList.remove('reveal');void root.offsetWidth;fade.forEach((n,i)=>{n.style.setProperty('--ri',i);n.classList.add('reveal')})}});
 root._reveal.observe(root,{childList:true,subtree:true})}
/* "0 3 * * 1" → "Mondays at 03:00": schedules in plain words (falls back to the original text) */
function cronText(expr){const s=String(expr||'').trim();const f=s.split(/\s+/);if(f.length!==5)return s;const [mi,ho,dom,mon,dow]=f;
 const DAYS=['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays','Sundays'],SHORT=['Sun','Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
 const MON=['','January','February','March','April','May','June','July','August','September','October','November','December'];
 const num=v=>/^\d+$/.test(v),pad=v=>String(v).padStart(2,'0');const ord=n=>n+(['th','st','nd','rd'][(n%100>10&&n%100<14)?0:n%10<4?n%10:0]||'th');
 const at=num(mi)&&num(ho)?'at '+pad(ho)+':'+pad(mi):num(mi)&&ho==='*'?'every hour at :'+pad(mi):/^\*\/\d+$/.test(mi)&&ho==='*'?'every '+mi.slice(2)+' minutes':/^\*\/\d+$/.test(ho)&&num(mi)?'every '+ho.slice(2)+' hours at :'+pad(mi):/^\*\/\d+$/.test(mi)&&/^\d+-\d+$/.test(ho)?'every '+mi.slice(2)+' minutes from '+pad(ho.split('-')[0])+':00 to '+pad(ho.split('-')[1])+':59':num(mi)&&/^[\d,]+$/.test(ho)?'at '+ho.split(',').map(h=>pad(h)+':'+pad(mi)).join(', '):null;
 if(!at)return s;
 const days=dow==='*'?null:/^\d$/.test(dow)?DAYS[+dow]:/^\d-\d$/.test(dow)?(dow==='1-5'?'Weekdays':SHORT[+dow[0]]+'–'+SHORT[+dow[2]]):/^[\d,]+$/.test(dow)?dow.split(',').map(d=>SHORT[+d]).join(', '):null;
 if(dow!=='*'&&!days)return s;
 const dates=dom==='*'?null:num(dom)?'the '+ord(+dom):/^\d+-\d+$/.test(dom)?'days '+dom.replace('-','–'):/^[\d,]+$/.test(dom)?'the '+dom.split(',').map(d=>ord(+d)).join(', '):null;
 if(dom!=='*'&&!dates)return s;
 const month=mon==='*'?null:num(mon)?MON[+mon]:null;if(mon!=='*'&&!month)return s;
 let out=days?days+' '+at:dates?(dates[0]==='d'?'Days '+dom.replace('-','–'):'On '+dates)+' of '+(month||'each month')+' '+at:month?'Every day in '+month+' '+at:/^every/.test(at)?at[0].toUpperCase()+at.slice(1):'Every day '+at;
 return out}
// a site without an icon: drop the broken picture so the plain link icon shows (inline onerror is blocked by the CSP)
document.addEventListener('error',e=>{if(e.target?.classList?.contains('lk-fav'))e.target.remove()},true);
// installed on a phone it behaves like an app: no pinch or double-tap zoom (iOS ignores user-scalable=no)
for(const ev of ['gesturestart','gesturechange'])document.addEventListener(ev,e=>e.preventDefault(),{passive:false});
document.addEventListener('touchmove',e=>{if(e.touches&&e.touches.length>1)e.preventDefault()},{passive:false});

// sign out everywhere (every browser and phone signed in as this person); in the account menu and the command palette
async function signOutAll(){if(!await confirmBox('Sign out everywhere?','Every browser and phone signed in as you is signed out, this one too.','Sign out everywhere'))return;try{await fetch('/auth/logout-all',{method:'POST',headers:{'x-hui':'1'}});location.href='/'}catch(e){fail(e)}}

addEventListener('unhandledrejection',e=>{if(e.reason?.stale)e.preventDefault()});
/* Background checks (bell, alerts, status): nothing is asked while the tab is hidden; when it comes back, each check
   that is due runs at once (due: not run for its own interval, or a minute for slow ones), so a quick tab flip doesn't
   fire them all again; one skipped before its first run (the tab opened hidden) runs on return too. first: the delay before the first run. */
const Poll={l:[],add(fn,ms,first){const e={fn,ms,at:0,run(){if(document.hidden){e.missed=true;return}e.missed=false;e.at=Date.now();try{Promise.resolve(fn()).catch(()=>{})}catch{}}};
  setInterval(()=>e.run(),ms);if(first!=null)setTimeout(()=>e.run(),first);this.l.push(e);return e}};
document.addEventListener('visibilitychange',()=>{if(document.hidden)return;const t=Date.now();for(const e of Poll.l)if(e.missed&&!e.at||e.at&&t-e.at>=Math.min(e.ms,60000))e.run()});   // missed: skipped while hidden before it ever ran
/* A new version is ready: after a deploy, an open tab offers Reload instead of quietly running the old version
   (the build number is in this page's script addresses and in /healthz). Checked every two minutes and on return. */
{const loaded=(document.querySelector('script[src*="/app/core.js"]')?.src.match(/[?&]v=(\d+)/)||[])[1];let shown=false;
 const check=async()=>{if(!loaded||shown||document.hidden)return;try{const h=await (await fetch('/healthz',{cache:'no-store'})).json();if(h.build&&String(h.build)!==loaded)show()}catch{}};
 const show=()=>{shown=true;const n=document.createElement('div');n.className='new-version';n.setAttribute('role','status');n.innerHTML='<span>A new version of '+esc(typeof Brand!=='undefined'?Brand.name:'aqeelOS')+' is ready.</span><button class="primary small" type="button">Reload</button><button class="ghost small" type="button" aria-label="Later">Later</button>';
  n.querySelector('.primary').onclick=()=>location.reload();n.querySelector('.ghost').onclick=()=>{n.classList.add('out');setTimeout(()=>n.remove(),200)};document.body.append(n)};
 Poll.add(check,120000,15000)}
