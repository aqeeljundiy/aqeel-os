// One verdict per AI account (app/account-state.mjs): Models > Accounts and Health > Needs you read the same state, so they cannot disagree
// (UI audit 13: Health said a ChatGPT sign-in stopped working, Models said Connected).
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {accountState,accountStates,worstUsed,needsPerson} from '../app/account-state.mjs';
import {issueActs} from '../app/need-action.mjs';

test('the four states, and which one wins',()=>{
 assert.equal(accountState({}),'connected');
 assert.equal(accountState({signedIn:false}),'needs-signin');
 assert.equal(accountState({dead:true}),'dead');
 assert.equal(accountState({key:'rejected'}),'dead');
 assert.equal(accountState({used:100}),'limit');assert.equal(accountState({used:99}),'connected');
 assert.equal(accountState({key:'credit'}),'limit');
 assert.equal(accountState({checking:true,signedIn:false}),'checking');
 assert.equal(accountState({dead:true,used:100}),'dead','a refused login is not "at its limit"');
 assert.equal(accountState({signedIn:false,used:100}),'needs-signin');
 assert.deepEqual(['needs-signin','dead','limit','connected','checking'].filter(needsPerson),['needs-signin','dead']);
 assert.equal(worstUsed([{used:20,scope:'account'},{used:100,scope:'model'},{used:55}]),55,'only the windows that count for switching');assert.equal(worstUsed([]),null)});

test('every account from one read: Claude, a provider with a dead login, a provider that is gone',()=>{
 const st=accountStates({claude:[{key:'claude:main',v:{signedIn:true,usage:{session:{used:30},week:{used:100}}}},{key:'claude:two',v:{signedIn:false}},{key:'claude:three',v:{partial:true}}],
  prov:[{key:'p:openai-codex',dead:true,windows:[]},{key:'p:openrouter',windows:[]}],keys:{'p:openrouter':{state:'credit'}},gone:['p:old','p:openai-codex']});
 assert.deepEqual(st,{'claude:main':'limit','claude:two':'needs-signin','claude:three':'checking','p:openai-codex':'dead','p:openrouter':'limit','p:old':'needs-signin'})});

test('Health and Models say the same thing about the same account',()=>{
 // Models: the page maps the server's state to its status word (the function is read out of the page file)
 const page=readFileSync(new URL('../app/accounts-page.js',import.meta.url),'utf8');
 const m=/const acctStatus=\(d,key,was\)=>\{.*?\};\n/s.exec(page);assert.ok(m,'the page reads d.states');const acctStatus=new Function(m[0]+';return acctStatus')();
 const word={ok:'Connected',out:'Needs sign-in',dead:'Sign-in stopped working',limit:'At its limit',checking:'Checking…'};
 const issue={agent:'default',need:'Sign in to Proton ChatGPT again: its sign-in stopped working.',steps:[{what:'ai-account',id:'p:openai-codex'}]};
 for(const state of ['connected','needs-signin','dead','limit']){
  const d={states:{'p:openai-codex':state},keys:{}},models=word[acctStatus(d,'p:openai-codex','ok')];
  const acts=issueActs(issue,{accounts:[{key:'p:openai-codex',name:'Proton ChatGPT',state}]}),signIn=acts.some(a=>a.do==='signin-account'),done=acts.find(a=>a.do==='done');
  if(state==='connected'){assert.equal(models,'Connected');assert.equal(signIn,false,'Health offers no sign-in for a connected account');assert.match(done.say,/connected now/)}
  if(state==='needs-signin'||state==='dead'){assert.notEqual(models,'Connected');assert.equal(signIn,true,'both show it needs a person')}
  if(state==='limit'){assert.equal(models,'At its limit');assert.equal(signIn,false);assert.match(done.say,/at its limit/)}}
 // a key the provider refused keeps its own word on Models, and Health asks for a new key
 assert.equal(word[acctStatus({states:{'p:x':'dead'},keys:{'p:x':{state:'rejected'}}},'p:x','ok')]===undefined,true);
 const k=issueActs({agent:'default',steps:[{what:'ai-account',id:'p:x'}]},{accounts:[{key:'p:x',name:'X',state:'dead',rejected:true}]});assert.match(k[0].label,/^New key for/)});
