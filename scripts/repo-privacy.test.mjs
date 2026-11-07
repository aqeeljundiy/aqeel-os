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
// engine patches must match what is on the box; the Code app (code/) is checked too since 7 Nov 2026
const BINARY=/\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|dll|exe|zip|pdf|dmg)$/i;
const SKIP=f=>f==='LICENSE'||/^engine\/patches\//.test(f)||BINARY.test(f)||f.startsWith('data/');

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

// The Code desktop app (code/) is neutral (7 Nov 2026): no built-in server address, no one install's design, names or
// accounts. Anyone who builds it from GitHub gets an app that asks for their own aqeelOS address.
const codeFiles=()=>tracked().filter(f=>f.startsWith('code/')&&!BINARY.test(f)&&!/package-lock\.json$/.test(f));
const textOf=f=>{try{return readFileSync(path.join(ROOT,f),'utf8')}catch{return ''}};
test('the Code app has no owner design, domain or address built in',()=>{const hits=[];
 for(const f of codeFiles()){const s=textOf(f);
  if(/elkiya/i.test(s))hits.push(f+': elkiya');
  if(/aqeel(?:jund)iy|ai-vps|hermes-ui-data/i.test(s))hits.push(f+': '+/aqeel(?:jund)iy|ai-vps|hermes-ui-data/i.exec(s)[0]);
  // a server address as a default ('https://ai.<domain>' in code, not an example)
  for(const m of s.matchAll(/https:\/\/(?:ai|code|code-preview)\.([a-z0-9-]+\.[a-z.]+)/gi))if(!/^example\.(com|org|net)$/i.test(m[1]))hits.push(f+': '+m[0])}
 assert.deepEqual(hits,[],'owner details in code/')});
test('the Code app has no real IP address, email, team id or key',()=>{const hits=[];
 for(const f of codeFiles()){const s=textOf(f);
  for(const m of s.matchAll(/(?<![\d.\/-])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g))if(!/^(127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|255\.)/.test(m[0])&&m[0].split('.').every(n=>+n<256))hits.push(f+': '+m[0]);
  for(const m of s.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi)||[])if(!/@([\w-]+\.)*(example\.(com|org|net)|localhost)$|\.example$|^git@github\.com$|^noreply@/i.test(m))hits.push(f+': '+m);
  for(const m of s.match(/\b(ghp|gho|xox[abp]|sk-(?:ant|proj)|AKIA)[\w-]{10,}/g)||[])if(!/abcdefgh|ABCDEFGH|EXAMPLE|x{8}/.test(m))hits.push(f+': a key');   // test values are plainly fake
  if(/"(appleId|teamId|identity)"\s*:\s*"[^"]+"/.test(s))hits.push(f+': a signing account')}
 assert.deepEqual(hits,[],'private details in code/')});
test('the desktop app asks for its address and keeps build settings out of git',()=>{const main=textOf('code/desktop/main.cjs'),build=textOf('code/desktop/build.mjs');
 assert.doesNotMatch(main,/\|\|\s*['"]https?:\/\/[^'"]+['"]\)?\.replace/,'main.cjs has no fallback address');assert.match(main,/savedAddress/);
 assert.doesNotMatch(build,/\|\|\s*['"]https?:\/\//,'build.mjs has no default address');
 assert.ok(readFileSync(path.join(ROOT,'.gitignore'),'utf8').includes('/desktop/build.config.json')||textOf('code/.gitignore').includes('/desktop/build.config.json'),'build.config.json is ignored');
 assert.ok(!tracked().includes('code/desktop/build.config.json'),'no one install\u2019s build settings are committed');
 assert.ok(tracked().includes('code/desktop/build.config.example.json')||existsSync(path.join(ROOT,'code/desktop/build.config.example.json')),'an example build config is there');
 assert.ok(existsSync(path.join(ROOT,'code','BUILDING.md')),'BUILDING.md explains your own build')});
