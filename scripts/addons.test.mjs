// Personal add-ons and the MCP address check (app/addons.mjs, 11 Nov 2026). On P&P an employee's Google Sheet link was
// saved as an app with no tools; his agent said its power was limited to his role. No network: fetch is faked.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const HOME=await mkdtemp(path.join(tmpdir(),'addons-'));process.env.HOME=HOME;
const {notMcpReason,probeMcp,addonDecision,blockMatch,createAddons,RUNS_CODE_MSG}=await import('../app/addons.mjs');
const {createUsers}=await import('../app/users.mjs');

// a fake network: url -> (init) => Response
const net=routes=>async(url,init={})=>{const k=Object.keys(routes).find(r=>String(url).startsWith(r));if(!k)throw Object.assign(new Error('fetch failed'),{cause:{code:'ENOTFOUND'}});return routes[k](init)};
const res=(status,body,headers={})=>new Response(body,{status,headers});

test('links that are never MCP tools are refused with what to do instead',()=>{
 assert.match(notMcpReason('https://docs.google.com/spreadsheets/d/1tVX/edit#gid=1'),/Connect a Google account/);
 assert.match(notMcpReason('https://mail.google.com/mail/u/0/'),/Google/);
 assert.match(notMcpReason('https://acme.slack.com/archives/C1'),/Connect Slack/);
 assert.equal(notMcpReason('https://mcp.slack.com/mcp'),null,'Slack\'s own MCP address is fine');
 assert.match(notMcpReason('https://acme.sharepoint.com/x'),/Microsoft 365/);
 assert.match(notMcpReason('https://github.com/acme/plugin'),/Plugins/);
 assert.match(notMcpReason('ftp://x.example'),/https/);
 assert.equal(notMcpReason('https://mcp.notion.com/mcp'),null)});

test('probe: a JSON-RPC answer, an SSE answer, or a sign-in answer is an MCP tool',async()=>{
 const rpc=JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-06-18'}});
 assert.deepEqual(await probeMcp('https://a.example/mcp',{fetch:net({'https://a.example/mcp':()=>res(200,rpc,{'content-type':'application/json'})})}),{ok:true,auth:'none'});
 assert.deepEqual(await probeMcp('https://b.example/mcp',{fetch:net({'https://b.example/mcp':()=>res(200,'event: message\ndata: '+rpc+'\n\n',{'content-type':'text/event-stream'})})}),{ok:true,auth:'none'});
 assert.deepEqual(await probeMcp('https://c.example/mcp',{fetch:net({'https://c.example/mcp':()=>res(401,'',{'www-authenticate':'Bearer resource_metadata="https://c.example/.well-known/oauth-protected-resource"'})})}),{ok:true,auth:'oauth'});
 // only the protected-resource document says it wants a sign-in
 assert.deepEqual(await probeMcp('https://d.example/mcp',{fetch:net({'https://d.example/.well-known/oauth-protected-resource':()=>res(200,JSON.stringify({resource:'https://d.example/mcp',authorization_servers:['https://auth.d.example']}),{'content-type':'application/json'}),'https://d.example/mcp':()=>res(404,'nope')})}),{ok:true,auth:'oauth'});
 // the old SSE transport: POST is refused, GET opens an event stream
 assert.deepEqual(await probeMcp('https://e.example/sse',{fetch:net({'https://e.example/.well-known':()=>res(404,''),'https://e.example/sse':i=>i.method==='POST'?res(405,''):res(200,'event: endpoint\ndata: /messages\n\n',{'content-type':'text/event-stream'})})}),{ok:true,auth:'none'})});

