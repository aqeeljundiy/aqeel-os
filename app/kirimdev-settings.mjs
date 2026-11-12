// Kirimdev settings that used to need a command or a JSON edit (13 Nov 2026), now on Channels › Kirimdev, per line:
//   - who may approve drafts: picked from the team's people (System › Teams); their Telegram user ids are what is stored
//     (lines.<agent>.approvers in kirimdev.json, checked in code by kirimdev.teamMessage);
//   - the price list: products, shipping, promo codes and the card fee (price-catalog.json, read at every payment). Things only the
//     importer or a hand edit knew (the labels set once paid, free items) are kept when the page saves;
//   - hints for products the team's own list file (the catalogue file the importer read, in the agent's folder) has and the saved list does not.
// Pure functions here; the routes (admins only) are in server.mjs and the page is kirimdev-settings-page.js.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {parsePriceList,cleanCatalog,slug,money} from './price-catalog.mjs';

const USER_ID=/^\d{4,15}$/;
const str=(v,n)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n);

// the people an approver may be picked from: the owner, the members of the teams that cover this agent, then everyone else on any team.
// Only people with a Telegram user id (a number from 4 to 15 digits; a group id is not a person) can approve.
export function peopleOf(pol,agent){const out=[],seen=new Set();
 const add=(name,tg,team)=>{name=str(name,60);const ids=[...new Set([].concat(tg||[]).map(String).filter(x=>USER_ID.test(x)))];if(!name||!ids.length||seen.has(name.toLowerCase()))return;seen.add(name.toLowerCase());out.push({name,team:team||'',ids})};
 add(pol?.owner?.name,pol?.owner?.telegram,'Owner');
 const teams=pol?.teams||[],mine=teams.filter(t=>(t.agents||[]).includes(agent)),rest=teams.filter(t=>!mine.includes(t));
 for(const t of [...mine,...rest])for(const m of t.members||[])add(m.name,m.telegram,t.name);
 return out}

// who is on the list now: each known person fully on it (all their ids), and the approvers nobody on the team matches (kept as they are)
export function approverState(people,current){const cur=(current||[]).map(a=>({who:String(a.who||''),telegramId:String(a.telegramId||'')})),have=new Set(cur.map(a=>a.telegramId));
 const picked=people.filter(p=>p.ids.every(i=>have.has(i))).map(p=>p.name),known=new Set(people.flatMap(p=>p.ids));
 return {picked,others:cur.filter(a=>!known.has(a.telegramId))}}
// the new list: the chosen people (all their ids), then the approvers that are not any known person's (so none is lost by saving)
export function buildApprovers(people,current,chosen,dropOthers=[]){const drop=new Set([].concat(dropOthers||[]).map(String)),want=new Set([].concat(chosen||[]).map(String)),out=[],ids=new Set();
 for(const p of people)if(want.has(p.name))for(const id of p.ids)if(!ids.has(id)){ids.add(id);out.push({who:p.name,telegramId:id})}
 const known=new Set(people.flatMap(p=>p.ids));
 for(const a of current||[]){const id=String(a.telegramId||'');if(!known.has(id)&&!ids.has(id)&&!drop.has(id)){ids.add(id);out.push({who:String(a.who||id),telegramId:id})}}
 for(const w of want)if(!people.some(p=>p.name===w))throw Error(w+' is not on a team with a Telegram id. Add them on System › Teams first.');
 if(out.length>20)throw Error('Twenty approvers at most.');return out}

// the price list as the page edits it: rows, not objects
export function catalogRows(cat){if(!cat)return {exists:false,currency:'Rp',products:[],shipping:[],discounts:[],cardFee:'',source:'',updated:''};
 return {exists:true,currency:cat.currency||'',source:cat.source||'',updated:cat.updated||'',
  products:Object.entries(cat.products).map(([id,p])=>({id,name:p.name,price:p.price,...(cat.free?.[id]?{free:true}:{})})),
  shipping:Object.entries(cat.shipping||{}).map(([id,s])=>({id,name:s.name,price:s.price,default:!!s.default})),
  discounts:Object.entries(cat.discounts||{}).map(([code,d])=>({code,...(d.percent?{percent:d.percent}:{amount:d.amount}),until:d.until||'',min:d.min||0,on:d.on||'products'})),
  cardFee:cat.fees?.card?.percent??''}}

