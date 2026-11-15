// connect_mcp_tool when a service lets no app register itself. 15 Nov 2026: the owner asked Donna to install Meta's ads MCP (mcp.facebook.com/ads);
// the sign-in failed with Meta's "Dynamic registration is not available for this client", which the old test /client registration|client_id|client id/i
// missed, so she got a raw "Could not start the sign-in" and asked the owner open questions instead of giving the one setup step.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNotifyToolsRoutes,appSettings,NEEDS_OWN_APP} from '../app/notify-tools-routes.mjs';
const META_ERR='Dynamic registration is not available for this client';
const MAIN_RE=/client registration|client_id|client id/i;   // main's test before this change
const BASE='https://box.example.test/mcp-oauth';
async function call(tool,err,url='https://mcp.example.test/mcp'){
 const handle=createNotifyToolsRoutes({MCP_OAUTH_BASE:BASE,NAMES:{},relayKeys:{ok:()=>true},appSettings,
  readBody:async()=>JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'connect_mcp_tool',arguments:{tool}}}),
  whyOf:{noteApp:async()=>{},from:async()=>null},sharing:{prepareSignin:async()=>({url,own:false})},slackc:{client:async()=>null},
  startSignin:async()=>({error:err}),send:(res,status,body)=>{res.out={status,body}}});
 const res={};assert.equal(await handle({method:'POST',socket:{remoteAddress:'127.0.0.1'}},res,'/mcp/notify/default/sig'),true);
 return {text:res.out.body.result.content[0].text,isError:!!res.out.body.result.isError}}
test("main's test misses Meta's wording; the new one catches it and the RFC 7591 ones",()=>{
 assert.doesNotMatch(META_ERR,MAIN_RE);
 for(const e of [META_ERR,'invalid_client_metadata: registration_not_supported','Server metadata has no registration endpoint','dynamic client registration is not allowed','client_id is required'])assert.match(e,NEEDS_OWN_APP,e);
 for(const e of ['timeout after 30s','invalid_scope','401 Unauthorized'])assert.doesNotMatch(e,NEEDS_OWN_APP,e)});
test('a Meta-style error gives the own-app step with the redirect URL, not the raw error or a menu',async()=>{
 const r=await call('meta-ads',META_ERR,'https://mcp.facebook.com/ads');assert.ok(r.isError);
 assert.doesNotMatch(r.text,/Could not start the sign-in/);
 assert.ok(r.text.includes(BASE+'/api/mcp/oauth/callback/meta-ads'),'the exact redirect URL');
 assert.match(r.text,/https:\/\/developers\.facebook\.com\/apps/);assert.match(r.text,/Create & manage ads with ads MCP server/);
 assert.match(r.text,/Valid OAuth Redirect URIs/);assert.match(r.text,/Click Save changes/);assert.match(r.text,/App ID and App Secret/);
 assert.match(r.text,/Abilities › MCP tools › meta-ads › Sign in/);assert.match(r.text,/ask_owner/);assert.match(r.text,/Do not ask them which way/)});
test('Meta is found by the tool name or by its address',()=>{
 assert.equal(appSettings('meta-ads','')[0],'Meta');assert.equal(appSettings('ads','https://mcp.facebook.com/ads')[0],'Meta');
 assert.equal(appSettings('notion','')[0],'Notion');assert.equal(appSettings('acme','')[0],'Acme')});
test('another service with no Meta details still gets the one step, in its generic words',async()=>{
 const r=await call('acme','registration_not_supported');assert.ok(r.isError);assert.match(r.text,/Abilities › MCP tools › acme › Sign in/);assert.match(r.text,/Client ID and Client Secret/);
 const raw=await call('acme','timeout after 30s');assert.match(raw.text,/^Could not start the sign-in: timeout/)});
test('the app page opens the Client ID drawer on the same errors',()=>{
 const ui=readFileSync(new URL('../app/people.js',import.meta.url),'utf8');
 assert.ok(ui.includes('const NEEDS_OWN_APP='+NEEDS_OWN_APP.toString()+';'),'people.js keeps the same test');
 assert.match(ui,/if\(NEEDS_OWN_APP\.test\(err\)\)return mcpClientDrawer\(/)});
