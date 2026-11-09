// Runs the Python tests of the Telegram group digest (engine/aqeelos-group-context). Run: node --test scripts/group-context.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('a topic sees the group\'s other topics, bounded, and nothing else',()=>{
 const f=path.join(path.dirname(fileURLToPath(import.meta.url)),'group-context.test.py');
 assert.equal(execFileSync('python3',[f],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}).trim(),'ok')});
