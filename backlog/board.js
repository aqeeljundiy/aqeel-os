const root=document.documentElement;try{if(localStorage.getItem('hui-theme')==='dark')root.classList.add('dark')}catch{}
document.getElementById('theme').onclick=()=>{root.classList.toggle('dark');try{localStorage.setItem('hui-theme',root.classList.contains('dark')?'dark':'light')}catch{}};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// the board: every item sits in the column that says where it stands
const COLS=[['planned','To do','Not started yet'],['doing','In progress','Being built now'],['blocked','Stuck','Waiting on something'],['done','Done','Working in the app']];
const prio={P0:'bad',P1:'warn',P2:''};
let data,filters={q:'',area:'',tab:'board'};try{filters.tab=localStorage.getItem('bk-tab')||'board'}catch{}
const $=id=>document.getElementById(id);
function tabs(){document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===filters.tab));['board','updates','map'].forEach(t=>$('v-'+t).hidden=t!==filters.tab);try{localStorage.setItem('bk-tab',filters.tab)}catch{}}
$('tabs').onclick=e=>{const b=e.target.closest('button');if(!b)return;filters.tab=b.dataset.v;tabs()};
$('q').oninput=e=>{filters.q=e.target.value.trim().toLowerCase();render()};
$('area').onchange=e=>{filters.area=e.target.value;render()};
const areaName=id=>(data.areas.find(a=>id.startsWith(a.code+'-'))||{}).name||'';
const col=x=>x.status==='partial'?'doing':x.status;
function render(){
 const f=data.features,match=x=>(!filters.area||x.id.startsWith(filters.area+'-'))&&(!filters.q||(x.id+' '+x.title+' '+x.acceptance+' '+x.source).toLowerCase().includes(filters.q));
 const n=s=>f.filter(x=>col(x)===s).length;
 $('stats').innerHTML=[[f.length,'items'],[n('done'),'done'],[n('doing'),'in progress'],[n('planned'),'to do'],[n('blocked'),'stuck']].map(([v,l])=>`<div class="card stat"><b>${v}</b><span>${l}</span></div>`).join('');
 const shown=f.filter(match);
 $('board').innerHTML=COLS.map(([k,label,hint])=>{const l=shown.filter(x=>col(x)===k).sort((a,b)=>a.priority.localeCompare(b.priority));
  return `<section class="bcol ${k}"><header><b>${label}</b><span class="n">${l.length}</span></header><p class="bh">${hint}</p><div class="blist">${l.map((x,i)=>`<article class="card bcard" style="--i:${Math.min(i,12)}" data-id="${esc(x.id)}" tabindex="0"><div class="top"><span class="id">${esc(x.id)}</span><span class="chip ${prio[x.priority]||''}">${esc(x.priority)}</span>${x.status==='partial'?'<span class="chip warn">Partly there</span>':''}</div><h3>${esc(x.title)}</h3><span class="area-t">${esc(areaName(x.id))}</span></article>`).join('')||'<p class="bh empty">Nothing here.</p>'}</div></section>`}).join('');
}
// a card opens with what "done" means for it
document.addEventListener('click',e=>{const c=e.target.closest('.bcard');if(c)openCard(c.dataset.id);if(e.target.closest('.pop-x')||e.target.classList.contains('pop-bg'))closeCard()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCard();if(e.key==='Enter'&&e.target.classList?.contains('bcard'))openCard(e.target.dataset.id)});
function openCard(id){const x=data.features.find(y=>y.id===id);if(!x)return;closeCard();const ups=(data.commits||[]).filter(c=>c.ids.includes(id));
 const d=document.createElement('div');d.className='pop-bg';d.innerHTML=`<div class="pop card" role="dialog" aria-label="${esc(x.title)}"><button class="ghost icon pop-x" aria-label="Close">✕</button><div class="top"><span class="id">${esc(x.id)}</span><span class="chip">${esc(COLS.find(c=>c[0]===col(x))?.[1]||x.status)}</span><span class="chip ${prio[x.priority]||''}">${esc(x.priority)}</span><span class="chip">${esc(x.source)}</span></div><h2>${esc(x.title)}</h2><p>${esc(x.acceptance)}</p>${ups.length?`<h4>Updates</h4>${ups.map(u=>`<div class="up-line"><b>${esc(new Date(u.at).toLocaleDateString([],{day:'numeric',month:'short'}))}</b> ${esc(u.subject)}</div>`).join('')}`:''}</div>`;document.body.append(d)}
function closeCard(){document.querySelectorAll('.pop-bg').forEach(x=>{x.classList.add('out');setTimeout(()=>x.remove(),200)})}
// the history: GitHub pushes and the deploys that took them live, by day
function updates(){const c=data.commits||[],dep=(data.deploys||[]).slice().reverse();const byDay={};
 for(const u of c)(byDay[u.at.slice(0,10)]??=[]).push({kind:'push',...u});for(const d of dep)(byDay[d.at.slice(0,10)]??=[]).push({kind:'live',...d});
 const days=Object.keys(byDay).sort().reverse();
 $('updates').innerHTML=days.length?days.map(d=>`<section class="uday"><h3>${esc(new Date(d+'T12:00:00').toLocaleDateString([],{weekday:'long',day:'numeric',month:'long'}))}</h3><div class="card ulist">${byDay[d].sort((a,b)=>b.at.localeCompare(a.at)).map(u=>u.kind==='live'?`<div class="uline live"><span class="ut">${esc(new Date(u.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</span><span class="chip ok"><i class="dot"></i>Went live</span><span>Deployed to the AI box${u.commit?' (up to '+esc(u.commit)+')':''}</span></div>`:`<div class="uline"><span class="ut">${esc(new Date(u.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</span><span class="chip">Saved to GitHub</span><span>${esc(u.subject)}${u.ids.length?' '+u.ids.map(i=>`<a class="chip blue" href="#" data-open="${esc(i)}">${esc(i)}</a>`).join(' '):''}</span></div>`).join('')}</div></section>`).join(''):'<div class="card empty">No updates yet.</div>';
 $('updates').onclick=e=>{const a=e.target.closest('[data-open]');if(a){e.preventDefault();openCard(a.dataset.open)}}}
fetch('/data/development.json',{cache:'no-store'}).then(r=>r.json()).then(d=>{data=d;
 $('area').innerHTML='<option value="">Every area</option>'+d.areas.map(a=>`<option value="${esc(a.code)}">${esc(a.name)}</option>`).join('');
 render();updates();tabs();
 $('mapcount').textContent=d.pageMap.length+' pages';
 $('map').innerHTML='<thead><tr>'+['Old dashboard','New place','Features'].map(h=>`<th class="th" style="text-align:left;padding:10px 12px">${h}</th>`).join('')+'</tr></thead><tbody>'+d.pageMap.map(r=>`<tr><td style="padding:10px 12px;border-top:1px solid var(--border)">${esc(r.old)}</td><td style="padding:10px 12px;border-top:1px solid var(--border);font-weight:600">${esc(r.now)}</td><td style="padding:10px 12px;border-top:1px solid var(--border);color:var(--muted);font-size:12.5px">${esc(r.ids)}</td></tr>`).join('')+'</tbody>'});
