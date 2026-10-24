/* The engine's dashboard plugins, inside aqeelOS (21 Oct 2026). A plugin is a plain script bundle written for the
   engine's own screen: it reads window.__HERMES_PLUGIN_SDK__ (React, hooks, UI parts, fetch helpers) and calls
   window.__HERMES_PLUGINS__.register(name, Page) or registerSlot(plugin, slot, Part). Those two global names are the
   engine's fixed contract and stay exactly as they are; nobody sees them. Here the parts are aqeelOS's own (buttons,
   chips, cards, inputs, tabs, dialogs, toasts), every call goes through aqeelOS's server (/ui/plugin-api adds the
   engine's key) for the agent you chat with, and React (app/vendor/react-host.js) is fetched only when a plugin page
   or slot is first shown. Members get an empty list from the server, so nothing here runs for them. */
const Plugins={list:[],slotNames:new Set(),reg:new Map(),slotReg:new Map(),errs:new Map(),done:new Set(),subs:new Set(),roots:new Set(),loaded:{},orig:{},over:{},warned:new Set(),
 // plugins aqeelOS has rebuilt itself: their own page shows only when the owner picks it (Plugins › ⋯)
 NATIVE:{kanban:'automations/kanban','hermes-achievements':'abilities/achievements'},
 // the engine's page addresses → aqeelOS's sections and pages
 ROUTES:{chat:'chat',sessions:'chat',analytics:'system/usage',logs:'system/logs',cron:'automations/schedules',skills:'abilities/skills',plugins:'abilities/plugins',config:'system/settings',env:'system/keys',docs:'help',mcp:'abilities/mcp',models:'models/models',profiles:'agents/profiles',files:'agents/files',memory:'agents/memory',kanban:'automations/kanban',achievements:'abilities/achievements',status:'system/health',webhooks:'automations/webhooks',channels:'channels/channels',messaging:'channels/channels'},
 // aqeelOS page → the engine's name for the slots at its top and bottom
 PAGE_SLOTS:{logs:'logs',usage:'analytics',settings:'config',keys:'env',skills:'skills',plugins:'plugins',schedules:'cron'},
 ICONS:{package:'layers',star:'sparkle',puzzle:'puzzle',trophy:'trophy',chart:'chart',barchart:'chart',activity:'activity',list:'list',kanban:'list',bot:'user',user:'user',settings:'settings',zap:'zap',clock:'clock',globe:'globe',terminal:'terminal',file:'file',folder:'folder',brain:'brain',shield:'shield',key:'key',bell:'bell',mic:'mic',monitor:'monitor'},
 agent:()=>S.profile||'default',
 // where a slot shows, in plain words (Plugins › Installed says "Adds to Skills, Chat")
 slotLabel(s){const k=String(s).split(':')[0];return {sessions:'Chats',analytics:'Usage',logs:'Logs',cron:'Schedules',skills:'Skills',plugins:'Plugins',config:'Settings',env:'Keys',docs:'Help',chat:'Chat','header-left':'Top bar','header-right':'Top bar','header-banner':'Top bar',sidebar:'Sidebar','pre-main':'Every page','post-main':'Every page','footer-left':'Every page','footer-right':'Every page',overlay:'Whole screen',backdrop:'Whole screen'}[k]||pretty(k)},
 seg:p=>String(p||'').replace(/^\/+/,'').split(/[/?#]/)[0].toLowerCase(),
 icon(n){return this.ICONS[String(n||'').toLowerCase().replace(/[^a-z]/g,'')]||'puzzle'},
 optIn(n){return !!store.get('plugOwn',{})[n]},
 setOptIn(n,on){const o=store.get('plugOwn',{});if(on)o[n]=1;else delete o[n];store.set('plugOwn',o);this.apply(true);toast(on?'The plugin’s own page is used now':'aqeelOS’s own page is used again')},
 async load(fresh){let l=[];if(S.me?.admin!==false){try{l=(await UI('/ui/plugin-list?agent='+encodeURIComponent(this.agent())+(fresh?'&fresh=1':''),{keep:true}))?.plugins||[]}catch{}}
  this.list=Array.isArray(l)?l:[];S.dashPlugins=this.list;this.apply()},
 // pages into the menu (manifest position, Abilities by default), overrides onto built-in pages, hidden ones reachable by address only
 apply(force){const before=new Set([...SECTIONS.flatMap(s=>(s.pages||[]).filter(p=>p.plug).map(p=>p.id)),...Object.keys(this.over)]);
  for(const s of SECTIONS)if(s.pages)s.pages=s.pages.filter(p=>!p.plug);for(const [id,fn] of Object.entries(this.orig))PAGES[id]=fn;this.orig={};this.over={};
  const secOf=id=>SECTIONS.find(s=>s.id===id),pageAt=r=>{const [a,b]=String(r||'').split('/');const s=secOf(a);return s?.pages?{s,p:s.pages.find(x=>x.id===b)}:null};
  for(const m of this.list){const t=m.tab;if(!t||!m.entry)continue;const native=this.NATIVE[m.name];if(native&&!this.optIn(m.name))continue;
   const target=native||(t.override?this.ROUTES[this.seg(t.override)]:null),at=target&&pageAt(target);
   if(at?.p){if(['kanban','achievements'].includes(at.p.id)&&!this.optIn(m.name))continue;if(!this.orig[at.p.id])this.orig[at.p.id]=PAGES[at.p.id];PAGES[at.p.id]=(p,el)=>this.page(m.name,el);this.over[at.p.id]=m.name;continue}
   const mm=/^(after|before):(.+)$/.exec(String(t.position||'end'));let sec=secOf('abilities'),anchor=null,after=true;
   if(mm){const a=pageAt(this.ROUTES[this.seg(mm[2])]);if(a?.p){sec=a.s;anchor=a.p.id;after=mm[1]==='after'}}
   const id='pl-'+m.name.replace(/[^\w-]/g,'-');let i=anchor?sec.pages.findIndex(p=>p.id===anchor):-1;if(i<0)i=sec.pages.length;else if(after){i++;while(sec.pages[i]?.plug)i++}
   sec.pages.splice(i,0,{id,label:m.label||pretty(m.name),icon:this.icon(m.icon),desc:m.description||'',plug:m.name,hidden:!!(t.hidden||m.user_hidden)});PAGES[id]=(p,el)=>this.page(m.name,el)}
  this.slotNames=new Set(this.list.flatMap(m=>Array.isArray(m.slots)?m.slots:[]));
  if(this.list.length)this.watch();if(!S.signedIn||!$('.app'))return;
  paintSide();const cur=location.hash.split('?')[0].split('/')[2]||'';const now=new Set([...SECTIONS.flatMap(s=>(s.pages||[]).filter(p=>p.plug).map(p=>p.id)),...Object.keys(this.over)]);
  if(force||cur&&(now.has(cur)||before.has(cur))){S._pageKey=null;render()}else this.patch()},
 // Abilities › Plugins › Open: the plugin's page here, or aqeelOS's own page for the two it rebuilt
 open(name){const n=this.NATIVE[name];if(n&&!this.optIn(name))return go('/'+n);for(const s of SECTIONS)for(const p of s.pages||[])if(p.plug===name)return go('/'+s.id+'/'+p.id);
  const ov=Object.entries(this.over).find(([,v])=>v===name);if(ov){const s=SECTIONS.find(x=>(x.pages||[]).some(p=>p.id===ov[0]));if(s)return go('/'+s.id+'/'+ov[0])}
  toast(this.list.some(m=>m.name===name)?'This plugin has no page of its own.':'This plugin has no page here yet. Rescan and try again.','err')},
 // drawn again on the same page (a save, a refresh): the plugin keeps itself up to date
 async page(name,el){if(el.querySelector(':scope>.plug-host')?.dataset.plug===name)return;
  if(!this.list.some(m=>m.name===name))return showError(el,new Error('This plugin is no longer installed.'));
  el.innerHTML=`<p class="hint plug-for">Works with ${esc(AGENT())}, the agent you chat with.</p><div class="plug-host plug-page" data-plug="${esc(name)}">${skeleton()}</div>`;const box=el.querySelector('.plug-host');
  try{await this.need([name])}catch(e){if(box.isConnected)box.innerHTML=this.errHtml(e.message);return}
  if(box.isConnected)this.mount(box,this.h(this.B,{name},this.h(this.PageView,{name})))},
 errHtml:msg=>`<div class="card state-box err plug-err"><b>This plugin couldn't load</b><span>${esc(msg)}</span></div>`,
 retry(name){const s=document.querySelector(`script[data-plugin="${CSS.escape(name)}"]`);s?.remove();delete this.loaded[name];this.done.delete(name);this.errs.delete(name);this.reg.delete(name);S._pageKey=null;render()},
 /* ---------- loading ---------- */
 url:f=>f+'?v='+encodeURIComponent(document.querySelector('meta[name=build]')?.content||'1'),
 react(){return this._r||=new Promise((ok,no)=>{const s=document.createElement('script');s.src=this.url('/app/vendor/react-host.js');
  s.onload=()=>{if(!window.React||!window.ReactDOM?.createRoot){this._r=null;return no(new Error('The page parts did not start. Reload the page.'))}this.sdk();ok()};s.onerror=()=>{s.remove();this._r=null;no(new Error('The page parts could not be fetched. Check the connection and reload.'))};document.head.append(s)})},
 file(n,f){return '/ui/plugin-files/'+encodeURIComponent(n)+'/'+String(f).split('/').map(encodeURIComponent).join('/')+'?agent='+encodeURIComponent(this.agent())},
 bundle(m){return this.loaded[m.name]||=new Promise(ok=>{if(m.css&&!document.querySelector(`link[data-plugin="${CSS.escape(m.name)}"]`)){const l=document.createElement('link');l.rel='stylesheet';l.href=this.file(m.name,m.css);l.dataset.plugin=m.name;document.head.append(l)}
  const s=document.createElement('script');s.src=this.file(m.name,m.entry);s.dataset.plugin=m.name;const fin=e=>{if(e)this.errs.set(m.name,'LOAD_FAILED');this.done.add(m.name);this.ping();ok()};s.onload=()=>fin();s.onerror=()=>fin(true);document.body.append(s)})},
 async need(names){await this.react();await Promise.all(names.map(n=>{const m=this.list.find(x=>x.name===n);return m&&m.entry?this.bundle(m):null}))},
 ping(){this.ver=(this.ver||0)+1;for(const f of this.subs)try{f()}catch{}},
 sub:fn=>{Plugins.subs.add(fn);return ()=>Plugins.subs.delete(fn)},
 errOf(n){const e=this.errs.get(n)||(this.done.has(n)&&!this.reg.has(n)?'NO_REGISTER':null);return e==='LOAD_FAILED'?'Its files could not be fetched from the engine.':e==='NO_REGISTER'?'It loaded but did not start. It may need a newer engine.':e},
 mount(box,el){box.innerHTML='';box.dataset.on='1';const root=ReactDOM.createRoot(box);root.render(el);this.roots.add({box,root})},
 sweep(){for(const x of this.roots)if(!x.box.isConnected){this.roots.delete(x);try{x.root.unmount()}catch{}}},
 // one watcher, only when this agent has plugins: unmounts what left the page and puts slots back after a redraw
 watch(){if(this._mo)return;this._mo=new MutationObserver(()=>{if(this._q)return;this._q=requestAnimationFrame(()=>{this._q=0;this.sweep();this.patch()})});this._mo.observe(document.body,{childList:true,subtree:true})},
 /* ---------- slots: a small mount point, only where some plugin says it fills that slot ---------- */
 patch(){if(!this.slotNames.size||!S.signedIn)return;const r=route();
  const put=(name,ref,how)=>{if(!ref||!this.slotNames.has(name))return;const scope=how==='before'||how==='after'?ref.parentElement:ref;if(!scope||[...scope.children].some(c=>c.dataset?.slot===name))return;
   const d=document.createElement('div');d.className='plug-slot plug-host';d.dataset.slot=name;d.dataset.anim='';ref[how](d);this.slot(d,name)};
  const page=$('#view>.page'),pg=page&&$('#pg',page);
  if(pg&&r.page){const k=this.PAGE_SLOTS[r.page.id];put('pre-main',page,'prepend');if(k){put(k+':top',$('.page-head',page)||pg,'after');put(k+':bottom',pg,'after')}put('post-main',page,'append');put('footer-left',page,'append');put('footer-right',page,'append')}
  const ch=$('#view>.chat');if(ch){put('chat:top',ch,'prepend');put('chat:bottom',ch,'append')}
  put('header-banner',$('#bannerSlot'),'after');put('header-left',$('.topbar>.crumbs'),'before');put('header-right',$('.topbar .top-actions'),'prepend');put('sidebar',$('.side>.side-foot'),'before');
  for(const [n,c] of [['overlay','plug-overlay'],['backdrop','plug-backdrop']])if(this.slotNames.has(n)&&!$('body>.'+c)){const d=document.createElement('div');d.className=c+' plug-host';d.dataset.slot=n;document.body[n==='backdrop'?'prepend':'append'](d);this.slot(d,n)}},
 slot(box,name){box.dataset.on='1';this.need(this.list.filter(m=>(m.slots||[]).includes(name)).map(m=>m.name)).then(()=>{if(box.isConnected)this.mount(box,this.h(this.B,{name,small:true},this.h(this.SDK.components.PluginSlot,{name})))}).catch(e=>console.warn('[plugins] slot',name,e.message))},
 /* ---------- the SDK the bundles read ---------- */
 sdk(){if(this.SDK)return;const R=window.React,RD=window.ReactDOM,h=R.createElement,{useState,useEffect,useCallback,useMemo,useRef,useContext,createContext,useSyncExternalStore,useId}=R;this.h=h;const P=this;
  const cn=(...a)=>a.flat(Infinity).flatMap(x=>!x?[]:typeof x==='object'?Object.keys(x).filter(k=>x[k]):[String(x)]).join(' ');
  const strip=(p,...k)=>{const o={...p};for(const x of k)delete o[x];return o};
  // the plugin's '/api/...' paths, through aqeelOS: its own backend → /ui/plugin-api, the engine's API → /hapi, its files → /ui/plugin-files
  const map=u=>{u=String(u||'');const ag=encodeURIComponent(P.agent()),add=(p,k)=>p+(p.includes('?')?'&':'?')+k+'='+ag;let m;
   if((m=/^\/api\/plugins\/([^/?#]+)(.*)$/.exec(u)))return add('/ui/plugin-api/'+m[1]+(m[2]||''),'agent');
   if((m=/^\/dashboard-plugins\/([^/?#]+)\/([^?#]+)/.exec(u)))return add('/ui/plugin-files/'+m[1]+'/'+m[2],'agent');
   if(u.startsWith('/api/'))return /[?&]profile=/.test(u)?'/hapi'+u.slice(4):add('/hapi'+u.slice(4),'profile');return u};
  const authedFetch=(u,init={})=>{const hd=new Headers(init.headers||{});hd.set('x-hui','1');const p=fetch(map(u),{...init,headers:hd,credentials:'same-origin'}).then(r=>{if(r.status===401&&r.headers.get('x-hui-auth')==='required')signedOut();return r});pressBusy(p);return p};
  const fetchJSON=async(u,init)=>{const r=await authedFetch(u,init);const txt=await r.text();if(!r.ok)throw new Error(r.status+': '+txt);try{return txt?JSON.parse(txt):null}catch{return txt}};
  const buildWsUrl=async(path,params)=>{const u=map(path),q=new URLSearchParams(params||{}).toString();return (location.protocol==='https:'?'wss://':'ws://')+location.host+u+(q?(u.includes('?')?'&':'?')+q:'')};
  const once=(k,msg)=>{if(P.warned.has(k))return;P.warned.add(k);console.warn('[plugins] '+msg)};
  const I18N=Object.freeze({t:Object.freeze({}),locale:Lang.cur==='id'?'id':'en',setLocale:l=>Lang.set(l)});
  function useToast(){const [t,setT]=useState(null);const showToast=useCallback((message,type)=>{setT({message:String(message),type});toast(String(message),type==='error'?'err':undefined)},[]);return {toast:t,showToast}}
  function useConfirmDelete({onDelete}={}){const [pid,setPid]=useState(null),[busy,setBusy]=useState(false);const ref=useRef(onDelete);ref.current=onDelete;
   return {pendingId:pid,isOpen:pid!==null,isDeleting:busy,requestDelete:id=>setPid(id),cancel:()=>{if(!busy)setPid(null)},confirm:async()=>{if(pid===null)return;setBusy(true);try{await ref.current?.(pid);setPid(null)}catch(e){fail(e)}finally{setBusy(false)}}}}
  // appearing and leaving with aqeelOS's pop-up motion: kept on screen for the closing animation
  function useShown(open){const [m,setM]=useState(!!open),[c,setC]=useState(false);useEffect(()=>{if(open){setM(true);setC(false);return}if(!m)return;setC(true);const t=setTimeout(()=>{setM(false);setC(false)},calm()?0:200);return ()=>clearTimeout(t)},[open]);return [m||!!open,c&&!open]}
  const BTN={default:'primary',primary:'primary',destructive:'primary plug-danger',ghost:'ghost',link:'btnlink',outline:'',secondary:''},SIZE={sm:'small',xs:'small',icon:'icon'};
  const Button=p=>h('button',{type:'button',...strip(p,'variant','size','asChild','loading'),className:cn(BTN[p.variant]||'',SIZE[p.size]||'',p.loading&&'is-busy',p.className)},p.children);
  const BADGE={destructive:'bad',success:'ok',warning:'warn',default:'',secondary:'',outline:''};
  const Badge=p=>h('span',{...strip(p,'variant'),className:cn('chip plug-chip',BADGE[p.variant]||'',p.className)},p.children);
  const div=(cls,tag='div')=>p=>h(tag,{...p,className:cn(cls,p.className)},p.children);
  const Card=div('card plug-card'),CardHeader=div('plug-card-head'),CardTitle=div('plug-card-title','h3'),CardDescription=div('plug-card-desc','p'),CardContent=div('plug-card-body'),CardFooter=div('plug-card-foot');
  const Input=p=>h('input',{...strip(p,'children'),className:cn('plug-input',p.className)}),Textarea=p=>h('textarea',{...strip(p,'children'),className:cn('plug-input',p.className)}),Label=div('plug-label','label');
  const tick=(cls)=>p=>h('input',{type:'checkbox',...strip(p,'onCheckedChange','checked','children'),checked:p.checked===undefined?undefined:!!p.checked,className:cn(cls,p.className),onChange:e=>{p.onCheckedChange?.(e.target.checked);p.onChange?.(e)}});
  const Checkbox=tick(''),Switch=tick('switch');
  // a native list, turned into aqeelOS's menu button by enhanceSelect; the wrapper keeps that button with it
  function Select(p){const ref=useRef(null);useEffect(()=>{ref.current?._sync?.()});const {onValueChange,onChange,className,children,placeholder}=p;
   return h('span',{className:cn('plug-select',className)},h('select',{...strip(p,'onValueChange','onChange','className','children','placeholder'),ref,onChange:e=>{if(onValueChange)onValueChange(e.target.value);else onChange?.(e)}},placeholder!=null?h('option',{value:'',disabled:true},placeholder):null,children))}
  const SelectOption=p=>h('option',p,p.children);
  const Separator=p=>h('div',{role:'separator',...strip(p,'orientation','decorative'),className:cn('plug-sep',p.orientation==='vertical'&&'v',p.className)});
  const TabsCtx=createContext(null);
  function Tabs(p){const [own,setOwn]=useState(p.defaultValue);const value=p.value!==undefined?p.value:own;const set=v=>{if(p.value===undefined)setOwn(v);p.onValueChange?.(v)};return h(TabsCtx.Provider,{value:{value,set}},h('div',{className:cn('plug-tabs',p.className)},p.children))}
  function TabsList(p){const id=useId();useEffect(()=>{placePills()});return h('div',{className:cn('tabs',p.className),'data-tabs':'plug'+id,role:'tablist'},p.children,h('span',{className:'pill'}))}
  function TabsTrigger(p){const c=useContext(TabsCtx);const on=c?.value===p.value;return h('button',{type:'button',role:'tab','aria-selected':on,disabled:p.disabled,className:cn(on&&'on',p.className),onClick:()=>c?.set(p.value)},p.children)}
  function TabsContent(p){const c=useContext(TabsCtx);return c?.value===p.value?h('div',{role:'tabpanel',className:p.className},p.children):null}
  const DlgCtx=createContext(null);
  function Dialog(p){const [own,setOwn]=useState(!!p.defaultOpen);const open=p.open!==undefined?!!p.open:own;const set=v=>{if(p.open===undefined)setOwn(v);p.onOpenChange?.(v)};return h(DlgCtx.Provider,{value:{open,set}},p.children)}
  const asBtn=(p,on)=>p.asChild&&R.isValidElement(p.children)?R.cloneElement(p.children,{onClick:e=>{p.children.props.onClick?.(e);on()}}):h(Button,{...strip(p,'asChild'),onClick:e=>{p.onClick?.(e);on()}},p.children);
  function DialogTrigger(p){const c=useContext(DlgCtx);return asBtn(p,()=>c?.set(true))}
  function DialogClose(p){const c=useContext(DlgCtx);return asBtn({variant:'ghost',...p},()=>c?.set(false))}
  function DialogContent(p){const c=useContext(DlgCtx);const [shown,closing]=useShown(c?.open);const box=useRef(null);
   useEffect(()=>{if(!c?.open)return;const k=e=>{if(e.key==='Escape'){e.stopPropagation();c.set(false)}};document.addEventListener('keydown',k,true);const t=setTimeout(()=>box.current?.querySelector('input:not([type=checkbox]),textarea,select,button.primary')?.focus(),40);return ()=>{document.removeEventListener('keydown',k,true);clearTimeout(t)}},[c?.open]);
   if(!shown)return null;return RD.createPortal(h('div',{className:'plug-layer plug-host','data-anim':''},h('div',{className:cn('plug-scrim',closing&&'closing'),onClick:()=>c?.set(false)}),
    h('div',{ref:box,role:'dialog','aria-modal':'true',className:cn('plug-dlg',closing&&'closing',p.className)},h('button',{type:'button',className:'ghost icon plug-x','aria-label':'Close',onClick:()=>c?.set(false),dangerouslySetInnerHTML:{__html:icon('x',18)}}),p.children)),document.body)}
  const DialogHeader=div('plug-dlg-head'),DialogTitle=div('plug-dlg-title','h2'),DialogDescription=div('hint plug-dlg-desc','p'),DialogFooter=div('plug-dlg-foot');
  const ConfirmDialog=p=>h(Dialog,{open:!!p.open,onOpenChange:o=>{if(!o)p.onCancel?.()}},h(DialogContent,{className:'sm'},h(DialogHeader,null,h(DialogTitle,null,p.title),p.description?h(DialogDescription,null,p.description):null),p.children,
   h(DialogFooter,null,h(Button,{variant:'ghost',onClick:()=>p.onCancel?.()},p.cancelLabel||'Cancel'),h(Button,{variant:p.destructive?'destructive':'default',loading:!!(p.loading||p.isDeleting),disabled:!!(p.loading||p.isDeleting),onClick:()=>p.onConfirm?.()},p.confirmLabel||'Confirm'))));
  // toasts already show through aqeelOS's own (useToast); this part stays for bundles that mount it
  const Toast=()=>null;
  const Spinner=p=>h('span',{className:cn('plug-spin',p.className),role:'status','aria-label':'Loading'});
  const Skeleton=p=>h('div',{className:cn('skel plug-skel',p.className),style:p.style});
  const EMPTY=[];
  function PluginSlot(p){const list=useSyncExternalStore(P.sub,()=>P.slotReg.get(p.name)||EMPTY);if(!list.length)return p.fallback??null;return h(R.Fragment,null,...list.map(e=>h(B,{key:e.plugin,name:e.plugin,small:true},h(e.component))))}
  function ErrCard(p){return h('div',{className:cn('card state-box err plug-err',p.small&&'small'),role:'alert'},h('b',null,'This plugin couldn\'t load'),h('span',null,p.msg),p.retry?h('button',{type:'button',className:'small',onClick:p.retry},'Try again'):null)}
  class B extends R.Component{constructor(p){super(p);this.state={err:null}}static getDerivedStateFromError(err){return {err}}componentDidCatch(e){console.warn('[plugins]',this.props.name,e)}
   render(){const e=this.state.err;return e?h(ErrCard,{small:this.props.small,msg:String(e?.message||e).slice(0,300),retry:()=>this.setState({err:null})}):this.props.children}}
  function PageView(p){const C=useSyncExternalStore(P.sub,()=>P.reg.get(p.name)||null);const err=useSyncExternalStore(P.sub,()=>P.errOf(p.name));
   if(C)return h(C);if(err)return h(ErrCard,{msg:err,retry:()=>P.retry(p.name)});return h('div',{className:'skel loading',role:'status','aria-label':'Loading'},h('span',{className:'ring'}))}
  this.B=B;this.PageView=PageView;
  const base={Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter,Badge,Button,Checkbox,Switch,ConfirmDialog,Dialog,DialogTrigger,DialogClose,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle,Input,Textarea,Label,Select,SelectOption,Separator,Tabs,TabsList,TabsTrigger,TabsContent,Toast,Spinner,Skeleton,PluginSlot};
  // a part aqeelOS doesn't have yet shows what is inside it, and says so once in the console
  const known=new Set(Object.keys(base)),skip=new Set(['then','toJSON','$$typeof','prototype','constructor']);
  const components=new Proxy(base,{get:(t,k)=>typeof k!=='string'||skip.has(k)?t[k]:k in t?t[k]:(t[k]=pp=>{once('c:'+k,'aqeelOS has no "'+k+'" part; showing what is inside it.');return h(R.Fragment,null,pp?.children??null)}),has:(t,k)=>known.has(k)});
  const api=new Proxy({getStatus:()=>fetchJSON('/api/status')},{get:(t,k)=>typeof k!=='string'||skip.has(k)||k in t?t[k]:(...a)=>{once('a:'+k,'the engine client call "'+k+'" is not available in aqeelOS.');return Promise.reject(new Error('Not available here.'))}});
  const KNOWN_SLOTS=new Set(['backdrop','header-left','header-right','header-banner','sidebar','pre-main','post-main','footer-left','footer-right','overlay',...['sessions','analytics','logs','cron','skills','plugins','config','env','docs','chat'].flatMap(s=>[s+':top',s+':bottom'])]);
  window.__HERMES_PLUGINS__={register(name,C){P.errs.delete(name);P.reg.set(String(name),C);P.ping()},
   // the engine's order is (plugin, slot, part); a slot name given first is taken the other way round
   registerSlot(a,b,C){let [plugin,slot]=[String(a),String(b)];if(KNOWN_SLOTS.has(plugin)&&!KNOWN_SLOTS.has(slot))[plugin,slot]=[slot,plugin];P.slotReg.set(slot,[...(P.slotReg.get(slot)||[]).filter(e=>e.plugin!==plugin),{plugin,component:C}]);P.ping()}};
  this.SDK=window.__HERMES_PLUGIN_SDK__={sdkVersion:'1.1.0',React:R,hooks:{useState,useEffect,useCallback,useMemo,useRef,useContext,createContext,useToast,useConfirmDelete},api,fetchJSON,authedFetch,buildWsUrl,buildWsAuthParam:async()=>['ticket',''],components,
   utils:{cn,timeAgo:ms=>ago(Number(ms)/1000),isoTimeAgo:iso=>ago(Date.parse(iso)/1000)},useI18n:()=>I18N}}
};
