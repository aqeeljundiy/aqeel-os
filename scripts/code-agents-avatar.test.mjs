// node --test scripts/code-agents-avatar.test.mjs: an agent's picture for Code's agent chips (owner, 15 Nov 2026: "use their profile pics").
// Its photo, else its emoji, else the automatic emoji (the choice /ui/avatar makes); head:true gives only the version, read without the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCodeAgents} from '../app/code-agents.mjs';
import {emojiSlugs} from '../app/avatar-file.mjs';

async function rig(ids){const DATA=await mkdtemp(path.join(tmpdir(),'ca-'));await mkdir(path.join(DATA,'avatars'),{recursive:true});
 return {DATA,ca:createCodeAgents({HERMES_HOME:path.join(DATA,'h'),DATA,sign:x=>'s'+x,readIds:async()=>ids,outboxAccess:()=>true})}}

test('a photo is served with its type, and head:true gives its version without reading it',async()=>{
 const {DATA,ca}=await rig({shop:{avatar:'shop.webp',avatarV:1794600000000}});
 await writeFile(path.join(DATA,'avatars','shop.webp'),Buffer.from('RIFF0000WEBPVP8 '));
 const p=await ca.avatar('shop');assert.equal(p.type,'image/webp');assert.equal(String(p.body),'RIFF0000WEBPVP8 ');assert.equal(p.v,'1794600000000');
 assert.deepEqual(await ca.avatar('shop',{head:true}),{v:'1794600000000'})});

test('no photo: the chosen emoji, else the automatic one; a missing photo file falls back too',async()=>{
 const l=await emojiSlugs();assert.ok(l.length,'the emoji list ships with the app');
 const {ca}=await rig({cafe:{emoji:l[0]},gone:{avatar:'gone.png'}});
 const e=await ca.avatar('cafe');assert.equal(e.type,'image/png');assert.equal(e.v,'e-'+l[0]);assert.ok(e.body.length>100);
 const auto=await ca.avatar('nobody');assert.equal(auto.type,'image/png');assert.match(auto.v,/^e-/);
 assert.equal((await ca.avatar('gone')).type,'image/png','a photo that is not on disk gives the emoji, not an error')});

test('a stored file name never leaves the avatars folder',async()=>{
 const {DATA,ca}=await rig({x:{avatar:'../secret.png'}});await writeFile(path.join(DATA,'secret.png'),'top secret');
 const p=await ca.avatar('x');assert.notEqual(String(p.body),'top secret')});
