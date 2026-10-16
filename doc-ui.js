// Document editor in the Artifacts panel. The document stays Markdown on disk; each block renders formatted and,
// when you click into it, shows its Markdown so you can edit it in place. Like Google Docs: a formatting bar (style,
// bold, italic, link, lists), Insert (table, image, contents, divider), tables edited cell by cell, find and replace,
// suggest mode (your edits wait as suggestions to accept or reject) and a page view. Also: an outline, comments for
// the AI, citations that jump to their source, and highlights on what the AI just changed (keep or undo).
import {parse,inline,source,tableMd,headings} from './md-lite.mjs';
import {promptDialog,openMenu} from './ui-kit.js';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const blockKey=b=>norm(b.type==='ul'||b.type==='ol'?b.items.join('|'):b.type==='table'?JSON.stringify(b.rows):source(b));

function spans(text,into){for(const s of inline(text)){let n;
  if(s.cite){n=el('a','doc-cite','['+s.cite+']');n.href='#src-'+s.cite;n.addEventListener('click',e=>{e.preventDefault();const row=into.closest('.doc')?.querySelector('.doc-srcs:not([hidden]) [data-n="'+s.cite+'"]');if(row){row.scrollIntoView({behavior:'smooth',block:'nearest'});row.classList.remove('flash');void row.offsetWidth;row.classList.add('flash');return}into.closest('.doc-paper')?.querySelector('[data-src="'+s.cite+'"]')?.scrollIntoView({behavior:'smooth',block:'center'})})}
  else if(s.link){n=el('a','',s.text);n.href=s.link;n.target='_blank';n.rel='noopener noreferrer'}
  else if(s.code)n=el('code','',s.text);else if(s.bold)n=el('strong','',s.text);else if(s.italic)n=el('em','',s.text);else n=document.createTextNode(s.text);
  into.append(n)}return into}

