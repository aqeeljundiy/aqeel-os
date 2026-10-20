// Phase 0 mockup only: switch screens, kinds and light/dark. Nothing else is wired up.
const body=document.body,html=document.documentElement;
try{html.classList.toggle('dark',localStorage.getItem('elkiya-dark')==='true')}catch{}
const go=screen=>{body.dataset.screen=screen;for(const b of document.querySelectorAll('[data-go]'))b.classList.toggle('on',b.dataset.go===screen);try{history.replaceState(null,'','#'+screen)}catch{}};
for(const b of document.querySelectorAll('[data-go]'))b.addEventListener('click',()=>go(b.dataset.go));
if(['start','deck','doc'].includes(location.hash.slice(1)))go(location.hash.slice(1));
document.getElementById('theme-toggle').addEventListener('click',()=>html.classList.toggle('dark'));
for(const k of document.querySelectorAll('.m-kind'))k.addEventListener('click',()=>{for(const o of document.querySelectorAll('.m-kind')){o.classList.toggle('on',o===k);o.setAttribute('aria-checked',String(o===k))}});
for(const t of document.querySelectorAll('.m-template'))t.addEventListener('click',()=>{for(const o of document.querySelectorAll('.m-template'))o.classList.toggle('on',o===t)});
