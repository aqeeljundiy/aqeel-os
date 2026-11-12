// Flicker fixes (7 Nov 2026), checked against the real source of the app files. morph() runs on a small stand-in DOM:
// what is still there stays the same element (pictures don't load again, hover and focus stay), only what differs changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
const grab=(f,start)=>{const s=src(f),i=s.indexOf(start);assert.ok(i>=0,start+' not found in '+f);let j=s.indexOf('\n',i);while(/^\s/.test(s.slice(j+1,j+2)))j=s.indexOf('\n',j+1);return s.slice(i,j)};

/* ---------- a stand-in DOM: just what morph uses ---------- */
class N{constructor(t){this.nodeType=t;this.parentNode=null;this.childNodes=[]}
 get firstChild(){return this.childNodes[0]||null}
 get nextSibling(){const p=this.parentNode;if(!p)return null;return p.childNodes[p.childNodes.indexOf(this)+1]||null}
 insertBefore(n,ref){n.parentNode?.childNodes.splice(n.parentNode.childNodes.indexOf(n),1);const i=ref?this.childNodes.indexOf(ref):this.childNodes.length;this.childNodes.splice(i<0?this.childNodes.length:i,0,n);n.parentNode=this;return n}
 append(...l){for(const n of l)this.insertBefore(n,null)}
 remove(){if(this.parentNode){this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null}}}
class T extends N{constructor(v){super(3);this.nodeValue=v}}
class E extends N{constructor(tag,attrs={},...kids){super(1);this.tagName=tag.toUpperCase();this.attrs=new Map(Object.entries(attrs));this.value=attrs.value??'';this.checked='checked' in attrs;this.type=attrs.type||'';for(const k of kids)this.append(typeof k==='string'?new T(k):k)}
 get id(){return this.attrs.get('id')||''}
 get attributes(){return [...this.attrs].map(([name,value])=>({name,value}))}
 getAttribute(n){return this.attrs.has(n)?this.attrs.get(n):null}hasAttribute(n){return this.attrs.has(n)}
 setAttribute(n,v){this.attrs.set(n,String(v))}removeAttribute(n){this.attrs.delete(n)}
 get classList(){const e=this,l=()=>(e.attrs.get('class')||'').split(/\s+/).filter(Boolean);return {contains:c=>l().includes(c)}}}
const h=(tag,attrs,...kids)=>new E(tag,attrs||{},...kids);
const frag=(...kids)=>{const f=new N(11);f.append(...kids);return f};
const morph=new Function('document',[grab('core.js','const MORPH_KEEP_CLS='),grab('core.js','function morphKey('),grab('core.js','function morphKids('),grab('core.js','function morphNode('),'return {morphKids,morphNode}'].join('\n'));
const doc={activeElement:null};const {morphKids}=morph(doc);

test('morph keeps every element that is still there and changes only what differs',()=>{
 const img=h('img',{src:'/logo.png',class:'mark'}),title=h('b',{},'Dora');
 const root=h('div',{},h('span',{class:'wordmark'},img),h('span',{class:'who'},title,h('em',{},'Online')));
 morphKids(root,frag(h('span',{class:'wordmark'},h('img',{src:'/logo.png',class:'mark'})),h('span',{class:'who'},h('b',{},'Dora'),h('em',{},'Offline'))));
 assert.equal(root.childNodes[0].childNodes[0],img,'the logo picture is the same element (it does not load again)');
 assert.equal(root.childNodes[1].childNodes[0],title);
 assert.equal(root.childNodes[1].childNodes[1].childNodes[0].nodeValue,'Offline')});

test('morph matches rows by their key, so a reorder or a new row keeps the others',()=>{
 const a=h('button',{'data-go':'/chat/a',class:'item'},'A'),b=h('button',{'data-go':'/chat/b',class:'item on'},'B');
 const list=h('div',{},a,b);
 morphKids(list,frag(h('button',{'data-go':'/chat/new',class:'item'},'New'),h('button',{'data-go':'/chat/b',class:'item'},'B'),h('button',{'data-go':'/chat/a',class:'item on'},'A')));
 assert.deepEqual(list.childNodes.map(x=>x.getAttribute('data-go')),['/chat/new','/chat/b','/chat/a']);
 assert.equal(list.childNodes[1],b);assert.equal(list.childNodes[2],a);
 assert.equal(a.getAttribute('class'),'item on');assert.equal(b.getAttribute('class'),'item')});

