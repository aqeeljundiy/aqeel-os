// Shared interface pieces: context menu (right-click and ⋯ buttons) and confirm / text dialogs.
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
let open=null;

export function closeMenu(focusBack=true){if(!open)return;const {menu,anchor}=open;open=null;menu.classList.remove('shown');menu.classList.add('closing');setTimeout(()=>menu.remove(),170);anchor?.setAttribute?.('aria-expanded','false');if(focusBack)anchor?.focus?.()}

// items: [{label, action, danger, disabled, hint}] or 'separator'
export function openMenu(at,items,{anchor,label='Actions'}={}){
 closeMenu(false);
 const menu=el('div','ctx-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label',label);
 for(const item of items){
  if(item==='separator'){const s=el('div','ctx-sep');s.setAttribute('role','separator');menu.append(s);continue}
  const b=el('button','ctx-item'+(item.danger?' danger':''));b.type='button';b.setAttribute('role','menuitem');b.disabled=Boolean(item.disabled);
  b.append(el('span','ctx-label',item.label));if(item.hint)b.append(el('span','ctx-hint',item.hint));
  b.addEventListener('click',()=>{closeMenu(true);item.action?.()});menu.append(b);
 }
 ((at instanceof Element&&at.closest('dialog[open]'))||document.body).append(menu);if(menu.showPopover){menu.popover='manual';try{menu.showPopover()}catch{}}
 const r=menu.getBoundingClientRect(),vw=document.documentElement.clientWidth,vh=innerHeight;
 let x,y;if(at instanceof Element){const a=at.getBoundingClientRect();x=a.right-r.width;y=a.bottom+4;if(x<8)x=a.left}else{x=at.x;y=at.y}
 menu.style.left=Math.max(8,Math.min(x,vw-r.width-8))+'px';menu.style.top=Math.max(8,y+r.height>vh-8?y-r.height-(at instanceof Element?at.getBoundingClientRect().height+8:0):y)+'px';
 void menu.offsetWidth;menu.classList.add('shown');
 anchor?.setAttribute?.('aria-expanded','true');open={menu,anchor};
 menu.querySelector('.ctx-item:not(:disabled)')?.focus({preventScroll:true});
 menu.addEventListener('keydown',e=>{const items=[...menu.querySelectorAll('.ctx-item:not(:disabled)')],i=items.indexOf(document.activeElement);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}
  else if(e.key==='Home'||e.key==='End'){e.preventDefault();(e.key==='Home'?items[0]:items.at(-1))?.focus()}
  else if(e.key==='Escape'){e.preventDefault();closeMenu(true)}else if(e.key==='Tab'){e.preventDefault();closeMenu(true)}});
}
document.addEventListener('pointerdown',e=>{if(open&&!open.menu.contains(e.target))closeMenu(false)},true);
addEventListener('resize',()=>closeMenu(false));addEventListener('blur',()=>closeMenu(false));
document.addEventListener('scroll',e=>{if(open&&!open.menu.contains(e.target))closeMenu(false)},true);

// Attach right-click, Shift+F10 / ContextMenu key and an optional ⋯ button to one element.
export function withMenu(target,getItems,{button,label}={}){
 target.addEventListener('contextmenu',e=>{e.preventDefault();openMenu({x:e.clientX,y:e.clientY},getItems(),{anchor:target,label})});
 target.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();openMenu(target,getItems(),{anchor:target,label})}});
 button?.addEventListener('click',e=>{e.stopPropagation();open?.anchor===button?closeMenu(true):openMenu(button,getItems(),{anchor:button,label})});
}

// Resolve straight from the handlers: a dialog's 'close' event can be delayed while the window is not being drawn.
function settle(d,resolve){let done=false;const finish=v=>{if(done)return;done=true;if(d.open)d.close();setTimeout(()=>d.remove(),180);resolve(v)};d.addEventListener('cancel',e=>{e.preventDefault();finish(null)});d.addEventListener('close',()=>finish(null));return finish}
function dialog({title,message,confirm='OK',danger,input}){return new Promise(resolve=>{
 const d=el('dialog','kit-dialog');const form=el('form');form.method='dialog';
 const h=el('h2','',title);form.append(h);if(message)form.append(el('p','kit-message',message));
 let field;if(input){const id='kit-'+Math.random().toString(36).slice(2);const l=el('label','',input.label);l.htmlFor=id;field=el('input');field.id=id;field.value=input.value||'';field.maxLength=input.max||180;field.required=!input.optional;field.autocomplete='off';form.append(l,field)}
 const actions=el('div','dialog-actions');const cancel=el('button','', 'Cancel');cancel.type='button';const ok=el('button',danger?'primary danger':'primary',confirm);ok.value='ok';actions.append(cancel,ok);form.append(actions);d.append(form);document.body.append(d);
 const finish=settle(d,resolve);cancel.onclick=()=>finish(null);form.onsubmit=e=>{e.preventDefault();if(field&&!field.value.trim()&&!input.optional)return field.focus();finish(field?field.value.trim():true)};
 d.showModal();(field||ok).focus();field?.select();
})}
export const confirmDialog=o=>dialog(o).then(Boolean);
export const promptDialog=o=>dialog({...o,input:{label:o.label??o.input?.label,value:o.value??o.input?.value,max:o.max??o.input?.max,optional:o.optional??o.input?.optional}});

// Checkbox choices, e.g. rewind: [{key,label,hint,checked}] → {key:boolean} or null when cancelled.
export function choiceDialog({title,message,options,confirm='OK',danger}){return new Promise(resolve=>{
 const d=el('dialog','kit-dialog');const form=el('form');form.append(el('h2','',title));if(message)form.append(el('p','kit-message',message));
 const boxes={};for(const o of options){const row=el('label','kit-choice');const box=el('input');box.type='checkbox';box.checked=Boolean(o.checked);boxes[o.key]=box;const text=el('span');text.append(el('strong','',o.label));if(o.hint)text.append(el('small','',o.hint));row.append(box,text);form.append(row)}
 const actions=el('div','dialog-actions');const cancel=el('button','','Cancel');cancel.type='button';const ok=el('button',danger?'primary danger':'primary',confirm);actions.append(cancel,ok);form.append(actions);d.append(form);document.body.append(d);
 const finish=settle(d,resolve);cancel.onclick=()=>finish(null);form.onsubmit=e=>{e.preventDefault();const result=Object.fromEntries(Object.entries(boxes).map(([k,b])=>[k,b.checked]));if(!Object.values(result).some(Boolean))return;finish(result)};
 d.showModal();ok.focus();
})}
