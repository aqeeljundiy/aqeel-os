// Usage accounting: per-run token log (data/usage.jsonl), a price table (data/prices.json) used to show an
// API-equivalent USD cost, and the latest subscription limits per account (data/limits.json).
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';

// Starting prices, USD per million tokens. Third-party aggregator figures (October 2026); "Sync prices" replaces
// them with values an AI reads from the official pricing pages. null = no published price yet.
export const SEED={updatedAt:'2026-10-14',source:'Seed values from public price trackers (eesel.ai, devtk.ai, anotherwrapper.com), October 2026. Use Sync prices to read the official pages.',models:{
 'claude-opus-5-5':{input:4,cachedInput:0.2,cacheWrite:5,output:20},
 'claude-fable-5-1':{input:10,cachedInput:0.25,cacheWrite:12.5,output:50},
 'claude-sonnet-5-5':{input:null,cachedInput:null,cacheWrite:null,output:null},
 'claude-haiku-5-5':{input:null,cachedInput:null,cacheWrite:null,output:null},
 'gpt-6.1-sol':{input:2,cachedInput:0.1,cacheWrite:null,output:10},
 'gpt-6-astra':{input:10,cachedInput:1,cacheWrite:12.5,output:50},
 'gpt-6-sol':{input:2,cachedInput:0.2,cacheWrite:null,output:10},
 'gpt-6-luna':{input:0.1,cachedInput:0.01,cacheWrite:null,output:0.5},
 'gpt-5.6-sol':{input:4,cachedInput:null,cacheWrite:null,output:20},
}};
const FIELDS=['input','cachedInput','cacheWrite','output'];

export {costOf} from './usage-cost.js';

export function validatePrices(models){if(!models||typeof models!=='object')throw Error('Send a table of model prices.');const out={};
 for(const [id,p] of Object.entries(models)){if(!/^[\w.:-]{1,80}$/.test(id))throw Error('Invalid model id: '+id);out[id]={};
  for(const f of FIELDS){const v=p?.[f];if(v===null||v===undefined||v===''){out[id][f]=null;continue}const n=Number(v);if(!Number.isFinite(n)||n<0||n>10000)throw Error('Price for '+id+' '+f+' must be a number.');out[id][f]=n}
  if(p?.source)out[id].source=String(p.source).slice(0,300)}return out}

// Pull a JSON object out of an AI reply (it may wrap it in prose or a code fence).
export function extractJson(text){const s=String(text||'');const fence=s.match(/```(?:json)?\s*([\s\S]*?)```/);const body=fence?fence[1]:s;const start=body.indexOf('{'),end=body.lastIndexOf('}');if(start<0||end<start)throw Error('The AI did not return a price table.');return JSON.parse(body.slice(start,end+1))}

export class Usage{
 constructor(root){this.dir=path.join(root,'data')}
 async lines(){try{return (await readFile(path.join(this.dir,'usage.jsonl'),'utf8')).split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean)}catch{return []}}
 async read(name,fallback){try{return JSON.parse(await readFile(path.join(this.dir,name),'utf8'))}catch{return structuredClone(fallback)}}
 async write(name,value){await mkdir(this.dir,{recursive:true});const f=path.join(this.dir,name);await writeFile(f+'.tmp',JSON.stringify(value,null,2));await rename(f+'.tmp',f)}
 prices(){return this.read('prices.json',SEED)}
 // keepKnown: a sync never replaces a known price with null (the page may simply not list that model)
 async savePrices(models,source,{keepKnown=false}={}){const current=await this.prices();const incoming=validatePrices(models);
  if(keepKnown)for(const [id,p] of Object.entries(incoming))for(const f of FIELDS)if(p[f]==null&&current.models[id]?.[f]!=null)p[f]=current.models[id][f];
  const next={updatedAt:new Date().toISOString(),source:source||'Edited by hand',models:{...current.models,...incoming}};await this.write('prices.json',next);return next}
 limits(){return this.read('limits.json',{})}
 async saveLimit(key,value){const all=await this.limits();all[key]={...value,at:Date.now()};await this.write('limits.json',all);return all}
}
