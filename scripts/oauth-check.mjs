// MCP sign-in check: prepare a tool for sign-in (public return address), start it, read the result. Run on the box against the test copy.
import {readFileSync} from "node:fs";
const B="http://127.0.0.1:4402",PW=readFileSync("/tmp/ppl/pw","utf8").trim();
const ck=(await fetch(B+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:PW})})).headers.get("set-cookie").split(";")[0];
const call=async(p,m="GET",b)=>{const r=await fetch(B+p,{method:m,headers:{"x-hui":"1",cookie:ck,"content-type":"application/json"},body:b?JSON.stringify(b):undefined});return [r.status,await r.text()]};
console.log("prepare:",...await call("/ui/mcp/prepare-signin","POST",{agent:"default",name:"Slack"}));
const [s,t]=await call("/hapi/mcp/servers/Slack/auth?profile=default","POST",{});const j=JSON.parse(t);console.log("auth:",s,j.status,"| asks for app:",/client registration|client_id/i.test(j.error||""));
if(j.flow_id)await call("/hapi/mcp/oauth/flows/"+j.flow_id,"DELETE");
console.log("redirect shown to you:",(await call("/ui/mcp/oauth-redirect?name=Slack"))[1]);
