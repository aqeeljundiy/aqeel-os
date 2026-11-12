// Pre-merge check (maintainability audit action 1, 12 Nov 2026): the cheap, mechanical things that went wrong in merges, run before
// anything is merged or sent to a box. One script, no dependencies. Run it from the repo root:  node scripts/premerge-check.mjs
//   node scripts/premerge-check.mjs --base <commit>   also compares this branch with <commit> for the lost-backslash diff rule
//   node scripts/premerge-check.mjs --root <dir>      checks another folder (tracked files when it is a git checkout, else every file)
// Where it runs: .github/workflows/tests.yml (its own early step), .github/workflows/fixer-gate.yml (main's copy of this file is put
// over the pull request's before it runs), scripts/hooks/pre-push, scripts/deploy.sh (before anything is sent). The secret and privacy
// scans (gitleaks, repo-privacy.test.mjs) are separate and stay where they are.
// What it checks, in tracked files only:
//   1 conflict markers (<<<<<<<, >>>>>>>, and ======= next to one) in any text file, not only JS
//   2 every .js .mjs .cjs file parses (node --check), every shell script parses (bash -n), every .json parses, every .yml/.yaml parses
//     (PyYAML when python3 has it, else a small built-in check), every .py compiles (python3, when it is installed)
//   3 a regex literal that lost its backslashes (/^s*ssh_user:s*(ag-[w-]+)/ where \s and \w were meant, 12 Nov, b13b683), by a
//     heuristic on the line itself, and, with --base, by the diff rule: an added line equal to a removed line minus its backslashes
//   4 a file over MAX_BYTES, or a scratch file (.orig .rej .swp .bak, a name that starts with a drive letter and colon) added by accident
// A missing tool (no bash, no python3) is reported and skipped, except when CI is set: there it fails, so the gate cannot go quiet.
import {execFileSync,execFile,spawnSync} from 'node:child_process';import {readFileSync,existsSync,statSync,readdirSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';

export const MAX_BYTES=1_000_000; // the biggest tracked file today is a 698 KB dll; a pasted dump or a build output is over this
const SH_EXT=/\.(sh|command)$/,JS_EXT=/\.(m?js|cjs)$/,JSON_EXT=/\.(json|webmanifest)$/,YAML_EXT=/\.ya?ml$/,PY_EXT=/\.py$/;
const SCRATCH=/(\.(orig|rej|swp|bak)$)|(^|\/)[A-Za-z]:[^/]*$/;
const BIN_EXT=/\.(png|jpe?g|gif|ico|woff2?|dll|exe|wav|mp3|mp4|zip|gz|tgz|pdf|sha256)$/i;

// ---------- 1 conflict markers
const O='<'.repeat(7),M='='.repeat(7),C='>'.repeat(7);
export function conflictMarkers(text){
 const lines=text.split('\n'),hits=[];let hasEnds=false;
 lines.forEach((l,i)=>{if(l.startsWith(O)&&(l.length===7||l[7]===' '||l[7]==='\r')||l.startsWith(C)&&(l.length===7||l[7]===' '||l[7]==='\r')){hits.push(i+1);hasEnds=true}});
 // a lone ======= is a heading underline in Markdown; it counts only in a file that also has one of the other two
 if(hasEnds)lines.forEach((l,i)=>{if(l.replace(/\r$/,'')===M)hits.push(i+1)});
 return hits.sort((a,b)=>a-b)}

// ---------- 3 a regex literal that lost its backslashes
// Finds regex literals on one line (after ( , = : [ ! & | ? { } ; or return), skipping strings and // comments, and flags one whose body
// has a shorthand class without its backslash: a class like [w-] or [w.], or s* d+ w+ d{4} right after ^ ( | : ) ] or at the start.
export function regexLiterals(line){
 const out=[];let q=null,i=0;
 for(;i<line.length;i++){const c=line[i];
  if(q){if(c==='\\')i++;else if(c===q)q=null;continue}
  if(c==="'"||c==='"'||c==='`'){q=c;continue}
  if(c==='/'&&line[i+1]==='/')break;
  if(c==='/'&&line[i+1]!=='*'){
   let j=i-1;while(j>=0&&line[j]===' ')j--;
   const prev=j<0?'':line[j],before=line.slice(0,j+1);
   if(j>=0&&!'(,=:[!&|?{};'.includes(prev)&&!/(^|[^\w$])return$/.test(before)&&!/(^|[^\w$])(typeof|case|in|of)$/.test(before))continue;
   let k=i+1,cls=false;for(;k<line.length;k++){const d=line[k];if(d==='\\'){k++;continue}if(cls){if(d===']')cls=false;continue}if(d==='[')cls=true;else if(d==='/')break}
   if(k>=line.length)continue;
   out.push(line.slice(i+1,k));i=k}}
 return out}
export function lostBackslash(line){
 for(const body of regexLiterals(line)){
  // drop the escapes that are there, then look at what is left
  const b=body.replace(/\\./g,'__');
  for(const m of b.matchAll(/\[\^?([^\]]*)\]/g)){const x=m[1];if(/^[-.@_:]*[wdsWDS][-.@_:]*$/.test(x)&&/[-.@_:]/.test(x))return {regex:body,why:'class ['+x+'] looks like \\'+x.replace(/[-.@_:]/g,'')+' without its backslash'}}
  // s is also the plural ending ((cat|dog)s?), so it counts only after ^ ( | : or at the start, and only with * or +
  const m=b.match(/(^|[\^(|:)\]])([wd])([*+?]|\{\d)/)||b.match(/(^|[\^(|:])(s)([*+])/);
  if(m&&b.length>1)return {regex:body,why:'"'+m[2]+m[3]+'" after "'+(m[1]||'start')+'" looks like \\'+m[2]+m[3]+' without its backslash'}}
 return null}
// the diff rule: a line that was removed and comes back equal except that every backslash is gone
export function strippedPairs(diffText){
 const rem=new Map(),hits=[];let file='',ln=0;
 for(const l of diffText.split('\n')){
  if(l.startsWith('+++ ')){file=l.slice(6);continue}
  const h=l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);if(h){ln=+h[1];continue}
  if(l.startsWith('---')){continue}
  if(l.startsWith('-')){const t=l.slice(1).trim();if(t.includes('\\')&&t.length>8)rem.set(t.replace(/\\/g,''),t)}
  else if(l.startsWith('+')){const t=l.slice(1).trim();if(rem.has(t)&&!t.includes('\\'))hits.push({file,line:ln,was:rem.get(t)});ln++}}
 return hits}

