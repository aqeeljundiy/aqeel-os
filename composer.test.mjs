import test from 'node:test';
import assert from 'node:assert/strict';
import {fuzzy} from './composer.js';
test('file search prefers matches in the file name',()=>{
 assert.ok(fuzzy('idx','index.html')>0);assert.equal(fuzzy('zzz','index.html'),0);
 assert.ok(fuzzy('style','css/style.css')>fuzzy('style','styles/a/b/main.js'));
});
