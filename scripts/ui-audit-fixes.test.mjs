// UI audit part 5, second round (13 Nov 2026): the small fixes that stay fixed.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
test('an agent id that lost its apostrophe reads as a possessive',()=>{
 const m=/const prettyId=[^\n]*;/.exec(src('core.js'));assert.ok(m,'prettyId is in core.js');const prettyId=new Function(m[0]+';return prettyId')();
 assert.equal(prettyId('firdha-s-assistant'),'Firdha’s assistant');assert.equal(prettyId('pixel-agent'),'Pixel agent');assert.equal(prettyId('sdr'),'Sdr');assert.equal(prettyId('content-strategist'),'Content strategist')});
test('the expired invite offers two real buttons, not two small links',()=>{const a=src('account-setup.js');
 assert.match(a,/This link doesn't work<\/h1>[^`]*class="primary" data-ac="back">Go to sign in<\/button>/)});
test('no .env file jargon is left on the pages, in English or in the Indonesian table',()=>{for(const f of ['pages.js','all-agents.js','all-agents-more.js','lang-id-more.js'])assert.doesNotMatch(src(f),/\.env file|file \.env/,f)});
test('the model picker shows the name; the raw id waits in a tooltip (and shows only where two choices share a name)',()=>{const p=src('pages.js');
 assert.match(p,/title="\$\{esc\(c\.sub\|\|c\.value\)\}"/);assert.match(p,/ch\.some\(x=>x!==c&&x\.label===c\.label\)/);assert.match(src('core.js'),/btn\.title=o\?\.title\|\|''/)});
test('a member\'s Files has no agent picker; Kirimdev says "every 20 seconds" only when there is something to read',()=>{
 assert.match(src('files.js'),/if\(S\.me\?\.admin!==false\)viewPick\(/);assert.match(src('kirimdev-page.js'),/d\.reach&&!d\.reach\.ok&&d\.keySaved&&\(d\.lines\|\|\[\]\)\.length/)});
test('Health says "1 thing needs you" with its number',()=>{assert.match(src('health-page.js'),/pl=\(k,one,many\)=>k===1\?'1 '\+one:k\+' '\+many/)});
test('the corner sizes and heights come to the scale',()=>{const c=src('app.css');
 assert.match(c,/\.sched-folder,\.hv\{border-radius:var\(--r-card\)\}/);assert.match(c,/\.sel-btn\{min-height:40px;padding-block:9px\}/);assert.match(c,/\.app\.screen-open \.k-btn \.k-label/)});
