// Every server runs the same version (app/live-drift.mjs, 20 Nov 2026): a box behind GitHub's main is said once it lasts 2 hours.
// Run: node --test scripts/live-behind.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createLiveDrift} from '../app/live-drift.mjs';
test('a box behind GitHub main (app code) is listed after two hours, with the version to deploy; a box on main is not',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lb-')),live=path.join(root,'live'),DATA=path.join(root,'data');await mkdir(path.join(live,'app'),{recursive:true});
 await writeFile(path.join(live,'.deployed-commit'),'047b8073\n');await writeFile(path.join(live,'app','a.js'),'x');
 let t=Date.UTC(2026,10,20,12,0),ahead=4;const blob='c1b5ed30b3d5cf4c42a0f5fc5b5e0b4a0d8d2f6c';
 const git=async a=>a[0]==='ls-tree'?'100644 blob '+(await import('../app/live-drift.mjs')).blobId(Buffer.from('x'))+'\tapp/a.js\0':a[0]==='fetch'?'':a[0]==='rev-list'?String(ahead):a[0]==='rev-parse'?'ab813bd4':a[0]==='diff'?'app/accounts.mjs\napp/ledger.mjs':'';
 const d=createLiveDrift({DATA,live,repo:root,git,now:()=>t});
 await d.check();assert.equal(await d.item(),null,'not yet: it may be deploying');
 t+=2*3600e3+1;await d.check();const it=await d.item();assert.equal(it.behind,true);assert.equal(it.count,4);assert.equal(it.head,'ab813bd4');assert.deepEqual(it.files,['app/accounts.mjs','app/ledger.mjs']);
 ahead=0;await d.check();assert.equal(await d.item(),null,'on main again: nothing to say')});
