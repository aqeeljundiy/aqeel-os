import test from 'node:test';
import assert from 'node:assert/strict';
import {parts} from './engine.mjs';
import {INSTRUCTIONS} from './agent.mjs';
// owner, 15 Nov 2026: "you hard coded a prompt before my user request ... whatever the LLM produces should not be biased"
test('an engine turn sends the person\'s message as typed, with Code\'s instructions apart (and joined only for an older aqeelOS)',()=>{
 const p=parts({instructions:'You are working in aqeelOS Code on the project "Shop".',message:'Build me a website for Skintific'});
 assert.equal(p.message,'Build me a website for Skintific');assert.match(p.instructions,/project "Shop"/);
 assert.equal(p.prompt,p.instructions+'\n\n'+p.message);
 assert.deepEqual(parts('one old-style prompt'),{prompt:'one old-style prompt'})});
test('the app\'s own instructions say how to reach things, not what to build with or how to reply',()=>{
 assert.doesNotMatch(INSTRUCTIONS,/prefer static HTML/i);assert.doesNotMatch(INSTRUCTIONS,/Finish with a short/i);
 assert.match(INSTRUCTIONS,/Never push or open a pull request unless the user asked/,'the safety rules stay')});
