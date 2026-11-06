// Tests for Abilities › Connections (app/connections.mjs, 1 Nov 2026). Run: node --test scripts/connections.test.mjs
// The names, tools and logins are the box's own (31 Oct and 1 Nov 2026). The last tests run a level change end to end:
// an app's tools on one agent through a stub dashboard, and gapi.py refusing a Google call for one agent only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {displayName,patchGapiText,blockedTools,createConnectedAccounts} from '../app/connected-accounts.mjs';
import {appName,toolLevel,toolCounts,levelOf,canOf,buildRows,mayChange,createConnections} from '../app/connections.mjs';

const names=a=>({default:'aqeelOS','pixel-agent':'PixelAgent','continue-threads':'Threads',sesa:'Sesa'})[a]||a;

test('names: the service and who it is, never an agent label',()=>{
 // the main Google login was called "Google, Aqeel main (Continue Threads agent)" by an agent
 assert.equal(displayName({kind:'google',identity:'owner@example.com',label:'Google, Aqeel main (Continue Threads agent)',agentLabel:'Google, Aqeel main (Continue Threads agent)'}),'Google · owner@example.com');
 assert.equal(displayName({kind:'mcp-oauth',mcp:'slack-pixel',url:'https://mcp.slack.com/mcp',who:{user:'Aqeel Jundiy',workspace:'Pixel & Profits'}}),'Slack · Pixel & Profits');
 assert.equal(displayName({kind:'mcp-oauth',mcp:'notion-aqeel',url:'https://mcp.notion.com/mcp',identity:'Aqilla Abdurrahman Jundiy · Aqeel For Work'}),'Notion · Aqeel For Work');
 assert.equal(displayName({kind:'mcp-oauth',mcp:'linear',url:'https://mcp.linear.app/mcp'}),'Linear · linear');
 assert.equal(displayName({kind:'telegram-user',paths:['/w/tg/aqeel.session']}),'Telegram · aqeel');
 assert.equal(appName('composio','https://connect.composio.dev/mcp'),'Composio');
 assert.equal(appName('n8n','https://n8n.elkiya.com/mcp-server/http'),'n8n');
 assert.equal(appName('slack-bot','https://mcp.slack.com/mcp'),'Slack · slack-bot');
 assert.equal(appName('pixel',''),'Pixel');assert.equal(appName('n8n-default','https://n8n.elkiya.com/mcp-server/http'),'n8n default');assert.equal(appName('sesi-schedule',''),'Sesi schedule');
 assert.equal(appName('github','https://api.githubcopilot.com/mcp/'),'GitHub')});

test('levels: which tools each level lets an agent use',()=>{
 const slack=['slack_read_channel','slack_search_public','slack_list_user_channels','slack_send_message','slack_send_message_draft','slack_schedule_message','slack_add_reaction','slack_create_canvas','slack_read_user_profile'];
 assert.deepEqual(slack.map(t=>toolLevel('slack',t)),['read','read','read','full','draft','full','full','full','read']);
 assert.deepEqual(toolCounts(slack,'slack'),{read:4,draft:5,full:9,total:9});
 // a comment is a draft: it stays on the page, nothing goes out
 assert.equal(toolLevel('notion','notion_create_comment'),'draft');assert.equal(toolLevel('notion','notion_get_comments'),'read');assert.equal(toolLevel('notion','notion_update_page'),'full');
 // what is enforced is what is shown: the tools left out at Read are the ones not counted for Read
 assert.deepEqual(blockedTools(slack,canOf('read'),'slack').sort(),slack.filter(t=>toolLevel('slack',t)!=='read').sort());
 assert.deepEqual(blockedTools(slack,canOf('draft'),'slack').sort(),slack.filter(t=>toolLevel('slack',t)==='full').sort());
 assert.deepEqual(blockedTools(slack,canOf('full'),'slack'),[]);
 assert.deepEqual(['COMPOSIO_SEARCH_TOOLS','COMPOSIO_EXECUTE','COMPOSIO_MANAGE_CONNECTIONS'].map(t=>toolLevel('composio',t)),['read','full','full']);
 assert.equal(levelOf(['read']),'read');assert.equal(levelOf(['read','draft']),'draft');assert.equal(levelOf(['read','draft','send']),'full');assert.equal(levelOf(undefined),'full')});

