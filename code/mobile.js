// Phone layout: one screen at a time (Projects · Chat · Workspace) with a bottom tab bar,
// the top bar keeps its icon buttons. Desktop layout is untouched.
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};

export function setupMobile(ctx){
 const query=matchMedia('(max-width: 850px)'),studio=document.getElementById('studio');
 const nav=el('nav','mobile-nav');nav.setAttribute('aria-label','Screens');const views=[['chats','Projects'],['chat','Chat'],['work','Workspace']];
 const buttons={};for(const [key,label] of views){const b=el('button','',label);b.type='button';b.dataset.screen=key;b.addEventListener('click',()=>show(key));const badge=el('span','mobile-badge');badge.hidden=true;b.append(badge);buttons[key]=b;nav.append(b)}
 document.body.append(nav);
 let screen='chat';
 function show(key){screen=key;studio.dataset.screen=key;for(const [k,b] of Object.entries(buttons)){b.classList.toggle('active',k===key);b.setAttribute('aria-current',k===key?'page':'false')}if(key==='chat')buttons.chat.querySelector('.mobile-badge').hidden=true;scrollTo(0,0)}
 function apply(){document.body.classList.toggle('is-mobile',query.matches);if(query.matches)show(screen)}
 query.addEventListener('change',apply);
 // some embedded views skip media-query change events; re-check on resize when the mode no longer matches
 addEventListener('resize',()=>{if(document.body.classList.contains('is-mobile')!==query.matches)apply()});apply();
 return {
  openedChat:()=>{if(query.matches)show('chat')},
  attention:text=>{if(query.matches&&screen!=='chat'){const b=buttons.chat.querySelector('.mobile-badge');b.textContent=text||'!';b.hidden=false}},
  showWork:()=>{if(query.matches)show('work')},
 };
}
