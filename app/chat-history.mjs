// Past chats per agent ("look it up first", 6 Nov 2026): an agent that serves customers can look up how the team answered
// something before in the past Kirimdev chats of ITS OWN line(s) ("how many cartridges per vial", "where do short links come
// from"). Which files belong to which agent is a setting (DATA/chat-history.json, System › Health › Look-it-up
// sources), never in code: { "agents": { "<agent>": { "files": ["/path/to/export.jsonl", ...] } } }.
// aqeelOS reads the files itself (the agent's own Linux user cannot reach them), and only the calling agent's own
// files are ever searched, so one brand never sees another brand's chats. Read only.
// A file is JSON lines, one message each: {conversation_id, direction: inbound|outbound, type, content, created_at}
// (the Kirimdev /v1 messages export). Other exports work when they use the same field names.
//
// What comes back (audit 12 Nov 2026, C1). These files are other customers' private chats: about 43,300 messages on the first box,
// among them 202 filled name-and-address forms, 226 phone numbers and health details. Before this, any customer's run could pull
// them raw into its reply. Now there are two searches and no raw one:
//   scope "mine"    (a customer run's default): only the chat of the customer being answered, by its Kirimdev conversation id.
//   scope "answers" : every chat of the line, but only what OUR SIDE wrote (the team's answers), never a customer's text, with
//                     phone numbers, e-mail addresses, names, addresses and filled forms masked. A customer's question that
//                     matches finds the team's answer to it; the question itself is not shown.
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';

