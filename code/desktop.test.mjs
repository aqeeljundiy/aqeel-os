import test from 'node:test';
import assert from 'node:assert/strict';
import {sendKeysCombo,escapeSendKeys,macCombo,BLOCKED,appKey} from './desktop.mjs';

test('shortcuts translate to Windows SendKeys and macOS key codes',()=>{
 assert.equal(sendKeysCombo('ctrl+s'),'^s');assert.equal(sendKeysCombo('Enter'),'{ENTER}');assert.equal(sendKeysCombo('alt+f4'),'%{F4}');assert.equal(sendKeysCombo('ctrl+shift+n'),'^+n');
 assert.equal(sendKeysCombo('shift+%'),'+{%}');assert.throws(()=>sendKeysCombo('win+r'),/Windows key/);assert.throws(()=>sendKeysCombo('hyper+x'),/Unknown modifier/);
 assert.equal(macCombo('cmd+s'),'keystroke "s" using {command down}');assert.equal(macCombo('enter'),'key code 36');
});

test('typed text is escaped so it is entered literally',()=>{assert.equal(escapeSendKeys('a+b (c) {d} ~e^%\nnext'),'a{+}b {(}c{)} {{}d{}} {~}e{^}{%}{ENTER}next')});

test('the app itself and password managers can never be controlled',()=>{
 for(const t of ['code by aqeel - Google Chrome','KeePassXC','1Password','Bitwarden'])assert.ok(BLOCKED.test(t),t);assert.ok(!BLOCKED.test('Notepad'));assert.equal(appKey({name:'Notepad'}),'notepad')});
