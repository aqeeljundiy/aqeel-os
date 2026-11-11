// node --test scripts/abilities-ui.test.mjs — two Abilities screens built from their job (12 Nov 2026):
//   Tool groups on all agents: no column per agent any more (owner: "what if we have 30+ agents"); one row per group or
//   per agent, a count and at most six faces, a side panel with every switch, changes kept until Apply;
//   Apps: the catalog is a page of its own again, reachable from the Abilities menu and from Connections.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function world(){const ctx={S:{tab:{},me:{admin:true},identities:{},profile:'default'},Pages:{},ACT:{},PAGES:{},ALLVIEW:{},ALL_PAGES:new Set(),esc,icon:n=>'<i data-ic="'+n+'"></i>',plural:(n,w)=>n+' '+w+(n===1?'':'s'),st:()=>'',pretty:s=>String(s),
  ident:a=>({name:ctx.S.identities[a]?.name||a}),mayEdit:()=>true,TS_UNSAFE:['terminal','file','code_execution','computer_use'],tsName:t=>t.label||t.name,tsInfo:t=>({ic:'layers',say:t.description||'',risk:t.risk||''}),
  tsHead:t=>'<b>'+esc(t.label||t.name)+'</b>'+(t.risk?'<span class="ts-risk">'+esc(t.risk)+'</span>':''),tsLock:w=>'<span class="tsg-lock">'+esc(w)+'</span>',tsLocks:async()=>({}),
  Access:{av:a=>'<span class="acc-av" data-a="'+esc(a.id)+'"></span>'},agentAvatar:()=>'<span class="ava"></span>',toggle:(on,l,attrs='')=>'<input type="checkbox" class="switch" '+(on?'checked':'')+' '+attrs+'>',
  emptyBox:a=>'<div class="empty">'+a+'</div>',$:()=>null,$$:()=>[],toast:()=>{},fail:()=>{},tabs:(k,l)=>'<div data-tabs="'+k+'">'+l.join('|')+'</div>',CSS:{escape:s=>s},logoImg:(d,l)=>'<span class="logo">'+esc(l)+'</span>',mcpDomain:m=>m.name+'.com',
  SECTIONS:[{id:'abilities',pages:[{id:'skills'},{id:'connections'},{id:'mcp',hidden:true},{id:'plugins'}]}],route:()=>({page:{id:'apps'}}),
  cxName:r=>r.name,cxLogo:()=>'<span class="logo"></span>',cxUsing:r=>r.users.filter(u=>u.level!=='off'),cxNeeds:r=>r.status==='signin',Cx:{},console};
 vm.createContext(ctx);return ctx}

// ---- Tool groups
const W=world();vm.runInContext(src('all-agents-more.js')+';this.TS=TS;this.TSP=TSP;',W);const {TS,TSP}=W;
const AG=Array.from({length:50},(_,i)=>'agent-'+String(i+1).padStart(2,'0'));
const mk=(name,on,extra={})=>({name,label:name[0].toUpperCase()+name.slice(1),description:'Does '+name,on:[...on],all:[...AG],...extra});
function load(n=40){const g={browser:mk('browser',AG.slice(0,41),{risk:'Acts on websites with the sign-ins it has: it can submit forms, post and buy.'}),terminal:mk('terminal',AG.slice(0,3),{risk:'Can change or delete anything.'})};
 for(let i=0;Object.keys(g).length<n;i++)g['group'+i]=mk('group'+i,AG.filter((_,k)=>(k+i)%3));W.Pages._tsAll=g;W.Pages._tsAgs=[...AG];W.Pages._tsLk2={'agent-05':'Locked by an admin'};TSP.clear()}

