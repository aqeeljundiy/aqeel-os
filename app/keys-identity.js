// Keys › which account each key is (keys-identity.mjs, 7 Nov 2026). Owner: "we have GITHUB_TOKEN but for what account?
// what user? we don't know". Each key row says, in plain words: its name ("GitHub: aqeeljundiy (repo)"), the account,
// whether it works, the last 4 characters, what uses it ("Not used by anything" when nothing does), the same account on
// other keys, and Check again. The name and description are the owner's to change (labels, kind "key").
const KID={d:null,at:0};
async function kidLoad(force=false){if(!force&&KID.d&&Date.now()-KID.at<20000)return KID.d;try{KID.d=await UI('/ui/keys/identity');KID.at=Date.now()}catch{KID.d=KID.d||null}return KID.d}
const KID_ST={works:['ok','Works'],rejected:['bad','Rejected'],unknown:['','Not checked by the service'],unchecked:['','Checking soon']};
const kidAgo=t=>{if(!t)return '';const m=Math.round((Date.now()-Date.parse(t))/60000);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' days ago'};
function kidLines(x,all){const [c,t]=KID_ST[x.status]||KID_ST.unknown;
 const acct=x.account?`<b>${esc(x.account)}</b>`:'<span class="hint" style="margin:0">Account unknown</span>';
 const same=(x.sameAs||[]).map(id=>all.find(y=>y.id===id)?.name).filter(Boolean);
 return `<span class="kid-line"><span class="chip sm-chip ${c}" title="${esc(x.detail||'')}"><i class="dot"></i>${esc(t)}</span>${acct}${x.scopes?` <small class="hint" style="margin:0">${esc(x.scopes)}</small>`:''}${x.last4?` <small class="kid-l4" title="The last 4 characters, to tell keys apart">…${esc(x.last4)}</small>`:''}${x.checkedAt?` <small class="hint" style="margin:0">checked ${esc(kidAgo(x.checkedAt))}</small>`:''}</span>
  <span class="kid-line">${x.usedBy==null?'<small class="hint" style="margin:0">Looking for what uses it…</small>':x.usedBy.length?`<small class="hint" style="margin:0">Used by: ${esc(x.usedBy.slice(0,4).join(', '))}${x.usedBy.length>4?' and '+(x.usedBy.length-4)+' more':''}</small>`:'<span class="chip sm-chip warn">Not used by anything</span>'}${same.length?` <small class="hint" style="margin:0">Same account as ${esc(same.join(', '))}</small>`:''}${(x.sameKey||[]).length?` <small class="hint" style="margin:0">The same key is also saved as ${esc(x.sameKey.map(i=>i.split('@')[0]).join(', '))}</small>`:''}</span>`}
// a key row: the label's name over the raw env name, the description (or Add a description), the account lines, buttons
function kidPaint(row,x,all){if(!row||row.dataset.kid===x.id+'|'+(x.checkedAt||''))return;row.dataset.kid=x.id+'|'+(x.checkedAt||'');row.querySelectorAll('.kid-line,.kid-desc').forEach(e=>e.remove());
 const t=row.querySelector('.txt b, .txt > span:first-child')||row.querySelector('.txt b');const own=labelOf('key',x.id);if(!t)return;
 t.innerHTML=`${esc(own?.name||x.label||x.name)} <small class="realname">${esc(x.name)}</small>`;
 const desc=own?.description?`<span class="kid-desc" data-lb-desc>${esc(own.description)}</span>`:`<span class="kid-desc" data-lb-desc>${labelNoDesc('key',x.id)}</span>`;
 t.insertAdjacentHTML('afterend',desc+kidLines(x,all));
 const act=row.querySelector('.act');if(act&&!act.querySelector('.kid-check')){act.insertAdjacentHTML('afterbegin',`<button type="button" class="ghost small kid-check" data-act="kid-check" data-id="${esc(x.id)}" title="Ask the service again who this key belongs to">${icon('refresh',14)}Check again</button>`+labelBtn('key',x.id,own?.name||x.label))}}
// one agent's Keys page draws each key as a form field (fieldRow): the lines go under its label, the buttons by its value
function kidField(f,x,all){if(f.dataset.kid===x.id+'|'+(x.checkedAt||''))return;f.dataset.kid=x.id+'|'+(x.checkedAt||'');f.querySelectorAll('.kid-line,.kid-desc').forEach(e=>e.remove());
 const lab=f.querySelector('label');if(!lab)return;const own=labelOf('key',x.id);
 lab.insertAdjacentHTML('beforeend',`<span class="kid-desc kid-name"><b>${esc(own?.name||x.label||x.name)}</b>${own?.description?' · '+esc(own.description):''}</span>`+kidLines(x,all));
 const ctl=f.querySelector(':scope > div > div')||f.querySelector(':scope > div');if(ctl&&!ctl.querySelector('.kid-check'))ctl.insertAdjacentHTML('afterbegin',`<button type="button" class="ghost small kid-check" data-act="kid-check" data-id="${esc(x.id)}">${icon('refresh',14)}Check again</button>`+labelBtn('key',x.id,own?.name||x.label))}
ACT['kid-check']=async(b,e)=>{e?.stopPropagation?.();b.disabled=true;b.classList.add('busy');try{const x=await post(UI,'/ui/keys/identity/check',{id:b.dataset.id});
 const d=KID.d;if(d){const i=d.items.findIndex(y=>y.id===x.id);if(i>=0)d.items[i]={...d.items[i],...x}}const nx={...(d?.items.find(y=>y.id===x.id)||x)},row=b.closest('.row'),fld=b.closest('.field');if(row){row.dataset.kid='';kidPaint(row,nx,d?.items||[x])}else if(fld){fld.dataset.kid='';kidField(fld,nx,d?.items||[x])}
 toast(x.status==='works'?(x.account?'Works: '+x.account:'Works'):x.status==='rejected'?'The service refused this key':'Checked: '+(x.detail||'no account found'),x.status==='rejected'?'err':undefined)}catch(er){fail(er)}finally{b.disabled=false;b.classList.remove('busy')}};
async function kidDecorate(el,gone){if(S.me?.admin===false)return;await labelsLoad();const d=await kidLoad(true);if(!d||gone())return;const all=d.items;
 // every agent's keys (all-agents view): the row's ⋯ carries the key's id (name@fingerprint)
 el.querySelectorAll('[data-act="all-more"][data-kind="key"][data-id]').forEach(m=>{const x=all.find(y=>y.id===m.dataset.id);if(x)kidPaint(m.closest('.row'),x,all)});
 // one agent's keys: the row shows the name; the agent is the one shown
 const ag=typeof viewing==='function'?viewing():(S.profile||'default');
 el.querySelectorAll('.field [data-reveal]').forEach(c=>{const x=all.find(y=>y.name===c.dataset.reveal&&(y.agents||[]).includes(ag));const f=c.closest('.field');if(x&&f)kidField(f,x,all)});
 if(all.some(x=>x.status==='unchecked'))setTimeout(()=>{if(!gone())kidDecorate(el,gone)},30000)}
{const base=PAGES.keys;PAGES.keys=async(p,el,r)=>{const gone=pageTok(el);await base(p,el,r);if(gone())return;kidDecorate(el,gone)}}
