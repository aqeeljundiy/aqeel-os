// One-time: give every existing connected account an explicit owner (the agent that connected it, else Donna = default)
// and every other agent that uses it today Editor, so switching sharing levels on takes nothing away. Then optionally enable.
// Run: node scripts/sharing-migrate.mjs <DATA dir> [--enable]
import {readFile} from 'node:fs/promises';import path from 'node:path';
import {createSharing,AGENT,base} from '../app/sharing.mjs';
const DATA=path.resolve(process.argv[2]);const s=createSharing({DATA,env:{}});
const ca=JSON.parse(await readFile(path.join(DATA,'connected-accounts.json'),'utf8'));
const NOT=/^(seed|owner|google|mcp|system)/;const out=[];
for(const x of Object.values(ca.accounts||{})){
 const users=[...new Set((x.agents||[]).map(base))].filter(a=>AGENT.test(a));
 const o=x.registeredBy&&!NOT.test(x.registeredBy)&&AGENT.test(x.registeredBy)?x.registeredBy:'default';
 await s.claim('account',x.id,o,{label:x.label||x.identity||x.id,by:'migration'});
 const r=await s.get('account',x.id);
 for(const a of users)if(a!==r.owner&&!r.grants[a])await s.share('account',x.id,{person:'migration',admin:true},a,'editor');
 const f=await s.get('account',x.id);out.push([x.id,'owner='+f.owner,JSON.stringify(f.grants)]);}
if(process.argv.includes('--enable'))await s.setEnabled(true,'person:migration');
for(const l of out)console.log(l.join(' '));console.log('enabled',await s.enabled());
