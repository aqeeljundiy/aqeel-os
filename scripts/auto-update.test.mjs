// Automatic updates: when they may run (scripts/auto-update.mjs). Since 12 Nov 2026 that is the install's maintenance
// window (app/maintenance.mjs), 00:00 to 01:00 Jakarta time unless the install sets its own.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mayUpdateNow} from './auto-update.mjs';

const at=(iso)=>new Date(iso);
test('runs only inside the maintenance window, 00:00 to 01:00 Jakarta time by default',()=>{
 assert.equal(mayUpdateNow(at('2026-11-09T17:00:00Z'),{}),true);    // 00:00 in Jakarta
 assert.equal(mayUpdateNow(at('2026-11-09T17:45:00Z'),{}),true);    // 00:45
 assert.equal(mayUpdateNow(at('2026-11-09T18:00:00Z'),{}),false);   // 01:00
 assert.equal(mayUpdateNow(at('2026-11-09T18:30:00Z'),{}),false);   // 01:30: the old quiet hours no longer count
 assert.equal(mayUpdateNow(at('2026-11-09T16:59:00Z'),{}),false);   // 23:59
 assert.equal(mayUpdateNow(at('2026-11-09T17:30:00Z'),{timezone:'Europe/Amsterdam'}),true)});   // the window has its own zone
test('an install with its own window follows that one',()=>{const s={maintenance:{from:'02:00',to:'03:00',tz:'UTC'}};
 assert.equal(mayUpdateNow(at('2026-11-09T02:10:00Z'),s),true);assert.equal(mayUpdateNow(at('2026-11-09T17:10:00Z'),s),false)});
test('a broken window setting falls back to the default instead of stopping updates',()=>{
 assert.equal(mayUpdateNow(at('2026-11-09T17:10:00Z'),{maintenance:{from:'x',to:'y',tz:'Not/AZone'}}),true);
 assert.equal(mayUpdateNow(at('2026-11-09T12:00:00Z'),{maintenance:{tz:'Not/AZone'}}),false)});
