// Usage, Connections and Backlog pages: apply the light/dark choice saved by the workspace before the page paints,
// and follow it live when it changes in another tab.
const apply=dark=>document.documentElement.classList.toggle('dark',dark);
try{for(const k of Object.keys(localStorage))if(k.startsWith('el'+'kiya')){const n='aq'+k.slice(6);if(localStorage.getItem(n)===null)localStorage.setItem(n,localStorage.getItem(k));localStorage.removeItem(k)}}catch{}
try{apply(localStorage.getItem('aq-dark')==='true')}catch{}
addEventListener('storage',e=>{if(e.key==='aq-dark')apply(e.newValue==='true')});