// the sources as the box has them: one login shared by three agents, an app, a plugin, a key, skills, AdsPower
const SRC=()=>({names,levels:{'mcp|composio':{'pixel-agent':'read'}},
 acc:{mcp:{items:[{kind:'mcp',id:'slack-pixel',label:'slack-pixel',detail:'https://mcp.slack.com/mcp',owner:'default',users:[{id:'default',name:'aqeelOS',signed:true}],ownerSigned:true,oauth:true},
   {kind:'mcp',id:'composio',label:'composio',detail:'https://connect.composio.dev/mcp',owner:'default',users:[{id:'default',name:'aqeelOS',signed:true},{id:'pixel-agent',name:'PixelAgent',signed:false}],ownerSigned:true,oauth:true},
   {kind:'mcp',id:'n8n',label:'n8n',detail:'https://n8n.elkiya.com/mcp-server/http',owner:'default',own:true,ownerName:'aqeelOS',ownNote:'every agent has its own n8n user',users:[{id:'pixel-agent',name:'PixelAgent',signed:true}]}]},
  google:{items:[{kind:'google',id:'owner@example.com',owner:'default',users:[{id:'default',name:'aqeelOS',signed:true},{id:'continue-threads',name:'Threads',signed:true}]}]},
  plugin:{items:[{kind:'plugin',id:'claude-login',label:'claude-login',owner:'default',users:[{id:'default',name:'aqeelOS'},{id:'sesa',name:'Sesa'}]}]},
  key:{items:[{kind:'key',id:'GITHUB_TOKEN@1',label:'GITHUB_TOKEN',owner:'default',users:[{id:'default',name:'aqeelOS'}]},{kind:'key',id:'SLACK_BOT_TOKEN@2',label:'SLACK_BOT_TOKEN',bot:true,owner:'sesa',users:[{id:'sesa',name:'Sesa'}]}]}},
 accounts:[{id:'google:owner@example.com',kind:'google',identity:'owner@example.com',name:'Google · owner@example.com',app:'Google',logo:'google.com',agentLabel:'Google, Aqeel main (Continue Threads agent)',
   agents:[{id:'default',name:'aqeelOS'},{id:'cont-socmed',name:'cont-socmed'},{id:'continue-threads',name:'Threads'}],can:['read','draft','send'],canBy:{'continue-threads':['read']},state:'connected',registered:true,mayPause:true,recent:[{text:'Read 2 sheets'}]},
  {id:'mcp:slack-pixel',kind:'mcp-oauth',mcp:'slack-pixel',identity:'Aqeel Jundiy · Pixel & Profits',name:'Slack · Pixel & Profits',app:'Slack',logo:'slack.com',agents:[{id:'default',name:'aqeelOS'},{id:'default--whatsapp-2',name:'aqeelOS'}],can:['read','draft','send'],state:'signed-out',registered:true,mayPause:true},
  {id:'mcp:notion',kind:'mcp-oauth',mcp:'notion',name:'Notion · Aqeel For Work',agents:[{id:'default'}],can:['read'],state:'connected',registered:true},{id:'mcp:notion-aqeel',kind:'mcp-oauth',mcp:'notion-aqeel',name:'Notion · Aqeel For Work',agents:[{id:'default'}],state:'connected',registered:false}],
 skills:{default:[{name:'seo',category:'marketing',enabled:true},{name:'aqeel-task-hub',category:'productivity',enabled:true}],'pixel-agent':[{name:'seo',category:'marketing',enabled:false}]},
 ads:[{agent:'sesa',state:'signed-out',port:50326},{agent:'pixel-agent',state:'none'}]});

test('one row per connection, merged from every source',()=>{const rows=buildRows(SRC());const by=k=>rows.find(r=>r.key===k);
 // the Google login once (as an account, not again from Access), named by its address, the agent's label kept as a note
 assert.equal(rows.filter(r=>r.kind==='google').length,1);const g=by('ca:google:owner@example.com');
 assert.equal(g.name,'Google · owner@example.com');assert.match(g.note,/Registered as “Google, Aqeel main/);assert.equal(g.owner,'default');
 assert.deepEqual(g.users.map(u=>[u.id,u.level]),[['default','full'],['continue-threads','read'],['cont-socmed','full']]);
 // Slack: the login, not an app as well; its extra number is the same agent; signed out says so first
 assert.equal(rows.filter(r=>r.id==='slack-pixel').length,1);const s=by('ca:mcp:slack-pixel');assert.deepEqual(s.users.map(u=>u.id),['default']);assert.equal(s.status,'signin');
 // two Notion sign-ins to one workspace are told apart; the one nobody registered comes first
 assert.deepEqual(rows.filter(r=>r.name.startsWith('Notion')).map(r=>r.name).sort(),['Notion · Aqeel For Work (notion)','Notion · Aqeel For Work (notion-aqeel)']);assert.equal(rows[0].key,'ca:mcp:notion-aqeel');
 // an app with its levels, one agent not signed in; n8n has no owner agent
 const c=by('mcp:composio');assert.equal(c.type,'app');assert.equal(c.name,'Composio');assert.deepEqual(c.users.map(u=>u.level),['full','read']);assert.equal(c.status,'signin');
 assert.equal(by('mcp:n8n').owner,null);assert.equal(by('mcp:n8n').levels,'none');
 // skills: on or off per agent; a skill kept for the main agent says so
 const k=by('skill:seo');assert.deepEqual(k.users.map(u=>[u.id,u.level]),[['default','on'],['pixel-agent','off']]);assert.deepEqual(k.canUse,['default']);assert.deepEqual(by('skill:aqeel-task-hub').only,[]);
 // AdsPower per agent (only where it is set up), plugins and keys; a chat bot stays with its agent
 assert.equal(by('ads:sesa').name,'AdsPower · Sesa');assert.equal(by('ads:sesa').status,'signin');assert.equal(by('ads:pixel-agent'),undefined);
 assert.equal(by('plugin:claude-login').users.length,2);assert.ok(by('key:SLACK_BOT_TOKEN@2').ownerFixed);
 // no row is named after an agent's label
 assert.ok(rows.every(r=>!/Threads agent/.test(r.name)))});

