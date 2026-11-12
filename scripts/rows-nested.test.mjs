// UI audit 12 (13 Nov 2026): a clickable row never holds a button inside a button or a role=button. The row is plain, its main action is
// a real button (.row-main, stretched over the row by CSS), and the row's other buttons are its siblings. scripts/sweep.js checks the same
// in a real browser on the pages it opens; this reads the templates, so a rebuilt row cannot quietly go back.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
const css=src('app.css');
test('the chat list: the chat is one button and More is its sibling',()=>{const s=src('chat.js');
 assert.match(s,/<div class="item-row"><button class="item /);assert.doesNotMatch(s,/class="more" role="button"/);assert.match(s,/<\/button><button type="button" class="more" data-menu="convo"/)});
test('Schedules: a job row and a folder bar',()=>{const s=src('schedules.js');
 assert.doesNotMatch(s,/class="row sj-row"[^>]*tabindex="0"/);assert.match(s,/class="row-main" data-act="cron-open"/);
 assert.doesNotMatch(s,/class="sf-more"[^>]*role="button"/);assert.match(s,/<div class="sf-bar"><button class="sf-head"/);assert.match(s,/<button type="button" class="sf-more" data-act="sched-folder-menu"/);
 assert.doesNotMatch(s,/ACT\['cron-open'\]=\(a,e\)=>\{if\(e\.target\.closest\('[^']*button/,'the row-main button must not be skipped by the click handler')});
test('n8n rows, channel tiles, bell items and Activity rows',()=>{
 assert.doesNotMatch(src('n8n-page.js'),/cn-row"[^>]*role="button"/);assert.match(src('n8n-page.js'),/class="row-main" data-act="n8n-panel"/);
 const p=src('pages.js');assert.doesNotMatch(p,/<button class="card tile" \$\{st\(i\)\} data-act="ch-open"/);assert.match(p,/class="row-main" data-act="ch-open"/);
 assert.doesNotMatch(src('people.js'),/class="add-another" role="button"/);
 assert.doesNotMatch(src('notices.js'),/class="ib-item [^>]*tabindex="0"/);assert.match(src('notices.js'),/class="row-main">\$\{esc\(x\.title\)\}/);
 assert.doesNotMatch(src('activity-page.js'),/class="row act-row[^>]*tabindex="0"/)});
test('the stretch and the focus ring are in the CSS, and the sweep looks for nested buttons',()=>{
 assert.match(css,/button\.row-main::after\{content:"";position:absolute;inset:0/);assert.match(css,/button\.row-main:focus-visible::after\{outline/);assert.match(css,/\.rm\{position:relative\}/);
 assert.match(readFileSync(new URL('./sweep.js',import.meta.url),'utf8'),/a button or a row holding another button/)});
