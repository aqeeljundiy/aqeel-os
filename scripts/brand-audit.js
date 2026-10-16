// Brand audit, run inside the page (scripts/shot.mjs passes it as the "js" argument via a file read).
// Checks: WCAG AA contrast of visible text, keyboard focus style, motion timings, eyebrow pill,
// empty-state gradient and horizontal overflow. Returns a JSON summary.
(async()=>{
 const w=ms=>new Promise(r=>setTimeout(r,ms));await w(2500);
 const lum=c=>{const m=c.match(/[\d.]+/g);if(!m)return null;const [r,g,b]=m.slice(0,3).map(v=>{v=v/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*r+0.7152*g+0.0722*b};
 const alpha=c=>{const m=c.match(/[\d.]+/g);return m&&m.length>3?+m[3]:1};
 const bgOf=el=>{for(let e=el;e;e=e.parentElement){const b=getComputedStyle(e).backgroundColor;if(alpha(b)>0.9)return b;if(getComputedStyle(e).backgroundImage!=='none')return null}return getComputedStyle(document.body).backgroundColor};
 const bad=[];const seen=new Set();
 for(const el of document.querySelectorAll('body *')){if(!el.childNodes.length||![...el.childNodes].some(n=>n.nodeType===3&&n.nodeValue.trim()))continue;
  const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity<0.5)continue;const r=el.getBoundingClientRect();if(!r.width||r.bottom<0||r.top>innerHeight*3)continue;
  if(el.closest('[disabled],.locked,.skel,[aria-hidden="true"]'))continue;
  const bg=bgOf(el);if(!bg)continue;const a=lum(cs.color),b=lum(bg);if(a==null||b==null)continue;const ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  const big=parseFloat(cs.fontSize)>=18.66||(parseFloat(cs.fontSize)>=14&&+cs.fontWeight>=700);
  if(ratio<(big?3:4.5)){const k=cs.color+'|'+bg+'|'+el.className;if(seen.has(k))continue;seen.add(k);bad.push({text:el.textContent.trim().slice(0,40),cls:String(el.className).slice(0,40),color:cs.color,bg,ratio:+ratio.toFixed(2)})}}
 // keyboard focus: first focusable element
 const f=document.querySelector('.view button, .view a, .side button, .side a');let focus=null;
 if(f){f.focus();const cs=getComputedStyle(f);focus={outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,shadow:cs.boxShadow.slice(0,60)}}
 const root=getComputedStyle(document.documentElement);
 const motion={fast:root.getPropertyValue('--t-fast').trim(),med:root.getPropertyValue('--t-med').trim(),ease:root.getPropertyValue('--ease').trim().slice(0,40)};
 const eyebrow=!!document.querySelector('.page .eyebrow, .page .pill-eyebrow, .page-head .chip, .page .head .chip, .page [class*="eyebrow"]');
 const empty=[...document.querySelectorAll('.empty-hero,.empty,.chat-empty')].map(e=>getComputedStyle(e).backgroundImage.slice(0,30));
 const over=document.documentElement.scrollWidth>innerWidth+1?[...document.querySelectorAll('.view *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,4).map(e=>String(e.className||e.tagName).slice(0,40)):[];
 return JSON.stringify({page:location.hash,contrast:bad.slice(0,8),contrastCount:bad.length,focus,motion,eyebrow,empty,overflow:over})
})()
