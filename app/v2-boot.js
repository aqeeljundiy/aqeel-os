// /v2 only, before first paint (inline scripts are blocked by the CSP): marks the page as v2, and light or dark follows the
// device until the person picks one with the moon button (13 Nov 2026: on / the app stays light unless dark was picked).
(function(){var d=document.documentElement;d.classList.add('v2');
 var s=(location.hash.replace(/^#\/?/,'').split(/[\/?]/)[0])||'chat';d.setAttribute('data-v2sec',s);
 try{var t=localStorage.getItem('hui-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))d.classList.add('dark')}catch(e){}})();
