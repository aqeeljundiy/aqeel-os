// Tests for app/connectors.mjs (connectors for every agent, 6 Nov 2026). Run: node --test scripts/connectors.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {isConnector,vanilla,catalog,missing,notConnected,createConnectors,contextLines,forAgent} from '../app/connectors.mjs';

const owner={mcp_servers:{
 'aqeelos-notify':{url:'http://127.0.0.1:4400/mcp/notify/default/x'},
 slack:{url:'https://mcp.slack.com/mcp',auth:'oauth',oauth:{client_id:'${SLACK_MCP_CLIENT_ID}',client_secret:'${SLACK_MCP_CLIENT_SECRET}',scope:'chat:write',redirect_uri:'https://x/cb/slack'},tools:{exclude:['slack_send_message']}},
 'slack-pixel':{url:'https://mcp.slack.com/mcp',auth:'oauth',oauth:{client_id:'929.106',client_secret:'abcd'}},
 notion:{url:'https://mcp.notion.com/mcp',auth:'oauth',oauth:{redirect_uri:'https://x/cb/notion'}},
 'notion-aqeel':{url:'https://mcp.notion.com/mcp',auth:'oauth'},
 composio:{url:'https://connect.composio.dev/mcp',auth:'oauth'},
 n8n:{url:'https://n8n.example.com/mcp-server/http',auth:'oauth',headers:{Authorization:'Bearer k'}},
 AdsPower:{command:'/x/adspower.sh'}}};
const support={mcp_servers:{n8n:{url:'https://n8n.example.com/mcp-server/http',headers:{Authorization:'Bearer own'}}}};
const pixel={mcp_servers:{composio:{url:'https://connect.composio.dev/mcp',auth:'oauth',enabled:false}}};

test('only sign-in-page apps are connectors: no keys, no local tools, no commands',()=>{
 assert.equal(isConnector(owner.mcp_servers.slack),true);assert.equal(isConnector(owner.mcp_servers.composio),true);
 assert.equal(isConnector(owner.mcp_servers.n8n),false);assert.equal(isConnector(owner.mcp_servers['aqeelos-notify']),false);assert.equal(isConnector(owner.mcp_servers.AdsPower),false)});

test('a plain copy never carries a login or someone’s own app keys',()=>{
 const v=vanilla(owner.mcp_servers['slack-pixel']);assert.equal(v.oauth.client_id,undefined);assert.equal(v.oauth.client_secret,undefined);assert.equal(v.oauth.redirect_uri,undefined);
 const s=vanilla(owner.mcp_servers.slack);assert.equal(s.oauth.client_id,'${SLACK_MCP_CLIENT_ID}');assert.deepEqual(s.tools.exclude,['slack_send_message']);assert.equal(s.oauth.scope,'chat:write')});

test('catalog: one per service, plainest name, strictest excludes',()=>{
 const c=catalog({default:owner});assert.deepEqual(c.map(x=>x.name),['composio','notion','slack']);
 assert.deepEqual(c.find(x=>x.name==='slack').entry.tools.exclude,['slack_send_message'])});

test('missing: what an agent has under any name or switched off counts as had',()=>{
 const c=catalog({default:owner});assert.deepEqual(missing(c,support).map(x=>x.name),['composio','notion','slack']);
 assert.deepEqual(missing(c,pixel).map(x=>x.name),['notion','slack']);assert.deepEqual(missing(c,owner),[])});

test('ensureAll adds plain copies with the agent’s own return address, marks them set up, and is idempotent',async()=>{
 const cfg={default:structuredClone(owner),'continue-support':structuredClone(support)};const notes=[];
 const setKey=async(a,k,v)=>{const n=k.split('.')[1];(cfg[a].mcp_servers||={})[n]=v;return {ok:true}};
 const c=createConnectors({listAgents:async()=>Object.keys(cfg),readConfig:async a=>structuredClone(cfg[a]),setKey,redirect:n=>'https://pub/cb/'+n,noteApp:async(a,n,r)=>notes.push(a+':'+n+':'+r.by)});
 const r=await c.ensureAll();assert.deepEqual(r.added,['continue-support:composio','continue-support:notion','continue-support:slack']);
 assert.equal(cfg['continue-support'].mcp_servers.notion.oauth.redirect_uri,'https://pub/cb/notion');
 assert.ok(!JSON.stringify(cfg['continue-support']).includes('abcd'));assert.ok(notes.every(x=>x.endsWith(':setup')));
 assert.equal((await c.ensureAll()).added.length,0)});

test('not connected: apps without a token file, told to the agent with both ways in',()=>{
 const l=notConnected({mcp_servers:{slack:owner.mcp_servers.slack,notion:owner.mcp_servers.notion,n8n:owner.mcp_servers.n8n}},n=>n==='notion');
 assert.deepEqual(l.map(x=>x.name),['slack']);const t=contextLines(l).join('\n');assert.match(t,/connect_mcp_tool/);assert.match(t,/share/);assert.deepEqual(contextLines([]),[])});

test('an aqeelOS app key named by a setting is kept only for an agent that has the setting',()=>{
 const e=vanilla(owner.mcp_servers.slack);assert.equal(forAgent(e,()=>false).oauth.client_id,undefined);assert.equal(forAgent(e,()=>false).oauth.client_secret,undefined);
 assert.equal(forAgent(e,v=>v.startsWith('SLACK_MCP')).oauth.client_id,'${SLACK_MCP_CLIENT_ID}')});
