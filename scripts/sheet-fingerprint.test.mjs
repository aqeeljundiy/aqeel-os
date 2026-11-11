// Tests for scripts/sheet-fingerprint.mjs. Run: node --test scripts/sheet-fingerprint.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {rangeOf,fingerprint} from './sheet-fingerprint.mjs';

test('the range keeps plain words on the command line: an underscore is a space in the tab name',()=>{
 assert.equal(rangeOf('Master_Backlog!A2:I400'),"'Master Backlog'!A2:I400");assert.equal(rangeOf('Tab!A1:B2'),"'Tab'!A1:B2");assert.throws(()=>rangeOf('A1:B2'));assert.throws(()=>rangeOf(''))});
test('the fingerprint changes with any cell and not otherwise',()=>{
 const a=[['x','Done'],['y','Pending']];assert.equal(fingerprint(a),fingerprint(JSON.parse(JSON.stringify(a))));assert.notEqual(fingerprint(a),fingerprint([['x','Done'],['y','Done']]));
 assert.equal(fingerprint(undefined),fingerprint([]));assert.match(fingerprint(a),/^[0-9a-f]{12}$/)});
