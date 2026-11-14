// What a person taking over needs to know about this customer (owner, 14 Nov 2026: "every time they forward an order there must be
// context of the customer's previous use"). Built from what the install already keeps: the payments the customer tool made
// (DATA/payments.jsonl: when, products, total, and the buyer-context answers the line asks for, such as past use). Used by the
// HANDOFF post (kirimdev.mjs) and the PAID ORDER post (paid-labels.mjs). Nothing about one install: the fields and their labels come
// from the line's own order-context setting.
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const rows=async DATA=>(await readFile(path.join(DATA,'payments.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const money=(n,c)=>(c?c+' ':'')+Number(n||0).toLocaleString('en-US');

// earlier paid orders of this customer on this agent's line, newest first; `before` leaves out the order being posted (its own time)
export async function customerOrders(DATA,agent,phone,{before=Infinity,limit=3}={}){const ph=String(phone||'').replace(/\D/g,'');if(!ph)return [];
 const seen=new Set(),out=[];
 for(const p of (await rows(DATA)).reverse()){if(p.agent!==agent||p.phone!==ph||!p.ok||!(Date.parse(p.at)<before))continue;
  // a QRIS paid in parts and a repeat of the same order are one order
  const k=(p.orders||[]).join(',')||p.run||p.at;if(seen.has(k))continue;seen.add(k);out.push(p);if(out.length>=limit)break}
 return out}

// fields: [{key,label}] of the line's order context; missing: the line's word for "not asked" (counts as no answer)
export function historyText(list,{currency='',fields=[],missing=''}={}){if(!list.length)return 'Earlier orders: none on this line.';
 const known=v=>{const s=String(v||'').trim();return s&&(!missing||s.toLowerCase()!==String(missing).toLowerCase())?s:''};
 return 'Earlier orders ('+list.length+'):\n'+list.map(p=>{const ctx=fields.map(f=>known(p.context?.[f.key])?f.label+': '+known(p.context[f.key]):'').filter(Boolean);
  return '- '+String(p.at||'').slice(0,10)+(p.testAmount?' (test)':'')+', '+money(p.orderTotal??p.total,currency)+((p.products||[]).length?', '+p.products.join(', '):'')+(ctx.length?'\n  '+ctx.join('; '):'')}).join('\n')}

export async function customerHistory(DATA,agent,phone,o={}){return historyText(await customerOrders(DATA,agent,phone,o),o)}
