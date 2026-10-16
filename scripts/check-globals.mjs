// Every browser script shares one global scope: two files declaring the same top-level const/let/function
// make the second file fail to load (the app then shows a blank page). deploy.sh runs this first.
import {readFileSync,readdirSync} from 'node:fs';
const dir=new URL('../app/',import.meta.url);const seen=new Map();let bad=0;
const html=readFileSync(new URL('index.html',dir),'utf8');
const files=[...html.matchAll(/src="\/app\/([\w.-]+\.js)"/g)].map(m=>m[1]);
for(const f of files){const src=readFileSync(new URL(f,dir),'utf8');
 for(const m of src.matchAll(/^(?:const|let|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm)){const n=m[1];
  if(seen.has(n)&&seen.get(n)!==f){console.error(`✗ "${n}" is declared in both ${seen.get(n)} and ${f}`);bad++}else seen.set(n,f)}}
// every script must also parse on its own
if(bad){console.error(bad+' clash(es). Rename one of each pair before deploying.');process.exit(1)}
console.log('✓ '+files.length+' scripts, '+seen.size+' top-level names, no clashes');
