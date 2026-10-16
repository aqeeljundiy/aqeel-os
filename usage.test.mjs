import test from 'node:test';
import assert from 'node:assert/strict';
import {costOf,validatePrices,extractJson,SEED} from './usage.mjs';
test('API-equivalent cost uses input, cached, cache-write and output prices',()=>{
 const line={model:'gpt-6.1-sol',input:1_000_000,cachedInput:2_000_000,output:100_000,reasoning:100_000};
 assert.equal(costOf(line,SEED).toFixed(4),(2+0.2+2).toFixed(4));
 assert.equal(costOf({model:'claude-haiku-5-5',input:5},SEED),null,'unpriced model');assert.equal(costOf({model:'unknown',input:5},SEED),null);
});
test('price edits are validated and AI replies parsed',()=>{
 assert.deepEqual(validatePrices({'x-1':{input:'1.5',output:3,cachedInput:''}}),{'x-1':{input:1.5,cachedInput:null,cacheWrite:null,output:3}});
 assert.throws(()=>validatePrices({'x':{input:-1}}));assert.throws(()=>validatePrices({'bad id!':{}}));
 assert.deepEqual(extractJson('Here you go:\n```json\n{"models":{"a":{"input":1}}}\n```'),{models:{a:{input:1}}});
 assert.throws(()=>extractJson('no table'));
});
