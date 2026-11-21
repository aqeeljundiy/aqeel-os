// Models › which agent uses what (app/accounts-page.js, 21 Nov 2026): Important work follows Priority, Routine work is Gemini then
// ChatGPT and never Claude, anything else is Custom; each row says its rule in words. The functions are read from the page itself.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../app/accounts-page.js',import.meta.url),'utf8');
const block=src.slice(src.indexOf('const lvKind='),src.indexOf('function acctSources('));
const {routineOrder,useMode,useRule,effOrder}=new Function(block+';return {routineOrder,useMode,useRule,effOrder}')();
const main=[{key:'claude:claude-account-4',model:''},{key:'claude:main',model:''},{key:'claude:claude-account-2',model:''},{key:'claude:claude-account-3',model:''},
 {key:'p:antigravity-subscription',model:''},{key:'p:antigravity-subscription#gfc237c',model:''},{key:'p:openai-codex',model:''}];

test('Routine work is Gemini (both accounts, in order), then ChatGPT, with every Claude account switched off',()=>{
 const r=routineOrder(main);
 assert.deepEqual(r.filter(e=>!e.off).map(e=>e.key),['p:antigravity-subscription','p:antigravity-subscription#gfc237c','p:openai-codex']);
 assert.ok(r.filter(e=>e.key.startsWith('claude:')).every(e=>e.off));
 assert.deepEqual(effOrder(main,r).map(e=>e.key),['p:antigravity-subscription','p:antigravity-subscription#gfc237c','p:openai-codex'],'what the server follows: no Claude at all')});

test('each agent row says its rule in words',()=>{
 assert.equal(useMode(main,undefined),'priority');assert.equal(useRule(main,undefined),'Follows Priority');
 assert.equal(useMode(main,routineOrder(main)),'routine');assert.equal(useRule(main,routineOrder(main)),'Gemini, then ChatGPT. Never Claude');
 // Threads as saved on Elkiya on 21 Nov (claude entries last and off) reads as Routine
 const threads=[{key:'p:antigravity-subscription',model:''},{key:'p:antigravity-subscription#gfc237c',model:''},{key:'p:openai-codex',model:''},...main.slice(0,4).map(e=>({...e,off:true}))];
 assert.equal(useMode(main,threads),'routine');
 const own=[{key:'p:openai-codex',model:''},{key:'claude:claude-account-4',model:''}];
 assert.equal(useMode(main,own),'custom');assert.equal(useRule(main.slice(0,4),[{key:'p:openai-codex',model:''},...main.slice(0,4).map(e=>({...e,off:true}))]),'No account switched on','never a rule that starts with a full stop');
 assert.equal(useRule(main,[{key:'claude:claude-account-4',model:''},...main.slice(1).map(e=>({...e,off:true}))]),'Claude only');assert.equal(useRule(main,own),'ChatGPT, then Claude, then Gemini','unmentioned entries join the end, as on the server')});

test('the page no longer offers Light/Standard/Heavy, and Add to priority lists only accounts not in it',()=>{
 assert.doesNotMatch(src,/use-level|LEVELS/);
 assert.match(src,/const left=src\.filter\(s=>!\(s\.isTeam&&!usedBy\(s\.key\)\.length\)&&!pri\.some\(e=>e\.key===s\.key\)\)/);
 assert.doesNotMatch(src,/Again, with this model/);assert.match(src,/Add again with one model/,'a fixed-model entry is still possible, from the account\'s own menu');
 assert.doesNotMatch(src,/icon\('popout'/,'no external-link arrow on the priority rows')});
