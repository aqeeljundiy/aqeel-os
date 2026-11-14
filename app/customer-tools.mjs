// Customer-run sandbox (7 Nov 2026, audit E7). A customer's WhatsApp message ran the support agent as a general agent with a
// shell inside the folder that holds the payment keys: two customer runs read .secrets/XENDIT_SECRET_KEY and made real
// invoices, and the engine's own "BLOCKED" stop had just been allowlisted away. Now aqeelOS starts every customer run with
// one tool server only (engine -t aqeelos-customer), and gives the run its own key (env TERMINAL_AQEELOS_CUSTOMER_RUN, put into the
// server's header by the engine), bound to that one conversation and customer. No shell, no files, no other tools:
//   read_sheet       read-only Google Sheets calls through aqeelOS (the agent's own sheets, as before; no key in the run)
//   read_file        the agent's rule and template files (*.md, templates/, sop/, media lists); never hidden files or keys
//   list_files       what read_file can read
//   conversation     this customer's last messages (Kirimdev), nothing from other customers
//   past_chats       this customer's own earlier chat (default), or how the team answered a question before: the team's answers
//                    only, never another customer's words, name, number, address or order (audit 12 Nov 2026, C1; chat-history.mjs)
//   quote_order      the price of an order from the price list aqeelOS holds (price-catalog.mjs); the model never sets a price
//   create_payment   a payment for THIS customer only (the number comes from the run, never from the model). The AMOUNT comes
//                    from code (audit 12 Nov 2026, C2): the model gives product ids and quantities, a shipping choice and a promo
//                    code; the price list gives the total; a form whose total line differs is refused; QRIS parts are split by
//                    code; a tester's small test charge is applied by code only while the line is in Test. Made by aqeelOS itself
//                    with keys agents cannot read (payment-providers.mjs) when the line has payment.provider, else by the
//                    agent's own helper (.tools/qris; a helper that sends by itself is refused outside Test, H2). At most 2 per run,
//                    every call written to DATA/payments.jsonl (with the products bought and the provider's references,
//                    so paid-labels.mjs can label the contact once the payment is confirmed paid)
//                    kind card (8 Nov 2026): the line's card helper (.tools/card: a Xendit card-only invoice), one amount that is
//                    the whole order total, same limits and log; returns the checkout link for the reply
//   check_payment    whether THIS customer's payments were paid, asked from the provider now (paid-labels.mjs); read only (8 Nov 2026)
//   post_order       the order form of THIS customer's PAID order to the team's Orders topic, once per payment; a paid order is
//                    normally posted by itself (paid-labels.mjs), so this is for what that could not cover
//   label_contact    the line's allowed Kirimdev labels on THIS chat's contact only (8 Nov 2026; kirimdev.mjs labelContact
//                    holds the rules), a few per run, each logged with the run id; never a message to the customer
//   website_form     THIS chat's own website quiz/form answers from the line's store admin API (kirimdev.json lines.<agent>.websiteForm
//                    {baseUrl, username, secret, types?, days?}); matched by the run's phone only, never a phone argument
//                    (10 Nov 2026, made by the fixer on the live box; taken into git 11 Nov after two deploys had removed it)
// The engine itself never sees a key: the helper reads the keys as the agent's user, outside the model's reach.
import {readFile,readdir,stat,appendFile,mkdir} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {orderContextOf} from './paid-labels.mjs';
import {quote,quoteText,listText,formTotal,splitAmounts,money} from './price-catalog.mjs';
// the line's order details as given in this tool call
const contextValues=(pr,a)=>Object.fromEntries(orderContextOf(pr).fields.map(f=>[f.key,String(a?.[f.key]||'').trim().slice(0,500)]));

// the highest card link when the line does not say (owner, 8 Nov 2026): QRIS and VA keep the line's own max
export const DEFAULT_CARD_MAX=50000000;
export const cardMaxOf=pr=>Number(pr?.cardMax)||DEFAULT_CARD_MAX;
// the highest virtual account (team rule, 8 Nov 2026): one VA for the whole total, above the QRIS limit
export const DEFAULT_VA_MAX=10000000;
export const vaMaxOf=pr=>Number(pr?.vaMax)||Math.max(Number(pr?.max)||0,DEFAULT_VA_MAX);
const READ_METHODS=new Set(['spreadsheets.values.get','spreadsheets.values.batchGet','spreadsheets.get']);
// bank codes are the payment helper's to check (it knows its provider); here only their shape
const clip=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n-1)+'…':s};
// a workspace file a customer run may read: rules and templates, never hidden files, keys, tools or anything outside. Not every
// top-level *.md is a rule file (audit M9: SALES_RECAP_TASK.md and a decisions file held tester numbers and a member's name, id
// and number): task, recap, tester and watchdog notes are left out, and a line can name its own lists
// (kirimdev.json lines.<agent>.files {allow: [paths], deny: [paths]}; allow, when given, is the whole list).
const NOT_RULES=/(^|[_-])(sales[_-]?recap|recap|task|tasks|tester|testers|watchdog|todo|backlog)([_.-]|$)/i;
export function readable(rel,{allow=null,deny=[]}={}){const r=String(rel||'').replace(/^\.\/+/,'');if(!r||r.startsWith('/')||r.split('/').some(x=>!x||x==='..'||x.startsWith('.')))return false;
 if(/(^|\/)(secrets?|tools|node_modules|tmp|Desktop)(\/|$)/i.test(r)||/\.(bak|orig)|bak-|\.env|key|token|password|secret/i.test(r))return false;
 if((deny||[]).includes(r))return false;if(Array.isArray(allow)&&allow.length)return allow.includes(r);
 return /^[\w-]+\.md$/.test(r)&&!NOT_RULES.test(r)||/^(templates|sop|knowledge|rules)\/[\w ./-]+\.(md|txt|json|csv)$/.test(r)||/^media\/[\w ./-]*urls\.txt$/.test(r)}
