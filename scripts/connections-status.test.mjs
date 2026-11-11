// Abilities › Connections status and Check now (11 Nov 2026, owner: "it sometimes shows things that are connected + the
// refresh don't work"). A row says Needs sign-in whenever its own sign-in check or the engine (server.mjs checkSignins, the
// list Bottlenecks shows) says so; a kept list never shows an older status; Check now (?check=1) gets past every kept list.
// Run: node --test scripts/connections-status.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
process.env.AQEELOS_SKILLS_POLICY=new URL('./fixtures/skills-policy.example.json',import.meta.url).pathname;
const {stateNow,SIGNIN_AGAIN,createConnectedAccounts}=await import('../app/connected-accounts.mjs');
const {buildRows,dueOf,createConnections}=await import('../app/connections.mjs');

const names=a=>({default:'aqeelOS','pepclub-social':'Pepclub Social',sesa:'Sesa'})[a]||a;
const login=(o={})=>({id:'mcp:higgsfield',kind:'mcp-oauth',provider:'higgsfield',mcp:'higgsfield',agents:['default','default--whatsapp-2'],state:'connected',why:'',expires:Date.now()/1000+3600,refreshable:true,...o});

test('a login’s state now: its own check, with the engine’s sign-in needed laid over it',()=>{
 assert.deepEqual(stateNow(login()),{state:'connected',why:''});
 // the engine says the sign-in ran out on the main agent; a copy of an agent counts as that agent
 const due=(a,n)=>a==='default'&&n==='higgsfield'?{why:'the sign-in ran out'}:null;
 const s=stateNow(login(),{signinNeeded:due,nameOf:names});assert.equal(s.state,'signed-out');assert.equal(s.why,SIGNIN_AGAIN+' (aqeelOS: the sign-in ran out)');
 // signed in again: the engine's entry is gone and the row is connected at once, not 30 min later
 assert.equal(stateNow(login(),{signinNeeded:()=>null}).state,'connected');
 // a saved sign-in that ran out and can't renew, before the next check
 assert.deepEqual(stateNow(login({expires:Date.now()/1000-60,refreshable:false})),{state:'signed-out',why:'The sign-in ran out'});
 assert.equal(stateNow(login({expires:Date.now()/1000-60,refreshable:true})).state,'connected');
 // Pause, a change being applied and Off come first; the stored check result stays when it found a problem itself
 assert.equal(stateNow(login({paused:{state:'paused'}}),{signinNeeded:due}).state,'paused');
 assert.equal(stateNow(login({paused:{state:'failed',agents:{sesa:'failed: no'}}}),{nameOf:names}).why,'Sesa: no');
 assert.equal(stateNow(login(),{busy:true,signinNeeded:due}).state,'applying');
 assert.equal(stateNow(login({off:true}),{signinNeeded:due}).state,'off');
 assert.deepEqual(stateNow(login({state:'signed-out',why:'Slack says: token revoked'}),{signinNeeded:()=>null}),{state:'signed-out',why:'Slack says: token revoked'});
 assert.equal(stateNow({id:'google:a@b.c',kind:'google',state:'connected'},{signinNeeded:()=>({why:'x'})}).state,'connected')});

