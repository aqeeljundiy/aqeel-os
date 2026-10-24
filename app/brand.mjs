// The name and logo of this install, read from DATA/brand.json (aqeelOS and the default mark unless set). The Branding
// page that changed them was removed on 24 Oct 2026; an earlier custom name or logo is still honoured.
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const DEFAULT='aqeelOS';
export function createBrand({DATA}){
 const FILE=path.join(DATA,'brand.json');let b=null;
 const load=async()=>{if(!b){try{b=JSON.parse(await readFile(FILE,'utf8'))}catch{b={}}}return b};
 async function get(){await load();return {name:b.name||DEFAULT,logo:b.logo?'/ui/brand/logo?v='+(b.v||0):null,custom:!!(b.name&&b.name!==DEFAULT)||!!b.logo}}
 async function logo(){await load();if(!b.logo)return null;try{return {type:b.logo==='svg'?'image/svg+xml':'image/png',data:await readFile(path.join(DATA,'brand-logo.'+b.logo))}}catch{return null}}
 const name=async()=>(await load(),b.name||DEFAULT);
 return {get,logo,name}}