test('morph removes what is gone and adds what is new',()=>{
 const list=h('div',{},h('p',{},'one'),h('p',{},'two'),h('p',{},'three'));
 morphKids(list,frag(h('p',{},'one'),h('h2',{},'new')));
 assert.deepEqual(list.childNodes.map(x=>x.tagName+':'+x.childNodes[0].nodeValue),['P:one','H2:new'])});

test('morph keeps what scripts own: the tab pill place, a running spinner, a finished fade, an open details, typed text',()=>{
 const pill=h('span',{class:'pill',style:'left:40px;width:60px'}),btn=h('button',{class:'primary is-busy','aria-busy':'true'},'Save'),
  card=h('div',{class:'card reveal still'}),det=h('details',{open:''},h('summary',{},'More')),inp=h('input',{id:'chatSearch',value:'old'});
 inp.value='typed by hand';doc.activeElement=inp;
 const root=h('div',{},pill,btn,card,det,inp);
 morphKids(root,frag(h('span',{class:'pill'}),h('button',{class:'primary'},'Save'),h('div',{class:'card'}),h('details',{},h('summary',{},'More')),h('input',{id:'chatSearch',value:'old'})));
 assert.equal(pill.getAttribute('style'),'left:40px;width:60px');
 assert.ok(btn.classList.contains('is-busy'));assert.equal(btn.getAttribute('aria-busy'),'true');
 assert.ok(card.classList.contains('reveal')&&card.classList.contains('still'));
 assert.ok(det.hasAttribute('open'));
 assert.equal(inp.value,'typed by hand','the field being typed in keeps its text');
 doc.activeElement=null;morphKids(root,frag(h('span',{class:'pill'}),h('button',{class:'primary'},'Save'),h('div',{class:'card'}),h('details',{},h('summary',{},'More')),h('input',{id:'chatSearch',value:'new'})));
 assert.equal(inp.value,'new','a field nobody is typing in follows the markup')});

test('morph from a node leaves the earlier ones alone (a chat reply streaming in)',()=>{
 const m1=h('div',{class:'msg user'},'hi'),m2=h('div',{class:'msg ai'},h('img',{src:'/chart.png'}),h('p',{},'Here'));const pic=m2.childNodes[0];
 const th=h('div',{},m1,m2);
 morphKids(th,frag(h('div',{class:'msg ai'},h('img',{src:'/chart.png'}),h('p',{},'Here is'))),m2);
 assert.equal(th.childNodes[0],m1);assert.equal(th.childNodes[1],m2);assert.equal(m2.childNodes[0],pic,'the picture in the reply stays');
 assert.equal(m2.childNodes[1].childNodes[0].nodeValue,'Here is')});

