const root=document.documentElement;try{if(localStorage.getItem('hui-theme')==='dark')root.classList.add('dark')}catch{}
document.getElementById('theme').onclick=()=>{root.classList.toggle('dark');try{localStorage.setItem('hui-theme',root.classList.contains('dark')?'dark':'light')}catch{}};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const statusChip={done:'<span class="chip ok"><i class="dot"></i>Done</span>',partial:'<span class="chip warn"><i class="dot"></i>Partial</span>',planned:'<span class="chip"><i class="dot" style="color:var(--muted)"></i>Planned</span>'};
let data,filters={q:'',status:'',mock:''};
function seg(id,key){const el=document.getElementById(id);el.onclick=e=>{const b=e.target.closest('button');if(!b)return;el.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));filters[key]=b.dataset.v;render()}}
seg('status','status');seg('mock','mock');
document.getElementById('q').oninput=e=>{filters.q=e.target.value.trim().toLowerCase();render()};
function render(){
 const f=data.features,count=s=>f.filter(x=>x.status===s).length;
 document.getElementById('stats').innerHTML=[[f.length,'features'],[count('done'),'done'],[count('partial'),'partial'],[f.filter(x=>x.mockup).length,'in the mockup']].map(([n,l])=>`<div class="card stat"><b>${n}</b><span>${l}</span></div>`).join('');
 const match=x=>(!filters.status||x.status===filters.status)&&(!filters.mock||(filters.mock==='yes')===x.mockup)&&(!filters.q||(x.id+' '+x.title+' '+x.acceptance+' '+x.source).toLowerCase().includes(filters.q));
 const html=data.areas.map(a=>{const rows=f.filter(x=>x.id.startsWith(a.code+'-')&&match(x));if(!rows.length)return '';return `<section class="area"><h2>${esc(a.name)}<span class="chip">${rows.length}</span></h2><div class="grid">${rows.map(x=>`<article class="card feat"><div class="top"><span class="id">${x.id}</span>${statusChip[x.status]}<span class="chip">${x.priority}</span></div><h3>${esc(x.title)}</h3><p>${esc(x.acceptance)}</p><div class="meta"><span class="chip">${esc(x.source)}</span>${x.mockup?'<span class="chip blue">In mockup</span>':''}</div></article>`).join('')}</div></section>`}).join('');
 document.getElementById('areas').innerHTML=html||'<div class="card empty">No features match.</div>';
}
fetch('/data/development.json',{cache:'no-store'}).then(r=>r.json()).then(d=>{data=d;render();
 document.getElementById('mapcount').textContent=d.pageMap.length+' pages';
 document.getElementById('map').innerHTML='<thead><tr>'+['Old dashboard','New place','Features'].map(h=>`<th class="th" style="text-align:left;padding:10px 12px">${h}</th>`).join('')+'</tr></thead><tbody>'+d.pageMap.map(r=>`<tr><td style="padding:10px 12px;border-top:1px solid var(--border)">${esc(r.old)}</td><td style="padding:10px 12px;border-top:1px solid var(--border);font-weight:600">${esc(r.now)}</td><td style="padding:10px 12px;border-top:1px solid var(--border);color:var(--muted);font-size:12.5px">${esc(r.ids)}</td></tr>`).join('')+'</tbody>'});
