// node --test scripts/no-pill-lists.test.mjs — who uses a thing is one line, never a pill per agent (21 Nov 2026, owner:
// "there's tons of these pills in the OS, we must not do it"). The shared helpers in core.js, and a guard on the pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const names={default:'Donna AI',sesa:'Sesa',rory:'Rory',kai:'Kai',mo:'Mo',lee:'Lee'};
const W={esc,ident:a=>({name:names[a]||a}),agentAvatar:(a,sz,o={})=>`<span class="${o.cls||'ava'}" data-a="${a}"></span>`,menu:(...x)=>{W.opened=x}};
vm.createContext(W);{const c=src('core.js'),a=c.indexOf('const listAnd='),b=c.indexOf('// personAvatar(');assert.ok(a>0&&b>a,'the helpers are in core.js');
 vm.runInContext(c.slice(a,b).replace(/^const (\w+)/gm,'var $1'),W)}

test('the line: who and how many, the owner first and marked',()=>{
 assert.equal(W.usedLine([]),'Nobody uses it yet');
 assert.equal(W.usedLine(['sesa']),'Used by Sesa');
 assert.equal(W.usedLine(['sesa','default'],{owner:'default'}),'Used by Donna AI (owner) and Sesa');
 assert.equal(W.usedLine(['sesa','rory','default','kai'],{owner:'default'}),'Used by Donna AI (owner) and 3 more agents');
 assert.equal(W.usedLine([{id:'kai',name:'Kai the bot'},'mo','lee'],{verb:''}),'Kai the bot and 2 more agents');
 assert.equal(W.usedLine(['sesa','rory','kai'],{verb:'Only'}),'Only Sesa and 2 more agents');
 assert.equal(W.canUseLine(['Gmail','Calendar','Drive']),'Can use Gmail, Calendar and Drive');
 assert.equal(W.canUseLine([],'No Google services'),'No Google services')});

test('faces stop at four and there is no +N bubble, however many agents',()=>{
 const ids=Object.keys(names),h=W.whoLine(ids,{owner:'default'});
 assert.equal((h.match(/class="acc-av"/g)||[]).length,4);assert.ok(!/acc-more|\+\d/.test(h));assert.match(h,/Donna AI \(owner\) and 5 more agents/)});

test('read-only: more than two opens everyone in one searchable list; two or fewer is plain text',()=>{
 assert.ok(!W.whoLine(['sesa','rory'],{list:true}).includes('<button'));
 const b=W.whoLine(['sesa','rory','kai'],{list:true,owner:'rory'});assert.match(b,/<button[^>]*data-act="who-list"[^>]*data-who="rory,sesa,kai"/);
 W.whoMenu({},{header:'Who uses it',users:['sesa','kai'],all:['mo','kai','sesa','default'],owner:'default'});const [,items,opt]=W.opened;
 assert.equal(opt.search,true,'searchable');assert.deepEqual(JSON.parse(JSON.stringify(items.slice(1).map(i=>i.label))),['Donna AI','Kai','Sesa','Mo'],'owner, then those who have it, then the rest');
 assert.deepEqual(JSON.parse(JSON.stringify(items.slice(1).map(i=>i.sub))),['Owner','','','No access'])});

test('things: one line, and See all when there are more than two',()=>{
 assert.equal(W.thingsLine([]),'');assert.ok(!W.thingsLine(['Skill: push','Script: a.py'],{verb:'Used by'}).includes('<button'));
 const h=W.thingsLine(['Skill: push','Script: a.py','A channel'],{verb:'Used by'});assert.match(h,/Used by Skill: push and 2 more/);assert.match(h,/data-act="list-all"[^>]*>See all 3</)});

test('no page builds a pill or chip per agent, service or tag again',()=>{
 const files=[...readFileSync(new URL('../app/index.html',import.meta.url),'utf8').matchAll(/src="\/app\/([\w.-]+\.js)"/g)].map(m=>m[1]);
 const bad=[/class="(?:aam-ag|tm-pick|chip gc-svc)\b/,/acc-more/,/\.map\(\w+=>`<span class="chip">\$\{esc\(t\)\}/,/class="pstack"/];
 for(const f of files){const s=src(f);for(const r of bad)assert.ok(!r.test(s),f+' still has '+r)}
 // the shared component is what the pages call
 assert.match(src('access.js'),/who\(it,o=\{\}\)\{return whoLine\(/);
 for(const f of ['connections.js','n8n-page.js','people.js','teams-page.js','connected-accounts.js','google-connect.js'])assert.match(src(f),/whoLine\(|whoMenu\(|Access\.who\(/,f)});
