// Customer-run sandbox (7 Nov 2026, audit E7). A customer's WhatsApp message ran the support agent as a general agent with a
// shell inside the folder that holds the payment keys: two customer runs read .secrets/XENDIT_SECRET_KEY and made real
// invoices, and the engine's own "BLOCKED" stop had just been allowlisted away. Now aqeelOS starts every customer run with
// one tool server only (engine -t aqeelos-customer), and gives the run its own key (env TERMINAL_AQEELOS_CUSTOMER_RUN, put into the
// server's header by the engine), bound to that one conversation and customer. No shell, no files, no other tools:
//   read_sheet       read-only Google Sheets calls through aqeelOS (the agent's own sheets, as before; no key in the run)
//   read_file        the agent's rule and template files (*.md, templates/, sop/, media lists); never hidden files or keys
//   list_files       what read_file can read
//   conversation     this customer's last messages (Kirimdev), nothing from other customers
//   past_chats       the agent's own line's past chats (as before)
//   create_payment   the agent's own payment helper (.tools/qris or .tools/pay) run as the agent's user, for THIS customer
//                    only (the number comes from the run, never from the model), amounts checked, at most 2 per run,
//                    every call written to DATA/payments.jsonl (with the products bought and the provider's references,
//                    so paid-labels.mjs can label the contact once the payment is confirmed paid)
//                    kind card (8 Nov 2026): the line's card helper (.tools/card: a Xendit card-only invoice), one amount that is
//                    the whole order total, same limits and log; returns the checkout link for the reply
//   label_contact    the line's allowed Kirimdev labels on THIS chat's contact only (8 Nov 2026; kirimdev.mjs labelContact
//                    holds the rules), a few per run, each logged with the run id; never a message to the customer
// The engine itself never sees a key: the helper reads the keys as the agent's user, outside the model's reach.
import {readFile,readdir,stat,appendFile,mkdir} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import path from 'node:path';

const READ_METHODS=new Set(['spreadsheets.values.get','spreadsheets.values.batchGet','spreadsheets.get']);
// bank codes are the payment helper's to check (it knows its provider); here only their shape
const clip=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n-1)+'…':s};
// a workspace file a customer run may read: rules and templates, never hidden files, keys, tools or anything outside
export function readable(rel){const r=String(rel||'').replace(/^\.\/+/,'');if(!r||r.startsWith('/')||r.split('/').some(x=>!x||x==='..'||x.startsWith('.')))return false;
 if(/(^|\/)(secrets?|tools|node_modules|tmp|Desktop)(\/|$)/i.test(r)||/\.(bak|orig)|bak-|\.env|key|token|password|secret/i.test(r))return false;
 return /^[\w-]+\.md$/.test(r)||/^(templates|sop|knowledge|rules)\/[\w ./-]+\.(md|txt|json|csv)$/.test(r)||/^media\/[\w ./-]*urls\.txt$/.test(r)}
