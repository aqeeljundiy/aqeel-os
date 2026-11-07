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
//                    every call written to DATA/payments.jsonl
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
export const TOOLS=(pay,pr={})=>{const cur=pr.currency||'',lo=Number(pr.min)||1,hi=Number(pr.max)||1e9,amt=x=>(cur?cur+' ':'')+Number(x).toLocaleString('en-US');return [
 {name:'read_sheet',description:'Read your knowledge or rules sheet (read only). method is spreadsheets.values.get, spreadsheets.values.batchGet or spreadsheets.get; params as the Google Sheets API takes them, e.g. {"spreadsheetId":"…","range":"Rules!A1:Z200"}.',
  inputSchema:{type:'object',properties:{method:{type:'string',enum:[...READ_METHODS]},params:{type:'object'}},required:['method','params']},annotations:{readOnlyHint:true}},
 {name:'read_file',description:'Read one of your rule or template files, e.g. DECISIONS.md, BRIEFING.md, templates/ORDER_FORM.md, sop/<name>.md. list_files shows them.',
  inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']},annotations:{readOnlyHint:true}},
 {name:'list_files',description:'The rule and template files you can read with read_file.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},
 {name:'conversation',description:'This customer\'s latest messages in this Kirimdev chat (newest last). Only this chat.',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:60}}},annotations:{readOnlyHint:true}},
 {name:'past_chats',description:'Search the past customer chats of your own Kirimdev line for how something was answered before.',inputSchema:{type:'object',properties:{query:{type:'string'},limit:{type:'integer'}},required:['query']},annotations:{readOnlyHint:true}},
 ...(pay?[{name:'create_payment',description:pay==='pay'
   ?'Create a REAL payment with your payment helper for THIS customer\'s CONFIRMED order and send it to them in this chat (QR picture, or virtual account number). kind qris: amounts, each '+amt(lo)+' to '+amt(hi)+' (split bigger totals). kind va: bank code and one amount. Use once per confirmed order; again only if the customer says it expired (expired true). After it succeeds, do not repeat the payment in your reply; say it was sent.'
   :'Create a REAL QR payment with your payment helper for THIS customer\'s CONFIRMED order total. Amounts each '+amt(lo)+' to '+amt(hi)+' (split bigger totals). Returns [FOTO: …] lines: put each on its own line in your reply so the QR picture is sent. Use once per confirmed order; again only if the customer says it expired (expired true).',
  inputSchema:{type:'object',properties:{kind:{type:'string',enum:pay==='pay'?['qris','va']:['qris']},amounts:{type:'array',items:{type:'integer',minimum:lo,maximum:hi},minItems:1,maxItems:5},bank:{type:'string',description:'The bank code the payment helper accepts, e.g. BCA'},name:{type:'string',description:'The customer\'s name from the order form'},order_total:{type:'integer',description:'The confirmed order total; the amounts must add up to it'},expired:{type:'boolean'}},required:['amounts','name','order_total']}}]:[])]};

// every customer tool takes the run's key (given in the run's instructions); calls without a live key are refused
export const RUN_FIELD={type:'string',description:'Your run key, exactly as given in your instructions for this chat.'};
export const withRun=tools=>tools.map(t=>({...t,inputSchema:{...t.inputSchema,properties:{run:RUN_FIELD,...(t.inputSchema?.properties||{})},required:['run',...(t.inputSchema?.required||[]).filter(x=>x!=='run')]}}));

