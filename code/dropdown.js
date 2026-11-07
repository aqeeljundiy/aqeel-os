// The app's dropdown: upgrades every native <select> into a
// button + floating listbox. The native select stays in the DOM as the source of truth,
// so existing code that reads/sets .value, edits options or listens for 'change' keeps working.
const valueDesc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
const indexDesc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'selectedIndex');
let openDropdown=null,uid=0;

function closeOpen(focus){if(!openDropdown)return;const d=openDropdown;openDropdown=null;d.wrap.classList.remove('open');d.button.setAttribute('aria-expanded','false');const p=d.panel;p.classList.remove('shown');p.classList.add('closing');setTimeout(()=>{if(openDropdown?.panel!==p)p.remove();p.classList.remove('closing')},170);if(focus)d.button.focus()}

function enhance(select){if(select.hidden)return;// internal selects stay native and out of sight

 if(select.dataset.ddReady||select.multiple)return;select.dataset.ddReady='1';
 const id='dd-'+(++uid);
 const wrap=document.createElement('div');wrap.className='dd'+(select.dataset.dd?' dd-'+select.dataset.dd:'');
 const button=document.createElement('button');button.type='button';button.className='dd-btn';button.id=id;button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
 const val=document.createElement('span');val.className='dd-val';const chev=document.createElement('i');chev.className='dd-chev';chev.setAttribute('aria-hidden','true');
 button.append(val,chev);
 const panel=document.createElement('div');panel.className='dd-panel dd-floating';panel.setAttribute('role','listbox');panel.id=id+'-list';button.setAttribute('aria-controls',panel.id);
 select.before(wrap);wrap.append(button,select);
 select.classList.add('dd-native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
 const label=select.labels?.[0];const name=select.getAttribute('aria-label')||label?.textContent?.trim();
 if(name){button.setAttribute('aria-label',name);panel.setAttribute('aria-label',name)}
 if(label)label.addEventListener('click',e=>{e.preventDefault();button.focus()});
 const d={select,wrap,button,panel};

 function sync(){const o=select.options[select.selectedIndex];val.textContent=o?o.textContent:(select.dataset.placeholder||'Select');wrap.classList.toggle('has-value',Boolean(o&&o.value));button.disabled=select.disabled||!select.options.length;button.title=o?.textContent||'';if(openDropdown===d)render()}
 Object.defineProperty(select,'value',{configurable:true,get(){return valueDesc.get.call(this)},set(v){valueDesc.set.call(this,v);sync()}});
 Object.defineProperty(select,'selectedIndex',{configurable:true,get(){return indexDesc.get.call(this)},set(v){indexDesc.set.call(this,v);sync()}});
 new MutationObserver(sync).observe(select,{childList:true,subtree:true,attributes:true,characterData:true});
 select.addEventListener('change',sync);

 function option(o){const b=document.createElement('button');b.type='button';b.setAttribute('role','option');b.dataset.index=String(o.index);b.setAttribute('aria-selected',String(o.selected));if(o.disabled){b.disabled=true;b.setAttribute('aria-disabled','true')}
  const t=document.createElement('span');t.className='dd-opt';const n=document.createElement('span');n.className='dd-name';n.textContent=o.textContent;t.append(n);
  if(o.dataset.desc){const s=document.createElement('small');s.textContent=o.dataset.desc;t.append(s)}b.append(t);
  b.addEventListener('click',()=>choose(o.index));return b}
 function render(){panel.replaceChildren();for(const child of select.children){if(child.tagName==='OPTGROUP'){const g=document.createElement('div');g.className='dd-group';g.setAttribute('role','group');const gl=document.createElement('div');gl.className='dd-gl';gl.textContent=child.label;g.setAttribute('aria-label',child.label);g.append(gl);for(const o of child.children)g.append(option(o));panel.append(g)}else if(child.tagName==='OPTION')panel.append(option(child))}}
 function place(){const r=button.getBoundingClientRect(),gap=6,vw=document.documentElement.clientWidth,vh=innerHeight;
  const width=Math.min(Math.max(r.width,Number(select.dataset.ddWidth)||220),vw-16);panel.style.width=width+'px';panel.style.left=Math.max(8,Math.min(r.left,vw-width-8))+'px';
  const below=vh-r.bottom-gap-8,above=r.top-gap-8,up=below<220&&above>below;panel.classList.toggle('up',up);
  panel.style.maxHeight=Math.max(140,Math.min(340,up?above:below))+'px';panel.style.top=up?'':(r.bottom+gap)+'px';panel.style.bottom=up?(vh-r.top+gap)+'px':''}
 function open(){if(button.disabled)return;closeOpen();openDropdown=d;render();(wrap.closest('dialog[open]')||document.body).append(panel);if(panel.showPopover){panel.popover='manual';try{panel.showPopover()}catch{}}place();wrap.classList.add('open');button.setAttribute('aria-expanded','true');
  panel.classList.remove('closing');void panel.offsetWidth;panel.classList.add('shown');(panel.querySelector('[aria-selected=true]:not(:disabled)')||panel.querySelector('[role=option]:not(:disabled)'))?.focus({preventScroll:true});panel.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'})}
 function choose(index){const changed=index!==select.selectedIndex;indexDesc.set.call(select,index);sync();closeOpen(true);if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}))}}
 button.addEventListener('click',()=>openDropdown===d?closeOpen(true):open());
 button.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();open()}});
 panel.addEventListener('keydown',e=>{const items=[...panel.querySelectorAll('[role=option]:not(:disabled)')];const i=items.indexOf(document.activeElement);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}
  else if(e.key==='Home'||e.key==='End'){e.preventDefault();(e.key==='Home'?items[0]:items.at(-1))?.focus()}
  else if(e.key==='Escape'){e.preventDefault();closeOpen(true)}
  else if(e.key==='Tab')closeOpen(false)
  else if(e.key.length===1&&/\S/.test(e.key)){const k=e.key.toLowerCase();const next=items.slice(i+1).concat(items.slice(0,i+1)).find(b=>b.textContent.trim().toLowerCase().startsWith(k));next?.focus()}});
 sync();
}

document.addEventListener('pointerdown',e=>{if(openDropdown&&!openDropdown.panel.contains(e.target)&&!openDropdown.wrap.contains(e.target))closeOpen(false)});
addEventListener('resize',()=>closeOpen(false));
document.addEventListener('scroll',e=>{if(openDropdown&&!openDropdown.panel.contains(e.target))closeOpen(false)},true);

const upgradeAll=root=>{if(root.tagName==='SELECT')enhance(root);root.querySelectorAll?.('select').forEach(enhance)};
upgradeAll(document);
new MutationObserver(list=>{for(const m of list)for(const n of m.addedNodes)if(n.nodeType===1)upgradeAll(n)}).observe(document.documentElement,{childList:true,subtree:true});