test('rows: Needs sign-in when the engine says so for any agent that uses it, the same rule as Bottlenecks',()=>{
 const acc={mcp:{items:[{kind:'mcp',id:'higgsfield',owner:'default',users:[{id:'default',name:'aqeelOS',signed:true},{id:'pepclub-social',name:'Pepclub Social',signed:true}]},
  {kind:'mcp',id:'n8n',detail:'https://n8n.example/mcp',owner:'default',users:[{id:'default',name:'aqeelOS',signed:true},{id:'sesa',name:'Sesa',signed:true}],ownerSigned:true}]}};
 const accounts=[{id:'mcp:higgsfield',kind:'mcp-oauth',mcp:'higgsfield',name:'Higgsfield · Abel',state:'connected',agents:[{id:'default',name:'aqeelOS'}],canBy:{}}];
 const base={agents:[{id:'default'},{id:'pepclub-social'},{id:'sesa'}],acc,accounts,names};
 let rows=buildRows(base);assert.equal(rows.find(r=>r.key==='ca:mcp:higgsfield').status,'connected');assert.equal(rows.find(r=>r.key==='mcp:n8n').status,'connected');
 // the engine: Higgsfield ran out on Pepclub Social (it uses the login), n8n not signed in on Sesa, and a name nobody here has
 const signins=[{agent:'pepclub-social',name:'higgsfield',why:'the sign-in ran out'},{agent:'sesa',name:'n8n',why:'not signed in'},{agent:'default',name:'slack-old',why:'not signed in'}];
 rows=buildRows({...base,signins});const h=rows.find(r=>r.key==='ca:mcp:higgsfield'),n=rows.find(r=>r.key==='mcp:n8n');
 assert.equal(h.status,'signin');assert.match(h.why,/Pepclub Social: the sign-in ran out/);assert.deepEqual(h.users.map(u=>[u.id,u.signed]),[['default',true],['pepclub-social',false]]);
 assert.equal(n.status,'signin');assert.match(n.why,/Sesa: not signed in/);assert.deepEqual(n.users.map(u=>u.signed),[true,false]);
 // Needs you comes first, and a paused login stays paused whatever the engine says
 assert.equal(rows[0].status,'signin');
 rows=buildRows({...base,accounts:[{...accounts[0],state:'paused'}],signins});assert.equal(rows.find(r=>r.key==='ca:mcp:higgsfield').status,'paused');
 assert.deepEqual([...dueOf(signins,'higgsfield')],[['pepclub-social','the sign-in ran out']]);assert.equal(dueOf(signins,'').size,0)});

// a store whose answers change under it: the gathered list is kept, the statuses are not
function stubs(){const st={state:'connected',why:'',accFresh:0,accLists:[],gathers:0,signins:[],slow:0};
 const access={list:async k=>{if(k==='mcp')st.gathers++;if(st.slow)await new Promise(r=>setTimeout(r,st.slow));return k==='mcp'?{items:[{kind:'mcp',id:'notion-abel',owner:'default',users:[{id:'default',name:'aqeelOS',signed:true}]}]}:{items:[]}},fresh:()=>st.accFresh++};
 const accounts={list:async(o={})=>{st.accLists.push(!!o.fresh);return {items:[{id:'mcp:notion-abel',kind:'mcp-oauth',mcp:'notion-abel',name:'Notion · Abel',state:st.listState||'connected',why:'',agents:[{id:'default',name:'aqeelOS'}],canBy:{}}]}},
  states:async()=>({'mcp:notion-abel':{state:st.state,why:st.why}})};
 return {st,access,accounts}}

test('a kept list shows every status as it is now; Check now gets past every kept list',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'cxst-'));const {st,access,accounts}=stubs();let rechecks=0;
 const cn=createConnections({DATA,access,accounts,listAgents:async()=>['default'],names,engine:async()=>({ok:true,j:[]}),signins:async()=>st.signins,recheck:()=>rechecks++});
 const row=l=>l.rows.find(r=>r.key==='ca:mcp:notion-abel');
 let l=await cn.list({admin:true});assert.equal(row(l).status,'connected');assert.equal(st.gathers,1);assert.ok(l.at>0);assert.equal(l.stale,false);
 // kept on disk too, for after a restart
 assert.equal(JSON.parse(await readFile(path.join(DATA,'connections-cache.json'),'utf8')).at,l.at);
 // the engine finds the sign-in ran out: the next look says so at once, from the kept list (no new gather)
 st.signins=[{agent:'default',name:'notion-abel',why:'the sign-in ran out'}];l=await cn.list({admin:true});
 assert.equal(st.gathers,1);assert.equal(row(l).status,'signin');assert.match(row(l).why,/aqeelOS: the sign-in ran out/);
 // signed in again (the engine's entry went), and the login's own check found it signed out: that shows too
 st.signins=[];st.state='signed-out';st.why='Slack says: token revoked';l=await cn.list({admin:true});assert.equal(row(l).status,'signin');assert.equal(row(l).why,'Slack says: token revoked');
 st.state='connected';st.why='';assert.equal(row(await cn.list({admin:true})).status,'connected');assert.equal(st.gathers,1);assert.deepEqual(st.accLists,[false]);
 // Check now: Access's kept settings dropped, every login scanned and checked again, a new gather, the engine asked to test again
 l=await cn.list({admin:true},{check:true});assert.equal(st.gathers,2);assert.equal(st.accFresh,1);assert.deepEqual(st.accLists,[false,true]);assert.equal(rechecks,1);
 // a change (?fresh=1) gathers again but leaves the logins' own checks to their clock
 await cn.list({admin:true},{fresh:true});assert.equal(st.gathers,3);assert.deepEqual(st.accLists,[false,true,false]);assert.equal(rechecks,1);
 // a member: no logins as you, so no Check now of them either
 await cn.list({admin:false,level:()=>'owner'},{check:true});assert.equal(rechecks,1)});

