// Design editing inside a preview page, like Figma. The preview server adds this to every page; it stays idle until
// the app sends {cba:'edit',on:true}. Click selects (Shift adds, Ctrl/⌘ picks the deepest element), drag moves with
// snapping and gap labels, handles resize, double-click edits text or goes one level deeper, Esc goes up a level.
// Ctrl/⌘ + scroll zooms around the pointer and Space or the hand tool pans, edit mode or not.
// Everything drawn here is marked data-cba, so saving the page ({cba:'html'}) leaves it out.
(()=>{if(window.__cbaEdit)return;window.__cbaEdit=true;
const html=document.documentElement,FR='.frame,[data-frame]',PINK='#ff3d8b',BLUE='#2f7bff';
const tell=m=>{if(parent!==window)try{parent.postMessage(m,'*')}catch{}};
const Z=()=>Number(html.style.zoom)||1,rect=e=>e.getBoundingClientRect();
let chartPick=false,on=false,hand=false,space=false,sel=[],hover=null,texting=null,textBefore=null,busy=false;
const ids=new WeakMap(),els=new Map();let seq=0;
const idOf=e=>{let i=ids.get(e);if(!i){i=++seq;ids.set(e,i);els.set(i,e)}return i};
const byId=i=>{const e=els.get(Number(i));return e?.isConnected?e:null};
const mine=n=>n instanceof Element&&Boolean(n.closest('[data-cba]'));
const frameOf=e=>e.closest(FR)||document.body;
const skip=e=>mine(e)||/^(SCRIPT|STYLE|LINK|META|BR|TEMPLATE|HEAD|TITLE)$/.test(e.tagName);

// ---- overlay (counter-zoomed so it draws in screen pixels) ----
const div=css=>{const d=document.createElement('div');d.style.cssText='position:absolute;box-sizing:border-box;'+css;return d};
const layer=div('position:fixed;inset:0;pointer-events:none;z-index:2147483640');layer.dataset.cba='1';
const hoverBox=div('outline:1px solid '+BLUE+';display:none'),group=div('outline:1.5px solid '+BLUE+';display:none'),guides=div('inset:0');
const tag=div('display:none;padding:2px 7px;border-radius:5px;background:'+BLUE+';color:#fff;font:600 11px/16px system-ui,sans-serif;white-space:nowrap;transform:translateX(-50%)');
const SPOTS={nw:[0,0],n:[.5,0],ne:[1,0],e:[1,.5],se:[1,1],s:[.5,1],sw:[0,1],w:[0,.5]};
const handles=Object.keys(SPOTS).map(h=>{const d=div('width:9px;height:9px;margin:-4.5px 0 0 -4.5px;background:#fff;border:1.5px solid '+BLUE+';border-radius:2px;pointer-events:auto;cursor:'+h+'-resize');d.dataset.h=h;group.append(d);return d});
const boxes=[];layer.append(hoverBox,group,tag,guides);
const place=(d,r)=>Object.assign(d.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
const union=list=>{const rs=list.map(rect),l=Math.min(...rs.map(r=>r.left)),t=Math.min(...rs.map(r=>r.top)),r=Math.max(...rs.map(r=>r.right)),b=Math.max(...rs.map(r=>r.bottom));return {left:l,top:t,right:r,bottom:b,width:r-l,height:b-t}};
let raf=0;const repaint=()=>{if(!raf)raf=requestAnimationFrame(paint)};
function paint(){raf=0;layer.style.zoom=String(1/Z());sel=sel.filter(e=>e.isConnected);
 const hv=(on||chartPick)&&hover?.isConnected&&!sel.includes(hover);hoverBox.style.display=hv?'':'none';if(hv)place(hoverBox,rect(hover));
 while(boxes.length<sel.length){const d=div('outline:1px solid '+BLUE);layer.insertBefore(d,group);boxes.push(d)}
 boxes.forEach((d,i)=>{const show=sel.length>1&&i<sel.length;d.style.display=show?'':'none';if(show)place(d,rect(sel[i]))});
 if(!sel.length){group.style.display=tag.style.display='none';return}
 const u=union(sel),z=Z();group.style.display='';place(group,u);
 for(const h of handles){const [x,y]=SPOTS[h.dataset.h];Object.assign(h.style,{left:x*u.width+'px',top:y*u.height+'px',display:texting||sel.length>1?'none':''})}
 tag.style.display='';tag.textContent=Math.round(u.width/z)+' × '+Math.round(u.height/z);Object.assign(tag.style,{left:u.left+u.width/2+'px',top:u.bottom+8+'px'})}
addEventListener('scroll',repaint,true);addEventListener('resize',repaint);new MutationObserver(repaint).observe(html,{attributes:true,attributeFilter:['style']});
const noSelect=Object.assign(document.createElement('style'),{textContent:'*{user-select:none!important}[contenteditable]{user-select:text!important;outline:none}'});noSelect.dataset.cba='1';

// ---- history: every change can be undone ----
const undo=[],redo=[];
const snap=list=>list.map(e=>[e,e.getAttribute('style'),e.children.length?null:e.textContent]);
const restore=s=>{for(const [e,st,tx] of s){st==null?e.removeAttribute('style'):e.setAttribute('style',st);if(tx!=null&&!e.children.length)e.textContent=tx}};
const push=op=>{undo.push({at:Date.now(),...op});if(undo.length>150)undo.shift();redo.length=0;changed()};
const record=(before,list,key)=>{const after=snap(list),last=undo.at(-1);if(key&&last?.key===key&&Date.now()-last.at<900){last.redo=()=>restore(after);last.at=Date.now();changed()}else push({key,undo:()=>restore(before),redo:()=>restore(after)})};
const step=(from,to)=>{const o=from.pop();if(!o)return;(from===undo?o.undo:o.redo)();to.push(o);sel=sel.filter(e=>e.isConnected);changed(true)};
let reportT=0;const changed=structural=>{repaint();clearTimeout(reportT);reportT=setTimeout(report,40);tell({cba:'changed',canUndo:undo.length>0,canRedo:redo.length>0});if(structural!==false&&layersWanted)sendLayers()};

// ---- what a click selects: frames' children first, then deeper (like Figma groups) ----
const childOf=(anc,t)=>{let n=t;while(n&&n.parentElement!==anc)n=n.parentElement;return n};
function pickable(t,deep){if(!(t instanceof Element)||skip(t)||t===html||t===document.body)return null;if(deep)return t;
 const s=sel[0];if(s){if(s.contains(t))return s;const p=s.parentElement;if(p&&p!==document.body&&p.contains(t)&&!p.matches(FR))return childOf(p,t)}
 const f=t.closest(FR);if(!f)return childOf(document.body,t);return t===f?f:childOf(f,t)}
const label=e=>{const name=e.dataset.name||e.getAttribute('aria-label');if(name)return name.slice(0,40);const t=(e.innerText||e.textContent||'').trim().replace(/\s+/g,' ');if(t&&(t.length<=40||!e.children.length))return t.slice(0,32);
 return e.tagName.toLowerCase()+(e.classList[0]?' .'+e.classList[0]:'')};
const selector=n=>{const parts=[];while(n&&n.nodeType===1&&parts.length<5){let s=n.tagName.toLowerCase();if(n.id){parts.unshift(s+'#'+CSS.escape(n.id));break}s+=[...n.classList].slice(0,2).map(c=>'.'+CSS.escape(c)).join('');const sib=n.parentElement?[...n.parentElement.children].filter(c=>c.tagName===n.tagName):[];if(sib.length>1)s+=':nth-of-type('+(sib.indexOf(n)+1)+')';parts.unshift(s);n=n.parentElement}return parts.join(' > ')};
const setSel=list=>{if(texting)endText();sel=[...new Set(list.filter(Boolean))];repaint();report();if(layersWanted)sendLayers(false)};
function report(){const z=Z(),items=sel.map(e=>{const s=getComputedStyle(e),r=rect(e),f=rect(frameOf(e));return {id:idOf(e),tag:e.tagName.toLowerCase(),label:label(e),text:e.children.length?null:e.textContent,image:e.tagName==='IMG'||s.backgroundImage!=='none',frame:e.matches(FR),selector:selector(e),html:e.outerHTML.slice(0,900),
  x:Math.round((r.left-f.left)/z),y:Math.round((r.top-f.top)/z),w:Math.round(r.width/z),h:Math.round(r.height/z),
  st:{color:s.color,background:s.backgroundColor,fontSize:s.fontSize,fontFamily:s.fontFamily,fontWeight:s.fontWeight,textAlign:s.textAlign,padding:s.paddingTop,radius:s.borderTopLeftRadius,borderWidth:s.borderTopWidth,borderColor:s.borderTopColor,shadow:s.boxShadow,opacity:s.opacity,display:s.display,direction:s.flexDirection,gap:s.columnGap,alignItems:s.alignItems,justify:s.justifyContent}}});
 const u=sel.length?union(sel):null;tell({cba:'selection',items,left:u?(u.left+u.width/2)/innerWidth:0,canUndo:undo.length>0,canRedo:redo.length>0})}

// ---- moving and resizing with snapping, pink guides and gap labels ----
const shift=e=>{const t=(e.style.translate||'').split(' ').map(parseFloat);return [t[0]||0,t[1]||0]};
const setShift=(e,x,y)=>{x=Math.round(x*10)/10;y=Math.round(y*10)/10;if(Math.abs(x)<.05&&Math.abs(y)<.05)e.style.removeProperty('translate');else e.style.translate=x+'px '+y+'px'};
const movable=e=>{if(getComputedStyle(e).display==='inline')e.style.display='inline-block'};
function targets(list){const p=list[0].parentElement,f=frameOf(list[0]),out=[];const add=(e,inner)=>{const r=rect(e);if(r.width||r.height)out.push({r,inner})};
 for(const c of p.children)if(!list.includes(c)&&!skip(c)&&!list.some(x=>c.contains(x)))add(c,false);if(p!==document.body)add(p,true);if(f!==p&&f!==document.body)add(f,true);return out}
const line=(x1,y1,x2,y2)=>{const d=div('background:'+PINK);Object.assign(d.style,x1===x2?{left:x1+'px',top:Math.min(y1,y2)+'px',width:'1px',height:Math.abs(y2-y1)+'px'}:{left:Math.min(x1,x2)+'px',top:y1+'px',height:'1px',width:Math.abs(x2-x1)+'px'});return d};
const pill=(x,y,text)=>{const d=div('padding:1px 5px;border-radius:4px;background:'+PINK+';color:#fff;font:600 10px/14px system-ui,sans-serif;transform:translate(-50%,-50%);white-space:nowrap');Object.assign(d.style,{left:x+'px',top:y+'px'});d.textContent=text;return d};
// snap the moving box m (screen px) to the targets; returns the correction and draws guides and gaps
function snapTo(m,ts,{snapX=true,snapY=true}={},T=6){let dx=0,dy=0,gx=null,gy=null;
 const xs=[m.left,m.left+m.width/2,m.right],ys=[m.top,m.top+m.height/2,m.bottom];let bx=T,by=T;
 for(const {r} of ts){for(const a of xs)for(const b of [r.left,r.left+r.width/2,r.right])if(snapX&&Math.abs(b-a)<bx){bx=Math.abs(b-a);dx=b-a;gx={v:b,r}}
  for(const a of ys)for(const b of [r.top,r.top+r.height/2,r.bottom])if(snapY&&Math.abs(b-a)<by){by=Math.abs(b-a);dy=b-a;gy={v:b,r}}}
 return {dx,dy,gx,gy}}
function drawGuides(m,ts,s){const out=[];const z=Z();
 if(s?.gx){const top=Math.min(m.top,s.gx.r.top),bot=Math.max(m.bottom,s.gx.r.bottom);out.push(line(s.gx.v,top,s.gx.v,bot))}
 if(s?.gy){const l=Math.min(m.left,s.gy.r.left),r=Math.max(m.right,s.gy.r.right);out.push(line(l,s.gy.v,r,s.gy.v))}
 // gaps to the nearest neighbour (or the container's inner edge) on each side
 const near={l:null,r:null,t:null,b:null};
 for(const {r,inner} of ts){const vOver=r.top<m.bottom&&r.bottom>m.top,hOver=r.left<m.right&&r.right>m.left;
  const cand=inner?{l:m.left-r.left,r:r.right-m.right,t:m.top-r.top,b:r.bottom-m.bottom}:{l:vOver&&r.right<=m.left+.5?m.left-r.right:null,r:vOver&&r.left>=m.right-.5?r.left-m.right:null,t:hOver&&r.bottom<=m.top+.5?m.top-r.bottom:null,b:hOver&&r.top>=m.bottom-.5?r.top-m.bottom:null};
  for(const k of ['l','r','t','b'])if(cand[k]!=null&&cand[k]>=0&&(near[k]==null||cand[k]<near[k]))near[k]=cand[k]}
 const cy=m.top+m.height/2,cx=m.left+m.width/2;
 if(near.l>0.5){out.push(line(m.left-near.l,cy,m.left,cy),pill(m.left-near.l/2,cy,Math.round(near.l/z)))}
 if(near.r>0.5){out.push(line(m.right,cy,m.right+near.r,cy),pill(m.right+near.r/2,cy,Math.round(near.r/z)))}
 if(near.t>0.5){out.push(line(cx,m.top-near.t,cx,m.top),pill(cx,m.top-near.t/2,Math.round(near.t/z)))}
 if(near.b>0.5){out.push(line(cx,m.bottom,cx,m.bottom+near.b),pill(cx,m.bottom+near.b/2,Math.round(near.b/z)))}
 guides.replaceChildren(...out)}
let gapTimer=0;const flashGaps=()=>{if(!sel.length)return;const m=union(sel);drawGuides(m,targets(sel),null);clearTimeout(gapTimer);gapTimer=setTimeout(()=>guides.replaceChildren(),900)};
function drag(e,list){const z=Z(),sx=e.clientX,sy=e.clientY,start=list.map(x=>[x,...shift(x)]),before=snap(list),m0=union(list),ts=targets(list);let moved=false;list.forEach(movable);
 const mv=ev=>{let dx=ev.clientX-sx,dy=ev.clientY-sy;if(!moved&&Math.hypot(dx,dy)<3)return;moved=true;
  const m={left:m0.left+dx,top:m0.top+dy,width:m0.width,height:m0.height};m.right=m.left+m.width;m.bottom=m.top+m.height;
  const s=ev.altKey?null:snapTo(m,ts);if(s){dx+=s.dx;dy+=s.dy;for(const k of ['left','right'])m[k]+=s.dx;for(const k of ['top','bottom'])m[k]+=s.dy}
  for(const [x,tx,ty] of start)setShift(x,tx+dx/z,ty+dy/z);drawGuides(m,ts,s);repaint()};
 const up=()=>{removeEventListener('pointermove',mv,true);removeEventListener('pointerup',up,true);guides.replaceChildren();if(moved)record(before,list)};
 addEventListener('pointermove',mv,true);addEventListener('pointerup',up,true)}
function resize(e,h){const el=sel[0];if(!el)return;e.preventDefault();e.stopPropagation();const z=Z(),r0=rect(el),[tx,ty]=shift(el),sx=e.clientX,sy=e.clientY,before=snap([el]),ts=targets([el]);
 movable(el);el.style.boxSizing='border-box';if(/flex|grid/.test(getComputedStyle(el.parentElement).display))el.style.flex='none';
 const w0=r0.width/z,h0=r0.height/z,ratio=w0/(h0||1),media=/^(IMG|VIDEO|CANVAS|SVG|PICTURE)$/i.test(el.tagName),corner=h.length===2;
 const mv=ev=>{const dx=(ev.clientX-sx)/z,dy=(ev.clientY-sy)/z;let w=w0,hh=h0;
  if(h.includes('e'))w=w0+dx;if(h.includes('w'))w=w0-dx;if(h.includes('s'))hh=h0+dy;if(h.includes('n'))hh=h0-dy;
  if(corner&&ev.shiftKey!==media){if(Math.abs(w-w0)/w0>Math.abs(hh-h0)/h0)hh=w/ratio;else w=hh*ratio}
  // snap the edges being dragged
  if(!ev.altKey){const m={left:r0.left+(h.includes('w')?(w0-w)*z:0),top:r0.top+(h.includes('n')?(h0-hh)*z:0)};m.width=w*z;m.height=hh*z;m.right=m.left+m.width;m.bottom=m.top+m.height;
   const edge=(v,list)=>{let best=6,d=0;for(const {r} of ts)for(const b of list(r))if(Math.abs(b-v)<best){best=Math.abs(b-v);d=b-v}return d};
   const X=r=>[r.left,r.left+r.width/2,r.right],Y=r=>[r.top,r.top+r.height/2,r.bottom];
   if(h.includes('e'))w+=edge(m.right,X)/z;if(h.includes('w'))w-=edge(m.left,X)/z;if(h.includes('s'))hh+=edge(m.bottom,Y)/z;if(h.includes('n'))hh-=edge(m.top,Y)/z}
  w=Math.max(4,w);hh=Math.max(4,hh);el.style.width=Math.round(w)+'px';if(h!=='e'&&h!=='w'||corner)el.style.height=Math.round(hh)+'px';
  setShift(el,tx+(h.includes('w')?w0-w:0),ty+(h.includes('n')?h0-hh:0));const m=union([el]);drawGuides(m,ts,null);repaint()};
 const up=()=>{removeEventListener('pointermove',mv,true);removeEventListener('pointerup',up,true);guides.replaceChildren();record(before,[el])};
 addEventListener('pointermove',mv,true);addEventListener('pointerup',up,true)}

// ---- text editing in place ----
function startText(el){if(el.children.length||texting===el)return;texting=el;textBefore=snap([el]);el.setAttribute('contenteditable','true');el.focus();const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);repaint()}
function endText(){const el=texting;if(!el)return;texting=null;el.removeAttribute('contenteditable');getSelection()?.removeAllRanges();if(el.textContent!==textBefore[0][2])record(textBefore,[el]);repaint()}

// ---- structure: duplicate, delete, add, reorder, layer order ----
const positioned=f=>{if(f!==document.body&&getComputedStyle(f).position==='static'){const b=snap([f]);f.style.position='relative';return b}return null};
function duplicate(){if(!sel.length)return;const pairs=sel.map(e=>{const c=e.cloneNode(true);if(/absolute|fixed/.test(getComputedStyle(e).position)){const [x,y]=shift(e);setShift(c,x+16,y+16)}return [e,c]});
 const put=()=>pairs.forEach(([e,c])=>e.after(c));put();push({undo:()=>pairs.forEach(([,c])=>c.remove()),redo:put});setSel(pairs.map(p=>p[1]))}
function remove(){if(!sel.length)return;const spots=sel.map(e=>[e,e.parentElement,e.nextSibling]);for(const [e] of spots)e.remove();
 push({undo:()=>{for(const [e,p,n] of spots.slice().reverse())p.insertBefore(e,n?.parentElement===p?n:null)},redo:()=>spots.forEach(([e])=>e.remove())});setSel([])}
function add(kind,src){const f=sel[0]?frameOf(sel[0]):document.querySelector(FR)||document.body,fr=rect(f),z=Z();const pb=positioned(f);
 const cx=Math.min(Math.max(innerWidth/2,fr.left+40),fr.right-40),cy=Math.min(Math.max(innerHeight/2,fr.top+40),fr.bottom-40);
 const el=document.createElement(kind==='text'?'p':kind==='image'?'img':'div'),[w,h]=kind==='text'?[240,40]:kind==='image'?[240,160]:[200,120];
 el.style.cssText='position:absolute;margin:0;left:'+Math.round((cx-fr.left)/z-w/2)+'px;top:'+Math.round((cy-fr.top)/z-h/2)+'px;';
 if(kind==='text'){el.textContent='Your text';el.style.cssText+='font:600 28px/1.25 "Plus Jakarta Sans",system-ui,sans-serif;color:#111;white-space:pre-wrap'}
 else if(kind==='image'){el.src=src;el.alt='';el.style.cssText+='width:240px;height:auto;display:block;border-radius:8px'}
 else el.style.cssText+='width:200px;height:120px;background:#dbe6ff;border-radius:12px';
 f.append(el);push({undo:()=>{el.remove();if(pb)restore(pb)},redo:()=>{if(pb)f.style.position='relative';f.append(el)}});setSel([el]);if(kind==='text')startText(el)}
function setImage(src){const list=sel.filter(e=>e.tagName==='IMG'||getComputedStyle(e).backgroundImage!=='none');if(!list.length)return add('image',src);
 const old=list.map(e=>[e,e.getAttribute('src'),e.getAttribute('srcset'),e.getAttribute('style')]);
 const apply=()=>{for(const [e] of old){if(e.tagName==='IMG'){e.src=src;e.removeAttribute('srcset')}else{e.style.backgroundImage='url("'+src+'")';e.style.backgroundSize='cover';e.style.backgroundPosition='center'}}};
 apply();push({undo:()=>{for(const [e,s,ss,st] of old){if(e.tagName==='IMG'){s==null?e.removeAttribute('src'):e.setAttribute('src',s);if(ss!=null)e.setAttribute('srcset',ss)}st==null?e.removeAttribute('style'):e.setAttribute('style',st)}},redo:apply})}
function reorder(id,beforeId,after){const el=byId(id),t=byId(beforeId);if(!el||!t||el===t||el.contains(t))return;const p=el.parentElement,n=el.nextSibling;
 const go=()=>after?t.after(el):t.before(el);go();push({undo:()=>p.insertBefore(el,n?.parentElement===p?n:null),redo:go})}
function layerOrder(how){if(!sel.length)return;const p=sel[0].parentElement,sib=[...p.children].filter(c=>!sel.includes(c)&&!skip(c));const zs=sib.map(c=>parseInt(getComputedStyle(c).zIndex)||0);const before=snap([...sel,p]);
 const v=how==='front'?Math.max(0,...zs)+1:Math.min(0,...zs)-1;if(how==='back')p.style.isolation='isolate';for(const e of sel){if(getComputedStyle(e).position==='static')e.style.position='relative';e.style.zIndex=String(v)}record(before,[...sel,p])}
function align(how){if(!sel.length)return;const z=Z(),before=snap(sel);const ref=sel.length>1?union(sel):rect(sel[0].parentElement===document.body?frameOf(sel[0]):sel[0].parentElement);sel.forEach(movable);
 if(how==='dist-h'||how==='dist-v'){if(sel.length<3)return;const H=how==='dist-h',list=sel.map(e=>[e,rect(e)]).sort((a,b)=>H?a[1].left-b[1].left:a[1].top-b[1].top);
  const total=(H?ref.width:ref.height)-list.reduce((s,[,r])=>s+(H?r.width:r.height),0),gap=total/(list.length-1);let at=H?ref.left:ref.top;
  for(const [e,r] of list){const [x,y]=shift(e),d=at-(H?r.left:r.top);H?setShift(e,x+d/z,y):setShift(e,x,y+d/z);at+=(H?r.width:r.height)+gap}}
 else for(const e of sel){const r=rect(e),[x,y]=shift(e);const d={left:ref.left-r.left,hcenter:ref.left+ref.width/2-(r.left+r.width/2),right:ref.right-r.right,top:ref.top-r.top,vcenter:ref.top+ref.height/2-(r.top+r.height/2),bottom:ref.bottom-r.bottom}[how]||0;
  /left|hcenter|right/.test(how)?setShift(e,x+d/z,y):setShift(e,x,y+d/z)}
 record(before,sel);flashGaps()}
function setBox(b){const e=sel[0];if(!e)return;const z=Z(),r=rect(e),f=rect(frameOf(e)),[x,y]=shift(e),before=snap([e]);movable(e);
 if(b.x!=null)setShift(e,x+(b.x-(r.left-f.left)/z),shift(e)[1]);if(b.y!=null){const [nx]=shift(e);setShift(e,nx,y+(b.y-(r.top-f.top)/z))}
 if(b.w!=null||b.h!=null)e.style.boxSizing='border-box';if(b.w!=null)e.style.width=Math.max(1,b.w)+'px';if(b.h!=null)e.style.height=Math.max(1,b.h)+'px';record(before,[e],'box')}
let layersWanted=false;
function sendLayers(){const roots=[...document.querySelectorAll(FR)],out=[];const walk=(n,d)=>{for(const c of n.children){if(skip(c)||out.length>=400)continue;out.push({id:idOf(c),depth:d,label:label(c),tag:c.matches(FR)?'frame':c.tagName.toLowerCase(),kids:c.children.length>0});if(d<6)walk(c,d+1)}};
 if(roots.length)for(const r of roots){out.push({id:idOf(r),depth:0,label:label(r),tag:'frame',kids:true});walk(r,1)}else walk(document.body,0);
 tell({cba:'layers',list:out,selected:sel.map(idOf)})}

// ---- pointer and keys ----
const cursor=()=>{html.style.cursor=hand||space?'grab':''};
addEventListener('wheel',e=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();const old=Z(),nz=Math.max(.1,Math.min(2,old*(e.deltaY<0?1.12:1/1.12)));const px=(scrollX+e.clientX)/old,py=(scrollY+e.clientY)/old;html.style.zoom=String(nz);scrollTo(px*nz-e.clientX,py*nz-e.clientY);tell({cba:'zoomed',value:nz})},{passive:false});
addEventListener('pointerdown',e=>{if(e.button!==0)return;
 if(hand||space){e.preventDefault();e.stopPropagation();const sx=e.clientX,sy=e.clientY,ox=scrollX,oy=scrollY,z=Z();html.style.cursor='grabbing';const mv=ev=>scrollTo(ox-(ev.clientX-sx),oy-(ev.clientY-sy));const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);cursor()};addEventListener('pointermove',mv);addEventListener('pointerup',up);return}
 if(!on||busy)return;if(texting&&texting.contains(e.target))return;if(texting)endText();
 const h=e.target instanceof Element&&e.target.dataset?.h;if(h&&mine(e.target))return resize(e,h);if(mine(e.target))return;
 const c=pickable(e.target,e.ctrlKey||e.metaKey);e.preventDefault();e.stopPropagation();if(!c)return setSel([]);
 if(e.shiftKey){setSel(sel.includes(c)?sel.filter(x=>x!==c):[...sel,c]);return}
 if(!sel.includes(c))setSel([c]);drag(e,sel.slice())},true);
