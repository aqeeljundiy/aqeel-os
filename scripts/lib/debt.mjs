// Measures the maintainability debt that parallel work adds to without noticing (audit 06, action 4). Used by scripts/debt.test.mjs, which
// compares the numbers with scripts/debt-baseline.json and fails when one goes UP. Print the numbers:  node scripts/lib/debt.mjs
// Lower the recorded numbers after reducing debt (refuses to raise any):  node scripts/lib/debt.mjs --lower
import {readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {src} from './source.mjs';
export const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const list=(d,rx)=>existsSync(path.join(ROOT,d))?readdirSync(path.join(ROOT,d)).filter(f=>rx.test(f)).sort().map(f=>d+'/'+f):[];
const read=f=>readFileSync(path.join(ROOT,f),'utf8');
export const appModules=()=>list('app',/\.mjs$/);
const count=(s,rx)=>(s.match(rx)||[]).length;

// modules that save JSON with writeFile and do not import app/store.mjs (atomic write, refuses to save over a file it could not read)
export function storeBypass(){return appModules().filter(f=>f!=='app/store.mjs'&&!/from '\.\/store\.mjs'|import\('\.\/store\.mjs'\)/.test(read(f))&&/writeFile(Sync)?\([^;]{0,400}JSON\.stringify/.test(read(f)))}
// the agent's home folder worked out in place instead of homeOf() from app/agentops.mjs
export const HOME_RX=/==='default'\?\w*HERMES_HOME\w*:/g;
export function inlineHomePaths(){let n=0;const mods=[];for(const f of appModules()){const c=count(read(f),HOME_RX);n+=c;if(c)mods.push(f)}return {n,mods}}
// every setInterval in app/*.mjs (the server.mjs ones are counted on their own: they start with the app and are never stopped)
export function timers(){let total=0;for(const f of appModules())total+=count(read(f),/setInterval\(/g);return {total,server:count(src('app/server.mjs'),/setInterval\(/g)}}

// exported names that no other file in app/ or scripts/ imports (a `import * as` or an import() that is not destructured counts as using all)
export function unusedExports(){
 const files=[...appModules(),...list('scripts',/\.mjs$/)],exp=new Map(),used=new Map();
 const resolve=(from,spec)=>{if(!/^\.\.?\//.test(spec))return null;const p=path.posix.normalize(path.posix.join(path.posix.dirname(from),spec));return p};
 for(const f of appModules()){const s=read(f),names=new Set();
  for(const m of s.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([\w$]+)/gm))names.add(m[1]);
  for(const m of s.matchAll(/^export\s*\{([^}]*)\}/gm))for(const x of m[1].split(',')){const n=x.trim().split(/\s+as\s+/).pop();if(n&&n!=='default')names.add(n)}
  if(names.size)exp.set(f,names)}
 const use=(file,name)=>{if(!used.has(file))used.set(file,new Set());used.get(file).add(name)};
 for(const f of files){const s=read(f);
  for(const m of s.matchAll(/(?:import|export)\s+(?:type\s+)?([\w$\s{},*]+?)\s+from\s+['"]([^'"]+)['"]/g)){const t=resolve(f,m[2]);if(!t)continue;
   const clause=m[1];if(/\*/.test(clause))use(t,'*');
   const br=clause.match(/\{([^}]*)\}/);if(br)for(const x of br[1].split(',')){const n=x.trim().split(/\s+as\s+/)[0];if(n)use(t,n)}
   if(/^[\w$]+\s*(,|$)/.test(clause.trim()))use(t,'default')}
  for(const m of s.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)){const t=resolve(f,m[1]);if(!t)continue;
   const before=s.slice(Math.max(0,m.index-120),m.index),d=before.match(/\{([^{}]*)\}\s*=\s*(?:await\s*)?$/);
   if(d)for(const x of d[1].split(',')){const n=x.trim().split(/\s*:\s*/)[0];if(n)use(t,n)}else use(t,'*')}}
 const out=[];for(const [f,names] of exp){const u=used.get(f)||new Set();if(u.has('*'))continue;for(const n of names)if(!u.has(n))out.push(f+':'+n)}
 return out.sort()}

// environment variables the code reads (process.env.X, process.env['X'], env.X) that .env.example does not list (a commented "# X=" line counts as listed)
export function envReads(){
 const names=new Set();
 for(const f of [...appModules(),...list('scripts',/\.mjs$/)]){const s=read(f);
  for(const m of s.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g))names.add(m[1]);
  for(const m of s.matchAll(/process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g))names.add(m[1]);
  for(const m of s.matchAll(/(?<![\w.])env\.([A-Z][A-Z0-9_]+)/g))names.add(m[1])}
 const listed=new Set([...read('.env.example').matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map(m=>m[1]));
 return {all:[...names].sort(),missing:[...names].filter(n=>!listed.has(n)).sort()}}

export function measure(){
 const server=readFileSync(path.join(ROOT,'app/server.mjs'),'utf8'),t=timers();
 return {serverBytes:Buffer.byteLength(server),serverLines:server.split('\n').length-1,
  modulesSavingJsonWithoutStore:storeBypass().length,inlineAgentHomePaths:inlineHomePaths().n,timersTotal:t.total,timersInServer:t.server,
  exportsNothingImports:unusedExports().length,envReadButNotInEnvExample:envReads().missing.length}}
export const BASELINE=path.join(ROOT,'scripts','debt-baseline.json');

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const m=measure();console.log(JSON.stringify(m,null,1));
 if(process.argv.includes('--lower')){const old=JSON.parse(readFileSync(BASELINE,'utf8')),up=Object.keys(m).filter(k=>m[k]>old.counts[k]);
  if(up.length){console.log('refused: '+up.join(', ')+' went up; fix the debt, do not record it');process.exit(1)}
  writeFileSync(BASELINE,JSON.stringify({...old,counts:m},null,1)+'\n');console.log('lowered the recorded numbers in scripts/debt-baseline.json')}
 if(process.argv.includes('--env'))console.log(envReads().missing.join('\n'));
 if(process.argv.includes('--exports'))console.log(unusedExports().join('\n'))}
