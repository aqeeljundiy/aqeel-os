// An app added by its address (app/mcp-add-check.mjs, 11 Nov 2026): "WO Dashboard - Google Sheet" with a spreadsheet link
import test from 'node:test';
import assert from 'node:assert/strict';
import {mcpAddProblem} from '../app/mcp-add-check.mjs';

test('a name with spaces is refused before the engine sees it',()=>{
 assert.match(mcpAddProblem({name:'WO Dashboard - Google Sheet',url:'https://mcp.example.com/mcp'}),/no spaces/);
 assert.match(mcpAddProblem({name:''}),/Give it a name/);
 assert.equal(mcpAddProblem({name:'wo-dashboard',url:'https://mcp.example.com/mcp'}),null)});

test('a Google file link is not an app: the person is sent to Connect Google',()=>{
 for(const u of ['https://docs.google.com/spreadsheets/d/1tVX/edit?gid=1#gid=1','https://drive.google.com/file/d/x','https://sheets.google.com/x'])
  assert.match(mcpAddProblem({name:'wo-dashboard',url:u}),/Connect a Google account/,u);
 assert.equal(mcpAddProblem({name:'gws',url:'https://mcp.googleapis.example/mcp'}),null)});

test('a command-started app has no address to check',()=>{assert.equal(mcpAddProblem({name:'local-tool',command:'npx'}),null)});
