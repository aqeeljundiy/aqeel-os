// Local preview server for the Hermes UI mockup and its backlog board. Run: node server.mjs (PORT, default 4380)
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT)||4380;
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
const routes={'/':'mockup/index.html','/backlog':'backlog/index.html'};

createServer(async(req,res)=>{
 const url=new URL(req.url,'http://x');
 const rel=routes[url.pathname.replace(/\/$/,'')||'/']||url.pathname.slice(1);
 const file=path.resolve(root,rel);
 if(!file.startsWith(root+path.sep)||/(^|[\\/])\./.test(rel)){res.writeHead(404).end();return}
 try{const body=await readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(body)}
 catch{res.writeHead(404,{'content-type':'text/plain'}).end('Not found')}
}).listen(port,'127.0.0.1',()=>console.log(`Hermes UI mockup on http://127.0.0.1:${port} · board at /backlog`));
