// The layer aqeelOS draws over the agent's tab: a glow round the page while the agent works, a pill saying what it
// is doing (with Stop and Take over), and a cursor with the agent's name that moves to each thing before it is
// clicked or typed in. It lives in a closed shadow root, so the page's own styles and scripts cannot reach it.
(()=>{if(window.__aq)return;
// Plus Jakarta Sans from the extension, under its own name so the page's fonts are untouched (loaded as bytes, so the page's rules can't block it)
try{fetch(chrome.runtime.getURL('plus-jakarta-sans.woff2')).then(r=>r.arrayBuffer()).then(b=>new FontFace('aqeelOS Jakarta',b,{weight:'200 800'}).load()).then(f=>document.fonts.add(f)).catch(()=>{})}catch{}
// the digits 0-9 in Google Sans Flex, same family and weights, so only numbers change
try{fetch(chrome.runtime.getURL('google-sans-flex-digits.woff2')).then(r=>r.arrayBuffer()).then(b=>new FontFace('aqeelOS Jakarta',b,{weight:'200 800',unicodeRange:'U+30-39'}).load()).then(f=>document.fonts.add(f)).catch(()=>{})}catch{}
const host=document.createElement('aqeelos-layer');host.style.cssText='all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
const root=host.attachShadow({mode:'closed'});
root.innerHTML=`<style>
:host{all:initial}
*{box-sizing:border-box;font-family:"aqeelOS Jakarta","Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif}
.glow{position:fixed;inset:0;pointer-events:none;opacity:0;transition:opacity .35s ease,box-shadow .35s ease}
.on .glow{opacity:1}
.work .glow{box-shadow:inset 0 0 0 3px rgba(37,99,235,.55),inset 0 0 44px rgba(37,99,235,.18);animation:breathe 2.4s ease-in-out infinite}
.need .glow{box-shadow:inset 0 0 0 3px rgba(217,119,6,.7),inset 0 0 44px rgba(217,119,6,.16)}
.fail .glow{box-shadow:inset 0 0 0 3px rgba(220,38,38,.65),inset 0 0 44px rgba(220,38,38,.14)}
.control .glow{box-shadow:inset 0 0 0 2px rgba(17,17,17,.25)}
@keyframes breathe{50%{box-shadow:inset 0 0 0 3px rgba(37,99,235,.25),inset 0 0 26px rgba(37,99,235,.07)}}
.pill{position:fixed;left:50%;bottom:20px;transform:translate(-50%,16px);opacity:0;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);
 background:#111;color:#fff;border-radius:999px;padding:7px 8px 7px 14px;font-size:13px;line-height:1.3;box-shadow:0 12px 34px -12px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08);
 transition:opacity .3s ease,transform .3s cubic-bezier(.2,.8,.2,1);pointer-events:auto}
.on .pill{opacity:1;transform:translate(-50%,0)}
.pill .ic{flex:none;width:12px;height:12px;border-radius:50%}
.work .pill .ic{border:2px solid rgba(255,255,255,.3);border-top-color:#fff;animation:spin .8s linear infinite}
.need .pill .ic{background:#fbbf24}.idle-soon .pill .ic{background:#9ca3af}.fail .pill .ic{background:#f87171}.control .pill .ic{background:#9ca3af}
@keyframes spin{to{transform:rotate(360deg)}}
.pill .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pill .ch{flex:0 1 auto;min-width:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,.55);font-size:12px;padding-left:10px;border-left:1px solid rgba(255,255,255,.18)}.pill .ch:empty{display:none}
.pill button{flex:none;border:0;border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:600;cursor:pointer;background:rgba(255,255,255,.14);color:#fff;transition:background .15s}
.pill button:hover{background:rgba(255,255,255,.24)}
.pill button.w{background:#fff;color:#111}.pill button.w:hover{background:#e8e8e8}
.cur{position:fixed;left:0;top:0;width:22px;height:22px;opacity:0;transition:transform .5s cubic-bezier(.4,0,.2,1),opacity .3s;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));will-change:transform}
.on.work .cur.seen{opacity:1}
.cur span{position:absolute;left:17px;top:18px;background:#2563eb;color:#fff;font-size:11px;font-weight:600;border-radius:999px;padding:2px 8px;white-space:nowrap}
.box{position:fixed;border-radius:8px;outline:2px solid rgba(37,99,235,.75);outline-offset:3px;opacity:0;transition:opacity .25s;pointer-events:none}
.box.show{opacity:1}
.rip{position:fixed;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;border:2px solid #2563eb;animation:rip .6s ease-out forwards;pointer-events:none}
@keyframes rip{to{transform:scale(4.6);opacity:0}}
@media (max-width:480px){.pill .ch{display:none}}
@media (prefers-reduced-motion:reduce){.cur{transition:opacity .2s}.work .glow{animation:none}}
</style><div class="w"><div class="glow"></div><div class="box"></div>
<div class="cur"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l16 9.5-7 1.6-3.6 6.6z" fill="#2563eb" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span></span></div>
<div class="pill" role="status" aria-live="polite"><span class="ic"></span><span class="t"></span><span class="ch" title="The chat this is for"></span></div></div>`;
const W=root.querySelector('.w'),pill=root.querySelector('.pill'),txt=root.querySelector('.t'),cur=root.querySelector('.cur'),box=root.querySelector('.box');
const attach=()=>{if(!host.isConnected)(document.body||document.documentElement).appendChild(host)};
let pos=null,boxT=null;
const BUTTONS={work:[['takeover','Take over'],['stop','Stop',1]],need:[['takeover','I’ll do it'],['continue','Done, continue',1]],fail:[['takeover','I’ll do it'],['dismiss','OK',1]],control:[['handback','Hand back',1]]};
function set(s){attach();window.__aq.mode=s.mode;W.className='w '+(s.mode==='idle'?'':'on '+s.mode);txt.textContent=s.text||'';root.querySelector('.ch').textContent=s.chat||'';cur.querySelector('span').textContent=s.agent||'aqeelOS';
 pill.querySelectorAll('button').forEach(b=>b.remove());
 for(const [id,label,white] of BUTTONS[s.mode]||[]){const b=document.createElement('button');b.textContent=label;if(white)b.className='w';
  b.onclick=e=>{e.stopPropagation();chrome.runtime.sendMessage({aq:id})};pill.appendChild(b)}
 if(!pos){pos={x:innerWidth/2,y:innerHeight-80};cur.style.transform=`translate(${pos.x}px,${pos.y}px)`}}
// glide to the element, outline it, then the caller acts; a ripple marks a click
function move(r,click){attach();const x=Math.max(4,Math.min(innerWidth-30,r.left+Math.min(r.width/2,24))),y=Math.max(4,Math.min(innerHeight-30,r.top+r.height/2));
 cur.classList.add('seen');cur.style.transform=`translate(${x}px,${y}px)`;pos={x,y};
 Object.assign(box.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
 return new Promise(ok=>setTimeout(()=>{box.classList.add('show');clearTimeout(boxT);boxT=setTimeout(()=>box.classList.remove('show'),900);
  if(click){const p=document.createElement('div');p.className='rip';p.style.left=x+'px';p.style.top=y+'px';W.appendChild(p);setTimeout(()=>p.remove(),700)}
  setTimeout(ok,120)},matchMedia('(prefers-reduced-motion:reduce)').matches?60:520))}
window.__aq={set,move};
chrome.runtime.sendMessage({aq:'ready'}).catch(()=>{});
})();
