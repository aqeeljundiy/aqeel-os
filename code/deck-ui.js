// Slide editor in the Artifacts panel: thumbnail strip (drag to reorder), the current slide large with text you can
// edit in place, layout and notes, per-slide AI actions, and present mode. The deck stays data (deck.json).
// Like Google Slides: click anything to select it (Shift adds), drag to move with snapping, corner handles resize,
// the round handle rotates, Insert adds text boxes, shapes and images, Arrange aligns, orders and sizes exactly.
import {slideBlock,paintSlides,paintFormatting,fieldCss,itemCss,cropCss,ratioOf,SIZES,FONTS,LAYOUTS,LAYOUT_NAMES,ICONS,iconSvg} from './deck-render.js';
import {openMenu,promptDialog} from './ui-kit.js';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const ICON={more:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',comment:'<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',image:'<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',notes:'<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',play:'<path d="M7 5v14l12-7z"/>',
 insert:'<path d="M12 5v14M5 12h14"/>',arrange:'<rect x="4" y="4" width="9" height="9" rx="1.5"/><rect x="11" y="11" width="9" height="9" rx="1.5"/>',crop:'<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
 aleft:'<path d="M4 3v18M8 7h10v4H8zM8 14h6v4H8z"/>',ahc:'<path d="M12 3v18M6 7h12v4H6zM9 14h6v4H9z"/>',aright:'<path d="M20 3v18M6 7h10v4H6zM10 14h6v4h-6z"/>',atop:'<path d="M3 4h18M7 8v10h4V8zM14 8v6h4V8z"/>',avc:'<path d="M3 12h18M7 6v12h4V6zM14 9v6h4V9z"/>',abottom:'<path d="M3 20h18M7 6v10h4V6zM14 10v6h4v-6z"/>',
 dh:'<path d="M4 4v16M20 4v16M10 8h4v8h-4z"/>',dv:'<path d="M4 4h16M4 20h16M8 10h8v4H8z"/>',front:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4"/>',back:'<rect x="4" y="4" width="11" height="11" rx="2"/><path d="M9 15v4a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-4"/>'};
const icon=n=>'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">'+ICON[n]+'</svg>';
// read and write a dotted path like "slides.2.left.bullets.1"
const getAt=(o,p)=>p.split('.').reduce((a,k)=>a==null?a:a[k],o);
function setAt(o,p,v){const ks=p.split('.');let a=o;for(let i=0;i<ks.length-1;i++){const k=ks[i];if(a[k]==null||typeof a[k]!=='object')a[k]=/^\d+$/.test(ks[i+1])?[]:{};a=a[k]}a[ks.at(-1)]=v}
const r2=n=>Math.round(n*100)/100;
const hex=c=>{const m=String(c).match(/\d+/g);return m&&m.length>=3?'#'+m.slice(0,3).map(n=>(+n).toString(16).padStart(2,'0')).join(''):'#000000'};
const SIZE_NAMES={'16:9':'Wide 16:9','4:3':'Standard 4:3','1:1':'Square 1:1','9:16':'Story 9:16'};

export function createDeckView(root,ctx){
 let deck=null,current=0,ds=null,resolve=null,saveTimer=null,editing=false,dragFrom=null;
 const strip=el('div','dk-strip');strip.setAttribute('role','listbox');strip.setAttribute('aria-label','Slides');
 const stage=el('div','dk-stage'),frame=el('div','dk-frame'),tools=el('div','dk-tools'),notes=el('textarea','dk-notes');notes.placeholder='Speaker notes for this slide';notes.rows=3;notes.hidden=true;notes.setAttribute('aria-label','Speaker notes');
 const cbar=el('div','dk-comments');cbar.hidden=true;let comments=[];ctx.comments?.().then(c=>{comments=c||[];paintComments()}).catch(()=>{});
 const S=()=>deck.slides[current];
 // ---- what is selected: sel is the element you clicked (its text gets the formatting); group holds the others (Shift+click) ----
 let shownAt=-1,sel=null,group=[],cropping=false;
 const keyOf=n=>(n.dataset.field||n.dataset.box||'').split('.').slice(2).join('.');
 const boxKey=n=>(n.dataset.box||'').split('.').slice(2).join('.');
 const isItem=k=>/^items\.\d+$/.test(k||'');
 const itemAt=k=>S().items?.[Number(String(k).split('.')[1])];
 const mEl=()=>sel?.mel||sel?.el,mKey=()=>sel?.mkey||sel?.key;
 const movers=()=>{const list=sel?[{el:mEl(),key:mKey()}]:[];for(const g of group)if(!list.some(x=>x.key===g.key))list.push(g);return list.filter(x=>x.el&&frame.contains(x.el))};
 const nodeOf=k=>frame.querySelector('[data-box="slides.'+current+'.'+k+'"]')||frame.querySelector('[data-field="slides.'+current+'.'+k+'"]');
 // formatting for text: layout text keeps it in slide.style[key]; a text box keeps it in its item (fmt)
 const textItemKey=k=>{const m=String(k||'').match(/^(items\.\d+)(\.text)?$/);return m&&itemAt(m[1])?.type==='text'?m[1]:null};
 const style=()=>{if(!sel)return null;const ik=textItemKey(sel.key);if(ik){const it=itemAt(ik);return it?(it.fmt??={}):null}const s=S();s.style??={};return s.style[sel.key]??={}};
 function restyle(k,n=nodeOf(k)){if(!n)return;if(isItem(k)){const it=itemAt(k);n.style.cssText=itemCss(it);const im=n.querySelector('img');if(im)im.style.cssText=cropCss(it?.crop)}else{const st=S().style?.[k]||{};n.style.cssText=fieldCss(st);if(st.crop){const im=n.tagName==='IMG'?n:n.querySelector('img');if(im)im.style.cssText=fieldCss(im===n?st:{})+';'+cropCss(st.crop)}}}
 const tidy=()=>{const s=S();if(s.style){for(const k in s.style){const o=s.style[k];for(const f in o)if(o[f]===undefined||o[f]===null)delete o[f];if(!Object.keys(o).length)delete s.style[k]}if(!Object.keys(s.style).length)delete s.style}};

 // ---- formatting bar ----
 const fmt=el('div','dk-format');fmt.setAttribute('role','toolbar');fmt.setAttribute('aria-label','Text formatting');
 const fBtn=(label,title,on)=>{const b=el('button','dk-fbtn',label);b.type='button';b.title=title;b.setAttribute('aria-label',title);b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('click',on);return b};
 const iBtn=(name,title,on)=>{const b=fBtn('',title,on);b.innerHTML=icon(name);return b};
 const font=el('select','dk-font');font.setAttribute('aria-label','Font');font.append(new Option('Font',''));for(const f of FONTS)font.append(new Option(f,f));
 const color=el('input','dk-color');color.type='color';color.title='Text colour';color.setAttribute('aria-label','Text colour');
 const bgc=el('input','dk-color');bgc.type='color';bgc.title='Slide colour';bgc.setAttribute('aria-label','Slide colour');
 const hint=el('span','dk-fhint','Click anything on the slide to change it');
 const applyFmt=patch=>{if(!sel)return ctx.notify('Click some text on the slide first.');const st=style();if(!st)return;Object.assign(st,patch);for(const k of Object.keys(st))if(st[k]===undefined||st[k]===null)delete st[k];const ik=textItemKey(sel.key);if(ik)restyle(ik);else{tidy();sel.el.style.cssText=fieldCss(S().style?.[sel.key]||{})}save();paintStrip();syncBar()};
 const sizeNow=()=>{const sw=frame.querySelector('.slide')?.getBoundingClientRect().width||1;return parseFloat(getComputedStyle(sel.el).fontSize)/sw*100};
 const bigger=fBtn('A+','Larger text',()=>sel&&applyFmt({size:Math.min(30,sizeNow()*1.12)})),smaller=fBtn('A−','Smaller text',()=>sel&&applyFmt({size:Math.max(.6,sizeNow()/1.12)}));
 const bold=fBtn('B','Bold',()=>sel&&applyFmt({bold:!(parseInt(getComputedStyle(sel.el).fontWeight)>=600)})),ital=fBtn('I','Italic',()=>sel&&applyFmt({italic:!style()?.italic||undefined}));bold.classList.add('b');ital.classList.add('i');
 const al=['left','center','right'].map(a=>{const b=fBtn('','Align '+a,()=>sel&&applyFmt({align:a}));b.innerHTML='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="'+({left:'M4 6h16M4 10h10M4 14h16M4 18h10',center:'M4 6h16M7 10h10M4 14h16M7 18h10',right:'M4 6h16M10 10h10M4 14h16M10 18h10'})[a]+'"/></svg>';b.dataset.align=a;return b});
 const reset=fBtn('Reset','Clear this text\'s formatting',()=>{if(!sel)return;const ik=textItemKey(sel.key);if(ik){delete itemAt(ik).fmt;restyle(ik)}else{delete S().style?.[sel.key];sel.el.style.cssText=''}save();paintStrip();syncBar()});
 font.onchange=()=>{applyFmt({font:font.value||undefined})};color.oninput=()=>applyFmt({color:color.value});
 bgc.oninput=()=>{S().bg=bgc.value;const inner=frame.querySelector('.slide-in');if(inner)inner.style.background=bgc.value;save();paintStrip()};
 const bgReset=fBtn('×','Back to the design system colour',()=>{delete S().bg;save();render()});bgReset.classList.add('dk-bgreset');
 const sep=()=>el('span','dk-fsep');const bgWrap=el('label','dk-bg');bgWrap.append(el('span','','Slide'),bgc,bgReset);
 const cx=fBtn('','Centre across the slide',()=>align('hcenter',true)),cy=fBtn('','Centre down the slide',()=>align('vcenter',true)),home=fBtn('','Back to the layout position',()=>{for(const m of movers()){if(isItem(m.key))continue;const st=S().style?.[m.key];if(st){for(const k of ['dx','dy','w','h','rot'])delete st[k]}restyle(m.key,m.el)}tidy();place();save();paintStrip()});
 cx.innerHTML='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M7 8h10v8H7z"/></svg>';cy.innerHTML='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18M8 7h8v10H8z"/></svg>';home.innerHTML='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7M6 10v10h12V10"/></svg>';
 const tableOps=el('span','dk-table');const tOp=(label,title,fn)=>fBtn(label,title,()=>{const s=S();if(!s.table)return;fn(s.table);save(0);render()});
 tableOps.append(tOp('+ Row','Add a row',t=>{t.rows=[...(t.rows||[]),(t.head||[]).map(()=>'')]}),tOp('− Row','Remove the last row',t=>{if((t.rows||[]).length>1)t.rows.pop()}),tOp('+ Col','Add a column',t=>{t.head=[...(t.head||[]),'New'];t.rows=(t.rows||[]).map(r=>[...r,''])}),tOp('− Col','Remove the last column',t=>{if((t.head||[]).length>1){t.head.pop();t.rows=(t.rows||[]).map(r=>r.slice(0,-1))}}));
 // shapes and images: fill, line, corners, crop
 const shapeOps=el('span','dk-shape');const fillC=el('input','dk-color');fillC.type='color';fillC.title='Fill colour';fillC.setAttribute('aria-label','Fill colour');const lineC=el('input','dk-color');lineC.type='color';lineC.title='Line colour';lineC.setAttribute('aria-label','Line colour');
 const lineW=el('select','dk-font dk-lw');lineW.title='Line width';lineW.setAttribute('aria-label','Line width');for(const [v,l] of [['0','No line'],['0.08','Thin'],['0.15','Medium'],['0.3','Thick'],['0.6','Heavy']])lineW.append(new Option(l,v));
 const corners=el('select','dk-font dk-lw');corners.title='Corners';corners.setAttribute('aria-label','Corners');for(const [v,l] of [['0','Square'],['1','Soft'],['2.5','Round'],['6','Pill']])corners.append(new Option(l,v));
 const itemsSel=()=>movers().filter(m=>isItem(m.key)).map(m=>[m,itemAt(m.key)]);
 const setItems=patch=>{for(const [m,it] of itemsSel()){Object.assign(it,patch);restyle(m.key,m.el)}save();paintStrip();syncBar()};
 fillC.oninput=()=>setItems({fill:fillC.value});lineC.oninput=()=>setItems({line:lineC.value,lw:Number(lineW.value)||.15});lineW.onchange=()=>setItems({lw:Number(lineW.value),line:lineC.value});corners.onchange=()=>setItems({r:Number(corners.value)});
 const cropB=iBtn('crop','Crop: drag the picture inside its frame, scroll to zoom',()=>{cropping=!cropping;cropB.setAttribute('aria-pressed',String(cropping));frame.classList.toggle('dk-cropping',cropping)});
 shapeOps.append(fillC,lineC,lineW,corners,cropB);
 // insert and arrange
 const insB=fBtn('','Insert a text box, shape or image',()=>openMenu(insB,[['text','Text box'],['rect','Rectangle'],['ellipse','Ellipse'],['line','Line'],['arrow','Arrow'],['icon','Icon…'],['image','Image…']].map(([t,l])=>({label:l,action:()=>t==='icon'?iconPicker():insert(t)})),{anchor:insB,label:'Insert'}));insB.innerHTML=icon('insert')+'<span>Insert</span>';insB.classList.add('dk-wide');
 const arrB=fBtn('','Arrange: align, space evenly, order, exact position',()=>arrange());arrB.innerHTML=icon('arrange')+'<span>Arrange</span>';arrB.classList.add('dk-wide');
 fmt.append(insB,arrB,sep(),font,smaller,bigger,bold,ital,color,sep(),...al,reset,shapeOps,sep(),cx,cy,home,tableOps,hint,el('span','dk-grow'),bgWrap);
 function syncBar(){const on=Boolean(sel&&frame.contains(sel.el)),text=on&&(!sel.box||Boolean(textItemKey(sel.key))),its=itemsSel();fmt.classList.toggle('has-sel',on);fmt.classList.toggle('box-sel',on&&!text);
  for(const c of [font,smaller,bigger,bold,ital,color,...al,reset])c.disabled=!text;hint.hidden=on;tableOps.hidden=!(on&&(sel.key.startsWith('table')));arrB.disabled=cx.disabled=cy.disabled=!on;home.disabled=!on||movers().every(m=>isItem(m.key));
  const shape=its.find(([,it])=>!['image','text'].includes(it.type)),pic=its.find(([,it])=>it.type==='image')||(on&&/(^|\.)image$/.test(mKey())&&S().image);shapeOps.hidden=!shape&&!pic;fillC.hidden=!shape||['line','arrow','icon'].includes(shape[1].type);lineC.hidden=lineW.hidden=!shape;lineW.hidden=lineW.hidden||shape?.[1].type==='icon';corners.hidden=!shape||shape[1].type!=='rect';cropB.hidden=!pic;
  if(!pic&&cropping){cropping=false;frame.classList.remove('dk-cropping')}cropB.setAttribute('aria-pressed',String(cropping));
  if(shape){const it=shape[1];fillC.value=it.fill||hex(getComputedStyle(shape[0].el).backgroundColor);lineC.value=it.line||'#0b0c10';lineW.value=String(it.lw??0);corners.value=String(it.r??0)}
  const s=deck?.slides[current];const solid=getComputedStyle(frame.querySelector('.slide-in')||frame).backgroundColor;bgc.value=/^#[0-9a-f]{6}$/i.test(s?.bg||'')?s.bg:/rgba\(0, 0, 0, 0\)|transparent/.test(solid)?(getComputedStyle(frame.querySelector('.slide')||frame).getPropertyValue('--ds-accent').trim()||'#0158cb'):hex(solid);bgReset.hidden=!s?.bg;
  if(!text)return;const cs=getComputedStyle(sel.el),st=style()||{};font.value=st.font||'';color.value=st.color||hex(cs.color);bold.setAttribute('aria-pressed',String(parseInt(cs.fontWeight)>=600));ital.setAttribute('aria-pressed',String(cs.fontStyle==='italic'));for(const b of al)b.setAttribute('aria-pressed',String((st.align||'')===b.dataset.align))}

 // ---- selection overlay: outline, grip, 8 resize handles and a rotate handle ----
 const overlay=el('div','dk-sel');overlay.hidden=true;const grip=el('button','dk-grip','⠿');grip.type='button';grip.title='Drag to move (snaps to the centre and edges)';grip.setAttribute('aria-label','Move');
 const HANDLES=['nw','n','ne','e','se','s','sw','w'];const handles=HANDLES.map(h=>{const d=el('span','dk-h dk-h-'+h);d.dataset.h=h;d.title=h.length===2?'Drag to resize (Shift keeps the shape)':'Drag to resize';return d});
 const rotH=el('span','dk-rot');rotH.title='Drag to rotate (Shift snaps to 15°)';overlay.append(grip,...handles,rotH);
 const guides=el('div','dk-guides');guides.setAttribute('aria-hidden','true');const ghosts=el('div','dk-ghosts');frame.append(overlay,guides,ghosts);
 const slideBox=()=>frame.querySelector('.slide')?.getBoundingClientRect();const unit=()=>(slideBox()?.width||1)/100;
 const rotOf=k=>Number(isItem(k)?itemAt(k)?.rot:S().style?.[k]?.rot)||0;
 function frameBox(n,k){const f=frame.getBoundingClientRect(),r=n.getBoundingClientRect(),rot=rotOf(k);if(!rot)return {l:r.left-f.left,t:r.top-f.top,w:r.width,h:r.height,rot:0};
  const w=n.offsetWidth,h=n.offsetHeight,cxp=r.left-f.left+r.width/2,cyp=r.top-f.top+r.height/2;return {l:cxp-w/2,t:cyp-h/2,w,h,rot}}
 function place(){const list=movers();if(!list.length){overlay.hidden=true;ghosts.replaceChildren();return}const one=list.length===1,b=one?frameBox(list[0].el,list[0].key):null;
  let box=b;if(!one){const f=frame.getBoundingClientRect(),rs=list.map(m=>m.el.getBoundingClientRect()),l=Math.min(...rs.map(r=>r.left)),t=Math.min(...rs.map(r=>r.top));box={l:l-f.left,t:t-f.top,w:Math.max(...rs.map(r=>r.right))-l,h:Math.max(...rs.map(r=>r.bottom))-t,rot:0}}
  overlay.hidden=false;Object.assign(overlay.style,{left:box.l+'px',top:box.t+'px',width:box.w+'px',height:box.h+'px',rotate:box.rot?box.rot+'deg':''});for(const h of handles)h.hidden=!one||cropping;rotH.hidden=!one||cropping;overlay.classList.toggle('dk-multi',!one);
  ghosts.replaceChildren(...(one?[]:list.map(m=>{const g=frameBox(m.el,m.key),d=el('i');Object.assign(d.style,{left:g.l+'px',top:g.t+'px',width:g.w+'px',height:g.h+'px',rotate:g.rot?g.rot+'deg':''});return d})))}
 // the box of the movers in cqw relative to the slide, and the lines it can snap to
 function boxCqw(list){const u=unit(),sb=slideBox(),rs=list.map(m=>m.el.getBoundingClientRect()),l=Math.min(...rs.map(r=>r.left)),t=Math.min(...rs.map(r=>r.top)),r=Math.max(...rs.map(r=>r.right)),b=Math.max(...rs.map(r=>r.bottom));return {x:(l-sb.left)/u,y:(t-sb.top)/u,w:(r-l)/u,h:(b-t)/u}}
 function snapLines(list){const u=unit(),sb=slideBox(),H=sb.height/u,xs=[7.5,50,92.5,0,100],ys=[6.5,H/2,H-5.5,0,H];
  for(const o of frame.querySelectorAll('.slide [data-field],.slide [data-box]')){if(list.some(m=>o===m.el||o.contains(m.el)||m.el.contains(o)))continue;const q=o.getBoundingClientRect();if(!q.width&&!q.height)continue;xs.push((q.left-sb.left)/u,(q.left-sb.left+q.width/2)/u,(q.right-sb.left)/u);ys.push((q.top-sb.top)/u,(q.top-sb.top+q.height/2)/u,(q.bottom-sb.top)/u)}return {xs,ys}}
 function snapMove(b0,dx,dy,lines){const T=.9;const best=(pos,ts)=>{let m=null;for(const t of ts)for(const p of pos){const d=t-p;if(Math.abs(d)<=T&&(!m||Math.abs(d)<Math.abs(m.d)))m={d,t}}return m};
  const mx=best([b0.x+dx,b0.x+dx+b0.w/2,b0.x+dx+b0.w],lines.xs),my=best([b0.y+dy,b0.y+dy+b0.h/2,b0.y+dy+b0.h],lines.ys);if(mx)dx+=mx.d;if(my)dy+=my.d;drawGuides(mx?.t,my?.t);return [dx,dy]}
 function drawGuides(gx,gy){guides.replaceChildren();const u=unit(),sb=slideBox(),f=frame.getBoundingClientRect();if(gx!=null){const g=el('i','v');Object.assign(g.style,{left:(sb.left-f.left+gx*u)+'px',top:(sb.top-f.top)+'px',height:sb.height+'px'});guides.append(g)}
  if(gy!=null){const g=el('i','h');Object.assign(g.style,{top:(sb.top-f.top+gy*u)+'px',left:(sb.left-f.left)+'px',width:sb.width+'px'});guides.append(g)}}
 // position model (cqw): layout elements move with dx/dy and size with w/h; items keep x/y/w/h
 const startOf=m=>isItem(m.key)?{...itemAt(m.key)}:{...(S().style?.[m.key]||{})};
 function moveTo(m,s0,dx,dy){if(isItem(m.key)){const it=itemAt(m.key);it.x=r2((s0.x||0)+dx);it.y=r2((s0.y||0)+dy)}else{const s=S();s.style??={};const st=s.style[m.key]??={};st.dx=r2((s0.dx||0)+dx);st.dy=r2((s0.dy||0)+dy);if(Math.abs(st.dx)<.05)delete st.dx;if(Math.abs(st.dy)<.05)delete st.dy}restyle(m.key,m.el)}
 function drag(e){if(ctx.locked?.())return;const list=movers();if(!list.length)return;e.preventDefault();const u=unit(),sx=e.clientX,sy=e.clientY,starts=list.map(startOf),b0=boxCqw(list),lines=snapLines(list);let moved=false;
  const move=ev=>{let dx=(ev.clientX-sx)/u,dy=(ev.clientY-sy)/u;if(!moved&&Math.hypot(ev.clientX-sx,ev.clientY-sy)<3)return;moved=true;if(!ev.altKey)[dx,dy]=snapMove(b0,dx,dy,lines);list.forEach((m,i)=>moveTo(m,starts[i],dx,dy));place()};
  const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up);guides.replaceChildren();if(moved){tidy();save();paintStrip()}};addEventListener('pointermove',move);addEventListener('pointerup',up)}
 function resize(e,h){if(ctx.locked?.())return;const m=movers()[0];if(!m)return;e.preventDefault();e.stopPropagation();const u=unit(),sx=e.clientX,sy=e.clientY,s0=startOf(m),n=m.el,item=isItem(m.key);
  const w0=item?(s0.w||20):(s0.w||n.offsetWidth/u),h0=item?(s0.h||10):(s0.h||n.offsetHeight/u),ratio=w0/(h0||1),media=item?['image','ellipse'].includes(itemAt(m.key).type):/(chart|image)$/.test(m.key);
  const rad=(rotOf(m.key)*Math.PI)/180,cos=Math.cos(rad),sin=Math.sin(rad);
  const move=ev=>{const ddx=(ev.clientX-sx)/u,ddy=(ev.clientY-sy)/u,dx=ddx*cos+ddy*sin,dy=-ddx*sin+ddy*cos;let w=w0,hh=h0;if(h.includes('e'))w=w0+dx;if(h.includes('w'))w=w0-dx;if(h.includes('s'))hh=h0+dy;if(h.includes('n'))hh=h0-dy;
   if(h.length===2&&ev.shiftKey!==media){if(Math.abs(w-w0)/w0>Math.abs(hh-h0)/h0)hh=w/ratio;else w=hh*ratio}w=Math.max(item?.5:5,Math.min(item?200:100,w));hh=Math.max(item?.2:2,Math.min(180,hh));
   const ox=h.includes('w')?w0-w:0,oy=h.includes('n')?h0-hh:0;
   if(item){const it=itemAt(m.key);it.w=r2(w);it.h=r2(hh);it.x=r2((s0.x||0)+ox);it.y=r2((s0.y||0)+oy)}else{const s=S();s.style??={};const st=s.style[m.key]??={};st.w=r2(w);if(h!=='e'&&h!=='w')st.h=r2(hh);st.dx=r2((s0.dx||0)+ox);st.dy=r2((s0.dy||0)+oy)}restyle(m.key,n);place()};
  const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up);tidy();save();paintStrip()};addEventListener('pointermove',move);addEventListener('pointerup',up)}
 function rotate(e){if(ctx.locked?.())return;const m=movers()[0];if(!m)return;e.preventDefault();e.stopPropagation();const r=m.el.getBoundingClientRect(),c={x:r.left+r.width/2,y:r.top+r.height/2};
  const move=ev=>{let a=Math.atan2(ev.clientY-c.y,ev.clientX-c.x)*180/Math.PI+90;if(ev.shiftKey)a=Math.round(a/15)*15;a=Math.round(((a+540)%360-180)*10)/10;if(Math.abs(a)<1.5)a=0;
   if(isItem(m.key))itemAt(m.key).rot=a||undefined;else{const s=S();s.style??={};(s.style[m.key]??={}).rot=a||undefined}restyle(m.key,m.el);place()};
  const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up);tidy();save();paintStrip()};addEventListener('pointermove',move);addEventListener('pointerup',up)}
 grip.addEventListener('pointerdown',drag);for(const d of handles)d.addEventListener('pointerdown',e=>resize(e,d.dataset.h));rotH.addEventListener('pointerdown',rotate);
 // crop: drag the picture inside its box, scroll to zoom
 frame.addEventListener('pointerdown',e=>{if(!cropping)return;const m=movers()[0];const img=m&&(m.el.tagName==='IMG'?m.el:m.el.querySelector('img'));if(!img||!m.el.contains(e.target)&&e.target!==m.el)return;e.preventDefault();e.stopPropagation();
  const holder=isItem(m.key)?itemAt(m.key):(S().style??={},S().style[m.key]??={});const c0={x:50,y:50,zoom:1,...holder.crop},sx=e.clientX,sy=e.clientY,r=m.el.getBoundingClientRect();
  const move=ev=>{holder.crop={...c0,x:r2(Math.max(0,Math.min(100,c0.x-(ev.clientX-sx)/r.width*100/c0.zoom))),y:r2(Math.max(0,Math.min(100,c0.y-(ev.clientY-sy)/r.height*100/c0.zoom)))};restyle(m.key,m.el)};
  const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up);save();paintStrip()};addEventListener('pointermove',move);addEventListener('pointerup',up)},true);
 frame.addEventListener('wheel',e=>{if(!cropping)return;const m=movers()[0];if(!m)return;e.preventDefault();const holder=isItem(m.key)?itemAt(m.key):(S().style??={},S().style[m.key]??={});const c={x:50,y:50,zoom:1,...holder.crop};c.zoom=r2(Math.max(1,Math.min(4,c.zoom*(e.deltaY<0?1.08:1/1.08))));holder.crop=c;restyle(m.key,m.el);clearTimeout(cropT);cropT=setTimeout(()=>{save();paintStrip()},300)},{passive:false});let cropT=null;

 // ---- align, distribute, order and exact position ----
 function align(how,toSlide){const list=movers();if(!list.length)return;const u=unit(),sb=slideBox(),H=sb.height/u,single=toSlide||list.length===1;const ref=single?{x:0,y:0,w:100,h:H}:boxCqw(list);
  if(how==='dist-h'||how==='dist-v'){if(list.length<3)return;const X=how==='dist-h',rows=list.map(m=>[m,boxCqw([m])]).sort((a,b)=>X?a[1].x-b[1].x:a[1].y-b[1].y);const gap=((X?ref.w:ref.h)-rows.reduce((s,[,b])=>s+(X?b.w:b.h),0))/(rows.length-1);let at=X?ref.x:ref.y;
   for(const [m,b] of rows){const d=at-(X?b.x:b.y);moveTo(m,startOf(m),X?d:0,X?0:d);at+=(X?b.w:b.h)+gap}}
  else for(const m of list){const b=boxCqw([m]),d={left:ref.x-b.x,hcenter:ref.x+ref.w/2-(b.x+b.w/2),right:ref.x+ref.w-(b.x+b.w),top:ref.y-b.y,vcenter:ref.y+ref.h/2-(b.y+b.h/2),bottom:ref.y+ref.h-(b.y+b.h)}[how]||0;const across=/left|hcenter|right/.test(how);moveTo(m,startOf(m),across?d:0,across?0:d)}
  tidy();place();save();paintStrip()}
 function order(front){const s=S();const list=movers();const zs=[...(s.items||[]).map(it=>it.z??2),...Object.values(s.style||{}).map(o=>o.z??0)];const z=front?Math.max(2,...zs)+1:-1;
  for(const m of list){if(isItem(m.key))itemAt(m.key).z=z;else{s.style??={};(s.style[m.key]??={}).z=z}restyle(m.key,m.el)}save();paintStrip()}
 let arrPanel=null;function arrange(){arrPanel?.remove();if(!sel)return;const p=el('div','dk-arrange');p.setAttribute('role','dialog');p.setAttribute('aria-label','Arrange');const row=el('div','dk-arr-row');const b=(n,t,fn)=>{const x=el('button','dk-fbtn');x.type='button';x.innerHTML=icon(n);x.title=t;x.setAttribute('aria-label',t);x.onclick=fn;return x};
  const multi=movers().length>1;row.append(...[['aleft','left','Align left'],['ahc','hcenter','Align centres'],['aright','right','Align right'],['atop','top','Align tops'],['avc','vcenter','Align middles'],['abottom','bottom','Align bottoms']].map(([n,h,t])=>b(n,t+(multi?'':' (to the slide)'),()=>align(h))));
  const row2=el('div','dk-arr-row');if(movers().length>2)row2.append(b('dh','Space evenly across',()=>align('dist-h')),b('dv','Space evenly down',()=>align('dist-v')));row2.append(b('front','Bring to front',()=>order(true)),b('back','Send to back',()=>order(false)));
  p.append(el('strong','','Align'),row,el('strong','','Space and order'),row2);
  if(!multi){const m=movers()[0],bx=boxCqw([m]),k=19.2,grid=el('div','dk-arr-grid');const field=(label,val,set)=>{const l=el('label');const i=el('input');i.type='number';i.value=String(Math.round(val));i.onchange=()=>{set(Number(i.value));tidy();restyle(m.key,m.el);place();save();paintStrip()};l.append(el('span','',label),i);grid.append(l)};
   const it=isItem(m.key)?itemAt(m.key):null,st=()=>{const s=S();s.style??={};return s.style[m.key]??={}};
   field('X',bx.x*k,v=>moveTo(m,startOf(m),v/k-boxCqw([m]).x,0));field('Y',bx.y*k,v=>moveTo(m,startOf(m),0,v/k-boxCqw([m]).y));
   field('W',bx.w*k,v=>{if(it)it.w=r2(v/k);else st().w=r2(Math.max(5,Math.min(100,v/k)))});field('H',bx.h*k,v=>{if(it)it.h=r2(v/k);else st().h=r2(Math.max(2,v/k))});field('°',rotOf(m.key),v=>{if(it)it.rot=v||undefined;else st().rot=v||undefined});
   p.append(el('strong','','Position and size'),grid,el('span','dk-arr-note','Pixels on a 1920 px wide slide'))}
  const r=arrB.getBoundingClientRect(),sr=stage.getBoundingClientRect();Object.assign(p.style,{left:Math.max(0,r.left-sr.left)+'px',top:(r.bottom-sr.top+6)+'px'});stage.append(p);arrPanel=p;
  setTimeout(()=>addEventListener('pointerdown',function off(e){if(p.contains(e.target)||e.target===arrB)return;removeEventListener('pointerdown',off,true);p.remove();arrPanel=null},true))}
 // insert: new items in the middle of the slide
 async function insert(type,icon){if(ctx.locked?.())return;const s=S();const H=100/ratioOf(deck);let it;
  if(type==='image'){const src=await pickFile();if(!src)return;it={type:'image',src,x:35,y:H/2-12,w:30,h:24}}
  else if(type==='text')it={type:'text',text:'Your text',x:30,y:H/2-3,w:40,h:6};else if(type==='line'||type==='arrow')it={type,x:30,y:H/2,w:40,h:2,line:'#0b0c10',lw:.15};else if(type==='icon')it={type,icon,x:45,y:H/2-5,w:10,h:10};else it={type,x:40,y:H/2-8,w:20,h:16};
  (s.items??=[]).push(it);save(0);render();const k='items.'+(s.items.length-1);const n=nodeOf(k);if(n){sel={el:n,key:k,box:true};group=[];syncBar();place();if(type==='text'){n.focus();document.getSelection()?.selectAllChildren(n)}}}
 function iconPicker(){arrPanel?.remove();const p=el('div','dk-arrange dk-icons');p.setAttribute('role','dialog');p.setAttribute('aria-label','Icons');p.append(el('strong','','Icon'));const g=el('div','dk-icon-grid');
  for(const n of Object.keys(ICONS)){const b=el('button','dk-fbtn');b.type='button';b.title=n[0].toUpperCase()+n.slice(1);b.setAttribute('aria-label',b.title);b.innerHTML=iconSvg(n);b.onclick=()=>{p.remove();arrPanel=null;insert('icon',n)};g.append(b)}p.append(g);
  const r=insB.getBoundingClientRect(),sr=stage.getBoundingClientRect();Object.assign(p.style,{left:Math.max(0,r.left-sr.left)+'px',top:(r.bottom-sr.top+6)+'px'});stage.append(p);arrPanel=p;setTimeout(()=>addEventListener('pointerdown',function off(e){if(p.contains(e.target))return;removeEventListener('pointerdown',off,true);p.remove();arrPanel=null},true))}
 function pickFile(){return new Promise(res=>{const f=el('input');f.type='file';f.accept='image/png,image/jpeg,image/webp,image/gif';f.onchange=async()=>{const file=f.files[0];if(!file)return res(null);if(file.size>8e6){ctx.notify('Use an image under 8 MB.');return res(null)}try{res(await ctx.upload(file))}catch(e){ctx.notify(e.message);res(null)}};f.click()})}
 function removeSelected(){const s=S();const ks=movers().filter(m=>isItem(m.key)).map(m=>Number(m.key.split('.')[1])).sort((a,b)=>b-a);if(!ks.length)return false;for(const i of ks)s.items.splice(i,1);if(!s.items.length)delete s.items;sel=null;group=[];save();render();return true}
 function duplicateSelected(){const s=S();const its=movers().filter(m=>isItem(m.key)).map(m=>itemAt(m.key));if(!its.length)return false;for(const it of its)s.items.push({...structuredClone(it),x:r2((it.x||0)+2),y:r2((it.y||0)+2)});save();render();const n0=s.items.length-its.length;
  const nodes=its.map((_,i)=>({key:'items.'+(n0+i)})).map(m=>({...m,el:nodeOf(m.key)}));sel={el:nodes[0].el,key:nodes[0].key,box:true};group=nodes.slice(1);syncBar();place();return true}
 frame.addEventListener('keydown',e=>{if(!sel||editing)return;const list=movers();if(/^Arrow/.test(e.key)){e.preventDefault();e.stopPropagation();const step=e.shiftKey?2:.4,dx=e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,dy=e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0;for(const m of list)moveTo(m,startOf(m),dx,dy);place();clearTimeout(nudgeT);nudgeT=setTimeout(()=>{tidy();save();paintStrip()},300)}
  else if((e.key==='Delete'||e.key==='Backspace')&&removeSelected()){e.preventDefault();e.stopPropagation()}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();e.stopPropagation();if(!duplicateSelected())duplicateSlide(current)}
  else if(e.key==='Escape'){sel=null;group=[];syncBar();place()}},true);let nudgeT=null;
 addEventListener('resize',()=>place());
 stage.append(fmt,frame,tools,notes,cbar);new ResizeObserver(()=>stage.classList.toggle('dk-narrow',stage.clientWidth<560)).observe(stage);new ResizeObserver(()=>place()).observe(frame);root.replaceChildren(strip,stage);
 const opts=i=>({index:i,total:deck.slides.length,deck,resolve,ds,inline:false});
 const put=(node,i)=>{node.innerHTML=slideBlock(deck.slides[i],opts(i));paintSlides(node,ds);paintFormatting(node,deck.slides[i],i)};

 function paintStrip(){strip.replaceChildren();deck.slides.forEach((s,i)=>{const t=el('button','dk-thumb'+(i===current?' on':''));t.type='button';t.setAttribute('role','option');t.setAttribute('aria-selected',String(i===current));t.setAttribute('aria-label','Slide '+(i+1)+': '+(s.title||LAYOUT_NAMES[s.layout]||''));t.draggable=true;
  const n=el('span','dk-n',String(i+1)),mini=el('div','dk-mini');put(mini,i);t.append(n,mini);
  t.addEventListener('click',()=>go(i));t.addEventListener('contextmenu',e=>{e.preventDefault();menu(i,{x:e.clientX,y:e.clientY})});
  t.addEventListener('dragstart',e=>{dragFrom=i;t.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(i))});
  t.addEventListener('dragend',()=>{dragFrom=null;t.classList.remove('dragging');strip.querySelectorAll('.drop-before,.drop-after').forEach(x=>x.classList.remove('drop-before','drop-after'))});
  t.addEventListener('dragover',e=>{if(dragFrom==null||dragFrom===i)return;e.preventDefault();const r=t.getBoundingClientRect(),after=e.clientY>r.top+r.height/2;t.classList.toggle('drop-after',after);t.classList.toggle('drop-before',!after)});
  t.addEventListener('dragleave',()=>t.classList.remove('drop-before','drop-after'));
  t.addEventListener('drop',e=>{e.preventDefault();if(dragFrom==null||dragFrom===i)return;const after=t.classList.contains('drop-after');move(dragFrom,i+(after?1:0)-(dragFrom<i?1:0))});
  if(i>=seenCount&&seenCount>0)t.classList.add('dk-arrive');strip.append(t)});seenCount=deck.slides.length;
  const add=el('button','dk-add','+');add.type='button';add.title='Add a slide after this one';add.setAttribute('aria-label','Add a slide');add.addEventListener('click',()=>{deck.slides.splice(current+1,0,{layout:'bullets',title:'New slide',bullets:['First point'],notes:''});current++;save(0);render();setTimeout(()=>frame.querySelector('[data-field]')?.focus(),60)});strip.append(add);
  strip.querySelector('.on')?.scrollIntoView({block:'nearest'})}
 let seenCount=0;
 const reselect=(k,others=[])=>{const n=nodeOf(k)||(k.startsWith('table')?frame.querySelector('[data-box$=table]'):null);if(!n)return;const box=n.dataset.box&&!n.dataset.field?null:n.closest('[data-box]');
  sel=n.dataset.box&&!n.dataset.field?{el:n,key:keyOf(n),box:true}:{el:n,key:keyOf(n),...(box?{mel:box,mkey:boxKey(box)}:{}),...(n.dataset.box?{box:true}:{})};group=others.map(k=>({key:k,el:nodeOf(k)})).filter(m=>m.el);syncBar();place()};

 function paintSlide(){const s=S();const keep=shownAt===current?sel?.key:null,keepGroup=shownAt===current?group.map(g=>g.key):[];shownAt=current;if(!s){frame.replaceChildren(el('div','dk-empty','This deck has no slides yet.'));tools.replaceChildren();return}
  put(frame,current);frame.querySelector('.slide').classList.add('dk-live');const locked=ctx.locked?.();frame.classList.toggle('dk-locked',Boolean(locked));
  for(const f of frame.querySelectorAll('[data-field]')){if(locked)continue;f.contentEditable='true';f.spellcheck=true;
   f.addEventListener('focus',()=>{editing=true;const box=f.closest('[data-box]');sel={el:f,key:keyOf(f),...(box?{mel:box,mkey:boxKey(box)}:{}),...(f.dataset.box?{box:false}:{})};group=[];syncBar();place()});f.addEventListener('blur',()=>{editing=false;commit(f)});
   f.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!f.dataset.box){e.preventDefault();f.blur()}if(e.key==='Escape'){e.preventDefault();f.textContent=getAt(deck,f.dataset.field)??'';f.blur()}});
   f.addEventListener('paste',e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'))})}
  notes.value=s.notes||'';sel=null;group=[];syncBar();overlay.hidden=true;frame.append(overlay,guides,ghosts);
  // click selects (Shift adds); a text box is typed in once it is already selected; layout text is typed in straight away
  frame.querySelector('.slide').addEventListener('pointerdown',e=>{if(ctx.locked?.()||cropping)return;const t=e.target;if(t.closest('.dk-sel'))return;const f=t.closest('[data-field]'),b=t.closest('[data-box]');
   if(e.shiftKey){const n=b||f;if(!n)return;e.preventDefault();const k=b?boxKey(b):keyOf(f);if(!sel){sel={el:n,key:k,box:true};group=[]}else if(mKey()!==k){const i=group.findIndex(g=>g.key===k);if(i>=0)group.splice(i,1);else group.push({el:n,key:k})}document.activeElement?.blur?.();syncBar();place();return}
   if(b&&(!f||f.dataset.box)){const k=boxKey(b);if(f&&sel&&mKey()===k&&!group.length)return;e.preventDefault();if(!(sel&&(mKey()===k||group.some(g=>g.key===k)))){sel={el:b,key:k,box:true};group=[]}document.activeElement?.blur?.();syncBar();place();frame.focus({preventScroll:true});drag(e);return}
   if(!f&&!b){sel=null;group=[];syncBar();place()}});
  for(const b of frame.querySelectorAll('[data-box]'))b.addEventListener('dblclick',()=>{if(b.dataset.box.endsWith('.chart'))editChart();else if(b.dataset.field){b.focus()}});
  if(keep)reselect(keep,keepGroup);
  const count=el('span','dk-pill',(current+1)+' / '+deck.slides.length);
  const lay=el('button','dk-pill dk-btn');lay.type='button';lay.innerHTML='<span></span><i class="dd-chev"></i>';lay.firstChild.textContent='Layout: '+(LAYOUT_NAMES[s.layout]||'Bullets');lay.setAttribute('aria-haspopup','menu');
  lay.addEventListener('click',()=>openMenu(lay,LAYOUTS.map(l=>({label:LAYOUT_NAMES[l]+(l===s.layout?'  ✓':''),action:()=>{s.layout=l;save();render()}})),{anchor:lay,label:'Slide layout'}));
  const nb=el('button','dk-pill dk-btn'+(notes.hidden?'':' on'));nb.type='button';nb.innerHTML=icon('notes')+'<span>Notes</span>';nb.setAttribute('aria-pressed',String(!notes.hidden));nb.addEventListener('click',()=>{notes.hidden=!notes.hidden;paintSlide();if(!notes.hidden)notes.focus()});
  const grow=el('span','dk-grow');
  const ask=(label,text)=>{const b=el('button','dk-chip dk-ai',label);b.type='button';b.addEventListener('click',()=>ctx.ask('On slide '+(current+1)+' ("'+(s.title||LAYOUT_NAMES[s.layout])+'") of '+ctx.title()+': '+text));return b};
  const play=el('button','dk-chip dk-play');play.type='button';play.innerHTML=icon('play')+'<span>Present</span>';play.addEventListener('click',present);
  const say=t=>ctx.ask('On slide '+(current+1)+' ("'+(s.title||LAYOUT_NAMES[s.layout])+'") of '+ctx.title()+': '+t);
  const more=el('button','dk-chip dk-more');more.type='button';more.innerHTML=icon('more');more.setAttribute('aria-label','More slide actions');more.setAttribute('aria-haspopup','menu');
  more.addEventListener('click',()=>openMenu(more,[...(more.closest('.dk-narrow')?[{label:'Rewrite',action:()=>say('rewrite it to be clearer and more persuasive.')},{label:'Shorten',action:()=>say('cut the text by half, keep the meaning.')},{label:'Make visual',action:()=>say('make it more visual: pick a better layout, a chart or an image.')},'separator']:[]),{label:'Add a chart',action:()=>say('turn the key numbers into a chart slide (layout chart).')},{label:'Split in two',action:()=>say('split it into two slides with one idea each.')},{label:'New image',action:()=>say('make a new image for it with a connected image tool if one is available, save it in the output folder and use it.')},'separator',
   {label:'Duplicate slide',hint:'Ctrl+D',action:()=>duplicateSlide(current)},
   ...(['image','team'].includes(s.layout)||s.image!==undefined?[{label:'Upload an image…',action:pickImage},{label:s.imageFit==='contain'?'Fill the image frame':'Show the whole image',disabled:!s.image,action:()=>{s.imageFit=s.imageFit==='contain'?'cover':'contain';save();render()}}]:[{label:'Use an image layout',action:()=>{s.layout='image';save();render()}}]),
   ...(s.layout==='chart'?[{label:'Edit chart data…',action:editChart}]:[]),'separator',
   {label:s.build?'Show all points at once':'Show points one by one',hint:'When presenting',action:()=>{s.build=!s.build||undefined;save();paintSlide()}},
   ...['none','fade','slide'].map(t=>({label:'Transition: '+({none:'None',fade:'Fade',slide:'Slide in'})[t]+((deck.transition||'none')===t?'  ✓':''),action:()=>{deck.transition=t==='none'?undefined:t;save()}})),
   ...Object.keys(SIZES).map(k=>({label:'Slide size: '+SIZE_NAMES[k]+((deck.size||'16:9')===k?'  ✓':''),action:()=>{deck.size=k==='16:9'?undefined:k;save(0);render()}})),'separator',
   {label:'Comment on this slide…',action:comment},{label:'Review the whole deck',action:review},{label:'Open notes window',action:notesWindow}],{anchor:more,label:'Slide actions'}));
  tools.replaceChildren(count,lay,nb,grow,ask('Rewrite','rewrite it to be clearer and more persuasive.'),ask('Shorten','cut the text by half, keep the meaning.'),ask('Make visual','make it more visual: pick a better layout, a chart or an image.'),more,play)}
 // images: upload into the output folder and place on the slide
 function pickImage(){pickFile().then(src=>{if(!src)return;const s=S();s.image=src;if(!['image','team'].includes(s.layout))s.layout='image';save(0);render()})}
 // chart data: a small table you can edit or paste into (tab or comma separated, first row = series names)
 function editChart(){const s=S();const c=s.chart||{type:'bar',labels:[],series:[]};const d=el('dialog','kit-dialog chart-dialog');const h=el('h2','','Chart data');const type=el('select');for(const t of ['bar','line','pie'])type.append(new Option(t[0].toUpperCase()+t.slice(1),t));type.value=c.type||'bar';
  const ta=el('textarea','chart-grid');ta.rows=8;ta.spellcheck=false;ta.value=['Label',...(c.series||[]).map(x=>x.name||'Series')].join('\t')+'\n'+(c.labels||[]).map((l,i)=>[l,...(c.series||[]).map(x=>x.values?.[i]??'')].join('\t')).join('\n');
  const hint=el('p','kit-message small-print','One row per label. Columns are separated by tabs or commas; the first row names the series. You can paste straight from a spreadsheet.');
  const cols=el('div','chart-colors');cols.append(el('span','','Colours'));const picks=[0,1,2,3].map(i=>{const p=el('input');p.type='color';p.value=(c.colors||[])[i]||['#0158cb','#2f7bff','#646875','#0b0c10'][i];p.setAttribute('aria-label','Colour of series '+(i+1));cols.append(p);return p});
  const row=el('div','dialog-actions');const cancel=el('button','','Cancel');cancel.type='button';const ok=el('button','primary','Save chart');ok.type='button';row.append(cancel,ok);d.append(h,type,ta,hint,cols,row);document.body.append(d);d.showModal();const close=()=>{d.close();setTimeout(()=>d.remove(),180)};cancel.onclick=close;
  ok.onclick=()=>{const rows=ta.value.trim().split(/\r?\n/).map(r=>r.split(/\t|,/).map(x=>x.trim()));const [head,...body]=rows;if(!head||!body.length)return ctx.notify('Add at least one row of numbers.');s.chart={type:type.value,colors:picks.map(p=>p.value),labels:body.map(r=>r[0]),series:head.slice(1).map((n,j)=>({name:n,values:body.map(r=>Number(String(r[j+1]||'').replace(/[^\d.-]/g,''))||0)}))};s.layout='chart';save(0);render();close()}}
 // comments per slide, sent to the AI together
 async function comment(){const s=S();const text=await promptDialog({title:'Comment on slide '+(current+1),message:s.title||'',confirm:'Add comment',input:{label:'Your comment',max:400}});if(!text)return;comments.push({quote:'Slide '+(current+1)+(s.title?': '+s.title:''),text,time:Date.now()});await ctx.saveComments?.(comments);paintComments()}
 function paintComments(){cbar.hidden=!comments.length;cbar.replaceChildren();if(!comments.length)return;const head=el('div','doc-comments-head');head.append(el('strong','',comments.length+(comments.length===1?' comment':' comments')));const send=el('button','primary','Send to AI');send.type='button';
  send.onclick=async()=>{ctx.send('Please address these comments on '+ctx.title()+':\n'+comments.map((c,i)=>(i+1)+'. '+c.quote+': '+c.text).join('\n'));comments=[];await ctx.saveComments?.(comments);paintComments()};head.append(send);cbar.append(head);
  comments.forEach((c,i)=>{const r=el('div','doc-comment');const x=el('button','link-button','Resolve');x.type='button';x.onclick=async()=>{comments.splice(i,1);await ctx.saveComments?.(comments);paintComments()};r.append(el('q','',c.quote),el('p','',c.text),x);cbar.append(r)})}
 function review(){ctx.send('Review '+ctx.title()+' slide by slide. For each slide give a one-line verdict on clarity, text density and visual hierarchy (good / needs work), then fix the slides that need work in the deck file. End with next_steps listing what you changed.')}
 // notes window: speaker notes, the next slide and a timer in their own window (for a second screen)
 let notesWin=null;function notesWindow(){if(notesWin&&!notesWin.closed){notesWin.focus();return}notesWin=open('','cba-notes','width=520,height=420');if(!notesWin)return ctx.notify('Allow pop-ups to open the notes window.');const w=notesWin,doc=w.document;doc.title='Speaker notes';
  const bodyStyle='margin:0;padding:20px;font:16px/1.6 "Plus Jakarta Sans",system-ui,sans-serif;background:#0f1420;color:#eef0f4';doc.body.style.cssText=bodyStyle;const top=doc.createElement('div'),now=doc.createElement('h1'),text=doc.createElement('div'),next=doc.createElement('p');top.style.cssText='font-size:13px;color:#9aa6bd';now.style.cssText='font-size:20px;margin:6px 0 12px';text.style.cssText='font-size:18px;white-space:pre-wrap';next.style.cssText='margin-top:18px;font-size:13px;color:#9aa6bd';doc.body.append(top,now,text,next);
  const start=Date.now();const paint=()=>{if(w.closed)return clearInterval(t);const s=deck.slides[presentAt??current]||{},n=deck.slides[(presentAt??current)+1];const sec=Math.floor((Date.now()-start)/1000);top.textContent='Slide '+((presentAt??current)+1)+' / '+deck.slides.length+'  ·  '+Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');now.textContent=s.title||'';text.textContent=s.notes||'No notes for this slide.';next.textContent=n?'Next: '+(n.title||LAYOUT_NAMES[n.layout]):'Last slide'};const t=setInterval(paint,500);paint()}
 let presentAt=null;

 function commit(f){const path=f.dataset.field,old=getAt(deck,path),text=(f.dataset.box?f.innerText:f.textContent).replace(f.dataset.box?/[ \t]+/g:/\s+/g,' ').trim();if(text===String(old??''))return;setAt(deck,path,text);save();paintStrip()}
 notes.addEventListener('input',()=>{S().notes=notes.value;save(600)});
 let undo=[],redo=[],lastSaved=null,pending=false;
 function save(wait=250,{history=true}={}){for(const sl of deck.slides)if(sl.style){for(const k in sl.style)if(!Object.keys(sl.style[k]||{}).length)delete sl.style[k];if(!Object.keys(sl.style).length)delete sl.style}const now=JSON.stringify(deck);if(history&&lastSaved!==null&&now!==lastSaved){undo.push(lastSaved);if(undo.length>60)undo.shift();redo=[]}lastSaved=now;clearTimeout(saveTimer);pending=true;saveTimer=setTimeout(async()=>{try{await ctx.save(deck)}catch(e){ctx.notify(e.message)}finally{pending=false}},wait)}
 function step(back){const from=back?undo:redo,to=back?redo:undo;if(!from.length)return ctx.notify(back?'Nothing to undo.':'Nothing to redo.');to.push(JSON.stringify(deck));deck=JSON.parse(from.pop());current=Math.min(current,deck.slides.length-1);save(0,{history:false});render()}
 function render(){paintStrip();paintSlide()}
 function go(i){if(!deck.slides.length)return;current=Math.max(0,Math.min(deck.slides.length-1,i));render();strip.querySelector('.on')?.focus({preventScroll:true})}
 function move(from,to){const [s]=deck.slides.splice(from,1);deck.slides.splice(Math.max(0,Math.min(deck.slides.length,to)),0,s);current=deck.slides.indexOf(s);save();render()}
 function duplicateSlide(i){deck.slides.splice(i+1,0,structuredClone(deck.slides[i]));current=i+1;save();render()}
 function menu(i,at){openMenu(at,[{label:'Duplicate slide',hint:'Ctrl+D',action:()=>duplicateSlide(i)},
  {label:'Move up',disabled:i===0,action:()=>move(i,i-1)},{label:'Move down',disabled:i===deck.slides.length-1,action:()=>move(i,i+1)},'separator',
  {label:'Delete slide',danger:true,disabled:deck.slides.length<2,action:()=>{deck.slides.splice(i,1);current=Math.min(current,deck.slides.length-1);save();render()}}],{label:'Slide'})}
 root.addEventListener('keydown',e=>{if(editing||e.target.matches('textarea,input,select'))return;const mod=e.ctrlKey||e.metaKey;
  if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();step(!e.shiftKey)}else if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();step(false)}
  else if(e.key==='F5'||(mod&&e.key==='Enter')){e.preventDefault();present()}
  else if(e.target===frame&&!sel&&(e.key==='ArrowRight'||e.key==='ArrowDown'||e.key==='PageDown')){e.preventDefault();go(current+1)}else if(e.target===frame&&!sel&&(e.key==='ArrowLeft'||e.key==='ArrowUp'||e.key==='PageUp')){e.preventDefault();go(current-1)}});
 frame.tabIndex=0;frame.setAttribute('aria-label','Current slide (arrow keys move between slides, F5 presents)');
 strip.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowRight'){e.preventDefault();go(current+1)}else if(e.key==='ArrowUp'||e.key==='ArrowLeft'){e.preventDefault();go(current-1)}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicateSlide(current)}
  else if((e.key==='Delete'||e.key==='Backspace')&&deck.slides.length>1){e.preventDefault();menu(current,strip.querySelector('.on'))}});

 // present: full screen, arrows or space to move (points appear one by one on slides that build), N for notes, Esc to leave
 function present(){const shell=el('div','dk-present');shell.tabIndex=-1;const view=el('div','dk-present-slide'),bar=el('div','dk-present-bar'),pn=el('div','dk-present-notes');pn.hidden=true;shell.append(view,pn,bar);document.body.append(shell);let i=current,shown=Infinity,last=-1;const start=Date.now();
  const points=()=>[...view.querySelectorAll('.s-list li,.s-timeline li,.s-person')];
  const paint=()=>{presentAt=i;if(i!==last){put(view,i);const tr=deck.transition;if(tr){view.classList.remove('dk-tr-fade','dk-tr-slide');void view.offsetWidth;view.classList.add('dk-tr-'+tr)}last=i}
   const ps=points();if(deck.slides[i].build)ps.forEach((p,k)=>p.classList.toggle('dk-later',k>=shown));const m=Math.floor((Date.now()-start)/60000),sec=Math.floor((Date.now()-start)/1000)%60;bar.textContent=(i+1)+' / '+deck.slides.length+'  ·  '+m+':'+String(sec).padStart(2,'0')+'  ·  N notes · W notes window · Esc exit';pn.textContent=deck.slides[i].notes||'No notes for this slide.'};
  const next=()=>{const n=points().length;if(deck.slides[i].build&&shown<n){shown++;paint();return}if(i<deck.slides.length-1){i++;shown=deck.slides[i].build?0:Infinity;paint()}};
  const prev=()=>{if(i>0){i--;shown=Infinity;paint()}};
  const tick=setInterval(paint,1000);const close=()=>{presentAt=null;clearInterval(tick);if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});shell.remove();current=i;render()};
  shell.addEventListener('keydown',e=>{if(['ArrowRight','ArrowDown',' ','PageDown','Enter'].includes(e.key)){e.preventDefault();next()}else if(['ArrowLeft','ArrowUp','PageUp','Backspace'].includes(e.key)){e.preventDefault();prev()}else if(e.key==='Escape'){e.preventDefault();close()}else if(e.key.toLowerCase()==='n'){pn.hidden=!pn.hidden}else if(e.key.toLowerCase()==='w'){notesWindow()}});
  shell.addEventListener('click',e=>{if(e.target.closest('.dk-present-bar'))return;if(e.clientX<innerWidth/3)prev();else next()});
  document.addEventListener('fullscreenchange',function f(){if(!document.fullscreenElement&&document.body.contains(shell)){document.removeEventListener('fullscreenchange',f);close()}});
  if(deck.slides[i].build)shown=0;paint();shell.requestFullscreen?.().catch(()=>{});shell.focus()}

 return {
  // new data from disk: keep the current slide, and never overwrite text the user is typing
  set(next,{designSystem,resolver}){ds=designSystem;resolve=resolver;if(editing||pending)return;const first=!deck;deck={title:next.title||'',...next,slides:Array.isArray(next.slides)?next.slides:[]};const fresh=JSON.stringify(deck);if(fresh!==lastSaved){if(lastSaved!==null&&!first){undo.push(lastSaved);redo=[]}lastSaved=fresh}if(first)current=0;current=Math.min(current,Math.max(0,deck.slides.length-1));render()},
  current:()=>current,present,
 }}
