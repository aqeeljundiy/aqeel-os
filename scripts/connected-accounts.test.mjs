// Tests for Connected accounts (app/connected-accounts.mjs). Run: node --test scripts/connected-accounts.test.mjs
// The log lines and gapi.py commands are the engine's and the agents' own, copied from the box on 31 Oct 2026. The last
// test runs the whole thing on a fake engine home: registering, Pause and Resume of an app (through a stub dashboard)
// and of a Google sign-in, and a new login nobody registered.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {classify,parseToolLine,serverOfTool,parseGapi,actionOf,sentence,summarise,withCan,pausedEntry,blockedTools,matches,normCan,patchGapiText,providerOf,createConnectedAccounts} from '../app/connected-accounts.mjs';

import {homedir as __hd} from 'node:os';const H=__hd();
const L={
 draft:'2026-10-31 07:02:51,040 INFO [local-f6e8a888c4] agent.tool_executor: tool mcp__slack_pixel__slack_send_message_draft completed (1.81s, 68 chars)',
 search:'2026-10-31 10:01:12,321 INFO [local-d14c88e2bd] agent.tool_executor: tool mcp__notion_aqeel__notion_query_data_sources completed (2.68s, 12781 chars)',
 err:'2026-10-30 09:12:01,100 WARNING [local-aa11bb22cc] agent.tool_executor: Tool mcp__notion__notion_update_page returned error (0.40s): {"error": "{\\"name\\":\\"APIResponseError\\"}"}',
 own:'2026-10-31 09:00:29,626 INFO [local-28e1f3964d] agent.tool_executor: tool mcp__pixel__pixel_now completed (0.04s, 129 chars)',
 term:'2026-10-31 10:54:31,917 INFO [local-97c008f876] agent.tool_executor: tool terminal completed (0.47s, 4583 chars)'};

test('classify: as the owner, a bot, or a service',()=>{
 assert.deepEqual(classify({type:'file',file:'/h/.hermes/google_token_pixel.json'}),{as:'me',kind:'google'});
 assert.deepEqual(classify({type:'file',file:'/h/.hermes/google_token.json.paused'}),{as:'me',kind:'google'});
 assert.deepEqual(classify({type:'file',file:'/h/workspaces/x/me.session'}),{as:'me',kind:'telegram-user'});
 assert.equal(classify({type:'file',file:'/h/.hermes/google_client_secret.json'}).as,null);
 // a Slack, Notion sign-in of a person
 assert.deepEqual(classify({type:'mcp',name:'slack-pixel',entry:{url:'https://mcp.slack.com/mcp',auth:'oauth'},token:{access_token:'xoxp-1-2',hermes_issuer:'https://mcp.slack.com'}}),{as:'me',kind:'mcp-oauth'});
 assert.equal(classify({type:'mcp',name:'notion-aqeel',entry:{url:'https://mcp.notion.com/mcp',auth:'oauth'},token:{access_token:'a',refresh_token:'b'}}).as,'me');
 // services the agents work through, and tools of aqeelOS's own
 assert.equal(classify({type:'mcp',name:'composio',entry:{url:'https://connect.composio.dev/mcp',auth:'oauth'},token:{access_token:'x'}}).as,'service');
 assert.equal(classify({type:'mcp',name:'n8n',entry:{url:'https://n8n.elkiya.com/mcp-server/http',auth:'oauth'},token:{access_token:'x'},meta:{issuer:'https://n8n.elkiya.com'}}).as,'service');
 assert.equal(classify({type:'mcp',name:'pixel',entry:{command:`${H}/.hermes/pixel-tools/run.sh`}}).as,'service');
 assert.equal(classify({type:'mcp',name:'aqeelos-notify',entry:{url:'http://127.0.0.1:4400/mcp/notify/default/x'}}).as,'service');
 // a bot token behind an app, and a sign-in nobody made yet
 assert.equal(classify({type:'mcp',name:'slack-bot',entry:{url:'https://x.example/mcp'},token:{access_token:'xoxb-1'}}).as,'bot');
 assert.equal(classify({type:'mcp',name:'linear',entry:{url:'https://mcp.linear.app/sse',auth:'oauth'},token:null}).as,null);
 // keys
 assert.equal(classify({type:'key',name:'SLACK_BOT_TOKEN',value:'xoxb-1'}).as,'bot');
 assert.equal(classify({type:'key',name:'TELEGRAM_BOT_TOKEN',value:'1:2'}).as,'bot');
 assert.equal(classify({type:'key',name:'SLACK_USER_TOKEN',value:'xoxp-9'}).as,'me');
 assert.equal(classify({type:'key',name:'OPENAI_API_KEY',value:'sk-1'}).as,'service');
 assert.equal(providerOf('slack-as2','https://mcp.slack.com/mcp').name,'Slack');assert.equal(providerOf('x','https://mcp.acme.io/mcp').logo,'acme.io')});

