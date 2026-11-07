// Which aqeelOS this app opens. Nothing is built in: on first launch the person types their aqeelOS address, the app
// checks it is an aqeelOS install, and keeps it in settings.json in the app's own folder. An app that was already
// paired with an aqeelOS keeps that address (from Code's own link file), so an update never asks again.
const fs=require('node:fs'),path=require('node:path');

const read=(f,d)=>{try{return JSON.parse(String(fs.readFileSync(f,'utf8')).replace(/^﻿/,''))}catch{return d}};

// "ai.example.com", "https://ai.example.com/" and "https://ai.example.com/#/code" all mean https://ai.example.com
function cleanAddress(input){let s=String(input||'').trim();if(!s)throw Error('Type your aqeelOS address first.');
 if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(s))s=(/^(localhost|127\.|\[::1\])/i.test(s)?'http://':'https://')+s;
 let u;try{u=new URL(s)}catch{throw Error('That is not a web address. It looks like https://ai.example.com')}
 if(!/^https?:$/.test(u.protocol))throw Error('The address starts with https://');
 if(u.username||u.password)throw Error('Leave the name and password out of the address.');
 return u.origin}

// the address to open: the setting, else the one this app was paired with before, else a build-time default ('' asks)
function savedAddress({settingsFile,codeDir,bundled,env=process.env}){const clean=v=>{try{return v?cleanAddress(v):''}catch{return ''}};
 return clean(env.AQEELOS_URL)||clean(read(settingsFile,{}).address)
  ||clean(read(path.join(codeDir,'data','aqeelos.json'),{}).base)          // Code's link: the aqeelOS it is paired with
  ||clean(read(path.join(codeDir,'aqeelos.json'),{}).aqeelos?.base)        // stamped by aqeelOS when Code updated itself
  ||clean(read(path.join(bundled,'aqeelos.json'),{}).aqeelos?.base)||''}   // stamped at build time (build.config.json)

function saveSettings(settingsFile,patch){const cur=read(settingsFile,{});const next={...cur,...patch};
 fs.mkdirSync(path.dirname(settingsFile),{recursive:true});fs.writeFileSync(settingsFile+'.tmp',JSON.stringify(next,null,1));fs.renameSync(settingsFile+'.tmp',settingsFile);return next}

// is it an aqeelOS? /install-ping answers {id} on every current install; older ones answer /healthz with {ok,build}
async function checkAddress(input,{fetchImpl=fetch,timeout=8000}={}){let base;try{base=cleanAddress(input)}catch(e){return {ok:false,why:e.message}}
 const get=async p=>{const r=await fetchImpl(base+p,{signal:AbortSignal.timeout(timeout),redirect:'follow',headers:{accept:'application/json'}});let j=null;try{j=await r.json()}catch{}return {status:r.status,j}};
 try{let hit=await get('/install-ping').catch(()=>null);let ok=!!(hit&&hit.status===200&&hit.j&&typeof hit.j.id==='string'&&hit.j.id);
  if(!ok){const h=await get('/healthz');ok=h.status===200&&h.j&&h.j.ok===true&&'build' in h.j}
  if(!ok)return {ok:false,url:base,why:'Something answered there, but it is not aqeelOS. Check the address.'};
  return {ok:true,url:base,brand:await brandOf(base,{fetchImpl,timeout}),https:base.startsWith('https://'),
   why:base.startsWith('https://')||/\/\/(localhost|127\.)/.test(base)?'':'This works, but without https your sign-in is not private.'}}
 catch(e){return {ok:false,url:base,why:/timeout|abort/i.test(String(e?.name)+e?.message)?'Nothing answered at that address within 8 seconds.':'Nothing answers at that address. Check it and your connection.'}}}

// the install's own name and logo (System › Branding there) and who runs it (its legal.json), shown on the app's
// screens; aqeelOS and the plain mark when it has none
async function brandOf(base,{fetchImpl=fetch,timeout=8000}={}){const out={name:'aqeelOS',logo:'',owner:null};
 try{const r=await fetchImpl(base+'/ui/brand',{signal:AbortSignal.timeout(timeout),headers:{accept:'application/json'}});if(!r.ok)return out;const j=await r.json();
  if(typeof j.name==='string'&&/^[\p{L}\p{N} ._-]{2,24}$/u.test(j.name))out.name=j.name;
  if(typeof j.logo==='string'&&j.logo.startsWith('/'))out.logo=base+j.logo;
  if(j.owner&&typeof j.owner==='object'){const t=v=>typeof v==='string'?v.replace(/[<>"`]/g,'').slice(0,120):'';const o={name:t(j.owner.name),org:t(j.owner.org),site:t(j.owner.site)};if(o.name||o.org)out.owner=o}}catch{}
 return out}

// a new address unpairs Code from the old one (its key belongs to that aqeelOS); the old link is kept beside it
function forgetLink(codeDir){const f=path.join(codeDir,'data','aqeelos.json');try{if(fs.existsSync(f))fs.renameSync(f,f+'.before-'+Date.now())}catch{}}

module.exports={cleanAddress,savedAddress,saveSettings,checkAddress,brandOf,forgetLink};
