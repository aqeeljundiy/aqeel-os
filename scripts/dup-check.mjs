// Duplicate check: MCP tool and skill copies on a throwaway agent; plugins refused. Run on the box.
import {readFileSync,existsSync} from "node:fs";
const B=process.env.BASE||"http://127.0.0.1:4402",PWF=process.env.PWFILE||"/tmp/ppl/pw";
// a staging copy that is not running (or no password file) is reported plainly, not a crash
if(!existsSync(PWF)){console.error("dup-check: no password file "+PWF+" (set PWFILE)");process.exit(2)}
try{await fetch(B+"/",{signal:AbortSignal.timeout(5000)})}catch(e){console.error("dup-check: nothing answers at "+B+" (set BASE): "+(e.cause?.code||e.message));process.exit(2)}
const PW=readFileSync(PWF,"utf8").trim(),A="dp-"+Date.now().toString(36).slice(-5),H=process.env.HOME+"/.hermes/profiles/";
const ck=(await fetch(B+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:PW})})).headers.get("set-cookie").split(";")[0];
const call=async(p,m="GET",b)=>{const r=await fetch(B+p,{method:m,headers:{"x-hui":"1",cookie:ck,"content-type":"application/json"},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(60000)});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return [r.status,j]};
const ok=(c,m)=>console.log(c?"✓":"✗",m);const q="?profile="+A;
try{ok((await call("/hapi/profiles","POST",{name:A,clone_from_default:false,no_skills:false}))[0]<300,"agent "+A);
 ok((await call("/hapi/mcp/servers"+q,"POST",{name:"deepwiki",url:"https://mcp.deepwiki.com/mcp"}))[0]<300,"mcp added");
 const [s1,d1]=await call("/ui/share/duplicate","POST",{kind:"mcp",agent:A,name:"deepwiki",to:"deepwiki-2"});ok(s1===200,"duplicate mcp "+JSON.stringify(d1));
 const [,sv]=await call("/hapi/mcp/servers"+q);ok((sv.servers||[]).filter(x=>/^deepwiki/.test(x.name)).length===2,"both listed: "+(sv.servers||[]).map(x=>x.name).join(","));
 const [,sk]=await call("/hapi/skills"+q);const one=(sk.skills||sk||[])[0]?.name;ok(!!one,"a skill to copy: "+one);
 const [s2,d2]=await call("/ui/share/duplicate","POST",{kind:"skill",agent:A,name:one,to:one+"-copy"});ok(s2===200,"duplicate skill "+JSON.stringify(d2));
 const [,sk2]=await call("/hapi/skills"+q);ok((sk2.skills||sk2||[]).some(x=>x.name===one+"-copy"),"copy listed as a skill");
 const [s3]=await call("/ui/share/duplicate","POST",{kind:"plugin",agent:A,name:"x",to:"y"});ok(s3===400,"plugin politely refused");
}finally{console.log("cleanup",(await call("/hapi/profiles/"+A,"DELETE"))[0])}