test('log lines: which app, which tool, worked or not',()=>{
 const d=parseToolLine(L.draft);assert.equal(d.tool,'mcp__slack_pixel__slack_send_message_draft');assert.equal(d.ok,true);assert.equal(d.session,'local-f6e8a888c4');assert.equal(d.t,Date.parse('2026-10-31T07:02:51.040Z'));
 assert.equal(parseToolLine(L.err).ok,false);assert.equal(parseToolLine(L.term),null);assert.equal(parseToolLine('nothing'),null);
 const names=['slack','slack-pixel','slack-as2','notion','notion-aqeel','pixel'];
 assert.deepEqual(serverOfTool(d.tool,names),{server:'slack-pixel',fn:'slack_send_message_draft'});   // the longest name wins (slack vs slack_pixel)
 assert.deepEqual(serverOfTool(parseToolLine(L.search).tool,names),{server:'notion-aqeel',fn:'notion_query_data_sources'});
 assert.equal(serverOfTool('mcp__github__x',names),null)});

test('gapi.py commands: account, service and method',()=>{
 assert.deepEqual(parseGapi(`python3 ~/.hermes/scripts/gapi.py --account pixel call sheets v4 spreadsheets.values.get --params '{"spreadsheetId":"X"}'`),[{account:'pixel',service:'sheets',method:'spreadsheets.values.get'}]);
 assert.deepEqual(parseGapi('gapi.py call gmail v1 users.messages.list --params x && gapi.py --account=elkiya draft --to a@b --subject S --body B'),[{account:'',service:'gmail',method:'users.messages.list'},{account:'elkiya',service:'gmail',method:'users.drafts.create'}]);
 assert.deepEqual(parseGapi('for a in pixel elkiya; do gapi.py --account $a call calendar v3 events.list; done'),[]);   // which account is not known
 assert.deepEqual(parseGapi('gapi.py --help'),[]);
 assert.deepEqual(parseGapi('python3 scripts/google_api.py --account work gmail search "is:unread"'),[{account:'work',service:'gmail',method:'search'}])});

test('actions in plain words',()=>{
 const s=(prov,fn,n,o)=>sentence(actionOf(prov,fn,o),n,prov);
 assert.equal(s('slack','slack_read_channel',4),'Read 4 Slack channels');
 assert.equal(s('slack','slack_send_message_draft',1),'Saved 1 draft');
 assert.equal(s('slack','slack_send_message',2),'Sent 2 Slack messages');
 assert.equal(s('slack','slack_search_public_and_private',3),'Searched Slack 3 times');
 assert.equal(s('notion','notion_update_page',2),'Changed 2 Notion pages');
 assert.equal(s('notion','notion_create_pages',1),'Created 1 Notion page');
 assert.equal(s('notion','notion_query_data_sources',1),'Searched Notion');
 assert.equal(s('gmail','users.drafts.create',1,{verbLast:true}),'Saved 1 draft');
 assert.equal(s('gmail','users.messages.send',1,{verbLast:true}),'Sent 1 email');
 assert.equal(s('gmail','users.drafts.send',1,{verbLast:true}),'Sent 1 draft');
 assert.equal(s('gmail','users.messages.get',3,{verbLast:true}),'Read 3 emails');
 assert.equal(s('gmail','users.messages.list',1,{verbLast:true}),'Searched Gmail');
 assert.equal(s('sheets','spreadsheets.values.get',5,{verbLast:true}),'Read 5 sheets');
 assert.equal(s('sheets','spreadsheets.values.batchUpdate',1,{verbLast:true}),'Changed 1 sheet');
 assert.equal(s('drive','permissions.create',1,{verbLast:true}),'Shared 1 file');
 assert.equal(s('calendar','events.list',1,{verbLast:true}),'Searched Calendar');
 assert.equal(actionOf('slack','slack_send_message').kind,'send');assert.equal(actionOf('slack','slack_send_message_draft').kind,'draft');assert.equal(actionOf('notion','notion_update_page').kind,'write');assert.equal(actionOf('slack','slack_read_thread').kind,'read');
 // a run of the same thing by the same agent within 15 min is one line, newest first; failures are their own
 const t=Date.parse('2026-10-31T07:00:00Z'),ev=[0,1,2,3].map(i=>({t:t+i*60e3,agent:'default',prov:'slack',...actionOf('slack','slack_read_channel'),raw:'slack_read_channel'}));
 ev.push({t:t+5*60e3,agent:'default',prov:'slack',...actionOf('slack','slack_send_message_draft'),raw:'slack_send_message_draft'},{t:t+90*60e3,agent:'default',prov:'slack',...actionOf('slack','slack_read_channel'),ok:false,raw:'slack_read_channel'});
 const sum=summarise(ev);assert.deepEqual(sum.map(x=>x.text),['Read 1 Slack channel (it failed)','Saved 1 draft','Read 4 Slack channels']);assert.equal(sum[2].n,4);assert.equal(sum[2].at,t+3*60e3);
 assert.equal(summarise(Array.from({length:30},(x,i)=>({t:t+i*3600e3,agent:'a'+i,kind:'read',verb:'Read',noun:'page',prov:'notion'}))).length,10)});

