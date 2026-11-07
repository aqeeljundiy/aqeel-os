// Tests for the team group setting (app/team-group.mjs). Run: node --test scripts/team-group.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createTeamGroups,cleanGroup,contextLines} from '../app/team-group.mjs';

test('set keeps what was not sent, checks ids and topics, and tells the owner who changed what',async()=>{const told=[];
 const g=createTeamGroups({DATA:await mkdtemp(path.join(tmpdir(),'tg-')),tell:async(a,b,n)=>{told.push([a,b,n])}});
 assert.equal(await g.get('cove-support'),null);
 const a=await g.set('cove-support',{name:'Cove',chatId:'-1003999095054',topics:{questions:'3',orders:101,log:5,own:14},mention:'@illusiveminds @diabloxd1337'},'Abel');
 assert.deepEqual([a.chatId,a.topics,a.by],[-1003999095054,{questions:3,orders:101,log:5,own:14},'Abel']);
 const b=await g.set('cove-support',{orders:5},'cove-support (asked in chat)');assert.equal(b.topics.orders,5);assert.equal(b.topics.questions,3);assert.equal(b.name,'Cove');
 assert.equal(told.length,2);assert.equal(told[1][1].topics.orders,101);assert.equal(told[1][2].topics.orders,5);
 await assert.rejects(g.set('cove-support',{chatId:'my group'}),/number like/);
 await assert.rejects(g.set('cove-support',{topics:{orders:'orders'}}),/topic number/);
 await assert.rejects(g.set('../x',{}),/Unknown agent/);
 assert.equal((await g.get('cove-support')).topics.orders,5,'a refused change changes nothing');
 assert.deepEqual(cleanGroup(null,{topics:{questions:3,weird:9}}).topics,{questions:3});
 assert.equal(cleanGroup({chatId:-1,topics:{log:6}},{log:''}).topics.log,null)});

test('the context agents read names the group and every topic, and says it beats older notes',()=>{
 const t=contextLines({name:'Baylabs - Support Agent',chatId:-1003989506863,topics:{questions:89,orders:7,log:6},mention:'@diabloxd1337'}).join('\n');
 for(const x of ['-1003989506863','Questions: topic 89','Orders: topic 7','Log: topic 6','Own topic: not set','@diabloxd1337','team_group'])assert.ok(t.includes(x),x);
 assert.match(contextLines(null).join(' '),/No team group/)});
