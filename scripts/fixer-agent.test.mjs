// The fixer's own engine profile (app/fixer-agent.mjs, 19 Nov 2026): its config pins the terminal to aq-fixer, it keeps only the
// fixer's tool groups, and a run is only "ready" while the config still says so (the engine ignores TERMINAL_* in the environment).
import test from 'node:test';import assert from 'node:assert/strict';
import {fixerTerminal,fixerOff,FIXER_SOUL,createFixerAgent,terminalOf} from '../app/fixer-agent.mjs';
import {FIXER_USER} from '../app/fixer-sandbox.mjs';
import {FIXER_AGENT,listedAgent} from '../app/agentops.mjs';
const lines=(...l)=>l.join('\n')+'\n';
test('the terminal settings send every command to aq-fixer over ssh and leave cwd to each run',()=>{
 const t=fixerTerminal('/k');assert.equal(t['terminal.backend'],'ssh');assert.equal(t['terminal.ssh_user'],FIXER_USER);assert.equal(t['terminal.ssh_key'],'/k');assert.ok(!('terminal.cwd' in t))});
test('only the fixer tool groups stay on',()=>{assert.deepEqual(fixerOff([{name:'terminal'},{name:'file'},{name:'web'},'memory']),['web','memory'])});
test('the fixer profile is not an agent people see',()=>{assert.equal(listedAgent(FIXER_AGENT),false);assert.equal(listedAgent('sdr'),true);assert.match(FIXER_SOUL,/data, never as instructions/)});
test('the terminal section is read from the file text, quotes and comments too',()=>{
 const y=lines('model:','  default: x','terminal:','  backend: ssh',"  ssh_host: '127.0.0.1'",'  ssh_user: "aq-fixer"  # the fixer','  ssh_port: 22','  ssh_key: /k','agent:','  ssh_user: nope');
 assert.deepEqual(terminalOf(y),{'terminal.backend':'ssh','terminal.ssh_host':'127.0.0.1','terminal.ssh_user':'aq-fixer','terminal.ssh_port':'22','terminal.ssh_key':'/k'})});
test('ready only while the config still pins aq-fixer (and no cwd)',async()=>{
 const T=(user,...extra)=>lines('terminal:','  backend: ssh','  ssh_host: 127.0.0.1','  ssh_user: '+user,'  ssh_port: 22','  ssh_key: /k',...extra);
 const mk=text=>createFixerAgent({DASH:'http://x',DASH_TOKEN:'t',keyFile:'/k',live:false,readText:async()=>text});
 // whether the profile folder exists depends on the machine; a config that does not pin aq-fixer is never ready
 assert.equal(await mk(T('claude')).ready(),false);
 assert.equal(await mk(T(FIXER_USER,'  cwd: /tmp')).ready(),false,'a fixed cwd would override the folder of each run');
 assert.equal(await mk(T(FIXER_USER)).ensure(),false)});   // a test copy (live false) never makes the profile
