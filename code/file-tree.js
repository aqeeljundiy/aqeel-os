// Files view tree: nested folders, open on click, and a right-click / ⋯ menu to rename or move, delete,
// copy the path or mention the file in the message. Arrow keys move through the tree (ARIA tree pattern).
import {openMenu,confirmDialog,promptDialog} from './ui-kit.js';

const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};

// ['a/b.html','c.css'] → {folders:{a:{folders:{},files:['a/b.html']}},files:['c.css']}
export function buildTree(files){const root={folders:{},files:[]};for(const f of files){const parts=f.split('/');let node=root;for(const p of parts.slice(0,-1))node=node.folders[p]??={folders:{},files:[]};node.files.push(f)}return root}

export function createFileTree(ctx){
 const nav=el('nav','file-tree');nav.setAttribute('aria-label','Project files');const list=el('ul');list.setAttribute('role','tree');list.setAttribute('aria-label','Project files');nav.append(list);
 let files=[],selected='';const open=new Set(JSON.parse(localStorage.getItem('cba-tree-open')||'[]'));
 const saveOpen=()=>{try{localStorage.setItem('cba-tree-open',JSON.stringify([...open].slice(-200)))}catch{}};

 function actions(name,anchor){openMenu(anchor,[
  {label:'Open',action:()=>ctx.open(name)},
  {label:'Rename or move…',action:()=>move(name)},
  {label:'Mention in message',hint:'@'+name.split('/').pop(),action:()=>ctx.mention(name)},
  {label:'Copy path',action:async()=>{try{await navigator.clipboard.writeText(name);ctx.notify('Copied '+name)}catch{ctx.notify('Could not copy.')}}},
  'separator',{label:'Delete…',danger:true,action:()=>remove(name)},
 ],{anchor,label:name})}

 async function move(name){if(!ctx.canChange(name))return;const to=await promptDialog({title:'Rename or move '+name.split('/').pop(),label:'New path in the project (use / for folders)',value:name,confirm:'Move',max:180});if(!to||to.trim()===name)return;
  try{const r=await ctx.api('/file/move',{projectId:ctx.projectId(),from:name,to:to.trim()});ctx.notify('Moved to '+to.trim()+(r.undoable?'. Undo it from Changes.':'.'));await ctx.moved(name,to.trim())}catch(e){ctx.notify(e.message)}}
 async function remove(name){if(!ctx.canChange(name))return;const image=/\.(png|jpe?g|gif|webp|avif|ico)$/i.test(name);if(!(await confirmDialog({title:'Delete '+name+'?',message:image?'Images are deleted from the folder and cannot be restored here.':'You can restore it from the Changes tab.',confirm:'Delete',danger:true})))return;
  try{await ctx.api('/file/delete',{projectId:ctx.projectId(),path:name});ctx.notify('Deleted '+name+'.');await ctx.moved(name,null)}catch(e){ctx.notify(e.message)}}

 function item(label,{file,folder,depth}){const li=el('li');li.setAttribute('role','treeitem');li.tabIndex=-1;li.dataset.path=file||folder;li.style.setProperty('--depth',depth);
  const row=el('div','ftree-row');const twist=el('span','ftree-twist',folder?(open.has(folder)?'▾':'▸'):'');const name=el('span','ftree-name',label);row.append(twist,name);
  if(file){const more=el('button','ftree-more','⋯');more.type='button';more.tabIndex=-1;more.setAttribute('aria-label','Actions for '+file);more.addEventListener('click',e=>{e.stopPropagation();actions(file,more)});row.append(more);li.setAttribute('aria-selected',String(file===selected));if(file===selected)li.classList.add('current')}
  else li.setAttribute('aria-expanded',String(open.has(folder)));
  li.append(row);row.addEventListener('click',()=>{if(folder)toggle(folder);else ctx.open(file);focusItem(li)});
  row.addEventListener('contextmenu',e=>{if(!file)return;e.preventDefault();actions(file,{x:e.clientX,y:e.clientY})});return li}

 function toggle(folder){open.has(folder)?open.delete(folder):open.add(folder);saveOpen();paint(folder)}
 function add(parent,node,prefix,depth){for(const name of Object.keys(node.folders).sort((a,b)=>a.localeCompare(b))){const path=prefix+name;const li=item(name,{folder:path,depth});parent.append(li);if(open.has(path)){const ul=el('ul');ul.setAttribute('role','group');li.append(ul);add(ul,node.folders[name],path+'/',depth+1)}}
  for(const f of [...node.files].sort((a,b)=>a.localeCompare(b)))parent.append(item(f.split('/').pop(),{file:f,depth}))}

 function paint(focusPath){list.replaceChildren();if(!files.length){list.append(el('li','ftree-empty','No files yet.'));return}add(list,buildTree(files),'',0);
  const items=visible();const target=items.find(li=>li.dataset.path===(focusPath??selected))||items[0];if(target){target.tabIndex=0;if(focusPath!==undefined)target.focus()}}
 const visible=()=>[...list.querySelectorAll('[role=treeitem]')];
 function focusItem(li){for(const x of visible())x.tabIndex=-1;li.tabIndex=0;li.focus()}

 list.addEventListener('keydown',e=>{const li=e.target.closest('[role=treeitem]');if(!li)return;const items=visible(),i=items.indexOf(li),path=li.dataset.path,folder=li.hasAttribute('aria-expanded');
  if(e.key==='ArrowDown'&&items[i+1]){e.preventDefault();focusItem(items[i+1])}
  else if(e.key==='ArrowUp'&&items[i-1]){e.preventDefault();focusItem(items[i-1])}
  else if(e.key==='ArrowRight'&&folder){e.preventDefault();if(!open.has(path))toggle(path);else if(items[i+1])focusItem(items[i+1])}
  else if(e.key==='ArrowLeft'){e.preventDefault();if(folder&&open.has(path))toggle(path);else{const up=li.parentElement.closest('[role=treeitem]');if(up)focusItem(up)}}
  else if(e.key==='Enter'||e.key===' '){e.preventDefault();folder?toggle(path):ctx.open(path)}
  else if((e.key==='F10'&&e.shiftKey)||e.key==='ContextMenu'){if(!folder){e.preventDefault();actions(path,li.querySelector('.ftree-more'))}}
  else if(e.key==='F2'&&!folder){e.preventDefault();move(path)}
  else if(e.key==='Delete'&&!folder){e.preventDefault();remove(path)}});

 return {element:nav,render(list,current){files=list;selected=current||'';
   // reveal the open file's folders
   if(selected.includes('/')){const parts=selected.split('/');for(let i=1;i<parts.length;i++)open.add(parts.slice(0,i).join('/'))}paint()},
  select(name){selected=name||'';if(selected.includes('/')){const parts=selected.split('/');let changed=false;for(let i=1;i<parts.length;i++){const p=parts.slice(0,i).join('/');if(!open.has(p)){open.add(p);changed=true}}if(changed)return paint()}
   for(const li of visible()){const on=li.dataset.path===selected&&!li.hasAttribute('aria-expanded');li.classList.toggle('current',on);if(!li.hasAttribute('aria-expanded'))li.setAttribute('aria-selected',String(on))}}};
}
