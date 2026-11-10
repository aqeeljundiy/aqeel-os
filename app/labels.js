// Names and descriptions people remember (labels.mjs, 7 Nov 2026). Owner: "make sure they have name + description so
// ppl could remember what they were". Every list (Skills, Connections, Channels, Schedules, Agents) shows a plain name
// and one line on what it does; the real id stays small and muted, and admins change both with Edit. Ids never change
// here, so prompts, skills and tools that name them keep working.
const LABELS={v:{},at:0};
const labelOf=(kind,id)=>LABELS.v[kind+':'+id]||null;
// the plain names written by the helper model (EXPLAIN, people.js) give way to the ones people set
function labelsIntoExplain(){for(const [k,v] of Object.entries(LABELS.v)){const kind=k.slice(0,k.indexOf(':'));if(!['skill','mcp','plugin'].includes(kind))continue;
 const cur=EXPLAIN[k]||{};EXPLAIN[k]={title:v.name||cur.title||k.slice(kind.length+1),summary:v.description||cur.summary||'',own:true}}}
async function labelsLoad(force=false){if(!force&&Date.now()-LABELS.at<30000)return LABELS.v;
 try{LABELS.v=(await UI('/ui/labels')).labels||{};LABELS.at=Date.now();labelsIntoExplain()}catch{}return LABELS.v}
const labelAdmin=()=>S.me?.admin!==false;
const labelNoDesc=(kind,id)=>labelAdmin()?`<a href="#" class="lb-add" data-act="lb-edit" data-kind="${esc(kind)}" data-id="${esc(id)}">Add a description</a>`:'<span class="lb-none">No description yet</span>';
const labelBtn=(kind,id,what)=>`<button type="button" class="ghost icon lb-edit" data-act="lb-edit" data-kind="${esc(kind)}" data-id="${esc(id)}" title="Edit name and description" aria-label="Edit the name and description of ${esc(what||id)}">${icon('edit',15)}</button>`;

// one dialog for every kind: name and one line, the id shown so nobody wonders what it was
function labelEdit(kind,id,{name='',description='',real=id}={}){const cur=labelOf(kind,id)||{};
 const {d,close}=stackPop('Name and description',`<p class="hint" style="margin:0 0 12px">Only what people read changes. Agents and tools still use its id, <span class="lb-id">${esc(real)}</span>, so nothing breaks.</p>
  <label for="lb-n">Name</label><input id="lb-n" maxlength="60" autocomplete="off" spellcheck="true">
  <label for="lb-d" style="margin-top:12px">Description</label><textarea id="lb-d" rows="2" maxlength="200" placeholder="One line on what it does, in plain words"></textarea><p class="lb-err" role="alert"></p>`,
  `${(cur.name||cur.description)&&!cur.builtIn?'<button class="ghost" id="lb-reset" style="margin-right:auto">Use the default</button>':''}<button class="ghost" data-x>Cancel</button><button class="primary" id="lb-ok">Save</button>`);
 const n=d.querySelector('#lb-n'),t=d.querySelector('#lb-d'),ok=d.querySelector('#lb-ok'),err=d.querySelector('.lb-err');
 n.value=cur.name||name||'';t.value=cur.description||description||'';
 const save=async body=>{ok.disabled=true;err.textContent='';try{const r=await put(UI,'/ui/labels',{kind,id,...body});const k=kind+':'+id;
   const back=!body.name&&!body.description;if(r.label)LABELS.v[k]=r.label;else{delete LABELS.v[k];delete EXPLAIN[k]}labelsIntoExplain();close();toast(back?'Back to the default name':'Saved');reload()}
  catch(e){ok.disabled=false;err.textContent=e.message||'Could not save it'}};
 ok.onclick=e=>{e.stopPropagation();const nv=n.value.trim();if(!nv){n.focus();err.textContent='Give it a name.';return}save({name:nv,description:t.value.trim()})};
 n.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();ok.click()}};t.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ok.click()}};
 d.querySelector('#lb-reset')?.addEventListener('click',e=>{e.stopPropagation();save({name:'',description:''})});
 setTimeout(()=>{n.focus();n.select()},30)}
ACT['lb-edit']=(a,e)=>{e?.preventDefault?.();e?.stopPropagation?.();const k=a.dataset.kind,id=a.dataset.id;if(!labelAdmin())return;
 const row=a.closest('.row,.card');const shown=row?.querySelector('.txt b')?.childNodes[0]?.textContent?.trim()||'';const desc=row?.querySelector('[data-lb-desc]')?.textContent?.trim()||'';
 labelEdit(k,id,{name:shown,description:/^(Add a description|No description yet)$/.test(desc)?'':desc})};