const whole=(v,what)=>{const s=String(v??'').replace(/[\s.,]/g,'');if(!/^\d+$/.test(s))throw Error(what+' is a whole number, like 3200000.');return Number(s)};
// rows from the page → a price list; the old list supplies what the page does not show (labels, free items, the source file)
export function catalogFromRows(old,b){const prev=old||{products:{},shipping:{},discounts:{},free:{},fees:{}},out={currency:str(b.currency,6)||prev.currency||'Rp',products:{},shipping:{},discounts:{},free:{},fees:{},source:prev.source||'',updated:new Date().toISOString().slice(0,10)};
 const rows=k=>{const r=Array.isArray(b[k])?b[k]:[];if(r.length>300)throw Error('Too many rows in '+k+'.');return r};
 const idFor=(taken,r,name)=>{let id=str(r.id,60);if(id&&/^[A-Za-z0-9][\w.+-]{0,60}$/.test(id)&&!taken[id])return id;const base=slug(name)||'item';id=base;let n=2;while(taken[id])id=base+'-'+n++;return id};
 for(const r of rows('products')){const name=str(r.name,120);if(!name)throw Error('Every product needs a name.');const price=whole(r.price,'The price of '+name);
  const id=idFor(out.products,r,name);out.products[id]={name,price,...(prev.products[id]?.label?{label:prev.products[id].label}:{})}}
 if(!Object.keys(out.products).length)throw Error('A price list needs at least one product.');
 for(const r of rows('shipping')){const name=str(r.name,80);if(!name)throw Error('Every shipping choice needs a name.');const id=idFor(out.shipping,r,name);out.shipping[id]={name,price:whole(r.price,'The shipping price of '+name),...(r.default?{default:true}:{})}}
 for(const r of rows('discounts')){const code=str(r.code,31).toUpperCase();if(!/^[A-Z0-9][A-Z0-9_-]{1,30}$/.test(code))throw Error('A promo code is letters and digits, like THREADS5.');
  const d={};if(Number(r.percent)>0){const p=Number(r.percent);if(!(p>0&&p<=100))throw Error(code+': the percent is from 1 to 100.');d.percent=p}else if(Number(String(r.amount??'').replace(/[\s.,]/g,''))>0)d.amount=whole(r.amount,'The amount of '+code);else throw Error(code+' needs a percent or an amount.');
  if(r.on==='total')d.on='total';if(r.until){if(isNaN(Date.parse(r.until)))throw Error(code+': the end date is not a date (like 2026-12-31).');d.until=String(r.until).slice(0,10)}if(Number(r.min)>0)d.min=whole(r.min,'The lowest order for '+code);out.discounts[code]=d}
 for(const [id,f] of Object.entries(prev.free||{}))if(out.products[id])out.free[id]=f;   // free items stay as they were
 if(b.cardFee!==''&&b.cardFee!=null){const c=Number(b.cardFee);if(!(c>0&&c<=20))throw Error('The card fee is a percent from 0.1 to 20, or empty for none.');out.fees.card={percent:c}}
 const c=cleanCatalog(out);if(!c)throw Error('That price list is not valid.');return c}

// products the team's own list file has and the saved list does not (only when that file is there and can be read)
export async function leftOut({home,agent,cat}){
 const names=[...new Set([cat?.source,'PRICELIST.md'].filter(f=>f&&/^[\w.-]+$/.test(f)))];
 for(const f of names){let text;try{text=await readFile(path.join(home,'workspaces',agent,f),'utf8')}catch{continue}
  const found=parsePriceList(text),have=new Set(Object.entries(cat?.products||{}).flatMap(([id,p])=>[id,slug(p.name)]));
  const miss=Object.entries(found).filter(([id,p])=>!have.has(id)&&!have.has(slug(p.name))).slice(0,40).map(([id,p])=>({id,name:p.name,price:p.price,text:p.name+': '+money(p.price,cat?.currency||'Rp')}));
  return {file:f,found:Object.keys(found).length,missing:miss}}
 return null}
