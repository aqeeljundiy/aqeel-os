// Tests for Connect Slack (app/slack-connect.mjs). Run: node --test scripts/slack-connect.test.mjs
// The pasted ID and secret are checked in plain words; the filled-in app (manifest) has the official Slack MCP's user
// scopes and only https return addresses; the "create app" link carries it; Slack's own answer on a wrong pair is
// said plainly; Connect adds the Slack MCP with this app when an agent has none, keeps an older own app, and every
// other sign-in of a Slack MCP without a client gets this app (fallback).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSlackConnect,parseClient,manifest,manifestUrl,USER_SCOPES,MCP_URL,isSlackUrl} from '../app/slack-connect.mjs';

const ID='1234567890123.9876543210987',SECRET='0123456789abcdef0123456789ABCDEF';
function setup({configs={},slackSays='invalid_code'}={}){const T=mkdtempSync(path.join(tmpdir(),'aq-sl-')),H=path.join(T,'hh');mkdirSync(H,{recursive:true});
 const calls={set:[],prep:[],start:[],fetch:[]};
 const sc=createSlackConnect({HERMES_HOME:H,redirectFor:n=>'https://ai.example.test/mcp-oauth/api/mcp/oauth/callback/'+n,
  readConfig:async a=>configs[a]||{},setKey:async(a,k,v)=>{calls.set.push({a,k,v});return {ok:true}},
  prepareSignin:async(...x)=>{calls.prep.push(x);return {changed:false}},startSignin:async(a,t)=>{calls.start.push([a,t]);return {authorization_url:'https://slack.com/oauth/v2_user/authorize?x=1',flow_id:'f1'}},
  fetchImpl:async(url,o)=>{calls.fetch.push({url,body:Object.fromEntries(new URLSearchParams(o.body))});return {ok:true,json:async()=>({ok:false,error:slackSays})}}});
 return {T,H,sc,calls,done:()=>rmSync(T,{recursive:true,force:true})}}

test('the pasted Client ID and Secret: right ones pass, the usual mistakes are said plainly',()=>{
 assert.deepEqual(parseClient({client_id:' '+ID+' ',client_secret:SECRET}),{client_id:ID,client_secret:SECRET.toLowerCase()});
 assert.throws(()=>parseClient({}),/Client ID first/);
 assert.throws(()=>parseClient({client_id:'A0123ABCDEF',client_secret:SECRET}),/App ID/);
 assert.throws(()=>parseClient({client_id:'hello',client_secret:SECRET}),/does not look like a Slack Client ID/);
 assert.throws(()=>parseClient({client_id:ID}),/Client Secret too/);
 assert.throws(()=>parseClient({client_id:ID,client_secret:'********'}),/still hidden/);
 assert.throws(()=>parseClient({client_id:ID,client_secret:'short'}),/32 letters/)});

test('the filled-in app: official MCP user scopes, https return addresses only, no bot',()=>{
 const m=manifest({name:'A very long install name that Slack would refuse',redirects:['https://a.test/cb/slack','http://localhost:3000/cb','https://a.test/cb/slack']});
 assert.ok(m.display_information.name.length<=35);
 assert.deepEqual(m.oauth_config.redirect_urls,['https://a.test/cb/slack']);
 assert.deepEqual(m.oauth_config.scopes.user,USER_SCOPES);assert.equal(m.oauth_config.scopes.bot,undefined);
 for(const s of ['search:read.public','chat:write','channels:history','users:read.email','canvases:write'])assert.ok(USER_SCOPES.includes(s),s);
 assert.equal(new Set(USER_SCOPES).size,USER_SCOPES.length);
 assert.equal(manifest({redirects:['http://x.test/cb']}).oauth_config.redirect_urls,undefined)});

test('the create-app link opens Slack with the app in it',()=>{const m=manifest({redirects:['https://a.test/cb/slack']});const u=new URL(manifestUrl(m));
 assert.equal(u.origin+u.pathname,'https://api.slack.com/apps');assert.equal(u.searchParams.get('new_app'),'1');
 assert.deepEqual(JSON.parse(u.searchParams.get('manifest_json')),m);
 assert.ok(isSlackUrl(MCP_URL));assert.ok(!isSlackUrl('https://slack.com/api'))});

