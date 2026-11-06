// Tests for sharing levels (app/sharing.mjs) and their enforcement on connected accounts (connected-accounts.mjs,
// gapi.py guard) and saved secrets (the lock box). Run: node --test scripts/sharing.test.mjs
// Everything runs on temp folders with made-up agents (alpha, beta, gamma, delta); nothing of the live box is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createSharing,createSecretAccess,mayShare,canOfLevel} from '../app/sharing.mjs';
import {createConnectedAccounts,patchGapiText} from '../app/connected-accounts.mjs';

const tmp=p=>mkdtemp(path.join(tmpdir(),p));
async function setup(){const DATA=await tmp('share-');const s=createSharing({DATA,env:{}});await s.setEnabled(true,'test');await s.claim('secret','alpha/API_KEY','alpha',{label:'API_KEY'});return {DATA,s}}

test('mayShare: the rules of the levels',()=>{
 assert.equal(mayShare('owner','manager'),true);assert.ok(mayShare('owner','owner').error);
 assert.equal(mayShare('manager','editor'),true);assert.equal(mayShare('manager','viewer'),true);
 assert.match(mayShare('manager','manager').error,/editor or viewer/);assert.match(mayShare('manager','viewer','manager').error,/another manager/);
 assert.match(mayShare('editor','viewer').error,/owner or a manager/);assert.match(mayShare('viewer','viewer').error,/owner or a manager/);
 assert.deepEqual(canOfLevel('viewer'),['read']);assert.deepEqual(canOfLevel('editor'),['read','edit','draft','send']);assert.deepEqual(canOfLevel('none'),[])});

test('Viewer can read, not write',async()=>{const {s}=await setup();await s.share('secret','alpha/API_KEY','alpha','beta','viewer');
 assert.equal(await s.can('secret','alpha/API_KEY','beta','read'),true);assert.equal(await s.can('secret','alpha/API_KEY','beta','write'),false);
 assert.equal(await s.can('secret','alpha/API_KEY','beta','send'),false);assert.match((await s.check('secret','alpha/API_KEY','beta','write')).why,/viewer.*editor/)});

test('Editor can write, not share',async()=>{const {s}=await setup();await s.share('secret','alpha/API_KEY','alpha','beta','editor');
 assert.equal(await s.can('secret','alpha/API_KEY','beta','write'),true);assert.equal(await s.can('secret','alpha/API_KEY','beta','share'),false);
 await assert.rejects(s.share('secret','alpha/API_KEY','beta','gamma','viewer'),/owner or a manager/);assert.equal(await s.levelOf('secret','alpha/API_KEY','gamma'),'none')});

test('Manager can share as Editor, not as Manager or Owner, and cannot touch another manager',async()=>{const {s}=await setup();
 await s.share('secret','alpha/API_KEY','alpha','beta','manager');await s.share('secret','alpha/API_KEY','alpha','delta','manager');
 await s.share('secret','alpha/API_KEY','beta','gamma','editor');assert.equal(await s.levelOf('secret','alpha/API_KEY','gamma'),'editor');
 await assert.rejects(s.share('secret','alpha/API_KEY','beta','gamma','manager'),/editor or viewer/);await assert.rejects(s.share('secret','alpha/API_KEY','beta','gamma','owner'),/Level must be/);
 await assert.rejects(s.transfer('secret','alpha/API_KEY','beta','gamma'),/Only the owner/);await assert.rejects(s.revoke('secret','alpha/API_KEY','beta','delta'),/another manager/);
 await assert.rejects(s.remove('secret','alpha/API_KEY','beta'),/Only the owner/);
 await s.revoke('secret','alpha/API_KEY','beta','gamma');assert.equal(await s.levelOf('secret','alpha/API_KEY','gamma'),'none')});

test('Revoke takes effect immediately, also for another process reading the same file; all audited',async()=>{const {DATA,s}=await setup();
 const other=createSharing({DATA,env:{}});await s.share('secret','alpha/API_KEY','alpha','beta','editor');assert.equal(await other.can('secret','alpha/API_KEY','beta','use'),true);
 await s.revoke('secret','alpha/API_KEY','alpha','beta');assert.equal(await s.can('secret','alpha/API_KEY','beta','use'),false);
 const f=path.join(DATA,'sharing.json');const t=new Date(Date.now()+5000);await utimes(f,t,t);   // same-millisecond writes: make the change visible by time
 assert.equal(await other.can('secret','alpha/API_KEY','beta','use'),false);
 const a=await s.audit({k:'secret:alpha/API_KEY'});assert.deepEqual(a.map(e=>e.op),['claim','share','revoke']);assert.equal(a[2].from,'editor');assert.ok(!JSON.stringify(a).includes('value'))});

test('Transfer: the new owner has full control, the old owner stays as manager; extra copies count as the agent',async()=>{const {s}=await setup();
 await s.transfer('secret','alpha/API_KEY','alpha','beta');assert.equal(await s.levelOf('secret','alpha/API_KEY','beta'),'owner');assert.equal(await s.levelOf('secret','alpha/API_KEY','alpha--2'),'manager');
 assert.equal(await s.can('secret','alpha/API_KEY','alpha','delete'),false);await s.remove('secret','alpha/API_KEY','beta');assert.equal(await s.exists('secret','alpha/API_KEY'),false)});

