// What a confirmed order says about how it is used, and how a customer message is laid out (19 Nov 2026, the owner's testing report).
// Plain code, no AI. Used by kirimdev.mjs (after-payment messages, the send path) and customer-tools.mjs (create_payment's sales labels).
// - orderFacts(form): pen or vial, premix or self-mix, read from the confirmed order form ("Konfigurasi: Pen: premixed cartridge",
//   "1x Serum B 10mg (vial, dibantu premix)"). TS-3: a pen buyer got the vial mixing video because the order carried a product label but no
//   S-Pen label (the agent left it out); TS-4: a premix buyer got the mixing tutorial because only "no S-Pen" was checked.
// - afterPaidPicks(): which after-payment parts fit the order: the pen is taken from the form when the label is missing, and a premix order
//   never gets a mixing tutorial (a part whose quick reply or file name says mix/mixing; "premix" itself is not one).
// - tidyText(): a customer text keeps its layout. TS-9: the team's payment confirmation was stored as one line with its "•" points inline,
//   so the customer got one long paragraph; TS-8: recommendations came as walls of text. Only whitespace is changed, never a word.
// - repeatKey()/sameText(): a long text or a video already sent to this customer is not sent again (TS-5: the mixing tutorial twice).

const CONF=/^\s*[-•*]?\s*(?:konfigurasi|configuration|config|bentuk|format|jenis)\b[^:\n]{0,20}:/i;
const ITEM=/^\s*[-•*]?\s*\d+\s*[x×]\s/i;
const SELF=/\b(?:mix(?:ing)?|campur(?:an)?|dicampur)\s+sendiri\b|\bself[- ]?mix/i;
const PREMIX=/\bdibantu\s+(?:pre-?)?mix|\bpre-?mix(?:ed)?\b|\bready[- ]to[- ]use\b|\bRTU\b|\bsiap\s+pakai\b|\bsudah\s+dicampur\b/i;
const NO_PEN=/\b(?:tanpa|tidak\s+pakai|tidak\s+pake|without|no)\s+pen\b/i;
export function orderFacts(form){const lines=String(form||'').split('\n'),conf=lines.filter(l=>CONF.test(l)).join('\n'),items=lines.filter(l=>ITEM.test(l)).join('\n');
 // the configuration line decides when it names the form; else the item lines do
 const where=/\b(?:pen|vial)\b/i.test(conf)?conf:conf+'\n'+items,all=conf+'\n'+items;
 const pen=/\bpen\b/i.test(where)&&!NO_PEN.test(where),vial=/\bvial\b/i.test(where),selfMix=SELF.test(all),premix=!selfMix&&PREMIX.test(all);
 return {pen,vial,premix,selfMix}}
export const factTags=f=>[f?.pen&&'@pen',f?.vial&&'@vial',f?.premix&&'@premix',f?.selfMix&&'@selfmix'].filter(Boolean);
// the sales label of a pen when the line has one ("S-Pen"): the order names a pen, so the contact gets it even when the agent forgot it
export const penLabel=sales=>(Array.isArray(sales)?sales:[]).find(x=>/^S-\s*pen$/i.test(String(x).trim()))||null;

// a part that is a mixing tutorial: its quick reply command or file name says mix or mixing (not "premix", not "remix")
const MIX=/(?:^|[\/_\s.-])mix(?:ing)?(?=[\/_\s.-]|$)/i;
export const mixPart=x=>{const m=/^\[(?:REPLY|VIDEO|FOTO|TEMPLATE):\s*([^\]|]+)/i.exec(String(x||'').trim());return !!m&&MIX.test(m[1].trim())};

// a: kirimdev.json lines.<agent>.afterPaid {parts, byLabel:[{match, unless, parts}], mixWhenPremix}; products: the order's S- labels;
// facts: orderFacts() of its form. Patterns match the labels and the facts' tags (@pen, @vial, @premix, @selfmix).
export function afterPaidPicks(a,{products=[],facts=null}={}){if(!a)return [];const f=facts||{},on=[...products];
 if(f.pen&&!on.some(x=>/^S-\s*pen$/i.test(x)))on.push('S-Pen');on.push(...factTags(f));
 const hit=re=>{try{return !!re&&on.some(x=>new RegExp(re,'i').test(x))}catch{return false}};
 let list=[...(a.parts||[]),...(a.byLabel||[]).filter(r=>(!r?.match||hit(r.match))&&!hit(r?.unless)).flatMap(r=>r.parts||[])].map(x=>String(x||'').trim()).filter(Boolean);
 if(f.premix&&!a.mixWhenPremix)list=list.filter(x=>!mixPart(x));
 return list}

