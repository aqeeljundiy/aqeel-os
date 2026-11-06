// Change lists aqeelOS applies when it starts (5 Nov 2026): a JSON file in DATA/apply-on-start/ ({"why":"…","ops":[…]})
// is carried out once, one step at a time, by aqeelOS's own code (so every rule it has still applies), and moved to
// DATA/apply-on-start/done/ with the result of each step. Only the box's own user can write there: it is how a
// planned change (moving copies to shares, setting levels) is applied on the server without anyone's password.
import {readFile,writeFile,readdir,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';

export async function applyOnStart({DATA,ops,log=m=>console.log(m),now=()=>Date.now()}){
 const dir=path.join(DATA,'apply-on-start'),done=path.join(dir,'done');await mkdir(done,{recursive:true});const out=[];
 for(const f of (await readdir(dir).catch(()=>[])).filter(f=>f.endsWith('.json')).sort()){const p=path.join(dir,f);let plan;
  try{plan=JSON.parse(await readFile(p,'utf8'))}catch(e){log('apply-on-start: '+f+' is not readable JSON, left alone');continue}
  const results=[];for(const op of plan.ops||[]){const fn=ops[op?.op];
   if(!fn){results.push({op,ok:false,error:'unknown step'});continue}
   try{results.push({op,ok:true,result:await fn(op)??null})}catch(e){results.push({op,ok:false,error:String(e.message||e).slice(0,300)})}}
  const ok=results.filter(r=>r.ok).length;log('apply-on-start: '+f+' ('+(plan.why||'')+'): '+ok+' of '+results.length+' steps done');
  await writeFile(path.join(done,f.replace(/\.json$/,'')+'.'+new Date(now()).toISOString().replace(/[:.]/g,'-')+'.json'),JSON.stringify({...plan,results},null,1),{mode:0o600});
  await rename(p,path.join(done,f+'.applied'));out.push({file:f,ok,total:results.length})}
 return out}
