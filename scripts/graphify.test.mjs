// Tests for graphify in the agents' shared Python and its skill (app/graphify.mjs). Run: node --test scripts/graphify.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createGraphify,GRAPHIFY_VERSION} from '../app/graphify.mjs';

async function make({failPip=false}={}){const root=await mkdtemp(path.join(tmpdir(),'gf-'));const H=path.join(root,'.hermes');const PY=path.join(root,'workspaces','.aqeelos-python','bin');
 await mkdir(PY,{recursive:true});await writeFile(path.join(PY,'pip'),'');const sk=path.join(H,'profiles','sales','skills','software-development','graphify');await mkdir(sk,{recursive:true});await writeFile(path.join(sk,'SKILL.md'),'');
 let have=null;const runs=[];let t=0;
 const run=async(cmd,args)=>{runs.push([path.basename(cmd),...args]);const b=path.basename(cmd);
  if(b==='graphify'&&args[0]==='--version'){if(!have)throw new Error('missing');return 'graphify '+have}
  if(b==='pip'){if(failPip)throw new Error('no network');have=GRAPHIFY_VERSION;await writeFile(path.join(PY,'graphify'),'');return ''}
  if(b==='graphify'&&args[0]==='install'){const d=path.join(H,'skills','graphify');await mkdir(path.join(d,'references'),{recursive:true});await writeFile(path.join(d,'SKILL.md'),'---\nname: graphify\n---\n');return ''}
  return ''};
 const G=createGraphify({HERMES_HOME:H,home0:root,run,now:()=>t,log:()=>{}});return {G,H,root,runs,PY,tick:ms=>{t+=ms}}}

test('installs the pinned package once, links it for the main user, moves its skill under a category, once',async()=>{const {G,H,root,runs,PY}=await make();
 assert.equal(await G.ensure(),true);assert.ok(runs.some(r=>r[0]==='pip'&&r.includes('graphifyy=='+GRAPHIFY_VERSION)));assert.ok(runs.some(r=>r[0]==='chmod'));
 if(process.platform!=='win32')assert.equal(await readlink(path.join(root,'.local','bin','graphify')),path.join(PY,'graphify'));   // Windows needs rights for links
 assert.ok((await readFile(path.join(H,'skills','software-development','graphify','SKILL.md'),'utf8')).includes('graphify'));
 await assert.rejects(stat(path.join(H,'skills','graphify')),'moved, not copied');
 const n=runs.length;assert.equal(await G.ensure(),false);assert.equal(runs.filter(r=>r[0]==='pip').length,1,'no second install');assert.ok(runs.length-n<=1);
 assert.deepEqual(await G.status(),{state:'on',version:GRAPHIFY_VERSION,agents:2})});

test('waits for the shared Python, and a failed download waits an hour',async()=>{const {G,runs,tick}=await make({failPip:true});
 assert.equal(await G.ensure(),false);assert.equal(await G.ensure(),false);assert.equal(runs.filter(r=>r[0]==='pip').length,1);
 assert.equal((await G.status()).state,'installing');tick(61*60e3);await G.ensure();assert.equal(runs.filter(r=>r[0]==='pip').length,2)});
