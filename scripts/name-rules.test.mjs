// A plain name and one line for everything an agent makes (app/name-rules.mjs, engine/aqeelos-live name_block):
// the refusal paths, the schema fields agents see, and the Health list of what still has no description.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {nameRefusal,addNameFields,namesMissing,namesPrompt,okName,okDesc} from '../app/name-rules.mjs';

const GOOD={label:'GitHub token for acme-dev',description:'Pushes code to the acme-dev GitHub account, repo access.'};

test('ask_secret save without a label or description is refused, with what to add',()=>{
 const r=nameRefusal('ask_secret',{mode:'save',name:'GITHUB_TOKEN'});assert.match(r,/Not done yet/);assert.match(r,/"label"/);assert.match(r,/"description"/);assert.match(r,/ask_secret again/);
 assert.match(nameRefusal('ask_secret',{mode:'save',name:'X_TOKEN',label:GOOD.label}),/"description"/);
 assert.doesNotMatch(nameRefusal('ask_secret',{mode:'save',name:'X_TOKEN',label:GOOD.label}),/"label"/);
 assert.equal(nameRefusal('ask_secret',{mode:'save',name:'X_TOKEN',...GOOD}),null)});
test('ask_secret for typing into a field needs nothing more (nothing is kept)',()=>{assert.equal(nameRefusal('ask_secret',{mode:'type',label:'Gmail password'}),null)});
test('request_secret_link and register_account are refused without both',()=>{
 assert.match(nameRefusal('request_secret_link',{name:'BOT_TOKEN'}),/request_secret_link again/);
 assert.equal(nameRefusal('request_secret_link',{name:'BOT_TOKEN',...GOOD}),null);
 assert.match(nameRefusal('register_account',{kind:'google',label:'Google, work'}),/whose account/);
 assert.equal(nameRefusal('register_account',{kind:'google',label:'Google, work',description:'Abel’s work Gmail and Calendar for the morning check-in.'}),null)});
test('an id is not a name, and a word or two is not a description',()=>{
 assert.equal(okName('GITHUB_TOKEN'),false);assert.equal(okName('ab'),false);assert.equal(okName('GitHub: acme-dev'),true);
 assert.equal(okDesc('token'),false);assert.equal(okDesc('for github'),false);assert.equal(okDesc('Pushes code to the acme repo.'),true);
 assert.match(nameRefusal('ask_secret',{mode:'save',label:'MY_TOKEN',description:'x'}),/"label".*"description"/s)});
test('organize_schedule: a summary, when given, is a real sentence',()=>{
 assert.match(nameRefusal('organize_schedule',{job_id:'1',summary:'report'}),/summary/);
 assert.equal(nameRefusal('organize_schedule',{job_id:'1',folder:'Finance'}),null);
 assert.equal(nameRefusal('organize_schedule',{job_id:'1',summary:'Every Monday it sends the sales report to the team.'}),null)});
test('other tools pass untouched',()=>{assert.equal(nameRefusal('my_logs',{}),null);assert.equal(nameRefusal(undefined,null),null)});
test('agents see the fields up front: description added, required where it must be',()=>{
 const tools=addNameFields([{name:'request_secret_link',inputSchema:{type:'object',properties:{label:{type:'string'},name:{type:'string'}},required:['name']}},{name:'ask_secret',inputSchema:{type:'object',properties:{label:{}}}},{name:'other',inputSchema:{type:'object',properties:{}}}]);
 assert.ok(tools[0].inputSchema.properties.description);assert.deepEqual(new Set(tools[0].inputSchema.required),new Set(['name','label','description']));
 assert.ok(tools[1].inputSchema.properties.description);assert.equal(tools[1].inputSchema.required,undefined);   // only for save, checked on the call
 assert.deepEqual(tools[2].inputSchema.properties,{})});
test('Health: only what has no clear description is listed, with a prompt that never involves the owner',()=>{
 const items=namesMissing({skills:[{name:'sales-report',desc:''},{name:'ok-skill',desc:'Use when making the weekly sales report.'},{name:'labelled',desc:''}],
  keys:[{id:'GITHUB_TOKEN@1',name:'GITHUB_TOKEN',service:'GitHub',account:'acme-dev'},{id:'A_KEY@2',name:'A_KEY',note:{description:'Reads the A service for the weekly report.'}}],
  labels:{'skill:labelled':{name:'Labelled',description:'Has a description set by the owner.'}}});
 assert.deepEqual(items.map(x=>x.kind+':'+x.id),['skill:sales-report','key:GITHUB_TOKEN@1']);assert.match(items[1].what,/GitHub: acme-dev/);
 const p=namesPrompt(items);assert.match(p,/name_thing/);assert.match(p,/Do not message the owner or customers/);assert.doesNotMatch(p,/[—–]/)});

// the engine's own schedule and skill tools (engine/aqeelos-live): the same rule, refused before the tool runs
const plug=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','engine','aqeelos-live','__init__.py');
const py=(tool,args)=>{const out=execFileSync('python3',['-I','-c',`import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('al',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
print(json.dumps(m.name_block(sys.argv[2],json.loads(sys.argv[3]))))`,plug,tool,JSON.stringify(args)],{encoding:'utf8'});return JSON.parse(out)};
test('engine: a schedule made without a plain name is refused',()=>{
 assert.match(py('cronjob',{action:'create',schedule:'every day at 9am',prompt:'x'}),/plain "name"/);
 assert.match(py('cronjob',{action:'create',name:'42',prompt:'x'}),/plain "name"/);
 assert.equal(py('cronjob',{action:'create',name:'Weekly sales report',prompt:'x'}),null);
 assert.equal(py('cronjob',{action:'list'}),null)});
test('engine: a skill made without a one-line description is refused; an edit is not checked here',()=>{
 const sk=d=>({operations:[{action:'create',name:'sales',content:'---\nname: sales\n'+(d?'description: '+d+'\n':'')+'---\nBody'}]});
 assert.match(py('skill_manage',sk('')),/one-line "description"/);
 assert.match(py('skill_manage',sk('sales')),/one-line "description"/);
 assert.equal(py('skill_manage',sk('Use when making the weekly sales report.')),null);
 assert.equal(py('skill_manage',{action:'create',name:'flat',content:'---\nname: flat\ndescription: Use when testing the flat call shape.\n---\nx'}),null);
 assert.equal(py('skill_manage',{operations:[{action:'patch',name:'x',old_string:'a',new_string:'b'}]}),null)});
test('the engine plugin words are plain',()=>{const src=readFileSync(plug,'utf8');const block=src.slice(src.indexOf('def name_block'),src.indexOf('def _pre_tool'));assert.doesNotMatch(block,/[—–]/)});
