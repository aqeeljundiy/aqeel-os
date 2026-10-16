// UI language. Feature code keeps writing English; for another language this swaps exact UI strings on screen
// (text, title, placeholder, aria-label, alt) as they render, using the lang-<code>.js dictionary.
// User content (chat messages, code, file contents, terminal output) is never touched.
const KEY='cba-lang',ATTRS=['title','placeholder','aria-label','alt'];
const SKIP='pre,code,script,style,.message .body,.message .md,.msg-doc,.xterm,.editor-area,[data-no-translate],[contenteditable="true"],.slide,.art-paper,.doc-paper,.doc-outline,.chat-title,.output-row,.art-compare-pane,.art-chart-card input,.art-switch,.art-media figcaption,.next-recap,.art-switch strong,.msg-outputs,.dk-thumb,.ds-meta strong,.dv-grid tbody,.dv-h,.dv-tab,.dv-groups,.cv-layer span,.cv-head strong,.doc-src-t,.search-result strong,.search-snippet,.doc-sugg del,.doc-sugg ins,.art-chart-card textarea,.doc-paper,.cv-text';
export const LANGUAGES=[['en','English'],['id','Bahasa Indonesia']];
export function lang(){try{const v=localStorage.getItem(KEY);return LANGUAGES.some(([c])=>c===v)?v:'en'}catch{return 'en'}}
export function setLang(code){try{localStorage.setItem(KEY,code)}catch{}location.reload()}

let tr=s=>s;

export async function startI18n(){const code=lang();document.documentElement.lang=code;try{document.cookie='cba-lang='+code+';path=/;max-age=31536000;SameSite=Lax'}catch{}if(code==='en')return;
 const root=document.documentElement;root.style.visibility='hidden';const show=()=>root.style.visibility='';setTimeout(show,800);
 let dict;try{dict=(await import('./lang-'+code+'.js')).default}catch{return show()}
 // keys ending in a space, opening quote/bracket, # or colon are prefixes the app completes with a name
 // and keys starting with a space or % are endings appended to a name or number (" connected", "% used")
 const keys=Object.keys(dict),prefixes=keys.filter(k=>/[\s“(#:]$/.test(k)).sort((a,b)=>b.length-a.length),suffixes=keys.filter(k=>/^[\s%]/.test(k)).sort((a,b)=>b.length-a.length);
 // untranslated text seen on screen, for completing the dictionary: copy(__i18nMissing()) in the console
 const missing=new Set(),translated=new Set(Object.values(dict).map(x=>x.trim()));window.__i18nMissing=()=>[...missing].sort().join('\n');
 tr=s=>{const v=s.trim();if(!v||translated.has(v))return s;if(dict[v]!==undefined)return s.replace(v,dict[v]);let out=s;
  const p=prefixes.find(k=>v.startsWith(k));if(p){const rest=v.slice(p.length);out=dict[rest]!==undefined?s.replace(v,dict[p]+dict[rest]):out.replace(p,dict[p])}const e=suffixes.find(k=>v.endsWith(k.trimEnd()));if(e)out=out.replace(new RegExp(e.trimEnd().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(\\s*)$'),dict[e].trimEnd()+'$1');
  if(out===s&&missing.size<3000&&/[a-z]{3}/.test(v))missing.add(v);return out};
 const done=new WeakMap();// node → text we wrote, so a translation that starts with its own key is not translated again
 const text=n=>{if(done.get(n)===n.data||n.parentElement?.tagName==='TEXTAREA')return;const v=tr(n.data);if(v!==n.data)n.data=v;done.set(n,n.data)};
 const attrs=e=>{for(const a of ATTRS){const v=e.getAttribute(a);if(!v)continue;const seen=done.get(e)||{};if(seen[a]===v)continue;const out=tr(v);if(out!==v)e.setAttribute(a,out);seen[a]=out;done.set(e,seen)}};
 const filter={acceptNode:n=>n.nodeType===1&&n.matches(SKIP)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT};
 const walk=node=>{if(node.nodeType===3){if(!node.parentElement?.closest(SKIP))text(node);return}if(node.nodeType!==1||node.closest(SKIP))return;attrs(node);
  const w=document.createTreeWalker(node,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,filter);for(let n=w.nextNode();n;n=w.nextNode())n.nodeType===3?text(n):attrs(n)};
 walk(document.body);document.title=tr(document.title);show();
 new MutationObserver(list=>{for(const r of list){if(r.type==='childList')r.addedNodes.forEach(walk);else if(r.type==='characterData')walk(r.target);else if(!r.target.closest(SKIP))attrs(r.target)}})
  .observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});
 for(const k of ['alert','confirm','prompt']){const native=window[k].bind(window);window[k]=(m,...a)=>native(tr(String(m??'')),...a)}}
startI18n();