test('who may change what',()=>{const rows=buildRows(SRC());const by=k=>rows.find(r=>r.key===k);
 const admin={admin:true},member={admin:false,level:a=>({sesa:'owner','pixel-agent':'edit',default:'chat'})[a]||null,canOn:(cap,a)=>a==='sesa'||cap==='skills'&&a==='pixel-agent'};
 assert.ok(mayChange(admin,by('ca:google:owner@example.com'),'level','continue-threads'));
 // a member: never logins as the owner, keys or plugins
 assert.ok(!mayChange(member,by('ca:google:owner@example.com'),'level','sesa'));assert.ok(!mayChange(member,by('key:GITHUB_TOKEN@1'),'add','sesa'));assert.ok(!mayChange(member,by('plugin:claude-login'),'remove','sesa'));
 // skills on an agent they may edit, with the skills right there
 assert.ok(mayChange(member,by('skill:seo'),'level','pixel-agent'));assert.ok(!mayChange(member,by('skill:seo'),'level','default'));assert.ok(!mayChange(member,by('skill:seo'),'owner','pixel-agent'));
 // apps: a level on their own agent, but adding copies the owner's sign-in, so it needs the owner agent too
 const c=by('mcp:composio');assert.ok(mayChange(member,c,'level','sesa'));assert.ok(!mayChange(member,c,'add','sesa'));assert.ok(!mayChange(member,c,'owner','sesa'));
 assert.ok(mayChange({...member,level:a=>a==='sesa'||a==='default'?'owner':null},c,'add','sesa'));assert.ok(!mayChange(member,c,'level','pixel-agent'))});

// a level change end to end: the app's tools on one agent (and its extra number), through the engine dashboard
test('an app level is enforced on that agent only',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conn-')),H=path.join(root,'.hermes'),DATA=path.join(root,'data');const home=a=>a==='default'?H:path.join(H,'profiles',a);
 for(const a of ['default','pixel-agent','pixel-agent--2'])await mkdir(path.join(home(a),'logs'),{recursive:true});
 const tools=['slack_read_channel','slack_send_message','slack_send_message_draft','slack_search_public'];const app={url:'https://mcp.slack.com/mcp',auth:'header'};
 const cfg={default:{mcp_servers:{'slack-bot':{...app}}},'pixel-agent':{mcp_servers:{'slack-bot':{...app}}},'pixel-agent--2':{mcp_servers:{'slack-bot':{...app}}}};
 for(const a of Object.keys(cfg)){await mkdir(path.join(home(a),'cache'),{recursive:true});await writeFile(path.join(home(a),'cache','mcp_schema_cache.json'),JSON.stringify({'slack-bot':{tools:tools.map(name=>({name}))}}))}
 const log=a=>path.join(home(a),'logs','agent.log');const calls=[];
 const dash=async(m,p)=>{calls.push(m+' '+p);const n=decodeURIComponent((/servers\/([^/?]+)/.exec(p)||[])[1]||''),a=new URLSearchParams(p.split('?')[1]).get('profile');
  if(m==='DELETE'){delete cfg[a].mcp_servers[n];await appendFile(log(a),"2026-11-01 11:00:00,000 INFO gateway.run_profile_reconcile: MCP servers reconciled with config ("+a+"): removed=['"+n+"'] added=[]\n")}return {ok:true,status:200,j:{ok:true}}};
 const setKey=async(a,k,v)=>{cfg[a].mcp_servers[k.split('.').slice(1).join('.')]=structuredClone(v);return {ok:true}};
 const ca=createConnectedAccounts({DATA,HERMES_HOME:H,WORK:root,listAgents:async()=>Object.keys(cfg),readConfig:async a=>structuredClone(cfg[a]),setKey,dash,active:false,STEP:20});
 const users=[{id:'default',name:'aqeelOS',signed:true},{id:'pixel-agent',name:'PixelAgent',signed:true}];
 const access={list:async k=>k==='mcp'?{items:[{kind:'mcp',id:'slack-bot',label:'slack-bot',detail:app.url,owner:'default',users,ownerSigned:true}]}:{items:[]}};
 const cn=createConnections({DATA,access,accounts:ca,listAgents:async()=>['default','pixel-agent'],listCopies:async()=>Object.keys(cfg),names,engine:async()=>({ok:true,j:[]})});
 const r=await cn.setLevel('mcp:slack-bot','pixel-agent','read',{admin:true});assert.ok(r.background);
 for(let i=0;i<200&&!cfg['pixel-agent--2'].mcp_servers['slack-bot']?.tools;i++)await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(cfg['pixel-agent'].mcp_servers['slack-bot'].tools.exclude.sort(),['slack_send_message','slack_send_message_draft']);
 assert.deepEqual(cfg['pixel-agent--2'].mcp_servers['slack-bot'].tools.exclude.sort(),['slack_send_message','slack_send_message_draft']);
 assert.equal(cfg.default.mcp_servers['slack-bot'].tools,undefined);assert.ok(calls.every(c=>!c.includes('profile=default')));
 const row=(await cn.list({admin:true},{fresh:true})).rows.find(x=>x.key==='mcp:slack-bot');assert.deepEqual(row.users.map(u=>u.level),['full','read']);
 assert.deepEqual((await cn.detail('mcp:slack-bot',{admin:true})).tools,{read:2,draft:3,full:4,total:4});
 // a member who may not is refused before anything changes
 await assert.rejects(cn.setLevel('mcp:slack-bot','pixel-agent','full',{admin:false,level:()=>'chat',canOn:()=>false}),/can’t change/);
 // back to Full: its own settings exactly as they were
 await cn.setLevel('mcp:slack-bot','pixel-agent','full',{admin:true});const back=()=>['pixel-agent','pixel-agent--2'].every(a=>cfg[a].mcp_servers['slack-bot']&&!cfg[a].mcp_servers['slack-bot'].tools);for(let i=0;i<200&&!back();i++)await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(cfg['pixel-agent'].mcp_servers['slack-bot'],app);assert.deepEqual(cfg['pixel-agent--2'].mcp_servers['slack-bot'],app)});