test('the grid with one column per agent is gone',()=>{const s=src('all-agents-more.js');
 for(const old of ['tsGrid','tsCell','<table class="tsg"','class="tsg-a"'])assert.ok(!s.includes(old),old+' is still there');
 assert.ok(!/<th[^>]*>\$\{[^}]*ags\.map/.test(s)&&!/ags\.map\(a=>`<t[hd]/.test(s),'no table cell per agent');
 // and nowhere else on the pages: no table that makes a column per agent
 for(const f of readFileSync(new URL('../app/index.html',import.meta.url),'utf8').matchAll(/src="\/app\/([\w.-]+\.js)"/g))assert.ok(!/(agents|ags)\.map\([a-z]+=>`<th/.test(src(f[1])),f[1]+' has a column per agent')});
test('a tool group row: a count and at most six faces however many agents, the warning stays visible',()=>{load();
 const h=TS.rowG(W.Pages._tsAll.browser,0);assert.match(h,/On for <b>41<\/b> of 50 agents/);assert.equal((h.match(/class="acc-av"/g)||[]).length,6);assert.match(h,/\+35/);
 assert.match(h,/Acts on websites with the sign-ins it has/);assert.equal((h.match(/data-act="tsg-open"/g)||[]).length,1,'one control');assert.ok(!h.includes('class="switch"'),'no switch per agent in the row');
 assert.ok(h.length<2600,'a row stays small: '+h.length);
 const off=TS.rowG(mk('quiet',[]),0);assert.match(off,/Off for all 50 agents/);assert.ok(!off.includes('acc-who'))});
test('an agent row: how many of its groups are on, the powerful ones by name',()=>{load();
 const h=TS.rowA('agent-01',0);assert.match(h,/of 40 tool groups on/);assert.match(h,/Powerful ones on: Browser, Terminal/);assert.equal((h.match(/data-act="tsg-open"/g)||[]).length,1);
 assert.ok(!/Powerful ones on[^<]*Terminal/.test(TS.rowA('agent-20',0)),'agent 20 has no terminal')});
test('switches only mark a change; back where it was is no change; locked and missing ones cannot be switched',()=>{load();
 TS.set('agent-50','browser',true);TS.set('agent-01','browser',false);assert.equal(TSP.size,2);assert.match(TS.rowG(W.Pages._tsAll.browser,0),/On for <b>41<\/b> of 50/);   // one on, one off
 assert.match(TS.rowG(W.Pages._tsAll.browser,0),/tsr-dot/);assert.match(TS.rowA('agent-50',0),/tsr-dot/);
 TS.set('agent-50','browser',false);assert.equal(TSP.size,1,'put back = not a change');
 TS.set('agent-05','terminal',true);assert.equal(TSP.size,1,'locked to safe tools');assert.equal(TS.can(W.Pages._tsAll.terminal,'agent-05'),'lock');assert.equal(TS.can(W.Pages._tsAll.browser,'agent-05'),'ok');
 W.Pages._tsAll.browser.all=AG.slice(0,49);TS.set('agent-50','browser',true);assert.equal(TSP.size,1,'the agent has no such group');assert.equal(TS.can(W.Pages._tsAll.browser,'agent-50'),'na')});
test('the side panel lists every agent (or every group) with a switch each, 60 at a time, and searches',()=>{load();
 TS.cur={kind:'group',id:'browser',q:'',shown:60};assert.equal(TS.pairs().length,50);const l=TS.line(TS.pairs()[0]);assert.match(l,/data-act="tsg" data-agent="agent-01" data-name="browser"/);assert.match(l,/checked/);
 TS.cur.q='agent-4';assert.equal(TS.pairs().length,10);
 TS.cur={kind:'agent',id:'agent-05',q:'',shown:60};assert.equal(TS.pairs().length,40);assert.match(TS.line(TS.pairs().find(p=>p[1].name==='terminal')),/tsg-lock/);
 assert.match(TS.line(TS.pairs().find(p=>p[1].name==='browser')),/Acts on websites/,'the warning is in the panel too');
 TS.cur.q='term';assert.equal(TS.pairs().length,1);
 const s=src('all-agents-more.js');assert.match(s,/Turn all on/);assert.match(s,/Turn all off/);assert.match(s,/Discard/);assert.match(s,/Apply \(restarts agents once\)/);assert.match(s,/'By tool group','By agent'/);
 assert.match(s,/all\.slice\(0,this\.shown\)/,'the list draws a part at a time');assert.match(s,/Math\.min\(8,list\.length\)/,'agents are asked eight at a time')});
test('fast with 50 agents and 40 groups: both lists and a panel build in well under a frame budget each',()=>{load();
 const t0=performance.now();for(let k=0;k<20;k++){TS.groups().map((t,i)=>TS.rowG(t,i));TS.ags().map((a,i)=>TS.rowA(a,i));TS.cur={kind:'group',id:'browser',q:'',shown:60};TS.pairs().map(p=>TS.line(p))}
 const ms=(performance.now()-t0)/20;assert.ok(ms<60,'one full build took '+ms.toFixed(1)+' ms')});

// ---- Apps
const A=world();A.Pages._cx={rows:[
 {key:'mcp:notion',type:'app',kind:'mcp',id:'notion',name:'Notion',what:'An app at mcp.notion.com',status:'connected',users:[{id:'default',level:'full'},{id:'sesa',level:'read'},{id:'x',level:'off'}]},
 {key:'mcp:slack-2',type:'app',kind:'mcp',id:'slack-2',name:'Slack 2',what:'An app at mcp.slack.com',status:'signin',users:[{id:'sesa',level:'full'}]},
 {key:'mcp:my-crm',type:'app',kind:'mcp',id:'my-crm',name:'My CRM',what:'An app at crm.example.com',status:'connected',users:[{id:'default',level:'full'}]},
 {key:'skill:docx',type:'skill',kind:'skill',id:'docx',name:'Word',users:[]}]};
vm.runInContext(src('apps-page.js')+';this.Apps=Apps;this.apCat=apCat;',A);
const CAT=[{name:'slack',description:'Team chat',url:'https://mcp.slack.com/mcp',auth_type:'oauth'},{name:'notion',description:'Notes and docs',url:'https://mcp.notion.com/mcp',auth_type:'oauth'},{name:'github',description:'Code hosting',command:'npx',required_env:['GITHUB_TOKEN']},{name:'airtable',description:'Tables',url:'https://mcp.airtable.com/mcp'}];
test('Apps is a page under Abilities, right after Connections, and loads after it',()=>{
 const p=A.SECTIONS[0].pages.map(x=>x.id);assert.deepEqual(p.slice(0,3),['skills','connections','apps']);assert.equal(A.SECTIONS[0].pages[2].label,'Apps');assert.equal(typeof A.PAGES.apps,'function');
 const html=readFileSync(new URL('../app/index.html',import.meta.url),'utf8'),at=f=>html.indexOf('/app/'+f);assert.ok(at('apps-page.js')>at('connections.js')&&at('apps-page.js')<at('boot.js'));
 assert.match(src('icons.js'),/\n grid:'/,'its icon exists');
 // reachable: the Abilities menu for members who may use apps, a button and the Add menu on Connections, the catalog dialog
 assert.match(src('people.js'),/pg\('abilities','apps'\)/);const cn=src('connections.js');assert.ok((cn.match(/Browse all apps/g)||[]).length>=3);assert.match(cn,/data-to="\/abilities\/apps"/)});
test('each app says what it does, whether it is connected and for which agents; connected ones come first',()=>{
 const l=A.Apps.build(CAT,A.Pages._cx);assert.deepEqual(l.map(a=>[a.title,a.on,a.users.length,a.need]),[['My CRM',true,1,false],['notion',true,2,false],['slack',true,1,true],['airtable',false,0,false],['github',false,0,false]]);
 assert.equal(l[0].custom,true,'an app added by its address is listed too');assert.equal(l[0].cat,'Added by its address');assert.ok(!l.some(a=>a.title==='Word'),'only apps');
 const on=A.Apps.card(l[1],0),off=A.Apps.card(l[4],0),need=A.Apps.card(l[2],0);
 assert.match(on,/Connected/);assert.equal((on.match(/class="acc-av"/g)||[]).length,2);assert.match(on,/data-act="ap-manage" data-key="mcp:notion"/);assert.match(on,/Notes and docs/);
 assert.ok(!/chip ok/.test(off),'not shown as connected');assert.match(off,/data-act="ap-connect" data-name="github"/);assert.match(off,/Needs a key/);assert.match(need,/Needs sign-in/);assert.match(need,/>Sign in</);
 for(const c of [on,off,need])assert.equal((c.match(/<button/g)||[]).length,1,'one button per app')});
test('search and the filters: Connected, and a kind per app',()=>{A.Apps.list=A.Apps.build(CAT,A.Pages._cx);const pick=()=>A.Apps.list.filter(a=>A.Apps.match(a)).map(a=>a.title);
 A.S.tab.apps='Connected';assert.deepEqual(pick(),['My CRM','notion','slack']);A.S.tab.apps='All';A.S.apQ='code';assert.deepEqual(pick(),['github']);A.S.apQ='sesa';assert.deepEqual(pick(),['notion','slack'],'by agent name');A.S.apQ='';
 assert.equal(A.apCat('slack'),'Messages and meetings');assert.equal(A.apCat('algolia'),'Data and analytics');assert.equal(A.apCat('github'),'Code and servers');assert.equal(A.apCat('zzz'),'Other');A.S.tab.apps='Code and servers';assert.deepEqual(pick(),['github'])});
test('Connect starts the same add as Connections (one function), and Manage opens the app in Connections',()=>{
 const ap=src('apps-page.js'),cn=src('connections.js');assert.match(ap,/await Cx\.addApp\(m,ag,env\)/);assert.match(cn,/Cx\.addApp=async function/);assert.match(cn,/const r=await Cx\.addApp\(m,ag,env\)/,'the Add dialog uses it too');
 assert.match(ap,/Cx\.openKey=a\.dataset\.key/);assert.match(cn,/if\(Cx\.openKey\)/);
 // the old address of Connected apps still lands on Connections
 assert.match(cn,/'abilities\/mcp':\['abilities','connections','Apps'\]/)});
