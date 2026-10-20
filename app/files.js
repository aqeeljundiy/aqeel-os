// Files: a Drive-like view of the AI box — places, grid or list, search, sort, drag-and-drop upload,
// and a preview window for images, PDFs, video, audio, Markdown and code (← → to move, Esc to close).
let FILE_HOME='/home/claude';   // a member's Files opens in their own folder (set at sign-in)
const fileUrl=(p,kind='download')=>'/hapi/files/'+kind+'?path='+encodeURIComponent(p)+(agentProfile()?'&profile='+encodeURIComponent(agentProfile()):'');
// Hermes returns file contents as a base64 data URL; this turns it into text.
function dataUrlText(u){const m=/^data:[^;,]*(?:;[^,]*)?;base64,(.*)$/s.exec(u||'');if(!m)return '';const bin=atob(m[1]);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new TextDecoder().decode(bytes)}
async function readText(path){const f=await H('/files/read'+qp({path}));return {...f,text:dataUrlText(f.data_url)}}

const FT={
 image:/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i, video:/\.(mp4|webm|mov|m4v|mkv)$/i, audio:/\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i,
 pdf:/\.pdf$/i, md:/\.(md|markdown)$/i, code:/\.(js|mjs|cjs|ts|tsx|jsx|py|sh|bash|json|ya?ml|toml|ini|css|html?|xml|sql|go|rs|rb|php|java|c|h|cpp|env|txt|log|csv|conf|cfg|lock|gitignore|dockerfile)$/i,
 archive:/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i, sheet:/\.(xlsx?|csv|ods)$/i, doc:/\.(docx?|odt|rtf|pptx?)$/i,
};
const kindOf=f=>f.is_directory?'folder':Object.keys(FT).find(k=>FT[k].test(f.name))||(/^[^.]+$/.test(f.name)?'code':'file');
const KIND_ICON={folder:'folder',image:'eye',video:'play',audio:'radio',pdf:'file',md:'file',code:'terminal',archive:'layers',sheet:'chart',doc:'file',file:'file'};
const KIND_LABEL={folder:'Folder',image:'Image',video:'Video',audio:'Audio',pdf:'PDF',md:'Markdown',code:'Text',archive:'Archive',sheet:'Spreadsheet',doc:'Document',file:'File'};
// Places follow the selected agent: its own workspace first, and its own memory and skills.
const fAgent=()=>agentProfile()||'default';const fAgentHome=()=>FILE_HOME+'/.hermes'+(fAgent()==='default'?'':'/profiles/'+fAgent());
const fWork=()=>S.me&&!S.me.admin?FILE_HOME:FILE_HOME+'/workspaces/'+fAgent();
const placesFor=()=>!S.me?.admin&&S.me?[['My files',FILE_HOME,'folder','own']]:[['Workspace',fWork(),'folder','agent'],['Memory',fAgentHome()+'/memories','brain','agent'],['Skills',fAgentHome()+'/skills','sparkle','agent'],['Home',FILE_HOME,'folder','box'],['Apps',FILE_HOME+'/apps','layers','box'],['Code projects',FILE_HOME+'/code-projects','folder','box']];

