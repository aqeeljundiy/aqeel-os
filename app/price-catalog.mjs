// The price list aqeelOS holds (audit 12 Nov 2026, C2). Before this the model set the amount charged: create_payment checked only that
// the amounts were in range and added up to a total the model also gave. In 14 of 56 tester payments it charged Rp10.000 for orders of
// millions because a rule file said so; a customer who talks the model into a number would get the same. Now the amount comes from code:
// the model names products (ids of this list) and quantities, a shipping choice and a promo code; quote() prices the order; create_payment
// charges exactly that, and refuses when the order form the customer confirmed shows another total.
//
// DATA/price-catalog.json (mode 600, written by a person or scripts/price-catalog-import.mjs; agents cannot read or write it):
// { "<agent>": {
//    "currency": "Rp",
//    "products":  { "<id>": {"name": "Reta 10mg", "price": 3200000, "label": "S-Reta"} },   // label: the sales label set once paid (optional)
//    "shipping":  { "free": {"name": "Gratis", "price": 0}, "jawa": {"name": "Ongkir Jawa", "price": 100000} },   // none = no shipping line
//    "discounts": { "THREADS5": {"percent": 5, "until": "2026-12-31", "min": 0} },   // or {"amount": 50000}; on: "products" (default) | "total"
//    "free":      { "<id>": {"over": 5000000, "max": 1} },   // a product that may be given free when the paid products reach "over"
//    "fees":      { "card": {"percent": 2.5} },
//    "updated": "2026-11-12", "source": "PRICELIST.md" } }
// A line without an entry here can take payments in Test only (the amount is then the order form's own total line); in Draft and Live
// create_payment refuses until the line has a price list.
import path from 'node:path';
import {readStore,updateStore} from './store.mjs';

const int=v=>Number.isInteger(Number(v))?Number(v):NaN;
export const money=(n,cur='')=>(cur?cur:'')+String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
// "Rp3.040.000", "IDR 3,040,000", "3040000.00" → 3040000
export function parseMoney(s){const t=String(s||'').replace(/[^\d.,]/g,'').replace(/[.,]\d{2}$/,'').replace(/[.,]/g,'');const n=Number(t);return t&&Number.isInteger(n)&&n>0?n:null}
// the total the customer confirmed: the LAST line of the form that is a total ("Total Pembayaran: *Rp3.040.000*", "Total: Rp955.000",
// "Grand total …"); a struck-out price (~Rp5.500.000~) on that line is not it, "Subtotal" is not it
export function formTotal(form){let out=null;
 for(const l of String(form||'').split('\n')){const m=/^[\s>*•_-]*(?:grand\s+)?total\b[^:=\n]{0,40}[:=]\s*[*_\s]*(Rp\.?|IDR|USD|US\$|\$|EUR|€|SGD|MYR|RM)?\s*(\d[\d.,]*)/i.exec(l.replace(/~[^~\n]*~/g,' ').replace(/→|->|=>/g,' '));
  // a bare small number ("Total item: 3") is not money; with a currency sign, or from a thousand up, it is
  if(m){const n=parseMoney(m[2]);if(n&&(m[1]||n>=1000))out=n}}
 return out}
// one total as the parts a QRIS may carry: each from min to max, at most five (Tripay QRIS tops out at max per code)
export function splitAmounts(total,{min=1,max=1e9}={}){total=int(total);if(!(total>=min))return null;if(total<=max)return [total];
 const n=Math.ceil(total/max);if(n>5)return null;const parts=Array(n-1).fill(max);let rest=total-max*(n-1);
 if(rest<min){parts[parts.length-1]-=min-rest;rest=min}parts.push(rest);return parts.every(x=>x>=min&&x<=max)?parts:null}

export function cleanCatalog(c){if(!c||typeof c!=='object'||!c.products||typeof c.products!=='object')return null;const ID=/^[A-Za-z0-9][\w.+-]{0,60}$/;const out={currency:String(c.currency||''),products:{},shipping:{},discounts:{},free:{},fees:{},updated:String(c.updated||''),source:String(c.source||'')};
 for(const [id,p] of Object.entries(c.products)){const price=int(p?.price);if(!ID.test(id)||!(price>=0)||!p?.name)continue;out.products[id]={name:String(p.name).slice(0,120),price,...(p.label&&/^S-/.test(p.label)?{label:String(p.label)}:{})}}
 for(const [id,s] of Object.entries(c.shipping||{})){const price=int(s?.price);if(!ID.test(id)||!(price>=0))continue;out.shipping[id]={name:String(s.name||id).slice(0,80),price,...(s.default?{default:true}:{})}}
 for(const [code,d] of Object.entries(c.discounts||{})){const k=String(code).trim().toUpperCase(),pc=Number(d?.percent),am=int(d?.amount);if(!/^[A-Z0-9][A-Z0-9_-]{1,30}$/.test(k))continue;
  if(pc>0&&pc<=100)out.discounts[k]={percent:pc};else if(am>0)out.discounts[k]={amount:am};else continue;
  if(d.on==='total')out.discounts[k].on='total';if(d.until&&!isNaN(Date.parse(d.until)))out.discounts[k].until=String(d.until);if(int(d.min)>0)out.discounts[k].min=int(d.min)}
 for(const [id,f] of Object.entries(c.free||{}))if(out.products[id]&&int(f?.over)>=0)out.free[id]={over:int(f.over),max:Math.max(1,int(f.max)||1)};
 if(Number(c.fees?.card?.percent)>0&&Number(c.fees.card.percent)<=20)out.fees.card={percent:Number(c.fees.card.percent)};
 return Object.keys(out.products).length?out:null}

