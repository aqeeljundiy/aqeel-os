// Sidebar: projects expand into their chats, with status dots, filters, context menus and an archive view.
import {withMenu,confirmDialog,promptDialog} from './ui-kit.js';

const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const lastTime=c=>c.messages.at(-1)?.time||0;
const STATUS_TEXT={waiting:'Needs approval',running:'Running',unread:'Unread',failed:'Failed'};

const providerName=p=>({claude:'Claude',codex:'GPT',gemini:'Gemini'})[p]||p;
export function createSidebar(ctx){
 let expanded=read('cba-tree',{}),seen=read('cba-seen',{}),filter=read('cba-filter','all'),showArchived=false,query='';

 function markSeen(chat){if(!chat)return;seen[chat.id]=Math.max(Date.now(),lastTime(chat));write('cba-seen',seen)}
 function status(p,c){const run=ctx.runs().find(r=>r.chatId===c.id);if(run)return run.state==='waiting'?'waiting':'running';
  if(c.id===ctx.chatId())return null;const last=c.messages.at(-1);if(!last||(seen[c.id]||0)>=lastTime(c)||seen[c.id]===undefined&&!c.forceUnread)return c.forceUnread?'unread':null;return last.role==='error'?'failed':'unread'}
 function projectStatus(p){const s=p.chats.filter(c=>!c.archived).map(c=>status(p,c));return s.includes('waiting')?'waiting':s.includes('running')?'running':s.includes('failed')?'failed':s.includes('unread')?'unread':null}
 const dot=s=>{const d=el('span','status-dot'+(s?' status-'+s:''));if(s){d.title=STATUS_TEXT[s];d.setAttribute('role','img');d.setAttribute('aria-label',STATUS_TEXT[s])}else d.setAttribute('aria-hidden','true');return d};

 async function act(fn,done){try{await fn();await ctx.refresh();if(done)ctx.notify(done)}catch(e){ctx.notify(e.message)}}

 function exportChat(p,c){
  const lines=['# '+c.title,'',`Project: ${p.name}`,`Exported: ${new Date().toLocaleString()}`,''];
  for(const m of c.messages){lines.push('## '+(m.role==='user'?'You':m.role==='error'?'Error':providerName(m.provider)+(m.model&&m.model!=='default'?' ('+m.model+')':'')),'',m.text,'');
   if(m.files?.length)lines.push('Files changed: '+m.files.join(', '),'');if(m.commands?.length)lines.push('Commands run:','',...m.commands.map(x=>'- `'+x.command.replace(/`/g,"'")+'` ('+x.status+')'),'')}
  const a=el('a');a.href=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/markdown'}));a.download=(c.title.replace(/[^\w\- ]+/g,'').trim()||'chat')+'.md';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}

 function projectItems(p){return [
  {label:'New chat',action:()=>act(async()=>{const c=await ctx.api('/chat',{projectId:p.id});expanded[p.id]=true;write('cba-tree',expanded);await ctx.openChat(p.id,c.id)})},
  {label:'New temporary chat',hint:'Not saved',action:()=>act(async()=>{const c=await ctx.api('/chat',{projectId:p.id,temporary:true});expanded[p.id]=true;write('cba-tree',expanded);await ctx.openChat(p.id,c.id)},'Temporary chat: it is deleted when you leave it and is never used as context elsewhere.')},
  {label:'Project settings…',action:()=>ctx.projectSettings?.(p)},
  {label:p.section?'Move to another section…':'Add to a section…',action:async()=>{const name=await promptDialog({title:'Section for '+p.name,label:'Section name',value:p.section||'',confirm:'Save',max:40}).catch(()=>null);if(name!==null)act(()=>ctx.api('/project/update',{projectId:p.id,section:name}))}},
  ...(p.section?[{label:'Remove from section',action:()=>act(()=>ctx.api('/project/update',{projectId:p.id,section:''}))}]:[]),
  {label:'Open a past CLI session…',hint:'Claude Code or Codex',action:()=>pastSessions(p)},
   {label:'Edit instructions (AGENTS.md)',action:async()=>{if(p.id!==ctx.projectId())await ctx.selectProject(p.id);ctx.editInstructions?.()}},
  ...(ctx.online?.()&&(!p.access||p.access==='owner')?[{label:'Share…',action:()=>ctx.shareProject?.(p)}]:[]),
  ...(!ctx.online?.()&&ctx.publish?[{label:p.live?'Update on Live…':'Publish to Live…',hint:p.live?p.live.slug+'.app.elkiya.com':'',action:()=>ctx.publish(p)}]:[]),
  {label:'Rename…',action:async()=>{const name=await promptDialog({title:'Rename project',label:'Project name',value:p.name,confirm:'Rename',max:80});if(name&&name!==p.name)act(()=>ctx.api('/project/update',{projectId:p.id,name}),'Project renamed.')}},
  'separator',
  {label:'Reveal in '+(ctx.fileManager?.()||'Explorer'),action:()=>act(()=>ctx.api('/reveal',{projectId:p.id,target:'explorer'}))},
  {label:'Open in VS Code',action:()=>act(()=>ctx.api('/reveal',{projectId:p.id,target:'editor'}))},
  {label:'Copy folder path',action:()=>act(async()=>{const {path}=await ctx.api('/folder?projectId='+p.id);await navigator.clipboard.writeText(path)},'Folder path copied.')},
  'separator',
  p.archived?{label:'Restore from archive',action:()=>act(()=>ctx.api('/project/update',{projectId:p.id,archived:false}),'Project restored.')}
   :{label:'Archive',action:()=>act(()=>ctx.api('/project/update',{projectId:p.id,archived:true}),'Project archived. Find it under Archived.')},
  p.path?{label:'Remove from app…',danger:true,action:async()=>{if(await confirmDialog({title:'Remove “'+p.name+'” from the app?',message:'Its chats and saved versions are removed from aqeelOS Code. The folder itself stays on your computer: '+p.path,confirm:'Remove',danger:true}))act(()=>ctx.api('/project/delete',{projectId:p.id}),'Project removed. The folder is untouched.')}}
  :{label:'Delete project…',danger:true,action:async()=>{if(await confirmDialog({title:'Delete “'+p.name+'”?',message:'This permanently deletes the project folder, its chats and saved versions from this PC. This cannot be undone.',confirm:'Delete project',danger:true}))act(()=>ctx.api('/project/delete',{projectId:p.id}),'Project deleted.')}},
 ]}
 function chatItems(p,c){const s=status(p,c);return [
  {label:'Rename…',action:async()=>{const title=await promptDialog({title:'Rename chat',label:'Chat name',value:c.title,confirm:'Rename',max:120});if(title&&title!==c.title)act(()=>ctx.api('/chat/update',{projectId:p.id,chatId:c.id,title}))}},
  {label:c.pinned?'Unpin':'Pin to top',action:()=>act(()=>ctx.api('/chat/update',{projectId:p.id,chatId:c.id,pinned:!c.pinned}))},
  s==='unread'||s==='failed'?{label:'Mark as read',action:()=>{markSeen(c);c.forceUnread=false;render()}}:{label:'Mark as unread',disabled:c.id===ctx.chatId(),action:()=>{delete seen[c.id];c.forceUnread=true;write('cba-seen',seen);render()}},
  {label:'Fork into a new chat',action:()=>act(async()=>{const f=await ctx.api('/chat/fork',{projectId:p.id,chatId:c.id});await ctx.openChat(p.id,f.id)},'Forked. The new chat starts fresh sessions with the same history.')},
  {label:'Export as Markdown',action:()=>exportChat(p,c)},
  {label:'Export as JSON',action:()=>{const a=el('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({project:p.name,chat:c.title,exported:new Date().toISOString(),messages:c.messages},null,2)],{type:'application/json'}));a.download=(c.title.replace(/[^\w\- ]+/g,'').trim()||'chat')+'.json';document.body.append(a);a.click();a.remove()}},
  {label:c.goal?'Change goal…':'Set a goal…',hint:'Long-running',action:async()=>{const goal=await promptDialog({title:'Goal for “'+c.title+'”',label:'What should the AI keep working toward?',value:c.goal||'',confirm:'Save goal',max:1000});if(goal!==null)act(()=>ctx.api('/chat/update',{projectId:p.id,chatId:c.id,goal}),'Goal saved. Both AIs keep it in mind in this chat.')}},
  ...(c.goal?[{label:'Clear goal',action:()=>act(()=>ctx.api('/chat/update',{projectId:p.id,chatId:c.id,goal:''}))}]:[]),
  {label:'Open in a new window',hint:'Side by side',action:()=>window.open('/?project='+p.id+'&chat='+c.id,'_blank','noopener,width=1200,height=860')},
  ...ctx.projects().filter(x=>x.id!==p.id&&!x.archived).slice(0,6).map(x=>({label:'Move to '+x.name,action:()=>act(async()=>{await ctx.api('/chat/move',{projectId:p.id,chatId:c.id,toProjectId:x.id});await ctx.openChat(x.id,c.id)},'Chat moved. Its AI sessions start fresh in the new project.')})),
  'separator',
  c.archived?{label:'Restore from archive',action:()=>act(()=>ctx.api('/chat/update',{projectId:p.id,chatId:c.id,archived:false}),'Chat restored.')}
   :{label:'Archive',action:()=>act(()=>ctx.api('/chat/update',{projectId:p.id,chatId:c.id,archived:true}),'Chat archived.')},
  {label:'Delete chat…',danger:true,action:async()=>{if(await confirmDialog({title:'Delete “'+c.title+'”?',message:'The conversation is removed. Project files and saved versions stay.',confirm:'Delete chat',danger:true}))act(async()=>{const r=await ctx.api('/chat/delete',{projectId:p.id,chatId:c.id});if(c.id===ctx.chatId())await ctx.openChat(p.id,r.chatId)},'Chat deleted.')}},
 ]}

 function chatRow(p,c){
  const li=el('li','tree-chat');li.dataset.chat=c.id;const s=status(p,c);
  const b=el('button','chat-row'+(c.id===ctx.chatId()?' current':''));b.type='button';b.title=c.title+(lastTime(c)?' · '+new Date(lastTime(c)).toLocaleString():'');if(c.id===ctx.chatId())b.setAttribute('aria-current','true');
  b.append(dot(s),el('span','chat-title',c.title));if(c.pinned)b.append(el('span','pin','Pinned'));if(c.temporary){b.classList.add('temporary');b.append(el('span','pin','Temporary'))}
  b.addEventListener('click',()=>ctx.openChat(p.id,c.id));
  b.addEventListener('dblclick',e=>{e.preventDefault();inlineRename(b.querySelector('.chat-title'),c.title,title=>ctx.api('/chat/update',{projectId:p.id,chatId:c.id,title}))});
  const more=el('button','tree-more','⋯');more.type='button';more.setAttribute('aria-label','Chat actions for '+c.title);more.setAttribute('aria-haspopup','menu');
  withMenu(b,()=>chatItems(p,c),{button:more,label:'Chat actions'});li.append(b,more);
  b.draggable=true;b.addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-cba-chat',JSON.stringify({projectId:p.id,chatId:c.id}));e.dataTransfer.effectAllowed='move'});return li}

 function projectNode(p,chats){
  const wrap=el('div','tree-project'+(p.id===ctx.projectId()?' selected':''));wrap.dataset.project=p.id;
  const row=el('div','project-row');const open=query?true:expanded[p.id]??p.id===ctx.projectId();
  const toggle=el('button','tree-toggle');toggle.type='button';toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',(open?'Collapse ':'Expand ')+p.name);
  toggle.addEventListener('click',()=>{expanded[p.id]=!open;write('cba-tree',expanded);render()});
  const b=el('button','project-button'+(p.id===ctx.projectId()?' selected':''));b.type='button';b.title=p.name;b.textContent=p.name;if(p.kind&&p.kind!=='app')b.dataset.kind=p.kind;
  {const shared=p.access&&p.access!=='owner'?(p.access==='view'?'View only':'Shared with you'):Object.keys(p.shares||{}).length?'Shared':'';if(shared){const t=el('span','proj-shared');t.textContent=shared;b.append(t);b.title=p.name+' · '+shared}}
  b.addEventListener('click',()=>{if(!open){expanded[p.id]=true;write('cba-tree',expanded)}ctx.selectProject(p.id)});
  b.addEventListener('dblclick',e=>{e.preventDefault();const span=el('span');b.replaceChildren(span);inlineRename(span,p.name,name=>ctx.api('/project/update',{projectId:p.id,name}))});
  const more=el('button','tree-more','⋯');more.type='button';more.setAttribute('aria-label','Project actions for '+p.name);more.setAttribute('aria-haspopup','menu');
  withMenu(b,()=>projectItems(p),{button:more,label:'Project actions'});
  row.append(toggle,b,dot(open?null:projectStatus(p)),more);wrap.append(row);
  b.draggable=true;b.addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-cba-project',p.id);e.dataTransfer.effectAllowed='move'});
  row.addEventListener('dragover',e=>{const t=e.dataTransfer.types;if(t.includes('application/x-cba-chat')||t.includes('application/x-cba-project')){e.preventDefault();row.classList.add('drop-target')}});row.addEventListener('dragleave',()=>row.classList.remove('drop-target'));
  row.addEventListener('drop',e=>{row.classList.remove('drop-target');const chat=e.dataTransfer.getData('application/x-cba-chat'),proj=e.dataTransfer.getData('application/x-cba-project');e.preventDefault();
   if(chat){const c=JSON.parse(chat);if(c.projectId!==p.id)act(async()=>{await ctx.api('/chat/move',{projectId:c.projectId,chatId:c.chatId,toProjectId:p.id})},'Chat moved to '+p.name+'.')}
   else if(proj&&proj!==p.id){const order=ctx.projects().map(x=>x.id).filter(id=>id!==proj);order.splice(order.indexOf(p.id),0,proj);act(()=>ctx.api('/project/order',{order}))}});
  if(open){const ul=el('ul','tree-chats');ul.setAttribute('role','group');ul.setAttribute('aria-label','Chats in '+p.name);for(const c of chats)ul.append(chatRow(p,c));if(!chats.length)ul.append(el('li','tree-empty',filter==='all'?'No chats':'Nothing here'));wrap.append(ul);
   const outs=p.id===ctx.projectId()?(ctx.outputs?.()||[]):[];if(outs.length){const ol=el('ul','tree-outputs');ol.setAttribute('aria-label','Outputs in '+p.name);ol.append(el('li','tree-section-mini','Outputs'));if(outs.length>12){const all=el('li');const b=el('button','link-button tree-all','Show all '+outs.length+' in Artifacts');b.type='button';b.onclick=()=>ctx.openOutput?.(outs[12].slug);all.append(b);queueMicrotask(()=>ol.append(all))}
   for(const o of outs.slice(0,12)){const li=el('li');const ob=el('button','output-row');ob.type='button';ob.dataset.kind=o.kind;ob.append(el('span','output-dot'),el('span','chat-title',o.title));ob.title=o.title;ob.addEventListener('click',()=>ctx.openOutput?.(o.slug));const om=el('button','tree-more','⋯');om.type='button';om.setAttribute('aria-label','Actions for '+o.title);om.setAttribute('aria-haspopup','menu');withMenu(ob,()=>[{label:'Open',action:()=>ctx.openOutput?.(o.slug)},'separator',{label:'Delete…',danger:true,action:()=>ctx.deleteOutput?.(o.slug)}],{button:om,label:'Output actions'});li.className='output-item';li.append(ob,om);ol.append(li)}wrap.append(ol)}}
  return wrap}

 // replace a label with a text field; Enter saves, Escape cancels
 function inlineRename(label,value,save){if(!label||label.querySelector('input'))return;const input=el('input','inline-rename');input.value=value;input.setAttribute('aria-label','New name');label.replaceChildren(input);input.focus();input.select();let done=false;
  const finish=async ok=>{if(done)return;done=true;const v=input.value.trim();if(ok&&v&&v!==value){try{await save(v);await ctx.refresh()}catch(e){ctx.notify(e.message);render()}}else render()};
  input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish(true)}else if(e.key==='Escape'){e.preventDefault();finish(false)}});input.addEventListener('blur',()=>finish(true));input.addEventListener('click',e=>e.stopPropagation())}
 function sortChats(chats){return [...chats].sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||lastTime(b)-lastTime(a))}

 function render(){
  const root=ctx.container();root.replaceChildren();
  const bar=el('div','tree-filter');bar.setAttribute('role','radiogroup');bar.setAttribute('aria-label','Show chats');
  for(const [key,text] of [['all','All'],['active','Active'],['unread','Unread']]){const f=el('button',filter===key?'on':'',text);f.type='button';f.setAttribute('role','radio');f.setAttribute('aria-checked',String(filter===key));f.addEventListener('click',()=>{filter=key;write('cba-filter',filter);render()});bar.append(f)}
  root.append(bar);
  if(!ctx.projects().some(p=>!p.archived)){const e=el('div','tree-start');e.append(el('p','','No projects yet. Start a new chat or just send a message, and a project is made for you. To work on files you already have, use the folder button above.'));root.append(e)}
  const q=query.toLowerCase(),found=(p,c)=>!q||p.name.toLowerCase().includes(q)||(c.title||'').toLowerCase().includes(q)||c.messages?.some(m=>m.role==='user'&&String(m.text||'').toLowerCase().includes(q));
  const match=(p,c)=>found(p,c)&&(filter==='all'||(filter==='active'?['running','waiting'].includes(status(p,c)):['unread','failed','waiting'].includes(status(p,c))));
  const sections=[...new Set(ctx.projects().filter(p=>!p.archived).map(p=>p.section||''))].sort((a,b)=>a===''?-1:b===''?1:a.localeCompare(b));
  for(const s of sections){if(s)root.append(el('div','tree-section',s));for(const p of ctx.projects()){if(p.archived||(p.section||'')!==s)continue;const chats=sortChats(p.chats.filter(c=>!c.archived&&match(p,c)));if((filter!=='all'||q)&&!chats.length&&(q?!p.name.toLowerCase().includes(q):p.id!==ctx.projectId()))continue;root.append(projectNode(p,chats))}}
  if(q&&!root.querySelector('.tree-project,[data-project]')&&ctx.projects().length)root.append(el('p','tree-empty','No chats match “'+query+'”.'))
  const archivedProjects=ctx.projects().filter(p=>p.archived),archivedChats=ctx.projects().filter(p=>!p.archived).flatMap(p=>p.chats.filter(c=>c.archived).map(c=>[p,c]));
  const count=archivedProjects.length+archivedChats.length;
  if(count){const t=el('button','archive-toggle',(showArchived?'Hide archived':'Archived')+' ('+count+')');t.type='button';t.setAttribute('aria-expanded',String(showArchived));t.addEventListener('click',()=>{showArchived=!showArchived;render()});root.append(t);
   if(showArchived){const box=el('div','archive-list');for(const p of archivedProjects){const r=el('div','archive-row');r.append(el('span','',p.name+' · project'));const m=el('button','tree-more','⋯');m.type='button';m.setAttribute('aria-label','Archived project actions for '+p.name);withMenu(r,()=>projectItems(p),{button:m});r.append(m);box.append(r)}
    for(const [p,c] of archivedChats){const r=el('div','archive-row');r.append(el('span','',c.title+' · '+p.name));const m=el('button','tree-more','⋯');m.type='button';m.setAttribute('aria-label','Archived chat actions for '+c.title);withMenu(r,()=>chatItems(p,c),{button:m});r.append(m);box.append(r)}root.append(box)}}
 }

 // Cheap refresh of status dots while runs are active (keeps focus and menus intact).
 function updateStatus(){for(const p of ctx.projects())for(const c of p.chats){const row=ctx.container().querySelector(`[data-chat="${c.id}"] .status-dot`);if(!row)continue;const s=status(p,c);const fresh=dot(s);if(row.className!==fresh.className)row.replaceWith(fresh)}
  for(const node of ctx.container().querySelectorAll('.tree-project')){const p=ctx.projects().find(x=>x.id===node.dataset.project);const d=node.querySelector('.project-row>.status-dot');if(p&&d&&!node.querySelector('.tree-chats')){const fresh=dot(projectStatus(p));if(d.className!==fresh.className)d.replaceWith(fresh)}}}

 return {render,updateStatus,markSeen,search:v=>{query=v.trim();render()},items:(p,c)=>c?chatItems(p,c):projectItems(p),state:(p,c)=>status(p,c)};
 // list earlier CLI sessions for the folder; importing opens a chat that resumes the native session
 async function pastSessions(p){const d=document.createElement('dialog');d.className='kit-dialog cli-sessions';const form=document.createElement('form');form.method='dialog';const h=document.createElement('h2');h.textContent='Past CLI sessions';const note=document.createElement('p');note.className='kit-message';note.textContent='Looking for Claude Code and Codex sessions in '+p.name+'…';
  const list=document.createElement('div');list.className='cli-list';const actions=document.createElement('div');actions.className='dialog-actions';const close=document.createElement('button');close.type='button';close.textContent='Close';actions.append(close);form.append(h,note,list,actions);d.append(form);document.body.append(d);d.showModal();
  const shut=()=>{d.close();setTimeout(()=>d.remove(),180)};close.onclick=shut;d.addEventListener('cancel',e=>{e.preventDefault();shut()});
  try{const {sessions}=await ctx.api('/cli-sessions?projectId='+p.id);note.textContent=sessions.length?'Opening one makes a chat that continues the same session. Sessions from the CLIs\' default accounts are shown.':'No earlier sessions found for this folder.';
   for(const x of sessions){const b=document.createElement('button');b.type='button';b.className='cli-row';const who=document.createElement('span');who.className='cli-who '+x.provider;who.textContent=providerName(x.provider);const t=document.createElement('strong');t.textContent=x.title;const meta=document.createElement('small');meta.textContent=new Date(x.time).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' · '+x.count+' message'+(x.count>1?'s':'');b.append(who,t,meta);
    b.onclick=async()=>{b.disabled=true;try{const ch=await ctx.api('/cli-sessions/import',{projectId:p.id,provider:x.provider,id:x.id});shut();await ctx.refresh();await ctx.openChat(p.id,ch.id);ctx.notify('Imported. Your next message continues this '+(x.provider==='claude'?'Claude Code':'Codex')+' session.')}catch(e){b.disabled=false;ctx.notify(e.message)}};list.append(b)}}
  catch(e){note.textContent=e.message}}

}
