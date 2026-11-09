// Automatic updates: when they may run (scripts/auto-update.mjs).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inQuietHours} from './auto-update.mjs';

const at=(iso)=>new Date(iso);
test('runs only between 01:00 and 05:00 in the install\'s time zone',()=>{
 assert.equal(inQuietHours(at('2026-11-09T18:30:00Z'),'Asia/Jakarta'),true);   // 01:30 in Jakarta
 assert.equal(inQuietHours(at('2026-11-09T21:59:00Z'),'Asia/Jakarta'),true);   // 04:59
 assert.equal(inQuietHours(at('2026-11-09T22:00:00Z'),'Asia/Jakarta'),false);  // 05:00
 assert.equal(inQuietHours(at('2026-11-09T17:59:00Z'),'Asia/Jakarta'),false);  // 00:59
 assert.equal(inQuietHours(at('2026-11-09T02:00:00Z'),'UTC'),true)});
test('a broken time zone falls back to UTC instead of stopping',()=>{
 assert.equal(inQuietHours(at('2026-11-09T02:00:00Z'),'Not/AZone'),true);
 assert.equal(inQuietHours(at('2026-11-09T12:00:00Z'),'Not/AZone'),false)});