const FV={view:store.get('filesView','grid'),sort:store.get('filesSort','name'),hidden:store.get('filesHidden',false),q:''};
PAGES.files=async(p,el)=>{
 if(S._fileAgent!==fAgent()){S._fileAgent=fAgent();S.filePath=fWork();S._placesOk=null}
 // quick places that exist (Workspace and Home always); checked once per agent
 if(!S._placesOk){const all=placesFor();S._placesOk=new Set([fWork(),FILE_HOME]);UI('/ui/files/exist',{method:'POST',body:{paths:all.map(x=>x[1])}}).then(r=>{for(const x of r.exist||[])S._placesOk.add(x);paintPlaces()}).catch(()=>{S._placesOk=new Set(all.map(x=>x[1]));paintPlaces()})}
 const PLACES=placesFor();const path=S.filePath||fWork();let d;
 try{d=await H('/files'+qp({path}))}catch(e){if(e.stale)throw e;if(path!==FILE_HOME){S.filePath=FILE_HOME;toast('That folder doesn’t exist yet','err');return PAGES.files(p,el)}throw e}
 S.filePath=d.path;Pages._dir=d;
 setActions(`<button data-act="f-mkdir">${icon('folder',16)}New folder</button><button class="primary" data-act="f-upload">${icon('upload',16)}Upload</button>`);
 const parts=d.path.split('/').filter(Boolean);
 // search: this folder and everything inside it
 let found=null;if(FV.q){try{found=await UI('/ui/files/search'+qp({path:d.path,q:FV.q,hidden:FV.hidden?'1':'0'}))}catch{found=null;toast('Search is not available, showing names in this folder','err')}}
 // without search results, still only show this folder's names that match what was typed
 let items=found?found.results:(d.entries||[]).filter(f=>(FV.hidden||!f.name.startsWith('.'))&&(!FV.q||f.name.toLowerCase().includes(FV.q.toLowerCase())));
 const cmp={name:(a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}),modified:(a,b)=>(b.mtime||0)-(a.mtime||0),size:(a,b)=>(b.size||0)-(a.size||0),type:(a,b)=>kindOf(a).localeCompare(kindOf(b))||a.name.localeCompare(b.name)}[FV.sort];
 items.sort((a,b)=>(b.is_directory-a.is_directory)||cmp(a,b));Pages._items=items;
 const thumb=f=>{const k=kindOf(f);if(k==='image'&&(f.size||0)<6e6)return `<img src="${esc(fileUrl(f.path))}" alt="" loading="lazy" decoding="async">`;return `<span class="fk fk-${k}">${icon(KIND_ICON[k],k==='folder'?30:24)}</span>`};
 const tile=(f,i)=>`<div class="ftile ${f.is_directory?'dir':''}" ${st(i)} data-act="f-open" data-i="${i}" tabindex="0" title="${esc(f.name)}"><div class="fthumb">${thumb(f)}</div><div class="fname">${esc(f.name)}</div><div class="fmeta">${f.rel&&f.rel!=='.'?'in '+esc(f.rel)+' · ':''}${f.is_directory?'Folder':bytes(f.size)}${f.mtime?' · '+ago(f.mtime):''}</div><button class="ghost icon fmore" data-menu="file" data-i="${i}" aria-label="More">${icon('more',16)}</button></div>`;
 const row=(f,i)=>`<div class="row clickable frow" ${st(i)} data-act="f-open" data-i="${i}" tabindex="0"><div class="main-c"><span class="fk-sm fk-${kindOf(f)}">${icon(KIND_ICON[kindOf(f)],16)}</span><div class="txt"><b>${esc(f.name)}</b>${f.rel&&f.rel!=='.'?`<small class="frel">in ${esc(f.rel)}</small>`:''}</div></div><div class="act"><span class="fcol">${KIND_LABEL[kindOf(f)]}</span><span class="fcol">${f.is_directory?'—':bytes(f.size)}</span><span class="fcol">${f.mtime?ago(f.mtime):''}</span><button class="ghost icon" data-menu="file" data-i="${i}" aria-label="More">${icon('more',16)}</button></div></div>`;
 el.innerHTML=`<div class="fwrap" id="fwrap">
  <div class="fplaces">${PLACES.map(([l,pth,ic,grp],k)=>`${grp==='box'&&PLACES[k-1]?.[3]!=='box'?'<span class="fplaces-sep" title="Every agent sees these folders">The AI box (shared)</span>':''}<button class="place ${d.path===pth||(pth!==FILE_HOME&&d.path.startsWith(pth+'/'))?'on':''}" data-act="f-cd" data-path="${esc(pth)}" ${S._placesOk.has(pth)?'':'hidden'}>${icon(ic,15)}${l}</button>`).join('')}</div>
  <div class="fbar"><div class="fcrumbs">${parts.map((x,i)=>`<button class="ghost" data-act="f-cd" data-path="/${esc(parts.slice(0,i+1).join('/'))}">${esc(x)}</button>${i<parts.length-1?icon('chevR',13):''}`).join('')}</div><span class="grow"></span>
   <div class="search fsearch">${icon('search',15)}<input id="fQ" placeholder="Search this folder and inside it" value="${esc(FV.q)}"></div>
   <select id="fSort" style="width:auto">${[['name','Name'],['modified','Last modified'],['size','Size'],['type','Type']].map(([v,l])=>`<option value="${v}" ${FV.sort===v?'selected':''}>Sort: ${l}</option>`).join('')}</select>
   <button class="ghost icon ${FV.hidden?'on':''}" data-act="f-hidden" title="${FV.hidden?'Hide':'Show'} hidden files" aria-label="Show hidden files">${icon('eye',17)}</button>
   <div class="seg-mini"><button class="${FV.view==='grid'?'on':''}" data-act="f-view" data-v="grid" aria-label="Grid">${icon('layers',15)}</button><button class="${FV.view==='list'?'on':''}" data-act="f-view" data-v="list" aria-label="List">${icon('list',15)}</button></div></div>
  ${items.length?(FV.view==='grid'?`<div class="fgrid">${d.parent&&d.path!=='/'&&d.path!==FILE_HOME?`<div class="ftile up" data-act="f-cd" data-path="${esc(d.parent)}" tabindex="0"><div class="fthumb"><span class="fk">${icon('chevL',26)}</span></div><div class="fname">Up</div><div class="fmeta">${esc(d.parent.split('/').pop()||'/')}</div></div>`:''}${items.map(tile).join('')}</div>`:`<div class="card list">${items.map(row).join('')}</div>`)
   :emptyBox(FV.q?'Nothing matches':'This folder is empty',FV.q?'Nothing in this folder or inside it has that in its name.':'Drop files here to upload them, or create a folder.')}${found?.more?'<p class="hint" style="margin:10px 4px">'+(found.results.length>=200?'Showing the first 200 matches.':'This folder is very large, so not every folder inside it was searched.')+' Type more of the name, or open a folder closer to what you need.</p>':''}
  <div class="fdrop">${icon('upload',28)}<b>Drop to upload</b><span>into ${esc(d.path.replace(FILE_HOME,'~'))}</span></div></div>`;
 let t;$('#fQ').oninput=e=>{clearTimeout(t);t=setTimeout(()=>{FV.q=e.target.value;$('.fsearch')?.classList.add('busy');PAGES.files(p,el).then(()=>{const i=$('#fQ');i.focus();i.setSelectionRange(i.value.length,i.value.length)})},250)};
 $('#fSort').onchange=e=>{FV.sort=e.target.value;store.set('filesSort',FV.sort);PAGES.files(p,el)};
 const w=$('#fwrap');let depth=0;w.ondragenter=e=>{if(e.dataTransfer?.types?.includes('Files')){depth++;w.classList.add('dropping')}};w.ondragleave=()=>{if(--depth<=0){depth=0;w.classList.remove('dropping')}};w.ondragover=e=>e.preventDefault();w.ondrop=e=>{e.preventDefault();depth=0;w.classList.remove('dropping');if(e.dataTransfer.files.length)uploadFiles([...e.dataTransfer.files])};
};
ACT['f-cd']=(a,e)=>{if(e.target.closest('[data-menu]'))return;S.filePath=a.dataset.path;FV.q='';reload()};
ACT['f-open']=(a,e)=>{if(e.target.closest('[data-menu]'))return;const f=Pages._items[+a.dataset.i];if(!f)return;if(f.is_directory){S.filePath=f.path;FV.q='';reload()}else preview(+a.dataset.i)};
ACT['f-view']=a=>{FV.view=a.dataset.v;store.set('filesView',FV.view);reload()};
ACT['f-hidden']=()=>{FV.hidden=!FV.hidden;store.set('filesHidden',FV.hidden);reload()};
ACT['f-mkdir']=async()=>{const n=await promptBox('New folder','Folder name','','Create');if(!n)return;try{await post(H,'/files/mkdir',{path:(S.filePath||FILE_HOME).replace(/\/$/,'')+'/'+n});toast('Folder created');reload()}catch(e){fail(e)}};
ACT['f-upload']=()=>pickFile('*/*',uploadFiles,true);
async function uploadFiles(files){const dir=(S.filePath||FILE_HOME).replace(/\/$/,'');let ok=0;const taken=files.filter(f=>(Pages._items||[]).some(x=>!x.is_directory&&x.name===f.name));
 if(taken.length&&!await confirmBox('Replace '+plural(taken.length,'file')+'?',taken.map(f=>f.name).join(', ')+(taken.length===1?' is':' are')+' already in this folder. Uploading replaces '+(taken.length===1?'it':'them')+'.','Replace'))return;const t=document.createElement('div');t.className='toast';document.getElementById('toasts').append(t);
 for(const [i,f] of files.entries()){t.innerHTML=`<span class="spinner"></span>Uploading ${i+1} of ${files.length}: ${esc(f.name)}`;const fd=new FormData();fd.append('path',dir+'/'+f.name);fd.append('overwrite','true');fd.append('file',f,f.name);try{await H('/files/upload-stream',{method:'POST',body:fd});ok++}catch(e){fail(e)}}
 t.remove();if(ok)toast('Uploaded '+plural(ok,'file'));reload()}
