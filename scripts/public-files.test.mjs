// Public links (app/public-files.mjs): an agent's own file gets a link; secrets and other agents' files never do; stop ends it.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
// not under /tmp: on Linux /tmp is a share root for every agent, so a home inside it would make the main home look shareable
const HOME=await mkdtemp(path.join(process.platform==='linux'?'/var/tmp':tmpdir(),'pub-'));process.env.HOME=HOME;
const {createPublicFiles}=await import('../app/public-files.mjs');
const DATA=path.join(HOME,'data'),HH=path.join(HOME,'.hermes');
const pf=createPublicFiles({DATA,HERMES_HOME:HH,PUBLIC_URL:'https://ai.example.com'});
const res=()=>{const r={status:0,head:{},body:''};r.writeHead=(s,h)=>{r.status=s;Object.assign(r.head,h||{})};r.end=b=>{r.body+=b||''};r.on=()=>r;r.once=()=>r;r.emit=()=>{};r.write=b=>{r.body+=b;return true};return r};

test('the main agent shares its own file; the link serves it sandboxed; stop makes it 404',async()=>{
 const f=path.join(HOME,'report.txt');await writeFile(f,'hi');
 const r=await pf.make('default',{path:f});assert.match(r.url,/^https:\/\/ai\.example\.com\/pub\/[\w-]+\/report\.txt$/);
 const [,code,name]=/\/pub\/([\w-]+)\/(.+)$/.exec(r.url);
 assert.equal((await pf.list('default')).length,1);assert.equal((await pf.list('sela')).length,0);
 await assert.rejects(pf.stop('sela',r.url),/No public link of yours/);
 await pf.stop('default',r.url);const out=res();await pf.serve({method:'GET',headers:{}},out,code,name);assert.equal(out.status,404)});

test('secrets and sign-ins are never made public; another agent cannot share the main home',async()=>{
 await writeFile(path.join(HOME,'.env'),'K=1');await assert.rejects(pf.make('default',{path:path.join(HOME,'.env')}),/secrets/);
 await mkdir(path.join(HOME,'workspaces','sela'),{recursive:true});await writeFile(path.join(HOME,'x.txt'),'x');
 await assert.rejects(pf.make('sela',{path:path.join(HOME,'x.txt')}),/own folders/);
 await assert.rejects(pf.make('default',{path:path.join(HOME,'nope.txt')}),/No file/)});

test('the tools are listed by name',()=>{assert.deepEqual([...pf.names].sort(),['list_public','make_public','stop_public'])});