addEventListener('click',e=>{if(!chartPick)return;const c=e.target instanceof Element?e.target.closest('[data-chart]'):null;e.preventDefault();e.stopPropagation();endChartPick();if(c)tell({cba:'chart-picked',i:Number(c.dataset.chart)||0})},true);
const endChartPick=()=>{chartPick=false;hover=null;html.style.cursor='';if(!on)layer.remove();repaint()};
addEventListener('keydown',e=>{if(chartPick&&e.key==='Escape')endChartPick()},true);
for(const t of ['click','mousedown','mouseup','auxclick','submit'])addEventListener(t,e=>{if(on&&!(texting&&texting.contains(e.target))&&!mine(e.target)){e.preventDefault();e.stopPropagation()}},true);
addEventListener('dblclick',e=>{if(!on)return;e.preventDefault();e.stopPropagation();const s=sel[0];if(!s)return;if(!s.children.length)return startText(s);const c=childOf(s,e.target);if(c&&c!==s)setSel([c])},true);
addEventListener('pointermove',e=>{if(chartPick){const c=e.target instanceof Element?e.target.closest('[data-chart]'):null;if(c!==hover){hover=c;repaint()}return}if(!on||e.buttons)return;const c=mine(e.target)?null:pickable(e.target,e.ctrlKey||e.metaKey);if(c!==hover){hover=c;repaint()}},true);
addEventListener('pointerleave',()=>{hover=null;repaint()});
addEventListener('keydown',e=>{if(e.code==='Space'&&!e.target.closest?.('input,textarea,[contenteditable]')){space=true;cursor();e.preventDefault();return}
 if(!on)return;if(texting){if(e.key==='Escape'||e.key==='Enter'&&!e.shiftKey){e.preventDefault();endText()}return}if(e.target.closest?.('input,textarea,select'))return;
 const k=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
 if(mod&&k==='z'){e.preventDefault();step(e.shiftKey?redo:undo,e.shiftKey?undo:redo)}else if(mod&&k==='y'){e.preventDefault();step(redo,undo)}
 else if(mod&&k==='d'){e.preventDefault();duplicate()}else if(k==='delete'||k==='backspace'){e.preventDefault();remove()}
 else if(e.key.startsWith('Arrow')&&sel.length){e.preventDefault();const n=e.shiftKey?10:1,before=snap(sel);sel.forEach(movable);for(const x of sel){const [a,b]=shift(x);setShift(x,a+(k==='arrowleft'?-n:k==='arrowright'?n:0),b+(k==='arrowup'?-n:k==='arrowdown'?n:0))}record(before,sel,'nudge');flashGaps()}
 else if(k==='escape'){const p=sel[0]?.parentElement;setSel(p&&p!==document.body&&!sel[0].matches(FR)?[p]:[])}
 else if(k==='enter'&&sel.length===1){e.preventDefault();const s=sel[0];if(!s.children.length)startText(s);else setSel([...s.children].filter(c=>!skip(c)))}
 else if(!mod&&['v','h','t','r'].includes(k))tell({cba:'tool',name:k})});
