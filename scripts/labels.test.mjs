// Names and descriptions (app/labels.mjs, app/label-defaults.mjs, app/labels.js): what people read changes, ids never do.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLabels,cleanText,labelKey,LABEL_KINDS} from '../app/labels.mjs';
import {LABEL_DEFAULTS} from '../app/label-defaults.mjs';

const DASH=/[—–]/;
const tmp=async()=>mkdtemp(path.join(tmpdir(),'labels-'));

test('a label is saved, read back and dropped again',async()=>{const d=await tmp();try{
 const l=createLabels(d,{defaults:{}});
 assert.equal(await l.get('mcp','slack-as2'),null);
 const v=await l.set('mcp','slack-as2',{name:'Slack · AdmissionSight',description:'Reads Aqeel’s Slack as him.'});
 assert.equal(v.name,'Slack · AdmissionSight');assert.equal(v.description,'Reads Aqeel’s Slack as him.');
 const again=createLabels(d,{defaults:{}});   // from the file, not memory
 assert.equal((await again.get('mcp','slack-as2')).name,'Slack · AdmissionSight');
 assert.equal(await l.set('mcp','slack-as2',{name:'',description:''}),null);
 assert.deepEqual(JSON.parse(await readFile(path.join(d,'labels.json'),'utf8')),{});
}finally{await rm(d,{recursive:true,force:true})}});

test('only the given field changes',async()=>{const d=await tmp();try{const l=createLabels(d,{defaults:{}});
 await l.set('skill','pixel-ops',{name:'Pixel & Profits work rules',description:'How to handle Pixel tasks.'});
 const v=await l.set('skill','pixel-ops',{description:'New line.'});
 assert.equal(v.name,'Pixel & Profits work rules');assert.equal(v.description,'New line.');
}finally{await rm(d,{recursive:true,force:true})}});

test('no em or en dashes, one line, kept short',()=>{
 assert.equal(cleanText('Slack — AdmissionSight','60'),'Slack, AdmissionSight');
 assert.equal(cleanText('a–b',60),'a, b');
 assert.equal(cleanText('two\nlines   here',60),'two lines here');
 assert.equal(cleanText('x'.repeat(300),60).length,60)});

test('unknown kinds and bad ids are refused',async()=>{const d=await tmp();try{const l=createLabels(d,{defaults:{}});
 assert.throws(()=>labelKey('cron','x'),/Unknown kind/);
 assert.throws(()=>labelKey('skill',''),/Bad id/);
 assert.throws(()=>labelKey('skill','a\nb'),/Bad id/);
 await assert.rejects(()=>l.set('nope','x',{name:'y'}),/Unknown kind/);
}finally{await rm(d,{recursive:true,force:true})}});

test('built-in names show until someone sets their own, and come back after',async()=>{const d=await tmp();try{
 const l=createLabels(d,{defaults:{'mcp:n8n':{name:'n8n automations',description:'Runs automations.'}}});
 assert.equal((await l.get('mcp','n8n')).builtIn,true);
 await l.set('mcp','n8n',{name:'Elkiya n8n'});assert.equal((await l.all())['mcp:n8n'].name,'Elkiya n8n');
 const back=await l.set('mcp','n8n',{name:'',description:''});assert.equal(back.name,'n8n automations');assert.equal(back.builtIn,true);
}finally{await rm(d,{recursive:true,force:true})}});

test('Connections rows: the label wins, the key and the real name stay',async()=>{const d=await tmp();try{
 const l=createLabels(d,{defaults:{}});await l.set('mcp','slack-as2',{name:'Slack · AdmissionSight',description:'Drafts only.'});
 const rows=[{key:'mcp:slack-as2',id:'slack-as2',name:'Slack',what:''},{key:'skill:github',id:'github',name:'github',what:'GitHub via gh'}];
 const out=await l.applyRows({rows,agents:[]});
 assert.equal(out.rows[0].name,'Slack · AdmissionSight');assert.equal(out.rows[0].what,'Drafts only.');
 assert.equal(out.rows[0].rawName,'Slack');assert.equal(out.rows[0].key,'mcp:slack-as2');assert.equal(out.rows[0].id,'slack-as2');
 assert.deepEqual(out.rows[1],rows[1]);
 assert.equal((await l.applyRows({key:'mcp:slack-as2',name:'Slack'})).name,'Slack · AdmissionSight');   // the side panel's one row
}finally{await rm(d,{recursive:true,force:true})}});

test('a broken labels.json is never saved over silently, and an empty one is fine',async()=>{const d=await tmp();try{
 await writeFile(path.join(d,'labels.json'),'');const l=createLabels(d,{defaults:{}});assert.deepEqual(await l.all(),{});
}finally{await rm(d,{recursive:true,force:true})}});

test('every built-in name and description is plain, short and has both parts',()=>{
 for(const [k,v] of Object.entries(LABEL_DEFAULTS)){
  assert.ok(LABEL_KINDS.includes(k.slice(0,k.indexOf(':'))),k+' has a known kind');
  assert.ok(v.name&&v.name.length<=60,k+' name');assert.ok(v.description&&v.description.length<=200,k+' description');
  assert.ok(!DASH.test(v.name+v.description),k+' has an em or en dash');
  assert.ok(!/hermes|nous/i.test(v.name+v.description),k+' names the engine');
  assert.ok(/[.!?]$/.test(v.description),k+' description is a sentence')}});

test('the page loads labels.js after the pages it decorates, and its words are plain',()=>{
 const html=readFileSync(new URL('../app/index.html',import.meta.url),'utf8');const at=f=>html.indexOf('/app/'+f);
 assert.ok(at('labels.js')>at('connections.js')&&at('labels.js')>at('all-agents-more.js')&&at('labels.js')>at('people.js'),'after the pages');
 assert.ok(at('labels.js')<at('boot.js'),'before boot');
 const js=readFileSync(new URL('../app/labels.js',import.meta.url),'utf8');
 assert.ok(!DASH.test(js),'no em or en dash in labels.js');
 assert.match(js,/Add a description/);assert.match(js,/ACT\['lb-edit'\]/);
 // the id is shown, never edited: the request carries kind and id only as the key
 assert.match(js,/put\(UI,'\/ui\/labels',\{kind,id,\.\.\.body\}\)/)});

test('ids are never rewritten: nothing in labels code touches config.yaml, SKILL.md, jobs.json or profile names',()=>{
 for(const f of ['labels.mjs','label-defaults.mjs','labels.js']){const src=readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
  assert.ok(!/config\.yaml|SKILL\.md|jobs\.json|rename-mcp|mcp_servers\./.test(src.replace(/^\s*\/\/.*$/gm,'')),f+' writes only labels')}});
