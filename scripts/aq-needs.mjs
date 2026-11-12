#!/usr/bin/env node
// Answer "Needs you" items from a terminal on the box (local owner channel, app/local-owner.mjs).
//   node scripts/aq-needs.mjs                                   list items with numbered choices
//   node scripts/aq-needs.mjs answer <id> <choice> [--value N] [--text "..."]
//   node scripts/aq-needs.mjs issue <issue id> resort|close "<reason>"   sort a wrongly sorted Health issue again, or close it
import {readFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const env=process.env,root=path.dirname(fileURLToPath(import.meta.url));
const DATA=path.resolve(env.UI_DATA_DIR||path.join(root,'..','..','hermes-ui-data')),PORT=Number(env.UI_PORT)||4400;
const die=m=>{console.error(m);process.exit(1)};
let key;try{key=(await readFile(path.join(DATA,'local-owner.key'),'utf8')).trim()}catch{die('No key at '+path.join(DATA,'local-owner.key')+' (set UI_DATA_DIR; start the app once).')}
async function call(method,p,body){let r;try{r=await fetch('http://127.0.0.1:'+PORT+p,{method,headers:{'x-aqeel-local':key,'content-type':'application/json'},body:body?JSON.stringify(body):undefined})}catch(e){die('The app does not answer on 127.0.0.1:'+PORT+' ('+e.message+')')}
 const j=await r.json().catch(()=>null);if(!r.ok)die((j&&j.error)||'Refused ('+r.status+').');return j}
const [cmd,id,choice,...rest]=process.argv.slice(2);
if(!cmd){const {items}=await call('GET','/local/needs');if(!items.length)console.log('Nothing needs you.');
 items.forEach((x,i)=>{console.log((i+1)+'. ['+x.kind+'] '+x.title+'\n   id: '+x.id);if(x.text)console.log('   '+x.text);
  if(x.choices.length)x.choices.forEach(c=>console.log('   - '+c.key+(c.recommended?' (recommended)':'')+': '+c.label+(c.text?' - '+c.text:'')+(c.value!=null?' ['+c.value+']':'')));else console.log('   Do this one on Health: '+(x.health||''));
  if(x.choices.length)console.log('   answer: node scripts/aq-needs.mjs answer "'+x.id+'" <choice>')})}
else if(cmd==='answer'){if(!id||!choice)die('Usage: answer <id> <choice> [--value N] [--text "..."]');const o={id,choice};
 for(let i=0;i<rest.length;i++){if(rest[i]==='--value'){const v=rest[++i];o.value=v!==''&&!isNaN(v)?Number(v):v}else if(rest[i]==='--text')o.text=rest[++i]}
 const r=await call('POST','/local/answer',o);console.log('Done: '+JSON.stringify(r))}
else if(cmd==='issue'){const reason=rest.join(' ').trim();if(!/^i[0-9a-f]{8}$/.test(id||'')||!['resort','close'].includes(choice)||!reason)die('Usage: issue <issue id, like i7d96eb8c> resort|close "<reason>"');
 const r=await call('POST','/local/issue',{id,action:choice,reason});console.log('Done: '+JSON.stringify(r))}
else die('Usage: aq-needs.mjs | aq-needs.mjs answer <id> <choice> [--value N] [--text "..."] | aq-needs.mjs issue <id> resort|close "<reason>"');