test('saving the app: checked with Slack, kept private, the secret never sent back',async()=>{const t=setup();try{
 const r=await t.sc.saveClient({client_id:ID,client_secret:SECRET},['default']);
 assert.equal(t.calls.fetch[0].body.client_id,ID);assert.ok(!JSON.stringify(r).includes(SECRET));assert.equal(r.client.id,'1234…0987');
 assert.deepEqual(r.redirects,['https://ai.example.test/mcp-oauth/api/mcp/oauth/callback/slack']);assert.ok(r.https);
 const f=path.join(t.H,'slack_client.json');assert.equal(JSON.parse(readFileSync(f,'utf8')).client_secret,SECRET.toLowerCase());
 if(process.platform!=='win32')assert.equal(statSync(f).mode&0o777,0o600)}finally{t.done()}});

test('a wrong pair: Slack\'s answer in plain words, nothing saved',async()=>{for(const [err,re] of [['invalid_client_id',/does not know that Client ID/],['bad_client_secret',/does not belong/]]){const t=setup({slackSays:err});try{
 await assert.rejects(t.sc.saveClient({client_id:ID,client_secret:SECRET}),re);assert.equal(await t.sc.client(),null)}finally{t.done()}}});

test('connect: an agent with no Slack gets the Slack MCP with this app, then the sign-in starts',async()=>{const t=setup();try{
 await assert.rejects(t.sc.connect('default'),/not set up/);
 await t.sc.saveClient({client_id:ID,client_secret:SECRET});const r=await t.sc.connect('default');
 assert.equal(t.calls.set[0].k,'mcp_servers.slack');assert.equal(t.calls.set[0].v.url,MCP_URL);assert.equal(t.calls.set[0].v.oauth.client_id,ID);
 assert.equal(t.calls.set[0].v.oauth.redirect_uri,'https://ai.example.test/mcp-oauth/api/mcp/oauth/callback/slack');
 assert.deepEqual(t.calls.start[0],['default','slack']);assert.equal(r.flow,'f1');assert.match(r.url,/^https:\/\/slack\.com\//)}finally{t.done()}});

test('connect: an existing Slack MCP keeps its name; an older own app is left alone; ours is not "own"',async()=>{
 const t=setup({configs:{a:{mcp_servers:{'slack-pixel':{url:MCP_URL,auth:'oauth'}}},b:{mcp_servers:{slack:{url:MCP_URL,auth:'oauth',oauth:{client_id:'111111.222222',client_secret:'x'}}}},c:{mcp_servers:{slack:{url:'https://hooks.example.test'}}}}});try{
 await t.sc.saveClient({client_id:ID,client_secret:SECRET});
 await t.sc.connect('a');assert.equal(t.calls.set.length,0);assert.deepEqual(t.calls.prep[0].slice(1,4),['slack-pixel','https://ai.example.test/mcp-oauth/api/mcp/oauth/callback/slack-pixel',{id:ID,secret:SECRET.toLowerCase()}]);
 await t.sc.connect('b');assert.equal(t.calls.prep[1][3],null);
 assert.equal((await t.sc.slackOf('c')).name,'slack-mcp');
 assert.ok((await t.sc.info(['a','b'])).redirects.some(u=>u.endsWith('/slack-pixel')));
 const ours=setup({configs:{d:{mcp_servers:{slack:{url:MCP_URL,oauth:{client_id:ID}}}}}});try{await ours.sc.saveClient({client_id:ID,client_secret:SECRET});assert.equal((await ours.sc.slackOf('d')).own,false)}finally{ours.done()}}finally{t.done()}});

test('fallback: a Slack MCP sign-in without a client gets this app; other apps never do',async()=>{const t=setup();try{
 assert.equal(await t.sc.fallback({url:MCP_URL}),null);
 await t.sc.saveClient({client_id:ID,client_secret:SECRET});
 assert.deepEqual(await t.sc.fallback({url:MCP_URL}),{id:ID,secret:SECRET.toLowerCase()});
 assert.equal(await t.sc.fallback({url:'https://mcp.notion.com/mcp'}),null)}finally{t.done()}});
