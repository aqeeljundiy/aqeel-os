// Small Markdown parser shared by the document editor (browser) and the exports (DOCX, PDF).
// Blocks: headings, paragraphs, lists, tables, quotes, code, rules, each with its source line range (start, end)
// so the editor can rewrite just the block you changed. Inline: **bold**, *italic*, `code`, [links](url), [n] citations.
export function inline(text){const out=[],re=/\*\*([^*]+)\*\*|\*([^*\s][^*]*?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\[(\d{1,3})\](?!\()/g;let last=0,m;
 while((m=re.exec(text))){if(m.index>last)out.push({text:text.slice(last,m.index)});
  if(m[1])out.push({text:m[1],bold:true});else if(m[2])out.push({text:m[2],italic:true});else if(m[3])out.push({text:m[3],code:true});else if(m[6])out.push({text:m[6],cite:Number(m[6])});else out.push({text:m[4],link:/^(https?:|mailto:)/.test(m[5])?m[5]:null});last=re.lastIndex}
 if(last<text.length)out.push({text:text.slice(last)});return out}
const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
const LIST=/^\s*([-*+]|\d+[.)])\s+/;
export function parse(md){const lines=String(md||'').replace(/\r/g,'').split('\n'),blocks=[];let i=0;
 while(i<lines.length){const line=lines[i],start=i;
  if(!line.trim()){i++;continue}
  if(/^```/.test(line)){const body=[];i++;while(i<lines.length&&!/^```/.test(lines[i]))body.push(lines[i++]);i++;blocks.push({type:'code',text:body.join('\n'),start,end:i});continue}
  let m=line.match(/^(#{1,6})\s+(.*)$/);if(m){blocks.push({type:'h',level:m[1].length,text:m[2].trim(),start,end:++i});continue}
  if(/^(-{3,}|\*{3,})\s*$/.test(line)){blocks.push({type:'hr',start,end:++i});continue}
  if(/^\s*\|/.test(line)&&i+1<lines.length&&/^\s*\|?\s*:?-{2,}/.test(lines[i+1])){const head=cells(line),rows=[];i+=2;while(i<lines.length&&/^\s*\|/.test(lines[i]))rows.push(cells(lines[i++]));blocks.push({type:'table',head,rows,start,end:i});continue}
  if(/^>\s?/.test(line)){const body=[];while(i<lines.length&&/^>\s?/.test(lines[i]))body.push(lines[i++].replace(/^>\s?/,''));blocks.push({type:'quote',text:body.join(' '),start,end:i});continue}
  m=line.match(LIST);if(m){const ordered=/\d/.test(m[1]),items=[],at=[];while(i<lines.length&&LIST.test(lines[i])){at.push(i);items.push(lines[i++].replace(LIST,''))}blocks.push({type:ordered?'ol':'ul',items,at,start,end:i});continue}
  const body=[];while(i<lines.length&&lines[i].trim()&&!/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s+|\s*\|)/.test(lines[i]))body.push(lines[i++].trim());blocks.push({type:'p',text:body.join(' '),start,end:i})}
 return blocks}
// the Markdown source of a block, as you edit it
export function source(b){return b.type==='h'?'#'.repeat(b.level)+' '+b.text:b.type==='quote'?'> '+b.text:b.text}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const spans=t=>inline(t).map(s=>{let h=esc(s.text);if(s.cite)return '<sup>['+s.cite+']</sup>';if(s.code)h='<code>'+h+'</code>';if(s.bold)h='<strong>'+h+'</strong>';if(s.italic)h='<em>'+h+'</em>';if(s.link)h='<a href="'+esc(s.link)+'">'+h+'</a>';return h}).join('');
// escaped HTML for printing
export function toHtml(md){return parse(md).map(b=>b.type==='h'?`<h${b.level}>${spans(b.text)}</h${b.level}>`:b.type==='p'?`<p>${spans(b.text)}</p>`:b.type==='ul'||b.type==='ol'?`<${b.type}>${b.items.map(t=>`<li>${spans(t)}</li>`).join('')}</${b.type}>`:b.type==='quote'?`<blockquote>${spans(b.text)}</blockquote>`:b.type==='code'?`<pre><code>${esc(b.text)}</code></pre>`:b.type==='hr'?'<hr>':`<table><thead><tr>${b.head.map(h=>`<th>${spans(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r=>`<tr>${r.map(c=>`<td>${spans(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('\n')}
