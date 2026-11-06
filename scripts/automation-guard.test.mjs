// Tests for the automations guard's decisions (app/automation-guard.mjs). Run: node --test scripts/automation-guard.test.mjs
// The log lines are the engine's own, copied from the box on 25 Oct 2026 (the Pixel tool server that stayed parked).
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLogLine,splitFailed,serverOfTool,apply,nextStep,mayTry,shouldTell,scriptInterpreters,requirementsFromDistInfo,newestTool,responseOf,toolFailed,foldCopies} from '../app/automation-guard.mjs';

import {homedir as __hd} from 'node:os';const H=__hd();
const L={
 parked:"2026-10-25 07:20:29,528 WARNING tools.mcp_tool: MCP server 'pixel' failed initial connection after 3 attempts, parking until a reconnect is requested (state: connecting → parked): MCPError: Connection closed",
 failed:`2026-10-25 07:20:58,168 WARNING tools.mcp_tool: Failed to connect to MCP server 'pixel' (command=${H}/.hermes/pixel-tools/run.sh): Connection closed`,
 summary:"2026-10-25 07:20:58,169 INFO tools.mcp_tool: MCP: registered 119 tool(s) from 3 server(s) (1 failed: pixel (Connection closed))",
 summary2:"2026-10-25 03:42:52,857 INFO tools.mcp_tool: MCP: registered 372 tool(s) from 9 server(s) (2 failed: AdsPower ([Errno 13] Permission denied: '/x/adspower-mcp.sh'); composio (MCP OAuth for 'composio': non-interactive environment and no cached tokens found. Run `hermes mcp login composio` interactively first.))",
 unknown:"2026-10-25 07:50:51,452 WARNING [local-d5728b] agent.tool_executor: Tool tool_call returned error (0.07s): {\"error\": \"'pixel_now' is not a known tool name. Deferred tools must be invoked through tool_call by the exact name tool_search returns (e.g. mcp__<server>__{tool}).",
 removed:"2026-10-25 15:01:18,757 INFO gateway.run_profile_reconcile: MCP servers reconciled with config (pixel-agent): removed=['pixel'] added=[]",
 registered:"2026-10-25 15:02:20,921 INFO tools.mcp_tool: MCP server 'pixel' (stdio): registered 28 tool(s): mcp__pixel__pixel_sender_status, mcp__pixel__pixel_now",
 added:"2026-10-25 15:02:20,934 INFO gateway.run_profile_reconcile: MCP servers reconciled with config (pixel-agent): removed=[] added=['pixel']",
 auth:"2026-10-24 09:18:50,237 WARNING tools.mcp_tool: MCP server 'composio' failed initial authentication, parking until credentials change; re-authenticate with `hermes mcp login composio` (state: connecting → parked): OAuthNonInteractiveError: no cached tokens",
 oauth:"2026-10-25 14:46:01,336 WARNING tools.mcp_tool: MCP OAuth setup failed for 'composio': MCP OAuth for 'composio': non-interactive environment and no cached tokens found.",
 probing:"2026-10-24 22:46:15,307 WARNING tools.mcp_tool: MCP server 'slack-pixel' failed after 5 reconnection attempts, parking; will self-probe every 300s until it recovers (state: degraded → parked): RemoteProtocolError: x",
 revived:"2026-10-24 23:12:27,244 WARNING tools.mcp_tool: MCP server 'slack-pixel': revived — session healthy again after parking (state: parked → connected)"};

test('log: a parked server, with the UTC time',()=>{const [e]=parseLogLine(L.parked);assert.equal(e.kind,'parked');assert.equal(e.server,'pixel');assert.equal(e.reason,'MCPError: Connection closed');assert.equal(e.t,Date.parse('2026-10-25T07:20:29.528Z'))});
test('log: failed to connect, and the summary line names the failed ones',()=>{
 assert.deepEqual(parseLogLine(L.failed).map(e=>[e.kind,e.server,e.reason]),[['failed','pixel','Connection closed']]);
 assert.deepEqual(parseLogLine(L.summary).map(e=>[e.kind,e.server]),[['failed','pixel']]);
 assert.deepEqual(parseLogLine(L.summary2).map(e=>[e.kind,e.server]),[['failed','AdsPower'],['signin','composio']]);
 assert.deepEqual(splitFailed("a (x (y)); b (z)").map(x=>x.server),['a','b']);
 // an agent copy skips a server another copy already connects: not a failure (seen on the box, 25 Oct)
 assert.deepEqual(parseLogLine("2026-10-25 07:20:05,598 INFO tools.mcp_tool:   MCP: 372 tool(s) from 9 server(s) (1 failed: AdsPower (not attempted (in retry cooldown)))"),[])});