// ---------- 2 small YAML check for when PyYAML is not there (indent tabs, unbalanced flow brackets or quotes on a single line)
export function yamlLight(text){
 const errs=[];let block=-1;
 text.split('\n').forEach((raw,i)=>{const l=raw.replace(/\r$/,''),ind=l.match(/^ */)[0].length;
  if(block>=0){if(!l.trim()||ind>block)return;block=-1}
  if(!l.trim()||/^\s*#/.test(l))return;
  if(/^\s*\t/.test(l))errs.push([i+1,'tab in the indentation']);
  const v=l.replace(/^\s*(-\s+)*/,'').match(/^(?:[^\s:#][^:#]*|"[^"]*"|'[^']*'):\s+(.*)$/);
  if(/[:\s]\s*[|>][-+0-9]*\s*(#.*)?$/.test(l)){block=ind;return}
  const val=(v?v[1]:l.replace(/^\s*(-\s+)*/,'')).replace(/\s+#.*$/,'');
  if(/^[\[{]/.test(val)){let d=0;for(const c of val.replace(/"[^"]*"|'[^']*'/g,''))d+=c==='['||c==='{'?1:c===']'||c==='}'?-1:0;if(d!==0&&/^[\[{].*[\]}]$/.test(val))errs.push([i+1,'unbalanced bracket'])}
  if(/^"/.test(val)&&!/^"(?:[^"\\]|\\.)*"$/.test(val)&&!/\\$/.test(val)&&val.length>1&&(val.match(/(?<!\\)"/g)||[]).length%2)errs.push([i+1,'unbalanced quote'])});
 return errs}

// ---------- the run
const HERE=path.dirname(fileURLToPath(import.meta.url));
function have(cmd,args,expect){try{const r=spawnSync(cmd,args,{encoding:'utf8',timeout:15000});return r.status===0&&(!expect||(r.stdout||'').includes(expect))}catch{return false}}
function listFiles(root){
 try{return execFileSync('git',['-C',root,'ls-files','-z'],{encoding:"utf8",maxBuffer:64e6,stdio:["ignore","pipe","ignore"]}).split('\0').filter(Boolean)}catch{}
 const out=[];(function walk(d){for(const e of readdirSync(path.join(root,d),{withFileTypes:true})){if(e.name==='.git'||e.name==='node_modules')continue;const p=d?d+'/'+e.name:e.name;e.isDirectory()?walk(p):out.push(p)}})('');return out}
const run=(cmd,args,opts={})=>new Promise(res=>execFile(cmd,args,{encoding:'utf8',timeout:60000,maxBuffer:8e6,...opts},(err,so,se)=>res({ok:!err,out:String(se||'')+String(so||'')})));
async function pool(items,n,fn){let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const x=items[i++];await fn(x)}}))}

export async function check({root=path.join(HERE,'..'),base='',log=()=>{}}={}){
 const fails=[],notes=[],isCI=!!process.env.CI,files=listFiles(root).filter(f=>existsSync(path.join(root,f))&&statSync(path.join(root,f)).isFile());
 const bad=(rule,file,msg)=>fails.push({rule,file,msg});
 const texts=new Map(),need=(tool,why)=>{const m='skipped '+why+': '+tool+' is not installed';if(isCI)bad('tool','-',tool+' is needed in CI ('+why+') and is not installed');else notes.push(m)};
 // 4 size and scratch files, 1 markers
 for(const f of files){const abs=path.join(root,f),size=statSync(abs).size;
  if(size>MAX_BYTES)bad('size',f,size+' bytes: over '+MAX_BYTES+' (a build output or a pasted dump? raise MAX_BYTES in scripts/premerge-check.mjs only for a file that belongs in the repo)');
  if(SCRATCH.test(f))bad('scratch',f,'looks like a scratch or leftover file');
  if(BIN_EXT.test(f)||size>5e6)continue;
  const buf=readFileSync(abs);if(buf.subarray(0,8000).includes(0))continue;
  const t=buf.toString('utf8');texts.set(f,t);
  for(const n of conflictMarkers(t))bad('conflict',f+':'+n,'merge conflict marker')}
 // 3 lost backslashes, by line
 for(const [f,t] of texts){if(!JS_EXT.test(f))continue;
  t.split('\n').forEach((l,i)=>{const r=lostBackslash(l);if(r)bad('backslash',f+':'+(i+1),'regex /'+r.regex.slice(0,80)+'/ '+r.why+' (if it is meant, write it as new RegExp or add a backslash-free form)')})}
 // 3b the diff rule
 if(base){try{const d=execFileSync('git',['-C',root,'diff','-U0','--no-color',base,'HEAD','--','*.js','*.mjs','*.cjs','*.py','*.sh'],{encoding:'utf8',maxBuffer:256e6});
  for(const h of strippedPairs(d))bad('backslash',h.file+':'+h.line,'this line equals a removed line without its backslashes: '+h.was.slice(0,100))}catch(e){notes.push('skipped the backslash diff against '+base+': '+String(e.message).split('\n')[0])}}
 // 2 parse everything
 const js=files.filter(f=>JS_EXT.test(f)),sh=files.filter(f=>SH_EXT.test(f)||(texts.has(f)&&/^#!\s*\/(usr\/)?bin\/(env\s+)?(ba)?sh\b/.test(texts.get(f))&&!/\.\w+$/.test(path.basename(f)))),
  js_on=[...new Set(js)],json=files.filter(f=>JSON_EXT.test(f)),yml=files.filter(f=>YAML_EXT.test(f)),py=files.filter(f=>PY_EXT.test(f));
 await pool(js_on,8,async f=>{const r=await run(process.execPath,['--check',f],{cwd:root});if(!r.ok)bad('parse',f,'node --check: '+r.out.split('\n').filter(l=>/Error/.test(l))[0])});
 if(sh.length){if(have('bash',['-c','echo ok'],'ok'))await pool(sh,8,async f=>{const r=await run('bash',['-n',f],{cwd:root});if(!r.ok)bad('parse',f,'bash -n: '+r.out.split('\n')[0])});else need('bash','shell scripts')}
 for(const f of json){try{JSON.parse((texts.get(f)??readFileSync(path.join(root,f),'utf8')).replace(/^\uFEFF/,''))}catch(e){bad('parse',f,'JSON: '+e.message)}}
 const py3=(have('python3',['-c','print("ok")'],'ok')&&'python3')||(have('python',['-c','import sys;print("ok" if sys.version_info[0]==3 else "")'],'ok')&&'python')||'';
 if(py.length){if(py3){const r=await run(py3,['-I','-c','import sys,ast\nfor f in sys.argv[1:]:\n  try: ast.parse(open(f,encoding="utf-8-sig").read(),f)\n  except SyntaxError as e: print(f+":"+str(e.lineno)+" "+e.msg)\n',...py],{cwd:root});for(const l of r.out.split('\n').filter(Boolean))bad('parse',l.split(' ')[0],'python: '+l.split(' ').slice(1).join(' '))}else need('python3','Python files')}
 if(yml.length){const withYaml=py3&&have(py3,['-I','-c','import yaml;print("ok")'],'ok');
  if(withYaml){const r=await run(py3,['-I','-c','import sys,yaml\nfor f in sys.argv[1:]:\n  try: list(yaml.safe_load_all(open(f,encoding="utf-8")))\n  except Exception as e: print(f+" "+str(e).replace("\\n"," ")[:150])\n',...yml],{cwd:root});for(const l of r.out.split('\n').filter(Boolean))bad('parse',l.split(' ')[0],'YAML: '+l.split(' ').slice(1).join(' '))}
  else{notes.push('YAML checked with the built-in light check (PyYAML not installed)');for(const f of yml)for(const [n,m] of yamlLight(texts.get(f)??''))bad('parse',f+':'+n,'YAML: '+m)}}
 log(`premerge-check: ${files.length} tracked files, ${js_on.length} JS, ${sh.length} shell, ${json.length} JSON, ${yml.length} YAML, ${py.length} Python`);
 return {fails,notes,count:files.length}}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const a=process.argv.slice(2),arg=n=>{const i=a.indexOf(n);return i>=0?a[i+1]:''};
 const root=path.resolve(arg('--root')||path.join(HERE,'..')),base=arg('--base');
 const r=await check({root,base,log:console.log});
 for(const n of r.notes)console.log('  note: '+n);
 for(const f of r.fails)console.log('  ✗ ['+f.rule+'] '+f.file+' '+f.msg);
 if(r.fails.length){console.log('premerge-check: '+r.fails.length+' problem(s); nothing was changed. Fix them, then run: node scripts/premerge-check.mjs');process.exit(1)}
 console.log('premerge-check: ok')}
