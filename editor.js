// Code editor: syntax colouring layered under the existing textarea (typing, selection and undo stay native),
// plus find (Ctrl+F) and go to line (Ctrl+G).
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};

// Token rules per language: [className, regex] — first match wins at each position.
const RULES={
 js:[['c',/\/\/[^\n]*|\/\*[\s\S]*?\*\//y],['s',/`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y],['k',/\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|this|null|undefined|true|false)\b/y],['n',/\b\d+(?:\.\d+)?\b/y],['f',/\b[A-Za-z_$][\w$]*(?=\()/y]],
 css:[['c',/\/\*[\s\S]*?\*\//y],['s',/"[^"\n]*"|'[^'\n]*'/y],['k',/@[\w-]+/y],['p',/[\w-]+(?=\s*:)/y],['n',/#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|deg|fr)?\b/y],['f',/[.#][\w-]+/y]],
 html:[['c',/<!--[\s\S]*?-->/y],['k',/<\/?[\w-]+|\/?>/y],['p',/\b[\w-]+(?==)/y],['s',/"[^"]*"|'[^']*'/y]],
 json:[['p',/"(?:\\.|[^"\\])*"(?=\s*:)/y],['s',/"(?:\\.|[^"\\])*"/y],['n',/-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/y],['k',/\b(?:true|false|null)\b/y]],
 md:[['k',/^#{1,6} [^\n]*/my],['s',/`[^`\n]+`/y],['p',/\*\*[^*\n]+\*\*|__[^_\n]+__/y],['f',/\[[^\]\n]+\]\([^)\n]+\)/y]],
};
const LANG={'.js':'js','.mjs':'js','.cjs':'js','.jsx':'js','.ts':'js','.tsx':'js','.css':'css','.scss':'css','.less':'css','.html':'html','.astro':'html','.vue':'html','.svelte':'html','.svg':'html','.xml':'html','.json':'json','.md':'md'};
export const languageOf=name=>LANG[(name.match(/\.[^.]+$/)||[''])[0].toLowerCase()]||null;

export function tokenize(text,lang){const rules=RULES[lang];if(!rules)return [['',text]];const out=[];let i=0,plain='';
 while(i<text.length){let hit=null;for(const [cls,re] of rules){re.lastIndex=i;const m=re.exec(text);if(m&&m.index===i&&m[0].length){hit=[cls,m[0]];break}}
  if(hit){if(plain){out.push(['',plain]);plain=''}out.push(hit);i+=hit[1].length}else{plain+=text[i++]}}
 if(plain)out.push(['',plain]);return out}

export function createEditor(textarea,{name=()=>'',notify=()=>{}}={}){
 const wrap=el('div','code-wrap');const hl=el('pre','code-hl');hl.setAttribute('aria-hidden','true');const gutter=el('pre','code-gutter');gutter.setAttribute('aria-hidden','true');textarea.before(wrap);wrap.append(gutter,hl,textarea);let lines=0;textarea.classList.add('code-input');
 let frame=0;const paint=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const lang=languageOf(name());const text=textarea.value;{const n=text.split('\n').length;if(n!==lines){lines=n;gutter.textContent=Array.from({length:n},(_,i)=>i+1).join('\n')+'\n'}}
  if(!lang||text.length>200000){hl.textContent=text+'\n';wrap.classList.toggle('plain',true);return}wrap.classList.remove('plain');
  hl.replaceChildren(...tokenize(text,lang).map(([cls,t])=>cls?el('span','t-'+cls,t):document.createTextNode(t)),document.createTextNode('\n'));sync()})};
 const sync=()=>{hl.scrollTop=gutter.scrollTop=textarea.scrollTop;hl.scrollLeft=textarea.scrollLeft};
 textarea.addEventListener('input',paint);textarea.addEventListener('scroll',sync);
 // find bar
 const bar=el('div','find-bar');bar.hidden=true;const q=el('input','find-input');q.placeholder='Find';q.setAttribute('aria-label','Find in file');const count=el('span','find-count');const prev=el('button','','↑');prev.type='button';prev.setAttribute('aria-label','Previous match');const next=el('button','','↓');next.type='button';next.setAttribute('aria-label','Next match');const x=el('button','','×');x.type='button';x.setAttribute('aria-label','Close find');
 bar.append(q,count,prev,next,x);wrap.before(bar);
 const find=dir=>{const term=q.value;if(!term){count.textContent='';return}const text=textarea.value.toLowerCase(),t=term.toLowerCase();const all=[];for(let i=text.indexOf(t);i>=0;i=text.indexOf(t,i+1))all.push(i);
  if(!all.length){count.textContent='No matches';return}const from=dir<0?textarea.selectionStart-1:textarea.selectionEnd;let idx=dir<0?[...all].reverse().find(i=>i<=from):all.find(i=>i>=from);if(idx===undefined)idx=dir<0?all.at(-1):all[0];
  textarea.focus();textarea.setSelectionRange(idx,idx+term.length);const line=textarea.value.slice(0,idx).split('\n').length;textarea.scrollTop=Math.max(0,(line-5)*parseFloat(getComputedStyle(textarea).lineHeight));count.textContent=(all.indexOf(idx)+1)+' of '+all.length;q.focus()};
 q.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();find(e.shiftKey?-1:1)}else if(e.key==='Escape'){e.preventDefault();bar.hidden=true;textarea.focus()}});
 next.onclick=()=>find(1);prev.onclick=()=>find(-1);x.onclick=()=>{bar.hidden=true;textarea.focus()};
 textarea.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey))return;const k=e.key.toLowerCase();
  if(k==='f'){e.preventDefault();bar.hidden=false;const sel=textarea.value.slice(textarea.selectionStart,textarea.selectionEnd);if(sel&&!sel.includes('\n'))q.value=sel;q.focus();q.select()}
  else if(k==='g'){e.preventDefault();const n=Number(prompt('Go to line'));if(n){goto(n);notify('Line '+Math.min(n,textarea.value.split('\n').length))}}});
 // select the start of line n and scroll it into view
 function goto(n){const lines=textarea.value.split('\n');n=Math.max(1,Math.min(n,lines.length));const at=lines.slice(0,n-1).join('\n').length+(n>1?1:0);textarea.focus();textarea.setSelectionRange(at,at+lines[n-1].length);textarea.scrollTop=Math.max(0,(n-5)*parseFloat(getComputedStyle(textarea).lineHeight));paint?.()}
 return {refresh:paint,goto};
}
