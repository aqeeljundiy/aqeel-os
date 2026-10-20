// Design canvas editing in the Artifacts tab, like Figma: tools in the bar (select, add text, shape or image, layers,
// undo, redo), a docked inspector for the selection and a layers panel. The page side lives in preview-edit.js;
// the two talk with postMessage. Every change autosaves a moment later (one version per editing session).
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const ic=d=>'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">'+d+'</svg>';
const I={select:'<path d="M6 3l12 9-6 1 3 7-2.6 1-3-7L6 18z"/>',text:'<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',rect:'<rect x="4" y="6" width="16" height="12" rx="2"/>',image:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
 layers:'<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',undo:'<path d="M9 7H4V2"/><path d="M4 7a8 8 0 1 1-1 7"/>',redo:'<path d="M15 7h5V2"/><path d="M20 7a8 8 0 1 0 1 7"/>',
 dup:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',del:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',ai:'<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>',
 aleft:'<path d="M4 3v18M8 7h10v4H8zM8 14h6v4H8z"/>',ahc:'<path d="M12 3v18M6 7h12v4H6zM9 14h6v4H9z"/>',aright:'<path d="M20 3v18M6 7h10v4H6zM10 14h6v4h-6z"/>',
 atop:'<path d="M3 4h18M7 8v10h4V8zM14 8v6h4V8z"/>',avc:'<path d="M3 12h18M7 6v12h4V6zM14 9v6h4V9z"/>',abottom:'<path d="M3 20h18M7 6v10h4V6zM14 10v6h4v-6z"/>',
 dh:'<path d="M4 4v16M20 4v16M10 8h4v8h-4z"/>',dv:'<path d="M4 4h16M4 20h16M8 10h8v4H8z"/>',front:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4"/>',back:'<rect x="4" y="4" width="11" height="11" rx="2"/><path d="M9 15v4a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-4"/>'};
const FONTS=['','Plus Jakarta Sans','Inter','Arial','Helvetica','Georgia','Times New Roman','Verdana','Trebuchet MS','Courier New'];
const SHADOWS=[['','As designed'],['none','None'],['0 1px 3px rgba(0,0,0,.12)','Soft'],['0 6px 20px rgba(0,0,0,.14)','Medium'],['0 18px 48px rgba(0,0,0,.22)','Strong']];
const hex=c=>{const m=String(c).match(/[\d.]+/g);return m&&m.length>=3?'#'+m.slice(0,3).map(n=>Math.round(+n).toString(16).padStart(2,'0')).join(''):'#000000'};
const clear=c=>/rgba\(.*,\s*0\)|transparent/.test(String(c));

export function createCanvasEditor({body,post,win,path,notify,ask,save,upload,title}){
 let on=true,items=[],key='',canUndo=false,canRedo=false,saveTimer=0,layersOpen=false,layerList=[],selected=[];
 const tool=(name,label)=>{const b=el('button','art-tool icon');b.type='button';b.innerHTML=ic(I[name])+'<span>'+label+'</span>';b.title=label;b.setAttribute('aria-label',label);return b};
 const selB=tool('select','Select and move (V)'),textB=tool('text','Add text (T)'),rectB=tool('rect','Add a shape (R)'),imgB=tool('image','Add an image'),layersB=tool('layers','Layers'),undoB=tool('undo','Undo (Ctrl+Z)'),redoB=tool('redo','Redo (Ctrl+Shift+Z)');
 const tools=[selB,textB,rectB,imgB,layersB,undoB,redoB],dock=el('div','cv-dock');dock.setAttribute('role','toolbar');dock.setAttribute('aria-label','Design tools');dock.append(selB,textB,rectB,imgB,el('i','cv-dsep'),layersB,el('i','cv-dsep'),undoB,redoB);for(const b of [selB,layersB])b.setAttribute('aria-pressed','false');
 const pickFile=()=>new Promise(res=>{const i=el('input');i.type='file';i.accept='image/png,image/jpeg,image/webp,image/gif,image/svg+xml';i.onchange=()=>res(i.files[0]||null);i.click()});
 const image=async(kind)=>{const f=await pickFile();if(!f)return;try{const src=await upload(f);post({cba:kind,kind:'image',src})}catch(e){notify(e.message)}};
 selB.onclick=()=>setOn(!on);textB.onclick=()=>{setOn(true);post({cba:'add',kind:'text'})};rectB.onclick=()=>{setOn(true);post({cba:'add',kind:'rect'})};imgB.onclick=()=>{setOn(true);image('add')};
 layersB.onclick=()=>{layersOpen=!layersOpen;paintLayersShell();post({cba:'layers',on:layersOpen})};undoB.onclick=()=>post({cba:'undo'});redoB.onclick=()=>post({cba:'redo'});
 function setOn(v){on=v;selB.setAttribute('aria-pressed',String(on));selB.classList.toggle('on',on);post({cba:'edit',on});if(!on)paintInspector([])}
 const syncHistory=()=>{undoB.disabled=!canUndo;redoB.disabled=!canRedo};syncHistory();

 // ---- autosave ----
 const status=el('span','cv-status','');
 // each request remembers its page and file, so switching outputs mid-save never writes to the wrong one
 let want=null;const request=()=>new Promise(res=>{const w=win();if(!w)return res();const t=setTimeout(()=>{want=null;res()},1500);want={w,path:path(),done:()=>{clearTimeout(t);res()}};w.postMessage({cba:'html'},'*')});
 addEventListener('message',e=>{if(!want||e.source!==want.w||e.data?.cba!=='page-html')return;const t=want;want=null;save(String(e.data.html||''),t.path).then(()=>{status.textContent='All changes saved'},err=>{status.textContent='Not saved';notify(err.message)}).finally(t.done)});
 const changed=()=>{status.textContent='Saving…';clearTimeout(saveTimer);saveTimer=setTimeout(()=>{saveTimer=0;void request()},800)};

 // ---- inspector ----
 const panel=el('aside','cv-insp');panel.setAttribute('aria-label','Design inspector');
 let fields={};
 const section=(name)=>{const s=el('section','cv-sec');s.append(el('h4','',name));panel.append(s);return s};
 const row=(sec,label,...inputs)=>{const r=el('label','cv-row');r.append(el('span','',label),...inputs);sec.append(r);return r};
 const num=(k,unit='px',min=0,max=4000)=>{const i=el('input','cv-num');i.type='number';i.min=String(min);i.max=String(max);i.dataset.unit=unit;fields[k]=i;return i};
 const iconBtn=(name,label,fn)=>{const b=el('button','cv-ib');b.type='button';b.innerHTML=ic(I[name]);b.title=label;b.setAttribute('aria-label',label);b.onclick=fn;return b};
 const style=(styles,k)=>post({cba:'style',styles,key:k});
 function build(){panel.replaceChildren();fields={};const one=items.length===1?items[0]:null,s=items[0].st;
  const head=el('div','cv-head');const name=el('strong','',items.length>1?items.length+' selected':one.frame?'Frame · '+one.label:one.label);
  head.append(name,iconBtn('dup','Duplicate (Ctrl+D)',()=>post({cba:'dup'})),iconBtn('del','Delete',()=>post({cba:'del'})),iconBtn('ai','Ask AI about this',()=>ask('In '+title()+', '+(items.length>1?'these elements':'this element')+': '+items.map(i=>'`'+i.selector+'`').join(', ')+'\n```html\n'+items.map(i=>i.html).join('\n').slice(0,1800)+'\n```\n')));panel.append(head);
  // position
  const pos=section('Position');const al=el('div','cv-icons');
  for(const [n,how,label] of [['aleft','left','Align left'],['ahc','hcenter','Align centres across'],['aright','right','Align right'],['atop','top','Align top'],['avc','vcenter','Align middles'],['abottom','bottom','Align bottom']])al.append(iconBtn(n,label+(items.length>1?'':' (to its container)'),()=>post({cba:'align',how})));
  if(items.length>2)al.append(iconBtn('dh','Space evenly across',()=>post({cba:'align',how:'dist-h'})),iconBtn('dv','Space evenly down',()=>post({cba:'align',how:'dist-v'})));pos.append(al);
  if(one){const g=el('div','cv-grid');for(const k of ['x','y','w','h']){const l=el('label','cv-xy');l.append(el('span','',k.toUpperCase()),num(k,'px',-9999,9999));g.append(l);fields[k].onchange=()=>post({cba:'box',[k]:Number(fields[k].value)})}pos.append(g)}
  const order=el('div','cv-icons');order.append(iconBtn('front','Bring to front',()=>post({cba:'order',how:'front'})),iconBtn('back','Send to back',()=>post({cba:'order',how:'back'})));pos.append(order);
  // text
  const hasText=items.some(i=>i.text!=null)||/^(p|h\d|span|a|li|button|label|strong|em|small|td|th|blockquote)$/.test(one?.tag||'');
  if(hasText){const t=section('Text');
   if(one&&one.text!=null){const ta=el('textarea','cv-text');ta.rows=2;fields.text=ta;ta.oninput=()=>post({cba:'style',styles:{},text:ta.value,key:'text'});t.append(ta)}
   const ff=el('select');fields.font=ff;for(const f of FONTS)ff.append(new Option(f||'As designed',f));ff.onchange=()=>style({'font-family':ff.value?'"'+ff.value+'",system-ui,sans-serif':''});row(t,'Font',ff);
   const fw=el('select');fields.weight=fw;for(const [v,l] of [['','As designed'],['300','Light'],['400','Regular'],['500','Medium'],['600','Semibold'],['700','Bold'],['800','Extra bold']])fw.append(new Option(l,v));fw.onchange=()=>style({'font-weight':fw.value});
   row(t,'Weight',fw);const fs=num('size','px',4,400);fs.oninput=()=>style({'font-size':fs.value+'px'},'fs');const col=el('input','cv-color');col.type='color';fields.color=col;col.oninput=()=>style({color:col.value},'color');row(t,'Size',fs,col);
   const ta=el('div','cv-seg');for(const [v,l] of [['left','Left'],['center','Centre'],['right','Right']]){const b=el('button','',l);b.type='button';b.dataset.v=v;b.onclick=()=>style({'text-align':v});ta.append(b)}fields.align=ta;row(t,'Align',ta)}
  // fill and border
  const fb=section('Fill and border');const bg=el('input','cv-color');bg.type='color';fields.bg=bg;bg.oninput=()=>{bg.classList.remove('none');style({'background-color':bg.value},'bg')};
  const noBg=el('button','cv-mini','None');noBg.type='button';noBg.onclick=()=>{bg.classList.add('none');style({'background-color':'transparent'})};row(fb,'Fill',bg,noBg);
  const rad=num('radius','px',0,999);rad.oninput=()=>style({'border-radius':rad.value+'px'},'radius');row(fb,'Corners',rad);
  const bw=num('bw','px',0,64);const bc=el('input','cv-color');bc.type='color';fields.bc=bc;const border=()=>style({border:Number(bw.value)>0?bw.value+'px solid '+bc.value:'none'},'border');bw.oninput=border;bc.oninput=border;row(fb,'Border',bw,bc);
  const sh=el('select');fields.shadow=sh;for(const [v,l] of SHADOWS)sh.append(new Option(l,v));sh.onchange=()=>style({'box-shadow':sh.value});row(fb,'Shadow',sh);
  const op=el('input','cv-range');op.type='range';op.min='0';op.max='100';fields.opacity=op;const opv=el('span','cv-val');fields.opv=opv;op.oninput=()=>{opv.textContent=op.value+'%';style({opacity:String(op.value/100)},'opacity')};row(fb,'Opacity',op,opv);
  // spacing for flex and grid containers (Figma's auto layout)
  if(one&&/flex|grid/.test(s.display)){const sp=section('Spacing inside');
   if(/flex/.test(s.display)){const dir=el('div','cv-seg');for(const [v,l] of [['row','Across'],['column','Down']]){const b=el('button','',l);b.type='button';b.dataset.v=v;b.onclick=()=>style({'flex-direction':v});dir.append(b)}fields.dir=dir;row(sp,'Direction',dir)}
   const gap=num('gap','px',0,400);gap.oninput=()=>style({gap:gap.value+'px'},'gap');const pad=num('pad','px',0,400);pad.oninput=()=>style({padding:pad.value+'px'},'pad');row(sp,'Gap',gap);row(sp,'Padding',pad);
   const ai=el('select');fields.ai=ai;for(const [v,l] of [['','As designed'],['flex-start','Start'],['center','Centre'],['flex-end','End'],['stretch','Stretch']])ai.append(new Option(l,v));ai.onchange=()=>style({'align-items':ai.value});row(sp,'Align items',ai);
   const jc=el('select');fields.jc=jc;for(const [v,l] of [['','As designed'],['flex-start','Start'],['center','Centre'],['flex-end','End'],['space-between','Space between']])jc.append(new Option(l,v));jc.onchange=()=>style({'justify-content':jc.value});row(sp,'Spread',jc)}
  else if(one&&!/flex|grid/.test(s.display)){const sp=section('Spacing inside');const pad=num('pad','px',0,400);pad.oninput=()=>style({padding:pad.value+'px'},'pad');row(sp,'Padding',pad)}
  // image
  if(items.some(i=>i.image)){const im=section('Image');const rep=el('button','cv-wide','Replace image…');rep.type='button';rep.onclick=()=>image('image');im.append(rep)}
  const foot=el('div','cv-foot');foot.append(status);panel.append(foot)}
 function update(){const one=items.length===1?items[0]:null,s=items[0].st,set=(k,v)=>{const f=fields[k];if(f&&document.activeElement!==f&&v!=null)f.value=v};
  if(one)for(const k of ['x','y','w','h'])set(k,one[k]);if(one&&one.text!=null)set('text',one.text);
  set('size',Math.round(parseFloat(s.fontSize))||'');set('color',hex(s.color));set('radius',Math.round(parseFloat(s.radius))||0);set('bw',Math.round(parseFloat(s.borderWidth))||0);set('bc',hex(s.borderColor));
  set('opacity',Math.round(Number(s.opacity)*100));if(fields.opv)fields.opv.textContent=Math.round(Number(s.opacity)*100)+'%';set('gap',Math.round(parseFloat(s.gap))||0);set('pad',Math.round(parseFloat(s.padding))||0);
  if(fields.bg&&document.activeElement!==fields.bg){fields.bg.value=clear(s.background)?'#ffffff':hex(s.background);fields.bg.classList.toggle('none',clear(s.background));fields.bg.title=clear(s.background)?'None (see-through)':''}
  const fam=String(s.fontFamily).split(',')[0].replace(/["']/g,'').trim();if(fields.font&&document.activeElement!==fields.font)fields.font.value=FONTS.includes(fam)?fam:'';
  if(fields.weight&&document.activeElement!==fields.weight)fields.weight.value=[...fields.weight.options].some(o=>o.value===String(s.fontWeight))?String(s.fontWeight):'';
  if(fields.shadow&&document.activeElement!==fields.shadow)fields.shadow.value=s.shadow==='none'?'none':'';
  for(const [k,v] of [['align',s.textAlign==='start'?'left':s.textAlign],['dir',s.direction]])for(const b of fields[k]?.children||[])b.classList.toggle('on',b.dataset.v===v);
  for(const [k,v] of [['ai',s.alignItems],['jc',s.justify]])if(fields[k]&&document.activeElement!==fields[k])fields[k].value=[...fields[k].options].some(o=>o.value===v)?v:''}
 function paintInspector(list){items=list;const k=list.map(i=>i.id).join(',');
  if(!list.length){panel.remove();body.classList.remove('cv-has-insp');key='';return}
  if(k!==key){key=k;build()}update();if(!panel.isConnected)body.append(panel);body.classList.add('cv-has-insp')}

 // ---- layers ----
 const lp=el('aside','cv-layers');lp.setAttribute('aria-label','Layers');const lhead=el('div','cv-lhead');lhead.append(el('strong','','Layers'));const lx=el('button','dialog-x','×');lx.type='button';lx.setAttribute('aria-label','Close layers');lx.onclick=()=>layersB.click();lhead.append(lx);
 const llist=el('div','cv-llist');llist.setAttribute('role','tree');lp.append(lhead,llist);let dragId=null;
 function paintLayersShell(){layersB.setAttribute('aria-pressed',String(layersOpen));layersB.classList.toggle('on',layersOpen);if(layersOpen){if(!lp.isConnected)body.append(lp);body.classList.add('cv-has-layers')}else{lp.remove();body.classList.remove('cv-has-layers')}}
 function paintLayers(){llist.replaceChildren();for(const l of layerList){const r=el('div','cv-layer'+(selected.includes(l.id)?' on':'')+(l.tag==='frame'?' frame':''));r.setAttribute('role','treeitem');r.tabIndex=-1;r.draggable=l.tag!=='frame';r.style.paddingLeft=(8+l.depth*14)+'px';
  r.append(el('i','cv-ltag',l.tag==='frame'?'#':/^(p|h\d|span|a|li|strong|em|label)$/.test(l.tag)?'T':l.tag==='img'?'▣':'▢'),el('span','',l.label));
  r.onclick=e=>post({cba:'select',ids:e.shiftKey?[...new Set([...selected,l.id])]:[l.id]});r.onmouseenter=()=>post({cba:'hover',id:l.id});r.onmouseleave=()=>post({cba:'hover',id:null});
  r.ondragstart=e=>{dragId=l.id;e.dataTransfer.effectAllowed='move'};r.ondragover=e=>{if(dragId==null||dragId===l.id)return;e.preventDefault();const b=r.getBoundingClientRect();r.classList.toggle('drop-after',e.clientY>b.top+b.height/2);r.classList.toggle('drop-before',e.clientY<=b.top+b.height/2)};
  r.ondragleave=()=>r.classList.remove('drop-before','drop-after');r.ondrop=e=>{e.preventDefault();const after=r.classList.contains('drop-after');r.classList.remove('drop-before','drop-after');if(dragId!=null&&l.tag!=='frame')post({cba:'reorder',id:dragId,target:l.id,after});dragId=null};llist.append(r)}
  llist.querySelector('.cv-layer.on')?.scrollIntoView({block:'nearest'})}

 return {dock,
  start(){on=true;setOn(true);if(layersOpen)post({cba:'layers',on:true})},
  async stop(){if(saveTimer){clearTimeout(saveTimer);saveTimer=0;await request()}paintInspector([]);lp.remove();body.classList.remove('cv-has-layers');dock.remove()},
  busy(v){post({cba:'busy',on:v});if(v)paintInspector([])},
  key(e){// shortcuts while focus is in the app rather than the page
   if(e.target.closest('input,textarea,select,[contenteditable]'))return false;const k=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
   if(mod&&k==='z'){post({cba:e.shiftKey?'redo':'undo'});return true}if(mod&&k==='y'){post({cba:'redo'});return true}if(!items.length)return false;
   if(mod&&k==='d'){post({cba:'dup'});return true}if(k==='escape'){post({cba:'select',ids:[]});return true}if(k==='delete'||k==='backspace'){post({cba:'del'});return true}return false},
  message(d){if(d.cba==='selection'){canUndo=d.canUndo;canRedo=d.canRedo;syncHistory();selected=d.items.map(i=>i.id);paintInspector(d.items);if(layersOpen)paintLayers();return true}
   if(d.cba==='changed'){canUndo=d.canUndo;canRedo=d.canRedo;syncHistory();changed();return true}
   if(d.cba==='layers'){layerList=d.list||[];selected=d.selected||selected;paintLayers();return true}
   if(d.cba==='page-html')return true;
   if(d.cba==='tool'){({v:()=>setOn(true),t:()=>textB.click(),r:()=>rectB.click()})[d.name]?.();if(d.name==='h')return false;return true}
   return false}}}
