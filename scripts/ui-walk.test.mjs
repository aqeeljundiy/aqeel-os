// node --test scripts/ui-walk.test.mjs — what the UI walk of 12 Nov 2026 (audit part 5) fixed, kept by rules that need no browser.
// The rest is checked in a browser: scripts/sweep.js and scripts/flicker-ci.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createAgentGraph} from '../app/agent-graph.mjs';
import {createAgentAdspower} from '../app/agent-adspower.mjs';
const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
// one function out of a browser script, by name, up to the next top-level "function " line
const fn=(file,name)=>{const s=src(file),i=s.indexOf('function '+name+'(');assert.ok(i>=0,name+' in '+file);const j=s.indexOf('\nfunction ',i+1);return s.slice(i,j<0?undefined:j)};

// a tiny element tree, enough for the helpers below
class El{constructor(tag,attrs={},kids=[]){this.tagName=tag.toUpperCase();this.attrs={...attrs};this.children=kids;this.id=attrs.id||'';this.tabIndex=0;kids.forEach(k=>k.parentElement=this);this.classList={contains:c=>(this.attrs.class||'').split(' ').includes(c)}}
 setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]??null}
 get nextElementSibling(){const p=this.parentElement;return p?p.children[p.children.indexOf(this)+1]||null:null}
 set htmlFor(v){this.attrs.for=v}get htmlFor(){return this.attrs.for}
 matches(sel){return sel.split(',').some(s=>{s=s.trim();const tag=s.match(/^[a-z]+/i)?.[0];if(tag&&tag.toUpperCase()!==this.tagName)return false;
  const nots=[...s.matchAll(/:not\(\[type=(\w+)\]\)/g)].map(m=>m[1]);if(nots.includes(this.attrs.type))return false;
  const cls=[...s.matchAll(/\.([\w-]+)/g)].map(m=>m[1]);return cls.every(c=>this.classList.contains(c))})}
 all(){return this.children.flatMap(k=>[k,...k.all()])}
 querySelector(sel){return this.all().find(e=>e.matches(sel))||null}
 querySelectorAll(sel){const m=/^label:not\(\[for\]\)$/.test(sel);return this.all().filter(e=>m?e.tagName==='LABEL'&&!e.attrs.for:e.matches(sel))}}

test('tabs say they are tabs: tablist, tab, which one is chosen, one Tab stop', ()=>{
 const ctx={};vm.runInNewContext(fn('core.js','ariaTabs'),ctx);
 const a=new El('button',{class:''}),b=new El('button',{class:'on'}),pill=new El('span',{class:'pill'}),t=new El('div',{class:'tabs'},[a,b,pill]);
 ctx.ariaTabs(t);
 assert.equal(t.getAttribute('role'),'tablist');
 assert.deepEqual([a,b].map(x=>[x.getAttribute('role'),x.getAttribute('aria-selected'),x.tabIndex]),[['tab','false',-1],['tab','true',0]]);
 assert.equal(pill.getAttribute('role'),null,'the sliding pill is not a tab');
 assert.match(fn('core.js','placePills'),/ariaTabs\(t\)/,'every tab row gets them each time tabs are drawn or changed');
 assert.match(src('boot.js'),/\.tabs>\[role=tab\]'\)&&\['ArrowLeft','ArrowRight','Home','End'\]/,'the arrow keys move between tabs');
});

test('a label written above its field names that field', ()=>{
 const ctx={Math};vm.runInNewContext(fn('core.js','linkLabels'),ctx);
 const l1=new El('label'),i1=new El('input',{id:'idName'}),l2=new El('label'),hint=new El('p',{class:'hint'}),ta=new El('textarea'),l3=new El('label'),sw=new El('input',{type:'checkbox'}),root=new El('div',{},[l1,i1,l2,hint,ta,l3,sw]);
 ctx.linkLabels(root);
 assert.equal(l1.htmlFor,'idName');
 assert.ok(ta.id&&l2.htmlFor===ta.id,'over a hint too, and a field without an id gets one');
 assert.equal(l3.htmlFor,undefined,'a switch is not given a label this way');
 assert.match(fn('core.js','drawer'),/linkLabels\(d\)/);
});

test('a drawer is a modal dialog and takes the focus even without a field', ()=>{
 const d=fn('core.js','drawer');
 assert.match(d,/aria-modal','true'/);
 assert.match(d,/drawer-head \[data-act=close\]'\)\?\.focus/,'no field: the close button gets the focus, so Tab stays inside');
});

test('Skip to content is the first thing a keyboard reaches', ()=>{
 assert.match(src('core.js'),/<div class="app"><button type="button" class="skip-link" data-act="skip">Skip to content<\/button><aside class="side"/);
 assert.match(src('boot.js'),/ACT\.skip=/);
 assert.match(src('app.css'),/\.skip-link:focus-visible\{transform:none;opacity:1\}/);
});

test('the screen switch is a toggle group, not tabs without tabs', ()=>{
 const s=src('screen.js');assert.ok(!/scr-seg" role="tablist"/.test(s));assert.match(s,/scr-seg" role="group"/);assert.equal((s.match(/aria-pressed="\$\{this\.src_==='/g)||[]).length,2);
});

test('members: the tool menu does not send people to pages they do not have', ()=>{
 const c=src('chat.js');
 assert.match(c,/denied:no===2/);
 assert.match(c,/Its tools are chosen by whoever manages it/);
 assert.match(c,/\.\.\.\(canManage\?\['-',\{label:'Manage tools…'/);
 assert.match(src('bottlenecks.js'),/S\.me\?\.admin!==false\?' and shows on System › Health':''/);
});

test('Health: the agents\' map view works when skip answers at once (a test copy)', async ()=>{
 const tmp=mkdtempSync(path.join(tmpdir(),'aq-graph-'));
 try{const g=createAgentGraph({HERMES_HOME:tmp,DATA:tmp,home0:tmp,agents:async()=>['a'],skip:()=>false,log:()=>{}});
  await assert.doesNotReject(g.view())}finally{rmSync(tmp,{recursive:true,force:true})}
 assert.match(readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8'),/skip:async a=>LIVE_APP\?isTestAgent\(a\):false/);
});

test('AdsPower: asking about an agent without it is "none", not a 404', async ()=>{
 const tmp=mkdtempSync(path.join(tmpdir(),'aq-ads-'));
 try{const ads=createAgentAdspower({DATA:tmp,HERMES_HOME:tmp,screens:{},agentNames:async()=>['sela'],wanted:async()=>false,log:()=>{}});
  const got=[];const send=(res,code,body)=>got.push([code,body]);
  await ads.handle({method:'GET'},{},'/ui/screens/sela/adspower',send,{admin:true});
  await ads.handle({method:'POST'},{},'/ui/screens/sela/adspower/start',send,{admin:true});
  assert.deepEqual(got[0],[200,{state:'none'}]);
  assert.equal(got[1][0],404,'starting it is still refused')}finally{rmSync(tmp,{recursive:true,force:true})}
});

test('an agent card is not a button with buttons inside: its Chat is the button', ()=>{
 const p=src('people.js');
 assert.ok(!/data-act="agent-card" tabindex="0" role="button"/.test(p),'the card itself is no longer role=button');
 assert.match(p,/<button type="button" class="agent-go" data-act="agent-card-go" aria-label="Chat with \$\{esc\(id\.name\)\}">/);
 assert.match(p,/ACT\['agent-card-go'\]=/);
 assert.ok(!/\.ag-list \.agent-foot>\.agent-go\{display:none\}/.test(src('app.css')),'in the list it is out of sight, still reachable by keyboard');
});