export function createDocView(root,ctx){
 let md='',blocks=[],before=null,editing=null,comments=[],saveTimer=null,current=-1,suggest=false;
 const outline=el('nav','doc-outline');outline.setAttribute('aria-label','Outline');const scroll=el('div','doc-scroll'),paper=el('article','doc-paper');
 const changes=el('div','doc-changes');changes.hidden=true;const cbar=el('div','doc-comments');cbar.hidden=true;
 const bubble=el('div','doc-bubble');bubble.hidden=true;const cBtn=el('button','','Comment'),aBtn=el('button','','Ask AI'),kBtn=el('button','','Check this');cBtn.type=aBtn.type=kBtn.type='button';kBtn.title='Ask the AI to check this against its source';bubble.append(cBtn,kBtn,aBtn);
 // ---- formatting bar ----
 const bar=el('div','doc-bar');bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Formatting');
 const btn=(label,title,on,cls='')=>{const b=el('button','doc-tb '+cls,label);b.type='button';b.title=title;b.setAttribute('aria-label',title);b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('click',on);return b};
 const styleSel=el('select','doc-style');styleSel.setAttribute('aria-label','Text style');for(const [v,l] of [['p','Normal text'],['1','Heading 1'],['2','Heading 2'],['3','Heading 3'],['q','Quote']])styleSel.append(new Option(l,v));
 const boldB=btn('B','Bold (Ctrl+B)',()=>wrap('**'),'b'),italB=btn('I','Italic (Ctrl+I)',()=>wrap('*'),'i'),linkB=btn('Link','Add a link (Ctrl+K)',()=>link());
 const ulB=btn('• List','Bulleted list',()=>toList('ul')),olB=btn('1. List','Numbered list',()=>toList('ol'));
 const insB=btn('Insert','Insert a table, image, contents or divider',()=>openMenu(insB,[{label:'Table',action:()=>insertBlock('| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |')},{label:'Image…',action:insertImage},{label:'Table of contents',action:()=>insertBlock('[TOC]',true)},{label:'Divider',action:()=>insertBlock('---')}],{anchor:insB,label:'Insert'}),'doc-menu');
 const findB=btn('Find','Find and replace (Ctrl+F)',()=>openFind());
 const suggB=btn('Suggest','Suggest mode: your edits wait as suggestions to accept or reject',()=>{suggest=!suggest;suggB.setAttribute('aria-pressed',String(suggest));suggB.classList.toggle('on',suggest);ctx.notify(suggest?'Suggest mode is on: your edits show as suggestions.':'Suggest mode is off.')});suggB.setAttribute('aria-pressed','false');
 let pages=false;try{pages=localStorage.getItem('cba-doc-pages')==='1'}catch{}
 const pageB=btn('Pages','Page view: A4 pages with page breaks, as it prints',()=>{pages=!pages;try{localStorage.setItem('cba-doc-pages',pages?'1':'0')}catch{}paintPages()});
 const grow=el('span','doc-grow');bar.append(styleSel,boldB,italB,linkB,el('i','doc-sep'),ulB,olB,el('i','doc-sep'),insB,grow,findB,suggB,pageB);
 const paintPages=()=>{paper.classList.toggle('doc-pages',pages);pageB.setAttribute('aria-pressed',String(pages));pageB.classList.toggle('on',pages)};paintPages();
 // ---- find and replace ----
 const find=el('div','doc-find');find.hidden=true;const fIn=el('input');fIn.placeholder='Find';fIn.setAttribute('aria-label','Find');const rIn=el('input');rIn.placeholder='Replace with';rIn.setAttribute('aria-label','Replace with');const fCount=el('span','doc-fcount','');
 const fPrev=btn('↑','Previous match (Shift+Enter)',()=>jump(-1)),fNext=btn('↓','Next match (Enter)',()=>jump(1)),rOne=btn('Replace','Replace this match',()=>replaceOne()),rAll=btn('All','Replace every match',()=>replaceAll()),fX=btn('×','Close (Esc)',()=>closeFind());
 find.append(fIn,fCount,fPrev,fNext,rIn,rOne,rAll,fX);
 const tbar=el('div','doc-tbar');tbar.hidden=true;
 const srcs=el('aside','doc-srcs');srcs.setAttribute('aria-label','Sources');srcs.hidden=true;let srcOpen=ctx.kind?.()==='research';let sources=[];
 const srcB=btn('Sources','Show the sources beside the report',()=>{srcOpen=!srcOpen;paintSources()});bar.insertBefore(srcB,findB);
 scroll.append(bar,find,changes,paper,cbar);root.replaceChildren(outline,scroll,srcs,bubble,tbar);

 function render(){sources=[];if(editing&&!editing.node.isConnected)editing=null;const keep=scroll.scrollTop;if(editing){editing=null;tbar.hidden=true}paper.replaceChildren();outline.replaceChildren(el('div','doc-outline-head','Outline'));
  const old=new Set((before?parse(before):[]).map(blockKey));let changed=0;let inSources=false;const sugg=new Map(comments.filter(c=>c.kind==='suggestion').map(c=>[c.old+'\u0000'+(c.item??''),c]));
  blocks.forEach((b,i)=>{let node;
   if(b.type==='h'){node=el('h'+Math.min(4,b.level),'doc-b');spans(b.text,node);inSources=/^sources|^references|^sumber/i.test(b.text);const o=el('button','doc-ol l'+b.level,b.text.replace(/[*`]/g,''));o.type='button';o.addEventListener('click',()=>node.scrollIntoView({behavior:'smooth',block:'start'}));outline.append(o)}
   else if(b.type==='p'){node=el('p','doc-b'+(/^_?(writing|menulis)…?_?$/i.test(b.text.trim())?' doc-writing':''));spans(b.text,node)}
   else if(b.type==='quote'){node=el('blockquote','doc-b');spans(b.text,node)}
   else if(b.type==='ul'||b.type==='ol'){node=el(b.type,'doc-list');b.items.forEach((t,j)=>{const li=el('li','doc-b');li.dataset.item=String(j);spans(t,li);if(inSources&&b.type==='ol'){li.dataset.src=String(j+1);sources.push(t)}node.append(li)})}
   else if(b.type==='table'){node=el('div','doc-table');const t=el('table');const hr=el('tr');b.head.forEach((h,c)=>{const th=spans(h,el('th'));th.dataset.r='-1';th.dataset.c=String(c);hr.append(th)});const head=el('thead');head.append(hr);const body=el('tbody');
    b.rows.forEach((r,ri)=>{const tr=el('tr');b.head.forEach((_,c)=>{const td=spans(r[c]??'',el('td'));td.dataset.r=String(ri);td.dataset.c=String(c);tr.append(td)});body.append(tr)});t.append(head,body);node.append(t)}
   else if(b.type==='img'){node=el('figure','doc-b doc-fig');const im=el('img');im.src=ctx.resolve?.(b.src)||'';im.alt=b.alt;im.loading='lazy';node.append(im);if(b.alt)node.append(el('figcaption','',b.alt))}
   else if(b.type==='toc'){node=el('nav','doc-b doc-toc');node.append(el('strong','','Contents'));const ul=el('ul');for(const h of headings(md)){const li=el('li','l'+h.level);const a=el('a','',h.text);a.href='#';a.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();[...paper.querySelectorAll('h1,h2,h3,h4')].find(x=>norm(x.textContent)===norm(h.text))?.scrollIntoView({behavior:'smooth',block:'start'})});li.append(a);ul.append(li)}node.append(ul)}
   else if(b.type==='code'){node=el('pre','doc-code');node.append(el('code','',b.text))}else node=el('hr');
   node.dataset.i=String(i);
   if(before!==null&&b.type!=='hr'&&!old.has(blockKey(b))){node.classList.add('doc-new');changed++}
   paper.append(node);
   // suggestions waiting on this block (or its list items)
   const pending=[...sugg.values()].filter(c=>c.old===norm(b.type==='ul'||b.type==='ol'?'':source(b))&&c.item==null||(b.type==='ul'||b.type==='ol')&&c.item!=null&&norm(b.items[c.item])===c.old);
   for(const c of pending){const box=el('div','doc-sugg');const del=el('del','',c.oldText||c.old),ins=el('ins','',c.text);const ok=el('button','primary','Accept'),no=el('button','','Reject');ok.type=no.type='button';
    ok.onclick=()=>{dropSuggestion(c);apply(b,c.item??null,c.text,true)};no.onclick=()=>{dropSuggestion(c);render()};box.append(el('span','doc-sugg-l','Suggested'),del,ins,ok,no);paper.append(box)}});
  if(!blocks.length)paper.append(el('p','doc-empty','This document is empty. Ask the AI to write it, or click here and start typing.'));
  const locked=ctx.locked?.();paper.classList.toggle('doc-locked',Boolean(locked));bar.classList.toggle('doc-locked',Boolean(locked));
  for(const n of paper.querySelectorAll('.doc-b'))n.addEventListener('click',e=>{if(e.target.closest('a'))return;if(ctx.locked?.())return ctx.notify('The AI is writing this. You can edit it when it finishes.');edit(n)});
  for(const c of paper.querySelectorAll('.doc-table th,.doc-table td'))c.addEventListener('click',()=>{if(ctx.locked?.())return ctx.notify('The AI is writing this. You can edit it when it finishes.');editCell(c)});
  if(!blocks.length)paper.firstChild.addEventListener('click',()=>{md='New paragraph';save();setText(md)});
  outline.hidden=outline.childElementCount<3;
  changes.hidden=!changed;changes.replaceChildren();if(changed){changes.append(el('span','','The AI changed '+changed+(changed===1?' part':' parts')+' (highlighted).'));const keepB=el('button','','Keep');keepB.type='button';keepB.addEventListener('click',()=>{before=null;ctx.reviewed();render()});const undo=el('button','','Undo these changes');undo.type='button';undo.addEventListener('click',()=>ctx.undo());changes.append(keepB,undo)}
  const foot=el('div','doc-foot');const words=md.replace(/[#>*_`|-]/g,' ').split(/\s+/).filter(Boolean).length;const more=el('button','link-button','Add a paragraph');more.type='button';more.onclick=()=>{remember(md);setText(md.replace(/\s*$/,'')+'\n\nNew paragraph\n');save();const last=[...paper.querySelectorAll('p.doc-b')].at(-1);if(last)edit(last)};foot.append(more,el('span','',words+' words · about '+Math.max(1,Math.round(words/220))+' min read'));paper.append(foot);
  paintComments();paintSources();syncBar();if(!find.hidden)highlight();scroll.scrollTop=keep}
 // sources beside the report: each with its site and date, the link, and how often the text cites it
 function paintSources(){srcB.hidden=!sources.length;srcB.setAttribute('aria-pressed',String(srcOpen));srcB.classList.toggle('on',srcOpen&&sources.length>0);srcs.hidden=!srcOpen||!sources.length;root.classList.toggle('doc-has-srcs',!srcs.hidden);if(srcs.hidden)return;srcs.replaceChildren();
  const head=el('div','doc-srcs-head');head.append(el('strong','','Sources · '+sources.length));const style=el('select','doc-style');style.setAttribute('aria-label','Citation style');for(const [v,l] of [['','Citation style…'],['numbered','Numbered'],['APA','APA'],['MLA','MLA']])style.append(new Option(l,v));
  style.onchange=()=>{if(style.value)ctx.send('In '+ctx.title()+', rewrite the Sources list in '+(style.value==='numbered'?'a plain numbered style (author or site, title, date, link)':style.value+' style')+'. Keep the same order and numbers so every [n] citation still points at the same source. Change nothing else.');style.value=''};head.append(style);srcs.append(head);
  const counts={};for(const m of md.matchAll(/\[(\d{1,3})\](?!\()/g))counts[m[1]]=(counts[m[1]]||0)+1;
  sources.forEach((t,i)=>{const parts=inline(t),link=parts.find(p=>p.link)?.link||(t.match(/https?:\/\/\S+/)||[])[0],site=(()=>{try{return new URL(link).hostname.replace(/^www\./,'')}catch{return ''}})(),date=(t.match(/\b(19|20)\d{2}(-\d{2}(-\d{2})?)?\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? (\d{1,2}, )?(19|20)\d{2}\b/)||[])[0];
   const row=el('div','doc-src');row.dataset.n=String(i+1);const title=parts.map(p=>p.text).join('').replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim()||site||'Source '+(i+1);
   const meta=el('span','doc-src-meta',[site,date,counts[i+1]?'cited '+counts[i+1]+'×':'not cited'].filter(Boolean).join(' · '));row.append(el('b','',String(i+1)),el('span','doc-src-t',title.slice(0,140)),meta);
   if(link){const a=el('a','doc-src-open','Open');a.href=link;a.target='_blank';a.rel='noopener noreferrer';row.append(a)}srcs.append(row)});
  const add=el('button','doc-src-add','Add a source…');add.type='button';add.onclick=addSource;srcs.append(add)}
 async function addSource(){const v=await promptDialog({title:'Add a source',message:'Paste a link, or leave this empty to pick a PDF from your computer.',confirm:'Add',input:{label:'Link (https://…)',max:800,optional:true}});if(v==null)return;
  if(v.trim()){const url=/^https?:/i.test(v.trim())?v.trim():'https://'+v.trim();ctx.ask('In '+ctx.title()+', read this source and use it where it is relevant, citing it in the Sources list: '+url+'\n');return}
  const f=el('input');f.type='file';f.accept='application/pdf,.pdf,.txt,.md';f.onchange=async()=>{const file=f.files[0];if(!file)return;if(file.size>15e6)return ctx.notify('Use a file under 15 MB.');try{const p=await ctx.upload(file,'sources');ctx.ask('In '+ctx.title()+', read the source I added at '+p+' and use it where it is relevant, citing it in the Sources list.\n')}catch(e){ctx.notify(e.message)}};f.click()}

 // ---- edit one block (or one list item) as Markdown, then put it back in the file ----
 function edit(node){if(editing)return;const b=blocks[Number(node.closest('[data-i]').dataset.i)],item=node.dataset.item;current=Number(node.closest('[data-i]').dataset.i);
  const raw=item!=null?b.items[Number(item)]:source(b);editing={node,b,item,raw};node.classList.add('doc-editing');node.contentEditable='true';node.spellcheck=true;node.textContent=raw;node.focus();
  const sel=getSelection();sel.selectAllChildren(node);sel.collapseToEnd();syncBar();
  const done=keep=>{node.removeEventListener('blur',blur);node.removeEventListener('keydown',key);node.contentEditable='false';node.classList.remove('doc-editing');const text=node.textContent.replace(/ /g,' ');editing=null;
   if(keep&&text.trim()!==raw.trim())apply(b,item,text);else render()};
  const blur=()=>done(true);const key=e=>{if(e.key==='Escape'){e.preventDefault();node.textContent=raw;done(false)}else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();node.blur()}};
  node.addEventListener('blur',blur);node.addEventListener('keydown',key)}
 function apply(b,item,text,force){if(suggest&&!force){const old=item!=null?b.items[Number(item)]:source(b);comments.push({kind:'suggestion',old:norm(old),oldText:old,item:item!=null?Number(item):null,text:text.trim(),time:Date.now()});ctx.saveComments(comments);render();return}
  remember(md);const lines=md.replace(/\r/g,'').split('\n');
  if(item!=null){const at=b.at[Number(item)],marker=lines[at].match(/^\s*([-*+]|\d+[.)])\s+/)[0];lines.splice(at,1,...(text.trim()?[marker+text.replace(/\n+/g,' ').trim()]:[]))}
  else lines.splice(b.start,b.end-b.start,...(text.trim()?text.replace(/\r/g,'').split('\n'):[]));
  setText(lines.join('\n'));save()}
 const dropSuggestion=c=>{comments=comments.filter(x=>x!==c);ctx.saveComments(comments)};
 // finish the block being typed in (saving it) before changing the document another way
 const settle=()=>{if(editing){editing.node.blur();editing=null}};
 function replaceBlock(i,text){const b=blocks[i];if(!b)return;remember(md);const lines=md.replace(/\r/g,'').split('\n');lines.splice(b.start,b.end-b.start,...text.split('\n'));setText(lines.join('\n'));save()}
 function setText(t){md=t;blocks=parse(md);render()}
 let undo=[],redo=[];const remember=prev=>{undo.push(prev);if(undo.length>60)undo.shift();redo=[]};
 function save(){clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{try{await ctx.save(md)}catch(e){ctx.notify(e.message)}},200)}

 // ---- formatting: style, bold, italic, link, lists ----
 const styleOf=b=>b?.type==='h'?String(Math.min(3,b.level)):b?.type==='quote'?'q':'p';
 function syncBar(){const b=editing?.b||blocks[current];const textual=b&&['p','h','quote'].includes(b.type)&&editing?.item==null;styleSel.disabled=!textual;if(textual)styleSel.value=styleOf(b);
  for(const x of [boldB,italB,linkB])x.disabled=!b||!['p','h','quote','ul','ol'].includes(b.type);ulB.setAttribute('aria-pressed',String(b?.type==='ul'));olB.setAttribute('aria-pressed',String(b?.type==='ol'))}
 styleSel.onchange=()=>{const v=styleSel.value,prefix=v==='q'?'> ':v==='p'?'':'#'.repeat(Number(v))+' ';
  if(editing){const t=editing.node.textContent.replace(/^(#{1,6}\s+|>\s?)/,'');editing.node.textContent=prefix+t;const s=getSelection();s.selectAllChildren(editing.node);s.collapseToEnd();editing.node.focus();return}
  const b=blocks[current];if(!b)return;replaceBlock(current,prefix+(b.text||''))};
 function wrap(mark){if(editing){const s=getSelection(),t=s.toString();if(t&&editing.node.contains(s.anchorNode))document.execCommand('insertText',false,mark+t+mark);else ctx.notify('Select some words first.');return}
  const s=getSelection(),t=s.toString().trim();if(!t)return ctx.notify('Select some words first.');const n=s.anchorNode?.parentElement?.closest('[data-i]');if(!n)return;const i=Number(n.dataset.i),b=blocks[i],li=s.anchorNode.parentElement.closest('[data-item]');
  if(b.type==='ul'||b.type==='ol'){const k=Number(li?.dataset.item??0),raw=b.items[k],at=raw.indexOf(t);if(at<0)return ctx.notify('Click into the text to format that part.');apply(b,k,raw.slice(0,at)+mark+t+mark+raw.slice(at+t.length),true);return}
  const raw=source(b),at=raw.indexOf(t);if(at<0)return ctx.notify('Click into the text to format that part.');replaceBlock(i,raw.slice(0,at)+mark+t+mark+raw.slice(at+t.length))}
 async function link(){let range=null,node=editing?.node;const s=getSelection();if(s.rangeCount)range=s.getRangeAt(0).cloneRange();const t=s.toString();if(!t)return ctx.notify('Select the words to link first.');
  const url=await promptDialog({title:'Add a link',message:'“'+t.slice(0,80)+'”',confirm:'Add link',input:{label:'Address (https://…)',max:500}});if(!url?.trim())return;const href=/^(https?:|mailto:)/i.test(url.trim())?url.trim():'https://'+url.trim();
  if(node&&editing){node.focus();const sel=getSelection();sel.removeAllRanges();sel.addRange(range);document.execCommand('insertText',false,'['+t+']('+href+')');return}
  const n=range?.startContainer?.parentElement?.closest('[data-i]');if(!n)return;const i=Number(n.dataset.i),b=blocks[i],raw=source(b),at=raw.indexOf(t);if(at<0)return ctx.notify('Click into the text to link that part.');replaceBlock(i,raw.slice(0,at)+'['+t+']('+href+')'+raw.slice(at+t.length))}
 function toList(kind){settle();setTimeout(()=>{const b=blocks[current];if(!b)return;
  if(b.type===kind)return replaceBlock(current,b.items.join('\n\n'));if(b.type==='ul'||b.type==='ol')return replaceBlock(current,b.items.map((t,j)=>(kind==='ol'?(j+1)+'. ':'- ')+t).join('\n'));
  if(['p','h','quote'].includes(b.type))replaceBlock(current,(kind==='ol'?'1. ':'- ')+b.text)},0)}
 function insertBlock(text,top){settle();remember(md);const lines=md.replace(/\r/g,'').split('\n');let at=lines.length;
  if(top){const h1=blocks.find(b=>b.type==='h'&&b.level===1);at=h1?h1.end:0}else if(blocks[current])at=blocks[current].end;
  lines.splice(at,0,'',...text.split('\n'),'');setText(lines.join('\n').replace(/\n{3,}/g,'\n\n'));save()}
 function insertImage(){const f=el('input');f.type='file';f.accept='image/png,image/jpeg,image/webp,image/gif';f.onchange=async()=>{const file=f.files[0];if(!file)return;if(file.size>8e6)return ctx.notify('Use an image under 8 MB.');try{const src=await ctx.upload(file);insertBlock('!['+file.name.replace(/\.[^.]+$/,'').replace(/[[\]]/g,'')+']('+src+')')}catch(e){ctx.notify(e.message)}};f.click()}

 // ---- tables: edit a cell in place; row and column buttons while a cell is open ----
 function editCell(c){if(editing)return;const i=Number(c.closest('[data-i]').dataset.i),b=blocks[i],r=Number(c.dataset.r),k=Number(c.dataset.c);current=i;const raw=r<0?b.head[k]:(b.rows[r]?.[k]??'');
  editing={node:c,b,cell:true};c.contentEditable='true';c.classList.add('doc-editing');c.textContent=raw;c.focus();const s=getSelection();s.selectAllChildren(c);s.collapseToEnd();
  const op=(label,title,fn)=>{const x=btn(label,title,()=>{c.removeEventListener('blur',blur);c.contentEditable='false';editing=null;tbar.hidden=true;const head=[...b.head],rows=b.rows.map(row=>b.head.map((_,j)=>row[j]??''));setCell(head,rows);fn(head,rows);replaceBlock(i,tableMd(head,rows))});return x};
  const setCell=(head,rows)=>{const v=c.textContent.replace(/ /g,' ').trim();if(r<0)head[k]=v;else rows[r][k]=v};
  tbar.replaceChildren(op('+ Row','Add a row below',(h,rows)=>rows.splice(r+1,0,h.map(()=>''))),op('− Row','Remove this row',(h,rows)=>{if(r>=0&&rows.length>1)rows.splice(r,1)}),op('+ Col','Add a column to the right',(h,rows)=>{h.splice(k+1,0,'New');rows.forEach(row=>row.splice(k+1,0,''))}),op('− Col','Remove this column',(h,rows)=>{if(h.length>1){h.splice(k,1);rows.forEach(row=>row.splice(k,1))}}));
  const tb=c.closest('table').getBoundingClientRect(),rb=root.getBoundingClientRect();tbar.hidden=false;Object.assign(tbar.style,{left:Math.max(8,tb.left-rb.left)+'px',top:Math.max(8,tb.top-rb.top-40)+'px'});
  const blur=()=>{c.removeEventListener('blur',blur);c.removeEventListener('keydown',key);c.contentEditable='false';c.classList.remove('doc-editing');editing=null;setTimeout(()=>{if(!editing)tbar.hidden=true},150);const v=c.textContent.replace(/ /g,' ').trim();if(v===raw.trim())return render();
   const head=[...b.head],rows=b.rows.map(row=>b.head.map((_,j)=>row[j]??''));if(r<0)head[k]=v;else rows[r][k]=v;if(suggest){comments.push({kind:'suggestion',old:norm(source(b)),oldText:raw,item:null,text:tableMd(head,rows),time:Date.now()});ctx.saveComments(comments);return render()}replaceBlock(i,tableMd(head,rows))};
  const key=e=>{if(e.key==='Escape'){e.preventDefault();c.textContent=raw;c.blur()}else if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();const cellsAll=[...c.closest('table').querySelectorAll('th,td')],next=cellsAll[cellsAll.indexOf(c)+(e.shiftKey?-1:1)];c.blur();if(next)setTimeout(()=>{const n=paper.querySelector('[data-i="'+i+'"] [data-r="'+next.dataset.r+'"][data-c="'+next.dataset.c+'"]');if(n)editCell(n)},30)}};
  c.addEventListener('blur',blur);c.addEventListener('keydown',key)}

 // ---- find and replace (highlights through the CSS Highlight API) ----
 let matches=[],at=0;const HL=typeof Highlight!=='undefined'&&CSS.highlights;
 function openFind(){find.hidden=false;const t=getSelection().toString().trim();if(t&&t.length<80)fIn.value=t;fIn.focus();fIn.select();highlight()}
 function closeFind(){find.hidden=true;matches=[];if(HL){CSS.highlights.delete('doc-find');CSS.highlights.delete('doc-find-now')}fCount.textContent=''}
 function highlight(){matches=[];const q=fIn.value;if(HL){CSS.highlights.delete('doc-find');CSS.highlights.delete('doc-find-now')}if(!q){fCount.textContent='';return}
  const re=new RegExp(reEsc(q),'gi'),w=document.createTreeWalker(paper,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('.doc-foot,.doc-sugg')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});let n;
  while((n=w.nextNode())){let m;re.lastIndex=0;while((m=re.exec(n.data))){const r=new Range();r.setStart(n,m.index);r.setEnd(n,m.index+m[0].length);matches.push(r)}}
  at=Math.min(at,Math.max(0,matches.length-1));fCount.textContent=matches.length?(at+1)+' of '+matches.length:'No matches';if(HL&&matches.length){CSS.highlights.set('doc-find',new Highlight(...matches));CSS.highlights.set('doc-find-now',new Highlight(matches[at]))}}
 function jump(d){if(!matches.length)return;at=(at+d+matches.length)%matches.length;fCount.textContent=(at+1)+' of '+matches.length;if(HL)CSS.highlights.set('doc-find-now',new Highlight(matches[at]));matches[at].startContainer.parentElement.scrollIntoView({block:'center',behavior:'smooth'})}
 function replaceOne(){const r=matches[at];if(!r)return;const n=r.startContainer.parentElement.closest('[data-i]');if(!n)return;const i=Number(n.dataset.i),b=blocks[i];const q=fIn.value,re=new RegExp(reEsc(q),'gi');
  // which match inside this block this is, then the same one in its Markdown
  const inBlock=matches.filter(m=>m.startContainer.parentElement.closest('[data-i]')===n),nth=inBlock.indexOf(r);let k=-1;const li=r.startContainer.parentElement.closest('[data-item]');
  if((b.type==='ul'||b.type==='ol')&&li){const item=Number(li.dataset.item),raw=b.items[item],nthLi=inBlock.filter(m=>m.startContainer.parentElement.closest('[data-item]')===li).indexOf(r);apply(b,item,raw.replace(re,m=>++k===nthLi?rIn.value:m),true)}
  else replaceBlock(i,source(b).replace(re,m=>++k===nth?rIn.value:m));highlight()}
 function replaceAll(){settle();const q=fIn.value;if(!q)return;const n=matches.length;if(!n)return;remember(md);setText(md.replace(new RegExp(reEsc(q),'gi'),rIn.value));save();highlight();ctx.notify('Replaced '+n+(n===1?' match.':' matches.'))}
 fIn.addEventListener('input',()=>{at=0;highlight()});fIn.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();jump(e.shiftKey?-1:1)}else if(e.key==='Escape'){e.preventDefault();closeFind()}});rIn.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeFind()}});

 root.addEventListener('keydown',e=>{const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
  if(mod&&k==='f'){e.preventDefault();openFind();return}
  if(editing&&mod&&(k==='b'||k==='i')){e.preventDefault();wrap(k==='b'?'**':'*');return}if(editing&&mod&&k==='k'){e.preventDefault();link();return}
  if(editing||!mod)return;if(k==='z'||k==='y'){e.preventDefault();const back=k==='z'&&!e.shiftKey;const from=back?undo:redo,to=back?redo:undo;if(!from.length)return ctx.notify(back?'Nothing to undo.':'Nothing to redo.');to.push(md);setText(from.pop());clearTimeout(saveTimer);saveTimer=setTimeout(()=>ctx.save(md).catch(err=>ctx.notify(err.message)),150)}});

 // select text to comment on it or ask the AI about it
 let picked='';
 document.addEventListener('selectionchange',()=>{if(!root.isConnected||editing)return;const s=getSelection();const t=s.rangeCount&&paper.contains(s.anchorNode)?s.toString().trim():'';
  if(!t){setTimeout(()=>{if(!getSelection().toString().trim())bubble.hidden=true},150);return}picked=t.slice(0,500);const n=s.anchorNode?.parentElement?.closest('[data-i]');if(n)current=Number(n.dataset.i);syncBar();const r=s.getRangeAt(0).getBoundingClientRect(),box=root.getBoundingClientRect();bubble.hidden=false;bubble.style.left=Math.max(8,r.left-box.left+r.width/2-70)+'px';bubble.style.top=Math.max(8,r.top-box.top-44)+'px'});
 cBtn.addEventListener('mousedown',e=>e.preventDefault());aBtn.addEventListener('mousedown',e=>e.preventDefault());
 cBtn.addEventListener('click',async()=>{bubble.hidden=true;const text=await promptDialog({title:'Comment',message:'On: “'+picked.slice(0,120)+(picked.length>120?'…':'')+'”',confirm:'Add comment',input:{label:'Your comment',max:400}});if(!text?.trim())return;comments.push({quote:picked,text:text.trim(),time:Date.now()});await ctx.saveComments(comments);paintComments()});
 aBtn.addEventListener('click',()=>{bubble.hidden=true;ctx.ask('In '+ctx.title()+', about this part: “'+picked+'”\n')});
 kBtn.addEventListener('mousedown',e=>e.preventDefault());kBtn.addEventListener('click',()=>{bubble.hidden=true;ctx.send('In '+ctx.title()+', check this claim against the source it cites (open the source again): “'+picked+'”. Say whether the source supports it (yes / partly / no) and why in one or two sentences. If it is not supported, fix the sentence or its citation in the report and say what you changed.')});
 function paintComments(){const notes=comments.filter(c=>c.kind!=='suggestion');cbar.hidden=!notes.length;cbar.replaceChildren();if(!notes.length)return;const head=el('div','doc-comments-head');head.append(el('strong','',notes.length+(notes.length===1?' comment':' comments')));
  const send=el('button','primary','Send to AI');send.type='button';send.addEventListener('click',async()=>{ctx.send('Please address these comments on '+ctx.title()+', then remove nothing else:\n'+notes.map((c,i)=>(i+1)+'. On “'+c.quote+'”: '+c.text).join('\n'));comments=comments.filter(c=>c.kind==='suggestion');await ctx.saveComments(comments);paintComments()});head.append(send);cbar.append(head);
  notes.forEach(c=>{const row=el('div','doc-comment');const q=el('q','',c.quote.slice(0,140));const t=el('p','',c.text);const x=el('button','link-button','Resolve');x.type='button';x.addEventListener('click',async()=>{comments=comments.filter(y=>y!==c);await ctx.saveComments(comments);paintComments()});row.append(q,t,x);cbar.append(row)})}

 return {set(text,{previous,notes}={}){if(editing)return;before=previous??null;comments=notes||comments;md=text;blocks=parse(md);render()},
  markdown:()=>md}}
