// Tests for editing an app that is already added (app/mcp-edit.mjs) and for the plain message when an install stops at a
// terminal question (askingInTerminal in app/core.js). Run: node --test scripts/mcp-edit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {keyFor,edited,authOf,reads,createMcpEdit} from '../app/mcp-edit.mjs';

test('the key name is the engine\'s own',()=>{assert.equal(keyFor('notion'),'MCP_NOTION_API_KEY');assert.equal(keyFor('my-app.2'),'MCP_MY_APP_2_API_KEY');assert.equal(keyFor('_x_'),'MCP_X_API_KEY')});
test('an address app: new address, key, sign in with the service, or none',()=>{const s={url:'https://a.test/mcp',headers:{Authorization:'Bearer ${MCP_A_API_KEY}','X-Team':'t'}};
 assert.equal(authOf(s),'header');assert.deepEqual(reads(s),['MCP_A_API_KEY']);
 assert.deepEqual(edited(s,{name:'a',url:'https://b.test/mcp'},{hasKey:true}),{url:'https://b.test/mcp',headers:{'X-Team':'t',Authorization:'Bearer ${MCP_A_API_KEY}'}});
 assert.deepEqual(edited(s,{name:'a',auth:'oauth'}),{url:'https://a.test/mcp',headers:{'X-Team':'t'},auth:'oauth'});
 assert.deepEqual(edited({url:'https://a.test',auth:'oauth'},{name:'a',auth:'none'}),{url:'https://a.test'});
 assert.throws(()=>edited({url:'https://a.test'},{name:'a',auth:'header'}),/Paste the key/);assert.throws(()=>edited(s,{name:'a',url:'ftp://x'}),/https/);
 assert.deepEqual(edited({url:'https://a.test'},{name:'a',auth:'header',token:'Bearer k'}).headers,{Authorization:'Bearer ${MCP_A_API_KEY}'})});
test('a command app: command, arguments and settings',()=>{const e=edited({command:'npx',args:['-y','x'],env:{A:'1'}},{name:'c',command:'uvx',args:'srv --port 1',env:{B:'2'}});
 assert.deepEqual(e,{command:'uvx',args:['srv','--port','1'],env:{B:'2'}});assert.throws(()=>edited({command:'npx'},{name:'c',command:' '}),/command/);assert.throws(()=>edited({command:'npx'},{name:'c',env:{'1x':'y'}}),/setting name/)});

function fake(cfg,env){const st={cfg,env,set:[],restarts:0};return {st,m:createMcpEdit({readConfig:async()=>({mcp_servers:st.cfg}),setKey:async(a,k,v)=>{st.set.push([a,k,v]);st.cfg[k.split('.')[1]]=v;return {ok:true}},
 readEnv:async()=>st.env,editEnv:async(a,f)=>{st.env=f(st.env)},restart:()=>st.restarts++})}}
test('save: the key goes to .env (Bearer taken off), the entry to config, the agents restart; no value is ever sent back',async()=>{const {st,m}=fake({a:{url:'https://a.test'}},'OTHER=1\n');
 const r=await m.save('default',{name:'a',auth:'header',token:'Bearer sekret'});assert.match(st.env,/^MCP_A_API_KEY=sekret$/m);assert.match(st.env,/^OTHER=1$/m);
 assert.deepEqual(st.set[0],['default','mcp_servers.a',{url:'https://a.test',headers:{Authorization:'Bearer ${MCP_A_API_KEY}'}}]);assert.equal(st.restarts,1);
 assert.equal(r.hasKey,true);assert.ok(!JSON.stringify(r).includes('sekret'));
 await m.save('default',{name:'a',url:'https://a2.test'});assert.equal(st.cfg.a.url,'https://a2.test');assert.equal(st.cfg.a.headers.Authorization,'Bearer ${MCP_A_API_KEY}','the key stays');
 await assert.rejects(()=>m.save('default',{name:'gone'}),e=>e.status===404);await assert.rejects(()=>m.save('default',{name:'a',auth:'header',token:'two words'}),/no spaces/)});
test('a setting left blank keeps its saved value (the dialog never shows values)',async()=>{const {st,m}=fake({c:{command:'npx',env:{TOKEN:'v1',MODE:'x'}}},'');
 const g=await m.get('default','c');assert.deepEqual(g.env,{TOKEN:'',MODE:''});await m.save('default',{name:'c',env:{TOKEN:'',MODE:'y'}});assert.deepEqual(st.cfg.c.env,{TOKEN:'v1',MODE:'y'})});
test('keys nothing reads are flagged: Notion signs in with the account, a gone app, an app that does not use it',async()=>{
 const {m}=fake({notion:{url:'https://mcp.notion.com/mcp',auth:'oauth'},gh:{url:'https://gh.test',headers:{Authorization:'Bearer ${MCP_GH_API_KEY}'}},plain:{url:'https://p.test'}},'MCP_NOTION_API_KEY=x\nMCP_GH_API_KEY=y\nMCP_OLD_API_KEY=z\nMCP_PLAIN_API_KEY=w\nMCP_EMPTY_API_KEY=\nOPENAI_API_KEY=q\n');
 const k=Object.fromEntries((await m.keys('default')).map(x=>[x.key,x]));assert.deepEqual(Object.keys(k).sort(),['MCP_GH_API_KEY','MCP_NOTION_API_KEY','MCP_OLD_API_KEY','MCP_PLAIN_API_KEY']);
 assert.equal(k.MCP_GH_API_KEY.used,true);assert.equal(k.MCP_NOTION_API_KEY.why,'oauth');assert.match(k.MCP_NOTION_API_KEY.text,/Sign in/);assert.equal(k.MCP_OLD_API_KEY.why,'gone');assert.equal(k.MCP_PLAIN_API_KEY.why,'notused')});
test('remove a key: only an unused app key',async()=>{const {st,m}=fake({gh:{url:'https://gh.test',headers:{Authorization:'Bearer ${MCP_GH_API_KEY}'}}},'MCP_GH_API_KEY=y\nMCP_OLD_API_KEY=z\nOPENAI_API_KEY=q');
 await assert.rejects(()=>m.removeKey('default','OPENAI_API_KEY'),/Only an app key/);await assert.rejects(()=>m.removeKey('default','MCP_GH_API_KEY'),/still uses/);
 await m.removeKey('default','MCP_OLD_API_KEY');assert.equal(st.env,'MCP_GH_API_KEY=y\nOPENAI_API_KEY=q')});

// the install log's last line is a question nobody can answer from the web
const src=readFileSync(new URL('../app/core.js',import.meta.url),'utf8');const line=/^const askingInTerminal=.*$/m.exec(src)?.[0];
test('an install that stops at a terminal question is said plainly',()=>{assert.ok(line,'askingInTerminal is in core.js');const f=new Function(line+';return askingInTerminal')();
 for(const t of ['Need to install the following packages:\n  x@1\nOk to proceed? (y) ','Username for \'https://github.com\': ','Continue? [Y/n] ','? Select the tools to enable ›','Password:'])assert.ok(f(t),t);
 for(const t of ['Installing…\nDone.','Cloning into x...\n','Found 12 tools.'])assert.ok(!f(t),t)});
