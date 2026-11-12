// The access_list tool of /mcp/notify: its reply names the agents behind each pending request with nm(). A comment that swallowed
// "const nm=..." made that reply throw a ReferenceError whenever the agent had a request of its own (found in the server.mjs split, 12 Nov 2026).
import test from 'node:test';import assert from 'node:assert/strict';
import {createNotifyToolsRoutes} from '../app/notify-tools-routes.mjs';
test('access_list names the agent a request was sent to',async()=>{
 const handle=createNotifyToolsRoutes({
  NAMES:{boss:'The Boss'},relayKeys:{ok:()=>true},
  readBody:async()=>JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'access_list',arguments:{}}}),
  accessAsk:{others:async()=>[],mine:async()=>[],of:async()=>[{what:'google',label:'Sheet',to:'boss',done:false}]},
  adminTier:()=>true,lockedAgent:()=>false,users:{agentMayManage:()=>true},
  send:(res,status,body)=>{res.out={status,body}}});
 const res={},req={method:'POST',socket:{remoteAddress:'127.0.0.1'}};
 assert.equal(await handle(req,res,'/mcp/notify/agent-a/sig'),true);
 assert.equal(res.out.status,200);
 const text=res.out.body.result.content[0].text;assert.ok(!res.out.body.result.isError,text);assert.match(text,/for The Boss/);
});
