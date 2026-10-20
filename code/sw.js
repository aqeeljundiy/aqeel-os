// Present only so browsers treat code by aqeel as an installable app. It deliberately has no fetch handler:
// every request goes straight to the local server (live runs, long-polling and previews are never cached).
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
