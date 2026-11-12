// aqeelos:kirim-guard: the last check before anything reaches a customer, for every agent on every line (audit 12 Nov 2026, H6 + C1).
// One list of patterns, used twice: guardReply() on what the agent wrote for a customer turn (drops stage notes, holds the rest),
// and leaks() inside kirimdev.mjs deliver() on EVERY text that leaves, whatever made it (a reply, whatsapp_reply, an approved
// draft, a handoff text). A hit never reaches the customer: the turn is written again once with the reason, else a person gets it.
// What it looks for: team notes, the agent's reasoning (anywhere in the reply, Indonesian or English), tool names, tool errors and
// tracebacks, keys and tokens, internal links and file paths, the run's own instructions, markdown/tool-call debris, and other
// people's data: a phone number, address or name that is not the customer's own (built from this chat's own identifiers and text).
// False positives matter as much: scripts/kirim-guard.test.mjs holds 24 leaks that must stop and 30 real replies that must pass.

// ---- what the agent wrote, as lines for the team (kept from kirimdev.mjs)
const INTERNAL=[/(catatan|note)s?\s+(untuk|buat|for)\s+(tim|team)/i,/tidak\s+dikirim\s+ke\s+customer|not\s+(to\s+be\s+)?sent\s+to\s+(the\s+)?customer/i,
 /\b(test\s*mode|mode\s*tes(t)?|internal\s+note|draft\s+reply|as an ai|language model|LLM)\b/i,/^\s*\(?\s*(answered with|dijawab (dengan|oleh))\b/i,
 /^\s*\S+\.(jpe?g|png|webp|pdf)\s*$/i];
// Only explicit reply-to-operator preambles, not ordinary customer-facing delivery statements.
const REPLY_NOTE=/^\s*(?:ini\s+balasan\s+yang\s+saya\s+siapkan\b|saya\s+belum\s+mengirim\s+apa\s*pun\b|here\s+is\s+the\s+reply\b|draft\s+reply\b|I\s+haven['’]t\s+sent\s+anything\b)[^\n]*[:.!?]\s*$/i;
// the agent quoting its rules or narrating its plan at the start of a reply (i5e349bf6, 11 Nov 2026)
const REASON=/^\s*(?:dari\s+rules?\b|rules?\s*:|aturan(?:nya)?\s*:|(?:thinking|reasoning)\b)|\bjadi\s+saya\s+jawab\b|\bsaya\s+jawab\b[^\n]*\bdulu\b|\blalu\s+minta\s+data\b/i;
// an error trace or stack line
const TRACE=/Traceback \(most recent call last\)|^\s*at\s+\S+\s+\(.*:\d+:\d+\)|^\s*File ".*", line \d+|\b(?:TypeError|ReferenceError|SyntaxError|ValueError|KeyError|AttributeError|RuntimeError)\b\s*[:(]|UnhandledPromiseRejection/;
// a whole line that is only a bracketed note to itself about a picture: dropped and logged, the rest goes out (8 Nov 2026)
const STAGE=/^\s*\[(?!FOTO:|TEMPLATE:|VIDEO:)(?:\s*(send|kirim(kan)?|attach|lampir(kan)?)\b|[^\]\n]*\b(gambar|image|foto|photo|picture|img)\b)[^\]\n]*\]\s*$/i;

export const TOOL_NAMES=['create_payment','check_payment','quote_order','read_sheet','read_file','list_files','past_chats','post_order','label_contact','website_form','get_protocol','send_protocol_pdf','whatsapp_reply','whatsapp_draft','session_search','report_bottleneck','conversation tool'];
// [kind, pattern, what it is]: the first hit on a line names the leak
export const RULES=[
 ['note',INTERNAL[0],'a note for the team'],['note',INTERNAL[1],'a note for the team'],['note',INTERNAL[2],'an internal remark'],['note',INTERNAL[3],'a backup-model note'],['note',INTERNAL[4],'a bare file name'],
 ['note',REPLY_NOTE,'a preface to the operator'],
 ['reasoning',REASON,'the agent quoting its rules or its plan'],
 ['reasoning',/\b(sesuai|menurut|berdasarkan|dari)\s+(sop|rules?|briefing|decisions?|knowledge\s*sheet|aturan\s+internal)\b/i,'the agent citing its rules'],
 ['reasoning',/\b(the|this)\s+(user|customer)\s+(is|was|wants?|asked|asks|needs?|said|says|has|sent|wrote|seems|might|may)\b/i,'the agent talking about the customer'],
 ['reasoning',/^\s*(the\s+)?(customer|user|pelanggan)\s+(wants?|asks?|asked|is\s+asking|needs?|said|sent|minta|menanyakan|bertanya)\b/i,'the agent talking about the customer'],
 ['reasoning',/\bI\s+should\s+(check|ask|hand|look|read|search|call|use|reply|respond|verify|first|not|now)\b/i,'the agent planning aloud'],
 ['reasoning',/\b(check(ing|ed)?|read(ing)?|search(ing|ed)?|look(ing|ed)?\s+(at|in|up|through))\s+(the\s+|my\s+)?(sheet|rules|past\s+chats|knowledge|decisions|briefing|sop)\b/i,'the agent planning aloud'],
 ['reasoning',/^\s*(let\s+me\s+(check|look|think|see|read|search)\s*([.,…:]|$|(at\s+|in\s+)?the\s+(sheet|rules|chat|history|decisions|briefing))|okay,?\s+(so\b|let\s+me\b|i\s+(will|need|should)\b)|now\s+i\b|first,?\s+i\b|i\s+(read|checked|looked\s+at|searched|found\s+in)\s+(the|my)\b|(reply|draft|response|answer|balasan|jawaban)\s*:|based\s+on\s+(the|my)\s+(rules?|sheet|instructions?|briefing|sop|decisions?))/i,'the agent thinking aloud'],
 ['prompt',/\b(rules?\s+tab|decisions?\s+(file|log|tab)|knowledge\s+(sheet|base|file)|briefing\s+(file|tab)|soul\.md|system\s+prompt|my\s+instructions|instruksi\s+(saya|sistem|system)|prompt\s+(saya|sistem))\b/i,'the agent naming its own instructions or files'],
 ['prompt',/WHATSAPP\s+(TEST\s+)?CHAT\b|\bYou\s+are\s+[\p{L}]+\s+for\s+\p{L}|Conversation\s+so\s+far|New\s+inbound\s+messages|Write\s+ONLY\s+the|Output\s+only\s+the\s+message|\bHANDOFF:\s*<|\brun\s+field\b/u,'the run\'s own instructions'],
 ['prompt',/\b(nomor|number|no\.?)\s+(tes|test|tester)\b|\btester\s*[:)]|\b(test|tes)\s+(number|chat)\b|\bQRIS\s+tes(t)?\b|\btes(t)?\s+QRIS\b/i,'a remark about testers'],
 ['prompt',/\btopi[kc]\s+(questions|orders|log)\b|\b(questions|orders)\s+topi[kc]\b|\b(team\s+group|grup\s+tim)\b|\baqeel\s?os\b/i,'the team\'s own workspace'],
 ['prompt',/^\s*(keputusan|decision)\s+\d{1,2}\s+\p{L}{3,9}\b[^\n:]{0,6}:/iu,'a quoted decision'],
 ['prompt',/\b[A-Z]{3,}(?:_[A-Z]{2,})+\b/,'an internal name'],
 ['handoff',/^\s*HANDOFF\b/,'a handoff line inside a reply'],
 ['debris',/^\s*(?:📝\s*)?DRAFT\s*#\d+|^\s*(?:🛑\s*)?HELD:|^\s*(?:❓\s*)?HANDOFF\s*\(|^\s*(?:🧪\s*TEST\s*)?(?:🧾\s*)?PAID ORDER\b/,'a team post header'],
 ['tool',new RegExp('\\b('+TOOL_NAMES.join('|')+')\\b'),'a tool name'],
 ['tool',/These tools only work|The payment was not made|\btell the customer\b|\bhand\s?off\s+to\s+(the\s+)?team\b|\bdo not (say|guess)\b|\b(isError|tool[_ ]?calls?|tool[_ ]?results?|function[_ ]?calls?)\b/i,'a tool\'s answer'],
 ['tool',/\{\s*"[\w$-]+"\s*:|^\s*[\[{]\s*$|^\s*[\]}],?\s*$|"(arguments|error|isError)"\s*:/,'raw JSON'],
 ['error',TRACE,'an error trace'],
 ['error',/(^|[\s(])Error:\s|\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|ENOENT|EACCES|EPIPE|EAI_AGAIN|EHOSTUNREACH|EPERM)\b|\[object Object\]|\b(?:HTTP|status(?:\s+code)?)\s+[45]\d\d\b|\b(?:Kirimdev|Tripay|Xendit|Telegram|Shopify)\s+(?:answered|error|returned|refused|did\s+not)\b|\bexit\s+code\s+\d+|\bstack\s+trace\b/,'an error message'],
 ['secret',/\b(?:xnd_(?:production|development)_\w+|sk-[A-Za-z0-9_-]{16,}|kdv_\w{8,}|whsec_\w+|gh[po]_\w{20,}|AIza[\w-]{20,}|xox[abpr]-[\w-]+|ya29\.[\w-]+)|\bBearer\s+[\w.-]{12,}|\b(?:run\s+key|api\s+key|secret(?:\s+key)?|password|kata\s+sandi|access\s+token|token)\s*[:=]\s*\S{6,}/i,'a key or token'],
 ['link',/\b(?:docs|drive|sheets)\.google\.com\b|\bapi\.(?:kirimdev|telegram|xendit)\.\w+|\btripay\.co\.id\/api\b|\bapp\.kirimdev\.com\b|\bt\.me\/c\/|\bgithub\.com\b|\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b|(?<![\d.]|Rp\s?)(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?![\d.])|\/(?:channels|abilities|ui|mcp|agent-ops|kirimdev)\/[\w-]+/i,'an internal link'],
 ['path',/(?:^|[\s"'(`])(?:~|\/home|\/tmp|\/var|\/etc|\/root|\/usr)\/[\w.-]+|\.secrets\b|\.tools\/|\bworkspaces\/|\b[\w-]+\.(?:md|json|jsonl|py|mjs|cjs|js|csv|ya?ml|env|sh|txt|log|sql)\b/i,'a file path'],
 ['debris',/^\s*\|.*\|\s*$|^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$|```|<\/?(thinking|tool_call|function_calls|invoke|system|assistant)\b/i,'markdown or tool-call debris'],
];
// a long random token (mixed case and digits, 28+): a key, whatever its maker. Links are looked at separately, so their paths do not count.
const TOKEN=/\b(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{28,}\b/;
const URLS=/\bhttps?:\/\/[^\s<>"')\]]+/gi;
const esc=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// ---- other people's data (C1). own: {phones:[], names:[], text:''} = this chat's own identifiers and everything already said in it.
export const normPhone=x=>{let d=String(x||'').replace(/\D/g,'');if(d.startsWith('0'))d='62'+d.slice(1);return d};
const PHONE=/(?<![\w.,/-])(?:(?:\+?62|0)[\s-]?8\d{1,3}(?:[\s-]?\d{3,4}){2,3}|\+\d{1,3}[\s-]?\d{2,4}(?:[\s-]?\d{3,4}){2,3})(?![\d-])/g;
const ADDRESS=/\b(?:jl\.?|jln\.?|jalan|gg\.?|gang|komp(?:lek|\.)?|perum(?:ahan)?|blok)\s+[\p{L}0-9][\p{L}0-9 .'-]{2,40}?\s*(?:no\.?\s*)?\d+[a-z]?\b|\bRT\s*\.?\s*0?\d{1,3}\s*[\/,-]?\s*RW\s*\.?\s*0?\d{1,3}\b|\b(?:alamat(?:\s+lengkap)?|address)\s*:\s*\*?\s*\S[^\n]{12,}/giu;
const NAMED=/(?:\b(?:[Kk]ak|[Kk]akak|[Bb]u|[Ii]bu|[Pp]ak|[Bb]apak|[Mm]as|[Mm]bak|[Mm]ba|[Bb]ang|[Ss]dri?\.?|M(?:r|rs|s)\.?)[ \t]+|(?:\b[Aa]tas[ \t]+[Nn]ama|\b[Aa]\.?[Nn]\.|\b[Nn]ama(?:[ \t]+[Ll]engkap)?[ \t]*:)[ \t]*\*?[ \t]*)(\p{Lu}[\p{L}'.-]+(?:[ \t]+\p{Lu}[\p{L}'.-]+){0,3})/gu;
// capitalised words that follow "Kak" without being a name
const NOT_NAME=new Set('untuk berikut terima mohon silakan silahkan boleh apakah baik oke ok jadi kalau saya kami kita ini itu ada bisa sudah mau total harga pesanan paket qris va dengan dan atau yang jika nanti setelah sebelum maaf halo hai selamat siap noted betul benar tidak ya iya tentu tapi namun karena supaya agar pembayaran pengiriman produk order form formulir alamat nomor email voucher promo gratis ongkir stok ready tersedia lengkap anda kakak customer admin tim team dokter doctor the for and you your please thanks thank yes no'.split(' '));
const squash=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function foreign(text,own={}){const out=[],t=String(text||'');if(!t.trim())return out;
 const ownText=String(own.text||''),ownDigits=ownText.replace(/\D/g,''),ownSquash=' '+squash(ownText+' '+(own.names||[]).join(' '))+' ';
 const phones=new Set((own.phones||[]).map(normPhone).filter(Boolean));for(const m of ownText.match(PHONE)||[])phones.add(normPhone(m));
 for(const m of t.match(PHONE)||[]){const n=normPhone(m),raw=m.replace(/\D/g,'');if(n.length<10||phones.has(n)||ownDigits.includes(raw)||ownDigits.includes(n))continue;out.push({kind:'foreign',why:'a phone number that is not this customer\'s',line:'…'+n.slice(-4)})}
 for(const m of t.match(ADDRESS)||[]){const s=squash(m.replace(/^(alamat(\s+lengkap)?|address)\s*:/i,''));if(s.length<6||ownSquash.includes(' '+s+' ')||ownSquash.includes(s))continue;out.push({kind:'foreign',why:'an address that is not from this chat',line:m.slice(0,24)+'…'})}
 for(const m of t.matchAll(NAMED)){const toks=squash(m[1]).split(' ').filter(w=>w.length>=3&&!NOT_NAME.has(w));if(!toks.length)continue;
  if(toks.some(w=>ownSquash.includes(' '+w+' ')))continue;out.push({kind:'foreign',why:'a person\'s name that is not from this chat',line:m[0].slice(0,24)})}
 return out}

// ---- every reason a text must not reach a customer. ctx: {appHost, blockedHosts:[], allow:[phrases], secrets:[values], own:{phones,names,text}}
export function leaks(text,ctx={}){const out=[];let t=String(text||'');
 for(const s of ctx.secrets||[])if(s&&String(s).length>=8&&t.includes(String(s)))out.push({kind:'secret',why:'a key of this install',line:'(hidden)'});
 for(const a of ctx.allow||[])if(a&&String(a).trim().length>=3)t=t.replace(new RegExp(esc(String(a).trim()),'gi'),' ');
 const hosts=[ctx.appHost,...(ctx.blockedHosts||[])].map(h=>String(h||'').replace(/^https?:\/\//,'').replace(/\/.*$/,'').toLowerCase()).filter(Boolean);
 for(const l of t.split('\n')){if(!l.trim())continue;const hit=RULES.find(r=>r[1].test(l));
  if(hit){out.push({kind:hit[0],why:hit[2],line:l.trim()});continue}
  const low=l.toLowerCase();const h=hosts.find(x=>low.includes(x));if(h){out.push({kind:'link',why:'a link into the team\'s own system',line:l.trim()});continue}
  if(TOKEN.test(l.replace(URLS,' ')))out.push({kind:'secret',why:'what looks like a key or token',line:l.trim().slice(0,12)+'…'})}
 if(ctx.own)out.push(...foreign(t,ctx.own));
 return out}
// the old one-line test, kept for callers and tests: is this line (text) not for a customer?
export const internalLine=(l,ctx)=>leaks(l,ctx).length>0;
export const internalText=(t,ctx)=>leaks(t,ctx).length>0;
export const leakWords=l=>[...new Set(l.map(x=>x.why))].join('; ');

// ---- which language a text is in, when that is clear ('id' | 'en' | null): a reply in another language than the customer writes is held
const ID_WORDS=/\b(yang|dan|di|ke|kak|ya|untuk|dengan|saya|kami|bisa|ada|tidak|ini|itu|sudah|mau|apa|berapa|terima|kasih|silakan|mohon|harga|nya|dulu|juga|atau|dari|akan|boleh|halo|baik|bagaimana|gimana|dong|nih|ga|gak|nggak)\b/gi;
const EN_WORDS=/\b(the|and|is|are|you|your|our|for|with|can|will|have|has|please|thanks|thank|this|that|what|how|costs?|of|to|in|it|we|my|do|does|would|could|hello|hi|ships?|days?)\b/gi;
export function langOf(text){const t=String(text||'').replace(URLS,' ').replace(/\[(FOTO|TEMPLATE|VIDEO):[^\]]*\]/g,' ');const id=(t.match(ID_WORDS)||[]).length,en=(t.match(EN_WORDS)||[]).length;
 if(id>=2&&id>=en*1.5)return 'id';if(en>=4&&en>=id*3)return 'en';return null}
// a reply that only asks the customer to wait: the agent cannot come back by itself, so it must answer now or hand off
const WAIT_ONLY=/\b(mohon\s+(di)?tunggu|tunggu\s+sebentar|ditunggu\s+(ya|sebentar)|sebentar\s+ya|saya\s+cek\s+dulu|kami\s+cek\s+dulu|one\s+moment|please\s+wait|hold\s+on|give\s+me\s+a\s+(moment|minute)|i(?:'|’)?ll\s+(check|get\s+back)|let\s+me\s+check)\b/i;
export const waitOnly=parts=>{const txt=parts.filter(p=>!/^\[(FOTO|TEMPLATE|VIDEO):/.test(p)).join('\n').trim();return parts.length>0&&txt.length>0&&txt.length<=140&&!txt.includes('?')&&parts.every(p=>!/^\[(FOTO|TEMPLATE|VIDEO):/.test(p))&&WAIT_ONLY.test(txt)};

// a reply that says a payment (QRIS, VA, link, invoice) is sent, attached or below needs a real payment from this run
// (audit 6 Nov: "link Xendit tadi" was never sent; three "Berikut QRIS" had no QRIS)
const PAY_CLAIM=/\b(qris|virtual account|nomor va|va\s+(bca|bni|bri|mandiri)|link (pembayaran|bayar|xendit|invoice)|payment link|invoice)\b[^\n]{0,60}\b(sudah|telah|udah)?\s*(saya |kami )?(kirim(kan)?|terkirim|berikut|terlampir|di ?bawah|sent|attached|below)\b|\b(berikut|terlampir)\b[^\n]{0,25}\b(qris|va|virtual account|link (pembayaran|bayar)|invoice)\b|\b(sudah|telah|udah)\s+(saya |kami )?(kirim(kan)?|buat(kan)?)\b[^\n]{0,40}\b(qris|va|virtual account|link|invoice)\b/i;
const TAG=/^\[(FOTO|TEMPLATE|VIDEO):/;
// paid: whether the payment tool made a payment in this run (null = unknown, the old QR-picture check only)
// ctx: as leaks(), plus customerText (what the customer wrote, for the language check) and final (false = skip the wait-only check)
export function guardReply(input,{paid=null,qrPics=[],ctx={},customerText=''}={}){const removed=[];const keep=[],dropped=[],parts=[];let leading=true;
 for(const p of input){if(TAG.test(p)){leading=false;parts.push(p);continue}
  const t=p.split('\n').filter(l=>{if(STAGE.test(l)){dropped.push(l.trim());return false}if(!l.trim())return true;
   if(REPLY_NOTE.test(l)||REASON.test(l)){if(leading){dropped.push(l.trim());return false}removed.push(l.trim())}
   leading=false;return true}).join('\n').trim();if(t)parts.push(t)}
 // nothing but notes: there is no reply to send, a person sees what the agent wrote
 if(!parts.length&&dropped.length)return {parts:input,removed:dropped,dropped:[],kinds:['note'],hold:'The reply was only notes, with nothing for the customer: '+dropped.join(' | ').slice(0,300)};
 const kinds=new Set(),whys=new Set();
 for(const p of parts){if(TAG.test(p)){keep.push(p);continue}
  for(const x of leaks(p,ctx)){if(!removed.includes(x.line))removed.push(x.line);kinds.add(x.kind);whys.add(x.why)}keep.push(p)}
 if(removed.length)return {parts:keep,removed,dropped,kinds:[...kinds],hold:'The reply had text that is not for the customer ('+([...whys].join('; ')||'notes for the team')+'): '+removed.join(' | ').slice(0,300)};
 // a QR is promised only when the text says the QRIS itself is here/attached; QRIS listed as a payment option
 // (order form, 'pilih metode') is not a promise (false hold, 6 Nov)
 const QR_PROMISE=/(berikut|ini|terlampir|di ?bawah|kami kirim(kan)?|saya kirim(kan)?|here is|attached)[^\n]{0,25}\bQRIS\b|\bQRIS(-?nya)?\b[^\n]{0,15}(terlampir|di ?bawah|berikut|attached)/i;
 const promisesQr=keep.some(p=>QR_PROMISE.test(p)&&!/metode pembayaran|pilih (salah satu|metode)|payment method/i.test(p));
 const hasPic=keep.some(p=>/^\[FOTO:/i.test(p));
 // the run made the QRIS but the reply forgot its [FOTO:] tag: attach the picture the payment tool made (i49f4e694)
 if(promisesQr&&!hasPic&&qrPics.length){keep.push(...qrPics);return {parts:keep,removed,dropped,hold:null,attached:qrPics}}
 if(promisesQr&&!hasPic)return {parts:keep,removed,dropped,kinds:['payment'],hold:'The reply says a QRIS is attached, but no QR picture was made. Create the QRIS with the payment tool, then send it.'};
 // a payment is claimed only by one sentence that says it is sent/here now; a question, a future or conditional step
 // ('nanti/setelah/sebelum ... saya kirimkan'), or the order form being sent is not a claim (i1b25ec10, 10 Nov 2026)
 const ASKS_METHOD=p=>!p.split(/(?<=[.!?\n])\s*/).some(x=>PAY_CLAIM.test(x)&&!/\?\s*$/.test(x)&&!/\b(nanti|setelah|sebelum|akan|kalau|jika|bisa|mau|form)\b/i.test(x));
 const claims=keep.some(p=>!TAG.test(p)&&PAY_CLAIM.test(p)&&!/metode pembayaran|pilih (salah satu|metode)|payment method/i.test(p)&&!ASKS_METHOD(p));
 // a reply that carries the QR picture itself (a still-valid QRIS sent again) is not an empty claim (ia70188f1, 9 Nov 2026)
 if(paid===false&&claims&&!hasPic)return {parts:keep,removed,dropped,kinds:['payment'],hold:'The reply says a payment (QRIS, VA, link or invoice) was sent, but no payment was made in this run. Make it with create_payment first, or hand off.'};
 // the customer writes one language and the reply is clearly in the other
 {const mine=langOf(customerText),its=langOf(keep.filter(p=>!TAG.test(p)).join('\n'));
  if(mine&&its&&mine!==its)return {parts:keep,removed,dropped,kinds:['language'],hold:'The customer writes '+(mine==='id'?'Indonesian':'English')+' and the reply is in '+(its==='id'?'Indonesian':'English')+'. Answer in the customer\'s own language.'}}
 // only "please wait": nothing brings the agent back to this chat, so the customer would wait for ever
 if(waitOnly(keep))return {parts:keep,removed,dropped,kinds:['wait'],hold:'The reply only asks the customer to wait. Nothing brings you back to this chat later: answer the question now, or hand off (HANDOFF: reason).'};
 return {parts:keep,removed,dropped,hold:null}}
