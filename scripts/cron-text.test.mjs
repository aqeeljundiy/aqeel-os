// Schedules in plain words (app/core.js cronText), checked against the real source: step values in the minute, hour and
// day fields are said in words, and nothing ever shows the raw cron (10 Nov 2026 audit: "0 10 */2 * *").
// Run: node --test scripts/cron-text.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../app/core.js',import.meta.url),'utf8');
const grab=start=>{const i=src.indexOf(start);assert.ok(i>=0,start+' not found in core.js');let j=src.indexOf('\n',i);while(/^\s/.test(src.slice(j+1,j+2)))j=src.indexOf('\n',j+1);return src.slice(i,j)};
const cronText=new Function(grab('function cronText(')+'\nreturn cronText')();

test('the plain ones stay as they were',()=>{
 assert.equal(cronText('0 3 * * 1'),'Mondays at 03:00');
 assert.equal(cronText('30 9 * * 1-5'),'Weekdays at 09:30');
 assert.equal(cronText('0 8 * * *'),'Every day at 08:00');
 assert.equal(cronText('0 9 1 * *'),'On the 1st of each month at 09:00');
 assert.equal(cronText('*/30 9-19 * * 1-5'),'Weekdays every 30 minutes from 09:00 to 19:59');
 assert.equal(cronText('15 * * * *'),'Every hour at :15');
 assert.equal(cronText('every 30m'),'every 30m')});   // not cron: the engine's own words come back as they were

test('step values in the day, hour and minute fields',()=>{
 assert.equal(cronText('0 10 */2 * *'),'Every 2 days at 10:00');
 assert.equal(cronText('0 10 1/3 * *'),'Every 3 days at 10:00');
 assert.equal(cronText('0 */2 * * *'),'Every 2 hours');
 assert.equal(cronText('30 */4 * * *'),'Every 4 hours at :30');
 assert.equal(cronText('0 8-18/2 * * 1-5'),'Weekdays every 2 hours from 08:00 to 18:00');
 assert.equal(cronText('*/5 * * * *'),'Every 5 minutes');
 assert.equal(cronText('5/15 * * * *'),'Every 15 minutes from :05');
 assert.equal(cronText('*/1 * * * *'),'Every minute');
 assert.equal(cronText('0 9 1 */3 *'),'Every 3 months on the 1st at 09:00')});

test('names, shorthands and weekends',()=>{
 assert.equal(cronText('0 7 * * MON-FRI'),'Weekdays at 07:00');
 assert.equal(cronText('0 10 * * 0,6'),'Weekends at 10:00');
 assert.equal(cronText('@daily'),'Every day at 00:00');
 assert.equal(cronText('0 9 * * 7'),'Sundays at 09:00')});

test('an odd timetable is still a sentence, never raw cron',()=>{
 for(const e of ['0 10 */2 * 1-5','5 1-3 1,15 * *','0 0 L * *','*/7 */3 */2 */2 *']){const t=cronText(e);
  assert.ok(t&&t!==e,e+' came back raw');assert.doesNotMatch(t,/\*|\//,e+' → '+t)}});