// ---- layout of a customer text: only whitespace changes
const BUL=/^\s*[•●▪]\s/;const isBul=l=>BUL.test(l);
const BOLDLINE=/^\s*\*[^*\n]{2,80}\*\s*:?\s*$/;
// a line longer than this with no break is cut into paragraphs at sentence ends
const PARA=420,CHUNK=240;
function paragraphs(l){if(l.length<=PARA||isBul(l))return [l];const out=[];let cur='';
 for(const s of l.split(/(?<=[.!?])\s+(?=[\p{Lu}"“*(])/u)){if(cur&&cur.length>=CHUNK){out.push(cur);cur=s}else cur=cur?cur+' '+s:s}
 if(cur)out.push(cur);return out.length>1?out.flatMap((x,i)=>i?['',x]:[x]):[l]}
export function tidyText(t){let lines=String(t||'').replace(/\r\n?/g,'\n').split('\n')
  // points written inline ("...berikut: • satu. • dua.") each start their own line
  .flatMap(l=>(l.match(/\s[•●▪]\s/g)||[]).length?l.replace(/\s+([•●▪])\s+/g,'\n$1 ').split('\n'):[l])
  .map(l=>l.replace(/[ \t]+$/,'')).flatMap(paragraphs);
 const bul=lines.filter(isBul),longBul=bul.length>=2&&bul.reduce((s,l)=>s+l.length,0)/bul.length>80;const out=[];
 for(let i=0;i<lines.length;i++){const l=lines[i],prev=out.length?out[out.length-1]:'';
  if(l.trim()&&prev.trim()){
   // a blank line before a list, after it, between long points, and before a bold heading line
   if(isBul(l)&&(!isBul(prev)||longBul)||!isBul(l)&&isBul(prev)||BOLDLINE.test(l)&&!BOLDLINE.test(prev))out.push('')}
  out.push(l)}
 return out.join('\n').replace(/\n{3,}/g,'\n\n').trim()}

// ---- what was already sent to a customer
export const squashText=t=>String(t||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const REPEAT_MIN=120;
export const sameText=(a,b)=>{const x=squashText(a),y=squashText(b);return x.length>=REPEAT_MIN&&x===y};
// the media a part sends, as a key ('video:name', 'template:name'), or null; pictures ([FOTO:]) are left out: a still-valid QRIS is sent again on purpose
export function mediaKey(part){const m=/^\[(VIDEO|TEMPLATE):\s*(?:media\/staff\/)?([^\]|]+?)\s*(?:\|[^\]]*)?\]$/i.exec(String(part||'').trim());if(!m)return null;
 const n=m[2].trim(),base=decodeURIComponent(n.split('?')[0].split('/').pop()||n).replace(/\.(mp4|mov)$/i,'').toLowerCase();return m[1].toLowerCase()+':'+base}

// ---- the greeting for a new lead (TS-7): how much of the team's template a reply carries (0..1, null when the template is too short to tell),
// counting its longer words outside placeholders ({nama}, [produk], <x>); and whether a first message already holds the website quiz's answers
// (the rules then greet in one sentence instead of the template)
export function templateCover(reply,tpl){const words=[...new Set(squashText(String(tpl||'').replace(/\{[^}]*\}|\[[^\]]*\]|<[^>]*>/g,' ').replace(/^#.*$/gm,' ')).split(' ').filter(w=>w.length>=6))];
 if(words.length<5)return null;const r=' '+squashText(reply)+' ';return words.filter(w=>r.includes(' '+w+' ')).length/words.length}
export const quizData=t=>new Set((String(t||'').toLowerCase().match(/\b(nama|usia|umur|tinggi|berat|kota|domisili|tujuan|goal|riwayat|kondisi)\b/g)||[])).size>=3;