test('probe: an ordinary web page, a Google file and an unreachable host are refused before saving',async()=>{
 const page=await probeMcp('https://shop.example/',{fetch:net({'https://shop.example/':()=>res(200,'<html>hi</html>',{'content-type':'text/html'})})});
 assert.equal(page.ok,false);assert.match(page.why,/did not answer like an MCP tool/);
 let asked=false;const g=await probeMcp('https://docs.google.com/spreadsheets/d/x',{fetch:async()=>{asked=true;throw new Error('no')}});
 assert.equal(g.ok,false);assert.match(g.why,/Google account/);assert.equal(asked,false,'a Google link is refused without asking the network');
 const gone=await probeMcp('https://nowhere.example/mcp',{fetch:net({})});assert.equal(gone.ok,false);assert.match(gone.why,/Could not reach/);
 // a JSON answer that is not JSON-RPC (an ordinary API) is not an MCP tool
 const api=await probeMcp('https://api.example/v1',{fetch:net({'https://api.example/':()=>res(404,''),'https://api.example/v1':()=>res(200,'{"hello":1}',{'content-type':'application/json'})})});assert.equal(api.ok,false)});

test('the permission decision: your own agent always; shared ones need edit and the role; code needs "unsafe"',()=>{
 // an employee with the plain Member role (no rights) on the agent they own: apps, skills and plugins all fine
 for(const kind of ['mcp','skill','plugin'])assert.equal(addonDecision({level:'owner',caps:[],kind}),null,kind);
 // ...but a command server or a plugin from any GitHub repo runs code on the box
 assert.equal(addonDecision({level:'owner',caps:[],kind:'mcp',runsCode:true}),RUNS_CODE_MSG);
 assert.equal(addonDecision({level:'owner',caps:['unsafe'],kind:'plugin',runsCode:true}),null);
 // an agent shared with "Can edit": as today, the role's right decides; plugins stay with its owner
 assert.match(addonDecision({level:'edit',caps:[],kind:'mcp'}),/Your role does not include adding apps/);
 assert.equal(addonDecision({level:'edit',caps:['mcp'],kind:'mcp'}),null);
 assert.equal(addonDecision({level:'edit',caps:['skills'],kind:'skill'}),null);
 assert.match(addonDecision({level:'edit',caps:['mcp','skills'],kind:'plugin'}),/owner or an admin/);
 assert.match(addonDecision({level:'chat',caps:['mcp'],kind:'mcp'}),/chat with this agent/);
 assert.match(addonDecision({level:null,kind:'mcp'}),/not shared/);
 // admins: everything
 assert.equal(addonDecision({admin:true,level:null,kind:'plugin',runsCode:true}),null)});

test('users: a Member owns their lead and may extend it; a shared company agent still needs edit rights',async()=>{
 const users=createUsers(path.join(HOME,'data'),{deliver:async()=>{}},{ownerCheck:pw=>pw==='owner-pass-1'});await users.load();
 const owner=await users.user('owner');let inv;
 await users.api(owner,{method:'POST',url:'/ui/people/invite'},{},'/ui/people/invite',(r,s,b)=>{inv=b},async()=>JSON.stringify({name:'Fakhri',role:'member',roleId:'member'}));
 const fak=await users.accept(inv.code,'Fakhri','fakhri-pass-1');await users.created(fak,'fakhri-agent');
 await users.created(owner,'company-bot');
 assert.equal(users.addonCheck(fak,'fakhri-agent','mcp'),null);
 assert.equal(users.addonCheck(fak,'fakhri-agent','plugin'),null);
 assert.equal(users.addonCheck(fak,'fakhri-agent','mcp',true),RUNS_CODE_MSG);
 assert.match(users.addonCheck(fak,'company-bot','mcp'),/not shared/);
 assert.equal(users.addonCheck(owner,'company-bot','plugin'),null);
 // the gate lets the plain Member add apps and skills to his own agent, and reach the plugin list and install
 const Q=new URLSearchParams('profile=fakhri-agent');
 assert.equal(users.gate(fak,'/hapi/mcp/servers','POST',Q,'fakhri-agent'),null);
 assert.equal(users.gate(fak,'/hapi/skills','POST',Q,'fakhri-agent'),null);
 assert.equal(users.gate(fak,'/hapi/dashboard/plugins/catalog','GET',Q,'fakhri-agent'),null);
 assert.equal(users.gate(fak,'/hapi/dashboard/agent-plugins/install','POST',Q,'fakhri-agent'),null);
 assert.equal(users.gate(fak,'/ui/plugins/toggle','POST',new URLSearchParams(),null),null);
 // never on the company agent
 assert.equal(users.gate(fak,'/hapi/mcp/servers','POST',new URLSearchParams('profile=company-bot'),'company-bot')?.status,403)});

