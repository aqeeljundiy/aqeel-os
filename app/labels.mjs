// Names people remember (7 Nov 2026, owner: "make sure they have name + description so ppl could remember what they
// were"). One file, DATA/labels.json, keyed "<kind>:<id>" -> {name, description}. Only what people read changes:
// internal ids (skill folders, mcp_servers keys and the mcp__X__ tool names, cron job ids, profile names) stay as they
// are, so prompts, SOUL.md, skills and scripts that name them keep working.
// Kinds and their ids (the same keys Abilities › Connections uses for its rows):
//   skill:<skill name>  mcp:<mcp_servers key>  plugin:<plugin id>  ca:<connected account id>  google:<email>
//   key:<env name>  channel:<agent>|<platform>  kirimdev:<line id>  agent:<profile>
// Schedules keep their own: the job's name (engine) and its description (schedule-meta.json summary).
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {LABEL_DEFAULTS} from './label-defaults.mjs';

export const LABEL_KINDS=['skill','mcp','plugin','ca','google','ads','key','channel','kirimdev','agent'];
const MAX_NAME=60,MAX_DESC=200;

// plain words only: no em or en dashes (owner's rule), one line, trimmed
export function cleanText(s,max){return String(s??'').replace(/\s*[\u2014\u2013]\s*/g,', ').replace(/\s+/g,' ').trim().slice(0,max)}
export function labelKey(kind,id){kind=String(kind||'');id=String(id??'').trim();
 if(!LABEL_KINDS.includes(kind))throw Object.assign(new Error('Unknown kind'),{status:400});
 if(!id||id.length>200||/[\n\r]/.test(id))throw Object.assign(new Error('Bad id'),{status:400});return kind+':'+id}

export function createLabels(DATA,{defaults=LABEL_DEFAULTS,pluginDesc=null}={}){
 // a plugin nobody named shows the first sentence of its own description (plugin.yaml), never a generic line
 const pluginWhat=pluginDesc&&(r=>{if(!String(r?.key||'').startsWith('plugin:'))return null;const d=pluginDesc(r.key.slice(7));return d?{...r,what:d}:null});
 const FILE=path.join(DATA,'labels.json');let db=null,chain=Promise.resolve();
 const load=async()=>{if(db)return db;try{const j=JSON.parse(await readFile(FILE,'utf8'));db=j&&typeof j==='object'&&!Array.isArray(j)?j:{}}catch(e){if(e.code!=='ENOENT')console.warn('labels.json:',e.message);db={}}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});const t=FILE+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(db,null,1));await rename(t,FILE)};
 // the built-in ones (label-defaults.mjs) under what people set; each says which it is
 async function all(){const l=await load(),out={};for(const [k,v] of Object.entries(defaults))out[k]={...v,builtIn:true};for(const [k,v] of Object.entries(l))out[k]={...v};return out}
 async function get(kind,id){const k=labelKey(kind,id);return (await load())[k]||(defaults[k]?{...defaults[k],builtIn:true}:null)}
 // empty name and description: the label is dropped and the default shows again
 function set(kind,id,{name,description}={}){let k;try{k=labelKey(kind,id)}catch(e){return Promise.reject(e)}const r=chain.then(async()=>{await load();
   const cur=db[k]||{};const n=name===undefined?cur.name||'':cleanText(name,MAX_NAME),d=description===undefined?cur.description||'':cleanText(description,MAX_DESC);
   if(!n&&!d)delete db[k];else db[k]={...(n?{name:n}:{}),...(d?{description:d}:{}),at:new Date().toISOString()};
   await save();return db[k]||(defaults[k]?{...defaults[k],builtIn:true}:null)});chain=r.catch(()=>{});return r}
 // a row (or {rows}) from Abilities › Connections: the label's name and description win, the real one stays as rawName
 async function applyRows(x){const l=await all();const one=r=>{const v=r&&l[r.key];if(!v)return pluginWhat?.(r)||r;return {...r,rawName:r.name,name:v.name||r.name,what:v.description||r.what,labelled:true}};
  if(x&&Array.isArray(x.rows))return {...x,rows:x.rows.map(one)};return one(x)}
 return {all,get,set,applyRows,file:FILE,_reset:()=>{db=null}}}