async function deleteFile(f){if(!await confirmBox('Delete '+(f.is_directory?'folder':'file')+'?',`${esc(f.path)}${f.is_directory?' and everything inside it':''} will be removed from the box.`))return;try{await del(H,'/files',{path:f.path,recursive:!!f.is_directory});toast('Deleted');closePreview();reload()}catch(e){fail(e)}}
Pages.fileMenu=el=>{const f=Pages._items[+el.dataset.i];if(!f)return;menu(el,[f.is_directory?{label:'Open',icon:'folder',run:()=>{S.filePath=f.path;reload()}}:{label:'Preview',icon:'eye',run:()=>preview(+el.dataset.i)},
 !f.is_directory&&{label:'Download',icon:'download',run:()=>downloadPath(f)},{label:'Copy path',icon:'copy',run:()=>navigator.clipboard.writeText(f.path).then(()=>toast('Path copied'))},
 !f.is_directory&&{label:'Ask the agent about it',icon:'chat',run:()=>{go('/chat');setTimeout(()=>{const ta=$('#msg');if(ta){ta.value='Look at the file '+f.path+' and ';ta.focus()}},400)}},'-',{label:'Delete',icon:'trash',bad:true,run:()=>deleteFile(f)}])};
function downloadPath(f){const a=document.createElement('a');a.href=fileUrl(f.path);a.download=f.name;document.body.append(a);a.click();a.remove()}