test('log: sign-ins, self-probing, revived, registered, reconciled, unknown tools',()=>{
 assert.equal(parseLogLine(L.auth)[0].kind,'signin');assert.equal(parseLogLine(L.oauth)[0].kind,'signin');assert.equal(parseLogLine(L.oauth)[0].server,'composio');
 assert.equal(parseLogLine(L.probing)[0].kind,'probing');assert.equal(parseLogLine(L.revived)[0].kind,'ok');assert.equal(parseLogLine(L.registered)[0].kind,'ok');
 const r=parseLogLine(L.removed)[0];assert.equal(r.kind,'reconciled');assert.equal(r.label,'pixel-agent');assert.deepEqual(r.removed,['pixel']);assert.deepEqual(r.added,[]);
 assert.deepEqual(parseLogLine(L.added)[0].added,['pixel']);
 assert.equal(parseLogLine(L.unknown)[0].tool,'pixel_now');
 assert.deepEqual(parseLogLine('a line without a time'),[]);assert.deepEqual(parseLogLine('2026-10-25 07:00:00,000 INFO x: nothing to see'),[])});
test('log: which server a tool belongs to',()=>{const by={pixel:['pixel_now','pixel_state_get'],n8n:['search_workflows']};
 assert.equal(serverOfTool('pixel_now',by),'pixel');assert.equal(serverOfTool('mcp__pixel__pixel_now',by),'pixel');assert.equal(serverOfTool('mcp__n8n__anything',by),'n8n');assert.equal(serverOfTool('web_search',by),null)});
test('state: the 25 Oct story, in order',()=>{const r={state:'ok'};
 for(const l of [L.parked,L.failed,L.summary])for(const e of parseLogLine(l))apply(r,e);assert.equal(r.state,'parked');assert.equal(r.since,Date.parse('2026-10-25T07:20:29.528Z'));
 for(const e of parseLogLine(L.unknown))apply(r,e);assert.equal(r.state,'parked');
 for(const e of parseLogLine(L.registered))apply(r,e);assert.equal(r.state,'ok');assert.equal(r.conn,'up');
 // once it works, a misspelt tool name is the model's mistake, not a broken server
 for(const e of parseLogLine(L.unknown))apply(r,e);assert.equal(r.state,'ok')});
test('state: an unknown tool with no sign the server is up counts',()=>{const r={state:'ok'};for(const e of parseLogLine(L.unknown))apply(r,e);assert.equal(r.state,'missing');assert.match(r.reason,/pixel_now/)});
test('next step: parked fixes now, failing waits 10 min (programs) or 30 min, sign-ins are only told',()=>{const t=Date.parse('2026-10-25T08:00:00Z');
 assert.equal(nextStep({state:'parked',since:t},t),'repair');assert.equal(nextStep({state:'missing',since:t},t),'repair');assert.equal(nextStep({state:'broken',since:t},t),'repair');
 assert.equal(nextStep({state:'failing',since:t-5*60e3},t,{stdio:true}),'none');assert.equal(nextStep({state:'failing',since:t-11*60e3},t,{stdio:true}),'repair');assert.equal(nextStep({state:'failing',since:t-11*60e3},t),'none');
 assert.equal(nextStep({state:'probing',since:t-31*60e3},t),'repair');assert.equal(nextStep({state:'signin',since:t},t),'signin');assert.equal(nextStep({state:'ok'},t),'none')});
test('backoff: at most once per server per 30 min',()=>{const t=1e12;
 assert.ok(mayTry({},t));assert.ok(!mayTry({lastTry:t-29*60e3},t));assert.ok(mayTry({lastTry:t-30*60e3},t));
 assert.equal(nextStep({state:'parked',since:t,lastTry:t-10*60e3},t),'wait');assert.equal(nextStep({state:'parked',since:t,lastTry:t-31*60e3},t),'repair')});
test('alerts: the same thing is told once per 6 hours, sign-ins once',()=>{const t=1e12,told={};
 assert.ok(shouldTell(told,'k',t));told.k=t;assert.ok(!shouldTell(told,'k',t+3600e3));assert.ok(shouldTell(told,'k',t+6*3600e3));
 told.s=t;assert.ok(!shouldTell(told,'s',t+400*864e5,Infinity));assert.ok(shouldTell(told,'other',t,Infinity))});
