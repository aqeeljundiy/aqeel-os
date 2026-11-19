// Tests for app/skill-follow.mjs (SV-6, 19 Nov 2026). Run: node --test scripts/skill-follow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {folderSig,follow} from '../app/skill-follow.mjs';

async function setup(){const d=await mkdtemp(path.join(tmpdir(),'sf-')),src=path.join(d,'main','writing-kit'),dst=path.join(d,'agent','writing-kit');
 await mkdir(path.join(src,'references'),{recursive:true});await writeFile(path.join(src,'SKILL.md'),'---\nname: writing-kit\n---\nRead references/gone-file.md first.\n');
 await writeFile(path.join(src,'references','ideas.md'),'ideas');await cp(src,dst,{recursive:true});return {src,dst}}

test('a given copy nobody changed follows the fixed main copy',async()=>{const {src,dst}=await setup();
 const first=await follow({src,dst});assert.equal(first.copy,false);assert.ok(first.sig);                    // same as main: the baseline
 await writeFile(path.join(src,'SKILL.md'),'---\nname: writing-kit\n---\nRead references/ideas.md first.\n');   // the fix on the main copy
 const next=await follow({src,dst,was:first.sig});assert.equal(next.copy,true);assert.equal(next.sig,await folderSig(src))});

test('a copy the agent changed is its own and is never overwritten',async()=>{const {src,dst}=await setup();const first=await follow({src,dst});
 await writeFile(path.join(dst,'SKILL.md'),'my own notes');await writeFile(path.join(src,'SKILL.md'),'main changed too');
 const r=await follow({src,dst,was:first.sig});assert.equal(r.copy,false);assert.equal(r.sig,first.sig)});

test('a skill given before fingerprints existed is only adopted when it is the same as the main copy',async()=>{const {src,dst}=await setup();
 await writeFile(path.join(src,'SKILL.md'),'main moved on');const r=await follow({src,dst});assert.equal(r.copy,false);assert.equal(r.sig,undefined)});

test('a content change changes the fingerprint; a missing folder has none',async()=>{const {src,dst}=await setup();const a=await folderSig(src);
 await writeFile(path.join(src,'references','ideas.md'),'more ideas');assert.notEqual(await folderSig(src),a);
 await rm(dst,{recursive:true});assert.equal(await folderSig(dst),null);assert.equal((await follow({src,dst,was:a})).copy,false)});
