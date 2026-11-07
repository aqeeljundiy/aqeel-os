// The repo stays ready for open source (7 Nov 2026): its Built in skills are general, and nothing private to one install
// reaches git. An install's own list of private skills and words lives in data/private-words.json (never committed;
// the test reads it when it is there) or the file named by AQEELOS_PRIVATE_WORDS.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const tracked=()=>execFileSync('git',['-C',ROOT,'ls-files'],{encoding:'utf8'}).split('\n').filter(Boolean);
const skills=()=>{const out=[];const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.name==='SKILL.md')out.push(p)}};if(existsSync(path.join(ROOT,'skills')))walk(path.join(ROOT,'skills'));return out};
const PRIV=process.env.AQEELOS_PRIVATE_WORDS||path.join(ROOT,'data','private-words.json');
const priv=existsSync(PRIV)?JSON.parse(readFileSync(PRIV,'utf8')):null;
// the Code app (code/) keeps its own defaults until its next release; engine patches must match what is on the box
const SKIP=f=>f==='LICENSE'||/^code\/|^engine\/patches\/|\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|dll|exe|zip|pdf)$/i.test(f)||f.startsWith('data/');

test('every Built in skill is general: name, description, no private details',()=>{const list=skills();assert.ok(list.length>=10,'the Built in skills are in skills/');
 for(const f of list){const t=readFileSync(f,'utf8'),rel=path.relative(ROOT,f),name=path.basename(path.dirname(f));
  const fm=/^---\n([\s\S]*?)\n---/.exec(t)?.[1]||'';assert.equal((/^name:\s*(.+)$/m.exec(fm)||[])[1]?.trim(),name,rel+': name matches its folder');
  const d=(/^description:\s*(.+)$/m.exec(fm)||[])[1]||'';assert.ok(d.length>=40&&d.length<=240,rel+': a one-line description');
  const dir=path.dirname(f);for(const g of readdirSync(dir,{recursive:true})){const p=path.join(dir,g);if(!statSync(p).isFile()||/\.pyc$/.test(p))continue;const s=readFileSync(p,'utf8'),r=path.relative(ROOT,p);
   assert.doesNotMatch(s,/[—–]/,r+': no em or en dashes');
   assert.doesNotMatch(s,/\/home\/(?!<|user\b|USER\b|\$)[a-z]/,r+': no one’s home folder');
   for(const ip of s.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)||[])assert.match(ip,/^(127\.|0\.0\.0\.0|10\.0\.0\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|255\.)/,r+': '+ip+' is a real address');
   for(const m of s.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)||[])assert.match(m,/@(example\.(com|org|net)|acme\.(com|example)|localhost)$|\.example$/,r+': '+m+' is a real email');
   assert.doesNotMatch(s,/\b62(?!81234567890)8\d{8,}\b/,r+': a real phone number');
   assert.doesNotMatch(s,/\b(ghp|gho|xox[abp]|sk-(?:ant|proj)?|AKIA)[\w-]{10,}/,r+': a key')}}});

test('no private skill of this install is in the repo',{skip:!priv&&'no data/private-words.json here'},()=>{const have=new Set(skills().map(f=>path.basename(path.dirname(f))));
 for(const s of priv.skills||[])assert.ok(!have.has(s),s+' is private and must stay in the box’s data');
 for(const f of tracked())for(const s of priv.skills||[])assert.ok(!f.split('/').includes(s),f+' carries the private skill '+s)});

test('no private word of this install is in any tracked file',{skip:!priv&&'no data/private-words.json here'},()=>{const words=(priv.words||[]).map(w=>w.toLowerCase());const hits=[];
 for(const f of tracked()){if(SKIP(f))continue;let s;try{s=readFileSync(path.join(ROOT,f),'utf8').toLowerCase()}catch{continue}for(const w of words)if(s.includes(w))hits.push(f+': '+w)}
 assert.deepEqual(hits,[],'private words in the repo')});

test('the private files stay out of git',()=>{const ig=readFileSync(path.join(ROOT,'.gitignore'),'utf8');
 for(const p of ['data/private-words.json','data/reference-install.md','skills/**/references/local.md'])assert.ok(ig.includes(p),p+' is ignored');
 assert.ok(!tracked().some(f=>/references\/local\.md$/.test(f)),'no install’s local.md is committed')});
