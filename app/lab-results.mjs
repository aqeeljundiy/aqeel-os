// Lab results (COA) for a customer chat without a browser (AU-36, 21 Nov 2026). Randy's rule said "open the lab results page in the
// browser", but customer chats have no browser, so every COA request was handed to the team. The line's lab results page is public and
// drawn on the server: aqeelOS reads it, and the tool lab_results gives the latest reports for a product (batch, purity, test date and the
// report's own link). Line setting kirimdev lines.<agent>.labResults = {url: "https://…/lab-results"}.
export const CACHE_MS=15*60e3,MAX_BYTES=4e6;
const text=h=>String(h||'').replace(/<!--.*?-->/gs,'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#x27;|&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
// every report card on the page: {product, code, batch, purity, date, path}
export function parseLabResults(html){const out=[];
 for(const m of String(html||'').matchAll(/<a[^>]*class="[^"]*librarycard[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)){const body=m[2];
  const product=text((/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(body)||[])[1]);const code=text((/<p class="mini">([\s\S]*?)<\/p>/.exec(body)||[])[1]).split('·')[0].trim();
  const line=label=>{const r=new RegExp('<span>'+label+'</span>\\s*<(?:strong|span)[^>]*>([\\s\\S]*?)</(?:strong|span)>','i').exec(body);return r?text(r[1]):''};
  const batch=line('Batch / lot'),purity=line('Kemurnian')||line('Purity'),date=line('Tanggal analisis')||line('Analysis date');
  if(product&&batch)out.push({product,code,batch,purity,date,path:m[1]})}
 return out}
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const tokens=s=>String(s||'').toLowerCase().match(/[a-z]+|\d+/g)||[];
// the reports for a product the customer named ("reta 10", "Retatrutide 10mg", "RT10"), newest first; no product: the newest of each
export function pick(list,query,{max=5}={}){const t=Date.parse,byDate=(a,b)=>(t(b.date)||0)-(t(a.date)||0);
 const q=tokens(query);if(!q.length){const seen=new Set();return [...list].sort(byDate).filter(r=>!seen.has(r.code||r.product)&&seen.add(r.code||r.product)).slice(0,12)}
 return list.filter(r=>{const hay=norm(r.product+' '+r.code);return q.every(w=>hay.includes(w))}).sort(byDate).slice(0,max)}
export function createLabResults({fetchFn=(...a)=>fetch(...a),now=()=>Date.now()}={}){const cache=new Map();
 async function read(url){const c=cache.get(url);if(c&&now()-c.at<CACHE_MS)return c.list;
  const r=await fetchFn(url,{redirect:'follow',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('the lab results page answered '+r.status);
  const html=(await r.text()).slice(0,MAX_BYTES),list=parseLabResults(html);if(!list.length)throw new Error('no reports found on the lab results page');
  cache.set(url,{at:now(),list});return list}
 // what the tool answers: each report with its own link on the line's address (the page's link is relative)
 async function lookup(cfg,query){const url=String(cfg?.url||'');if(!/^https:\/\//.test(url))throw new Error('This line has no lab results page set.');
  const found=pick(await read(url),query);
  return found.map(r=>({product:r.product,code:r.code,batch:r.batch,purity:r.purity,date:r.date,link:new URL(r.path,url).href}))}
 return {lookup,read}}