test('Check now never settles for a gather that began before it',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'cxst-'));const {st,access,accounts}=stubs();
 const cn=createConnections({DATA,access,accounts,listAgents:async()=>['default'],names,engine:async()=>({ok:true,j:[]})});
 await cn.list({admin:true});
 // the kept list is old: the next look answers at once and gathers a new one behind (slowly)
 const f=path.join(DATA,'connections-cache.json');const c=JSON.parse(await readFile(f,'utf8'));
 const cn2=createConnections({DATA,access,accounts,listAgents:async()=>['default'],names,engine:async()=>({ok:true,j:[]})});
 await writeFile(f,JSON.stringify({...c,at:Date.now()-60e3}));st.slow=150;st.listState='signed-out';
 const old=await cn2.list({admin:true});assert.equal(old.stale,true);assert.equal(st.gathers,2);   // instant, with a gather behind
 // Check now while that one runs: its own, deeper gather (logins checked again), not the one already under way
 const now=await cn2.list({admin:true},{check:true});assert.equal(st.gathers,3);assert.deepEqual(st.accLists.slice(-2),[false,true]);assert.ok(now.at>old.at);assert.equal(now.stale,false)});

test('connected-accounts: the engine’s sign-in needed is never stored, and an old stored one is checked again',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cxca-')),H=path.join(root,'.hermes'),DATA=path.join(root,'data');await mkdir(path.join(H,'mcp-tokens'),{recursive:true});await mkdir(DATA,{recursive:true});
 const cfg={default:{mcp_servers:{'notion-abel':{url:'https://mcp.notion.com/mcp',auth:'oauth'}}}};
 await writeFile(path.join(H,'mcp-tokens','notion-abel.json'),JSON.stringify({access_token:'a',refresh_token:'r',expires_at:Date.now()/1000+3600}));
 // stored before this change: the engine's sign-in needed kept as the state, checked 1 min ago (so not again for 29 min)
 await writeFile(path.join(DATA,'connected-accounts.json'),JSON.stringify({seeded:true,scanAt:0,actionsAt:Date.now(),accounts:{'mcp:notion-abel':{id:'mcp:notion-abel',kind:'mcp-oauth',provider:'notion',mcp:'notion-abel',
  agents:['default'],registered:true,can:['read','edit','draft','send'],state:'signed-out',why:SIGNIN_AGAIN,checkedAt:Date.now()-60e3}}}));
 let due=null;const ca=createConnectedAccounts({DATA,HERMES_HOME:H,WORK:root,listAgents:async()=>['default'],readConfig:async a=>structuredClone(cfg[a]),setKey:async()=>({ok:true}),dash:async()=>({ok:true,status:200,j:{}}),
  active:false,STEP:20,signinNeeded:(a,n)=>a==='default'&&n==='notion-abel'?due:null});
 const one=async o=>(await ca.list(o)).items.find(x=>x.id==='mcp:notion-abel');
 assert.equal((await one()).state,'connected');   // no fresh check needed: the old stored one is dropped on load
 due={why:'the sign-in ran out'};assert.equal((await one()).state,'signed-out');assert.equal((await ca.states())['mcp:notion-abel'].state,'signed-out');
 assert.equal((await ca._db()).accounts['mcp:notion-abel'].state,'connected');   // what is stored is the sign-in's own check
 due=null;assert.equal((await one()).state,'connected')});
