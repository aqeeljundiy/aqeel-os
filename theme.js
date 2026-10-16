// Usage, Connections and Backlog pages: apply the light/dark choice saved by the workspace before the page paints,
// and follow it live when it changes in another tab.
const apply=dark=>document.documentElement.classList.toggle('dark',dark);
try{apply(localStorage.getItem('elkiya-dark')==='true')}catch{}
addEventListener('storage',e=>{if(e.key==='elkiya-dark')apply(e.newValue==='true')});