// pr: the line's payment setting (kirimdev.json lines.<agent>.payment: {currency, min, max}); none = any whole amount
export const TOOLS=(pay,pr={},lr={},card=false,orders=false,protocol=false,form=false,pdf=false,cat=null)=>{const ids=cat?Object.keys(cat.products):[];const allowed=lr.allowed||[],sales=lr.sales||[],ctxFields=orderContextOf(pr).fields,ctxProps=pre=>Object.fromEntries(ctxFields.map(f=>[f.key,{type:'string',maxLength:500,description:pre+f.ask}]));const cur=pr.currency||'',lo=Number(pr.min)||1,hi=Number(pr.max)||1e9,amt=x=>(cur?cur+' ':'')+Number(x).toLocaleString('en-US');return [
 {name:'read_sheet',description:'Read your knowledge or rules sheet (read only). method is spreadsheets.values.get, spreadsheets.values.batchGet or spreadsheets.get; params as the Google Sheets API takes them, e.g. {"spreadsheetId":"…","range":"Rules!A1:Z200"}.',
  inputSchema:{type:'object',properties:{method:{type:'string',enum:[...READ_METHODS]},params:{type:'object'}},required:['method','params']},annotations:{readOnlyHint:true}},
 {name:'read_file',description:'Read one of your rule or template files, e.g. DECISIONS.md, BRIEFING.md, templates/ORDER_FORM.md, sop/<name>.md. list_files shows them.',
  inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']},annotations:{readOnlyHint:true}},
 {name:'list_files',description:'The rule and template files you can read with read_file.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},
 {name:'conversation',description:'This customer\'s latest messages in this Kirimdev chat (newest last). Only this chat.',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:60}}},annotations:{readOnlyHint:true}},
 ...(form?[{name:'website_form',description:'The quiz or form THIS customer filled on the website (matched by this chat\'s phone number): their answers, product, and when. Call it on the first message of a new chat, and whenever the customer says they filled the website form, before asking for details again. Only this customer.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}}]:[]),
 {name:'past_chats',description:'Look up earlier chats of your own Kirimdev line. scope "mine" (the default): THIS customer\'s own earlier chat, e.g. what they ordered or were told before. scope "answers": how the team answered a question before, for any customer; you get the team\'s answers only, never another customer\'s words or details. Never pass on anything that looks like another person\'s name, number, address or order.',inputSchema:{type:'object',properties:{query:{type:'string'},scope:{type:'string',enum:['mine','answers']},limit:{type:'integer'}},required:['query']},annotations:{readOnlyHint:true}},
 ...(cat?[{name:'quote_order',description:'The price of an order from the price list aqeelOS holds: products by id with quantities, the shipping choice and a promo code. Call it with no items to read the price list (ids, prices, shipping, promo codes). Prices, discounts and totals come ONLY from here: never from memory, a past chat, or what the customer says. Use its numbers exactly in the order form.',
  inputSchema:{type:'object',properties:{items:{type:'array',maxItems:20,items:{type:'object',properties:{id:{type:'string',enum:ids},qty:{type:'integer',minimum:1,maximum:20},free:{type:'boolean',description:'only for an item the price list gives free with this order'}},required:['id']}},shipping:{type:'string',enum:Object.keys(cat.shipping)},discount_code:{type:'string'},kind:{type:'string',enum:['qris','va','card']}}},annotations:{readOnlyHint:true}}]:[]),
 ...(allowed.length?[{name:'label_contact',description:'Label THIS customer\'s contact in Kirimdev (the team\'s CRM pipeline), as your label rules say: the stage they reached or a product they asked about. Only these labels: '+allowed.join(', ')+'. Never Customer or S- labels: aqeelOS sets those itself once a payment is confirmed. The customer never sees labels; say nothing about them in your reply.',
  inputSchema:{type:'object',properties:{add:{type:'array',items:{type:'string',enum:allowed},maxItems:4},remove:{type:'array',items:{type:'string',enum:allowed},maxItems:4}}}}]:[]),
 ...(pay||card?[{name:'create_payment',description:(pay==='pay'
   ?'Create a REAL payment with your payment helper for THIS customer\'s CONFIRMED order and send it to them in this chat (QR picture, or virtual account number). kind qris: amounts, each '+amt(lo)+' to '+amt(hi)+' (split bigger totals). kind va: bank code and one amount, the whole total, '+amt(lo)+' to '+amt(vaMaxOf(pr))+'. Use once per confirmed order; again only if the customer says it expired (expired true). After it succeeds, do not repeat the payment in your reply; say it was sent.'
   :pay==='app'?'Create a REAL payment for THIS customer\'s CONFIRMED order. kind qris returns [FOTO: …] lines: put each on its own line in your reply so the QR picture is sent (totals above '+amt(hi)+' become several QR codes by themselves). kind va (bank code, e.g. BCA) returns the bank, the VA number, the amount and until when it is valid: put them in your reply exactly as given. Use once per confirmed order; again only if the customer says it expired (expired true).'
   :pay?'Create a REAL QR payment with your payment helper for THIS customer\'s CONFIRMED order total. Returns [FOTO: …] lines: put each on its own line in your reply so the QR picture is sent. Use once per confirmed order; again only if the customer says it expired (expired true).':'Create a REAL payment with your payment helper for THIS customer\'s CONFIRMED order.')+(card?' kind card, only when the customer chose credit or debit card: one link for the whole order, never split, '+amt(lo)+' to '+amt(cardMaxOf(pr))+'. Returns a checkout link: put it in your reply exactly as given. Never ask for card numbers in chat.':'')
   +(cat?' You never give an amount: give the items (product ids and quantities, as in quote_order), the shipping choice and the promo code, and aqeelOS charges the price list\'s total. The order form the customer confirmed must show that same total, or the payment is refused.':' The amount is the total line of the order form the customer confirmed ("Total Pembayaran: Rp…"); order_total must be that same number.'),
  inputSchema:{type:'object',properties:{kind:{type:'string',enum:[...(pay==='pay'||pay==='app'?['qris','va']:pay?['qris']:[]),...(card?['card']:[])]},
   ...(cat?{items:{type:'array',minItems:1,maxItems:20,items:{type:'object',properties:{id:{type:'string',enum:ids},qty:{type:'integer',minimum:1,maximum:20},free:{type:'boolean'}},required:['id']},description:'What the order buys: product ids of the price list with quantities'},shipping:{type:'string',enum:Object.keys(cat.shipping)},discount_code:{type:'string',description:'The promo code the customer gave, if any; only codes of the price list count'}}
    :{amounts:{type:'array',items:{type:'integer',minimum:lo,maximum:Math.max(hi,card?cardMaxOf(pr):0,pay==='pay'||pay==='app'?vaMaxOf(pr):0)},minItems:1,maxItems:5,description:'Optional: the parts of the total; left out, aqeelOS splits it'}}),
   bank:{type:'string',description:'The bank code the payment helper accepts, e.g. BCA'},name:{type:'string',description:'The customer\'s name from the order form'},order_form:{type:'string',maxLength:3000,description:'The filled order form exactly as the customer confirmed it, with its total line. The team gets it in their Orders topic once this payment is paid.'},order_total:{type:'integer',description:'The total on the confirmed order form'},expired:{type:'boolean'},...ctxProps('Ask before the order is final. '),
   products:{type:'array',items:sales.length?{type:'string',enum:sales}:{type:'string'},maxItems:12,description:'What the order buys, as the sales labels'+(sales.length?'':' (S- names)')+': one per product in the order form (a reusable pen is S-Pen). Set on the customer\'s contact only once the payment is confirmed paid.'}},required:cat?['items','name','order_form']:['name','order_total','order_form']}},
 {name:'check_payment',description:'Whether THIS customer\'s payments made through you were paid, asked from the payment provider now: PAID, UNPAID, EXPIRED or PARTLY_PAID, with the amount. Use it whenever the customer says they paid, asks if it arrived, or sends a receipt. Only PAID means confirmed; a receipt picture never does.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},
 ...(protocol?[{name:'get_protocol',description:'The protocol(s) the experts set on THIS customer\'s member profile (member app), found by this chat\'s own number: name, product, frequency, week-by-week dose in mg and units, instructions. Read only. Send it to the customer as given; if no member or no protocol is found, never guess one: hand off to the team.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}}]:[]),
 ...(pdf?[{name:'send_protocol_pdf',description:'Send the protocol PDF of THIS customer (from the member app, all protocols the experts set) to them in this chat as a WhatsApp document. It goes only to the own number of this chat, once per run. Use it when the experts have set the protocol (get_protocol shows it) and the customer should have it. If no member or no protocol is found, nothing is sent: hand off to the team. After it succeeds, tell the customer in your reply that the PDF was sent; never paste its contents again.',inputSchema:{type:'object',properties:{}}}]:[]),
 ...(orders?[{name:'post_order',description:'Post the filled order form of THIS customer\'s PAID order to the team\'s Orders topic. A paid order is normally posted by itself, so use this only if the team says it is missing. Works only once check_payment shows PAID, and once per payment.',inputSchema:{type:'object',properties:{order_form:{type:'string',maxLength:3000},...ctxProps('')},required:['order_form',...ctxFields.map(f=>f.key)]}}]:[])]:[])]};

// every customer tool takes the run's key (given in the run's instructions); calls without a live key are refused
export const RUN_FIELD={type:'string',description:'Your run key, exactly as given in your instructions for this chat.'};
export const withRun=tools=>tools.map(t=>({...t,inputSchema:{...t.inputSchema,properties:{run:RUN_FIELD,...(t.inputSchema?.properties||{})},required:['run',...(t.inputSchema?.required||[]).filter(x=>x!=='run')]}}));

// a payment the helper made but could not deliver to the customer ('status failed' in its answer) is not a payment made for the customer (11 Nov 2026, taken into git from the box's drift)
export const deliveryFailed=out=>/\bstatus failed\b/i.test(String(out||''));
export function createCustomerTools({WORK,DATA,catalogOf=async()=>null,providers=null,keyOf=null,noteSend=null,fileRules=async()=>null,protocolText=null,formRules=async()=>null,fetchFn=(...a)=>fetch(...a),payments=null,ordersOf=async()=>null,payRules=async()=>({}),labelRules=async()=>({}),labelContact=null,pdfRules=async()=>null,sendProtocolPdf=null,googleCall,chatFind,history,runAsAgent,log=m=>console.log(m),now=()=>Date.now(),random=n=>randomBytes(n)}){
 const runs=new Map();
 // website_form: the line's store admin API (settings: formRules(agent) -> {baseUrl, username, secret, types, days}); login cached 10 min
 const formLogins=new Map();
 const normPhone=x=>{let d=String(x||'').replace(/\D/g,'');if(d.startsWith('0'))d='62'+d.slice(1);return d};
 async function websiteForm(agent,phone){const f=await formRules(agent).catch(()=>null);if(!f?.baseUrl||!f?.username||!f?.secret)return {isError:true,text:'This line has no website form source.'};
  if(!/^[A-Za-z0-9_]+$/.test(String(f.secret)))return {isError:true,text:'The website form setting is wrong.'};
  const me=normPhone(phone);if(me.length<8)return {isError:true,text:'This chat has no customer number.'};
  const base=String(f.baseUrl).replace(/\/+$/,''),key=agent+' '+base;
  const login=async()=>{const pw=keyOf?await keyOf(agent,String(f.secret)):(await readFile(path.join(WORK,agent,'.secrets',String(f.secret)),'utf8')).trim();if(!pw)throw new Error('the store password is not saved for this line');
   const x=await fetchFn(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:f.username,password:pw})});
   if(!x.ok)throw new Error('store login failed ('+x.status+')');const ck=(typeof x.headers.getSetCookie==='function'?x.headers.getSetCookie():[x.headers.get('set-cookie')||'']).map(c=>String(c).split(';')[0]).filter(Boolean).join('; ');
   const v={cookie:ck,at:now()};formLogins.set(key,v);return v};
  let l=formLogins.get(key);if(!l||now()-l.at>10*60e3)l=await login();
  const get=c=>fetchFn(base+'/api/admin/business?days='+(Number(f.days)||30),{headers:{cookie:c.cookie,accept:'application/json'}});
  let x=await get(l);if(x.status===401||x.status===403){l=await login();x=await get(l)}if(!x.ok)throw new Error('store answered '+x.status);
  const d=await x.json(),ids=new Set((d.contacts||[]).filter(c=>c&&normPhone(c.phone)===me).map(c=>c.id));
  const types=Array.isArray(f.types)&&f.types.length?f.types:['program_quiz','consultation_submitted'];
  const acts=(d.activities||[]).filter(a=>a&&ids.has(a.contactId)&&types.includes(a.type)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,5);
  if(!acts.length)return {text:'No website quiz or form from this customer\'s number in the last '+(Number(f.days)||30)+' days. If they say they filled it, they may have used another number: ask them for the answers.'};
  return {text:clip(acts.map(a=>[String(a.createdAt||'').slice(0,16).replace('T',' ')+' UTC · '+a.type+(a.product?' · '+a.product:'')+(a.source||a.page?' · '+(a.source||a.page):''),String(a.message||'')].join('\n')).join('\n\n'),8000)}}
 // the agent's payment helper: the line's setting (kirimdev.json lines.<agent>.payment.helper {path, style}), else the
 // usual names in its workspace. style "send": it sends the payment itself (qris|va amounts --name --to <number>);
 // style "picture": it prints [FOTO: …] lines for the reply (amounts --name --phone <number>)
 const helperOf=async a=>{const h=(await payRules(a).catch(()=>({}))||{}).helper;
  if(h?.path&&/^[\w.\/-]+$/.test(h.path)&&!h.path.split('/').includes('..')&&await stat(path.join(WORK,a,h.path)).catch(()=>null))return {path:h.path,style:h.style==='send'?'send':'picture'};
  if(await stat(path.join(WORK,a,'.tools','pay')).catch(()=>null))return {path:'.tools/pay',style:'send'};
  if(await stat(path.join(WORK,a,'.tools','qris')).catch(()=>null))return {path:'.tools/qris',style:'picture'};return null};
 // the card helper: the line's setting (payment.card, a file in its folder), else .tools/card when it has one
 const cardOf=async a=>{const v=(await payRules(a).catch(()=>({}))||{}).card,p=typeof v==='string'?v:v?.path;
  if(p&&/^[\w.\/-]+$/.test(p)&&!p.split('/').includes('..')&&!p.startsWith('/')&&await stat(path.join(WORK,a,p)).catch(()=>null))return p;
  return await stat(path.join(WORK,a,'.tools','card')).catch(()=>null)?'.tools/card':null};
 // the member-app protocol reader: the line's setting (payment.protocol, a file in its folder), else .tools/protocol (10 Nov 2026)
 const protocolOf=async a=>{const v=(await payRules(a).catch(()=>({}))||{}).protocol,p=typeof v==='string'?v:v?.path;
  if(p&&/^[\w.\/-]+$/.test(p)&&!p.split('/').includes('..')&&!p.startsWith('/')&&await stat(path.join(WORK,a,p)).catch(()=>null))return p;
  return await stat(path.join(WORK,a,'.tools','protocol')).catch(()=>null)?'.tools/protocol':null};
 // 'app' = aqeelOS makes the payment itself (payment-providers.mjs, the line's payment.provider); else the agent's own helper
 const payKind=async a=>{if(providers&&await providers.can(a,await payRules(a).catch(()=>({}))||{},'qris').catch(()=>false))return 'app';const h=await helperOf(a);return h?(h.style==='send'?'pay':'qris'):null};
 const cardKind=async a=>!!(providers&&await providers.can(a,await payRules(a).catch(()=>({}))||{},'card').catch(()=>false))||!!await cardOf(a);
 // a run's key: made by aqeelOS when it starts a customer run, ends with it (15 minutes at most)
 function begin({agent,line,conversation,phone,mode,tester=false,since=''}){const token=random(24).toString('base64url');runs.set(token,{agent,line,conversation,since,phone:String(phone||'').replace(/\D/g,''),mode,tester:!!tester,at:now(),payments:0,labels:0,id:'r'+random(4).toString('hex')});return token}
 function end(token){runs.delete(token)}
 function runOf(agent,token){const r=runs.get(String(token||''));if(!r||r.agent!==agent||now()-r.at>15*60e3)return null;return r}
 async function files(a){const out=[];const W=path.join(WORK,a),fr=await fileRules(a).catch(()=>null)||{};const walk=async(d,depth)=>{for(const e of await readdir(path.join(W,d),{withFileTypes:true}).catch(()=>[])){const rel=d?d+'/'+e.name:e.name;
   if(e.isDirectory()&&depth<2&&!e.name.startsWith('.'))await walk(rel,depth+1);else if(e.isFile()&&readable(rel,fr))out.push(rel)}};await walk('',0);return out.sort()}
 const payLog=async e=>{await mkdir(DATA,{recursive:true});await appendFile(path.join(DATA,'payments.jsonl'),JSON.stringify({at:new Date(now()).toISOString(),...e})+'\n',{mode:0o600})};
 async function call(agent,token,name,args={}){const r=runOf(agent,token);if(!r)return {isError:true,text:'These tools only work inside a customer chat run.'};
  try{
   if(name==='read_sheet'){const m=String(args.method||'');if(!READ_METHODS.has(m))return {isError:true,text:'Only reading: '+[...READ_METHODS].join(', ')+'.'};
    const x=await googleCall(agent,{service:'sheets',version:'v4',method:m,params:args.params||{}});return {isError:x.status!==200,text:clip(JSON.stringify(x.json),60000)}}
   if(name==='website_form'){const x=await websiteForm(agent,r.phone);log('customer run '+agent+' '+r.id+': website_form '+(x.isError?'failed':'read'));return x}
   if(name==='list_files')return {text:(await files(agent)).join('\n')||'No rule files.'};
   if(name==='read_file'){const rel=String(args.path||'').replace(/^\/home\/[^/]+\/workspaces\/[^/]+\//,'');if(!readable(rel,await fileRules(agent).catch(()=>null)||{}))return {isError:true,text:'Not a rule or template file you can read here. list_files shows them.'};
    const t=await readFile(path.join(WORK,agent,rel),'utf8').catch(()=>null);return t==null?{isError:true,text:'No such file.'}:{text:clip(t,60000)}}
   if(name==='conversation')return {text:await history(r,Math.min(60,Math.max(1,+args.limit||30)))};
   // this customer's own earlier chat by default; "answers" = what the team answered before, masked. The conversation is the run's, never the model's.
   if(name==='past_chats'){const scope=args.scope==='answers'?'answers':'mine';const x=await chatFind(agent,String(args.query||''),{limit:args.limit,scope,conversation:r.conversation||''});log('customer run '+agent+' '+r.id+': past_chats ('+scope+')');return {isError:!!x.error,text:String(x.text||'')}}
   if(name==='quote_order'){const cat=await catalogOf(agent).catch(()=>null);if(!cat)return {isError:true,text:'This line has no price list in aqeelOS. Take prices from your knowledge sheet; the total of an order is the total line of the order form.'};
    if(!Array.isArray(args.items)||!args.items.length)return {text:listText(cat)};
    const q=quote(cat,{items:args.items,shipping:args.shipping,discount:args.discount_code,kind:args.kind},{now:now()});
    return q.ok?{text:quoteText(q,cat.currency)+'\nUse exactly these numbers in the order form. Never change a price, a discount or the total yourself.'}:{isError:true,text:q.why}}
   if(name==='create_payment'){const k=String(args.kind||'qris');if(!['qris','va','card'].includes(k))return {isError:true,text:'kind is qris, va or card.'};
    const pr=await payRules(agent).catch(()=>({}))||{},lo=Number(pr.min)||1,hi=k==='card'?cardMaxOf(pr):k==='va'?vaMaxOf(pr):Number(pr.max)||1e9,cur=pr.currency?pr.currency+' ':'';
    // who makes it: aqeelOS itself when the line has a provider and the keys are in its reach, else the agent's own helper
    const app=!!(providers&&await providers.can(agent,pr,k).catch(()=>false));
    const cardPath=k==='card'&&!app?await cardOf(agent):null;if(k==='card'&&!app&&!cardPath)return {isError:true,text:'This line has no card payment helper. Hand off to the team.'};
    const helper=app?{path:'aqeelOS',style:'app'}:k==='card'?{path:cardPath,style:'card'}:await helperOf(agent);const kind=helper?(helper.style==='app'?'app':helper.style==='send'?'pay':helper.style==='card'?'card':'qris'):null;if(!kind)return {isError:true,text:'You have no payment helper (set one in the line\'s payment settings).'};
    // a helper that sends the payment to the customer by itself goes past aqeelOS's one exit (mode, pause, the exit guard): only a
    // tester in Test may get one; in Draft it would send a real QR nobody approved, in Live it paused the chat (audit H2)
    if(kind==='pay'&&r.mode!=='test')return {isError:true,text:'This line\'s payment helper sends to the customer by itself, which is not allowed in '+(r.mode==='draft'?'Draft':'Live')+'. No payment was made. Tell the customer the team will send the payment, and hand off.'};
    if(!r.phone)return {isError:true,text:'This chat has no customer number.'};
    const lr=await labelRules(agent).catch(()=>({}))||{};let products=[...new Set([].concat(args.products||[]).map(x=>String(x||'').trim()).filter(Boolean))];
    const wrong=products.filter(x=>!/^S-/.test(x)||(lr.sales?.length&&!lr.sales.includes(x)));if(wrong.length)return {isError:true,text:'products are sales labels'+(lr.sales?.length?' ('+lr.sales.join(', ')+')':' (S- names)')+', not '+wrong.join(', ')+'.'};
    const form=String(args.order_form||'').trim();
    if(form.length<80||(form.match(/^[^\n:]{2,40}:[ \t]*\S/gm)||[]).length<3)return {isError:true,text:'order_form must be the full filled order form exactly as the customer confirmed it (every field: name, address, phone, items...), not empty or a summary. Call again with the whole form.'};
    let given=[].concat(args.amounts||[]).map(Number);
    if(given.length&&given.some(x=>!Number.isInteger(x)||x<lo||x>hi))return {isError:true,text:'Each amount is a whole number from '+lo+' to '+hi+'.'};
    // ---- the amount comes from code (audit C2): the price list when the line has one, else the total line of the confirmed form
    const cat=await catalogOf(agent).catch(()=>null),ft=formTotal(form);let q=null,orderTotal,pay;
    if(cat){q=quote(cat,{items:args.items,shipping:args.shipping,discount:args.discount_code,kind:k},{now:now()});if(!q.ok)return {isError:true,text:q.why+(Array.isArray(args.items)&&args.items.length?'':'\n\n'+listText(cat))};
     orderTotal=q.total;pay=k==='card'?q.charge:q.total;
     if(ft==null)return {isError:true,text:'The order form has no total line. The customer must have confirmed the total they pay: put "Total Pembayaran: '+money(q.total,cat.currency)+'" in the form (the price list\'s total), ask them to confirm, then call again.\n'+quoteText(q,cat.currency)};
     if(ft!==q.total&&ft!==q.charge)return {isError:true,text:'No payment was made. The order form says '+money(ft,cat.currency)+' but the price list gives '+money(q.total,cat.currency)+':\n'+quoteText(q,cat.currency)+'\nSend the customer the corrected order form and ask them to confirm it, then call again. Never change a price, a discount or the total yourself; if the customer was promised another price, hand off.'};
     products=[...new Set([...products,...q.labels.filter(x=>!lr.sales?.length||lr.sales.includes(x))])]}
    else{if(r.mode!=='test'&&pr.prices!=='form')return {isError:true,text:'No payment was made: this line has no price list in aqeelOS yet, so it can take payments in Test only. Tell the customer the team will send the payment, and hand off.'};
     if(ft==null)return {isError:true,text:'No payment was made: the order form has no total line ("Total Pembayaran: Rp…"). The amount charged is the total the customer confirmed on the form. Send the full form with its total, ask them to confirm, then call again.'};
     orderTotal=pay=ft}
    if(args.order_total!=null&&Number(args.order_total)!==orderTotal&&Number(args.order_total)!==pay){
     if(given.length&&given.reduce((s,x)=>s+x,0)===Number(args.order_total))return {isError:true,text:'No payment was made. You gave '+args.order_total+', but '+(cat?'the price list gives ':'the confirmed order form says ')+orderTotal+'. The amount is never yours to set: '+(cat?'it is the price list\'s total':'it is the total line of the form the customer confirmed')+'. If the form is wrong, send the corrected form and ask the customer to confirm it.'};
     return {isError:true,text:(given.length?'The amounts add up to '+given.reduce((s,x)=>s+x,0)+', not the order total '+args.order_total+'. ':'')+'order_total '+args.order_total+' is not the total of this order ('+orderTotal+'). Check the order form.'}}
    if(given.length&&given.reduce((s,x)=>s+x,0)!==pay)return {isError:true,text:'The amounts add up to '+given.reduce((s,x)=>s+x,0)+', not the order total '+pay+'. Check the order form.'};
    if(k==='card'&&given.length>1)return {isError:true,text:'A card link is one amount: the whole order total.'};
    if(k==='va'&&(kind!=='pay'&&kind!=='app'||!/^[A-Z0-9_]{2,20}$/.test(String(args.bank||'').toUpperCase())||given.length>1))return {isError:true,text:'A VA needs a bank code and one amount.'};
    // the parts: as given when they are right, else split by code (a QRIS carries at most the line's max)
    const isTest=r.mode==='test'&&!!r.tester;   // a tester of a Test line pays the small test amount for every kind (QRIS, VA, card), so the real range does not apply
    let amounts=given.length?given:k==='qris'?splitAmounts(pay,{min:lo,max:hi}):pay>=lo&&pay<=hi?[pay]:null;
    if(!amounts&&isTest)amounts=[pay];
    if(!amounts)return {isError:true,text:'A total of '+cur+pay+' cannot be paid by '+k+' here (each '+k+' payment is '+lo+' to '+hi+(k==='qris'?', five parts at most':'')+'). Offer another payment method, or hand off.'};
    let total=pay;
    if(r.payments>=2)return {isError:true,text:'Two payments were already made in this run. If something is wrong, hand off to the team.'};
    // the same total for the same customer within 30 minutes is a repeat, unless the customer said it expired
    const recent=(await readFile(path.join(DATA,'payments.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean)
     .find(p=>p.agent===agent&&p.phone===r.phone&&(p.orderTotal??p.total)===total&&p.ok&&!deliveryFailed(p.out)&&(p.kind==='card')===(k==='card')&&now()-Date.parse(p.at)<30*60e3);   // switching to or from card is a new payment
    // still valid: it is sent again instead of refused (14 Nov 2026: the refusal left the agent no way to resend a QRIS, so it handed off;
    // "almost every QRIS has to be escalated"). A new payment only when the customer says it expired.
    if(recent&&!args.expired){const tags=recent.tags||[...String(recent.out||'').matchAll(/\[FOTO:[^\]]+\]/g)].map(m=>m[0]),again=recent.resend||'';
     log('customer run '+agent+' '+r.id+': payment '+k+' '+cur+total+' for …'+r.phone.slice(-4)+' still valid; sent again');
     if(tags.length)return {text:'This customer already has a valid '+k.toUpperCase()+' for '+cur+total+' (made '+recent.at.slice(11,16)+' UTC). Send it again: put each tag on its own line in your reply:\n'+tags.join('\n')+'\nOnly if the customer says it expired, call create_payment again with expired true.',resent:true};
     if(again)return {text:again+'\nThis is the payment already made for this customer at '+recent.at.slice(11,16)+' UTC and still valid: give these details again exactly as shown. Only if the customer says it expired, call create_payment again with expired true.',resent:true};
     return {isError:true,text:'A payment for '+cur+total+' was already made for this customer at '+recent.at.slice(11,16)+' UTC. Only make a new one if the customer says it expired (expired true).'}}
    // a tester pays a small test payment (QRIS, VA or card) instead of the order total: the line's payment.testAmount, else 10000. Applied HERE, by code, and only
    // while the line is in Test and the run's number is one of its testers right now; the model cannot ask for it, and no rule file can
    // (audit C2: a rule file said "test numbers always get Rp10.000" and the model charged that for orders of millions)
    const testAmt=isTest?(Number.isInteger(Number(pr.testAmount))&&Number(pr.testAmount)>0?Number(pr.testAmount):10000):0;
    if(testAmt){amounts.splice(0,amounts.length,testAmt);total=testAmt}
    const nm=clip(String(args.name||'').replace(/[^\p{L}\p{N} .,'-]/gu,'').trim(),60)||'Customer';
    r.payments++;let x;
    if(kind==='app')x=await providers.create(agent,pr,k,{amounts,amount:amounts[0],bank:String(args.bank||'').toUpperCase(),name:nm,phone:r.phone,items:products});
    else{const argv=k==='card'?[String(amounts[0]),'--name',nm,'--phone',r.phone,...(products.length?['--items',...products]:[])]:kind==='pay'?(k==='va'?['va',String(args.bank).toUpperCase(),String(amounts[0])]:['qris',...amounts.map(String)]).concat(['--name',nm,'--to',r.phone]):[...amounts.map(String),'--name',nm,'--phone',r.phone];
     const go=runAsAgent(agent,helper.path,argv);
     // a helper that sends by itself (Test only): while it runs its echo waits, and the message ids it prints are ours, so the echo is not
     // taken for a team member's reply and this run's own reply is not dropped (audit H2: 31 of 38)
     x=kind==='pay'&&noteSend?await noteSend(agent,r.phone,go.then(v=>({...v,ids:[...String(v?.out||'').matchAll(/WhatsApp\s+(\S+)\s+status/g)].map(m=>m[1]).filter(i=>i&&i!=='None')}))):await go}
    // the provider's references in the helper's answer (Tripay: T… references, or our BM-… order refs the helper keeps in tmp/)
    const out=String(x.out||''),refs=x.refs||[...new Set(out.match(/\bT\d{5,}[0-9A-Z]{4,}\b/g)||[])],orders=x.orders||[...new Set(out.match(/\b[A-Z]{2,4}-\d{9,11}-\d{1,2}\b/g)||[])],invoices=k==='card'?x.invoices||[...new Set(out.match(/\b[0-9a-f]{24}\b/g)||[])]:[];
    await payLog({agent,line:r.line,conversation:r.conversation,phone:r.phone,mode:r.mode,run:r.id,kind:k,amounts,total,products,refs,orders,name:nm,form:clip(form,3000),context:contextValues(pr,args),...(k==='card'?{invoices}:{}),...(testAmt?{testAmount:true,orderTotal}:{}),
     priced:cat?'list':'form',by:kind==='app'?'aqeelOS':helper.path,...(q?{items:q.lines.map(l=>({id:l.id,qty:l.qty,...(l.free?{free:true}:{})})),...(q.discount?{discount:q.discount.code}:{}),...(q.shipping?{shipping:q.shipping.id}:{}),...(q.fee?{fee:q.fee}:{})}:{}),...(args.expired?{expired:true}:{}),ok:x.ok,out:clip(x.out||x.err,400),tags:[...new Set([...String(x.out||'').matchAll(/\[FOTO:[^\]]+\]/g)].map(m=>m[0]))],...(x.ok&&(k==='va'||k==='card')?{resend:clip(k==='card'?out.split(' | ').slice(0,3).join(' | '):out,1000)}:{})});
    log('customer run '+agent+': payment '+k+' '+cur+total+' for …'+r.phone.slice(-4)+(x.ok?' made':' failed'));
    // card: the link, amount and expiry for the reply; the provider's ids stay in the log
    if(x.ok&&k==='card')return {text:out.split(' | ').slice(0,3).join(' | ').trim()+'\nPut this link in your reply exactly as given.'+(q?.fee?'\nShow the customer: order total '+money(q.total,cat.currency)+', card fee '+q.feePercent+'% '+money(q.fee,cat.currency)+', paid by card '+money(q.charge,cat.currency)+'.':'')};
    if(x.ok&&deliveryFailed(out)){log('customer run '+agent+' '+r.id+': payment '+k+' made but delivery failed: '+clip(out,200));r.payments=Math.max(0,r.payments-1);
     return {text:clip(out,1000)+'\nThe payment was made but sending it to the customer FAILED (the customer has NOT received it). Call create_payment again once with the same details to send it again; if that fails too, hand off. Do not tell the customer it was sent.'}}
    if(x.ok&&kind==='app'&&k==='va')return {text:clip(out,1000)+'\nPut the bank, the VA number, the amount and until when it is valid in your reply exactly as given.'};
    if(x.ok&&kind==='app')return {text:clip(out,4000)+'\nPut each [FOTO: …] tag on its own line in your reply so the QR picture is sent, and say the amount'+(testAmt?' (a small TEST amount for a tester of this line; it stands for the whole order)':'')+'.'};
    return x.ok?{text:clip(x.out,4000)}:{isError:true,text:'The payment was not made: '+clip(x.err||x.out,600)+'. Tell the customer you are checking, and hand off.'}}
   if(name==='check_payment'){if(!payments||!r.phone)return {isError:true,text:'Payment checks are not available in this chat.'};
    r.checks=(r.checks||0)+1;if(r.checks>5)return {isError:true,text:'Already checked five times in this run. Tell the customer the team is checking.'};
    const pr=await payRules(agent).catch(()=>({}))||{},cur=pr.currency?pr.currency+' ':'',l=await payments.statusFor(agent,r.phone,{line:r.line,conversation:r.conversation,since:r.since,run:r.id});
    if(!l.length)return {text:'No payment made for this order yet (or its payment was already confirmed for an earlier order). Do not say this order was paid.'};
    return {text:l.map(p=>p.at.slice(0,16).replace('T',' ')+' UTC, '+p.kind+', '+cur+Number(p.total).toLocaleString('en-US')+': '+p.status+(p.testAmount?' (TEST payment for a tester: it stands for the full order of '+cur+Number(p.orderTotal||p.total).toLocaleString('en-US')+'; if PAID, treat the whole order as paid and confirmed)':'')).join('\n')+'\nPAID means confirmed: then send your payment-confirmed message right away and do not say the team is still checking. For anything else, say the team is still checking; do not say it was paid.'}}
   if(name==='post_order'){if(!payments||!r.phone)return {isError:true,text:'Orders cannot be posted from this chat.'};const form=clip(String(args.order_form||'').trim(),3000);if(!form)return {isError:true,text:'Give the filled order form.'};const pr=await payRules(agent).catch(()=>({}))||{},ctx=contextValues(pr,args),gap=orderContextOf(pr).fields.filter(f=>!ctx[f.key]);if(gap.length)return {isError:true,text:'Give '+gap.map(f=>f.key+' ('+f.ask+')').join(' and ')+'. Ask the customer first if you do not know them.'};
    const x=await payments.postOrder(agent,r.phone,form,ctx);log('customer run '+agent+' '+r.id+': post_order '+(x.posted?'posted':'not posted'));return x.posted?{text:'Posted to the Orders topic.'}:{isError:!x.already,text:x.why}}
   // one member only (audit H8a): the box's own script printed every member who shares the number. With the line's protocol setting aqeelOS
   // reads the member app itself (protocol-pdf.mjs: exactly one member, or nothing); a helper's answer that names more than one member is refused.
   if(name==='get_protocol'){const cfg=protocolText?await pdfRules(agent).catch(()=>null):null,p=cfg?null:await protocolOf(agent);if(!cfg&&!p)return {isError:true,text:'Protocols are not available on this line.'};if(!r.phone)return {isError:true,text:'This chat has no customer number.'};
    r.protocols=(r.protocols||0)+1;if(r.protocols>3)return {isError:true,text:'Already read three times in this run.'};
    if(cfg){try{const x=await protocolText(agent,r.phone,cfg);log('customer run '+agent+' '+r.id+': get_protocol for …'+r.phone.slice(-4)+(x.none?' nothing':' read'));
      return x.none?{text:x.none+' Do not guess a protocol and do not ask the customer who the other member is: hand off to the team.'}:{text:clip(x.text,8000)}}
     catch(e){log('customer run '+agent+' '+r.id+': get_protocol failed: '+clip(e.message,120));return {isError:true,text:'The protocol could not be read: '+clip(e.message,300)+'. Tell the customer the team will send it, and hand off.'}}}
    const x=await runAsAgent(agent,p,['--phone',r.phone]);log('customer run '+agent+' '+r.id+': get_protocol for …'+r.phone.slice(-4)+(x.ok?' read':' failed'));
    if(x.ok&&new Set([...String(x.out||'').matchAll(/^Member(?: |: )([^:\n]+?)(?::|$)/gm)].map(m=>m[1].trim().toLowerCase())).size>1)return {text:'More than one member has this number, so it is not certain whose protocol this is. Nothing is given. Do not guess: hand off to the team.'};
    return x.ok?{text:clip(x.out,8000)}:{isError:true,text:'The protocol could not be read: '+clip(x.err||x.out,300)+'. Tell the customer the team will send it, and hand off.'}}
   if(name==='send_protocol_pdf'){const cfg=await pdfRules(agent).catch(()=>null);if(!cfg||!sendProtocolPdf)return {isError:true,text:'Protocol PDFs are not available on this line.'};if(!r.phone)return {isError:true,text:'This chat has no customer number.'};
    r.pdfs=(r.pdfs||0)+1;if(r.pdfs>1)return {isError:true,text:'The protocol PDF was already sent (or tried) in this run.'};
    try{const x=await sendProtocolPdf(agent,{phone:r.phone,conversation:r.conversation},cfg);
     if(x.none){log('customer run '+agent+' '+r.id+': send_protocol_pdf for …'+r.phone.slice(-4)+' nothing to send');return {text:x.none+' Nothing was sent. Do not guess a protocol; hand off to the team.'}}
     log('customer run '+agent+' '+r.id+': send_protocol_pdf to …'+r.phone.slice(-4)+' sent');return {text:'The protocol PDF was sent to the customer as a WhatsApp document. Tell them it was sent; do not paste its contents again.'}}
    catch(e){log('customer run '+agent+' '+r.id+': send_protocol_pdf failed: '+clip(e.message,120));return {isError:true,text:'The PDF was not sent: '+clip(e.message,300)+'. Tell the customer the team will send it, and hand off.'}}}
   if(name==='label_contact'){if(!labelContact)return {isError:true,text:'Labels are not available here.'};
    const add=[].concat(args.add||[]),remove=[].concat(args.remove||[]);if(r.labels+add.length+remove.length>6)return {isError:true,text:'Six label changes per chat run at most. Leave the rest to the team.'};
    if(!r.conversation)return {isError:true,text:'This chat has no Kirimdev conversation.'};
    const x=await labelContact(agent,{conversationId:r.conversation,phone:r.phone,add,remove,source:'agent',run:r.id});r.labels+=add.length+remove.length;
    log('customer run '+agent+' '+r.id+': labels '+[...add.map(v=>'+'+v),...remove.map(v=>'-'+v)].join(' ')+(x.set?' set':x.proposed?' proposed':' not set'));
    return {text:x.set?'Done'+(x.changed?.length?': '+x.changed.join(', '):' (already so)')+'. Say nothing about labels to the customer.':x.why}}
   return {isError:true,text:'Unknown tool.'}}
  catch(e){return {isError:true,text:clip(e.message,400)}}}
 // the MCP endpoint body: JSON-RPC in, {status,body} out
 async function mcp(agent,token,msg){const rpc=result=>({status:200,body:{jsonrpc:'2.0',id:msg.id,result}});
  if(msg.method==='initialize')return rpc({protocolVersion:msg.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'aqeelos-customer',version:'1.0.0'}});
  if(msg.method==='notifications/initialized'||msg.id==null)return {status:202,body:''};
  if(msg.method==='ping')return rpc({});
  // outside a customer run (the engine's own connection) the list is empty: these tools exist only inside a run
  // listed on every connection (7 Nov 2026): the engine's gateway runs customer turns over its own shared connection, which
  // never carries a run's header, so the key travels in the run's instructions and in each call (run). No key, no answer.
  if(msg.method==='tools/list')return rpc({tools:withRun(TOOLS(await payKind(agent),await payRules(agent).catch(()=>({}))||{},labelContact?await labelRules(agent).catch(()=>({}))||{}:{},await cardKind(agent),!!await ordersOf(agent).catch(()=>null),!!(protocolText&&await pdfRules(agent).catch(()=>null))||!!await protocolOf(agent),!!(await formRules(agent).catch(()=>null))?.baseUrl,!!(sendProtocolPdf&&await pdfRules(agent).catch(()=>null)),await catalogOf(agent).catch(()=>null)))});
  if(msg.method!=='tools/call')return {status:200,body:{jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}}};
  const args=msg.params?.arguments&&typeof msg.params.arguments==='object'?{...msg.params.arguments}:{};const key=typeof args.run==='string'&&args.run?args.run:token;delete args.run;
  const x=await call(agent,key,String(msg.params?.name||''),args);
  return rpc({content:[{type:'text',text:String(x.text||'')}],...(x.isError?{isError:true}:{})})}
 const safeEq=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)};
 // whether a payment for this customer was made since a time (the reply guard in kirimdev.mjs)
 async function paidSince(agent,phone,since){const ph=String(phone||'').replace(/\D/g,'');return (await readFile(path.join(DATA,'payments.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean)
  .some(l=>{try{const p=JSON.parse(l);return p.agent===agent&&p.phone===ph&&p.ok&&!deliveryFailed(p.out)&&Date.parse(p.at)>=since-1000}catch{return false}})}
 // the QR picture tags ([FOTO: qris-….png]) the payment tool made for this customer in this run
 async function qrSince(agent,phone,since){const ph=String(phone||'').replace(/\D/g,'');const tags=[];
  for(const l of (await readFile(path.join(DATA,'payments.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean)){try{const p=JSON.parse(l);
   if(p.agent===agent&&p.phone===ph&&p.ok&&Date.parse(p.at)>=since-1000)for(const t of p.tags||[...String(p.out||'').matchAll(/\[FOTO:[^\]]+\]/g)].map(m=>m[0]))tags.push(t)}catch{}}
  return tags.slice(-1)}
 return {begin,end,call,mcp,files,runOf,safeEq,paidSince,qrSince}}
