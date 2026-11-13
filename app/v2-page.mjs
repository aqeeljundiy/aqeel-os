// /v2 (owner, 13 Nov 2026: "Make a /v2 for aqeelOS now"): the same app page as /, with the v2 layer on top. / is never
// changed by this; /v2 only adds app/v2-boot.js (before first paint, instead of theme-boot.js), app/v2.css (after the
// app's own styles) and app/v2.js (after the app's scripts, before boot.js). docs/v1-checklist.md lists what must stay.
export const isV2=p=>p==='/v2'||p==='/v2/';
export function v2Html(html){
 const out=html
  .replace('<script src="/app/theme-boot.js"></script>','<script src="/app/v2-boot.js"></script>')
  .replace('<link rel="stylesheet" href="/app/pwa.css">','<link rel="stylesheet" href="/app/pwa.css">\n<link rel="stylesheet" href="/app/v2.css">')
  .replace('<script src="/app/boot.js"></script>','<script src="/app/v2.js"></script>\n<script src="/app/boot.js"></script>');
 // a changed index.html that no longer has these anchors would quietly serve v1 under /v2: say so instead
 if(!out.includes('/app/v2-boot.js')||!out.includes('/app/v2.css')||!out.includes('/app/v2.js'))throw new Error('v2Html: app/index.html no longer has the lines /v2 builds on');
 return out}
// The app page as served for any address (moved verbatim from app/server.mjs, 13 Nov 2026): Cloudflare makes browsers keep
// .js/.css for hours, so every start gets fresh file addresses (?v=BUILD); /v2 gets the v2 layer first.
export const appPage=(page,p,BUILD)=>(isV2(p)?v2Html(page):page).replace(/(\.(?:js|css))"/g,`$1?v=${BUILD}"`).replace('<meta charset="utf-8">',`<meta charset="utf-8"><meta name="build" content="${BUILD}">`);