test('allowed actions: which tools are left out, and the settings round trip',()=>{
 const tools=['slack_read_channel','slack_send_message','slack_send_message_draft','slack_search_public','slack_add_reaction'];
 assert.deepEqual(blockedTools(tools,['read','draft','send'],'slack'),[]);
 assert.deepEqual(blockedTools(tools,['read','draft'],'slack'),['slack_send_message','slack_add_reaction']);
 assert.deepEqual(blockedTools(tools,['read'],'slack'),['slack_send_message','slack_send_message_draft','slack_add_reaction']);
 const e={url:'https://mcp.slack.com/mcp',auth:'oauth',timeout:120};
 const narrowed=withCan(e,['slack_send_message'],undefined);assert.deepEqual(narrowed.tools,{exclude:['slack_send_message']});assert.deepEqual(withCan(narrowed,[],undefined),e);
 // its own exclude list stays, an include list gets shorter, and both come back exactly
 const e2={...e,tools:{exclude:['slack_canvas']}};const n2=withCan(e2,['slack_send_message'],e2.tools);assert.deepEqual(n2.tools.exclude,['slack_canvas','slack_send_message']);assert.deepEqual(withCan(n2,[],e2.tools),e2);
 const e3={...e,tools:{include:['slack_read_channel','slack_send_message']}};assert.deepEqual(withCan(e3,['slack_send_message'],e3.tools).tools.include,['slack_read_channel']);assert.deepEqual(withCan(withCan(e3,['slack_send_message'],e3.tools),[],e3.tools),e3);
 assert.deepEqual(normCan('Read · Draft'),['read','draft']);assert.deepEqual(normCan(['send','write','x','read']),['read','send'])});

test('pause and resume: the app settings come back exactly',()=>{
 const e={url:'https://mcp.notion.com/mcp',auth:'oauth',enabled:true,tools:{exclude:['x']},headers:{a:'b'}};const p=pausedEntry(e);
 assert.equal(p.enabled,false);assert.deepEqual({...p,enabled:true},e);assert.equal(e.enabled,true);   // the saved one is not changed
 const noFlag={url:'u',auth:'oauth'};assert.deepEqual(Object.keys(pausedEntry(noFlag)).sort(),['auth','enabled','url'])});

test('registration: an agent describes the login it made',()=>{
 const acct={kind:'mcp-oauth',mcp:'slack-pixel',provider:'slack',label:'Slack, Aqeel (Pixel & Profits)',identity:'Aqeel · Pixel & Profits',paths:['/h/.hermes/mcp-tokens/slack-pixel.json']};
 assert.ok(matches({kind:'mcp-oauth',label:'x',where:'~/.hermes/mcp-tokens/slack-pixel.json'},acct,'/h'));
 assert.ok(matches({kind:'mcp-oauth',label:'Slack as Aqeel, Pixel and Profits'},acct,'/h'));
 assert.ok(!matches({kind:'google',label:'Slack Aqeel Pixel'},acct,'/h'));
 assert.ok(!matches({kind:'mcp-oauth',label:'Notion work'},acct,'/h'))});