export function createCustomerTools({WORK,DATA,payRules=async()=>({}),googleCall,chatFind,history,runAsAgent,log=m=>console.log(m),now=()=>Date.now(),random=n=>randomBytes(n)}){
 const runs=new Map();
 // the agent's payment helper: the line's setting (kirimdev.json lines.<agent>.payment.helper {path, style}), else the
 // usual names in its workspace. style "send": it sends the payment itself (qris|va amounts --name --to <number>);
 // style "picture": it prints [FOTO: …] lines for the reply (amounts --name --phone <number>)
 const helperOf=async a=>{const h=(await payRules(a).catch(()=>({}))||{}).helper;
  if(h?.path&&/^[\w.\/-]+$/.test(h.path)&&!h.path.split('/').includes('..')&&await stat(path.join(WORK,a,h.path)).catch(()=>null))return {path:h.path,style:h.style==='send'?'send':'picture'};
  if(await stat(path.join(WORK,a,'.tools','pay')).catch(()=>null))return {path:'.tools/pay',style:'send'};
  if(await stat(path.join(WORK,a,'.tools','qris')).catch(()=>null))return {path:'.tools/qris',style:'picture'};return null};
 const payKind=async a=>{const h=await helperOf(a);return h?(h.style==='send'?'pay':'qris'):null};
 // a run's key: made by aqeelOS when it starts a customer run, ends with it (15 minutes at most)
 function begin({agent,line,conversation,phone,mode}){const token=random(24).toString('base64url');runs.set(token,{agent,line,conversation,phone:String(phone||'').replace(/\D/g,''),mode,at:now(),payments:0});return token}
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
   if(name==='create_payment'){const helper=await helperOf(agent);const kind=helper?(helper.style==='send'?'pay':'qris'):null;if(!kind)return {isError:true,text:'You have no payment helper (set one in the line\'s payment settings).'};
    if(!r.phone)return {isError:true,text:'This chat has no customer number.'};
    const amounts=[].concat(args.amounts||[]).map(Number);const pr=await payRules(agent).catch(()=>({}))||{},lo=Number(pr.min)||1,hi=Number(pr.max)||1e9,cur=pr.currency?pr.currency+' ':'';
    if(!amounts.length||amounts.some(x=>!Number.isInteger(x)||x<lo||x>hi))return {isError:true,text:'Each amount is a whole number from '+lo+' to '+hi+'.'};
    const total=amounts.reduce((s,x)=>s+x,0);if(Number(args.order_total)!==total)return {isError:true,text:'The amounts add up to '+total+', not the order total '+args.order_total+'. Check the order form.'};
    if(r.payments>=2)return {isError:true,text:'Two payments were already made in this run. If something is wrong, hand off to the team.'};
    const k=String(args.kind||'qris');if(k==='va'&&(kind!=='pay'||!/^[A-Z0-9_]{2,20}$/.test(String(args.bank||'').toUpperCase())||amounts.length!==1))return {isError:true,text:'A VA needs a bank code and one amount.'};
    // the same total for the same customer within 30 minutes is a repeat, unless the customer said it expired
    const recent=(await readFile(path.join(DATA,'payments.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean)
     .find(p=>p.agent===agent&&p.phone===r.phone&&p.total===total&&p.ok&&now()-Date.parse(p.at)<30*60e3);
    if(recent&&!args.expired)return {isError:true,text:'A payment for '+cur+total+' was already made for this customer at '+recent.at.slice(11,16)+' UTC. Only make a new one if the customer says it expired (expired true).'};
    const nm=clip(String(args.name||'').replace(/[^\p{L}\p{N} .,'-]/gu,'').trim(),60)||'Customer';
    const argv=kind==='pay'?(k==='va'?['va',String(args.bank).toUpperCase(),String(amounts[0])]:['qris',...amounts.map(String)]).concat(['--name',nm,'--to',r.phone]):[...amounts.map(String),'--name',nm,'--phone',r.phone];
    r.payments++;const x=await runAsAgent(agent,helper.path,argv);
    await payLog({agent,line:r.line,conversation:r.conversation,phone:r.phone,mode:r.mode,kind:k,amounts,total,ok:x.ok,out:clip(x.out||x.err,400)});
    log('customer run '+agent+': payment '+k+' '+cur+total+' for …'+r.phone.slice(-4)+(x.ok?' made':' failed'));
    return x.ok?{text:clip(x.out,4000)}:{isError:true,text:'The payment was not made: '+clip(x.err||x.out,600)+'. Tell the customer you are checking, and hand off.'}}
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
  if(msg.method==='tools/list')return rpc({tools:withRun(TOOLS(await payKind(agent),await payRules(agent).catch(()=>({}))||{}))});
  if(msg.method!=='tools/call')return {status:200,body:{jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}}};
  const args=msg.params?.arguments&&typeof msg.params.arguments==='object'?{...msg.params.arguments}:{};const key=typeof args.run==='string'&&args.run?args.run:token;delete args.run;
  const x=await call(agent,key,String(msg.params?.name||''),args);
  return rpc({content:[{type:'text',text:String(x.text||'')}],...(x.isError?{isError:true}:{})})}
 const safeEq=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)};
 // whether a payment for this customer was made since a time (the reply guard in kirimdev.mjs)
 async function paidSince(agent,phone,since){const ph=String(phone||'').replace(/\D/g,'');return (await readFile(path.join(DATA,'payments.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean)
  .some(l=>{try{const p=JSON.parse(l);return p.agent===agent&&p.phone===ph&&p.ok&&Date.parse(p.at)>=since-1000}catch{return false}})}
 return {begin,end,call,mcp,files,runOf,safeEq,paidSince}}
