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
 const Inbox={unread:()=>3},icon=()=>'<svg></svg>';const bell=new Function('Inbox','icon',grab('core.js','function bellBtn(')+'\nreturn bellBtn()')(Inbox,icon);
 assert.match(bell,/class="ghost icon bell has"/);assert.match(bell,/data-n="3"/);assert.match(bell,/<span class="bell-n">3<\/span>/);
 const none=new Function('Inbox','icon',grab('core.js','function bellBtn(')+'\nreturn bellBtn()')({unread:()=>0},icon);assert.match(none,/class="ghost icon bell"/);
 assert.equal((src('core.js').match(/\$\{bellBtn\(\)\}/g)||[]).length,2,'full topbar and the side-panel topbar');
 // what paintBell compares against: drawn already, it has nothing to do
 assert.match(src('notices.js'),/if\(b\.dataset\.n===String\(n\)\)return/)});

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

test('the sweep never counts a first entrance as a replay: text round a block still fading in is not "shown" yet',()=>{
 const sw=readFileSync(new URL('./sweep.js',import.meta.url),'utf8');
 assert.match(sw,/const snap=\(\)=>\{shown=new Set\(\);const fl=\$\('#view'\)\?\.getAnimations\(\{subtree:true\}\)/);
 assert.match(sw,/if\(fl\.some\(f=>el\.contains\(f\)\)\)continue/)});

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
