// Document editor in the Artifacts panel. The document stays Markdown on disk; each block renders formatted and,
// when you click into it, shows its Markdown so you can edit it in place. Also: an outline, comments you can send
// to the AI, citations that jump to their source, and highlights on what the AI just changed (keep or undo).
import {parse,inline,source} from './md-lite.mjs';
import {promptDialog} from './ui-kit.js';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();

function spans(text,into){for(const s of inline(text)){let n;
  if(s.cite){n=el('a','doc-cite','['+s.cite+']');n.href='#src-'+s.cite;n.addEventListener('click',e=>{e.preventDefault();into.closest('.doc-paper')?.querySelector('[data-src="'+s.cite+'"]')?.scrollIntoView({behavior:'smooth',block:'center'})})}
  else if(s.link){n=el('a','',s.text);n.href=s.link;n.target='_blank';n.rel='noopener noreferrer'}
  else if(s.code)n=el('code','',s.text);else if(s.bold)n=el('strong','',s.text);else if(s.italic)n=el('em','',s.text);else n=document.createTextNode(s.text);
  into.append(n)}return into}

export function createDocView(root,ctx){
 let md='',blocks=[],before=null,editing=null,comments=[],saveTimer=null;
 const outline=el('nav','doc-outline');outline.setAttribute('aria-label','Outline');const scroll=el('div','doc-scroll'),paper=el('article','doc-paper');
 const changes=el('div','doc-changes');changes.hidden=true;const cbar=el('div','doc-comments');cbar.hidden=true;
 const bubble=el('div','doc-bubble');bubble.hidden=true;const cBtn=el('button','','Comment'),aBtn=el('button','','Ask AI');cBtn.type=aBtn.type='button';bubble.append(cBtn,aBtn);
 scroll.append(changes,paper,cbar);root.replaceChildren(outline,scroll,bubble);

 function render(){const keep=scroll.scrollTop;paper.replaceChildren();outline.replaceChildren(el('div','doc-outline-head','Outline'));
  const old=new Set((before?parse(before):[]).map(b=>norm(b.type==='ul'||b.type==='ol'?b.items.join('|'):b.type==='table'?JSON.stringify(b.rows):source(b))));let changed=0;
  let inSources=false;
  blocks.forEach((b,i)=>{let node;
   if(b.type==='h'){node=el('h'+Math.min(4,b.level),'doc-b');spans(b.text,node);inSources=/^sources|^references|^sumber/i.test(b.text);const o=el('button','doc-ol l'+b.level,b.text.replace(/[*`]/g,''));o.type='button';o.addEventListener('click',()=>node.scrollIntoView({behavior:'smooth',block:'start'}));outline.append(o)}
   else if(b.type==='p'){node=el('p','doc-b'+(/^_?(writing|menulis)…?_?$/i.test(b.text.trim())?' doc-writing':''));spans(b.text,node)}
   else if(b.type==='quote'){node=el('blockquote','doc-b');spans(b.text,node)}
   else if(b.type==='ul'||b.type==='ol'){node=el(b.type,'doc-list');b.items.forEach((t,j)=>{const li=el('li','doc-b');li.dataset.item=String(j);spans(t,li);if(inSources&&b.type==='ol')li.dataset.src=String(j+1);node.append(li)})}
   else if(b.type==='table'){node=el('div','doc-table');const t=el('table');const hr=el('tr');for(const h of b.head)hr.append(spans(h,el('th')));const head=el('thead');head.append(hr);const body=el('tbody');for(const r of b.rows){const tr=el('tr');for(const c of r)tr.append(spans(c,el('td')));body.append(tr)}t.append(head,body);node.append(t)}
   else if(b.type==='code'){node=el('pre','doc-code');node.append(el('code','',b.text))}else node=el('hr');
   node.dataset.i=String(i);
   const key=norm(b.type==='ul'||b.type==='ol'?b.items.join('|'):b.type==='table'?JSON.stringify(b.rows):source(b));if(before!==null&&b.type!=='hr'&&!old.has(key)){node.classList.add('doc-new');changed++}
   paper.append(node)});
  if(!blocks.length)paper.append(el('p','doc-empty','This document is empty. Ask the AI to write it, or click here and start typing.'));
  const locked=ctx.locked?.();paper.classList.toggle('doc-locked',Boolean(locked));for(const n of paper.querySelectorAll('.doc-b'))n.addEventListener('click',e=>{if(e.target.closest('a'))return;if(ctx.locked?.())return ctx.notify('The AI is writing this. You can edit it when it finishes.');edit(n)});
  if(!blocks.length)paper.firstChild.addEventListener('click',()=>{md='New paragraph';save();setText(md)});
  outline.hidden=outline.childElementCount<3;
  changes.hidden=!changed;changes.replaceChildren();if(changed){changes.append(el('span','','The AI changed '+changed+(changed===1?' part':' parts')+' (highlighted).'));const keepB=el('button','','Keep');keepB.type='button';keepB.addEventListener('click',()=>{before=null;ctx.reviewed();render()});const undo=el('button','','Undo these changes');undo.type='button';undo.addEventListener('click',()=>ctx.undo());changes.append(keepB,undo)}
  const foot=el('div','doc-foot');const words=md.replace(/[#>*_`|-]/g,' ').split(/\s+/).filter(Boolean).length;const more=el('button','link-button','Add a paragraph');more.type='button';more.onclick=()=>{remember(md);setText(md.replace(/\s*$/,'')+'\n\nNew paragraph\n');save();const last=[...paper.querySelectorAll('p.doc-b')].at(-1);if(last)edit(last)};foot.append(more,el('span','',words+' words · about '+Math.max(1,Math.round(words/220))+' min read'));paper.append(foot);
  paintComments();scroll.scrollTop=keep}

 // edit one block (or one list item) as Markdown, then put it back in the file
 function edit(node){if(editing)return;const b=blocks[Number(node.closest('[data-i]').dataset.i)],item=node.dataset.item;
  const raw=item!=null?b.items[Number(item)]:source(b);editing={node,b,item};node.classList.add('doc-editing');node.contentEditable='true';node.spellcheck=true;node.textContent=raw;node.focus();
  const sel=getSelection();sel.selectAllChildren(node);sel.collapseToEnd();
  const done=keep=>{node.removeEventListener('blur',blur);node.removeEventListener('keydown',key);node.contentEditable='false';node.classList.remove('doc-editing');const text=node.textContent.replace(/ /g,' ');editing=null;
   if(keep&&text.trim()!==raw.trim())apply(b,item,text);else render()};
  const blur=()=>done(true);const key=e=>{if(e.key==='Escape'){e.preventDefault();node.textContent=raw;done(false)}else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();node.blur()}};
  node.addEventListener('blur',blur);node.addEventListener('keydown',key)}
 function apply(b,item,text){remember(md);const lines=md.replace(/\r/g,'').split('\n');
  if(item!=null){const at=b.at[Number(item)],marker=lines[at].match(/^\s*([-*+]|\d+[.)])\s+/)[0];lines.splice(at,1,...(text.trim()?[marker+text.replace(/\n+/g,' ').trim()]:[]))}
  else lines.splice(b.start,b.end-b.start,...(text.trim()?text.replace(/\r/g,'').split('\n'):[]));
  setText(lines.join('\n'));save()}
 function setText(t){md=t;blocks=parse(md);render()}
 let undo=[],redo=[];const remember=prev=>{undo.push(prev);if(undo.length>60)undo.shift();redo=[]};
 root.addEventListener('keydown',e=>{const mod=e.ctrlKey||e.metaKey;if(editing&&mod&&['b','i'].includes(e.key.toLowerCase())){e.preventDefault();const mark=e.key.toLowerCase()==='b'?'**':'*';const s=getSelection();const t=s.toString();if(t)document.execCommand('insertText',false,mark+t+mark);return}
  if(editing||!mod)return;if(e.key.toLowerCase()==='z'||e.key.toLowerCase()==='y'){e.preventDefault();const back=e.key.toLowerCase()==='z'&&!e.shiftKey;const from=back?undo:redo,to=back?redo:undo;if(!from.length)return ctx.notify(back?'Nothing to undo.':'Nothing to redo.');to.push(md);setText(from.pop());clearTimeout(saveTimer);saveTimer=setTimeout(()=>ctx.save(md).catch(err=>ctx.notify(err.message)),150)}});
 function save(){clearTimeout(saveTimer);saveTimer=setTimeout(async()=>{try{await ctx.save(md)}catch(e){ctx.notify(e.message)}},200)}

 // select text to comment on it or ask the AI about it
 let picked='';
 document.addEventListener('selectionchange',()=>{if(!root.isConnected||editing)return;const s=getSelection();const t=s.rangeCount&&paper.contains(s.anchorNode)?s.toString().trim():'';
  if(!t){setTimeout(()=>{if(!getSelection().toString().trim())bubble.hidden=true},150);return}picked=t.slice(0,500);const r=s.getRangeAt(0).getBoundingClientRect(),box=root.getBoundingClientRect();bubble.hidden=false;bubble.style.left=Math.max(8,r.left-box.left+r.width/2-70)+'px';bubble.style.top=Math.max(8,r.top-box.top-44)+'px'});
 cBtn.addEventListener('mousedown',e=>e.preventDefault());aBtn.addEventListener('mousedown',e=>e.preventDefault());
 cBtn.addEventListener('click',async()=>{bubble.hidden=true;const text=await promptDialog({title:'Comment',message:'On: “'+picked.slice(0,120)+(picked.length>120?'…':'')+'”',confirm:'Add comment',input:{label:'Your comment',max:400}});if(!text?.trim())return;comments.push({quote:picked,text:text.trim(),time:Date.now()});await ctx.saveComments(comments);paintComments()});
 aBtn.addEventListener('click',()=>{bubble.hidden=true;ctx.ask('In '+ctx.title()+', about this part: “'+picked+'”\n')});
 function paintComments(){cbar.hidden=!comments.length;cbar.replaceChildren();if(!comments.length)return;const head=el('div','doc-comments-head');head.append(el('strong','',comments.length+(comments.length===1?' comment':' comments')));
  const send=el('button','primary','Send to AI');send.type='button';send.addEventListener('click',async()=>{ctx.send('Please address these comments on '+ctx.title()+', then remove nothing else:\n'+comments.map((c,i)=>(i+1)+'. On “'+c.quote+'”: '+c.text).join('\n'));comments=[];await ctx.saveComments(comments);paintComments()});head.append(send);cbar.append(head);
  comments.forEach((c,i)=>{const row=el('div','doc-comment');const q=el('q','',c.quote.slice(0,140));const t=el('p','',c.text);const x=el('button','link-button','Resolve');x.type='button';x.addEventListener('click',async()=>{comments.splice(i,1);await ctx.saveComments(comments);paintComments()});row.append(q,t,x);cbar.append(row)})}

 return {set(text,{previous,notes}={}){if(editing)return;before=previous??null;comments=notes||comments;md=text;blocks=parse(md);render()},
  markdown:()=>md}}
