import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SideBrowser} from './browser.mjs';
// owner, 15 Nov 2026: "per session needs to have different browser ... should be like claude code"
function rig(){const b=new SideBrowser(mkdtempSync(path.join(tmpdir(),'sb-')));let n=1;const pages=[{id:'t1',type:'page',url:'https://shop.test/',title:'Shop'}];
 b.state='running';b.ensure=async()=>{};b.note=()=>{};b.target='t1';
 b.devtools=async(route)=>{if(route==='list')return pages.map(p=>({...p}));if(route.startsWith('new?')){const id='t'+(++n);pages.push({id,type:'page',url:'about:blank',title:''});return {id}}return {}};
 b.switchTab=async id=>{b.target=id;await b.refreshTabs();return b.status()};b.connectAi=async id=>{b.aiWs={readyState:1};b.aiWsId=id};
 return {b,pages}}
test('each chat sees only its own tabs and comes back to the tab it left',async()=>{const {b}=rig();
 await b.useChat('A');await b.refreshTabs();assert.deepEqual(b.tabs.map(t=>t.id),['t1'],'a tab no one claimed is the open chat\'s');
 await b.useChat('B');assert.equal(b.tabs.length,1);assert.notEqual(b.target,'t1','chat B gets a tab of its own');const bTab=b.target;
 await b.useChat('A');assert.equal(b.target,'t1');assert.deepEqual(b.tabs.map(t=>t.id),['t1'],'chat B\'s tab is not in chat A');
 await b.useChat('B');assert.equal(b.target,bTab,'back to the tab left in chat B')});
test('another chat\'s AI works in a tab of its own chat and never moves the person\'s view',async()=>{const {b}=rig();
 await b.useChat('A');await b.refreshTabs();
 await b.aiTab('B');assert.equal(b.target,'t1','the person still sees chat A\'s tab');assert.notEqual(b.aiTarget,'t1');assert.equal(b.owner.get(b.aiTarget),'B');
 assert.ok(!b.tabs.some(t=>t.id===b.aiTarget),'B\'s AI tab is not listed in chat A');const first=b.aiTarget;
 await b.aiTab('B');assert.equal(b.aiTarget,first,'the same AI tab next time');
 await b.aiTab('A');assert.notEqual(b.aiTarget,first,'chat A\'s AI has its own tab')});
