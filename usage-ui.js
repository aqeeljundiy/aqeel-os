// Usage page: filters, totals, tokens-per-day chart, breakdowns, subscription limits and the price table.
import {costOf} from './usage-cost.js';
const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const fmt=n=>n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(Math.round(n));
// in the currency aqeelOS uses (US dollars unless the person or the company picked rupiah)
const usd=n=>{if(n==null)return '—';let c={};try{c=JSON.parse(localStorage.getItem('cba-currency')||'{}')}catch{}if(c.code==='IDR'){const v=n*(c.rate||16500);return v>0&&v<1?'<Rp1':'Rp'+Math.round(v).toLocaleString('id-ID')}return n<0.01&&n>0?'<$0.01':'$'+n.toFixed(n<10?3:2)};
const PROVIDER={codex:'GPT',claude:'Claude',gemini:'Gemini'},SERIES=['codex','claude','gemini'];
let token='',data=null,range=30,tipEl=null;

function notify(t){$('toast').textContent=t;$('toast').hidden=false;clearTimeout(notify.t);notify.t=setTimeout(()=>$('toast').hidden=true,4000)}
async function api(route,body){const r=await fetch('/api/workspace'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Local-Token':token},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d}
const tokens=l=>(l.input||0)+(l.cachedInput||0)+(l.cacheWrite||0)+(l.output||0)+(l.reasoning||0);
// API-equivalent cost; for unpriced Claude models fall back to the cost Claude Code itself reported
const cost=l=>{const c=costOf(l,data.prices);return c!=null?{v:c,est:false}:l.reportedCost!=null?{v:l.reportedCost,est:true}:{v:null,est:false}};

function filtered(){const from=range?Date.now()-range*86400000:0,start=range===1?new Date().setHours(0,0,0,0):from;
 return data.lines.filter(l=>l.time>=start&&(!$('f-provider').value||l.provider===$('f-provider').value)&&(!$('f-account').value||l.account===$('f-account').value)&&(!$('f-project').value||l.projectId===$('f-project').value))}

function table(head,rows){const t=el('table','data');const tr=el('tr');for(const [h,num] of head){const th=el('th',num?'num':'',h);th.scope='col';tr.append(th)}const thead=el('thead');thead.append(tr);const tb=el('tbody');
 for(const r of rows){const row=el('tr');r.forEach((c,i)=>{const td=el('td',head[i][1]?'num':'');if(c instanceof Node)td.append(c);else td.textContent=c;row.append(td)});tb.append(row)}t.append(thead,tb);return t}

function render(){const lines=filtered();
 // totals
 const total=lines.reduce((a,l)=>{a.runs++;a.tokens+=tokens(l);a.out+=(l.output||0)+(l.reasoning||0);const c=cost(l);if(c.v!=null){a.cost+=c.v;if(c.est)a.est=true}else a.unpriced++;return a},{runs:0,tokens:0,out:0,cost:0,unpriced:0,est:false});
 $('tiles').replaceChildren(...[['Runs',String(total.runs),'AI requests in this range'],['Tokens',fmt(total.tokens),fmt(total.out)+' output · '+fmt(total.tokens-total.out)+' input'],['API-equivalent cost',usd(total.cost),total.unpriced?total.unpriced+' run'+(total.unpriced>1?'s':'')+' without a price':total.est?'Includes Claude-reported estimates':'From the price table'],['Accounts',String(new Set(lines.map(l=>l.account)).size),'Subscription accounts used']].map(([k,v,s])=>{const t=el('div','tile');t.append(el('div','k',k),el('div','v',v),el('div','s',s));return t}));
 renderChart(lines);
 // by model
 const byModel=new Map();for(const l of lines){const k=l.provider+'|'+l.model;const m=byModel.get(k)||{provider:l.provider,model:l.model,runs:0,input:0,cached:0,output:0,reasoning:0,cost:0,priced:true};m.runs++;m.input+=(l.input||0)+(l.cacheWrite||0);m.cached+=l.cachedInput||0;m.output+=l.output||0;m.reasoning+=l.reasoning||0;const c=cost(l);if(c.v==null)m.priced=false;else m.cost+=c.v;byModel.set(k,m)}
 $('by-model').replaceChildren(byModel.size?table([['Model'],['Runs',1],['Input',1],['Cached',1],['Output',1],['Reasoning',1],['Cost',1]],[...byModel.values()].sort((a,b)=>b.cost-a.cost).map(m=>{const name=el('span');const sw=el('span','swatch');sw.style.background=`var(--series-${m.provider==='codex'?'gpt':m.provider})`;name.append(sw,m.model);return [name,m.runs,fmt(m.input),fmt(m.cached),fmt(m.output),fmt(m.reasoning),m.priced?usd(m.cost):usd(m.cost||null)+(m.cost?'*':'')]})):el('p','note','No runs in this range.'));
 // by account
 const byAcc=new Map();for(const l of lines){const k=l.provider+'|'+l.account;const a=byAcc.get(k)||{provider:l.provider,account:l.account,runs:0,tokens:0,cost:0};a.runs++;a.tokens+=tokens(l);const c=cost(l);if(c.v!=null)a.cost+=c.v;byAcc.set(k,a)}
 $('by-account').replaceChildren(byAcc.size?table([['Account'],['Provider'],['Runs',1],['Tokens',1],['Cost',1]],[...byAcc.values()].sort((a,b)=>b.tokens-a.tokens).map(a=>[a.account,PROVIDER[a.provider],a.runs,fmt(a.tokens),usd(a.cost)])):el('p','note','No runs in this range.'));
}

function renderChart(lines){const box=$('chart');box.replaceChildren();const days=range===1?1:range||Math.max(1,Math.ceil((Date.now()-Math.min(...lines.map(l=>l.time),Date.now()))/86400000)+1);
 const dayKey=t=>{const d=new Date(t);d.setHours(0,0,0,0);return d.getTime()};const today=dayKey(Date.now());const buckets=[];for(let i=Math.min(days,60)-1;i>=0;i--)buckets.push({day:today-i*86400000,codex:0,claude:0,gemini:0});
 for(const l of lines){const b=buckets.find(x=>x.day===dayKey(l.time));if(b&&l.provider in b)b[l.provider]+=tokens(l)}
 $('legend').replaceChildren(...SERIES.map(s=>{const sp=el('span');const i=el('i');i.style.background=`var(--series-${s==='codex'?'gpt':s})`;sp.append(i,PROVIDER[s]);return sp}));
 // table view of the same data
 $('chart-table').replaceChildren(table([['Day'],['GPT tokens',1],['Claude tokens',1],['Gemini tokens',1]],buckets.map(b=>[new Date(b.day).toLocaleDateString(),fmt(b.codex),fmt(b.claude),fmt(b.gemini)])));
 if(!lines.length){box.append(el('div','empty-chart','No runs in this range yet.'));return}
 const W=box.clientWidth||800,H=box.clientHeight||240,pad={l:44,r:8,t:10,b:24},iw=W-pad.l-pad.r,ih=H-pad.t-pad.b;const max=Math.max(...buckets.map(b=>b.codex+b.claude+b.gemini),1);
 const nice=Math.pow(10,Math.floor(Math.log10(max)));const top=Math.ceil(max/nice)*nice;const NS='http://www.w3.org/2000/svg';const svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Tokens per day by provider');
 const mk=(tag,attrs,parent=svg)=>{const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);parent.append(n);return n};
 const grid=mk('g',{class:'grid'}),axis=mk('g',{class:'axis'});for(let i=0;i<=4;i++){const y=pad.t+ih-ih*i/4;mk('line',{x1:pad.l,x2:W-pad.r,y1:y,y2:y},grid);const t=mk('text',{x:pad.l-6,y:y+4,'text-anchor':'end'},axis);t.textContent=fmt(top*i/4)}
 const step=iw/buckets.length,bw=Math.max(2,Math.min(28,step*0.62));const every=Math.ceil(buckets.length/8);
 buckets.forEach((b,i)=>{const x=pad.l+i*step+(step-bw)/2;let y=pad.t+ih;const col=mk('g',{class:'col'});
  for(const s of SERIES){const v=b[s];if(!v)continue;const h=Math.max(1,ih*v/top);y-=h;mk('rect',{class:'bar',x,y:y+1,width:bw,height:Math.max(0,h-2),rx:Math.min(4,bw/2),fill:`var(--series-${s==='codex'?'gpt':s})`},col)}
  if((i%every===0&&buckets.length-1-i>=every*.6)||i===buckets.length-1){const t=mk('text',{x:x+bw/2,y:H-6,'text-anchor':'middle'},axis);t.textContent=new Date(b.day).toLocaleDateString(undefined,{month:'short',day:'numeric'})}
  const hit=mk('rect',{class:'hit',x:pad.l+i*step,y:pad.t,width:step,height:ih});svg.insertBefore(hit,col);
  hit.addEventListener('pointerenter',()=>{col.classList.add('active');tipEl.hidden=false;tipEl.replaceChildren(el('b','',new Date(b.day).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})),el('br'),'GPT '+fmt(b.codex)+' · Claude '+fmt(b.claude));tipEl.style.left=(x+bw/2)/W*100+'%';tipEl.style.top=pad.t+'px'});
  hit.addEventListener('pointerleave',()=>{col.classList.remove('active');tipEl.hidden=true})});
 box.append(svg);tipEl=el('div','tip');tipEl.hidden=true;box.append(tipEl)}

