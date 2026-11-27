// A box the app opens with stackPop on top of a kit sheet (People > More > Set a new password, the sign-in email) could
// not be typed into: the kit's ak-drawer pulled focus back to the panel. The v2 layer now lets such a box keep its focus
// and clicks (27 Nov 2026). node --test scripts/v2-stack-focus.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');

test('v2.js lets focus into an open stack box escape the kit focus trap',()=>{
 assert.match(read('app/v2.js'),/for\(const t of \['focusin','focusout'\]\)addEventListener\(t,e=>\{[^}]*\.drawer\.stack:not\(\.closing\)[^}]*e\.stopImmediatePropagation\(\)\},true\)/)});

test('v2.css keeps a stack box clickable even when a kit menu left body at pointer-events:none',()=>{
 assert.match(read('app/v2.css'),/html\.v2 \.drawer\.stack,html\.v2 \.scrim\.stack\{pointer-events:auto\}/)});