// gapi.py with the per-agent guard: the same Google account, Full for the main agent, Read for another
test('gapi.py refuses a Google call for one agent only',async t=>{
 const py='python3';try{execFileSync(py,['-c','1'])}catch{return t.skip('no python3')}
 const root=await mkdtemp(path.join(tmpdir(),'gapi2-'));const src=`#!/usr/bin/env python3
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
    cmd, rest = argv[0], argv[1:]
    _readonly_guard(account, cmd, rest)
    _creds(account)


if __name__ == "__main__":
    main()
`;
 const f=path.join(root,'gapi.py');const p=patchGapiText(src);assert.ok(p.includes('accounts-guard-v3'));await writeFile(f,p);
 const H=path.join(root,'.hermes'),T=path.join(H,'profiles','continue-threads');await mkdir(T,{recursive:true});
 for(const d of [H,T])await writeFile(path.join(d,'google_token.json'),JSON.stringify({account:'a@b.test'}));
 await writeFile(path.join(H,'aqeelos-accounts.json'),JSON.stringify({google:{'a@b.test':{agents:{'continue-threads':['read']}}}}));
 const go=(home,...a)=>{try{return execFileSync(py,[f,...a],{env:{...process.env,HERMES_HOME:home},stdio:['ignore','pipe','pipe']}).toString()}catch(e){return String(e.stdout||'')+String(e.stderr||'')}};
 assert.match(go(T,'call','sheets','v4','spreadsheets.values.update'),/change Sheets/);assert.match(go(T,'call','sheets','v4','spreadsheets.values.get'),/would ask Google/);
 assert.match(go(H,'call','sheets','v4','spreadsheets.values.update'),/would ask Google/);
 // edit (5 Nov 2026): Sheets changes yes, mail no; an older list with send still allows Sheets
 await writeFile(path.join(H,'aqeelos-accounts.json'),JSON.stringify({google:{'a@b.test':{agents:{'continue-threads':['read','edit']}}}}));
 assert.match(go(T,'call','sheets','v4','spreadsheets.values.update'),/would ask Google/);assert.match(go(T,'call','gmail','v1','users.messages.send'),/send or change mail/);
 await writeFile(path.join(H,'aqeelos-accounts.json'),JSON.stringify({google:{'a@b.test':{agents:{'continue-threads':['read','draft','send']}}}}));
 assert.match(go(T,'call','sheets','v4','spreadsheets.values.update'),/would ask Google/);
 // the first guard (31 Oct) is replaced in place, once
 const v1=(await readFile(new URL('../app/connected-accounts.mjs',import.meta.url),'utf8')).includes('GAPI_V1');assert.ok(v1);assert.equal(patchGapiText(p),p)});