// a list row: the label's name on top with the id small, its description below (or "Add a description"), and Edit
function labelPaint(row,kind,id,{title,sub,act,keepSub=false,shown=id}={}){if(!row||row.dataset.lb===kind+':'+id)return;row.dataset.lb=kind+':'+id;
 const v=labelOf(kind,id);title=title||row.querySelector('.txt b');if(!title)return;
 if(v?.name){const rest=[...title.childNodes].slice(1).filter(x=>x.nodeType===1&&!x.classList?.contains('realname'));title.innerHTML=`${esc(v.name)}${v.name!==shown?` <small class="realname">${esc(shown)}</small>`:''}`;rest.forEach(x=>title.append(' ',x));row.dataset.ex='1'}
 if(sub===undefined)sub=row.querySelector('.txt span');
 if(v?.description){if(sub&&!keepSub){sub.dataset.orig??=sub.textContent;sub.textContent=v.description;sub.dataset.lbDesc='1';sub.title=sub.dataset.orig}else{const s=document.createElement('span');s.className='lb-desc';s.dataset.lbDesc='1';s.textContent=v.description;title.after(s)}}
 else if(!sub||!sub.textContent.trim()){const s=sub||document.createElement('span');s.classList.add('lb-desc');s.dataset.lbDesc='1';s.innerHTML=labelNoDesc(kind,id);if(!sub)title.after(s)}
 act=act===undefined?row.querySelector('.act'):act;if(act&&labelAdmin()&&!act.querySelector('.lb-edit'))act.insertAdjacentHTML('afterbegin',labelBtn(kind,id,v?.name||id))}

// Skills (one agent's list): the rows the helper model also names
{const base=PAGES.skills;PAGES.skills=async(p,el,r)=>{const gone=pageTok(el);await labelsLoad();if(gone())return;await base(p,el,r);if(gone())return;
 el.querySelectorAll('[data-act="sk-open"][data-name]').forEach(row=>labelPaint(row,'skill',row.dataset.name));
 // every agent's skills at once (all-agents-more.js): one row per skill with a chip per agent
 el.querySelectorAll('.all-row').forEach(row=>{const c=row.querySelector('[data-act="all-sk"][data-name]');if(c)labelPaint(row,'skill',c.dataset.name)})}}

// Plugins (one agent's list and every agent's): the same names, Edit, and Add a description
{const base=PAGES.plugins;PAGES.plugins=async(p,el,r)=>{const gone=pageTok(el);await labelsLoad();if(gone())return;await base(p,el,r);if(gone())return;
 const paint=()=>{el.querySelectorAll('.row[data-pl]').forEach(row=>labelPaint(row,'plugin',row.dataset.pl));
  el.querySelectorAll('.all-row').forEach(row=>{const c=row.querySelector('[data-act="all-pl"][data-name]');if(c)labelPaint(row,'plugin',c.dataset.name)})};
 paint();setTimeout(()=>{if(!gone())paint()},9000)}}
// Connections: names and descriptions come from the server (labels.applyRows); the list says when one has none, search
// finds the old id too (Cx.match), and the side panel has Edit
const LB_CX=new Set(['skill','mcp','plugin','ca','google','ads','key']);
const cxLabelKind=r=>{const k=String(r.key||'');const kind=k.slice(0,k.indexOf(':'));return LB_CX.has(kind)?[kind,k.slice(kind.length+1)]:null};
{const pl=Cx.paintList;Cx.paintList=function(el,first){pl.call(this,el,first);el.querySelectorAll('.cn-row[data-key]').forEach(x=>{const r=this.row(x.dataset.key);if(!r||r.what||x.querySelector('.lb-add,.lb-none'))return;
  const lk=cxLabelKind(r),s=x.querySelector('.txt span');if(lk&&s)s.insertAdjacentHTML('beforeend',' · '+labelNoDesc(lk[0],lk[1]))})}}
{const pt=Cx.paint;Cx.paint=function(){pt.call(this);const r=this.cur,b=this.d?.querySelector('.cn-p');if(!r||!b)return;const lk=cxLabelKind(r);if(!lk)return;
 b.insertAdjacentHTML('afterbegin',`<div class="lb-about"><div class="txt"><span data-lb-desc>${r.what?esc(r.what):labelNoDesc(lk[0],lk[1])}</span><small class="realname">${esc(lk[0]==='key'?lk[1].split('@')[0]:lk[1])}</small></div>${labelAdmin()?`<button type="button" class="ghost small" data-act="lb-edit" data-kind="${esc(lk[0])}" data-id="${esc(lk[1])}">${icon('edit',14)}Edit name</button>`:''}</div>`)}}

// Channels › Connections: each agent's channel (and extra numbers) by what it is for; the rows (ChX in people.js) read
// the names and descriptions themselves, so they only have to be loaded first
{const base=PAGES.channels;PAGES.channels=async(p,el,r)=>{const gone=pageTok(el);await labelsLoad();if(gone())return;return base(p,el,r)}}

setTimeout(()=>labelsLoad(true),1500);
