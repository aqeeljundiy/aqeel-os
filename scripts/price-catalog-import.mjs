#!/usr/bin/env node
// Make a line's price list in aqeelOS (app/price-catalog.mjs, audit 12 Nov 2026, C2) from a list the team already keeps.
// DRY RUN by default: it prints the list it read and changes nothing.
//   node scripts/price-catalog-import.mjs <agent> <file> [--apply] [--data <aqeelOS data folder>] [--currency Rp]
//     [--shipping free=Gratis:0,jawa="Ongkir Jawa":100000] [--discount THREADS5=5,LUNA=5] [--free pen-id=5000000] [--card-fee 2.5]
// <file> is one of three shapes (see parsePriceList): "- Name: jual Rp3.200.000 | coret …", "SKU | title | list | price",
// or "title | variant | sku | price | gid://… | ACTIVE". Product ids are the SKU when the file has one, else the name in small letters
// with dashes. Shipping, promo codes, free items and the card fee are not in those files: give them here, or edit
// <data>/price-catalog.json by hand afterwards (it is read at every payment; no restart needed). An existing list for the agent keeps
// whatever this run does not give (so prices can be re-imported without losing the promo codes).
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {parsePriceList,createCatalog,cleanCatalog,listText} from '../app/price-catalog.mjs';

const A=process.argv.slice(2),VAL=['--data','--currency','--shipping','--discount','--free','--card-fee'],arg=n=>{const i=A.indexOf(n);return i>=0?A[i+1]:null},pos=A.filter((x,i)=>!x.startsWith('--')&&!VAL.includes(A[i-1]));
const [agent,file]=pos;if(!agent||!file){console.error('usage: price-catalog-import.mjs <agent> <file> [--apply] [--shipping id=Name:price,…] [--discount CODE=percent,…] [--free id=over] [--card-fee 2.5]');process.exit(1)}
const DATA=arg('--data')||process.env.AQEELOS_DATA||path.join(homedir(),'apps','hermes-ui-data'),cat=createCatalog({DATA,log:()=>{}});
const products=parsePriceList(await readFile(file,'utf8'));if(!Object.keys(products).length){console.error('No product with a price was found in '+file+'.');process.exit(1)}
const old=await cat.of(agent)||{shipping:{},discounts:{},free:{},fees:{}};
const pairs=s=>String(s||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)]});
const shipping=arg('--shipping')?Object.fromEntries(pairs(arg('--shipping')).map(([id,v])=>{const j=v.lastIndexOf(':');return [id,{name:v.slice(0,j).replace(/^"|"$/g,''),price:Number(v.slice(j+1))}]})):old.shipping;
const discounts=arg('--discount')?Object.fromEntries(pairs(arg('--discount')).map(([c,p])=>[c.toUpperCase(),{percent:Number(p)}])):old.discounts;
const free=arg('--free')?Object.fromEntries(pairs(arg('--free')).map(([id,o])=>[id,{over:Number(o)}])):old.free;
// --was-only: only the strike-through prices (coret) go onto the products the list already has, matched by id, else by name; no product is
// added, removed, renamed or repriced (19 Nov 2026: the check before sending reads them from here)
if(A.includes('--was-only')){const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),byName=new Map(Object.values(products).map(p=>[norm(p.name),p]));let n=0;
 for(const [id,p] of Object.entries(old.products||{})){const src=products[id]||byName.get(norm(p.name));if(src?.was>p.price&&src.price===p.price){p.was=src.was;n++}}
 console.log(n+' strike-through price(s) found for '+Object.keys(old.products||{}).length+' products (only where the selling price matches).');
 if(A.includes('--apply')){await cat.set(agent,old);console.log('Saved to '+cat.file+'.')}else console.log('Dry run: nothing was saved; run again with --apply.');process.exit(0)}
const next=cleanCatalog({currency:arg('--currency')||old.currency||'Rp',products,shipping,discounts,free,fees:arg('--card-fee')?{card:{percent:Number(arg('--card-fee'))}}:old.fees,source:path.basename(file),updated:new Date().toISOString().slice(0,10)});
console.log(listText(next));console.log('\n'+Object.keys(next.products).length+' products for '+agent+'.');
if(A.includes('--apply')){await cat.set(agent,next);console.log('Saved to '+cat.file+'.')}else console.log('Dry run: nothing was saved. Check every price above against the team\'s list, then run again with --apply.');