// the price of an order, from the list alone. order: {items:[{id,qty,free?}], shipping, discount, kind}
export function quote(cat,order={},{now=Date.now()}={}){const fail=why=>({ok:false,why});if(!cat)return fail('This line has no price list.');
 const items=Array.isArray(order.items)?order.items:[];if(!items.length)return fail('Give the items of the order: [{"id": "<product id>", "qty": 1}].');if(items.length>20)return fail('Twenty order lines at most.');
 const lines=[];let subtotal=0;
 for(const it of items){const id=String(it?.id||''),p=cat.products[id],qty=it?.qty==null?1:int(it.qty);
  if(!p)return fail('"'+id+'" is not a product id of the price list. Use an exact id; if the product is not on the list, do not quote a price: hand off.');
  if(!(qty>=1&&qty<=20))return fail('The quantity of '+id+' is a whole number from 1 to 20.');
  lines.push({id,name:p.name,qty,price:p.price,free:!!it.free,amount:it.free?0:p.price*qty,...(p.label?{label:p.label}:{})});if(!it.free)subtotal+=p.price*qty}
 for(const l of lines.filter(x=>x.free)){const rule=cat.free[l.id];if(!rule)return fail(l.name+' is never free on the price list.');
  if(subtotal<rule.over)return fail(l.name+' is free only when the paid products reach '+money(rule.over,cat.currency)+'; this order has '+money(subtotal,cat.currency)+'.');
  if(lines.filter(x=>x.free&&x.id===l.id).reduce((s,x)=>s+x.qty,0)>rule.max)return fail('At most '+rule.max+' free '+l.name+' per order.')}
 let discount=null;const code=String(order.discount||'').trim().toUpperCase();
 if(code&&!/^(-|NONE|NO|TIDAK|TIDAK ADA|TANPA VOUCHER)$/.test(code)){const d=cat.discounts[code];
  if(!d)return fail('"'+code+'" is not a promo code of the price list ('+(Object.keys(cat.discounts).join(', ')||'the list has none')+'). No discount may be given for it; tell the customer the code is not valid, or hand off.');
  if(d.until&&now>Date.parse(d.until)+86400e3)return fail('The promo code '+code+' ended on '+d.until+'.');
  if(d.min&&subtotal<d.min)return fail('The promo code '+code+' needs an order of at least '+money(d.min,cat.currency)+'.');
  discount={code,...(d.percent?{percent:d.percent}:{}),on:d.on||'products',amount:0}}
 const ship=Object.keys(cat.shipping);let shipping=null;
 if(ship.length){const id=String(order.shipping||'')||ship.find(k=>cat.shipping[k].default)||(ship.length===1?ship[0]:'');
  if(!cat.shipping[id])return fail('Say which shipping applies: '+ship.map(k=>k+' ('+cat.shipping[k].name+', '+money(cat.shipping[k].price,cat.currency)+')').join(', ')+'.');
  shipping={id,name:cat.shipping[id].name,price:cat.shipping[id].price}}
 if(discount){const d=cat.discounts[discount.code],base=discount.on==='total'?subtotal+(shipping?.price||0):subtotal;discount.amount=Math.min(base,d.percent?Math.round(base*d.percent/100):d.amount)}
 const total=subtotal-(discount?.amount||0)+(shipping?.price||0);if(!(total>0))return fail('The order comes to nothing to pay.');
 const pct=order.kind==='card'?cat.fees?.card?.percent||0:0,fee=pct?Math.round(total*pct/100):0;
 return {ok:true,lines,subtotal,discount,shipping,total,fee,feePercent:pct,charge:total+fee,labels:[...new Set(lines.map(l=>l.label).filter(Boolean))]}}
