// The agents' aqeelOS tool server (/mcp/notify in server.mjs) adds its tools to a tools/list answer only. A push outside
// that guard runs on every call, and "initialize" has no tool list: on 7 Nov 2026 one unguarded push answered every
// initialize with a 500, so every agent lost send_to_person, choose_browser, my_settings and the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8');
test('every tool added to the notify tool list is added only on a tools/list answer',()=>{
 const at=[...src.matchAll(/out\.body\.result\.tools\.push\(/g)].map(m=>m.index);assert.ok(at.length>=3,'found the pushes');
 // the push must be the statement of an if that checks for a tools list, on its own line (nothing between them)
 for(const i of at){const line=src.slice(src.lastIndexOf('\n',i)+1,i);
  assert.match(line,/^\s*if\(signed&&msg\.method==='tools\/list'&&Array\.isArray\(out\.body\?\.result\?\.tools\)[^;]*\)$/,'unguarded push: '+line.slice(-80)+src.slice(i,i+60))}});
test('switch_my_app_off and my_settings are both offered',()=>{for(const n of ['switch_my_app_off','my_settings','choose_browser'])assert.ok(src.includes("{name:'"+n+"'"),n)});
