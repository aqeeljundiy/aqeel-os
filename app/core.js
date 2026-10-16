// Core of the real app: API access, routing, shell, floating layers and sign-in.
const $=(s,el=document)=>el.querySelector(s);
const $$=(s,el=document)=>[...el.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isMac=/Mac|iPhone|iPad/.test(navigator.platform);
const MOD=isMac?'⌘':'Ctrl';
const store={get(k,d){try{const v=localStorage.getItem('hui-'+k);return v===null?d:JSON.parse(v)}catch{return d}},set(k,v){try{localStorage.setItem('hui-'+k,JSON.stringify(v))}catch{}}};

/* ---------- API ---------- */
class ApiError extends Error{constructor(msg,status,data){super(msg);this.status=status;this.data=data}}
async function call(base,path,opt={}){
 const init={method:opt.method||'GET',headers:{'x-hui':'1',...(opt.headers||{})},credentials:'same-origin',signal:opt.signal};
 if(opt.body!==undefined){if(opt.body instanceof FormData)init.body=opt.body;else{init.body=JSON.stringify(opt.body);init.headers['content-type']='application/json'}}
 const r=await fetch(base+path,init);
 // Only this app's own server says "sign in again"; a 401 from Hermes itself is an ordinary error.
 if(r.status===401&&r.headers.get('x-hui-auth')==='required'){signedOut();throw new ApiError('Signed out',401)}
 if(opt.raw)return r;
 const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
 if(!r.ok){const d=data&&typeof data==='object'?data:{};if(Array.isArray(d.detail))d.detail=d.detail.map(x=>(x.loc?x.loc.slice(-1)[0]+': ':'')+(x.msg||'')).join('; ');const msg=d.detail?.message||d.detail||d.error?.message||d.error||d.message||('The server answered '+r.status);throw new ApiError(typeof msg==='string'?msg:JSON.stringify(msg),r.status,data)}
 return data;
}
// The active agent (Hermes profile): dashboard calls get ?profile=, gateway calls go through /p/<profile>/.
const agentProfile=()=>S.chOverride||(S.profile&&S.profile!=='default'?S.profile:'');   // chOverride: setting up an extra connection (WhatsApp 2…)
// Every dashboard call names its agent, the main one too: Hermes serves several agents from one backend
// and refuses some writes (e.g. deleting a webhook) that don't say which.
const withProfile=p=>{if(/[?&]profile=/.test(p))return p;return p+(p.includes('?')?'&':'?')+'profile='+encodeURIComponent(agentProfile()||'default')};
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
const bytes=n=>n==null?'—':n>=1e9?(n/1e9).toFixed(1)+' GB':n>=1e6?(n/1e6).toFixed(1)+' MB':n>=1e3?(n/1e3).toFixed(1)+' KB':n+' B';
const plural=(n,w)=>n+' '+w+(n===1?'':'s');
// Short provider names, the way people say them (Claude, ChatGPT…), not Hermes' plugin titles.
const provLabel=p=>{const s=String(p?.slug||p||''),n=String(p?.name||s);if(s==='moa')return 'Team of models';if(/claude-subscription|^claude-code/.test(s))return 'Claude';if(/codex/.test(s))return 'ChatGPT';if(s==='openrouter')return 'OpenRouter';if(/gemini/.test(s))return 'Gemini';return n.replace(/\s*\((experimental|beta)\)$/i,'')};
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

// Small, safe Markdown: paragraphs, lists, headings, bold, italics, inline code, fenced code, links, tables, quotes.
function md(src){
 // MEDIA:/path/picture.png (how agents hand over pictures they made) shows the picture itself
 src=String(src||'').replace(/(^|\s)MEDIA:\s*(\/[^\s)]+\.(?:png|jpe?g|gif|webp|bmp))/gi,(m,pre,p)=>pre+'![image](/ui/media?path='+encodeURIComponent(p)+')');
 const out=[];const lines=String(src||'').replace(/\r/g,'').split('\n');let i=0;
 // inline: code and images are lifted out first so nothing inside them gets rewritten
 const inline=t=>{const keep=[];const put=h=>'\u0000'+(keep.push(h)-1)+'\u0000';
  t=t.replace(/`([^`]+)`/g,(m,c)=>put('<code>'+esc(c)+'</code>'))
   .replace(/!\[([^\]]*)\]\(((?:data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+)|(?:https?:\/\/[^)\s]+)|(?:\/ui\/media\?path=[^)\s]+))\)/g,(m,alt,u)=>put(`<img class="md-img" src="${esc(u)}" alt="${esc(alt)}" loading="lazy">`));
  t=esc(t).replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/__([^_]+)__/g,'<b>$1</b>').replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g,'$1<i>$2</i>').replace(/~~([^~]+)~~/g,'<s>$1</s>')
   .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/(^|\s)(https?:\/\/[^\s<]+)/g,'$1<a href="$2" target="_blank" rel="noopener">$2</a>');
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
    const parent=stack[stack.length-1].node;const item={text:[l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/,'')],kids:[],ordered,task:null};
    const m=/^\[( |x|X)\]\s+/.exec(item.text[0]);if(m){item.task=m[1]!==' ';item.text[0]=item.text[0].slice(m[0].length)}
    parent.kids.push(item);stack.push({ind,node:item});i++;continue}
   if(indent(l)>=2&&stack.length>1){stack[stack.length-1].node.text.push(l.trim());i++;continue}
   break}
  const html=kids=>{if(!kids.length)return '';const tag=kids[0].ordered?'ol':'ul';
   return `<${tag}>${kids.map(k=>`<li${k.task!==null?' class="task"':''}>${k.task!==null?`<span class="tick ${k.task?'on':''}">${k.task?'✓':''}</span>`:''}${k.text.map(inline).join('<br>')}${html(k.kids)}</li>`).join('')}</${tag}>`};
  return html(root.kids)};
 while(i<lines.length){const l=lines[i];
  if(/^\s*```/.test(l)){const lang=l.trim().slice(3).trim();const buf=[];i++;while(i<lines.length&&!/^\s*```/.test(lines[i]))buf.push(lines[i++]);i++;out.push(`<div class="codeblock"><div class="cb-head"><span>${esc(lang||'code')}</span><button data-act="copycode">${icon('copy',13)}Copy</button></div><pre>${esc(buf.join('\n'))}</pre></div>`);continue}
  if(/^\s*$/.test(l)){i++;continue}
  if(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)){out.push('<hr>');i++;continue}
  // a clear heading scale like Claude / ChatGPT: # big, ## medium, ### small, deeper = bold line
  const h=/^(#{1,6})\s+(.*)$/.exec(l);if(h){const n=Math.min(h[1].length,4);out.push(`<h${n+1} class="md-h${n}">${inline(h[2])}</h${n+1}>`);i++;continue}
  if(isItem(l)){out.push(list());continue}
  if(/^\|.*\|\s*$/.test(l)&&/^\|[\s:|-]+\|\s*$/.test(lines[i+1]||'')){const row=r=>r.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());const head=row(l);i+=2;const body=[];while(i<lines.length&&/^\|.*\|\s*$/.test(lines[i]))body.push(row(lines[i++]));out.push(`<div class="table-wrap"><table><thead><tr>${head.map(h=>`<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);continue}
  if(/^>\s?/.test(l)){const b=[];while(i<lines.length&&/^>\s?/.test(lines[i]))b.push(lines[i++].replace(/^>\s?/,''));out.push('<blockquote>'+md(b.join('\n'))+'</blockquote>');continue}
  const p=[];while(i<lines.length&&!/^\s*$/.test(lines[i])&&!/^\s*```|^#{1,6}\s|^>\s?|^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])&&!(isItem(lines[i])&&p.length===0)&&!(isItem(lines[i])))p.push(inline(lines[i++]));out.push('<p>'+p.join('<br>')+'</p>');
 }
 return out.join('');
}

/* ---------- agent identity (name, title, picture per profile) ---------- */
function ident(p=S.profile||'default'){const i=S.identities[p]||{};return {name:i.name||(p==='default'?'aqeelOS':p[0].toUpperCase()+p.slice(1)),title:i.title||'',avatar:i.avatar?'/ui/avatar/'+encodeURIComponent(p)+'?v='+encodeURIComponent(i.avatar):''}}
const AGENT=()=>ident().name;
const avatarImg=s=>ident().avatar?`<img src="${esc(ident().avatar)}" alt="${esc(AGENT())}" class="ava-img" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`:`<img src="/assets/elkiya-mark.svg" alt="${esc(AGENT())}" style="width:${s}px;height:${s}px">`;
async function loadIdentities(){try{S.identities=await call('','/ui/identities')}catch{}}

// Model providers worth showing: signed in, and not Nous or the pay-per-use Anthropic API (no key on this box).
const usableProvider=p=>p.authenticated&&(p.models||[]).length&&!/nous/i.test((p.slug||'')+' '+(p.name||''))&&!(p.slug==='anthropic'&&!S.anthropicKey);

/* ---------- navigation model ---------- */
const SECTIONS=[
 {id:'chat',label:'Chat',icon:'chat',key:'1'},
 {id:'agents',label:'Agents',icon:'user',key:'2',pages:[
  {id:'profiles',label:'Agents',icon:'user',desc:'Each agent has its own name, picture, personality, model, skills, memory and chats.'}]},
 {id:'automations',label:'Automations',icon:'zap',key:'3',pages:[
  {id:'schedules',label:'Schedules',icon:'clock',desc:'Prompts that run on a timetable and deliver the result where you want it.'},
  {id:'channels',label:'Channels',icon:'radio',desc:'Talk to aqeelOS from Telegram, Discord, WhatsApp, email and more.'},
  {id:'webhooks',label:'Webhooks',icon:'hook',desc:'Let other services trigger aqeelOS with an event.'},
  {id:'pairing',label:'Pairing',icon:'link',desc:'Approve who can message aqeelOS on your channels.'},
  {id:'kanban',label:'Kanban',icon:'list',desc:'A board of tasks your agents pick up and work through on their own.'}]},
 {id:'abilities',label:'Abilities',icon:'puzzle',key:'4',pages:[
  {id:'skills',label:'Skills',icon:'wand',desc:'Reusable know-how aqeelOS can pick up for a task.'},
  {id:'mcp',label:'MCP tools',icon:'plug',desc:'Outside tools aqeelOS can call, like GitHub, Notion or databases.'},
  {id:'plugins',label:'Plugins',icon:'layers',desc:'Extensions for aqeelOS itself, such as model providers.'},
  {id:'files',label:'Files',icon:'folder',desc:'Files on the AI box that aqeelOS works with.'},
  {id:'memory',label:'Memory',icon:'brain',desc:'What aqeelOS remembers about you between chats.'},
  {id:'achievements',label:'Achievements',icon:'trophy',desc:'Badges for what you and your agents have done, from your whole history.'}]},
 {id:'models',label:'Models',icon:'cpu',key:'5',pages:[
  {id:'models',label:'Models',icon:'cpu',desc:'Which AI does the thinking, and how hard it thinks.'},
  {id:'accounts',label:'Accounts',icon:'user',desc:'Every account that does the thinking: how much is left, which one is used first, and which agent uses what.'},
  {id:'keys',label:'Keys',icon:'key',desc:'API keys and tokens, stored on the box and never shown in full.'}
]},
 {id:'system',label:'System',icon:'gauge',key:'6',pages:[
  {id:'status',label:'Status',icon:'activity',desc:'Is everything running, and what happened recently.'},
  {id:'usage',label:'Usage',icon:'chart',desc:'Tokens, cache and cost over time.'},
  {id:'logs',label:'Logs',icon:'list',desc:'What aqeelOS and the gateway wrote while working.'},
  {id:'settings',label:'Settings',icon:'sliders',desc:'Every aqeelOS setting, grouped and searchable.'},
  {id:'host',label:'Host',icon:'server',desc:'The AI box itself: resources, updates and maintenance.'}]},
];

const S={identities:{},collapsed:store.get('collapsed',false),tab:{},status:null,sessions:[],sessionsLoaded:false,chatFilter:store.get('chatFilter','chats'),search:'',bannerDismissed:store.get('bannerDismissed',''),signedIn:false};

function route(){const p=location.hash.replace(/^#\/?/,'').split('/').map(decodeURIComponent);if(p[0]==='signin')return{signin:true};if(p[0]==='invite')return{invite:p[1]||''};const sec=SECTIONS.find(s=>s.id===p[0])||SECTIONS[0];if(sec.id==='chat')return{sec,chat:p[1]||null};const page=sec.pages.find(x=>x.id===p[1])||sec.pages[0];return{sec,page,arg:p.slice(2)}}
function go(h){if(location.hash==='#'+h)render();else location.hash=h}

/* ---------- shell ---------- */
function render(){
 const r=route(),root=$('#root');closeLayers();
 if(r.invite!==undefined){root.innerHTML='';inviteView(root,r.invite);return}
 if(r.signin||!S.signedIn){root.innerHTML=signinHtml();bindSignin();return}
 if(!$('.app'))root.innerHTML=`<div class="app"><aside class="side" aria-label="Navigation"></aside><div class="main"><div class="topbar"></div><div id="bannerSlot"></div><div class="view" id="view"></div></div><aside class="screen-pane" id="screenPane" aria-label="Live screen" hidden></aside></div>`;
 const app=$('.app');app.classList.toggle('collapsed',S.collapsed);const sw=store.get('sideW',null);if(sw)app.style.setProperty('--side-open',sw+'px');app.classList.remove('nav-open');
 paintSide(r);paintTop(r);paintBanner();if(typeof Screen!=='undefined')Screen.paint();
 const v=$('#view');v.classList.remove('enter');void v.offsetWidth;v.classList.add('enter');watchReveal(v);
 if(r.chat!==undefined)Chat.view(v,r.chat);
 else{const P=PAGES[r.page.id];const key=r.sec.id+'/'+r.page.id+'/'+(r.arg||[]).join('/');
  // Same page again (after a save, a toggle…): update in place. No skeleton flash, no replayed entrance animations.
  const same=S._pageKey===key&&$('#pg');S._pageKey=key;
  if(same){const pg=$('#pg');pg.classList.add('soft');if(P)Promise.resolve(P(r.page,pg,r)).catch(e=>showError(pg,e)).finally(()=>setTimeout(()=>pg.classList.remove('soft'),400))}
  else{v.innerHTML=`<div class="page">${head(r.page)}<div id="pg">${skeleton()}</div></div>`;if(P)Promise.resolve(P(r.page,$('#pg'),r)).catch(e=>showError($('#pg'),e))}}
}
function paintSide(r){$('.side').innerHTML=sidebar(r||route())}
function paintTop(r){$('.topbar').innerHTML=topbar(r||route())}
function sidebar(r){
 const sec=r.sec;
 const sections=SECTIONS.map(s=>`<button class="sec ${s.id===sec.id?'on':''}" data-go="/${s.id}" title="${s.label} (${MOD}+${s.key})" aria-current="${s.id===sec.id?'page':'false'}">${icon(s.icon,19)}<span class="label">${s.label}</span><span class="kbd">${MOD} ${s.key}</span></button>`).join('');
 let sub='';
 if(sec.id==='chat')sub=Chat.sidebar(r);
 else sub=`<div class="side-sub"><div class="side-sub-head"><span class="th">${sec.label}</span></div><div class="side-list">${sec.pages.map(p=>`<button class="item ${r.page.id===p.id?'on':''}" data-go="/${sec.id}/${p.id}">${icon(p.icon,16)}<span class="t">${p.label}</span></button>`).join('')}</div></div>`;
 const st=S.status;const gw=st?(st.gateway_running?'Gateway running':'Gateway stopped'):'Connecting…';
 return `<div class="resizer side-rz" data-drag="side" title="Drag to resize · double-click to reset"></div><div class="side-top"><span class="wordmark"><img class="mark" src="/assets/elkiya-mark.svg" alt=""><span>aqeelOS</span></span><button class="ghost icon collapse-btn" data-act="collapse" title="Collapse sidebar (${MOD}+B)" aria-label="Collapse sidebar">${icon('panel',18)}</button></div>
 <nav class="sections">${S.collapsed?`<button class="sec" data-act="collapse" title="Expand sidebar (${MOD}+B)">${icon('panel',19)}</button>`:''}${sections}</nav>${sub}
 <div class="side-foot"><button class="status-btn" data-menu="profile" aria-label="Account and status"><span class="avatar">${ident().avatar?`<img src="${esc(ident().avatar)}" alt="">`:esc(AGENT()[0].toUpperCase())}</span><span class="who"><b>${esc(AGENT())}</b><span><i class="dot" style="color:${st&&!st.gateway_running?'var(--bad)':'var(--ok)'}"></i>${gw} · ${esc(modelLabel(S.model))}</span></span>${icon('chevD',16)}</button></div>`;
}
// Hermes dashboard plugins (Kanban, Achievements) open in their own tab of the original dashboard.
function pluginLinks(sec){const want=sec==='automations'?['kanban']:['hermes-achievements'];return (S.dashPlugins||[]).filter(p=>want.includes(p.name)).map(p=>`<button class="item" data-act="plugin-page" data-name="${esc(p.name)}" data-path="${esc(p.tab?.path||'')}">${icon(sec==='automations'?'list':'sparkle',16)}<span class="t">${esc(p.label)}</span><span class="n">${icon('chevR',13)}</span></button>`).join('')}
function topbar(r){
 let crumbs;
 if(r.chat==='manage')crumbs=`<span>Chat</span>${icon('chevR',14)}<b>Manage chats</b>`;
 else if(r.chat!==undefined){const c=S.sessions.find(x=>x.id===r.chat);crumbs=`<b data-act="rename-current" title="Rename" style="cursor:text">${c?esc(c.title||c.preview||'Chat'):'New chat'}</b>`}
 else crumbs=`<span>${r.sec.label}</span>${icon('chevR',14)}<b>${r.page.label}</b>`;
 return `<button class="ghost icon menu-btn" data-act="nav" aria-label="Open navigation">${icon('menu',20)}</button><div class="crumbs">${crumbs}</div>
 <div class="top-actions"><button class="ghost icon ${Screen.open?'on':''}" data-act="screen" title="Live screen" aria-label="Live screen" aria-pressed="${Screen.open}">${icon('monitor',18)}</button><button class="k-btn" data-act="palette" aria-label="Search and commands">${icon('search',15)}<span class="k-label">Search or run a command</span><kbd>${MOD} K</kbd></button>
 <button class="ghost icon" data-act="theme" title="Light or dark" aria-label="Switch light and dark">${icon(document.documentElement.classList.contains('dark')?'sun':'moon',18)}</button></div>`;
}
// One calm banner for low memory / disk / out-of-memory restarts (most severe first).
function paintBanner(){const slot=$('#bannerSlot');if(!slot)return;const st=S.status||{};const rp=st.resource_pressure||st.resources||((st.memory||st.disk||S.box)?{memory:st.memory,disk:st.disk}:null);let msg='',key='';
 if(rp&&typeof rp==='object'){const d=rp.disk?.level||rp.disk?.pressure||rp.disk_level,m=S.box?.memory?.level||rp.memory?.level||rp.memory?.pressure||rp.memory_level,oom=rp.oom_restart||rp.suspected_oom||rp.memory?.last_boot_suspected_oom;
  if(d==='critical'){msg='<b>Disk is almost full.</b> Free space on the AI box from System › Host.';key='disk-c'}
  else if(m==='critical'){msg='<b>aqeelOS is almost out of memory</b> and may restart.';key='mem-c'}
  else if(oom){msg='<b>aqeelOS restarted unexpectedly</b>, most likely because it ran out of memory.';key='oom'}
  else if(d==='elevated'){msg='<b>Disk is getting full</b> on the AI box.';key='disk-e'}
  else if(m==='elevated'){msg=`<b>Memory is running low</b> on the AI box${S.box?.memory?.pct?' ('+S.box.memory.pct+'% of its '+bytes(S.box.memory.limit)+')':''}. See System › Host for what uses it.`;key='mem-e'}}
 key=key&&key+':'+(S.status?.gateway_pid||'');
 slot.innerHTML=msg&&S.bannerDismissed!==key?`<div class="banner">${icon('alert',16)}<span>${msg}</span><button data-act="banner" data-key="${esc(key)}">Dismiss</button></div>`:''}

/* ---------- page helpers ---------- */
function head(p,actions=''){return `<div class="page-head"><div><span class="eyebrow">${route().sec.label}</span><h1>${p.label}</h1><p>${p.desc||''}</p></div><div class="head-actions" style="display:flex;gap:8px;flex-wrap:wrap">${actions}</div></div>`}
function setActions(html){const a=$('.head-actions');if(a)a.innerHTML=html}
function tabs(key,list,cur){cur=cur||S.tab[key]||list[0];return `<div class="tabs" data-tabs="${key}">${list.map(t=>`<button class="${t===cur?'on':''}" data-tab="${esc(t)}">${esc(t)}</button>`).join('')}<span class="pill"></span></div>`}
const toggle=(on,label,attrs='')=>`<input type="checkbox" class="switch" ${on?'checked':''} aria-label="${esc(label)}" ${attrs}>`;
const st=i=>`style="animation-delay:${Math.min(i,10)*30}ms"`;
const skeleton=(n=4)=>`<div class="card list" style="padding:6px 22px">${Array.from({length:n},()=>'<div class="skel skel-row"></div>').join('')}</div>`;
function showError(el,e,retry){if(!el)return;el.innerHTML=`<div class="card state-box err"><b>Couldn't load this</b>${esc(e?.message||e)}<br><button data-act="reload">${icon('refresh',15)}Try again</button></div>`}
const emptyBox=(title,text,btn='')=>`<div class="empty-hero"><b style="display:block;font-size:17px;margin-bottom:6px">${esc(title)}</b><span style="color:var(--ink-2)">${esc(text)}</span>${btn?`<div style="margin-top:16px">${btn}</div>`:''}</div>`;
// Tab bars are often re-rendered on switch, so each bar remembers where its pill was and a fresh pill
// glides from there instead of appearing in place.
const pillAt={};
function placePills(){$$('.tabs').forEach(t=>{const on=t.querySelector('button.on'),pill=t.querySelector('.pill');if(!on||!pill||!on.offsetWidth)return;
 const key=t.dataset.tabs||'',to={left:on.offsetLeft,width:on.offsetWidth},from=pillAt[key];
 if(!pill.style.left&&from&&(from.left!==to.left||from.width!==to.width)){pill.style.transition='none';pill.style.left=from.left+'px';pill.style.width=from.width+'px';pill.offsetWidth;pill.style.transition=''}
 pill.style.left=to.left+'px';pill.style.width=to.width+'px';pillAt[key]=to})}

/* ---------- floating layers ---------- */
function closeLayers(){$$('.scrim,.palette,.drawer,.menu').forEach(e=>e.remove())}
function toast(msg,kind){const t=document.createElement('div');t.className='toast';t.innerHTML=icon(kind==='err'?'alert':'check',15)+esc(msg);$('#toasts').append(t);setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),260)},kind==='err'?6000:2800)}
const fail=e=>{if(e?.status!==401)toast(e?.message||String(e),'err')};
function scrim(){const s=document.createElement('div');s.className='scrim';s.onclick=closeLayers;document.body.append(s)}
function drawer(title,body,foot=''){closeLayers();scrim();const d=document.createElement('div');d.className='drawer';d.setAttribute('role','dialog');d.setAttribute('aria-label',title);d.innerHTML=`<div class="drawer-head"><h2>${esc(title)}</h2><button class="ghost icon" data-act="close" aria-label="Close">${icon('x',18)}</button></div><div class="drawer-body">${body}</div>${foot?`<div class="drawer-foot">${foot}</div>`:''}`;document.body.append(d);setTimeout(()=>d.querySelector('input:not([type=checkbox]),textarea,select')?.focus(),30);return d}
function menu(anchor,items,opt={}){$$('.menu').forEach(e=>e.remove());const m=document.createElement('div');m.className='menu';m.setAttribute('role','menu');const list=items.filter(Boolean);
 m.innerHTML=list.map((i,ix)=>i==='-'?'<hr>':i.header?`<div class="mh">${esc(i.header)}</div>`:`<button class="item ${i.bad?'bad':''} ${i.on?'cur':''}" role="menuitem" data-mi="${ix}" ${i.disabled?'disabled':''}>${i.icon?icon(i.icon,16):''}<span class="t">${esc(i.label)}${i.sub?`<small class="mi-sub">${esc(i.sub)}</small>`:''}</span>${i.on?`<span style="color:var(--blue)">${icon('check',15)}</span>`:''}${i.kbd?`<small style="margin-left:auto;color:var(--muted)">${esc(i.kbd)}</small>`:''}</button>`).join('');
 if(opt.matchWidth)m.style.minWidth=anchor.offsetWidth+'px';document.body.append(m);
 const r=anchor.getBoundingClientRect(),w=m.offsetWidth;let h=m.offsetHeight;let x=Math.min(r.left,innerWidth-w-12),y=r.bottom+6;const below=innerHeight-r.bottom-18,above=r.top-18;if(h>below&&above>below){m.style.maxHeight=Math.min(h,above)+'px';h=m.offsetHeight;y=r.top-h-6}else m.style.maxHeight=Math.max(160,below)+'px';m.style.left=Math.max(12,x)+'px';m.style.top=Math.max(12,y)+'px';
 m.onclick=e=>{const b=e.target.closest('[data-mi]');if(!b)return;const it=list[+b.dataset.mi];m.remove();it?.run?.();opt.onClose?.()};
 m.onkeydown=e=>{const bs=$$('button.item:not([disabled])',m);const i=bs.indexOf(document.activeElement);if(e.key==='ArrowDown'){e.preventDefault();bs[Math.min(i+1,bs.length-1)]?.focus()}if(e.key==='ArrowUp'){e.preventDefault();bs[Math.max(i-1,0)]?.focus()}if(e.key==='Escape'){m.remove();anchor.focus();opt.onClose?.()}if(e.key==='Tab')m.remove()};
 (m.querySelector('.cur')||m.querySelector('button.item'))?.focus();m.querySelector('.cur')?.scrollIntoView({block:'nearest'})}