addEventListener('keyup',e=>{if(e.code==='Space'){space=false;cursor()}});
addEventListener('focusout',e=>{if(texting&&e.target===texting)endText()});

// ---- a frame as SVG: its HTML inside foreignObject, with the page's styles and images embedded ----
async function frameSvg(i){const f=[...document.querySelectorAll(FR)][i]||document.body,w=f.offsetWidth,h=f.offsetHeight;let css='';
 for(const s of document.styleSheets){try{css+=[...s.cssRules].map(r=>r.cssText).join('\n')}catch{if(s.href)css='@import url("'+s.href+'");\n'+css}}
 const copy=f.cloneNode(true);copy.style.margin='0';copy.style.removeProperty('translate');const imgs=[...copy.querySelectorAll('img')],orig=[...f.querySelectorAll('img')];
 await Promise.all(imgs.map(async(im,k)=>{try{const b=await (await fetch(orig[k].currentSrc||orig[k].src)).blob();im.src=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(b)});im.removeAttribute('srcset')}catch{}}));
 // symbols, gradients and filters the frame points at (<use href="#…">, fill="url(#…)") but that live elsewhere in the page
 const want=new Set();for(const n of copy.querySelectorAll('*')){for(const a of n.attributes){const m=a.value.match(/^#([\w-]+)$/)||a.value.match(/url\(["']?#([\w-]+)/);if(m&&(a.name.endsWith('href')||/url\(/.test(a.value)))want.add(m[1])}}
 const defs=document.createElementNS('http://www.w3.org/2000/svg','svg');defs.setAttribute('width','0');defs.setAttribute('height','0');defs.setAttribute('style','position:absolute');for(const id of want){const src=document.getElementById(id);if(src&&!copy.querySelector('#'+CSS.escape(id)))defs.append(src.cloneNode(true))}
 const box=document.createElement('div');box.setAttribute('xmlns','http://www.w3.org/1999/xhtml');const st=document.createElement('style');st.textContent=css;box.append(st);if(defs.children.length)box.append(defs);box.append(copy);
 return '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><foreignObject width="100%" height="100%">'+new XMLSerializer().serializeToString(box)+'</foreignObject></svg>'}
// ---- the app's messages ----
function setOn(v){on=v;if(on){html.append(layer);document.head.append(noSelect)}else{if(texting)endText();sel=[];hover=null;guides.replaceChildren();layer.remove();noSelect.remove()}repaint()}
function serialize(){if(texting)endText();const copy=html.cloneNode(true);copy.style.removeProperty('zoom');copy.style.removeProperty('cursor');if(!copy.getAttribute('style'))copy.removeAttribute('style');
 copy.querySelectorAll('script[src*="/__cba-"],style[data-cba],div[data-cba]').forEach(n=>n.remove());copy.querySelectorAll('[data-cba-moving]').forEach(n=>n.removeAttribute('data-cba-moving'));return '<!doctype html>'+copy.outerHTML}
addEventListener('message',e=>{if(e.source!==parent)return;const d=e.data||{};
 switch(d.cba){
  case 'edit':setOn(Boolean(d.on));break;
  case 'hand':hand=Boolean(d.on);cursor();break;
  case 'chart-pick':{const n=document.querySelectorAll('[data-chart]').length;chartPick=Boolean(d.on)&&n>0;if(chartPick){html.append(layer);html.style.cursor='pointer'}tell({cba:'chart-pick',count:n});break}
  case 'busy':busy=Boolean(d.on);if(busy)setSel([]);break;
  case 'style':{const list=sel.slice();if(!list.length)break;const before=snap(list);for(const el of list){if(typeof d.text==='string'&&!el.children.length)el.textContent=d.text;for(const [k,v] of Object.entries(d.styles||{}))v===''||v==null?el.style.removeProperty(k):el.style.setProperty(k,v)}record(before,list,d.key);break}
  case 'box':setBox(d);break;
  case 'align':align(d.how);break;
  case 'order':layerOrder(d.how);break;
  case 'dup':duplicate();break;
  case 'del':remove();break;
  case 'undo':step(undo,redo);break;
  case 'redo':step(redo,undo);break;
  case 'add':add(d.kind,d.src);break;
  case 'image':setImage(d.src);break;
  case 'select':setSel((d.ids||[]).map(byId));if(sel[0])sel[0].scrollIntoView({block:'nearest',inline:'nearest'});break;
  case 'hover':hover=byId(d.id);repaint();break;
  case 'layers':layersWanted=Boolean(d.on);if(layersWanted)sendLayers();break;
  case 'reorder':reorder(d.id,d.target,d.after);break;
  case 'html':tell({cba:'page-html',html:serialize()});break;
  case 'svg':frameSvg(Number(d.i)||0).then(svg=>tell({cba:'frame-svg',svg})).catch(()=>tell({cba:'frame-svg',svg:''}));break}});
})();
