import assert from 'node:assert/strict';
const base='http://127.0.0.1:4321';
assert.equal((await fetch(base)).status,200);
const {token,providers}=await fetch(base+'/api/status').then(r=>r.json());
assert.equal(providers.length,2);
assert.equal((await fetch(base+'/api/workspace')).status,403);
const workspace=await fetch(base+'/api/workspace',{headers:{'X-Local-Token':token}}).then(r=>r.json());
assert.ok(workspace.projects.length>0);
assert.equal((await fetch(base+'/api/workspace/file?projectId='+workspace.projects[0].id+'&path=../outside.html',{headers:{'X-Local-Token':token}})).status,400);
assert.equal((await fetch(base+'/assets/plus-jakarta-sans.woff2')).status,200);
const preview=await fetch(base+'/preview/'+workspace.projects[0].id+'/index.html');
if(preview.ok){assert.match(preview.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.match(preview.headers.get('content-security-policy'),/connect-src 'none'/)}
assert.equal((await fetch(base+'/api/login')).status,403);
assert.equal((await fetch(base+'/api/login',{headers:{'X-Local-Token':token}})).status,200);
assert.equal((await fetch(base+'/api/login/start',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':token},body:JSON.stringify({provider:'powershell'})})).status,400);
assert.equal((await fetch(base+'/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
assert.equal((await fetch(base+'/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':token,Origin:'http://untrusted.test'},body:'{}'})).status,403);
assert.equal((await fetch(base+'/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':token},body:JSON.stringify({provider:'codex',prompt:''})})).status,400);
console.log('HTTP checks passed: page, discovery, request token, origin, prompt validation.');