test('gapi.py: the guard goes in once and only where it fits',()=>{
 const src='import json\nimport os\nimport sys\nfrom pathlib import Path\n\nHOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))\n\n\ndef _creds(account):\n    pass\n\n\ndef main():\n    cmd, rest = "x", []\n    account = None\n    _readonly_guard(account, cmd, rest)\n';
 const a=patchGapiText(src);assert.ok(a.includes('aqeelos:accounts-guard'));assert.equal(patchGapiText(a),a);assert.equal(patchGapiText('print(1)'),null);
 assert.ok(a.indexOf('_aq_guard(account, cmd, rest)')<a.indexOf('_readonly_guard(account, cmd, rest)'))});

// the whole thing on a fake engine home with a stub dashboard (no network, no engine)
test('end to end on a fake engine home',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ca-')),H=path.join(root,'.hermes'),DATA=path.join(root,'data'),W=path.join(root,'workspaces');
 await mkdir(path.join(H,'mcp-tokens'),{recursive:true});await mkdir(path.join(H,'logs'),{recursive:true});await mkdir(path.join(H,'profiles','pixel-agent','logs'),{recursive:true});await mkdir(W,{recursive:true});
 const cfg={default:{mcp_servers:{'slack-pixel':{url:'https://mcp.slack.com/mcp',auth:'oauth'},composio:{url:'https://connect.composio.dev/mcp',auth:'oauth'}}},'pixel-agent':{mcp_servers:{}}};
 await writeFile(path.join(H,'mcp-tokens','slack-pixel.json'),JSON.stringify({access_token:'xoxp-fake',hermes_issuer:'https://mcp.slack.com'}));
 await writeFile(path.join(H,'mcp-tokens','composio.json'),JSON.stringify({access_token:'c',hermes_issuer:'https://connect.composio.dev'}));
 await writeFile(path.join(H,'google_token_pixel.json'),JSON.stringify({token:'t',refresh_token:'r1',account:'aqeel@pixel.test'}));
 await writeFile(path.join(H,'logs','agent.log'),L.draft+'\n'+L.own+'\n');
 const calls=[],bells=[];const log=a=>path.join(a==='default'?H:path.join(H,'profiles',a),'logs','agent.log');
 const dash=async(m,p)=>{calls.push(m+' '+p);const n=decodeURIComponent((/servers\/([^/?]+)/.exec(p)||[])[1]||''),a=new URLSearchParams(p.split('?')[1]).get('profile');
  if(m==='DELETE'){delete cfg[a].mcp_servers[n];await appendFile(log(a),"2026-10-31 11:00:00,000 INFO gateway.run_profile_reconcile: MCP servers reconciled with config ("+a+"): removed=['"+n+"'] added=[]\n")}return {ok:true,status:200,j:{ok:true}}};
 const setKey=async(a,k,v)=>{const n=k.split('.').slice(1).join('.');cfg[a].mcp_servers[n]=structuredClone(v);if(v.enabled!==false)await appendFile(log(a),"2026-10-31 11:00:01,000 INFO gateway.run_profile_reconcile: MCP servers reconciled with config ("+a+"): removed=[] added=['"+n+"']\n");return {ok:true}};
 const ca=createConnectedAccounts({DATA,HERMES_HOME:H,WORK:W,listAgents:async()=>['default','pixel-agent'],readConfig:async a=>structuredClone(cfg[a]),setKey,dash,bell:async(t,d)=>bells.push(t),active:false,STEP:20,ends:{slack:'http://127.0.0.1:9/x'}});
 let l=await ca.list();assert.deepEqual(l.items.map(x=>x.id).sort(),['google:aqeel@pixel.test','mcp:slack-pixel']);assert.ok(l.items.every(x=>x.registered));
 const sl=l.items.find(x=>x.id==='mcp:slack-pixel');assert.deepEqual(sl.recent.map(x=>x.text),['Saved 1 draft']);assert.ok(sl.lastUsed);
 // Pause an app: removed (the engine saw it go), written back switched off, then Resume puts back exactly what it was
 const before=structuredClone(cfg.default.mcp_servers['slack-pixel']);await ca.pause('mcp:slack-pixel',true);
 for(let i=0;i<100&&(await ca._db()).accounts['mcp:slack-pixel'].paused?.state!=='paused';i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(cfg.default.mcp_servers['slack-pixel'].enabled,false);assert.ok(calls.some(c=>c.startsWith('DELETE /api/mcp/servers/slack-pixel?profile=default')));
 assert.equal((await ca.list()).items.find(x=>x.id==='mcp:slack-pixel').state,'paused');
 await ca.pause('mcp:slack-pixel',false);for(let i=0;i<100&&(await ca._db()).accounts['mcp:slack-pixel'].paused;i++)await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(cfg.default.mcp_servers['slack-pixel'],before);
 // Pause a Google sign-in: its file is moved aside, Resume moves it back
 await ca.pause('google:aqeel@pixel.test',true);assert.ok(await stat(path.join(H,'google_token_pixel.json.paused')));assert.equal(await stat(path.join(H,'google_token_pixel.json')).catch(()=>null),null);
 assert.equal((await ca.list()).items.find(x=>x.id==='google:aqeel@pixel.test').state,'paused');
 await ca.pause('google:aqeel@pixel.test',false);assert.ok(await stat(path.join(H,'google_token_pixel.json')));
 // a new login nobody registered: listed as not registered; an agent's register_account then registers it
 await writeFile(path.join(H,'profiles','pixel-agent','google_token_elkiya.json'),JSON.stringify({token:'t',refresh_token:'r2',account:'aqeel@elkiya.test'}));
 l=await ca.list({fresh:true});const g2=l.items.find(x=>x.id==='google:aqeel@elkiya.test');assert.ok(g2&&!g2.registered);assert.equal(l.items[0].id,g2.id);   // not registered comes first
 const r=await ca.register('pixel-agent',{kind:'google',label:'Google, Elkiya',where:'~/.hermes/profiles/pixel-agent/google_token_elkiya.json',can:['read','draft']});assert.ok(!r.isError,r.text);
 const g3=(await ca.list()).items.find(x=>x.id==='google:aqeel@elkiya.test');assert.ok(g3.registered);assert.equal(g3.label,'Google · aqeel@elkiya.test');assert.equal(g3.agentLabel,'Google, Elkiya');assert.deepEqual(g3.can,['read','draft']);
 assert.deepEqual(JSON.parse(await readFile(path.join(H,'aqeelos-accounts.json'),'utf8')).google['aqeel@elkiya.test'].can,['read','draft']);
 // Disconnect: the files are gone, the app off every agent
 await ca.disconnect('google:aqeel@elkiya.test');assert.equal(await stat(path.join(H,'profiles','pixel-agent','google_token_elkiya.json')).catch(()=>null),null);
 await ca.disconnect('mcp:slack-pixel');assert.equal(cfg.default.mcp_servers['slack-pixel'],undefined);assert.equal(await stat(path.join(H,'mcp-tokens','slack-pixel.json')).catch(()=>null),null);
 assert.ok(await stat(path.join(H,'mcp-tokens','composio.json')));   // a service stays
 assert.deepEqual((await ca.list()).items.map(x=>x.id),['google:aqeel@pixel.test'])});

