// Applies the saved light/dark choice before first paint (inline scripts are blocked by the CSP).
try{if(localStorage.getItem('hui-theme')==='dark')document.documentElement.classList.add('dark')}catch{}