/* ---------- preview window ---------- */
let PV=null;
// fades out when closed; switching to the next file swaps at once
function closePreview(animate=true){if(!PV)return;const e=PV.el;if(animate&&!calm()){e.style.pointerEvents='none';e.animate([{opacity:1},{opacity:0}],{duration:200,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'}).finished.then(()=>e.remove(),()=>e.remove())}else e.remove();PV.blob&&URL.revokeObjectURL(PV.blob);document.removeEventListener('keydown',PV.keys,true);PV=null}
async function preview(i){const files=(Pages._items||[]).filter(x=>!x.is_directory);const f=Pages._items[i];if(!f)return;let idx=files.indexOf(f);
 closePreview(false);const el=document.createElement('div');el.className='pv';el.setAttribute('role','dialog');el.setAttribute('aria-label','Preview '+f.name);
 el.innerHTML=`<div class="pv-head"><span class="fk-sm fk-${kindOf(f)}">${icon(KIND_ICON[kindOf(f)],16)}</span><div class="pv-title"><b>${esc(f.name)}</b><small>${KIND_LABEL[kindOf(f)]} · ${bytes(f.size)}${f.mtime?' · '+ago(f.mtime):''}</small></div><span class="grow"></span>
  <button class="ghost icon" data-pv="prev" aria-label="Previous" ${idx<=0?'disabled':''}>${icon('chevL',18)}</button><button class="ghost icon" data-pv="next" aria-label="Next" ${idx>=files.length-1?'disabled':''}>${icon('chevR',18)}</button>
  <button data-pv="download">${icon('download',15)}Download</button><button class="ghost icon" data-pv="delete" aria-label="Delete">${icon('trash',17)}</button><button class="ghost icon" data-pv="close" aria-label="Close">${icon('x',18)}</button></div><div class="pv-body"><div class="pv-stage"><span class="spinner"></span></div></div>`;
 document.body.append(el);PV={el,f};const stage=el.querySelector('.pv-stage');
 const keys=e=>{if(e.key==='Escape'){e.stopPropagation();closePreview()}if(e.key==='ArrowLeft'&&idx>0){e.preventDefault();preview(Pages._items.indexOf(files[idx-1]))}if(e.key==='ArrowRight'&&idx<files.length-1){e.preventDefault();preview(Pages._items.indexOf(files[idx+1]))}};
 document.addEventListener('keydown',keys,true);PV.keys=keys;
 el.onclick=e=>{const b=e.target.closest('[data-pv]');if(e.target===el||e.target.classList.contains('pv-body'))return closePreview();if(!b)return;const a=b.dataset.pv;if(a==='close')closePreview();if(a==='download')downloadPath(f);if(a==='delete')deleteFile(f);if(a==='prev')preview(Pages._items.indexOf(files[idx-1]));if(a==='next')preview(Pages._items.indexOf(files[idx+1]))};
 const k=kindOf(f);
 try{
  if(k==='image')stage.innerHTML=`<img class="pv-img" src="${esc(fileUrl(f.path))}" alt="${esc(f.name)}">`;
  else if(k==='video')stage.innerHTML=`<video class="pv-media" src="${esc(fileUrl(f.path,'stream'))}" controls autoplay playsinline></video>`;
  else if(k==='audio')stage.innerHTML=`<div class="pv-audio"><span class="fk fk-audio">${icon('radio',34)}</span><b>${esc(f.name)}</b><audio src="${esc(fileUrl(f.path,'stream'))}" controls autoplay></audio></div>`;
  else if(k==='pdf'){const r=await H('/files/download'+qp({path:f.path}),{raw:true});if(!r.ok)throw new Error('Could not open the PDF');PV.blob=URL.createObjectURL(new Blob([await r.arrayBuffer()],{type:'application/pdf'}));stage.innerHTML=`<iframe class="pv-pdf" src="${PV.blob}" title="${esc(f.name)}"></iframe>`}
  else if(k==='md'||k==='code'||(f.size||0)<512e3){const t=await readText(f.path);if(!PV||PV.f!==f)return;const txt=t.text;
   if(/�/.test(txt.slice(0,2000))&&k!=='md'&&k!=='code')throw new Error('binary');
   stage.innerHTML=k==='md'?`<article class="pv-doc md">${md(txt)}</article>`:`<pre class="pv-code">${esc(txt.length>400000?txt.slice(0,400000)+'\n…':txt)}</pre>`}
  else throw new Error('binary');
 }catch(e){stage.innerHTML=`<div class="pv-none"><span class="fk fk-${k}">${icon(KIND_ICON[k],34)}</span><b>No preview for this file</b><span>${esc(f.name)} · ${bytes(f.size)}</span><button class="primary" data-pv="download">${icon('download',15)}Download</button></div>`}
}
// the "Showing" agent picker (Files loads after the other pages got theirs, so it is added here)
{const base=PAGES.files;PAGES.files=async(p,el)=>{viewPick(await viewAgents());return base(p,el)}}

// redraw only the quick places once we know which exist
function paintPlaces(){const box=$('.fplaces');if(!box||!S._placesOk)return;for(const b of box.querySelectorAll('[data-path]'))b.hidden=!S._placesOk.has(b.dataset.path)}
