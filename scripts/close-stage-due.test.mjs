// Tests for scripts/close-stage-due.mjs. Run: node --test scripts/close-stage-due.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {dueLines,workMonth} from './close-stage-due.mjs';

const H=['Work month','Revision','Run ID','Stage','Status','Verified at (Asia/Jakarta)','Source/output links','Reconciled totals and fingerprints','Blocker','Evidence'];
const row=(m,r,s,st)=>[m,r,'x',s,st];
const S1='1 - Payroll & Billing',S2='2 - PDFs & Drafts',S3='3 - Finance Journal';

test('the work month is the month before the current one in Jakarta, across a year end and the UTC date line',()=>{
 assert.equal(workMonth(new Date('2026-11-03T05:00:00+07:00')),'2026-10');assert.equal(workMonth(new Date('2027-01-02T05:00:00+07:00')),'2026-12');
 assert.equal(workMonth(new Date('2026-10-31T18:30:00Z')),'2026-10','01:30 on 1 Nov in Jakarta is still before the 1st in UTC: the Jakarta month wins')});

test('stage 2 is due when stage 1 is Verified for a revision and stage 2 is not; nothing when stage 1 is not',()=>{
 const rows=[H,row('2026-10','R1',S1,'Blocked'),row('2026-10','R2',S1,'Verified')];
 assert.deepEqual(dueLines(rows,{stage:2,month:'2026-10'}),['stage 2 is due for 2026-10 R2 (now none)']);
 assert.deepEqual(dueLines([H,row('2026-10','R1',S1,'Blocked')],{stage:2,month:'2026-10'}),[]);
 assert.deepEqual(dueLines(rows,{stage:2,month:'2026-09'}),[],'another month');
 assert.deepEqual(dueLines([...rows,row('2026-10','R2',S2,'Verified')],{stage:2,month:'2026-10'}),[],'done');
 assert.deepEqual(dueLines([...rows,row('2026-10','R2',S2,'Blocked')],{stage:2,month:'2026-10'}),['stage 2 is due for 2026-10 R2 (now Blocked)'])});

test('stage 3 needs stages 1 and 2 Verified for the same revision; a new revision is due again',()=>{
 const rows=[H,row('2026-10','R2',S1,'Verified'),row('2026-10','R2',S2,'Verified'),row('2026-10','R2',S3,'Blocked'),row('2026-10','R3',S1,'Verified'),row('2026-10','R10',S1,'Verified'),row('2026-10','R10',S2,'Verified')];
 assert.deepEqual(dueLines(rows,{stage:3,month:'2026-10'}),['stage 3 is due for 2026-10 R2 (now Blocked)','stage 3 is due for 2026-10 R10 (now none)']);
 assert.deepEqual(dueLines(rows,{stage:2,month:'2026-10'}),['stage 2 is due for 2026-10 R3 (now none)'],'R3 has no stage 2 yet')});

test('a tab without the columns is an error, not "nothing due"',()=>{assert.throws(()=>dueLines([['a','b']],{stage:2,month:'2026-10'}),/columns/);assert.throws(()=>dueLines([],{stage:2,month:'x'}),/columns/)});
