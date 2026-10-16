import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {ERROR_REPORTER,emptyPreview} from './workspace-api.mjs';

test('the script injected into previews parses (backslashes survive the template)',()=>{
 assert.doesNotThrow(()=>new vm.Script(ERROR_REPORTER));
 assert.match(ERROR_REPORTER,/\\\/preview\\\//);
});

test('a preview opened in its own tab does not message itself',()=>{
 assert.match(ERROR_REPORTER,/report=\(\)=>\{if\(parent===window\)return;/);
});

test('the empty preview speaks the app language and polls for the page',()=>{
 const en=emptyPreview('p1','index.html'),id=emptyPreview('p1','index.html','id');
 assert.match(en,/<html lang="en">/);assert.match(en,/Your preview starts here/);assert.match(en,/__cba-status\?page=index\.html/);
 assert.match(id,/<html lang="id">/);assert.match(id,/Pratinjau Anda muncul di sini/);assert.match(id,/sedang membangun ini/);
 assert.doesNotMatch(emptyPreview('p1','<b>.html'),/<b>/);
});
