// Data view for dashboards, like a small spreadsheet: the CSV (or JSON list) behind the page in a grid you can edit,
// sort, filter and group, with simple formulas (=SUM(B2:B9), AVERAGE, COUNT, MIN, MAX, cell maths). Changes save a
// moment later and the dashboard reloads; Replace swaps in a new CSV or Excel file.
import {openMenu} from './ui-kit.js';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};

// ---- CSV ----
export function parseCsv(text){const rows=[];let row=[],cell='',q=false;const t=String(text||'').replace(/^﻿/,'');
 for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){cell+='"';i++}else q=false}else cell+=c}
  else if(c==='"')q=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&t[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}else cell+=c}
 if(cell!==''||row.length){row.push(cell);rows.push(row)}return rows.filter(r=>r.some(v=>v!==''))}
export const toCsv=rows=>rows.map(r=>r.map(v=>{const s=String(v??'');return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(',')).join('\n')+'\n';
const asNumber=v=>{if(typeof v==='number')return v;const s=String(v??'').trim().replace(/[,$€£%\s]/g,'');return s!==''&&!isNaN(s)?Number(s):null};

// ---- formulas: =SUM(B2:B9), =AVERAGE(C:C), =B2*C2-1, =MAX(D2:D20)/2 ----
const colIndex=s=>s.toUpperCase().split('').reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;
export const colName=i=>{let s='';i++;while(i>0){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26)}return s};
export function evaluate(formula,grid,seen=new Set()){const src=String(formula).slice(1);let p=0;
 const cell=(c,r)=>{const key=c+':'+r;if(seen.has(key))throw Error('loop');const v=grid[r]?.[c];if(typeof v==='string'&&v.startsWith('=')){const s=new Set(seen);s.add(key);return evaluate(v,grid,s)}return asNumber(v)};
 const range=(a,b)=>{const ma=a.match(/^([A-Z]+)(\d*)$/i),mb=b.match(/^([A-Z]+)(\d*)$/i);const c1=colIndex(ma[1]),c2=colIndex(mb[1]),r1=ma[2]?Number(ma[2])-1:1,r2=mb[2]?Number(mb[2])-1:grid.length-1;const out=[];
  for(let c=Math.min(c1,c2);c<=Math.max(c1,c2);c++)for(let r=Math.min(r1,r2);r<=Math.max(r1,r2);r++){const v=cell(c,r);if(v!=null)out.push(v)}return out};
 const ws=()=>{while(src[p]===' ')p++};
 const FN={SUM:a=>a.reduce((x,y)=>x+y,0),AVERAGE:a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0,COUNT:a=>a.length,MIN:a=>a.length?Math.min(...a):0,MAX:a=>a.length?Math.max(...a):0};
 function atom(){ws();if(src[p]==='('){p++;const v=expr();ws();p++;return v}if(src[p]==='-'){p++;return -atom()}
  const m=src.slice(p).match(/^(\d+(\.\d+)?)|^([A-Z]+)\s*\(|^([A-Z]+\d*)(\s*:\s*([A-Z]+\d*))?/i);if(!m)throw Error('bad');p+=m[0].length;
  if(m[1])return Number(m[1]);if(m[3]){const f=FN[m[3].toUpperCase()];if(!f)throw Error('fn');const vals=[];ws();while(src[p]!==')'&&p<src.length){ws();const r=src.slice(p).match(/^([A-Z]+\d*)\s*:\s*([A-Z]+\d*)/i);if(r){p+=r[0].length;vals.push(...range(r[1],r[2]))}else vals.push(expr());ws();if(src[p]===',')p++}p++;return f(vals)}
  if(m[5])throw Error('range');const mm=m[4].match(/^([A-Z]+)(\d+)$/i);if(!mm)throw Error('ref');return cell(colIndex(mm[1]),Number(mm[2])-1)??0}
 function term(){let v=atom();for(;;){ws();const o=src[p];if(o==='*'||o==='/'){p++;const r=atom();v=o==='*'?v*r:v/r}else return v}}
 function expr(){let v=term();for(;;){ws();const o=src[p];if(o==='+'||o==='-'){p++;const r=term();v=o==='+'?v+r:v-r}else return v}}
 try{const v=expr();return Number.isFinite(v)?Math.round(v*1e6)/1e6:'#ERR'}catch{return '#ERR'}}

// ---- the view ----
export async function openDataView({body,o,api,save,notify,projectId,reload,upload}){
 const q='projectId='+encodeURIComponent(projectId());let files=[];try{files=(await api('/files?'+q)).files||[]}catch{}
 const base='outputs/'+o.slug+'/',list=files.map(f=>f.path||f).filter(p=>typeof p==='string'&&p.startsWith(base)&&/\.(csv|json)$/i.test(p)&&!/output\.json$|charts\.json$/.test(p));
 const sheets=[];for(const p of list){try{const text=(await api('/file?'+q+'&path='+encodeURIComponent(p))).content;
  if(p.endsWith('.csv')){const rows=parseCsv(text);if(rows.length)sheets.push({path:p,kind:'csv',rows})}
  else{const j=JSON.parse(text);const arr=Array.isArray(j)?j:Object.values(j).find(v=>Array.isArray(v)&&v.length&&typeof v[0]==='object');if(Array.isArray(arr)&&arr.length&&arr.every(x=>x&&typeof x==='object'&&!Array.isArray(x))){const head=[...new Set(arr.flatMap(x=>Object.keys(x)))].filter(k=>arr.every(x=>x[k]==null||typeof x[k]!=='object'));if(head.length)sheets.push({path:p,kind:'json',rows:[head,...arr.map(x=>head.map(k=>x[k]??''))],wrap:Array.isArray(j)?null:Object.keys(j).find(k=>j[k]===arr),whole:j})}}}catch{}}
 if(!sheets.length){notify('There is no CSV or JSON table in this output yet. Ask the AI to keep its data in a .csv file.');return}
 body.querySelector('.dv')?.remove();const shell=el('div','art-compare dv');shell.setAttribute('role','dialog');shell.setAttribute('aria-label','Data');
 const head=el('div','art-compare-head');const tabs=el('div','dv-tabs');const x=el('button','','Close');x.type='button';x.onclick=()=>shell.remove();head.append(el('strong','','Data in '+o.title),tabs,x);
 const tools=el('div','dv-tools');const filter=el('input','dv-filter');filter.placeholder='Filter rows';filter.setAttribute('aria-label','Filter rows');const groupSel=el('select','dv-group');groupSel.setAttribute('aria-label','Group by');
 const addRow=el('button','','+ Row'),addCol=el('button','','+ Column'),replace=el('button','','Replace with a file…'),status=el('span','dv-status','');for(const b of [addRow,addCol,replace])b.type='button';
 tools.append(filter,groupSel,addRow,addCol,el('span','dv-grow'),status,replace);const wrap=el('div','dv-wrap');shell.append(head,tools,wrap);body.append(shell);
 let cur=0,sort=null,timer=0;const S=()=>sheets[cur];
 const persist=()=>{status.textContent='Saving…';clearTimeout(timer);timer=setTimeout(async()=>{const s=S();let text;
   if(s.kind==='csv')text=toCsv(s.rows);else{const [h,...rs]=s.rows;const arr=rs.map(r=>Object.fromEntries(h.map((k,i)=>[k,asNumber(r[i])??r[i]])));text=JSON.stringify(s.wrap?{...s.whole,[s.wrap]:arr}:arr,null,2)+'\n'}
   try{await save(s.path,text);status.textContent='Saved';reload()}catch(e){status.textContent='Not saved';notify(e.message)}},700)};
 function paintTabs(){tabs.replaceChildren(...sheets.map((s,i)=>{const b=el('button','dv-tab'+(i===cur?' on':''),s.path.slice(base.length));b.type='button';b.onclick=()=>{cur=i;sort=null;paint()};return b}))}
 function paint(){paintTabs();const s=S(),[h,...rows]=s.rows;groupSel.replaceChildren(new Option('Group by…',''),...h.map((k,i)=>new Option('Group by '+k,String(i))));
  const g=groupSel.dataset.v??'';groupSel.value=g;wrap.replaceChildren();if(g!==''&&h[Number(g)]!==undefined)return paintGroups(Number(g));
  const t=el('table','dv-grid'),thead=el('thead'),hr=el('tr');hr.append(el('th','dv-corner'));
  h.forEach((k,c)=>{const th=el('th');const name=el('span','dv-h',k);name.contentEditable='true';name.spellcheck=false;name.onblur=()=>{if(name.textContent!==k){s.rows[0][c]=name.textContent.trim();persist()}};
   const sb=el('button','dv-sort',sort?.c===c?(sort.dir>0?'▲':'▼'):'↕');sb.type='button';sb.title='Sort by this column';sb.onclick=()=>{sort={c,dir:sort?.c===c?-sort.dir:1};paint()};
   const mb=el('button','dv-colmenu','⋯');mb.type='button';mb.title='Column actions';mb.onclick=()=>openMenu(mb,[{label:'Sort A → Z / small → large',action:()=>{sortData(c,1)}},{label:'Sort Z → A / large → small',action:()=>{sortData(c,-1)}},'separator',{label:'Delete column',danger:true,disabled:h.length<2,action:()=>{for(const r of s.rows)r.splice(c,1);persist();paint()}}],{anchor:mb,label:'Column'});
   th.append(el('i','dv-col',colName(c)),name,sb,mb);hr.append(th)});thead.append(hr);
  const tb=el('tbody'),f=filter.value.trim().toLowerCase();let order=rows.map((r,i)=>i+1);if(sort)order.sort((a,b)=>{const x=val(s.rows[a][sort.c],s),y=val(s.rows[b][sort.c],s),nx=asNumber(x),ny=asNumber(y);return (nx!=null&&ny!=null?nx-ny:String(x).localeCompare(String(y)))*sort.dir});
  for(const ri of order){const r=s.rows[ri];if(f&&!r.some(v=>String(val(v,s)).toLowerCase().includes(f)))continue;const tr=el('tr');const n=el('th','dv-n',String(ri+1));const del=el('button','dv-del','×');del.type='button';del.title='Delete row '+(ri+1);del.onclick=()=>{s.rows.splice(ri,1);persist();paint()};n.append(del);tr.append(n);
   h.forEach((_,c)=>{const raw=r[c]??'',td=el('td',asNumber(val(raw,s))!=null?'num':'');td.textContent=String(val(raw,s));if(String(raw).startsWith('='))td.classList.add('dv-formula');td.tabIndex=0;
    td.onfocus=()=>{td.contentEditable='true';td.textContent=String(r[c]??'');td.classList.add('dv-editing')};
    td.onblur=()=>{td.contentEditable='false';td.classList.remove('dv-editing');const v=td.textContent.trim();if(v!==String(r[c]??'')){r[c]=v;persist();paint()}else td.textContent=String(val(r[c]??'',s))};
    td.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const nextRow=tr.nextElementSibling?.children[c+1];td.blur();setTimeout(()=>(nextRow||td).focus?.(),20)}if(e.key==='Escape'){td.textContent=String(r[c]??'');td.blur()}};tr.append(td)});tb.append(tr)}
  t.append(thead,tb);wrap.append(t)}
 const val=(v,s)=>typeof v==='string'&&v.startsWith('=')?evaluate(v,s.rows):v;
 function sortData(c,dir){const s=S(),[h,...rows]=s.rows;rows.sort((a,b)=>{const x=val(a[c],s),y=val(b[c],s),nx=asNumber(x),ny=asNumber(y);return (nx!=null&&ny!=null?nx-ny:String(x).localeCompare(String(y)))*dir});s.rows=[h,...rows];sort=null;persist();paint()}
 function paintGroups(g){const s=S(),[h,...rows]=s.rows,nums=h.map((_,c)=>c!==g&&rows.some(r=>asNumber(val(r[c],s))!=null)),groups=new Map();
  for(const r of rows){const k=String(val(r[g],s));const e=groups.get(k)||{n:0,sums:h.map(()=>0)};e.n++;h.forEach((_,c)=>{if(nums[c])e.sums[c]+=asNumber(val(r[c],s))||0});groups.set(k,e)}
  const t=el('table','dv-grid dv-groups'),hr=el('tr');hr.append(el('th','',h[g]),el('th','','Rows'),...h.map((k,c)=>nums[c]?el('th','','Total '+k):null).filter(Boolean));const thead=el('thead');thead.append(hr);const tb=el('tbody');
  for(const [k,e] of groups){const tr=el('tr');tr.append(el('td','',k),el('td','num',String(e.n)),...h.map((_,c)=>nums[c]?el('td','num',String(Math.round(e.sums[c]*100)/100)):null).filter(Boolean));tb.append(tr)}t.append(thead,tb);wrap.append(el('p','dv-note','Totals per '+h[g]+'. Pick “Group by…” to see every row again.'),t)}
 filter.oninput=()=>paint();groupSel.onchange=()=>{groupSel.dataset.v=groupSel.value;paint()};
 addRow.onclick=()=>{const s=S();s.rows.push(s.rows[0].map(()=>''));persist();sort=null;paint();wrap.querySelector('tbody tr:last-child td')?.focus()};
 addCol.onclick=()=>{const s=S();s.rows[0].push('Column '+(s.rows[0].length+1));for(const r of s.rows.slice(1))r.push('');persist();paint()};
 replace.onclick=()=>{const f=el('input');f.type='file';f.accept='.csv,.xlsx,.xls,text/csv';f.onchange=async()=>{const file=f.files[0];if(!file)return;try{status.textContent='Reading…';const rows=await upload(file,S().path);S().rows=rows;status.textContent='Replaced';reload();paint()}catch(e){status.textContent='';notify(e.message)}};f.click()};
 paint()}
