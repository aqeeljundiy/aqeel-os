// The "Your aqeelOS address" screen: first launch, and Change aqeelOS address later. The app checks the address
// (aqSetup.check), then saves it and opens that aqeelOS (aqSetup.use). Every change fades in and out.
const $=id=>document.getElementById(id);
const card=$('card'),form=$('form'),input=$('url'),note=$('note'),go=$('go'),goLabel=$('go-label'),cancel=$('cancel');
let checked=null;   // the last good check, so "Use it anyway" (no https) does not check twice
const say=(text,kind)=>{note.className='note'+(text?' show '+(kind||''):'');if(text)note.textContent=text;input.setAttribute('aria-invalid',kind==='bad'?'true':'false')};
const busy=on=>{go.classList.toggle('busy',on);go.disabled=on;input.readOnly=on};
const swap=(el,text)=>{if(el.textContent===text)return;el.style.opacity='0';setTimeout(()=>{el.textContent=text;el.style.opacity='1'},150)};
function showBrand(b){if(!b)return;swap($('name'),b.name||'aqeelOS');
 if(b.logo){const img=new Image();img.alt='';img.onload=()=>{const m=document.querySelector('#brand svg,#brand img');m.replaceWith(img)};img.src=b.logo}}

input.addEventListener('input',()=>{checked=null;goLabel.textContent='Continue';say('')});
cancel.addEventListener('click',()=>leave(()=>window.aqSetup.cancel()));
form.addEventListener('submit',async e=>{e.preventDefault();if(go.disabled)return;
 if(checked&&checked.url&&!checked.https)return use(checked);
 busy(true);say('');let r;try{r=await window.aqSetup.check(input.value)}catch(er){r={ok:false,why:'The check did not finish. Try again.'}}busy(false);
 if(!r.ok){say(r.why,'bad');input.focus();return}
 input.value=r.url;checked=r;showBrand(r.brand);
 if(!r.https&&r.why){say(r.why,'warn');goLabel.textContent='Use it anyway';return}
 use(r)});

async function use(r){busy(true);const name=(r.brand&&r.brand.name)||'aqeelOS';
 // a short confirmation, then the screen fades out before aqeelOS opens
 setTimeout(()=>leave(async()=>{const res=await window.aqSetup.use(r.url);if(res&&res.error){busy(false);card.classList.remove('out');card.classList.add('in');say(res.error,'bad')}}),420);
 goLabel.textContent='Opening '+name}
function leave(then){card.classList.remove('in');card.classList.add('out');setTimeout(then,200)}

(async()=>{let s={};try{s=await window.aqSetup.state()}catch{}
 if(s.current){input.value=s.current;cancel.hidden=false;$('title').textContent='Change your aqeelOS address';$('lead').textContent='This app opens the aqeelOS at this address. A new address signs Code out of the old one.';$('foot').textContent='Projects and chats on this computer stay as they are.';showBrand(s.brand)}
 if(s.why)say(s.why,'bad');
 requestAnimationFrame(()=>requestAnimationFrame(()=>card.classList.add('in')));input.focus();if(s.current)input.select()})();