test('run.sh: the Python it execs',()=>{
 const pixel=`#!/usr/bin/env bash\n# Launches the locked Pixel tool server.\nunset PYTHONPATH VIRTUAL_ENV\nexec ${H}/.hermes/pixel-tools/venv/bin/python ${H}/.hermes/pixel-tools/pixel_mcp.py\n`;
 assert.deepEqual(scriptInterpreters(pixel),[`${H}/.hermes/pixel-tools/venv/bin/python`]);
 assert.deepEqual(scriptInterpreters('#!/opt/tool/venv/bin/python3\nimport sys\n'),['/opt/tool/venv/bin/python3']);
 assert.deepEqual(scriptInterpreters('#!/bin/bash\ncd /x && FOO=1 exec /srv/app/bin/node server.js\n'),['/bin/bash','/srv/app/bin/node']);
 assert.deepEqual(scriptInterpreters('#!/bin/bash\n# exec /old/venv/bin/python (commented out)\nexec npx -y local-api-mcp\n'),['/bin/bash'])});
test('packages: dist-info names to exact pins',()=>{
 assert.deepEqual(requirementsFromDistInfo(['mcp-1.26.0.dist-info','python_dotenv-1.2.1.dist-info','PyYAML-6.0.3.dist-info','httpx-0.28.1.dist-info','not-a-dist','typing_extensions-4.15.0.dist-info']),
  ['httpx==0.28.1','mcp==1.26.0','python-dotenv==1.2.1','pyyaml==6.0.3','typing-extensions==4.15.0'])});
test('tools: the newest managed Python and uv',()=>{
 assert.equal(newestTool(['python-3.14.7+20260901-linux-x64','python-3.14.9+20261021-linux-x64','uv-0.13.5-linux-x64','node-26.12.1-linux-x64'],'python'),'python-3.14.9+20261021-linux-x64');
 assert.equal(newestTool(['python-3.14.9+20261021-linux-x64','python-3.14.10+20261101-linux-x64'],'python'),'python-3.14.10+20261101-linux-x64');
 assert.equal(newestTool(['uv-0.9.1-linux-x64','uv-0.13.5-linux-x64'],'uv'),'uv-0.13.5-linux-x64');assert.equal(newestTool([],'uv'),null)});
test('schedule replies: tools that were not there, in Indonesian and English',()=>{
 const md='# Cron Job: RAD live hourly check\n## Prompt\nIf a tool is not available, say so.\n## Response\n\n<@U0A3> Monitor RAD live gagal jalan di run ini. Tool pixel (pixel_now, pixel_state_get) tidak tersedia, jadi aku tidak bisa membaca jam WIB.';
 assert.match(responseOf(md),/^<@U0A3>/);assert.ok(toolFailed(responseOf(md)));
 assert.ok(toolFailed("I couldn't run: 'pixel_now' is not a known tool name."));assert.ok(toolFailed('The n8n tool is not available right now.'));assert.ok(toolFailed('Failed to connect to the Slack server.'));
 assert.equal(toolFailed('Semua aman. 3 tiket baru sudah dibalas.'),null);assert.equal(toolFailed('Slot rapat Jumat tidak tersedia, jadi aku pilih Kamis.'),null);
 assert.equal(toolFailed(responseOf('## Prompt\nsay "tidak tersedia" if a tool is missing\n')),null)});
test('Health: an extra number folds into its agent; only a server that differs shows, as the extra number',()=>{
 const sv=(name,state)=>({name,state});
 const out=foldCopies([{agent:'default',name:'Donna AI',servers:[sv('notion','signin'),sv('n8n','ok')],jobs:[]},
  {agent:'default--whatsapp-2',name:'x',servers:[sv('notion','signin'),sv('n8n','broken')],jobs:[{id:'j1',name:'Daily'}]},
  {agent:'sesa--telegram-2',name:'y',servers:[sv('gmail','ok')],jobs:[]}],a=>a==='sesa'?'Sesa':a);
 assert.deepEqual(out.map(a=>a.agent),['default','sesa']);
 assert.deepEqual(out[0].servers.map(s=>[s.label||s.name,s.state,s.agent||'']),[['notion','signin',''],['n8n','ok',''],['n8n (extra number)','broken','default--whatsapp-2']]);
 assert.deepEqual(out[0].jobs.map(j=>[j.id,j.agent]),[['j1','default--whatsapp-2']]);
 assert.equal(out[1].name,'Sesa')});
