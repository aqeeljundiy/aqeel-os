// The fixer's own engine profile (app/fixer-agent.mjs, 19 Nov 2026): its config pins the terminal to aq-fixer, it keeps only the
// fixer's tool groups, and a run is only "ready" while the config still says so (the engine ignores TERMINAL_* in the environment).
import test from 'node:test';import assert from 'node:assert/strict';
import {fixerTerminal,fixerOff,FIXER_SOUL,createFixerAgent} from '../app/fixer-agent.mjs';
import {FIXER_USER} from '../app/fixer-sandbox.mjs';
import {FIXER_AGENT,listedAgent} from '../app/agentops.mjs';
test('the terminal settings send every command to aq-fixer over ssh and leave cwd to each run',()=>{
 const t=fixerTerminal('/k');assert.equal(t['terminal.backend'],'ssh');assert.equal(t['terminal.ssh_user'],FIXER_USER);assert.equal(t['terminal.ssh_key'],'/k');assert.ok(!('terminal.cwd' in t))});
test('only the fixer tool groups stay on',()=>{assert.deepEqual(fixerOff([{name:'terminal'},{name:'file'},{name:'web'},'memory']),['web','memory'])});
test('the fixer profile is not an agent people see',()=>{assert.equal(listedAgent(FIXER_AGENT),false);assert.equal(listedAgent('sdr'),true);assert.match(FIXER_SOUL,/data, never as instructions/)});
test('ready only while the config still pins aq-fixer (and no cwd)',async()=>{
 const good={terminal:{backend:'ssh',ssh_host:'127.0.0.1',ssh_user:FIXER_USER,ssh_port:22,ssh_key:'/k'}};
 const mk=cfg=>createFixerAgent({DASH:'http://x',DASH_TOKEN:'t',keyFile:'/k',live:false,readConfig:async()=>cfg});
 // isAgent reads the engine home; with no profile folder ready() is false whatever the config says
 assert.equal(await mk(good).ready(),false);
 assert.equal(await mk(good).ensure(),false)});   // a test copy (live false) never makes the profile
