import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {parse,source,tableMd,headings,toHtml} from './md-lite.mjs';
import {slideBlock,itemCss,cropCss,ratioOf,deckDocument,iconSvg} from './deck-render.js';
globalThis.document??={addEventListener(){}};globalThis.addEventListener??=()=>{};
const {parseCsv,toCsv,evaluate,colName}=await import('./data-ui.js');
const {Workspace}=await import('./workspace.mjs');

test('documents: image and contents blocks round-trip, tables rebuild safely',()=>{
 const md='# Report\n\n[TOC]\n\nIntro\n![Chart](images/a.png)\n\n## Part\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
 const b=parse(md);assert.deepEqual(b.map(x=>x.type),['h','toc','p','img','h','table']);
 assert.equal(source(b[3]),'![Chart](images/a.png)');assert.equal(source(b[1]),'[TOC]');
 assert.equal(tableMd(['A','B'],[['1','2|x\ny']]).split('\n')[2],'| 1 | 2/x y |');
 assert.deepEqual(headings(md).map(h=>h.text),['Report','Part']);
 assert.match(toHtml(md,{image:s=>'/f/'+s}),/<img src="\/f\/images\/a.png" alt="Chart">/);
 assert.doesNotMatch(toHtml('![x](javascript:alert(1)")',{}),/onerror|<script/);
});

test('data: CSV with quotes and commas, formulas, errors and column names',()=>{
 assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\n\n1,2\n'),[['a','b'],['x, y','say "hi"'],['1','2']]);
 assert.equal(toCsv([['a','b,c'],['x"y','1']]),'a,"b,c"\n"x""y",1\n');
 const g=[['A','B'],['1','10'],['2','20'],['=SUM(A2:A3)','=AVERAGE(B2:B3)*2+1']];
 assert.equal(evaluate(g[3][0],g),3);assert.equal(evaluate(g[3][1],g),31);assert.equal(evaluate('=MAX(B2:B3)-MIN(B2:B3)',g),10);
 assert.equal(evaluate('=A2/0',g),'#ERR');assert.equal(evaluate('=A9+',g),'#ERR');assert.equal(evaluate('=A1',[['=A1']]),'#ERR');
 assert.equal(colName(0),'A');assert.equal(colName(27),'AB');
});

test('slides: free items, crop, sizes and icons render (and stay escaped)',()=>{
 const deck={title:'T',size:'4:3',slides:[{layout:'bullets',title:'Hi',items:[{type:'text',text:'<b>x</b>',x:10,y:10,w:30,h:8},{type:'rect',x:50,y:20,w:20,h:10,fill:'#ff0000',rot:15},{type:'icon',icon:'check',x:1,y:1,w:5,h:5},{type:'image',src:'a.png',x:1,y:1,w:5,h:5,crop:{x:20,y:30,zoom:2}}]}]};
 const h=slideBlock(deck.slides[0],{index:0,deck,resolve:s=>'/x/'+s});
 assert.match(h,/class="slide r-4x3"/);assert.match(h,/&lt;b&gt;x&lt;\/b&gt;/);assert.equal((h.match(/s-item/g)||[]).length,4);assert.match(h,/rotate:15\.0deg/);assert.match(h,/object-position:20% 30%/);
 assert.equal(ratioOf(deck),4/3);assert.match(deckDocument(deck,{}),/@page\{size:1920px 1440px/);
 assert.match(itemCss({type:'rect',x:'nope'}),/left:0\.00cqw/);assert.equal(cropCss(null),'');assert.match(cropCss({zoom:9}),/scale:4\.00/);
 assert.match(iconSvg('unknown'),/<path d="M12 3\.5/);
});

test('your own edits to one file in a row stay one version',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cba-v-'));try{const ws=await new Workspace(dir).init();const id=ws.state.projects[0].id;
  await ws.apply(id,[{path:'outputs/a/index.md',content:'one'}],'Edit outputs/a/index.md');await ws.apply(id,[{path:'outputs/a/index.md',content:'two'}],'Edit outputs/a/index.md');await ws.apply(id,[{path:'outputs/b.md',content:'x'}],'Edit outputs/b.md');
  const v=ws.project(id).versions;assert.equal(v.filter(x=>x.label==='Edit outputs/a/index.md').length,1);assert.equal(await ws.read(id,'outputs/a/index.md'),'two');
  await assert.rejects(ws.writeAsset(id,'outputs/a/x.exe',Buffer.from('x')),/Upload/);await ws.writeAsset(id,'outputs/a/sources/paper.pdf',Buffer.from('%PDF'));await ws.writeAsset(id,'outputs/a/clip.webm',Buffer.from('x'));
  await assert.rejects(ws.writeAsset(id,'outputs/a/../../x.pdf',Buffer.from('x')))}finally{await rm(dir,{recursive:true,force:true})}
});
