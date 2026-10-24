const endpoint='http://127.0.0.1:4317/api/development';
let board=await fetch(endpoint).then(r=>r.json());
const title=process.env.TRACKER_TITLE||'Local AI connection tester (separate prototype)';
let task=board.tasks.find(t=>t.title===title);
async function mutate(data){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,revision:board.revision})});board=await r.json();if(!r.ok)throw Error(board.error);task=board.tasks.find(t=>t.title===title)}
if(!task)await mutate({action:'create',title,acceptance:process.env.TRACKER_ACCEPTANCE||'Separate localhost app discovers installed Codex and Claude Code, checks subscription login, sends text prompts through official CLIs, displays real responses/errors, and offers comparison without API fallback. Verify browser and at least one live provider response; report unconnected providers honestly.'});
await mutate({action:'update',id:task.id,status:['backlog','in_progress','review','blocked','done'].includes(process.argv[2])?process.argv[2]:'in_progress',priority:'P1',notes:process.argv[3]||'Building separate A Kill Code prototype and locating the installed official tools.'});
console.log('Tracker updated:',task.id,task.status);
