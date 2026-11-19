// Health for an agent's owner (app/my-health.mjs, roles design RO-4, 19 Nov 2026)
import test from 'node:test';import assert from 'node:assert/strict';
import {mineView,stateText} from '../app/my-health.mjs';
const now=Date.parse('2026-11-19T06:00:00Z'),day=864e5;
const view={agents:[{agent:null,name:'aqeelOS itself',problems:[{title:'box'}]},{agent:'default',name:'Pixel'},{agent:'lead-a',name:'Lead A',ok:true},{agent:'other-b',name:'Other B',ok:false,problems:[{title:'x'}]}],at:now};
const mayEdit=a=>a==='lead-a'||a==='default';
test('only the agents the person may edit, never the main agent or the install row',()=>{
 assert.deepEqual(mineView({view,mayEdit,now}).agents.map(r=>r.agent),['lead-a'])});
test('Fixer items about their agents: open ones, and ended ones from this week; needs-you first',()=>{
 const issues=[{id:'i1',agent:'lead-a',state:'queued',title:'q',created:now-3*day},{id:'i2',agent:'other-b',state:'needs_human',title:'not theirs'},
  {id:'i3',agent:'other-b',affects:['lead-a'],state:'needs_human',need:'Sign in',title:'n',updated:now-day},{id:'i4',agent:'lead-a',state:'fixed',updated:now-9*day},
  {id:'i5',agent:'lead-a',state:'fixed',updated:now-day,title:'f'},{id:'i6',agent:'default',state:'queued'},{id:'i7',agent:'lead-a--sub',state:'stuck',need:'',title:'s'}];
 const f=mineView({view,issues,mayEdit,now}).fixer;
 assert.deepEqual(f.map(i=>i.id).sort(),['i1','i3','i5','i7']);
 assert.equal(f.find(i=>i.id==='i3').needsYou,true);assert.equal(f.find(i=>i.id==='i7').needsYou,false);
 assert.equal(f.at(-1).id,'i5','ended last');
 assert.equal(stateText('needs_human'),'Needs a person')});