test('block list: a host covers its subdomains, a name covers that app; who added what is kept, newest first',async()=>{
 assert.equal(blockMatch('example.com',{url:'https://mcp.example.com/mcp'}),true);
 assert.equal(blockMatch('example.com',{url:'https://badexample.com/mcp'}),false);
 assert.equal(blockMatch('notion',{name:'Notion'}),true);
 assert.equal(blockMatch('notion',{name:'notion-2',url:'https://mcp.notion.com/mcp'}),false);
 const a=createAddons({DATA:path.join(HOME,'addons')});
 assert.equal(await a.refusal({name:'x',url:'https://mcp.example.com/mcp'}),null);
 await a.block('https://Example.com/path',{note:'not approved',by:{id:'owner',name:'Owner'}});
 assert.match(await a.refusal({name:'x',url:'https://mcp.example.com/mcp'}),/blocked example\.com.*not approved/);
 await assert.rejects(a.block('two words'),/app name/);
 await a.unblock('example.com');assert.equal(await a.refusal({url:'https://mcp.example.com/mcp'}),null);
 await a.note({kind:'mcp',agent:'fakhri-agent',name:'airtable',url:'https://mcp.airtable.com/mcp?api_key=SECRET',by:{id:'u1',name:'Fakhri'},via:'agent'});
 await a.note({kind:'skill',agent:'fakhri-agent',name:'invoices',by:{id:'u1',name:'Fakhri'}});
 await a.note({kind:'mcp',agent:'fakhri-agent',name:'airtable',url:'https://mcp.airtable.com/mcp',by:{id:'u1',name:'Fakhri'}});
 const l=(await a.list()).added;assert.deepEqual(l.map(x=>x.name),['airtable','invoices'],'adding again moves it up, once');
 assert.equal(l[0].by.name,'Fakhri');
 const again=createAddons({DATA:path.join(HOME,'addons')});assert.equal((await again.list()).added.length,2,'kept on disk')});

test('a key in an address is never kept in the list',async()=>{
 const a=createAddons({DATA:path.join(HOME,'addons-k')});
 await a.note({kind:'mcp',agent:'x',name:'svc',url:'https://svc.example/mcp?token=abc123&x=1',by:{}});
 assert.equal((await a.list()).added[0].url,'https://svc.example/mcp?token=(hidden)&x=1')});

test('the setup guide every agent gets: steps per kind of link, test before done, no middleman',async()=>{
 const {setupGuideLines}=await import('../app/setup-guide.mjs');
 const on=setupGuideLines({publicUrl:'https://ai.example.com/',google:true}).join('\n'),off=setupGuideLines({google:false}).join('\n');
 assert.match(on,/connect_mcp_tool with url/);assert.match(on,/check true/);assert.match(on,/never add it with connect_mcp_tool/);
 assert.ok(on.includes('https://ai.example.com/#/abilities/connections › Add › A Google account'));
 assert.match(on,/Slack/);assert.match(on,/Microsoft 365/);assert.match(on,/ask_secret/);assert.match(on,/manage_agent/);assert.match(on,/Plugins/);
 assert.match(on,/report_bottleneck/);assert.match(on,/at most 2 clicks/);assert.match(on,/Never answer that your power or their role limits this/);
 assert.doesNotMatch(on+off,/composio/i,'Composio is gone from the code: the guide never names it');
 assert.match(off,/not set up on this aqeelOS yet/)});