// gapi.py itself with the guard: a paused account and a limited one are refused before Google is asked
test('gapi.py with the guard refuses a paused or limited account',async t=>{
 let py='python3';try{execFileSync(py,['-c','1'])}catch{return t.skip('no python3')}
 const root=await mkdtemp(path.join(tmpdir(),'gapi-'));const src=`#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


def _creds(account):
    raise SystemExit(json.dumps({"error": "would ask Google"}))


def _readonly_guard(account, cmd, rest):
    return


def main():
    argv = sys.argv[1:]
    account = None
    if argv[:1] == ["--account"]:
        account = argv[1]
        argv = argv[2:]
    cmd, rest = argv[0], argv[1:]
    _readonly_guard(account, cmd, rest)
    _creds(account)


if __name__ == "__main__":
    main()
`;const f=path.join(root,'gapi.py');await writeFile(f,patchGapiText(src));
 const go=(...a)=>{try{return execFileSync(py,[f,...a],{env:{...process.env,HERMES_HOME:root},stdio:['ignore','pipe','pipe']}).toString()}catch(e){return String(e.stdout||'')+String(e.stderr||'')}};
 await writeFile(path.join(root,'google_token_pixel.json.paused'),'{}');assert.match(go('--account','pixel','whoami'),/paused in aqeelOS/);
 await writeFile(path.join(root,'google_token.json'),JSON.stringify({account:'a@b.test'}));await writeFile(path.join(root,'aqeelos-accounts.json'),JSON.stringify({google:{'a@b.test':{can:['read']}}}));
 assert.match(go('draft','--to','x'),/may not|does not let/);assert.match(go('call','gmail','v1','users.messages.send'),/send or change/);assert.match(go('call','gmail','v1','users.messages.list'),/would ask Google/)});
