// One Escape for every overlay, a member's Files agent picker, and corners that come from the radius tokens (no browser needed).
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
const escTop=new Function(/const escEl=[^\n]*\nconst escTop=[^\n]*/.exec(src('core.js'))[0]+';return escTop')();
const L=(name,o={})=>({name,el:{isConnected:true},...o});

test('Escape goes to the top-most open layer only, skipping layers that are gone or not active',()=>{
 const a=L('a'),b=L('b'),c=L('c',{el:{isConnected:false}}),d=L('d',{when:()=>false});
 assert.equal(escTop([a,b,c,d],null).name,'b','the newest live, active one');
 assert.equal(escTop([a],null).name,'a');assert.equal(escTop([],null),null);assert.equal(escTop([c,d],null),null);
});
test('a drawer, menu or palette opened above a layer keeps its own Escape (the layer does nothing)',()=>{
 const a=L('a'),b=L('b');assert.equal(escTop([a,b],l=>l===b),null,'something sits above the top layer: nothing closes here');
 assert.equal(escTop([a,b],l=>false).name,'b');
});
test('the screen view, file preview, usage card and plugin dialogs all close through the one helper, with focus back on the opener',()=>{
 const core=src('core.js');assert.match(core,/document\.addEventListener\('keydown',e=>\{if\(e\.key!=='Escape'/);assert.match(core,/e\.stopImmediatePropagation\(\)/);assert.match(core,/back\.focus\(/);
 assert.match(src('screen.js'),/escLayer\(\{el:\(\)=>Screen\.mode==='float'/);assert.match(src('screen.js'),/toggle\(\)\{if\(!this\.open\)\{const a=document\.activeElement/);
 for(const f of ['files.js','people.js','plugin-host.js'])assert.match(src(f),/escLayer\(/,f);
 assert.doesNotMatch(src('files.js'),/key==='Escape'/,'the preview no longer has its own Escape');
 assert.doesNotMatch(src('plugin-host.js'),/key==='Escape'/);assert.doesNotMatch(src('people.js'),/addEventListener\('keydown',e=>\{if\(e\.key==='Escape'\)document/);
});
test('a member with several agents gets the Files agent picker and keeps their folder when they pick another',()=>{
 const f=src('files.js');assert.match(f,/PAGES\.files=async\(p,el\)=>\{const stale=pageTok\(el\);viewPick\(await viewAgents\(\)\)/);
 assert.match(f,/S\.me\?\.admin!==false\|\|!S\.filePath/);
 const v=src('schedules.js');assert.match(v,/if\(S\.me&&S\.me\.admin===false\)l=l\.filter\(a=>S\.me\.agents\?\.\[a\]\)/,'only agents the person may open');
 assert.match(src('all-agents.js'),/search:list\.length>6/);
});
test('corners come from the radius tokens: no hand-written size of 5px or more, no variable the app never defines',()=>{
 const bad=[];for(const f of readdirSync(new URL('../app/',import.meta.url)).filter(x=>/\.(css|js)$/.test(x)&&!/^lang-id/.test(x))){
  const s=src(f);for(const m of s.matchAll(/border-radius:\s*([^;}"'`]*)/g)){if(/(^|[^\d.])([5-9]|\d\d+)(\.\d+)?px/.test(m[1]))bad.push(f+': '+m[0])}
  if(/var\(--radius(-sm|-lg)?\)/.test(s)&&f==='app.css')bad.push(f+': var(--radius…) is only defined inside .plug-host')}
 assert.deepEqual(bad,[]);
});

// Review of 12 Nov 2026: the tests above read the source; none of them pressed Escape. escLayer's own "EscLayers.push(l)" sat behind a comment on the
// same line, so no layer was ever registered and Escape closed nothing (the preview, the usage card and the plugin dialogs had given up their own
// handlers for this one). This runs the real helper and the real key handler against a small stand-in for the page.
test('pressing Escape really closes the top-most registered layer, once, and gives focus back; a layer that was taken off is left alone',async()=>{
 const core=src('core.js'),a=core.indexOf('const EscLayers=[]'),b=core.indexOf('},true);',a);assert.ok(a>0&&b>a,'the helper is where it was');
 let onKey=null,focused=0;const page={activeElement:null,body:{},querySelectorAll:()=>[],addEventListener:(t,h)=>{if(t==='keydown')onKey=h}};
 const {escLayer,EscLayers}=new Function('document','Node',core.slice(a,b+8)+';return {escLayer,EscLayers}')(page,{DOCUMENT_POSITION_FOLLOWING:4});
 const el=()=>({isConnected:true,compareDocumentPosition:()=>0,contains:()=>false}),opener={isConnected:true,focus:()=>{focused++}};
 const press=()=>{const e={key:'Escape',prevented:0,stopped:0,preventDefault(){this.prevented++},stopImmediatePropagation(){this.stopped++}};onKey(e);return e};
 const closed=[];const offA=escLayer({el:el(),back:opener,close:()=>closed.push('a')}),offB=escLayer({el:el(),back:opener,close:()=>{closed.push('b');offB()}});
 assert.equal(EscLayers.length,2,'a registered layer is kept');
 const e=press();assert.deepEqual(closed,['b'],'the top-most one closes, nothing under it');assert.equal(e.prevented,1);assert.equal(e.stopped,1);
 await new Promise(r=>setTimeout(r,5));assert.equal(focused,1,'focus goes back to the opener');
 press();assert.deepEqual(closed,['b','a']);offA();assert.equal(EscLayers.length,0);
 const none=press();assert.deepEqual(closed,['b','a'],'no layer left: nothing closes');assert.equal(none.prevented,0,'and the key is left for the page')});