/* ---------- brand dropdowns: every <select> becomes an Elkiya menu button ---------- */
function enhanceSelect(sel){if(sel.dataset.enhanced||sel.multiple)return;sel.dataset.enhanced='1';
 const btn=document.createElement('button');btn.type='button';btn.className='sel-btn'+(sel.style.width==='auto'?' inline':'');btn.setAttribute('aria-haspopup','listbox');if(sel.id)btn.dataset.for=sel.id;if(sel.getAttribute('aria-label'))btn.setAttribute('aria-label',sel.getAttribute('aria-label'));
 const sync=()=>{const o=sel.options[sel.selectedIndex];btn.innerHTML=`<span class="sv">${esc(o?o.textContent:'Choose…')}</span>${icon('chevD',15)}`;btn.disabled=sel.disabled};sync();
 sel.classList.add('sel-native');sel.tabIndex=-1;sel.setAttribute('aria-hidden','true');sel.after(btn);
 sel.addEventListener('change',sync);sel._sync=sync;
 btn.onclick=e=>{e.stopPropagation();const items=[];let grp=null;for(const o of sel.options){const g=o.parentElement.tagName==='OPTGROUP'?o.parentElement.label:null;if(g!==grp){grp=g;if(g)items.push({header:g})}items.push({label:o.textContent,on:o.selected,disabled:o.disabled,run:()=>{if(sel.value===o.value)return;sel.value=o.value;sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}))}})}
  btn.classList.add('open');menu(btn,items,{matchWidth:true,onClose:()=>{btn.classList.remove('open');btn.focus()}});const obs=new MutationObserver(()=>{if(!$('.menu')){btn.classList.remove('open');obs.disconnect()}});obs.observe(document.body,{childList:true})};
 btn.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();btn.click()}}}
