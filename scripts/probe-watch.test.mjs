// The bridge's delivery probe (engine/patches: delivery-probe, -document, -document-caption), rebuilt from the patches on a
// scratch copy and run on fabricated Baileys messages. A document WITH a caption arrives wrapped in documentWithCaptionMessage;
// that is how the first live PDF check "delivered" at Kirimdev yet left no trace in the bridge (12 Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const P=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','engine','patches'),F='scripts/whatsapp-bridge/probe_watch.js';
function build(){const T=mkdtempSync(path.join(tmpdir(),'probe-'));mkdirSync(path.join(T,'session'),{recursive:true});
 for(const n of ['2026-11-11-delivery-probe','2026-11-12-delivery-probe-document','2026-11-12-delivery-probe-document-caption'])
  execFileSync('git',['-C',T,'-c','core.autocrlf=false','apply','--include='+F,path.join(P,n+'.patch')],{stdio:'pipe'});
 return T}
const PDF=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(300,65)]);
const run=async(msg,dl)=>{const T=build();try{const {watchProbe}=await import(pathToFileURL(path.join(T,F)).href+'?'+Math.random());
 const handled=await watchProbe(path.join(T,'session'),msg,dl);const d=path.join(T,'probes');
 return {handled,res:readdirSync(d,{withFileTypes:true}).length?JSON.parse(readFileSync(path.join(d,readdirSync(d)[0]),'utf8')):null}}catch(e){if(e.code==='ENOENT')return {handled:true,res:null};throw e}finally{rmSync(T,{recursive:true,force:true})}};
const doc={mimetype:'application/pdf',caption:'aqeelOS delivery check, please ignore. aqeelos-probe:abc123def456'};

test('a document with a caption (wrapped by WhatsApp) is recognised, downloaded, and recorded as arrived',async()=>{
 const r=await run({key:{},message:{documentWithCaptionMessage:{message:{documentMessage:doc}}}},async()=>PDF);
 assert.equal(r.handled,true);assert.equal(r.res.type,'document');assert.equal(r.res.ok,true);assert.ok(r.res.bytes>300);assert.equal(r.res.id,'abc123def456')});

test('a plain documentMessage still works',async()=>{
 const r=await run({key:{},message:{documentMessage:doc}},async()=>PDF);assert.equal(r.res.ok,true)});

test('a document that is not a PDF is recorded as not ok, with the reason',async()=>{
 const r=await run({key:{},message:{documentWithCaptionMessage:{message:{documentMessage:doc}}}},async()=>Buffer.alloc(400,66));
 assert.equal(r.res.ok,false);assert.equal(r.res.error,'not a PDF')});

test('a picture probe is unchanged',async()=>{
 const r=await run({key:{},message:{imageMessage:{mimetype:'image/jpeg',caption:doc.caption}}},async()=>Buffer.alloc(500,1));
 assert.equal(r.res.type,'image');assert.equal(r.res.ok,true)});

test('an ordinary message is not taken',async()=>{
 const {watchProbe}=await import(pathToFileURL(path.join(build(),F)).href);
 assert.equal(await watchProbe('/nope',{key:{},message:{documentWithCaptionMessage:{message:{documentMessage:{caption:'hello'}}}}},async()=>PDF),false)});