// pr: the line's payment setting (kirimdev.json lines.<agent>.payment: {currency, min, max}); none = any whole amount
export const TOOLS=(pay,pr={},lr={},card=false)=>{const allowed=lr.allowed||[],sales=lr.sales||[];const cur=pr.currency||'',lo=Number(pr.min)||1,hi=Number(pr.max)||1e9,amt=x=>(cur?cur+' ':'')+Number(x).toLocaleString('en-US');return [
 {name:'read_sheet',description:'Read your knowledge or rules sheet (read only). method is spreadsheets.values.get, spreadsheets.values.batchGet or spreadsheets.get; params as the Google Sheets API takes them, e.g. {"spreadsheetId":"…","range":"Rules!A1:Z200"}.',
  inputSchema:{type:'object',properties:{method:{type:'string',enum:[...READ_METHODS]},params:{type:'object'}},required:['method','params']},annotations:{readOnlyHint:true}},
 {name:'read_file',description:'Read one of your rule or template files, e.g. DECISIONS.md, BRIEFING.md, templates/ORDER_FORM.md, sop/<name>.md. list_files shows them.',
  inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']},annotations:{readOnlyHint:true}},
 {name:'list_files',description:'The rule and template files you can read with read_file.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},
 {name:'conversation',description:'This customer\'s latest messages in this Kirimdev chat (newest last). Only this chat.',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:60}}},annotations:{readOnlyHint:true}},
 {name:'past_chats',description:'Search the past customer chats of your own Kirimdev line for how something was answered before.',inputSchema:{type:'object',properties:{query:{type:'string'},limit:{type:'integer'}},required:['query']},annotations:{readOnlyHint:true}},
 ...(allowed.length?[{name:'label_contact',description:'Label THIS customer\'s contact in Kirimdev (the team\'s CRM pipeline), as your label rules say: the stage they reached or a product they asked about. Only these labels: '+allowed.join(', ')+'. Never Customer or S- labels: aqeelOS sets those itself once a payment is confirmed. The customer never sees labels; say nothing about them in your reply.',
  inputSchema:{type:'object',properties:{add:{type:'array',items:{type:'string',enum:allowed},maxItems:4},remove:{type:'array',items:{type:'string',enum:allowed},maxItems:4}}}}]:[]),
 ...(pay||card?[{name:'create_payment',description:(pay==='pay'
   ?'Create a REAL payment with your payment helper for THIS customer\'s CONFIRMED order and send it to them in this chat (QR picture, or virtual account number). kind qris: amounts, each '+amt(lo)+' to '+amt(hi)+' (split bigger totals). kind va: bank code and one amount. Use once per confirmed order; again only if the customer says it expired (expired true). After it succeeds, do not repeat the payment in your reply; say it was sent.'
   :pay?'Create a REAL QR payment with your payment helper for THIS customer\'s CONFIRMED order total. Amounts each '+amt(lo)+' to '+amt(hi)+' (split bigger totals). Returns [FOTO: …] lines: put each on its own line in your reply so the QR picture is sent. Use once per confirmed order; again only if the customer says it expired (expired true).':'Create a REAL payment with your payment helper for THIS customer\'s CONFIRMED order.')+(card?' kind card, only when the customer chose credit or debit card: one amount, the whole order total, '+amt(lo)+' to '+amt(hi)+'. Returns a checkout link: put it in your reply exactly as given. Never ask for card numbers in chat.':''),
  inputSchema:{type:'object',properties:{kind:{type:'string',enum:[...(pay==='pay'?['qris','va']:pay?['qris']:[]),...(card?['card']:[])]},amounts:{type:'array',items:{type:'integer',minimum:lo,maximum:hi},minItems:1,maxItems:5},bank:{type:'string',description:'The bank code the payment helper accepts, e.g. BCA'},name:{type:'string',description:'The customer\'s name from the order form'},order_total:{type:'integer',description:'The confirmed order total; the amounts must add up to it'},expired:{type:'boolean'},
   products:{type:'array',items:sales.length?{type:'string',enum:sales}:{type:'string'},maxItems:12,description:'What the order buys, as the sales labels'+(sales.length?'':' (S- names)')+': one per product in the order form (a reusable pen is S-Pen). Set on the customer\'s contact only once the payment is confirmed paid.'}},required:['amounts','name','order_total']}}]:[])]};

// every customer tool takes the run's key (given in the run's instructions); calls without a live key are refused
export const RUN_FIELD={type:'string',description:'Your run key, exactly as given in your instructions for this chat.'};
export const withRun=tools=>tools.map(t=>({...t,inputSchema:{...t.inputSchema,properties:{run:RUN_FIELD,...(t.inputSchema?.properties||{})},required:['run',...(t.inputSchema?.required||[]).filter(x=>x!=='run')]}}));

