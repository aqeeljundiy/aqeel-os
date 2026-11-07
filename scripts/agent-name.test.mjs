// Agents by their display names everywhere (owner, 7 Nov 2026: "use the formal names not this"): never a profile id,
// never "aqeelOS" for the main agent, and no picker or menu that shows a raw id as its label.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {agentNameFrom,prettyId} from '../app/agent-name.mjs';

const NAMES={default:'Dora AI','bay-sales':'Bay Sales',sela:'Sela AI'};
test('the server names an agent by its display name, the main one never "aqeelOS", extra numbers say which',()=>{const n=agentNameFrom(NAMES);
 assert.equal(n('bay-sales'),'Bay Sales');assert.equal(n('default'),'Dora AI');assert.equal(n('aqeelOS'),'Dora AI');
 assert.equal(n('default--whatsapp-2'),'Dora AI · WhatsApp 2');assert.equal(n('cove-threads'),'Cove threads','no name yet: words, not an id');
 const empty=agentNameFrom({});assert.equal(empty('default'),'Main agent');assert.equal(empty(''),'');assert.equal(prettyId('pine_agent'),'Pine agent')});

test('the browser does the same (core.js agentLabel and ident)',()=>{const src=readFileSync(new URL('../app/core.js',import.meta.url),'utf8');
 const pick=name=>{const i=src.indexOf(name);assert.ok(i>=0,name);let d=0,j=src.indexOf('{',i);for(let k=j;k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'&&--d===0)return src.slice(i,k+1)}};
 const ctx={S:{identities:{default:{name:'Dora AI'},'bay-sales':{name:'Bay Sales'}},profile:'default'},EMOJI:[],emojiAuto:()=>'',encodeURIComponent};
 vm.createContext(ctx);vm.runInContext('const prettyId='+/const prettyId=([^\n]+);/.exec(src)[1]+';\n'+pick('function agentLabel')+'\n'+pick('function ident(')+'\nthis.agentLabel=agentLabel;this.ident=ident;',ctx);
 assert.equal(ctx.agentLabel('bay-sales'),'Bay Sales');assert.equal(ctx.agentLabel('aqeelOS'),'Dora AI');assert.equal(ctx.agentLabel('default--whatsapp-2'),'Dora AI · WhatsApp 2');
 assert.equal(ctx.ident('cove-support').name,'Cove support','an agent with no name yet shows words, not its id');ctx.S.identities={};assert.equal(ctx.ident('default').name,'Main agent')});

// every list people pick from: an option or menu item whose label is the same bare value as its id is a raw id
const files=readdirSync(new URL('../app/',import.meta.url)).filter(f=>f.endsWith('.js'));
const OK=new Set([   // lists whose values are words people chose, not agent ids (file|value)
 'boards.js|t.id','kirimdev-page.js|n']);
test('no picker shows a raw profile id as its label',()=>{const bad=[];
 for(const f of files){const s=readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
  for(const m of s.matchAll(/<option value="\$\{esc\(([\w.]+)\)\}"[^>]*>\$\{esc\(([\w.]+)\)\}<\/option>/g))if(m[1]===m[2]&&!OK.has(f+'|'+m[1]))bad.push(f+': <option> labelled with its value '+m[1]);
  for(const m of s.matchAll(/\(\s*(\w+)\s*=>\s*\(\{\s*label:\s*(\w+)\s*[,}]/g))if(m[1]===m[2]&&!OK.has(f+'|'+m[1]))bad.push(f+': menu item labelled with its value '+m[1]);
  for(const m of s.matchAll(/'default'\?'aqeelOS'/g))bad.push(f+': the main agent shown as "aqeelOS"')}
 assert.deepEqual(bad,[])});
test('no server text names the main agent "aqeelOS" or falls back to a raw id',()=>{const s=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(s,/NAMES\[a\]\|\|\(a==='default'\?'aqeelOS'/);assert.doesNotMatch(s,/'default'\?'aqeelOS'/)});
