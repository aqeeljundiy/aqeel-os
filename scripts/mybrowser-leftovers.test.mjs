// OPS-16: which "My browser" check agents a run removes as leftovers, and what stays in the test-agents list
import test from 'node:test';
import assert from 'node:assert/strict';
import {nameFor,ageOf,stale,withoutNames} from './mybrowser-leftovers.mjs';

test('a check agent\'s age comes from its name',()=>{
 const t=Date.UTC(2026,10,11,12,0,0);
 assert.match(nameFor(t),/^mb-[0-9a-z]{5}$/);
 assert.equal(ageOf(nameFor(t),t),0);
 assert.equal(ageOf(nameFor(t-90*60e3),t),90*60e3);
 assert.equal(ageOf('aq-livetest',t),null);
 assert.equal(ageOf('mb-1ip0',t),null)});

test('only check agents over an hour old are leftovers; the running one and real agents never are',()=>{
 const t=Date.UTC(2026,10,11,12,0,0),run=nameFor(t-7*60e3),old=nameFor(t-2*3600e3),older=nameFor(t-10*3600e3);
 assert.deepEqual(stale([run,old,older,old,'continue-support','mb-livex2'],t,3600e3,nameFor(t)),[old,older]);
 assert.deepEqual(stale([nameFor(t)],t+2*3600e3,3600e3,nameFor(t)),[])});   // its own name is kept whatever its age

test('the test-agents list loses only the given names',()=>{
 const text='aq-livetest\nmb-aaaaa\ncontinue-support # in training\nmb-bbbbb\nmb-aaaaa\n';
 assert.equal(withoutNames(text,['mb-aaaaa']),'aq-livetest\ncontinue-support # in training\nmb-bbbbb\n');
 assert.equal(withoutNames(text,[]),text)});
