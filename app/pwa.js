// Registers the minimal service worker (public/sw.js is served by the server and carries the build id: a new deploy is a new
// worker, it caches nothing, and it replaces the old one at once). Chrome on Android wants one before it offers Install.
try{if('serviceWorker' in navigator&&location.protocol==='https:'||location.hostname==='localhost')navigator.serviceWorker.register('/sw.js',{scope:'/'}).then(r=>r.update()).catch(()=>{})}catch{}