export function quoteText(q,cur=''){if(!q.ok)return q.why;
 return [...q.lines.map(l=>l.qty+'x '+l.name+' ['+l.id+']: '+(l.free?'FREE':money(l.amount,cur))),'Subtotal: '+money(q.subtotal,cur),
  ...(q.discount?['Discount '+q.discount.code+(q.discount.percent?' ('+q.discount.percent+'%)':'')+': -'+money(q.discount.amount,cur)]:[]),
  ...(q.shipping?['Shipping ('+q.shipping.name+'): '+(q.shipping.price?money(q.shipping.price,cur):'free')]:[]),'TOTAL: '+money(q.total,cur),
  ...(q.fee?['Card fee '+q.feePercent+'%: '+money(q.fee,cur),'TOTAL PAID BY CARD: '+money(q.charge,cur)]:[])].join('\n')}
export const listText=(cat,cur=cat?.currency||'')=>!cat?'This line has no price list in aqeelOS.':['PRODUCTS (id: name, price)',...Object.entries(cat.products).map(([id,p])=>id+': '+p.name+', '+money(p.price,cur)),
 ...(Object.keys(cat.shipping).length?['SHIPPING (id: name, price)',...Object.entries(cat.shipping).map(([id,s])=>id+': '+s.name+', '+money(s.price,cur))]:[]),
 ...(Object.keys(cat.discounts).length?['PROMO CODES: '+Object.entries(cat.discounts).map(([c,d])=>c+' ('+(d.percent?d.percent+'%':money(d.amount,cur))+(d.until?', until '+d.until:'')+')').join(', ')]:['PROMO CODES: none']),
 ...(Object.keys(cat.free).length?['FREE ITEMS: '+Object.entries(cat.free).map(([id,f])=>id+' when the paid products reach '+money(f.over,cur)).join(', ')]:[]),
 ...(cat.fees.card?['CARD FEE: '+cat.fees.card.percent+'% on top, paid by the buyer']:[])].join('\n');

// ---- reading the lists the team already keeps. Three shapes are known:
//  "- Reta 10mg: jual Rp3.200.000 | coret Rp4.000.000"            (a pricelist file)
//  "CL-RTGLP3-10MG | Product A · 10 mg | 4000000 | 3200000"     (sku | title | list price | selling price)
//  "RT-GLP3 10mg | Default Title | None | 3800000.00 | gid://… | ACTIVE"   (title | variant | sku | price | id | status)
export const slug=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/\([^)]*\)/g,' ').replace(/\+/g,' plus ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
export function parsePriceList(text){const products={};const add=(id,name,price)=>{id=String(id||'').trim();price=int(price);if(!id||!(price>0)||!name)return;let k=id,n=2;while(products[k]&&products[k].price!==price)k=id+'-'+n++;products[k]={name:String(name).trim().slice(0,120),price}};
 for(const raw of String(text||'').split('\n')){const l=raw.trim();if(!l||l.startsWith('#'))continue;
  let m=/^[-*•]\s*(.+?):\s*jual\s+(Rp[\d.,]+)/i.exec(l);if(m){add(slug(m[1]),m[1].replace(/\s*\([^)]*\)\s*/g,' ').trim(),parseMoney(m[2]));continue}
  const c=l.split('|').map(x=>x.trim());
  if(c.length>=6&&/^gid:\/\//.test(c[4])){if(/^(ACTIVE|UNLISTED)$/i.test(c[5]))add(c[2]&&c[2]!=='None'?c[2]:slug(c[0]+(c[1]&&c[1]!=='Default Title'?' '+c[1]:'')),c[0]+(c[1]&&c[1]!=='Default Title'?' '+c[1]:''),parseMoney(c[3]));continue}
  if(c.length===4&&/^[A-Z0-9][A-Z0-9_-]+$/.test(c[0])&&/^\d+$/.test(c[3]))add(c[0],c[1],Number(c[3]))}
 return products}

export function createCatalog({DATA,log=m=>console.log(m)}){const F=path.join(DATA,'price-catalog.json');
 // through app/store.mjs (12 Nov 2026): a price-catalog.json that cannot be read is not an empty list. Before, one bad read and the next save wrote every other
 // agent's customer price list away; now the save is refused (StoreRefused names the file) and the file stays as it is.
 const read=()=>readStore(F,{});
 async function of(agent){const c=(await read())[String(agent).split('--')[0]];return cleanCatalog(c)}
 async function set(agent,cat){const c=cleanCatalog(cat);if(!c)throw Error('A price list needs at least one product with a name and a whole-number price.');const saved=await updateStore(F,{},all=>{all[agent]={...c,updated:c.updated||new Date().toISOString().slice(0,10)};return all[agent]},{mode:0o600});
  log('price list: '+agent+' has '+Object.keys(c.products).length+' products');return saved}
 return {of,set,file:F}}