function renderLimits(){const box=$('limits');box.replaceChildren();const entries=Object.values(data.limits||{});
 if(!entries.length){box.append(el('p','note','No limits read yet. Press Refresh, or run Claude once.'));return}
 for(const l of entries.sort((a,b)=>a.provider.localeCompare(b.provider))){const c=el('article','limit');c.append(el('h3','',PROVIDER[l.provider]+' · '+l.account),el('div','who',(l.email||'')+(l.plan?' · '+l.plan:'')+' · updated '+new Date(l.at).toLocaleString()));
  for(const w of l.windows||[]){if(w.balance!==undefined){c.append(el('div','reset credit','Credits balance: '+Number(w.balance).toFixed(2)));continue}const m=el('div','meter');const row=el('div','row');row.append(el('span','',w.label+' window'),el('span','',w.usedPercent+'% used'));const track=el('div','track');const fill=el('div','fill'+(w.usedPercent>=90?' high':''));fill.style.width=Math.min(100,w.usedPercent)+'%';track.append(fill);track.setAttribute('role','meter');track.setAttribute('aria-valuenow',w.usedPercent);track.setAttribute('aria-valuemin',0);track.setAttribute('aria-valuemax',100);track.setAttribute('aria-label',w.label+' usage');
   m.append(row,track);if(w.resetsAt)m.append(el('div','reset','Resets '+new Date(w.resetsAt).toLocaleString()));c.append(m)}box.append(c)}}

