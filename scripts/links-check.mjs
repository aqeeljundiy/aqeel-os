// Extra connections check: a throwaway agent gets a "Telegram 2" linked copy; checks sharing, hiding, rename, remove. Run on the box.
import {readFileSync,lstatSync,readlinkSync,existsSync} from "node:fs";
const B="http://127.0.0.1:4402",PW=readFileSync("/tmp/ppl/pw","utf8").trim(),A="lk-"+Date.now().toString(36).slice(-5),H=process.env.HOME+"/.hermes/profiles/";
const ck=(await fetch(B+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:PW})})).headers.get("set-cookie").split(";")[0];
const call=async(p,m="GET",b)=>{const r=await fetch(B+p,{method:m,headers:{"x-hui":"1",cookie:ck,"content-type":"application/json"},body:b?JSON.stringify(b):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return [r.status,j]};
const ok=(c,m)=>console.log(c?"✓":"✗",m);
try{
 ok((await call("/hapi/profiles","POST",{name:A,clone_from_default:false,no_skills:true}))[0]<300,"throwaway agent "+A);await call("/ui/accounts/setup-agent","POST",{name:A});
 const [s,l]=await call("/ui/channels/links","POST",{agent:A,platform:"telegram"});ok(s===200&&l.name===A+"--telegram-2","created "+JSON.stringify(l));
 const L=H+l.name;for(const f of ["memories","skills","plugins","home","workspace"])ok(existsSync(L+"/"+f)&&lstatSync(L+"/"+f).isSymbolicLink()&&readlinkSync(L+"/"+f)===H+A+"/"+f,"shares "+f);
 const mc=readFileSync(H+A+"/config.yaml","utf8"),lc=readFileSync(L+"/config.yaml","utf8");const mm=/model:[\s\S]*?default:\s*(\S+)/.exec(mc)?.[1],lm=/model:[\s\S]*?default:\s*(\S+)/.exec(lc)?.[1];ok(mm&&mm===lm,"same model "+lm);
 const [,pr]=await call("/hapi/profiles");ok(!(pr.profiles||[]).some(x=>x.name.includes("--")),"hidden from agent list");
 const [,ls]=await call("/ui/channels/links?agent="+A);ok(ls.links?.length===1,"listed under its agent");
 const [ps,pl]=await call("/hapi/messaging/platforms?profile="+l.name);ok(ps===200&&(pl.platforms||[]).some(x=>x.id==="telegram"),"its channel settings open");
 ok((await call("/ui/channels/links","PUT",{agent:A,name:l.name,label:"Shop Telegram"}))[1].label==="Shop Telegram","rename");
 ok((await call("/ui/channels/links","DELETE",{agent:A,name:l.name}))[0]===200,"remove");ok(!existsSync(L),"copy gone");ok(existsSync(H+A+"/memories"),"agent files untouched");
}finally{console.log("cleanup",(await call("/hapi/profiles/"+A,"DELETE"))[0])}
