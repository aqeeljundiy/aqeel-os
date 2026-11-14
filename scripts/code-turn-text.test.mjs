// node --test scripts/code-turn-text.test.mjs: a Code turn reaches the engine with the person's message as typed and Code's own
// instructions as the system message (owner, 15 Nov 2026: "you hard coded a prompt before my user request").
import test from 'node:test';
import assert from 'node:assert/strict';
import {turnText} from '../app/code-device-routes.mjs';
test('message and instructions apart: the message is what the person typed, the instructions go to the system message',()=>{
 const t=turnText({message:'Build me a website for Skintific',instructions:'You are working in aqeelOS Code on the project "Shop".',prompt:'joined'});
 assert.equal(t.text,'Build me a website for Skintific');assert.match(t.sys,/project "Shop"/)});
test('an older Code (one prompt) keeps working, with no system message',()=>{
 assert.deepEqual(turnText({prompt:'Do this'}),{text:'Do this',sys:''});
 assert.deepEqual(turnText({message:'only half'}),{text:'',sys:''},'both parts or neither: half a split falls back to prompt');
 assert.deepEqual(turnText({}),{text:'',sys:''})});
