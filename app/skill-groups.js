// Skills and Plugins in two groups (builtin-skills.mjs, 7 Nov 2026): "Built in" ships with aqeelOS or the engine, is on
// for every agent and can be switched off per agent, but is not edited or deleted here (it updates with aqeelOS).
// "Added on this OS" was made on this install: editable, deletable, never in the git repo.
const BUILTIN={d:null,at:0};
async function builtinLoad(){if(BUILTIN.d&&Date.now()-BUILTIN.at<60000)return BUILTIN.d;try{BUILTIN.d=await UI('/ui/skills/builtin');BUILTIN.at=Date.now()}catch{BUILTIN.d=BUILTIN.d||null}return BUILTIN.d}
const isBuiltin=(kind,name)=>!!BUILTIN.d&&(BUILTIN.d[kind==='plugin'?'plugins':'skills']||[]).includes(name);
const GROUP_HINT={skill:['Comes with aqeelOS and is on for every agent. Switch it off for one agent here; it updates with aqeelOS.','Made on this OS. Yours to change or delete; never shared outside this server.'],
 plugin:['Comes with aqeelOS or the engine. Switch it off for one agent here; it updates with aqeelOS.','Added on this OS. Yours to change or remove.']};
// rows of one list → two lists with a heading each; nothing is redrawn, the rows move as they are (their handlers stay)
function groupRows(el,kind,rowSel,nameOf){const rows=[...el.querySelectorAll(rowSel)];if(!rows.length||el.querySelector('.sg-group'))return;
 const list=rows[0].closest('.card.list');if(!list)return;const [bi,mine]=[rows.filter(r=>isBuiltin(kind,nameOf(r))),rows.filter(r=>!isBuiltin(kind,nameOf(r)))];
 const sec=(title,hint,rs,cls)=>{const w=document.createElement('section');w.className='sg-group '+cls;w.innerHTML=`<h2 class="ach-cat">${esc(title)} <small class="hint">${rs.length}</small></h2><p class="hint sg-hint">${esc(hint)}</p>`;
  const l=document.createElement('div');l.className=list.className;rs.forEach(r=>{if(cls==='sg-builtin')r.classList.add('sg-bi');l.append(r)});w.append(l);return w};
 const box=document.createElement('div');box.className='sg-groups';
 box.append(sec('Added on this OS',GROUP_HINT[kind][1],mine,'sg-local'),sec('Built in',GROUP_HINT[kind][0],bi,'sg-builtin'));
 if(!mine.length)box.firstChild.querySelector('.card').outerHTML=`<p class="hint sg-empty">${kind==='plugin'?'No plugins added on this OS.':'No skills made on this OS yet. New skill or Learn a skill adds one here.'}</p>`;
 list.replaceWith(box)}
{const base=PAGES.skills;PAGES.skills=async(p,el,r)=>{const gone=pageTok(el);await builtinLoad();if(gone())return;await base(p,el,r);if(gone()||(S.tab.skills||'Installed')!=='Installed')return;
 groupRows(el,'skill','[data-act="sk-open"][data-name]',r=>r.dataset.name);
 groupRows(el,'skill','.all-row:has([data-act="all-sk"][data-name])',r=>r.querySelector('[data-act="all-sk"]').dataset.name)}}
{const base=PAGES.plugins;PAGES.plugins=async(p,el,r)=>{const gone=pageTok(el);await builtinLoad();if(gone())return;await base(p,el,r);if(gone())return;
 const go=()=>{groupRows(el,'plugin','.row[data-pl]',r=>r.dataset.pl);groupRows(el,'plugin','.all-row:has([data-act="all-pl"][data-name])',r=>r.querySelector('[data-act="all-pl"]').dataset.name)};go();setTimeout(()=>{if(!gone())go()},9000)}}
// a Built in skill opens read-only: what it says, and where its on/off switch is
{const base=Pages.openSkill;Pages.openSkill=async name=>{await builtinLoad();await base(name);if(!name||!isBuiltin('skill',name))return;const d=$('.drawer');if(!d)return;
 const ta=d.querySelector('#skBody');if(ta){ta.readOnly=true;ta.classList.add('sg-ro')}d.querySelector('#skSave')?.remove();d.querySelectorAll('[data-act="sk-uninstall"]').forEach(b=>b.remove());
 d.querySelector('.drawer-body')?.insertAdjacentHTML('afterbegin',`<p class="hint sg-note">${icon('layers',14)} Built in: it comes with aqeelOS and updates with it, so it is not edited here. Switch it off for an agent on the Skills list. Your own details for it go in references/local.md on the server.</p>`)}}
