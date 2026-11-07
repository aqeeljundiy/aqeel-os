import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUrl} from './browser.mjs';
test('address bar input becomes a safe http(s) URL or a search',()=>{
 assert.equal(normalizeUrl('https://example.com/a'),'https://example.com/a');
 assert.equal(normalizeUrl('example.com'),'https://example.com');
 assert.equal(normalizeUrl('localhost:5173/x'),'http://localhost:5173/x');
 assert.equal(normalizeUrl('127.0.0.1:4323'),'http://127.0.0.1:4323');
 assert.equal(normalizeUrl('best pizza in town'),'https://www.google.com/search?q=best%20pizza%20in%20town');
 for(const bad of ['javascript:alert(1)','file:///C:/Windows','data:text/html,x',''])assert.throws(()=>normalizeUrl(bad));
});
