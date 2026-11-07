// Browser-side fixes from the clean-install test (7 Nov 2026), checked against the real source of the app files:
// setting labels in words, a lone schedule folder starts open, and the chat list error says why and where to fix it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
// the source of one top-level declaration (a one- or few-line function or const) from a browser script
const grab=(f,start)=>{const s=src(f),i=s.indexOf(start);assert.ok(i>=0,start+' not found in '+f);let j=s.indexOf('\n',i);while(/^\s/.test(s.slice(j+1,j+2)))j=s.indexOf('\n',j+1);return s.slice(i,j)};

test('a channel setting without a prompt is named in words, never by its variable',()=>{
 const chLabel=new Function(grab('pages.js','const CH_ACRO=')+'\n'+grab('pages.js','function chLabel(')+'\nreturn chLabel')();
 assert.equal(chLabel('TELEGRAM_BOT_TOKEN'),'Bot token');assert.equal(chLabel('TELEGRAM_ALLOWED_USERS'),'Allowed users');
 assert.equal(chLabel('SLACK_APP_ID'),'App ID');assert.equal(chLabel('EMAIL_SMTP_PORT'),'SMTP port');assert.equal(chLabel('TOKEN'),'Token')});

test('a lone schedule folder starts open; with several, folders start shut; a folder someone shut stays shut',()=>{
 const line=src('schedules.js').match(/shut=(!q&&\(folds\[f\]===true\|\|folds\[f\]!==false&&order\.length>1\))/);assert.ok(line,'the folder rule');
 const shut=new Function('q','folds','f','order','return '+line[1]);
 assert.equal(shut('',{},'General',['General']),false);assert.equal(shut('',{},'General',['General','Reports']),true);
 assert.equal(shut('',{General:true},'General',['General']),true);assert.equal(shut('',{General:false},'General',['General','Reports']),false);
 assert.equal(shut('morning',{General:true},'General',['General']),false)});

test('the chat list error says the engine needs a restart and points admins to Health',()=>{
 const S={install:{engine:{state:'auth'}},me:{admin:true}};const t=new Function('S',grab('chat.js','function chatsErrText(')+'\nreturn chatsErrText()');
 assert.match(t(S),/needs one restart\. <a href="#\/system\/health">See Health<\/a>$/);
 assert.match(t({install:{engine:{state:'down'}},me:{admin:false}}),/isn’t answering\. An admin can fix it\.$/);
 assert.match(t({me:{}}),/^Couldn't load chats\. The engine didn’t answer\./)});