test('Secrets: agent A cannot use agent B\'s secret unless shared; a viewer may type it, never write it',async()=>{const {DATA}=await setup();
 const W=await tmp('work-');const secretDir=b=>path.join(W,b,'.secrets');for(const a of ['alpha','beta'])await mkdir(secretDir(a),{recursive:true});
 await writeFile(path.join(secretDir('beta'),'BETA_TOKEN'),'s3cret');const s=createSharing({DATA,env:{}});
 const sa=createSecretAccess({sharing:s,secretDir,exists:async f=>!!(await readFile(f).catch(()=>null))});await sa.saved('beta','BETA_TOKEN');
 assert.equal((await sa.resolve('beta','BETA_TOKEN')).ok,true);
 const no=await sa.resolve('alpha','BETA_TOKEN');assert.equal(no.ok,false);assert.match(no.why,/No saved secret/);
 await s.share('secret','beta/BETA_TOKEN','beta','alpha','viewer');const yes=await sa.resolve('alpha','BETA_TOKEN','use');assert.equal(yes.ok,true);assert.equal(yes.owner,'beta');
 const w=await sa.resolve('alpha','BETA_TOKEN','write');assert.equal(w.ok,false);assert.match(w.why,/viewer; this needs editor/);
 await s.revoke('secret','beta/BETA_TOKEN','beta','alpha');assert.equal((await sa.resolve('alpha','BETA_TOKEN')).ok,false);
 await s.setEnabled(false,'test');await s.share('secret','beta/BETA_TOKEN','beta','alpha','editor');assert.equal((await sa.resolve('alpha','BETA_TOKEN')).ok,false,'off = own secrets only')});

// connected accounts end to end: a Google login owned by alpha, used by beta; the policy file gapi.py reads follows the level
test('Connected account: level decides the allowed actions written for gapi.py, revoke denies at once',async()=>{
 const H=await tmp('home-'),DATA=await tmp('data-');for(const a of ['alpha','beta'])await mkdir(path.join(H,'profiles',a),{recursive:true});
 for(const a of ['alpha','beta'])await writeFile(path.join(H,'profiles',a,'google_token.json'),JSON.stringify({token:'t',refresh_token:'r',account:'owner@example.test'}));
 const s=createSharing({DATA,env:{}});await s.setEnabled(true,'test');
 const ca=createConnectedAccounts({DATA,HERMES_HOME:H,sharing:s,listAgents:async()=>['alpha','beta'],readConfig:async()=>({}),setKey:async()=>({ok:true}),dash:async()=>({ok:false})});
 await ca.scan();await ca.claimAll();const id='google:owner@example.test';assert.equal(await s.levelOf('account',id,'alpha'),'owner');
 assert.equal(await s.levelOf('account',id,'beta'),'editor');   // an agent already using it keeps Editor at the first claim
 await s.revoke('account',id,'alpha','beta');
 const pol=async()=>JSON.parse(await readFile(path.join(H,'aqeelos-accounts.json'),'utf8')).google['owner@example.test'];
 const sync=()=>ca.levelsChanged(id);
 await sync();assert.deepEqual((await pol()).deny,['beta']);assert.deepEqual(await ca.canNow(id,'beta'),[]);
 await s.share('account',id,'alpha','beta','viewer');await sync();assert.deepEqual((await pol()).agents.beta,['read']);assert.equal((await pol()).deny,undefined);
 await s.share('account',id,'alpha','beta','editor');await sync();assert.equal((await pol())?.agents?.beta,undefined);assert.deepEqual(await ca.canNow(id,'beta'),['read','edit','draft','send']);
 await s.revoke('account',id,'alpha','beta');await sync();assert.deepEqual((await pol()).deny,['beta']);assert.deepEqual(await ca.canNow(id,'alpha'),['read','edit','draft','send'])});

test('gapi.py v4 guard: denied agent refused, viewer may read not send',async t=>{try{execFileSync('python3',['-c','1'])}catch{return t.skip('no python3')}
 const root=await tmp('gapi4-'),home=path.join(root,'profiles','beta');await mkdir(home,{recursive:true});
 const src=['#!/usr/bin/env python3','import json','import os','import sys','from pathlib import Path','','HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))','','',
  'def _creds(account):','    raise SystemExit(json.dumps({"error": "would ask Google"}))','','','def _readonly_guard(account, cmd, rest):','    return','','',
  'def main():','    argv = sys.argv[1:]','    account = None','    cmd, rest = argv[0], argv[1:]','    _readonly_guard(account, cmd, rest)','    _creds(account)','','','if __name__ == "__main__":','    main()',''].join('\n');
 const f=path.join(root,'gapi.py');const patched=patchGapiText(src);assert.ok(patched.includes('accounts-guard-v4'));await writeFile(f,patched);assert.equal(patchGapiText(patched),patched);
 const go=(...a)=>{try{return execFileSync('python3',[f,...a],{env:{...process.env,HERMES_HOME:home},stdio:['ignore','pipe','pipe']}).toString()}catch(e){return String(e.stdout||'')+String(e.stderr||'')}};
 await writeFile(path.join(home,'google_token.json'),JSON.stringify({account:'o@example.test'}));
 await writeFile(path.join(root,'aqeelos-accounts.json'),JSON.stringify({google:{'o@example.test':{deny:['beta']}}}));assert.match(go('call','sheets','v4','spreadsheets.get'),/not shared with you/);
 await writeFile(path.join(root,'aqeelos-accounts.json'),JSON.stringify({google:{'o@example.test':{agents:{beta:['read']}}}}));
 assert.match(go('call','sheets','v4','spreadsheets.get'),/would ask Google/);assert.match(go('call','gmail','v1','users.messages.send'),/does not let/)});
