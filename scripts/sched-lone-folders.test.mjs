// Schedules (app/schedules.js): a folder holding one schedule is not a folder; that schedule shows loose where the folder
// would be. Folders with two or more stay folders (owner, 14 Nov 2026, UI audit item 16).
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../app/schedules.js',import.meta.url),'utf8');
const m=/const schedLoneFolders=[^\n]*;/.exec(src);
test('schedLoneFolders names only the folders with exactly one schedule, counted over every schedule',()=>{assert.ok(m,'schedLoneFolders is in schedules.js');
 const lone=new Function(m[0]+';return schedLoneFolders')(),f=j=>j.f;
 const jobs=[{f:'Reports'},{f:'Reports'},{f:'Posting'},{f:'General'},{f:'Ads'},{f:'Ads'},{f:'Ads'}];
 assert.deepEqual([...lone(jobs,f)].sort(),['General','Posting']);assert.deepEqual([...lone([],f)],[]);assert.deepEqual([...lone(null,f)],[])});
test('the page draws a lone folder\'s schedule as a loose row, and joins loose rows that follow each other into one card',()=>{
 assert.match(src,/const lone=schedLoneFolders\(jobs,folderOf\),loose=f=>lone\.has\(f\)&&groups\[f\]\?\.length===1;/);
 assert.match(src,/if\(loose\(f\)\)return `\$\{loose\(order\[i-1\]\)\?'':'<div class="sched-loose"><div class="card list">'\}\$\{row\(l\[0\]\)\}\$\{loose\(order\[i\+1\]\)\?'':'<\/div><\/div>'\}`;/);
 assert.match(readFileSync(new URL('../app/app.css',import.meta.url),'utf8'),/\.sched-loose\{margin-bottom:8px\}/)});
