// The desktop app's address: nothing built in, checked before it is used, and an app that was already paired keeps its address.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {cleanAddress,savedAddress,saveSettings,checkAddress,brandOf,forgetLink}=createRequire(import.meta.url)('./address.cjs');

const tmp=()=>mkdtempSync(path.join(os.tmpdir(),'aq-desktop-'));
const json=(f,v)=>{mkdirSync(path.dirname(f),{recursive:true});writeFileSync(f,JSON.stringify(v))};
// a fake aqeelOS: answers per path
const fake=routes=>async(url,opts={})=>{const p=new URL(url).pathname;const r=routes[p];if(r instanceof Error)throw r;if(!r)return {ok:false,status:404,json:async()=>{throw Error('no json')}};
 return {ok:(r.status||200)<300,status:r.status||200,json:async()=>{if(r.body===undefined)throw Error('not json');return r.body}}};

test('addresses are cleaned to just the origin',()=>{
 assert.equal(cleanAddress('ai.example.com'),'https://ai.example.com');
 assert.equal(cleanAddress(' https://ai.example.com/#/code/code '),'https://ai.example.com');
 assert.equal(cleanAddress('localhost:4400'),'http://localhost:4400');
 assert.throws(()=>cleanAddress(''),/Type your aqeelOS address/);
 assert.throws(()=>cleanAddress('ftp://ai.example.com'),/https/);
 assert.throws(()=>cleanAddress('https://me:pw@ai.example.com'),/name and password/)});

test('no address is built in: a new app asks',()=>{const d=tmp();
 assert.equal(savedAddress({settingsFile:path.join(d,'settings.json'),codeDir:path.join(d,'code'),bundled:path.join(d,'bundled'),env:{}}),'')});

test('an app already paired keeps its address, in this order',()=>{const d=tmp(),s=path.join(d,'settings.json'),code=path.join(d,'code'),bundled=path.join(d,'bundled');const at=()=>savedAddress({settingsFile:s,codeDir:code,bundled,env:{}});
 json(path.join(bundled,'aqeelos.json'),{aqeelos:{base:'https://built.example.com'}});assert.equal(at(),'https://built.example.com');
 json(path.join(code,'aqeelos.json'),{aqeelos:{base:'https://updated.example.com',version:'abc'}});assert.equal(at(),'https://updated.example.com');
 json(path.join(code,'data','aqeelos.json'),{base:'https://paired.example.com/',token:'t'});assert.equal(at(),'https://paired.example.com');
 saveSettings(s,{address:'https://chosen.example.com'});assert.equal(at(),'https://chosen.example.com');
 assert.equal(savedAddress({settingsFile:s,codeDir:code,bundled,env:{AQEELOS_URL:'http://localhost:4400'}}),'http://localhost:4400');
 // settings keep what else is there
 saveSettings(s,{brand:{name:'Acme OS'}});assert.deepEqual(JSON.parse(readFileSync(s,'utf8')),{address:'https://chosen.example.com',brand:{name:'Acme OS'}})});

test('the check accepts an aqeelOS (install-ping, or healthz on older ones) and reads its brand',async()=>{
 const ok=await checkAddress('ai.example.com',{fetchImpl:fake({'/install-ping':{body:{id:'abc'}},'/ui/brand':{body:{name:'Acme OS',logo:'/ui/brand/logo?v=2',owner:{name:'Ada <b>',org:'Acme',site:'acme.example'}}}})});
 assert.equal(ok.ok,true);assert.equal(ok.url,'https://ai.example.com');assert.equal(ok.https,true);assert.equal(ok.why,'');
 assert.deepEqual(ok.brand,{name:'Acme OS',logo:'https://ai.example.com/ui/brand/logo?v=2',owner:{name:'Ada b',org:'Acme',site:'acme.example'}});
 const old=await checkAddress('https://old.example.com',{fetchImpl:fake({'/healthz':{body:{ok:true,build:'x'}}})});assert.equal(old.ok,true);assert.equal(old.brand.name,'aqeelOS');
 const plain=await checkAddress('http://ai.example.com',{fetchImpl:fake({'/install-ping':{body:{id:'abc'}}})});assert.equal(plain.ok,true);assert.match(plain.why,/without https/);
 const local=await checkAddress('localhost:4400',{fetchImpl:fake({'/install-ping':{body:{id:'abc'}}})});assert.equal(local.why,'')});

test('the check refuses what is not aqeelOS, and says why in plain words',async()=>{
 const other=await checkAddress('example.com',{fetchImpl:fake({'/install-ping':{status:404},'/healthz':{body:{status:'up'}}})});assert.equal(other.ok,false);assert.match(other.why,/not aqeelOS/);
 const html=await checkAddress('example.com',{fetchImpl:fake({'/install-ping':{status:200},'/healthz':{status:200}})});assert.equal(html.ok,false);
 const down=await checkAddress('example.com',{fetchImpl:fake({'/install-ping':new Error('ECONNREFUSED'),'/healthz':new Error('ECONNREFUSED')})});assert.equal(down.ok,false);assert.match(down.why,/Nothing answers/);
 const slow=await checkAddress('example.com',{fetchImpl:fake({'/install-ping':Object.assign(new Error('x'),{name:'TimeoutError'}),'/healthz':Object.assign(new Error('x'),{name:'TimeoutError'})})});assert.match(slow.why,/8 seconds/);
 const typo=await checkAddress('not a url',{fetchImpl:fake({})});assert.equal(typo.ok,false)});

test('a brand that is odd falls back to aqeelOS',async()=>{
 const b=await brandOf('https://ai.example.com',{fetchImpl:fake({'/ui/brand':{body:{name:'<script>',logo:'https://elsewhere.example/x.svg'}}})});assert.deepEqual(b,{name:'aqeelOS',logo:'',owner:null});
 assert.deepEqual(await brandOf('https://ai.example.com',{fetchImpl:fake({})}),{name:'aqeelOS',logo:'',owner:null})});

test('a new address unpairs Code from the old one, keeping the old link file aside',()=>{const d=tmp();json(path.join(d,'data','aqeelos.json'),{base:'https://old.example.com',token:'t'});
 forgetLink(d);assert.equal(existsSync(path.join(d,'data','aqeelos.json')),false);assert.ok(readdirSync(path.join(d,'data')).some(f=>f.startsWith('aqeelos.json.before-')));forgetLink(d)});
