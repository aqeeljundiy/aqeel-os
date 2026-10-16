// Safe Markdown → DOM for AI replies. Never uses innerHTML: every node is created explicitly,
// links are limited to http(s)/mailto and open in a new tab.
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};

function inline(text,parent){
 // tokens: `code`, **bold**, *italic* / _italic_, [label](url), bare URLs
 const re=/(`+)([\s\S]*?[^`])\1(?!`)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
 let last=0,m;
 while((m=re.exec(text))){if(m.index>last)parent.append(text.slice(last,m.index));
  if(m[1])parent.append(el('code','md-code',m[2]));
  else if(m[3]||m[4]){const b=el('strong');inline(m[3]||m[4],b);parent.append(b)}
  else if(m[5]||m[6]){const i=el('em');inline(m[5]||m[6],i);parent.append(i)}
  else{const href=m[8]||m[9],label=m[7]||m[9];if(/^(https?:|mailto:)/i.test(href)){const a=el('a','',label);a.href=href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a)}else parent.append(label)}
  last=re.lastIndex}
 if(last<text.length)parent.append(text.slice(last));
}

const SHELL=/^(bash|sh|zsh|shell|console|powershell|ps1|pwsh|cmd|bat)$/i;
import {chartSvg,dsStyle,DEFAULT_DS} from './deck-render.js';
// a ```chart block (JSON: {type, title, labels, series}) renders as a chart, with its data one click away
function chartBlock(code){let c;try{c=JSON.parse(code)}catch{return null}const box=el('figure','md-chart');const art=el('div','md-chart-art');art.innerHTML=chartSvg(c);art.style.cssText=dsStyle(DEFAULT_DS);if(c.title)box.append(el('figcaption','',String(c.title).slice(0,120)));box.append(art);
 const t=el('table','md-chart-data');t.hidden=true;const head=el('tr');head.append(el('th','',''),...(c.series||[]).slice(0,4).map(s=>el('th','',String(s.name||''))));t.append(head);(c.labels||[]).slice(0,12).forEach((l,i)=>{const r=el('tr');r.append(el('td','',String(l)),...(c.series||[]).slice(0,4).map(s=>el('td','',String(s.values?.[i]??''))));t.append(r)});
 const b=el('button','md-copy','Show data');b.type='button';b.addEventListener('click',()=>{t.hidden=!t.hidden;b.textContent=t.hidden?'Show data':'Hide data'});box.append(b,t);return box}
function codeBlock(lang,code){if(/^chart$/i.test(lang||'')){const c=chartBlock(code);if(c)return c}
 const wrap=el('div','md-pre');const bar=el('div','md-pre-bar');bar.append(el('span','',lang||'code'));
 const copy=el('button','md-copy','Copy');copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(code);copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy',1500)}catch{copy.textContent='Copy failed'}});
 bar.append(copy);if(SHELL.test(lang||'')&&!code.includes('\n')){const run=el('button','md-copy','Run');run.type='button';run.title='Run in the project terminal';run.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('cba-run-command',{detail:code.trim()})));bar.append(run)}const pre=el('pre');pre.append(el('code','',code));wrap.append(bar,pre);return wrap}

export function renderMarkdown(src,target=el('div','md')){
 target.replaceChildren();const lines=String(src||'').replace(/\r\n?/g,'\n').split('\n');let i=0;
 const isBlockStart=l=>/^(#{1,6}\s|```|~~~|>\s?|\s*([-*+]|\d+[.)])\s+|\s*(-{3,}|\*{3,}|_{3,})\s*$|\|)/.test(l);
 while(i<lines.length){const line=lines[i];
  if(!line.trim()){i++;continue}
  let m;
  if((m=line.match(/^(```|~~~)\s*([\w+#.-]*)/))){const fence=m[1],body=[];i++;while(i<lines.length&&!lines[i].startsWith(fence))body.push(lines[i++]);i++;target.append(codeBlock(m[2],body.join('\n')));continue}
  if((m=line.match(/^(#{1,6})\s+(.*)$/))){const h=el('h'+Math.min(6,m[1].length+2),'md-h');inline(m[2].replace(/\s+#+\s*$/,''),h);target.append(h);i++;continue}
  if(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)){target.append(el('hr'));i++;continue}
  if(/^>\s?/.test(line)){const q=el('blockquote'),body=[];while(i<lines.length&&/^>\s?/.test(lines[i]))body.push(lines[i++].replace(/^>\s?/,''));renderMarkdown(body.join('\n'),q);q.classList.remove('md');target.append(q);continue}
  if(/^\|.*\|\s*$/.test(line)&&/^\|?\s*:?-{2,}/.test(lines[i+1]||'')){const rows=[];while(i<lines.length&&/^\|.*\|\s*$/.test(lines[i]))rows.push(lines[i++]);
   const cells=r=>r.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());const box=el('div','md-table');const t=el('table');const head=el('thead'),tr=el('tr');
   for(const c of cells(rows[0])){const th=el('th');inline(c,th);tr.append(th)}head.append(tr);const body=el('tbody');
   for(const r of rows.slice(2)){const row=el('tr');for(const c of cells(r)){const td=el('td');inline(c,td);row.append(td)}body.append(row)}t.append(head,body);box.append(t);target.append(box);continue}
  if((m=line.match(/^(\s*)([-*+]|\d+[.)])\s+/))){const ordered=/\d/.test(m[2]);const list=el(ordered?'ol':'ul');if(ordered){const start=parseInt(m[2]);if(start>1)list.start=start}
   while(i<lines.length){const lm=lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);if(!lm||/\d/.test(lm[2])!==ordered)break;const li=el('li');const task=lm[3].match(/^\[( |x|X)\]\s+(.*)$/);
    if(task){const box=el('input');box.type='checkbox';box.disabled=true;box.checked=task[1]!==' ';li.append(box,' ');inline(task[2],li)}else inline(lm[3],li);i++;
    while(i<lines.length&&/^\s{2,}\S/.test(lines[i])&&!/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])){li.append(' ');inline(lines[i++].trim(),li)}list.append(li)}
   target.append(list);continue}
  const p=el('p'),body=[];while(i<lines.length&&lines[i].trim()&&!(body.length&&isBlockStart(lines[i])))body.push(lines[i++]);
  body.forEach((l,k)=>{if(k)p.append(el('br'));inline(l,p)});target.append(p);
 }
 return target;
}
