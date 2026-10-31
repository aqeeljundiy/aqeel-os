// Sits in front of AdsPower's official MCP server (started by adspower-mcp.sh) and answers a tool call itself, in plain
// words, while the agent's own AdsPower is not signed in: AdsPower opens its Local API only after someone signs in, so
// the official server would only say "fetch failed" (1 Nov 2026). Everything else passes straight through, line by line.
// Usage: node adspower-mcp-guard.mjs <command> [args...]   Env: PORT (the Local API port), ADSPOWER_NAME (the agent).
import {spawn} from 'node:child_process';
import {connect} from 'node:net';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';

const PORT=Number(process.env.PORT)||50325,WHO=process.env.ADSPOWER_NAME||process.env.ADSPOWER_AGENT||'this agent';
export const NOT_SIGNED_IN=who=>`AdsPower on ${who}'s screen is not signed in yet: open its screen and sign in. Ask the person to open ${who}'s screen in aqeelOS and sign in to AdsPower there themselves (never ask for the password in chat), then try again.`;
export const guardReply=(msg,up)=>msg&&msg.method==='tools/call'&&msg.id!==undefined&&!up?{jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:NOT_SIGNED_IN(WHO)}],isError:true}}:null;
const apiUp=()=>new Promise(res=>{const c=connect(PORT,'127.0.0.1');const done=v=>{c.destroy();res(v)};c.setTimeout(1500);c.once('connect',()=>done(true));c.once('error',()=>done(false));c.once('timeout',()=>done(false))});

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv[2]){   // run as the script, not when a test imports it
 const child=spawn(process.argv[2],process.argv.slice(3),{stdio:['pipe','pipe','inherit']});
 child.on('exit',c=>process.exit(c??1));child.on('error',e=>{console.error(e.message);process.exit(1)});
 const out=l=>process.stdout.write(l+'\n');   // whole lines only, so our answers never cut into the server's
 createInterface({input:child.stdout}).on('line',out);
 let chain=Promise.resolve();
 createInterface({input:process.stdin}).on('line',line=>{chain=chain.then(async()=>{let msg=null;try{msg=JSON.parse(line)}catch{}
   const r=msg&&msg.method==='tools/call'?guardReply(msg,await apiUp()):null;if(r)out(JSON.stringify(r));else child.stdin.write(line+'\n')})}).on('close',()=>chain.then(()=>child.stdin.end()))}
