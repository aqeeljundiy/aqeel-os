// UI check for the open page (served at /ui-check.js for the audits; also paste-able into the console). Call uiCheck(scope?).
// Lists icon-only buttons whose icon is off-centre, buttons whose text is cut off, unnamed buttons, controls clipped by
// their container, and pages that scroll sideways. An empty list means the visible screen passes.
window.uiCheck=(scope=document)=>{const out=[],visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth};
 const name=e=>(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\s+/).slice(0,2).join('.'):'')+' "'+(e.getAttribute('aria-label')||e.title||e.textContent||'').trim().slice(0,30)+'"';
 for(const b of scope.querySelectorAll('button,a,[role=button],.dd-btn')){if(!visible(b))continue;const r=b.getBoundingClientRect();
  const icon=b.querySelector(':scope > svg'),text=[...b.childNodes].some(n=>n.nodeType===3&&n.data.trim())||b.querySelector(':scope > span:not(:empty):not(.sr-only)');
  if(icon&&!text){const s=icon.getBoundingClientRect(),dx=s.left+s.width/2-(r.left+r.width/2),dy=s.top+s.height/2-(r.top+r.height/2);if(Math.abs(dx)>1.2||Math.abs(dy)>1.2)out.push('off-centre '+dx.toFixed(1)+','+dy.toFixed(1)+' '+name(b))}
  if(text&&b.scrollWidth>b.clientWidth+2&&getComputedStyle(b).textOverflow!=='ellipsis'&&!b.querySelector('.dd-val,.chat-title'))out.push('text cut '+b.scrollWidth+'>'+b.clientWidth+' '+name(b));
  if(!b.textContent.trim()&&!b.getAttribute('aria-label')&&!b.title)out.push('no name '+name(b));
  for(let p=b.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(/hidden|clip|auto|scroll/.test(s.overflowX+s.overflowY)){if(/hidden|clip/.test(s.overflowX+s.overflowY)){const q=p.getBoundingClientRect();if(r.left<q.left-1||r.right>q.right+1||r.top<q.top-1||r.bottom>q.bottom+1)out.push('clipped by '+name(p)+': '+name(b))}break}}}
 if(document.documentElement.scrollWidth>innerWidth+1)out.push('page scrolls sideways');return [...new Set(out)]};
