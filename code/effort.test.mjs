import test from 'node:test';
import assert from 'node:assert/strict';
import {startEffort} from './effort.js';
// owner, 15 Nov 2026: "effort by default is none". None turns thinking off; a model starts on its own default, else Medium
test('a model starts on its own default effort, else Medium, never None unless it is all there is',()=>{
 assert.equal(startEffort({efforts:['none','low','medium','high']}),'medium');
 assert.equal(startEffort({efforts:['none','low','medium','high'],defaultEffort:'high'}),'high');
 assert.equal(startEffort({efforts:['none','low','high']}),'low');
 assert.equal(startEffort({efforts:['none']}),'none');
 assert.equal(startEffort({efforts:[]}),'');assert.equal(startEffort(null),'');
 assert.equal(startEffort({efforts:['low','high'],defaultEffort:'xhigh'}),'low','a default the model does not list is not used')});