const clip=(s,n)=>String(s??'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim().slice(0,n);
// words of a query: lower case, 2+ letters or digits; quoted "phrases" stay together
export function terms(q){const out=[];String(q||'').toLowerCase().replace(/"([^"]{2,80})"/g,(_,p)=>{out.push(p.trim());return ' '}).split(/[^\p{L}\p{N}+-]+/u).forEach(w=>{if(w.length>=2)out.push(w)});return [...new Set(out)].slice(0,8)}
export function parseLines(text){const msgs=[];for(const l of String(text).split('\n')){if(!l.trim())continue;let m;try{m=JSON.parse(l)}catch{continue}
  if(!m||typeof m.content!=='string'||!m.content.trim())continue;msgs.push({c:String(m.conversation_id||''),d:m.direction==='inbound'?'in':'out',t:String(m.created_at||''),x:m.content})}
 return msgs}
const group=msgs=>{const g=new Map();for(const m of msgs){if(!g.has(m.c))g.set(m.c,[]);g.get(m.c).push(m)}for(const l of g.values())l.sort((a,b)=>a.t.localeCompare(b.t));return g};

// ---- masking. A line of a form that says who someone is; any form line (three or more make the message a filled form).
const WHO_LINE=/^\s*[-*•]?\s*\*?\s*(nama(\s+(lengkap|penerima|pemesan))?|alamat(\s+(lengkap|pengiriman|kirim))?|nomor\s*(hp|wa|whatsapp|telepon|telp)|no\.?\s*(hp|wa|whatsapp|telp|telepon)|hp|wa|whatsapp|telepon|e-?mail|kota|kecamatan|kelurahan|provinsi|kode\s*pos|usia|umur|tinggi(\s+badan)?|berat(\s+badan)?|tanggal\s+lahir|name|full\s+name|address|phone|city|postcode|zip)\s*\*?\s*:/i;
const FORM_LINE=/^\s*[-*•]?\s*\*?\s*[\p{L}][\p{L} ./()%0-9-]{1,40}?\s*\*?\s*:\s*\S/u;
const PHONE=/(?:\+?62|0)[\s-]?8\d{1,3}(?:[\s-]?\d{3,4}){2,3}|\+\d{1,3}[\s-]?\d{2,4}(?:[\s-]?\d{3,4}){2,3}/g;
const EMAIL=/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ADDRESS=/\b(?:jl\.?|jln\.?|jalan|gg\.?|gang|komp(?:lek|\.)?|perum(?:ahan)?|blok)\s+[\p{L}0-9][\p{L}0-9 .'/-]{2,60}?(?=[,;\n]|$)|\bRT\s*\.?\s*0?\d{1,3}\s*[\/,-]?\s*RW\s*\.?\s*0?\d{1,3}\b/giu;
const NAMED=/\b((?:[Kk]ak|[Kk]akak|[Bb]u|[Ii]bu|[Pp]ak|[Bb]apak|[Mm]as|[Mm]bak|[Mm]ba|[Bb]ang|[Ss]dri?\.?|M(?:r|rs|s)\.?)[ \t]+)(\p{Lu}[\p{L}'.-]+(?:[ \t]+\p{Lu}[\p{L}'.-]+){0,3})/gu;
const NOT_NAME=new Set('Untuk Berikut Terima Mohon Silakan Silahkan Boleh Apakah Baik Oke Jadi Kalau Saya Kami Kita Ini Itu Ada Bisa Sudah Mau Total Harga Pesanan Paket QRIS VA Dengan Maaf Halo Hai Selamat Siap Betul Benar Tidak Ya Iya Tentu Tapi Namun Karena Pembayaran Pengiriman Produk Order Form Formulir Alamat Nomor Email Voucher Promo Gratis Ongkir Stok Ready Admin Tim Dokter'.split(' '));
const esc=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// names a customer gave in their own chat (the form's "Nama:" line): masked in what the team wrote back to them
export function namesIn(list){const out=new Set();for(const m of list||[]){if(m.d!=='in')continue;for(const l of m.x.split('\n')){const x=/^\s*[-*•]?\s*\*?\s*nama(?:\s+(?:lengkap|penerima|pemesan))?\s*\*?\s*:\s*\*?\s*(.+)$/i.exec(l);
   if(x)for(const w of x[1].replace(/[^\p{L}\s'.-]/gu,' ').split(/\s+/))if(w.length>=3)out.add(w)}}return [...out]}
export function mask(text,names=[]){const lines=String(text||'').split('\n');
 // a filled form (the agent repeating a customer's order form): the whole message is one customer's order, so none of it is shown
 if(lines.filter(l=>WHO_LINE.test(l)).length>=2||lines.filter(l=>FORM_LINE.test(l)).length>=5&&lines.some(l=>WHO_LINE.test(l)))return '[a customer\'s filled form, hidden]';
 let t=lines.map(l=>WHO_LINE.test(l)?'[personal detail, hidden]':l).join('\n');
 t=t.replace(EMAIL,'[email]').replace(PHONE,'[number]').replace(ADDRESS,'[address]');
 t=t.replace(NAMED,(m,h,n)=>NOT_NAME.has(n.split(/[ \t]/)[0])?m:h.trimEnd());
 for(const n of names)t=t.replace(new RegExp('(?<![\\p{L}])'+esc(n)+'(?![\\p{L}])','giu'),'[name]');
 // what is left of long digit runs: order numbers, account numbers, receipts (prices keep their dots: Rp3.200.000)
 return t.replace(/\d[\d -]{6,}\d/g,m=>m.replace(/\D/g,'').length>=7?'[number]':m)}

// ---- scope "answers": the team's answers that match, or that follow a customer message that matches. Never a customer's text.
export function searchAnswers(msgs,q,{limit=8,byConv}={}){
 // a search for a phone number or an e-mail address is a search for a person, not for an answer: such words are left out
 const ts=terms(q).filter(t=>t.replace(/\D/g,'').length<5&&!t.includes('@'));if(!ts.length)return {terms:ts,total:0,hits:[]};
 const conv=byConv||group(msgs),found=msgs.filter(m=>{const low=m.x.toLowerCase();return ts.every(t=>low.includes(t))}).sort((a,b)=>b.t.localeCompare(a.t));
 const seen=new Set(),hits=[];let total=0;
 for(const m of found){const l=conv.get(m.c)||[m],i=l.indexOf(m);let ans=[];
  if(m.d==='out')ans=[m];
  else{for(let j=i+1;j<l.length&&ans.length<3;j++){if(l[j].d==='in'){if(ans.length)break;continue}ans.push(l[j])}}
  if(!ans.length)continue;const names=namesIn(l);
  const text=ans.map(a=>mask(clip(a.x,900),names)).filter(x=>x&&!/^\[a customer's filled form, hidden\]$/.test(x)).join('\n');if(!text.trim())continue;
  const k=text.slice(0,80);if(seen.has(k))continue;seen.add(k);total++;if(hits.length<limit)hits.push({at:ans[0].t.slice(0,7),text})}
 return {terms:ts,total,hits}}
// ---- scope "mine": the chat of the customer being answered, both sides (it is their own)
export function searchMine(msgs,q,conversation,{limit=8,byConv}={}){const ts=terms(q),l=((byConv||group(msgs)).get(String(conversation))||[]);
 if(!l.length)return {terms:ts,total:0,hits:[],none:true};
 const found=(ts.length?l.filter(m=>{const low=m.x.toLowerCase();return ts.every(t=>low.includes(t))}):l.slice(-limit)).sort((a,b)=>b.t.localeCompare(a.t));
 return {terms:ts,total:found.length,hits:found.slice(0,limit).map(m=>({at:m.t.slice(0,16).replace('T',' '),who:m.d==='in'?'CUSTOMER':'TEAM',text:clip(m.x,900)}))}}
export function format(r,{files,scope='answers'}){
 if(scope==='mine'){if(r.none)return 'This customer has no earlier chat in the saved history. For how the team answered a question before, search with scope "answers".';
  if(!r.hits.length)return 'Nothing in this customer\'s own earlier chat holds all of: '+r.terms.join(', ')+'. For how the team answered it for others, search with scope "answers".';
  return 'From THIS customer\'s own earlier chat ('+r.total+' message'+(r.total===1?'':'s')+', newest first):\n\n'+r.hits.map(h=>h.at+' '+h.who+': '+h.text).join('\n\n')}
 if(!r.terms.length)return 'Give a few words to search for (for example: cartridge vial).';
 if(!r.hits.length)return 'No past answer of the team matches all of: '+r.terms.join(', ')+' (searched '+files+' file'+(files===1?'':'s')+' of your own line). Try fewer or other words (Indonesian and English), then your knowledge sheet.';
 return r.total+' past answer'+(r.total===1?'':'s')+' of the team match '+r.terms.join(' + ')+'; the newest '+r.hits.length+' (what our staff wrote; customers\' own words and details are never shown):\n\n'+
  r.hits.map((h,i)=>'#'+(i+1)+' ('+h.at+') TEAM: '+h.text).join('\n\n')+
  '\n\nThese are past answers by staff, not rules: prices and promos change, so take prices only from the price list. Never pass on anything here that looks like one person\'s details.'}

export function createChatHistory({DATA,log=m=>console.log(m)}){
 const FILE=path.join(DATA,'chat-history.json');const cache=new Map();
 async function conf(){try{return JSON.parse(await readFile(FILE,'utf8'))}catch{return {agents:{}}}}
 async function filesOf(agent){const c=await conf();return [].concat(c.agents?.[String(agent).split('--')[0]]?.files||[]).map(String).filter(f=>path.isAbsolute(f))}
 async function load(f){const st=await stat(f).catch(()=>null);if(!st)return null;const k=cache.get(f);if(k&&k.mtime===st.mtimeMs)return k;
  const msgs=parseLines(await readFile(f,'utf8'));const v={mtime:st.mtimeMs,msgs,byConv:group(msgs)};cache.set(f,v);log('chat history: loaded '+msgs.length+' messages from '+path.basename(f));return v}
 async function has(agent){return (await filesOf(agent)).length>0}
 // scope: "mine" needs conversation (the run's own Kirimdev conversation id, never one from the model); anything else is "answers"
 async function find(agent,q,{limit=8,scope='answers',conversation=''}={}){const files=await filesOf(agent);if(!files.length)return {text:'No past chats are set up for you. The owner adds them in aqeelOS (System › Health › Look-it-up sources).',error:true};
  const all=[];const byConv=new Map();let n=0;
  for(const f of files){const v=await load(f).catch(()=>null);if(!v)continue;n++;all.push(...v.msgs);for(const [c,l] of v.byConv)byConv.set(c,(byConv.get(c)||[]).concat(l))}
  for(const l of byConv.values())l.sort((a,b)=>a.t.localeCompare(b.t));
  const lim=Math.min(15,Math.max(1,Number(limit)||8));
  if(scope==='mine'){if(!conversation)return {text:'This chat has no conversation to look up. Search with scope "answers" for how the team answered a question before.',total:0};
   const r=searchMine(all,q,conversation,{limit:lim,byConv});return {text:format(r,{files:n,scope:'mine'}),total:r.total}}
  const r=searchAnswers(all,q,{limit:lim,byConv});return {text:format(r,{files:n}),total:r.total}}
 async function sources(){const c=await conf();const out=[];for(const [a,v] of Object.entries(c.agents||{}))for(const f of [].concat(v.files||[])){const st=await stat(f).catch(()=>null);out.push({agent:a,file:path.basename(String(f)),size:st?.size||0,updated:st?.mtimeMs||null,ok:!!st})}return out}
 return {has,find,sources,filesOf}}
