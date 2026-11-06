// Past chats per agent ("look it up first", 6 Nov 2026): an agent that serves customers can search the past WhatsApp
// chats of ITS OWN line(s) before it asks the team ("how many cartridges per vial", "where do short links come
// from"). Which files belong to which agent is a setting (DATA/chat-history.json, System › Health › Look-it-up
// sources), never in code: { "agents": { "<agent>": { "files": ["/path/to/export.jsonl", ...] } } }.
// aqeelOS reads the files itself (the agent's own Linux user cannot reach them), and only the calling agent's own
// files are ever searched, so one brand never sees another brand's chats. Read only.
// A file is JSON lines, one message each: {conversation_id, direction: inbound|outbound, type, content, created_at}
// (the Kirimdev /v1 messages export). Other exports work when they use the same field names.
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';

const clip=(s,n)=>String(s??'').replace(/\s+/g,' ').trim().slice(0,n);
// words of a query: lower case, 2+ letters or digits; quoted "phrases" stay together
export function terms(q){const out=[];String(q||'').toLowerCase().replace(/"([^"]{2,80})"/g,(_,p)=>{out.push(p.trim());return ' '}).split(/[^\p{L}\p{N}+-]+/u).forEach(w=>{if(w.length>=2)out.push(w)});return [...new Set(out)].slice(0,8)}
export function parseLines(text){const msgs=[];for(const l of String(text).split('\n')){if(!l.trim())continue;let m;try{m=JSON.parse(l)}catch{continue}
  if(!m||typeof m.content!=='string'||!m.content.trim())continue;msgs.push({c:String(m.conversation_id||''),d:m.direction==='inbound'?'in':'out',t:String(m.created_at||''),x:m.content})}
 return msgs}
// hits: messages holding every term (any order), newest first, each with the messages around it in its chat
export function search(msgs,q,{limit=8,around=2,byConv}={}){const ts=terms(q);if(!ts.length)return {terms:ts,total:0,hits:[]};
 const conv=byConv||group(msgs);const found=[];
 for(const m of msgs){const low=m.x.toLowerCase();if(ts.every(t=>low.includes(t)))found.push(m)}
 found.sort((a,b)=>b.t.localeCompare(a.t));const seen=new Set(),hits=[];
 for(const m of found){const k=m.c+'|'+m.t;if(seen.has(m.c+'|'+m.x.slice(0,60)))continue;seen.add(m.c+'|'+m.x.slice(0,60));
  const l=conv.get(m.c)||[m];const i=l.indexOf(m);const ctx=l.slice(Math.max(0,i-around),i+around+1).map(x=>({who:x.d==='in'?'CUSTOMER':'TEAM',at:x.t.slice(0,16).replace('T',' '),text:clip(x.x,x===m?900:400),match:x===m}));
  hits.push({chat:m.c.slice(-6),at:m.t.slice(0,10),context:ctx});if(hits.length>=limit)break}
 return {terms:ts,total:found.length,hits}}
const group=msgs=>{const g=new Map();for(const m of msgs){if(!g.has(m.c))g.set(m.c,[]);g.get(m.c).push(m)}for(const l of g.values())l.sort((a,b)=>a.t.localeCompare(b.t));return g};
export function format(r,{files}){if(!r.terms.length)return 'Give a few words to search for (for example: cartridge vial).';
 if(!r.hits.length)return 'No past chat holds all of: '+r.terms.join(', ')+' (searched '+files+' file'+(files===1?'':'s')+' of your own line). Try fewer or other words (Indonesian and English), then your knowledge sheet.';
 return r.total+' message'+(r.total===1?'':'s')+' match '+r.terms.join(' + ')+'; the newest '+r.hits.length+' with their chat around them (TEAM = what our staff answered):\n\n'+
  r.hits.map((h,i)=>'#'+(i+1)+' chat …'+h.chat+', '+h.at+'\n'+h.context.map(c=>(c.match?'» ':'  ')+c.who+': '+c.text).join('\n')).join('\n\n')+
  '\n\nThese are past answers by staff, not rules: prices and promos change, so check prices against your knowledge sheet.'}

export function createChatHistory({DATA,log=m=>console.log(m)}){
 const FILE=path.join(DATA,'chat-history.json');const cache=new Map();
 async function conf(){try{return JSON.parse(await readFile(FILE,'utf8'))}catch{return {agents:{}}}}
 async function filesOf(agent){const c=await conf();return [].concat(c.agents?.[String(agent).split('--')[0]]?.files||[]).map(String).filter(f=>path.isAbsolute(f))}
 async function load(f){const st=await stat(f).catch(()=>null);if(!st)return null;const k=cache.get(f);if(k&&k.mtime===st.mtimeMs)return k;
  const msgs=parseLines(await readFile(f,'utf8'));const v={mtime:st.mtimeMs,msgs,byConv:group(msgs)};cache.set(f,v);log('chat history: loaded '+msgs.length+' messages from '+path.basename(f));return v}
 async function has(agent){return (await filesOf(agent)).length>0}
 async function find(agent,q,{limit=8}={}){const files=await filesOf(agent);if(!files.length)return {text:'No past chats are set up for you. The owner adds them in aqeelOS (System › Health › Look-it-up sources).',error:true};
  const all=[];const byConv=new Map();let n=0;
  for(const f of files){const v=await load(f).catch(()=>null);if(!v)continue;n++;all.push(...v.msgs);for(const [c,l] of v.byConv)byConv.set(c,(byConv.get(c)||[]).concat(l))}
  for(const l of byConv.values())l.sort((a,b)=>a.t.localeCompare(b.t));
  const r=search(all,q,{limit:Math.min(15,Math.max(1,Number(limit)||8)),byConv});return {text:format(r,{files:n}),total:r.total}}
 async function sources(){const c=await conf();const out=[];for(const [a,v] of Object.entries(c.agents||{}))for(const f of [].concat(v.files||[])){const st=await stat(f).catch(()=>null);out.push({agent:a,file:path.basename(String(f)),size:st?.size||0,updated:st?.mtimeMs||null,ok:!!st})}return out}
 return {has,find,sources,filesOf}}
