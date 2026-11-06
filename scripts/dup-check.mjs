// Live/staging duplicate check; only its marked throwaway agent is changed. No provider sends.
import {readFileSync,existsSync,appendFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {userInfo} from 'node:os';
import path from 'node:path';
const B=process.env.BASE||'http://127.0.0.1:4402',PWF=process.env.PWFILE||'/tmp/ppl/pw';
const H=process.env.HERMES_HOME||path.join(userInfo().homedir,'.hermes');
const A=process.env.TEST_AGENT||'dp-'+Date.now().toString(36),marker=path.join(H,'.aqeelos-test-agents');
if(!/^dp-[a-z0-9-]+$/.test(A))throw Error('TEST_AGENT must be a dp- throwaway name');
try{await fetch(B+'/',{signal:AbortSignal.timeout(5000)})}catch(e){console.error('dup-check: nothing answers at '+B+': '+e.message);process.exit(2)}
let ck;
if(process.env.COOKIEFILE)ck=readFileSync(process.env.COOKIEFILE,'utf8').trim();
else{
 if(!existsSync(PWF)){console.error('dup-check: no password file '+PWF+' (or set COOKIEFILE)');process.exit(2)}
 const r=await fetch(B+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:readFileSync(PWF,'utf8').trim()})});
 if(!r.ok||!r.headers.get('set-cookie'))throw Error('dup-check: sign-in failed ('+r.status+')');
 ck=r.headers.get('set-cookie').split(';')[0];
}
const call=async(p,m='GET',b)=>{const r=await fetch(B+p,{method:m,headers:{'x-hui':'1',cookie:ck,'content-type':'application/json'},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(120000)});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return [r.status,j]};
const check=(c,m)=>{console.log(c?'✓':'✗',m);if(!c)throw Error(m)};const q='?profile='+encodeURIComponent(A);
const [,before]=await call('/hapi/profiles');
check(!JSON.stringify(before).includes('"'+A+'"'),'throwaway does not exist');
mkdirSync(H,{recursive:true});appendFileSync(marker,A+'\n'); // mark BEFORE create: defaults/alerts may run immediately
let created=false;
try{
 const [s,b]=await call('/hapi/profiles','POST',{name:A,clone_from_default:false,no_skills:false});check(s<300,'agent '+A+' created ('+s+')');created=true;
 check((await call('/hapi/mcp/servers'+q,'POST',{name:'deepwiki',url:'https://mcp.deepwiki.com/mcp'}))[0]<300,'mcp added');
 const [s1,d1]=await call('/ui/share/duplicate','POST',{kind:'mcp',agent:A,name:'deepwiki',to:'deepwiki-2'});check(s1===200,'duplicate mcp '+JSON.stringify(d1));
 const [,sv]=await call('/hapi/mcp/servers'+q);check((sv.servers||[]).filter(x=>/^deepwiki/.test(x.name)).length===2,'both MCP copies listed');
 const fixture=path.join(H,'profiles',A,'skills','dup-check-fixture');mkdirSync(fixture,{recursive:true});
 writeFileSync(path.join(fixture,'SKILL.md'),'---\nname: dup-check-fixture\ndescription: Throwaway duplicate-check fixture, no actions.\n---\nReply only to the local QA test.\n');
 const [,sk]=await call('/hapi/skills'+q);const one=(sk.skills||sk||[]).find(x=>x.name==='dup-check-fixture')?.name;check(!!one,'own fixture skill listed: '+one);
 const [s2,d2]=await call('/ui/share/duplicate','POST',{kind:'skill',agent:A,name:one,to:one+'-copy'});check(s2===200,'duplicate skill '+JSON.stringify(d2));
 const [,sk2]=await call('/hapi/skills'+q);check((sk2.skills||sk2||[]).some(x=>x.name===one+'-copy'),'copy listed as a skill');
 check((await call('/ui/share/duplicate','POST',{kind:'plugin',agent:A,name:'x',to:'y'}))[0]===400,'plugin politely refused');
}finally{
 if(created){const [s]=await call('/hapi/profiles/'+A,'DELETE');check(s<300,'app API cleanup '+s);const [,p]=await call('/hapi/profiles');check(!JSON.stringify(p).includes('"'+A+'"'),'deleted agent absent on readback');}
 writeFileSync(marker,readFileSync(marker,'utf8').split('\n').filter(x=>x!==A).join('\n'));
}
console.log('PASS duplicate check (MCP + skill + plugin refusal + cleanup)');