new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes){if(n.nodeType!==1)continue;if(n.tagName==='SELECT')enhanceSelect(n);else n.querySelectorAll?.('select').forEach(enhanceSelect)}}).observe(document.documentElement,{childList:true,subtree:true});
function confirmBox(title,text,okLabel='Delete',danger=true){return new Promise(res=>{const d=drawer(title,`<p style="margin:0;color:var(--ink-2);line-height:1.55">${text}</p>`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="cfm-ok" ${danger?'style="background:var(--bad);box-shadow:none"':''}>${esc(okLabel)}</button>`);d.querySelector('#cfm-ok').onclick=()=>{closeLayers();res(true)};const obs=new MutationObserver(()=>{if(!d.isConnected){obs.disconnect();res(false)}});obs.observe(document.body,{childList:true})})}
function promptBox(title,label,value='',okLabel='Save'){return new Promise(res=>{const d=drawer(title,`<label>${esc(label)}</label><input id="pb-in" value="${esc(value)}">`,`<button class="ghost" data-act="close">Cancel</button><button class="primary" id="pb-ok">${esc(okLabel)}</button>`);const inp=d.querySelector('#pb-in');const ok=()=>{const v=inp.value;closeLayers();res(v)};d.querySelector('#pb-ok').onclick=ok;inp.onkeydown=e=>{if(e.key==='Enter')ok()};const obs=new MutationObserver(()=>{if(!d.isConnected){obs.disconnect();res(null)}});obs.observe(document.body,{childList:true})})}
// Live log of a Hermes background action in a drawer.
function actionDrawer(title,name){const d=drawer(title,`<div class="action-log" id="alog">Starting…</div>`,`<button class="primary" data-act="close">Done</button>`);followAction(name,(lines,done,code)=>{const el=d.querySelector('#alog');if(!el)return;el.textContent=(lines.join('').trim()||'(no output yet)')+(done?'\n\n'+(code===0||code==null?'✓ Finished':'✕ Exited with code '+code):'');el.scrollTop=el.scrollHeight})}
async function runAction(title,path,body){try{const r=await post(H,path,body);if(r?.ok===false)throw new Error(r.error||r.message||'Failed');if(r?.name)actionDrawer(title,r.name);else toast(title+' done');return r}catch(e){fail(e)}}

function palette(){closeLayers();scrim();const p=document.createElement('div');p.className='palette';p.setAttribute('role','dialog');p.setAttribute('aria-label','Search and commands');
 const actions=[{g:'Actions',l:'New chat',ic:'plus',run:()=>Chat.newChat()},{g:'Actions',l:'Restart gateway',ic:'refresh',run:()=>restartGateway()},{g:'Actions',l:'Toggle light / dark',ic:'moon',run:()=>theme()},{g:'Actions',l:'Check for engine updates',ic:'download',run:()=>go('/system/host')},{g:'Actions',l:'Sign out',ic:'logout',run:()=>signOut()}];
 const models=(Chat.models||[]).slice(0,12).map(m=>({g:'Switch model',l:m.label+' · '+m.providerName,ic:'cpu',run:()=>Chat.setModel(m)}));
 const pages=SECTIONS.flatMap(s=>s.pages?s.pages.map(x=>({g:'Pages',l:s.label+' › '+x.label,ic:x.icon,run:()=>go('/'+s.id+'/'+x.id)})):[{g:'Pages',l:'Chat',ic:'chat',run:()=>go('/chat')},{g:'Pages',l:'Chat › Manage chats',ic:'list',run:()=>go('/chat/manage')}]);
 const chats=S.sessions.slice(0,60).map(c=>({g:'Chats',l:c.title||c.preview||c.id,ic:srcIcon(c.source),run:()=>go('/chat/'+c.id)}));
 const all=[...actions,...pages,...models,...chats];let sel=0,list=all,remote=[];
 p.innerHTML=`<div class="p-in">${icon('search',18)}<input placeholder="Search pages, chats, skills or run a command" aria-label="Search"></div><div class="p-list"></div><div class="p-foot"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>`;document.body.append(p);
 const inp=p.querySelector('input'),box=p.querySelector('.p-list');
 const paint=()=>{const L=[...list,...remote];let g='',h='';L.slice(0,50).forEach((it,i)=>{if(it.g!==g){g=it.g;h+=`<div class="p-group">${esc(g)}</div>`}h+=`<button class="item ${i===sel?'sel':''}" data-i="${i}">${icon(it.ic,16)}<span class="t">${esc(it.l)}</span>${it.sub?`<small style="margin-left:auto;color:var(--muted);font-weight:400">${esc(it.sub)}</small>`:''}</button>`});box.innerHTML=h||'<p style="padding:20px;color:var(--muted);text-align:center">Nothing found</p>';box.querySelector('.sel')?.scrollIntoView({block:'nearest'})};
 let t;inp.oninput=()=>{const q=inp.value.toLowerCase().trim();list=q?all.filter(x=>x.l.toLowerCase().includes(q)):all;sel=0;remote=[];paint();clearTimeout(t);
  if(q.length>=2)t=setTimeout(async()=>{try{const [sk,found]=await Promise.all([Pages.skillsCache(),H('/sessions/search'+qp({q})).catch(()=>null)]);if(inp.value.toLowerCase().trim()!==q)return;remote=[...sk.filter(s=>(s.name+' '+(s.description||'')).toLowerCase().includes(q)).slice(0,6).map(s=>({g:'Skills',l:s.name,sub:s.category,ic:'sparkle',run:()=>{go('/abilities/skills');setTimeout(()=>Pages.openSkill(s.name),300)}})),...((found?.results||found?.sessions||[]).slice(0,8).map(r=>({g:'Inside chats',l:r.title||r.session_title||r.snippet||r.session_id,sub:ago(r.last_active||r.timestamp),ic:'search',run:()=>go('/chat/'+(r.session_id||r.id))})))];paint()}catch{}},250)};
 inp.onkeydown=e=>{const L=[...list,...remote];if(e.key==='ArrowDown'){sel=Math.min(sel+1,L.length-1);paint();e.preventDefault()}if(e.key==='ArrowUp'){sel=Math.max(sel-1,0);paint();e.preventDefault()}if(e.key==='Enter'){const it=L[sel];closeLayers();it?.run()}};
 box.onclick=e=>{const b=e.target.closest('[data-i]');if(!b)return;const it=[...list,...remote][+b.dataset.i];closeLayers();it.run()};paint();inp.focus()}
function theme(){const d=document.documentElement.classList.toggle('dark');try{localStorage.setItem('hui-theme',d?'dark':'light')}catch{};const tb=$('.topbar');if(tb)paintTop()}
async function restartGateway(){try{await post(UI,'/ui/gateway/restart');toast('Restarting the engine… back in about 25 seconds');setTimeout(()=>refreshStatus(),26000)}catch(e){fail(e)}}
async function refreshStatus(){try{S.status=await H('/status');if(S.me?.admin!==false)S.box=await UI('/ui/box').catch(()=>S.box);const r=route();if(!r.signin&&$('.side'))paintSide(r),paintBanner()}catch{}}

/* ---------- sign-in ---------- */
function signinHtml(){return `<div class="signin"><form class="card" id="signin"><span class="wordmark"><img class="mark" src="/assets/elkiya-mark.svg" alt="">aqeelOS</span><h1>Welcome back</h1><p>Sign in to aqeelOS.</p><label for="nm">Username</label><input id="nm" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="aqeel"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" placeholder="Your password"><p class="err" id="err" role="alert"></p><button class="primary" type="submit">Sign in</button><p class="foot">${icon('lock',13)} Private · ${esc(location.host)}</p></form></div>`}
function bindSignin(){const f=$('#signin');$('#nm').focus();f.onsubmit=async e=>{e.preventDefault();const pw=$('#pw').value;const err=$('#err');const shake=()=>{f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake')};if(!pw){err.textContent='Enter your password.';return shake()}
 const b=f.querySelector('button');b.disabled=true;try{const r=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('#nm').value.trim(),password:pw})});const d=await r.json().catch(()=>({}));if(!r.ok){err.textContent=d.error||'Sign-in failed.';shake();return}if(d.needCode){codeStep(f,d);return}S.signedIn=true;if(location.hash==='#/signin')location.hash='#/chat';await boot()}finally{b.disabled=false}}}
// Two-step sign-in: the password was right, now the code from their email.
function codeStep(f,d){f.querySelector('h1').textContent='Check your email';f.querySelector('h1').nextElementSibling.textContent='We sent a 6-digit code to '+d.to+'. It may land in spam.';
 f.querySelectorAll('label,input').forEach(e=>e.hidden=true);const i=document.createElement('input');i.id='code';i.inputMode='numeric';i.autocomplete='one-time-code';i.placeholder='123456';i.maxLength=6;f.querySelector('#err').before(i);i.focus();
 f.onsubmit=async e=>{e.preventDefault();const err=$('#err'),b=f.querySelector('button');b.disabled=true;try{const r=await fetch('/auth/code',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:d.key,code:i.value})});const j=await r.json().catch(()=>({}));
  if(!r.ok){err.textContent=j.error||'That code is not right.';f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake');return}S.signedIn=true;if(location.hash==='#/signin')location.hash='#/chat';await boot()}finally{b.disabled=false}}}
function signedOut(){if(!S.signedIn)return;S.signedIn=false;render()}
async function signOut(){await fetch('/auth/logout',{method:'POST'});S.signedIn=false;$('#root').innerHTML='';render()}

/* Loading → loaded: wherever loading placeholders (.skel) are replaced, the new content fades and rises in,
   a little staggered, instead of snapping into place. Works for whole pages and for panels that load later. */
function watchReveal(root){if(!root||root._reveal)return;root._reveal=new MutationObserver(ms=>{for(const m of ms){
 if(![...m.removedNodes].some(n=>n.nodeType===1&&(n.classList?.contains('skel')||n.querySelector?.('.skel'))))continue;
 let i=0;for(const n of m.addedNodes)if(n.nodeType===1&&!/^(SELECT|SCRIPT|STYLE|TEMPLATE)$/.test(n.tagName)&&!n.hidden&&!n.classList.contains('skel')&&!n.classList.contains('sel-native')&&!n.querySelector?.('.skel')){n.classList.remove('reveal');void n.offsetWidth;n.style.setProperty('--ri',i++);n.classList.add('reveal')}}});
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