export function createCustomerTools({WORK,DATA,payRules=async()=>({}),labelRules=async()=>({}),labelContact=null,googleCall,chatFind,history,runAsAgent,log=m=>console.log(m),now=()=>Date.now(),random=n=>randomBytes(n)}){
 const runs=new Map();
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
 const payKind=async a=>{const h=await helperOf(a);return h?(h.style==='send'?'pay':'qris'):null};
 // a run's key: made by aqeelOS when it starts a customer run, ends with it (15 minutes at most)
 function begin({agent,line,conversation,phone,mode}){const token=random(24).toString('base64url');runs.set(token,{agent,line,conversation,phone:String(phone||'').replace(/\D/g,''),mode,at:now(),payments:0,labels:0,id:'r'+random(4).toString('hex')});return token}
 function end(token){runs.delete(token)}
 function runOf(agent,token){const r=runs.get(String(token||''));if(!r||r.agent!==agent||now()-r.at>15*60e3)return null;return r}
 async function files(a){const out=[];const W=path.join(WORK,a);const walk=async(d,depth)=>{for(const e of await readdir(path.join(W,d),{withFileTypes:true}).catch(()=>[])){const rel=d?d+'/'+e.name:e.name;
   if(e.isDirectory()&&depth<2&&!e.name.startsWith('.'))await walk(rel,depth+1);else if(e.isFile()&&readable(rel))out.push(rel)}};await walk('',0);return out.sort()}
 const payLog=async e=>{await mkdir(DATA,{recursive:true});await appendFile(path.join(DATA,'payments.jsonl'),JSON.stringify({at:new Date(now()).toISOString(),...e})+'\n',{mode:0o600})};
 async function call(agent,token,name,args={}){const r=runOf(agent,token);if(!r)return {isError:true,text:'These tools only work inside a customer chat run.'};
  try{
   if(name==='read_sheet'){const m=String(args.method||'');if(!READ_METHODS.has(m))return {isError:true,text:'Only reading: '+[...READ_METHODS].join(', ')+'.'};
    const x=await googleCall(agent,{service:'sheets',version:'v4',method:m,params:args.params||{}});return {isError:x.status!==200,text:clip(JSON.stringify(x.json),60000)}}
   if(name==='list_files')return {text:(await files(agent)).join('\n')||'No rule files.'};
   if(name==='read_file'){const rel=String(args.path||'').replace(/^\/home\/[^/]+\/workspaces\/[^/]+\//,'');if(!readable(rel))return {isError:true,text:'Not a rule or template file you can read here. list_files shows them.'};
    const t=await readFile(path.join(WORK,agent,rel),'utf8').catch(()=>null);return t==null?{isError:true,text:'No such file.'}:{text:clip(t,60000)}}
   if(name==='conversation')return {text:await history(r,Math.min(60,Math.max(1,+args.limit||30)))};
   if(name==='past_chats'){const x=await chatFind(agent,String(args.query||''),{limit:args.limit});return {isError:!!x.error,text:String(x.text||'')}}
   if(name==='create_payment'){const k=String(args.kind||'qris');if(!['qris','va','card'].includes(k))return {isError:true,text:'kind is qris, va or card.'};
    const cardPath=k==='card'?await cardOf(agent):null;if(k==='card'&&!cardPath)return {isError:true,text:'This line has no card payment helper. Hand off to the team.'};
    const helper=k==='card'?{path:cardPath,style:'card'}:await helperOf(agent);const kind=helper?(helper.style==='send'?'pay':helper.style==='card'?'card':'qris'):null;if(!kind)return {isError:true,text:'You have no payment helper (set one in the line\'s payment settings).'};
    if(!r.phone)return {isError:true,text:'This chat has no customer number.'};
    const amounts=[].concat(args.amounts||[]).map(Number);const pr=await payRules(agent).catch(()=>({}))||{},lo=Number(pr.min)||1,hi=Number(pr.max)||1e9,cur=pr.currency?pr.currency+' ':'';
    if(!amounts.length||amounts.some(x=>!Number.isInteger(x)||x<lo||x>hi))return {isError:true,text:'Each amount is a whole number from '+lo+' to '+hi+'.'};
    const lr=await labelRules(agent).catch(()=>({}))||{},products=[...new Set([].concat(args.products||[]).map(x=>String(x||'').trim()).filter(Boolean))];
    const wrong=products.filter(x=>!/^S-/.test(x)||(lr.sales?.length&&!lr.sales.includes(x)));if(wrong.length)return {isError:true,text:'products are sales labels'+(lr.sales?.length?' ('+lr.sales.join(', ')+')':' (S- names)')+', not '+wrong.join(', ')+'.'};
    const total=amounts.reduce((s,x)=>s+x,0);if(Number(args.order_total)!==total)return {isError:true,text:'The amounts add up to '+total+', not the order total '+args.order_total+'. Check the order form.'};
    if(r.payments>=2)return {isError:true,text:'Two payments were already made in this run. If something is wrong, hand off to the team.'};
    if(k==='card'&&amounts.length!==1)return {isError:true,text:'A card link is one amount: the whole order total.'};
    if(k==='va'&&(kind!=='pay'||!/^[A-Z0-9_]{2,20}$/.test(String(args.bank||'').toUpperCase())||amounts.length!==1))return {isError:true,text:'A VA needs a bank code and one amount.'};
    // the same total for the same customer within 30 minutes is a repeat, unless the customer said it expired
    const recent=(await readFile(path.join(DATA,'payments.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean)
     .find(p=>p.agent===agent&&p.phone===r.phone&&p.total===total&&p.ok&&(p.kind==='card')===(k==='card')&&now()-Date.parse(p.at)<30*60e3);   // switching to or from card is a new payment
    if(recent&&!args.expired)return {isError:true,text:'A payment for '+cur+total+' was already made for this customer at '+recent.at.slice(11,16)+' UTC. Only make a new one if the customer says it expired (expired true).'};
    const nm=clip(String(args.name||'').replace(/[^\p{L}\p{N} .,'-]/gu,'').trim(),60)||'Customer';
    const argv=k==='card'?[String(amounts[0]),'--name',nm,'--phone',r.phone,...(products.length?['--items',...products]:[])]:kind==='pay'?(k==='va'?['va',String(args.bank).toUpperCase(),String(amounts[0])]:['qris',...amounts.map(String)]).concat(['--name',nm,'--to',r.phone]):[...amounts.map(String),'--name',nm,'--phone',r.phone];
    r.payments++;const x=await runAsAgent(agent,helper.path,argv);
    // the provider's references in the helper's answer (Tripay: T… references, or our BM-… order refs the helper keeps in tmp/)
    const out=String(x.out||''),refs=[...new Set(out.match(/\bT\d{5,}[0-9A-Z]{4,}\b/g)||[])],orders=[...new Set(out.match(/\b[A-Z]{2,4}-\d{9,11}-\d{1,2}\b/g)||[])],invoices=k==='card'?[...new Set(out.match(/\b[0-9a-f]{24}\b/g)||[])]:[];
    await payLog({agent,line:r.line,conversation:r.conversation,phone:r.phone,mode:r.mode,run:r.id,kind:k,amounts,total,products,refs,orders,...(k==='card'?{invoices}:{}),ok:x.ok,out:clip(x.out||x.err,400)});
    log('customer run '+agent+': payment '+k+' '+cur+total+' for …'+r.phone.slice(-4)+(x.ok?' made':' failed'));
    // card: the link, amount and expiry for the reply; the provider's ids stay in the log
    if(x.ok&&k==='card')return {text:out.split(' | ').slice(0,3).join(' | ').trim()+'\nPut this link in your reply exactly as given.'};
    return x.ok?{text:clip(x.out,4000)}:{isError:true,text:'The payment was not made: '+clip(x.err||x.out,600)+'. Tell the customer you are checking, and hand off.'}}
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
  if(msg.method==='tools/list')return rpc({tools:withRun(TOOLS(await payKind(agent),await payRules(agent).catch(()=>({}))||{},labelContact?await labelRules(agent).catch(()=>({}))||{}:{},!!await cardOf(agent)))});
  if(msg.method!=='tools/call')return {status:200,body:{jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}}};
  const args=msg.params?.arguments&&typeof msg.params.arguments==='object'?{...msg.params.arguments}:{};const key=typeof args.run==='string'&&args.run?args.run:token;delete args.run;
  const x=await call(agent,key,String(msg.params?.name||''),args);
  return rpc({content:[{type:'text',text:String(x.text||'')}],...(x.isError?{isError:true}:{})})}
 const safeEq=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)};
 // whether a payment for this customer was made since a time (the reply guard in kirimdev.mjs)
 async function paidSince(agent,phone,since){const ph=String(phone||'').replace(/\D/g,'');return (await readFile(path.join(DATA,'payments.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean)
  .some(l=>{try{const p=JSON.parse(l);return p.agent===agent&&p.phone===ph&&p.ok&&Date.parse(p.at)>=since-1000}catch{return false}})}
 return {begin,end,call,mcp,files,runOf,safeEq,paidSince}}