function renderPrices(){const p=data.prices;$('prices-source').textContent=p.source+' · Updated '+new Date(p.updatedAt).toLocaleDateString()+'. USD per million tokens.';
 const fields=[['input','Input'],['cachedInput','Cached input'],['cacheWrite','Cache write'],['output','Output']];const used=new Set(data.lines.map(l=>l.model));
 const ids=[...new Set([...Object.keys(p.models),...used])].filter(m=>m&&m!=='default').sort();
 $('prices').replaceChildren(table([['Model'],...fields.map(([,h])=>[h,1])],ids.map(id=>[id+(used.has(id)&&(p.models[id]?.input==null)?' (price needed)':''),...fields.map(([f])=>{const i=el('input');i.inputMode='decimal';i.value=p.models[id]?.[f]??'';i.placeholder='—';i.dataset.model=id;i.dataset.field=f;i.setAttribute('aria-label',id+' '+f+' price');return i})])))}

async function load(){data=await api('/usage');const accounts=[...new Set(data.lines.map(l=>l.account))].sort();
 const keep=(id,opts)=>{const s=$(id),v=s.value;s.replaceChildren(s.options[0]||new Option('All',''),...opts.map(([v,t])=>new Option(t,v)));if(opts.some(([x])=>x===v))s.value=v};
 keep('f-account',accounts.map(a=>[a,a]));keep('f-project',data.projects.map(p=>[p.id,p.name]));render();renderLimits();renderPrices()}

async function syncPrices(provider){const status=$('sync-status');try{status.textContent='Starting '+PROVIDER[provider]+'… it opens the official pricing pages in the side browser.';const {id}=await api('/usage/prices/sync',{provider});
 while(true){await new Promise(r=>setTimeout(r,2000));const s=await api('/usage/prices/sync?id='+id);const last=s.events.filter(e=>e.type==='tool').at(-1);status.textContent=PROVIDER[provider]+' is reading the pricing pages'+(last?' · '+last.text+' '+String(last.detail).slice(0,60):'')+'…';
  if(!['running','waiting'].includes(s.state)){if(s.error||!s.prices)throw Error(s.error||'No prices came back.');status.textContent='Prices synced from the official pages.';await load();break}}}catch(e){status.textContent='Sync failed: '+e.message}}

document.addEventListener('DOMContentLoaded',()=>{});
(async()=>{try{token=(await (await fetch('/api/status')).json()).token;await load()}catch(e){notify(e.message)}})();
for(const b of $('range').querySelectorAll('button'))b.addEventListener('click',()=>{range=Number(b.dataset.range);for(const x of $('range').querySelectorAll('button')){x.classList.toggle('on',x===b);x.setAttribute('aria-checked',String(x===b))}render()});
for(const b of $('range').querySelectorAll('button')){b.setAttribute('role','radio');b.setAttribute('aria-checked',String(b.classList.contains('on')))}
for(const id of ['f-provider','f-account','f-project'])$(id).addEventListener('change',render);
$('chart-table-toggle').addEventListener('click',()=>{const t=$('chart-table');t.hidden=!t.hidden;$('chart-table-toggle').textContent=t.hidden?'Show table':'Hide table'});
$('limits-refresh').addEventListener('click',async()=>{$('limits-refresh').disabled=true;try{data.limits=(await api('/usage/limits/sync',{})).limits;renderLimits();notify('Limits refreshed.')}catch(e){notify(e.message)}finally{$('limits-refresh').disabled=false}});
$('prices-save').addEventListener('click',async()=>{const models={};for(const i of $('prices').querySelectorAll('input'))(models[i.dataset.model]??={})[i.dataset.field]=i.value;try{data.prices=await api('/usage/prices',{models});render();renderPrices();notify('Prices saved.')}catch(e){notify(e.message)}});
$('prices-reset').addEventListener('click',async()=>{if(!confirm('Reset all prices to the starting values?'))return;try{data.prices=await api('/usage/prices/reset',{});render();renderPrices()}catch(e){notify(e.message)}});
$('sync-claude').addEventListener('click',()=>syncPrices('claude'));$('sync-codex').addEventListener('click',()=>syncPrices('codex'));
addEventListener('resize',()=>{if(data)renderChart(filtered())});
