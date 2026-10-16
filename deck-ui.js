// Slide editor in the Artifacts panel: thumbnail strip (drag to reorder), the current slide large with text you can
// edit in place, layout and notes, per-slide AI actions, and present mode. The deck stays data (deck.json).
import {slideBlock,paintSlides,paintFormatting,fieldCss,FONTS,LAYOUTS,LAYOUT_NAMES} from './deck-render.js';
import {openMenu,promptDialog} from './ui-kit.js';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const ICON={more:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',comment:'<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',image:'<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',notes:'<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',play:'<path d="M7 5v14l12-7z"/>'};
const icon=n=>'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">'+ICON[n]+'</svg>';
// read and write a dotted path like "slides.2.left.bullets.1"
const getAt=(o,p)=>p.split('.').reduce((a,k)=>a==null?a:a[k],o);
function setAt(o,p,v){const ks=p.split('.');let a=o;for(let i=0;i<ks.length-1;i++){const k=ks[i];if(a[k]==null||typeof a[k]!=='object')a[k]=/^\d+$/.test(ks[i+1])?[]:{};a=a[k]}a[ks.at(-1)]=v}

export function createDeckView(root,ctx){
 let deck=null,current=0,ds=null,resolve=null,saveTimer=null,editing=false,dragFrom=null;
 const strip=el('div','dk-strip');strip.setAttribute('role','listbox');strip.setAttribute('aria-label','Slides');
 const stage=el('div','dk-stage'),frame=el('div','dk-frame'),tools=el('div','dk-tools'),notes=el('textarea','dk-notes');notes.placeholder='Speaker notes for this slide';notes.rows=3;notes.hidden=true;notes.setAttribute('aria-label','Speaker notes');
 const cbar=el('div','dk-comments');cbar.hidden=true;let comments=[];ctx.comments?.().then(c=>{comments=c||[];paintComments()}).catch(()=>{});
 // formatting bar: works on the text you last clicked on the slide; Slide colour works on the whole slide
 let shownAt=-1;const fmt=el('div','dk-format');fmt.setAttribute('role','toolbar');fmt.setAttribute('aria-label','Text formatting');let sel=null;
 const fBtn=(label,title,on)=>{const b=el('button','dk-fbtn',label);b.type='button';b.title=title;b.setAttribute('aria-label',title);b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('click',on);return b};
 const font=el('select','dk-font');font.setAttribute('aria-label','Font');font.append(new Option('Font',''));for(const f of FONTS)font.append(new Option(f,f));
 const color=el('input','dk-color');color.type='color';color.title='Text colour';color.setAttribute('aria-label','Text colour');
 const bgc=el('input','dk-color');bgc.type='color';bgc.title='Slide colour';bgc.setAttribute('aria-label','Slide colour');
 const hint=el('span','dk-fhint','Click text on the slide to format it');
 const style=()=>{if(!sel)return null;const s=deck.slides[current];s.style??={};return s.style[sel.key]??={}};
 const applyFmt=patch=>{if(!sel)return ctx.notify('Click some text on the slide first.');const st=style();Object.assign(st,patch);for(const k of Object.keys(st))if(st[k]===undefined||st[k]===null)delete st[k];if(!Object.keys(st).length)delete deck.slides[current].style[sel.key];sel.el.style.cssText=fieldCss(st);save();paintStrip();syncBar()};
 const sizeNow=()=>{const sw=frame.querySelector('.slide')?.getBoundingClientRect().width||1;return parseFloat(getComputedStyle(sel.el).fontSize)/sw*100};
 const bigger=fBtn('A+','Larger text',()=>sel&&applyFmt({size:Math.min(30,sizeNow()*1.12)})),smaller=fBtn('A−','Smaller text',()=>sel&&applyFmt({size:Math.max(.6,sizeNow()/1.12)}));
 const bold=fBtn('B','Bold',()=>sel&&applyFmt({bold:!(parseInt(getComputedStyle(sel.el).fontWeight)>=600)})),ital=fBtn('I','Italic',()=>sel&&applyFmt({italic:!style()?.italic||undefined}));bold.classList.add('b');ital.classList.add('i');
 const al=['left','center','right'].map(a=>{const b=fBtn('','Align '+a,()=>sel&&applyFmt({align:a}));b.innerHTML='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="'+({left:'M4 6h16M4 10h10M4 14h16M4 18h10',center:'M4 6h16M7 10h10M4 14h16M7 18h10',right:'M4 6h16M10 10h10M4 14h16M10 18h10'})[a]+'"/></svg>';b.dataset.align=a;return b});
 const reset=fBtn('Reset','Clear this text\'s formatting',()=>{if(!sel)return;delete deck.slides[current].style?.[sel.key];sel.el.style.cssText='';save();paintStrip();syncBar()});
 font.onchange=()=>{applyFmt({font:font.value||undefined})};color.oninput=()=>applyFmt({color:color.value});
 bgc.oninput=()=>{deck.slides[current].bg=bgc.value;const inner=frame.querySelector('.slide-in');if(inner)inner.style.background=bgc.value;save();paintStrip()};
 const bgReset=fBtn('×','Back to the design system colour',()=>{delete deck.slides[current].bg;save();render()});bgReset.classList.add('dk-bgreset');
 const sep=()=>el('span','dk-fsep');const bgWrap=el('label','dk-bg');bgWrap.append(el('span','','Slide'),bgc,bgReset);
 const cx=fBtn('','Centre across the slide',()=>centre('x')),cy=fBtn('','Centre down the slide',()=>centre('y')),home=fBtn('','Back to the layout position',()=>{if(!sel)return;setPos({dx:0,dy:0});const st=deck.slides[current].style?.[mKey()];if(st){delete st.w;mEl().style.cssText=fieldCss(st)}place();save();paintStrip()});
 cx.innerHTML='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M7 8h10v8H7z"/></svg>';cy.innerHTML='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18M8 7h8v10H8z"/></svg>';home.innerHTML='<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7M6 10v10h12V10"/></svg>';
 const tableOps=el('span','dk-table');const tOp=(label,title,fn)=>fBtn(label,title,()=>{const s=deck.slides[current];if(!s.table)return;fn(s.table);save(0);render()});
 const reselect=k=>{const n=[...frame.querySelectorAll('[data-field],[data-box]')].find(n=>keyOf(n)===k)||(k.startsWith('table')?frame.querySelector('[data-box$=table]'):null);if(!n)return;const box=n.dataset.box?null:n.closest('[data-box]');sel=n.dataset.box?{el:n,key:keyOf(n),box:true}:{el:n,key:keyOf(n),...(box?{mel:box,mkey:keyOf(box)}:{})};syncBar();place()};
 tableOps.append(tOp('+ Row','Add a row',t=>{t.rows=[...(t.rows||[]),(t.head||[]).map(()=>'')]}),tOp('− Row','Remove the last row',t=>{if((t.rows||[]).length>1)t.rows.pop()}),tOp('+ Col','Add a column',t=>{t.head=[...(t.head||[]),'New'];t.rows=(t.rows||[]).map(r=>[...r,''])}),tOp('− Col','Remove the last column',t=>{if((t.head||[]).length>1){t.head.pop();t.rows=(t.rows||[]).map(r=>r.slice(0,-1))}}));
 fmt.append(font,smaller,bigger,bold,ital,color,sep(),...al,reset,sep(),cx,cy,home,tableOps,hint,el('span','dk-grow'),bgWrap);
 const hex=c=>{const m=String(c).match(/\d+/g);return m&&m.length>=3?'#'+m.slice(0,3).map(n=>(+n).toString(16).padStart(2,'0')).join(''):'#000000'};
 function syncBar(){const on=Boolean(sel&&frame.contains(sel.el)),text=on&&!sel.box;fmt.classList.toggle('has-sel',on);fmt.classList.toggle('box-sel',on&&!text);for(const c of [font,smaller,bigger,bold,ital,color,...al,reset])c.disabled=!text;hint.hidden=on;tableOps.hidden=!(on&&(sel.key.startsWith('table')));
  const s=deck?.slides[current];const solid=getComputedStyle(frame.querySelector('.slide-in')||frame).backgroundColor;bgc.value=/^#[0-9a-f]{6}$/i.test(s?.bg||'')?s.bg:/rgba\(0, 0, 0, 0\)|transparent/.test(solid)?(getComputedStyle(frame.querySelector('.slide')||frame).getPropertyValue('--ds-accent').trim()||'#0158cb'):hex(solid);bgReset.hidden=!s?.bg;
  if(!text)return;const cs=getComputedStyle(sel.el),st=style()||{};font.value=st.font||'';color.value=st.color||hex(cs.color);bold.setAttribute('aria-pressed',String(parseInt(cs.fontWeight)>=600));ital.setAttribute('aria-pressed',String(cs.fontStyle==='italic'));for(const b of al)b.setAttribute('aria-pressed',String((st.align||'')===b.dataset.align))}
 const overlay=el('div','dk-sel');overlay.hidden=true;const grip=el('button','dk-grip','⠿');grip.type='button';grip.title='Drag to move (snaps to the centre and edges)';grip.setAttribute('aria-label','Move');const widthH=el('span','dk-wh');widthH.title='Drag to change the width';overlay.append(grip,widthH);
 const guides=el('div','dk-guides');guides.setAttribute('aria-hidden','true');frame.append(overlay,guides);
 const slideBox=()=>frame.querySelector('.slide')?.getBoundingClientRect();const unit=()=>(slideBox()?.width||1)/100;
 const keyOf=n=>(n.dataset.field||n.dataset.box||'').split('.').slice(2).join('.');
 const mEl=()=>sel?.mel||sel?.el,mKey=()=>sel?.mkey||sel?.key;
 function place(){const n=mEl();if(!n||!frame.contains(n)){overlay.hidden=true;return}const f=frame.getBoundingClientRect(),r=n.getBoundingClientRect();overlay.hidden=false;Object.assign(overlay.style,{left:(r.left-f.left)+'px',top:(r.top-f.top)+'px',width:r.width+'px',height:r.height+'px'})}
 function setPos(patch){const s=deck.slides[current];s.style??={};const st=s.style[mKey()]??={};Object.assign(st,patch);for(const k of ['dx','dy'])if(Math.abs(st[k]||0)<.05)delete st[k];if(!Object.keys(st).length)delete s.style[mKey()];mEl().style.cssText=fieldCss(st);place()}
 // snapping: the element's left, centre and right (and top, middle, bottom) meet the slide's margins and centre or another element's
 function snap(n,dx,dy){const u=unit(),sb=slideBox(),r=n.getBoundingClientRect(),st=deck.slides[current].style?.[mKey()]||{};const bx=(r.left-sb.left)/u-(st.dx||0),by=(r.top-sb.top)/u-(st.dy||0),w=r.width/u,h=r.height/u;
  const H=sb.height/u,xs=[7.5,50,92.5],ys=[6.5,H/2,H-5.5];for(const o of frame.querySelectorAll('.slide [data-field],.slide [data-box]')){if(o===n||o.contains(n)||n.contains(o))continue;const q=o.getBoundingClientRect();xs.push((q.left-sb.left)/u,(q.left-sb.left+q.width/2)/u,(q.right-sb.left)/u);ys.push((q.top-sb.top)/u,(q.top-sb.top+q.height/2)/u,(q.bottom-sb.top)/u)}
  const T=.9;let gx=null,gy=null;const best=(pos,targets)=>{let m=null;for(const t of targets)for(const [k,off] of pos){const d=t-(off);if(Math.abs(d)<=T&&(!m||Math.abs(d)<Math.abs(m.d)))m={d,t,k}}return m};
  const mx=best([['l',bx+dx],['c',bx+dx+w/2],['r',bx+dx+w]],xs),my=best([['t',by+dy],['m',by+dy+h/2],['b',by+dy+h]],ys);if(mx){dx+=mx.d;gx=mx.t}if(my){dy+=my.d;gy=my.t}
  guides.replaceChildren();if(gx!=null){const g=el('i','v');g.style.left=(sb.left-frame.getBoundingClientRect().left+gx*u)+'px';g.style.top=(sb.top-frame.getBoundingClientRect().top)+'px';g.style.height=sb.height+'px';guides.append(g)}
  if(gy!=null){const g=el('i','h');g.style.top=(sb.top-frame.getBoundingClientRect().top+gy*u)+'px';g.style.left=(sb.left-frame.getBoundingClientRect().left)+'px';g.style.width=sb.width+'px';guides.append(g)}return [dx,dy]}
 function drag(e,mode){if(!sel||ctx.locked?.())return;e.preventDefault();const u=unit(),st=deck.slides[current].style?.[mKey()]||{},sx=e.clientX,sy=e.clientY,dx0=st.dx||0,dy0=st.dy||0,w0=st.w||mEl().getBoundingClientRect().width/u;let moved=false;
  const move=ev=>{moved=true;if(mode==='w'){setPos({w:Math.max(5,Math.min(100,w0+(ev.clientX-sx)/u))});return}let dx=dx0+(ev.clientX-sx)/u,dy=dy0+(ev.clientY-sy)/u;if(!ev.altKey)[dx,dy]=snap(mEl(),dx,dy);setPos({dx,dy})};
  const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up);guides.replaceChildren();if(moved){save();paintStrip()}};addEventListener('pointermove',move);addEventListener('pointerup',up)}
 grip.addEventListener('pointerdown',e=>drag(e,'move'));widthH.addEventListener('pointerdown',e=>drag(e,'w'));
 // centre on the slide (across, down), back to the layout's place, and nudge with arrows
 function centre(axis){if(!sel)return;const u=unit(),sb=slideBox(),r=mEl().getBoundingClientRect(),st=deck.slides[current].style?.[mKey()]||{};if(axis==='x')setPos({dx:(st.dx||0)+(sb.left+sb.width/2-(r.left+r.width/2))/u});else setPos({dy:(st.dy||0)+(sb.top+sb.height/2-(r.top+r.height/2))/u});save();paintStrip()}
 frame.addEventListener('keydown',e=>{if(!sel||editing||!/^Arrow/.test(e.key))return;e.preventDefault();e.stopPropagation();const st=deck.slides[current].style?.[mKey()]||{},step=e.shiftKey?2:.4;setPos({dx:(st.dx||0)+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),dy:(st.dy||0)+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)});clearTimeout(nudgeT);nudgeT=setTimeout(()=>{save();paintStrip()},300)},true);let nudgeT=null;
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

 function paintSlide(){const s=deck.slides[current];const keep=shownAt===current?sel?.key:null;shownAt=current;if(!s){frame.replaceChildren(el('div','dk-empty','This deck has no slides yet.'));tools.replaceChildren();return}
  put(frame,current);frame.querySelector('.slide').classList.add('dk-live');const locked=ctx.locked?.();frame.classList.toggle('dk-locked',Boolean(locked));
  for(const f of frame.querySelectorAll('[data-field]')){if(locked)continue;f.contentEditable='true';f.spellcheck=true;
   f.addEventListener('focus',()=>{editing=true;const box=f.closest('[data-box]');sel={el:f,key:f.dataset.field.split('.').slice(2).join('.'),...(box?{mel:box,mkey:keyOf(box)}:{})};syncBar();place()});f.addEventListener('blur',()=>{editing=false;commit(f)});
   f.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();f.blur()}if(e.key==='Escape'){e.preventDefault();f.textContent=getAt(deck,f.dataset.field)??'';f.blur()}});
   f.addEventListener('paste',e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'))})}
  notes.value=s.notes||'';sel=null;syncBar();overlay.hidden=true;frame.append(overlay,guides);
  for(const b of frame.querySelectorAll('[data-box]')){b.addEventListener('pointerdown',e=>{if(ctx.locked?.()||e.target.closest('[data-field]'))return;sel={el:b,key:keyOf(b),box:true};syncBar();place();frame.focus({preventScroll:true});drag(e,'move')});
   b.addEventListener('dblclick',()=>{if(b.dataset.box.endsWith('.chart'))editChart()})}
  if(keep)reselect(keep);
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
   ...(['image','team'].includes(s.layout)||s.image!==undefined?[{label:'Upload an image…',action:pickImage},{label:s.imageFit==='contain'?'Fill the image frame':'Show the whole image',disabled:!s.image,action:()=>{s.imageFit=s.imageFit==='contain'?'cover':'contain';save();render()}}]:[{label:'Use an image layout',action:()=>{s.layout='image';save();render()}}]),
   ...(s.layout==='chart'?[{label:'Edit chart data…',action:editChart}]:[]),'separator',{label:'Comment on this slide…',action:comment},{label:'Review the whole deck',action:review},{label:'Open notes window',action:notesWindow}],{anchor:more,label:'Slide actions'}));
  tools.replaceChildren(count,lay,nb,grow,ask('Rewrite','rewrite it to be clearer and more persuasive.'),ask('Shorten','cut the text by half, keep the meaning.'),ask('Make visual','make it more visual: pick a better layout, a chart or an image.'),more,play)}
 // images: upload into the output folder and place on the slide
 function pickImage(){const f=el('input');f.type='file';f.accept='image/png,image/jpeg,image/webp,image/gif';f.onchange=async()=>{const file=f.files[0];if(!file)return;if(file.size>8e6)return ctx.notify('Use an image under 8 MB.');try{const s=deck.slides[current];s.image=await ctx.upload(file);if(!['image','team'].includes(s.layout))s.layout='image';save(0);render()}catch(e){ctx.notify(e.message)}};f.click()}
 // chart data: a small table you can edit or paste into (tab or comma separated, first row = series names)
 function editChart(){const s=deck.slides[current];const c=s.chart||{type:'bar',labels:[],series:[]};const d=el('dialog','kit-dialog chart-dialog');const h=el('h2','','Chart data');const type=el('select');for(const t of ['bar','line','pie'])type.append(new Option(t[0].toUpperCase()+t.slice(1),t));type.value=c.type||'bar';
  const ta=el('textarea','chart-grid');ta.rows=8;ta.spellcheck=false;ta.value=['Label',...(c.series||[]).map(x=>x.name||'Series')].join('\t')+'\n'+(c.labels||[]).map((l,i)=>[l,...(c.series||[]).map(x=>x.values?.[i]??'')].join('\t')).join('\n');
  const hint=el('p','kit-message small-print','One row per label. Columns are separated by tabs or commas; the first row names the series. You can paste straight from a spreadsheet.');
  const cols=el('div','chart-colors');cols.append(el('span','','Colours'));const picks=[0,1,2,3].map(i=>{const p=el('input');p.type='color';p.value=(c.colors||[])[i]||['#0158cb','#2f7bff','#646875','#0b0c10'][i];p.setAttribute('aria-label','Colour of series '+(i+1));cols.append(p);return p});
  const row=el('div','dialog-actions');const cancel=el('button','','Cancel');cancel.type='button';const ok=el('button','primary','Save chart');ok.type='button';row.append(cancel,ok);d.append(h,type,ta,hint,cols,row);document.body.append(d);d.showModal();const close=()=>{d.close();setTimeout(()=>d.remove(),180)};cancel.onclick=close;
  ok.onclick=()=>{const rows=ta.value.trim().split(/\r?\n/).map(r=>r.split(/\t|,/).map(x=>x.trim()));const [head,...body]=rows;if(!head||!body.length)return ctx.notify('Add at least one row of numbers.');s.chart={type:type.value,colors:picks.map(p=>p.value),labels:body.map(r=>r[0]),series:head.slice(1).map((n,j)=>({name:n,values:body.map(r=>Number(String(r[j+1]||'').replace(/[^\d.-]/g,''))||0)}))};s.layout='chart';save(0);render();close()}}
 // comments per slide, sent to the AI together
 async function comment(){const s=deck.slides[current];const text=await promptDialog({title:'Comment on slide '+(current+1),message:s.title||'',confirm:'Add comment',input:{label:'Your comment',max:400}});if(!text)return;comments.push({quote:'Slide '+(current+1)+(s.title?': '+s.title:''),text,time:Date.now()});await ctx.saveComments?.(comments);paintComments()}
 function paintComments(){cbar.hidden=!comments.length;cbar.replaceChildren();if(!comments.length)return;const head=el('div','doc-comments-head');head.append(el('strong','',comments.length+(comments.length===1?' comment':' comments')));const send=el('button','primary','Send to AI');send.type='button';
  send.onclick=async()=>{ctx.send('Please address these comments on '+ctx.title()+':\n'+comments.map((c,i)=>(i+1)+'. '+c.quote+': '+c.text).join('\n'));comments=[];await ctx.saveComments?.(comments);paintComments()};head.append(send);cbar.append(head);
  comments.forEach((c,i)=>{const r=el('div','doc-comment');const x=el('button','link-button','Resolve');x.type='button';x.onclick=async()=>{comments.splice(i,1);await ctx.saveComments?.(comments);paintComments()};r.append(el('q','',c.quote),el('p','',c.text),x);cbar.append(r)})}
 function review(){ctx.send('Review '+ctx.title()+' slide by slide. For each slide give a one-line verdict on clarity, text density and visual hierarchy (good / needs work), then fix the slides that need work in the deck file. End with next_steps listing what you changed.')}
 // notes window: speaker notes, the next slide and a timer in their own window (for a second screen)
 let notesWin=null;function notesWindow(){if(notesWin&&!notesWin.closed){notesWin.focus();return}notesWin=open('','cba-notes','width=520,height=420');if(!notesWin)return ctx.notify('Allow pop-ups to open the notes window.');const w=notesWin,doc=w.document;doc.title='Speaker notes';
  const bodyStyle='margin:0;padding:20px;font:16px/1.6 "Plus Jakarta Sans",system-ui,sans-serif;background:#0f1420;color:#eef0f4';doc.body.style.cssText=bodyStyle;const top=doc.createElement('div'),now=doc.createElement('h1'),text=doc.createElement('div'),next=doc.createElement('p');top.style.cssText='font-size:13px;color:#9aa6bd';now.style.cssText='font-size:20px;margin:6px 0 12px';text.style.cssText='font-size:18px;white-space:pre-wrap';next.style.cssText='margin-top:18px;font-size:13px;color:#9aa6bd';doc.body.append(top,now,text,next);
  const start=Date.now();const paint=()=>{if(w.closed)return clearInterval(t);const s=deck.slides[presentAt??current]||{},n=deck.slides[(presentAt??current)+1];const sec=Math.floor((Date.now()-start)/1000);top.textContent='Slide '+((presentAt??current)+1)+' / '+deck.slides.length+'  ·  '+Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');now.textContent=s.title||'';text.textContent=s.notes||'No notes for this slide.';next.textContent=n?'Next: '+(n.title||LAYOUT_NAMES[n.layout]):'Last slide'};const t=setInterval(paint,500);paint()}
 let presentAt=null;

 function commit(f){const path=f.dataset.field,old=getAt(deck,path),text=f.textContent.replace(/\s+/g,' ').trim();if(text===String(old??''))return;setAt(deck,path,text);save();paintStrip()}
 notes.addEventListener('input',()=>{deck.slides[current].notes=notes.value;save(600)});
 let undo=[],redo=[],lastSaved=null;
 function save(wait=250,{history=true}={}){for(const sl of deck.slides)if(sl.style){for(const k in sl.style)if(!Object.keys(sl.style[k]||{}).length)delete sl.style[k];if(!Object.keys(sl.style).length)delete sl.style}const now=JSON.stringify(deck);if(history&&lastSaved!==null&&now!==lastSaved){undo.push(lastSaved);if(undo.length>60)undo.shift();redo=[]}lastSaved=now;clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{try{await ctx.save(deck)}catch(e){ctx.notify(e.message)}},wait)}
 function step(back){const from=back?undo:redo,to=back?redo:undo;if(!from.length)return ctx.notify(back?'Nothing to undo.':'Nothing to redo.');to.push(JSON.stringify(deck));deck=JSON.parse(from.pop());current=Math.min(current,deck.slides.length-1);save(0,{history:false});render()}
 function render(){paintStrip();paintSlide()}
 function go(i){if(!deck.slides.length)return;current=Math.max(0,Math.min(deck.slides.length-1,i));render();strip.querySelector('.on')?.focus({preventScroll:true})}
 function move(from,to){const [s]=deck.slides.splice(from,1);deck.slides.splice(Math.max(0,Math.min(deck.slides.length,to)),0,s);current=deck.slides.indexOf(s);save();render()}
 function menu(i,at){openMenu(at,[{label:'Duplicate slide',action:()=>{deck.slides.splice(i+1,0,structuredClone(deck.slides[i]));current=i+1;save();render()}},
  {label:'Move up',disabled:i===0,action:()=>move(i,i-1)},{label:'Move down',disabled:i===deck.slides.length-1,action:()=>move(i,i+1)},'separator',
  {label:'Delete slide',danger:true,disabled:deck.slides.length<2,action:()=>{deck.slides.splice(i,1);current=Math.min(current,deck.slides.length-1);save();render()}}],{label:'Slide'})}
 root.addEventListener('keydown',e=>{if(editing||e.target.matches('textarea,input'))return;const mod=e.ctrlKey||e.metaKey;
  if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();step(!e.shiftKey)}else if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();step(false)}
  else if(e.key==='F5'||(mod&&e.key==='Enter')){e.preventDefault();present()}
  else if(e.target===frame&&(e.key==='ArrowRight'||e.key==='ArrowDown'||e.key==='PageDown')){e.preventDefault();go(current+1)}else if(e.target===frame&&(e.key==='ArrowLeft'||e.key==='ArrowUp'||e.key==='PageUp')){e.preventDefault();go(current-1)}});
 frame.tabIndex=0;frame.setAttribute('aria-label','Current slide (arrow keys move between slides, F5 presents)');
 strip.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowRight'){e.preventDefault();go(current+1)}else if(e.key==='ArrowUp'||e.key==='ArrowLeft'){e.preventDefault();go(current-1)}
  else if((e.key==='Delete'||e.key==='Backspace')&&deck.slides.length>1){e.preventDefault();menu(current,strip.querySelector('.on'))}});

 // present: full screen, arrows or space to move, N for notes, Esc to leave
 function present(){const shell=el('div','dk-present');shell.tabIndex=-1;const view=el('div','dk-present-slide'),bar=el('div','dk-present-bar'),pn=el('div','dk-present-notes');pn.hidden=true;shell.append(view,pn,bar);document.body.append(shell);let i=current;const start=Date.now();
  const paint=()=>{presentAt=i;put(view,i);const m=Math.floor((Date.now()-start)/60000),sec=Math.floor((Date.now()-start)/1000)%60;bar.textContent=(i+1)+' / '+deck.slides.length+'  ·  '+m+':'+String(sec).padStart(2,'0')+'  ·  N notes · W notes window · Esc exit';pn.textContent=deck.slides[i].notes||'No notes for this slide.'};
  const tick=setInterval(paint,1000);const close=()=>{presentAt=null;clearInterval(tick);if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});shell.remove();current=i;render()};
  shell.addEventListener('keydown',e=>{if(['ArrowRight','ArrowDown',' ','PageDown','Enter'].includes(e.key)){e.preventDefault();i=Math.min(deck.slides.length-1,i+1);paint()}else if(['ArrowLeft','ArrowUp','PageUp','Backspace'].includes(e.key)){e.preventDefault();i=Math.max(0,i-1);paint()}else if(e.key==='Escape'){e.preventDefault();close()}else if(e.key.toLowerCase()==='n'){pn.hidden=!pn.hidden}else if(e.key.toLowerCase()==='w'){notesWindow()}});
  shell.addEventListener('click',e=>{if(e.target.closest('.dk-present-bar'))return;i=e.clientX<innerWidth/3?Math.max(0,i-1):Math.min(deck.slides.length-1,i+1);paint()});
  document.addEventListener('fullscreenchange',function f(){if(!document.fullscreenElement&&document.body.contains(shell)){document.removeEventListener('fullscreenchange',f);close()}});
  paint();shell.requestFullscreen?.().catch(()=>{});shell.focus()}

 return {
  // new data from disk: keep the current slide, and never overwrite text the user is typing
  set(next,{designSystem,resolver}){ds=designSystem;resolve=resolver;if(editing)return;const first=!deck;deck={title:next.title||'',...next,slides:Array.isArray(next.slides)?next.slides:[]};const fresh=JSON.stringify(deck);if(fresh!==lastSaved){if(lastSaved!==null&&!first){undo.push(lastSaved);redo=[]}lastSaved=fresh}if(first)current=0;current=Math.min(current,Math.max(0,deck.slides.length-1));render()},
  current:()=>current,present,
 }}