/* ---------- where it is used ---------- */
test('the sidebar, topbar, banners, composer bar, Kirimdev, Teams and Connections rows update in place',()=>{
 const core=src('core.js');
 assert.match(core,/function paintSide\(r\)\{[^\n]*morph\(el,h\)/);assert.match(core,/function paintTop\(r\)\{[^\n]*morph\(el,h\)/);assert.match(core,/slot\._h=h;smoothHeight\(slot,\(\)=>morph\(slot,h\)\)/);
 assert.match(src('chat.js'),/paintComposerBar\(\)\{const b=\$\('#cbar'\);if\(b\)morph\(b,/);
 assert.match(src('chat.js'),/morphKids\(th,f,start\)/,'the streaming reply is updated in place');
 assert.match(src('kirimdev-page.js'),/else morph\(box,html\)/);assert.match(src('teams-page.js'),/morph\(box,html\)/);
 assert.match(src('connections.js'),/else morph\(box,html\)/);
 assert.doesNotMatch(src('kirimdev-page.js')+src('teams-page.js'),/classList\.add\('km-fresh'\)/,'no whole-list fade for one changed line')});

test('the topbar draws the bell with its count, so a page switch never blanks or re-pops it',()=>{
 const Inbox={shown:()=>3},icon=()=>'<svg></svg>';const bell=new Function('Inbox','icon',grab('core.js','function bellBtn(')+'\nreturn bellBtn()')(Inbox,icon);
 assert.match(bell,/class="ghost icon bell has"/);assert.match(bell,/data-n="3"/);assert.match(bell,/<span class="bell-n">3<\/span>/);
 const none=new Function('Inbox','icon',grab('core.js','function bellBtn(')+'\nreturn bellBtn()')({shown:()=>0},icon);assert.match(none,/class="ghost icon bell"/);
 assert.equal((src('core.js').match(/\$\{bellBtn\(\)\}/g)||[]).length,2,'full topbar and the side-panel topbar');
 // what paintBell compares against: drawn already, it has nothing to do
 assert.match(src('notices.js'),/if\(b\.dataset\.n===String\(n\)\)return/);

 // OPS-14 (12 Nov 2026): before this page load's first answer the bell shows the count this browser last saw, so a reload or a first page
 // never draws it at 0 and then pops it in; after the first answer it is the real count (which is saved for the next load)
 const mem=new Map(),mk=()=>new Function('store',grab('notices.js','const Inbox=').replace('const Inbox=','return '))({get:(k,d)=>mem.has(k)?mem.get(k):d,set:(k,v)=>mem.set(k,v)});
 const I=mk();mem.set('bellN',4);assert.equal(I.shown(),4,'nothing answered yet: the last known count');
 I.items=[{read:false}];assert.equal(I.shown(),1,'an item of this tab is counted at once');
 const J=mk();J.loaded=true;assert.equal(J.shown(),0,'answered: the real count, even when it is 0');
 mem.set('bellN','x');assert.equal(mk().shown(),0,'a damaged saved count is ignored')});

test('pop-ups play their own entrance (the palette was finished in one frame) and leave from where they are',()=>{
 const core=src('core.js');const layers=core.match(/LAYERS:'([^']+)'/)[1];
 for(const s of ['.palette','.scrim','.drawer','.menu','dialog','.plug-dlg'])assert.ok(layers.split(',').includes(s),s);
 assert.match(core,/calm\(n\)\{if\(performance\.now\(\)<this\.until\|\|n\.closest\?\.\(this\.LAYERS\)\)return/);
 assert.match(grab('core.js','function leave('),/commitStyles\(\)/)});

test('no two @keyframes share a name (popOut for the palette and for dialogs made the palette jump as it closed)',()=>{
 const seen=new Map();for(const f of readdirSync(new URL('../app/',import.meta.url)).filter(f=>f.endsWith('.css')))for(const m of src(f).matchAll(/@keyframes\s+([\w-]+)/g)){
  // the same name inside @media (prefers-reduced-motion) or a dark variant would be fine, but there are none: any repeat is a clash
  assert.ok(!seen.has(m[1]),`@keyframes ${m[1]} in ${f} and ${seen.get(m[1])}`);seen.set(m[1],f)}
 assert.match(src('app.css'),/\.palette\.closing\{animation:paletteOut/)});

test('placeholders wait 200 ms before showing, and the busy spinner never blinks',()=>{
 const css=src('app.css');
 assert.match(css,/\.skel\.loading\{[^}]*ringIn \.25s \.2s/);assert.match(css,/\.sk-item\{[^}]*animation-delay:calc\(var\(--d,0ms\) \+ 200ms\)/);assert.match(css,/\.skel-row\{[^}]*skelIn \.3s \.2s/);
 const pb=grab('core.js','function pressBusy(');assert.match(pb,/},200\)/);assert.match(pb,/350-\(performance\.now\(\)-b\._busyAt\)/)});

test('the composer bar never grows a line for the moment a reply is connecting',()=>{
 assert.match(src('chat.js'),/s\.conn==='live'\|\|s\.conn==='connecting'\?'':esc\(CONN_TEXT\[s\.conn\]\)/)});

test('the brand font is preloaded, so text does not change shape a moment after the first load',()=>{
 assert.match(src('index.html'),/<link rel="preload" href="\/assets\/plus-jakarta-sans\.woff2" as="font" type="font\/woff2" crossorigin>/)});

test('late cards open their space and lists change height smoothly',()=>{
 const core=src('core.js');assert.match(core,/watchReveal\(v\);watchLate\(v\);/);assert.match(core,/const Late=\{/);assert.match(core,/function smoothHeight\(box,fn\)/);
 assert.match(src('connections.js'),/smoothHeight\(box,draw\)/)});


/* ---------- 12 Nov 2026: a page is drawn out of sight and shown whole; last-known answers while it is drawn ---------- */
test('opening a page never blanks the view: render hands the drawing to Stage, which keeps what is on screen until the new page is whole',()=>{
 const core=src('core.js'),render=core.slice(core.indexOf('function render(){'),core.indexOf('/* A page is drawn out of sight'));
 assert.match(render,/if\(same\)Stage\.same\(v,run\);else Stage\.open\(v,head\(r\.page\),run,fresh\?enter:null\)/);
 assert.doesNotMatch(render,/v\.innerHTML=`<div class="page">\$\{head\(r\.page\)\}<div id="pg">\$\{skeleton\(\)\}/,'no blank-then-ring page in render');
 const stage=grab('core.js','const Stage={');
 assert.match(stage,/v\.prepend\(pageEl\)/,'the new page sits before the old one, so lookups by id find the new one');
 assert.match(stage,/live\.before\(pg\)/);assert.match(stage,/if\(st\.kind==='pg'&&!st\.pg\.firstChild\)return/,'the same page drawn again never swaps to nothing');
 assert.match(stage,/if\(!pg\.firstChild\)pg\.innerHTML=skeleton\(\)/,'a page with nothing drawn at the limit keeps the ring');
 assert.match(src('app.css'),/\.staged\{visibility:hidden!important;height:0!important/);
 // late blocks and loaded fades are for what is on screen
 assert.match(core,/function watchReveal\(root\)\{[^\n]*if\(m\.target\.closest\?\.\('\.staged'\)\)continue/);
 assert.match(core,/if\(!m\.target\.closest\?\.\('#pg'\)\|\|m\.target\.closest\('\.staged'\)\)continue/)});

const mkSwr=()=>{const S={_nav:1},again=[];const Swr=new Function('S','Stage',grab('core.js','const Swr={')+'\nreturn Swr')(S,{again:()=>again.push(1)});return {S,Swr,again}};
const tick=()=>new Promise(r=>setTimeout(r,5));
test('last-known answers: only while a page is drawn, asked again behind it, and the page is drawn once more only when an answer differs',async()=>{
 const {S,Swr,again}=mkSwr();let asks=0;const ask=v=>()=>{asks++;return Promise.resolve(v)};
 Swr.put('/ui/x',{n:1});
 assert.equal(Swr.take('/ui/x',ask({n:1})),undefined,'a timer or a button always asks the server');
 let tok=Swr.begin();assert.deepEqual(Swr.take('/ui/x',ask({n:1})),{n:1});assert.equal(asks,0,'an answer a few seconds old is not asked again');
 Swr.m.get('/ui/x').t-=20000;
 const a=Swr.take('/ui/x',ask({n:1}));a.n=99;assert.deepEqual(Swr.take('/ui/x',ask({n:1})),{n:1},'each caller gets its own copy');assert.equal(asks,0);
 await tick();assert.equal(asks,1,'one read behind the scenes, however many parts asked');Swr.end(tok);await tick();assert.equal(again.length,0,'the same answer: nothing is drawn again');
 Swr.m.get('/ui/x').t-=20000;tok=Swr.begin();Swr.take('/ui/x',ask({n:2}));Swr.end(tok);assert.equal(again.length,0,'not before the new answer is in');
 await tick();assert.equal(again.length,1,'a different answer draws the page once more');
 tok=Swr.begin();assert.deepEqual(Swr.take('/ui/x',ask({n:3})),{n:2});Swr.end(tok);await tick();assert.equal(again.length,1,'and that drawing uses the new answer without asking again');
 // another visit: answers on their way for the old one never redraw the new page
 Swr.m.get('/ui/x').t-=20000;tok=Swr.begin();Swr.take('/ui/x',ask({n:4}));S._nav=2;Swr.end(tok);await tick();assert.equal(again.length,1);
 // a change forgets everything; too old is not used; logs are never kept
 Swr.clear();tok=Swr.begin();assert.equal(Swr.take('/ui/x',ask(0)),undefined);
 Swr.put('/ui/y',[1]);Swr.m.get('/ui/y').t-=16*60e3;assert.equal(Swr.take('/ui/y',ask(0)),undefined);
 Swr.put('/hapi/logs?lines=200',['a']);assert.equal(Swr.m.has('/hapi/logs?lines=200'),false)});

test('reads go through the last-known answers, and every change forgets them',()=>{
 const c=grab('core.js','async function call(');
 assert.match(c,/const last=k\?Swr\.take\(base\+path,\(\)=>callRaw\(base,path,opt\)\):undefined/);
 assert.match(c,/if\(!get\)Swr\.clear\(\)/);assert.match(c,/if\(last===undefined\)req\.then\(d=>Swr\.put\(base\+path,d\)/)});

test('the flicker check fails on a redrawn shell and on a page that moves, and runs every night and in GitHub Actions',()=>{
 const sw=readFileSync(new URL('./sweep.js',import.meta.url),'utf8');
 assert.match(sw,/const SHIFT_MAX=0\.05/);assert.match(sw,/if\(shift>SHIFT_MAX\)\{bad\+\+/);
 assert.match(sw,/tg\.closest\('\.side-sub,\.crumbs'\)/);assert.match(sw,/if\(shell\.length\)\{bad\+\+/);
 const bc=readFileSync(new URL('./box-check.sh',import.meta.url),'utf8');
 // the nightly run (BROWSER_ONLY=1) reaches the sweep, and only FLICKER_CHECK=0 skips it
 assert.match(bc,/if \[ "\$\{FLICKER_CHECK:-1\}" = 0 \]; then echo "· 2\/5 fast page switching: skipped/);assert.match(bc,/node scripts\/shot\.mjs \/tmp\/sweep\.png "#\/chat" "" "" 1280 900 "\$\(cat scripts\/sweep\.js\)"/);
 assert.doesNotMatch(readFileSync(new URL('../app/browser-checks.mjs',import.meta.url),'utf8'),/FLICKER_CHECK/,'the nightly run never switches the flicker check off');
 const wf=readFileSync(new URL('../.github/workflows/tests.yml',import.meta.url),'utf8');assert.match(wf,/node scripts\/flicker-ci\.mjs/)});


/* ---------- OPS-14 (12 Nov 2026): what the sweep found on P&P's test copy ---------- */
test('a row of tabs is drawn with its tab roles and its chosen tab (not only after placePills has run)',()=>{
 const esc=x=>String(x),S={tab:{}};const t=new Function('esc','S',grab('core.js','function tabs(key,list,cur)')+'\nreturn tabs')(esc,S);
 const h=t('health',['Now','History'],'History');
 assert.match(h,/<div class="tabs" role="tablist" data-tabs="health">/);assert.match(h,/class="on" data-tab="History" role="tab" aria-selected="true" tabindex="0"/);assert.match(h,/data-tab="Now" role="tab" aria-selected="false" tabindex="-1"/)});
test('a file tile and a file row are not a button inside a button: the open action is a real button, the options button is its sibling',()=>{
 const f=src('files.js');
 for(const name of ['const tile=','const row=','const upTile=','const upRow=']){const l=f.split('\n').find(x=>x.includes(name));assert.ok(l,name);assert.doesNotMatch(l,/tabindex="0"/,name+' holds no tab stop of its own');assert.match(l,/ rm[ "]/,name+' is a row-main row');assert.match(l,/<button type="button" class="row-main" data-act="f-(open|cd)"/,name)}
 assert.match(src('app.css'),/\.ftile\.rm \.fmore\{position:absolute;z-index:1\}/)});
test('the same page drawn again (Stage.same) shows no entrance again: its animations are finished at the swap; the sweep ignores what still runs out of sight',()=>{
 const c=src('core.js');assert.ok(c.includes("live.remove();pg.classList.remove('staged');Calm.settle(pg);"));assert.ok(c.includes(' settle(n){for(const a of n.getAnimations'));
 assert.ok(readFileSync(new URL('./sweep.js',import.meta.url),'utf8').includes("if(t.isConnected&&!t.closest('.staged')&&t.getAnimations()")); assert.ok(readFileSync(new URL('./sweep.js',import.meta.url),'utf8').includes("fetch('/ui/connections?fresh=1'"))});
/* ---------- 12 Nov 2026: the sweep waits for a page to have settled (real conditions, no timer) and says precisely what a flicker is ---------- */
test('the sweep: a page has settled only when nothing is being drawn or read, no placeholder shows and no entrance runs',async()=>{
 const sw=readFileSync(new URL('./sweep.js',import.meta.url),'utf8');
 const a=sw.indexOf("const LAYER="),b=sw.indexOf("let phase='off'");assert.ok(a>0&&b>a);
 const mk=new Function('document','Swr','S','Calm',sw.slice(a,b)+'\nreturn busy');
 const anim=(name,o={})=>({animationName:name,playState:o.state||'running',effect:{getTiming:()=>({iterations:o.forever?Infinity:1}),target:{closest:s=>o.in&&s.includes(o.in)?{}:null}}});
 const view={_stage:null,staged:null,skels:[],anims:[],querySelector(s){return s==='.staged'?this.staged:null},querySelectorAll(){return this.skels},getAnimations(){return this.anims}};
 const Swr={flying:0,flyNav:7,wait:0,drawing:0,nav:7},S={_nav:7},Calm={entry:()=>new Set(['viewIn','reveal'])};
 const busy=mk({querySelector:s=>s==='#view'?view:null},Swr,S,Calm);
 assert.equal(busy(),'','nothing going on: settled');
 view._stage={};assert.equal(busy(),'being drawn');view._stage=null;view.staged={};assert.equal(busy(),'being drawn','a drawing still out of sight');view.staged=null;
 Swr.flying=2;assert.equal(busy(),'reading');Swr.flyNav=6;assert.equal(busy(),'','reads of a page that was left do not count');Swr.flyNav=7;Swr.flying=0;
 Swr.wait=1;assert.match(busy(),/reading again/,'a last-known answer is being checked: the page may be drawn once more');Swr.wait=0;
 Swr.drawing=1;assert.match(busy(),/reading again/);Swr.nav=3;assert.equal(busy(),'');Swr.drawing=0;
 const skel=(shown,desc)=>({offsetParent:shown?{}:null,closest:()=>desc?{}:null});
 view.skels=[skel(true)];assert.equal(busy(),'a loading placeholder');view.skels=[skel(false),skel(true,true)];assert.equal(busy(),'','a hidden placeholder and a summary still being written do not hold the page');view.skels=[];
 view.anims=[anim('reveal')];assert.equal(busy(),'its entrance');
 view.anims=[anim('reveal',{state:'finished'}),anim('spin'),anim('viewIn',{forever:true}),anim('reveal',{in:'.staged'}),anim('viewIn',{in:'.toast'})];assert.equal(busy(),'','finished, endless, out of sight or on a layer: not the page entering');
 assert.equal(mk({querySelector:()=>null},Swr,S,Calm)(),'no page')});
test('the sweep: waits for settled instead of a timer, fails a page that never settles, and after settling counts every entrance (again or late)',()=>{
 const sw=readFileSync(new URL('./sweep.js',import.meta.url),'utf8');
 assert.doesNotMatch(sw,/await sl\(DWELL\[0\]\)/,'no fixed wait before judging a page');
 assert.match(sw,/while\(performance\.now\(\)-t0<LOAD_MAX\)\{await sl\(40\);const b=busy\(\)/);assert.match(sw,/else if\(t-q>=QUIET\)\{ok=true;break\}/);
 assert.match(sw,/never finished loading/);assert.match(sw,/slowPages/,'a slow page is named, not hidden and not called a flicker');
 // 12 Nov 2026: a comment had swallowed "if(!shown.has(sig(t)))return", so every first entrance after 2.5 s counted as a replay. Which of the two it is is now said
 assert.match(sw,/again=ph==='watch'\?shown\.has\(x\):t\.id!=='view'&&played\.has\(x\);if\(ph==='load'&&!again\)return;/);
 assert.match(sw,/\(again\?' again':' late'\)/);assert.match(sw,/a\.id==='late'&&a\.playState==='running'/,'a block opening its space on a settled page is late too');
 assert.match(sw,/if\(!b\|\|performance\.now\(\)-b<120\)return/,'an entrance Calm ended in its first frame never played');
 for(const l of sw.split('\n'))assert.doesNotMatch(l,/\/\/[^\n]*\bif\(!?\w+\.has\(/,'no rule sits behind a comment on its line');
 assert.match(sw,/document\.querySelector\('\.side'\)&&document\.querySelector\('\.topbar'\)/,'the shell is there before it is watched');
 assert.ok(src('core.js').includes('const Stage={ms:450,max:2200,hard:6000,'));
 assert.match(sw,/SLOW=6000,/,'every page a person looked at the ring for as long as Stage holds it is named (Stage.hard)');
 // the palette's fade is judged by time, not by frames: two frames on a busy browser can outlast the whole fade; never judged is said, not passed quietly
 assert.match(sw,/if\(p&&o>\.9&&el<120\)\{bad\+\+;/);assert.match(sw,/the palette fade was not judged/)});

/* a drawing slower than Stage.max: shown as far as it is once it has stalled, held a little longer while its reads still answer (12 Nov 2026) */
test('Stage: a page whose reads keep answering is shown whole; one whose reads went silent for 2.2 s is shown as far as it is; none waits past 6 s',async()=>{
 // a clock and timers the test moves; promises get their turn after every timer
 const mk=()=>{let now=0,id=0;const tm=new Map();const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
  const clock={setTimeout:(fn,ms)=>{tm.set(++id,{at:now+(ms||0),fn});return id},clearTimeout:i=>tm.delete(i),performance:{now:()=>now},
   async adv(ms){const end=now+ms;for(;;){let k=null;for(const [i,t] of tm)if(t.at<=end&&(k===null||t.at<tm.get(k).at))k=i;if(k===null)break;const t=tm.get(k);tm.delete(k);now=Math.max(now,t.at);t.fn();await flush()}now=end}};
  const S={_nav:1},seen=[];class MO{constructor(cb){seen.push(cb)}observe(){}disconnect(){}}   // stands in for the browser's: draw() below says "something was drawn"
  const env=new Function('S','performance','setTimeout','clearTimeout','$','MutationObserver',grab('core.js','const Stage={')+'\n'+grab('core.js','const Swr={')+'\nreturn {Stage,Swr}')(S,clock.performance,clock.setTimeout,clock.clearTimeout,()=>null,MO);
  const shown=[],pg={isConnected:true,firstChild:{}},v={},st={pg,kind:'page',reveal:()=>shown.push(now)};
  // reads: each answers at its time (ms after opening); the page function itself ends at once
  // wait: the page function waits for its read that answers at that time (the others it fills without waiting)
  const open=async(reads,wait)=>{env.Stage.hold(v,st,()=>{let w;for(const ms of reads){const p=env.Swr.fly(new Promise(r=>clock.setTimeout(r,ms)));if(ms===wait)w=p}return w});await flush()};
  return {clock,open,shown,pg,draw(){pg.firstChild={};seen.at(-1)()}}};
 // answers every second until 3.4 s (Settings for all agents on a busy box): whole at 3.4 s, not half drawn at 2.2 s
 let x=mk();await x.open([900,1800,2700,3400]);await x.clock.adv(2300);assert.deepEqual(x.shown,[],'still being answered at 2.2 s: not shown half drawn');await x.clock.adv(1200);assert.equal(x.shown.length,1);assert.ok(x.shown[0]>=3400&&x.shown[0]<3500,'shown when whole, at '+x.shown[0]);
 // one read that does not come (Health's cost of the week took 15 to 29 s): shown 2.2 s after the last other answer, not at 6 s
 x=mk();await x.open([400,900,25000]);await x.clock.adv(3000);assert.deepEqual(x.shown,[],'2.1 s after the last answer');await x.clock.adv(200);assert.equal(x.shown.length,1);assert.ok(x.shown[0]>=3100&&x.shown[0]<3200,'at '+x.shown[0]);
 // nothing has answered at all (the engine hangs): the ring or the page's own grey placeholders are all there is to show either way, so it stays out of sight, 6 s at most
 x=mk();await x.open([30000]);await x.clock.adv(5900);assert.deepEqual(x.shown,[]);await x.clock.adv(200);assert.equal(x.shown.length,1);
 // every read answers late, at once (a busy box): not shown as placeholders at 2.2 s that then fill in view, but whole
 x=mk();await x.open([2500,2600,2900]);await x.clock.adv(2400);assert.deepEqual(x.shown,[]);await x.clock.adv(600);assert.equal(x.shown.length,1);assert.ok(x.shown[0]>=2900&&x.shown[0]<3000,'whole at '+x.shown[0]);
 // an answer came but nothing is drawn yet: still only the ring to show
 x=mk();x.pg.firstChild=null;await x.open([300,2900]);await x.clock.adv(2600);assert.deepEqual(x.shown,[],'empty 2.2 s after the answer: not shown as a ring that then fills in view');x.draw();await x.clock.adv(400);assert.equal(x.shown.length,1);assert.ok(x.shown[0]>=2900&&x.shown[0]<3000,'whole at '+x.shown[0]);
 x=mk();x.pg.firstChild=null;await x.open([30000]);await x.clock.adv(5900);assert.deepEqual(x.shown,[]);await x.clock.adv(200);assert.equal(x.shown.length,1,'6 s at most');
 // answers trickle in for ever: never past 6 s
 x=mk();await x.open(Array.from({length:12},(_,i)=>(i+1)*1500));await x.clock.adv(5900);assert.deepEqual(x.shown,[]);await x.clock.adv(200);assert.equal(x.shown.length,1);assert.ok(x.shown[0]>=6000&&x.shown[0]<6100,'at '+x.shown[0]);
 // the page function still waits for a read after a quick one (Models: its accounts, 3.1 s): not shown at 2.5 s without what it draws after that read
 x=mk();await x.open([300,3100],3100);await x.clock.adv(2800);assert.deepEqual(x.shown,[],'the page function has not drawn its last part yet');await x.clock.adv(400);assert.equal(x.shown.length,1);assert.ok(x.shown[0]>=3100&&x.shown[0]<3200,'whole at '+x.shown[0]);
 x=mk();await x.open([300,25000],25000);await x.clock.adv(5900);assert.deepEqual(x.shown,[]);await x.clock.adv(200);assert.equal(x.shown.length,1,'a page function that never ends: 6 s at most');
 // a quick page is shown the moment it is whole
 x=mk();await x.open([300]);await x.clock.adv(350);assert.equal(x.shown.length,1)});

test('a part that lands late keeps the space it took last time (Keep): Usage\'s Spending overview no longer drops the page under it',()=>{
 const mem=new Map(),localStorage={getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,String(v))};let width=1280;
 const Keep=new Function('localStorage','innerWidth',grab('core.js','const Keep={')+'\nreturn Keep'),K=()=>Keep(localStorage,width);
 const el=h=>({style:{},isConnected:true,offsetHeight:h});
 let p=el(0);assert.equal(K().hold('usage.spend',p),0,'never drawn in this browser: nothing held');assert.equal(p.style.minHeight,undefined);
 p=el(402.4);p.style.minHeight='300px';K().note('usage.spend',p);assert.equal(p.style.minHeight,'','the content is in: the hold is let go');assert.deepEqual(JSON.parse(mem.get('ph-here')),{'usage.spend@32':402});
 p=el(0);assert.equal(K().hold('usage.spend',p),402);assert.equal(p.style.minHeight,'402px','the next visit: its box is that tall while the placeholder shows');
 const gone={style:{minHeight:'1px'},isConnected:false,offsetHeight:0};K().note('usage.spend',gone);assert.equal(JSON.parse(mem.get('ph-here'))['usage.spend@32'],402,'a part that left the page records nothing');
 width=390;p=el(0);assert.equal(K().hold('usage.spend',p),0,'another window width (a phone): its own height, not the desk one');
 assert.doesNotMatch(grab('core.js','const Keep={'),/\bstore\./,'kept in this browser only: what goes through store follows the person to every device');assert.equal(/^(hui-|draft:|cronSeen:|chAlert:|cronFail:)/.test('ph-here'),false);
 const s=src('schedules.js');assert.ok(s.includes("const kk='usage.spend:'+(S.viewAll?'all':S.viewAgent||'own');{const h=Keep.hold(kk,panel)"),'per view: all agents is taller than one');assert.ok(s.includes('Keep.note(kk,panel)'));
 assert.match(s,/<div class="skel" style="height:280px"><\/div>';/,'before it is known: as tall as it usually is where the page is slow, not 120 px')});
test('Settings and Models: the parts added round the page ask with the page, not one after another once it has drawn',()=>{
 // 12 Nov 2026 (local sweep, engine answering in 0.2 to 5 s): Settings' wrappers each asked only after the page under them had finished, so their
 // reads ran in a row, past Stage.hard, and This install, the cloud fixer and the evening summary landed on a page already shown (369 px jump)
 const before=(f,head,read)=>{const s=grab(f,head),i=s.indexOf(read),j=s.search(/await (settings|base)\(p,el/);assert.ok(i>=0&&j>i,f+': '+read+' starts before the page under it is awaited')};
 before('install-page.js',"{const settings=PAGES.settings;","Install.load()");
 before('install-page.js',"{const base=PAGES.models;","Install.load()");
 before('all-agents-more.js',"{const settings=PAGES.settings;","H(prof('/env',who0))");
 before('cloud-fixer-page.js',"{const settings=PAGES.settings;","CloudFixer.load()");
 before('activity-page.js',"{const settings=PAGES.settings;","UI('/ui/notify-settings')");
 before('boot.js',"{const settings=PAGES.settings;","H('/shared-metrics/consent')");
 before('people.js',"{const base=PAGES.models;PAGES.models=async(p,el)=>{const gone=pageTok(el),pre","H('/config')");
 before('access.js',"{const base=PAGES.keys;","Access.load('key')");
 before('access-ask.js',"for(const id of Object.keys(ASK_KIND)){","UI('/ui/access/others");
 assert.match(grab('access-ask.js','async function askSection('),/await \(pre\|\|UI\('\/ui\/access\/others/);
 assert.match(grab('cloud-fixer-page.js','async function cfMount('),/await \(pre\|\|CloudFixer\.load\(\)\)/);
 assert.match(grab('people.js','async function moaPanel('),/await \(pre\|\|H\('\/config'\)\)/);
 assert.match(src('boot.js'),/await \(pre\|\|H\('\/shared-metrics\/consent'\)\)/);
 // Memory for all agents: the memory service is asked with the page, and each agent's two files at once
 const m=grab('all-agents-more.js',' async memory(p,el){');assert.ok(m.indexOf("prov=Promise.all([H('/memory')")>=0&&m.indexOf("prov=Promise.all([H('/memory')")<m.indexOf('await viewAgents()'));
 assert.match(m,/const \[m,hub\]=await prov;/);assert.match(m,/await Promise\.all\(\[read\(home\(a\)\+'MEMORY\.md'\),read\(home\(a\)\+'USER\.md'\)\]\)/)});
