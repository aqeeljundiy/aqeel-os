// The agents' own scripts without a Kirimdev key (audit 12 Nov 2026, H3): app/agent-ops.mjs, app/agent-keys.mjs, and the engine hook
// for team approvals (H5). Run: node --test scripts/agent-ops.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createAgentOps,ensureTeamHook,teamHookHandler} from '../app/agent-ops.mjs';
import {createAgentKeys,MOVED} from '../app/agent-keys.mjs';

async function make(){const W=await mkdtemp(path.join(tmpdir(),'ao-'));await mkdir(path.join(W,'cove-support','.tools'),{recursive:true});await mkdir(path.join(W,'cove-support','.secrets'),{recursive:true});
 const read=[],sent=[],labels=[];
 const kirimdev={lines:async()=>({'cove-support':{phoneNumberId:'111',persona:'Rory',mode:'live'},'bay-sales':{phoneNumberId:'222',persona:'Gino',mode:'test'}}),_api:async p=>{read.push(p);return {data:[{id:'cnv_1'}]}},
  reply:async(a,to,text)=>{if(/Dari rules/.test(text))throw Error('Held: this was not sent to the customer');sent.push([a,to,text]);return [{id:'msg_1',status:'queued'}]},labelContact:async(a,o)=>{labels.push([a,o]);return {set:true}}};
 return {W,read,sent,labels,ops:createAgentOps({WORK:W,PORT:4400,sig:a=>'sig-'+a,kirimdev,log:()=>{}})}}

test('a script reads its own line only, and a send is a text through the guards; another line, another method and payments are refused',async()=>{const t=await make();const call=(req,a='cove-support')=>t.ops.call(a,req);
 assert.equal((await call({op:'kirim',method:'GET',path:'111/conversations?limit=50'})).status,200);assert.equal((await call({op:'kirim',method:'GET',path:'/111/messages?conversation_id=cnv_1&limit=10'})).status,200);assert.equal((await call({op:'kirim',method:'GET',path:'labels'})).status,200);
 assert.deepEqual(t.read,['111/conversations?limit=50','111/messages?conversation_id=cnv_1&limit=10','labels']);
 const other=await call({op:'kirim',method:'GET',path:'222/conversations'});assert.equal(other.status,403);assert.match(other.json.error,/another Kirimdev line/);
 for(const req of [{op:'kirim',method:'GET',path:'accounts'},{op:'kirim',method:'GET',path:'webhook_subscriptions'},{op:'kirim',method:'DELETE',path:'111/contacts/ctc_1'},{op:'kirim',method:'POST',path:'111/contacts/bulk_label',body:{}},{op:'kirim',method:'POST',path:'222/messages',body:{to:'628',type:'text',text:{body:'hi'}}},
  {op:'kirim',method:'POST',path:'111/messages',body:{to:'628',type:'image',image:{link:'https://x/qr.png'}}},{op:'tripay',amount:10000},{op:'payment'}])assert.ok((await call(req)).status>=400,JSON.stringify(req));
 assert.equal(t.read.length,3);
 assert.equal((await call({op:'kirim',method:'POST',path:'111/messages',body:{to:'628123',type:'text',text:{body:'Halo kak'}}})).json.sent,1);assert.deepEqual(t.sent,[['cove-support','628123','Halo kak']]);
 const held=await call({op:'kirim',method:'POST',path:'111/messages',body:{to:'628123',type:'text',text:{body:'Dari rules: x'}}});assert.equal(held.status,403);assert.match(held.json.error,/not sent to the customer/);
 await call({op:'label',conversationId:'cnv_1',add:['New Leads']});assert.equal(t.labels[0][1].source,'agent');
 assert.equal((await call({op:'whoami'})).json.line,'111');assert.equal((await call({op:'whoami'},'nobody')).status,404)});
test('the helper scripts are written only once the key has left the agent\'s folder, and hold an address, never a key',async()=>{const t=await make();
 await writeFile(path.join(t.W,'cove-support','.secrets','KIRIMDEV_API_KEY'),'kdv_old\n');await writeFile(path.join(t.W,'cove-support','.tools','kirim_cli.py'),'old script');
 assert.equal(await t.ops.ensureClients(),0);assert.equal(await readFile(path.join(t.W,'cove-support','.tools','kirim_cli.py'),'utf8'),'old script');
 const {unlink}=await import('node:fs/promises');await unlink(path.join(t.W,'cove-support','.secrets','KIRIMDEV_API_KEY'));
 assert.equal(await t.ops.ensureClients(),3);const cli=await readFile(path.join(t.W,'cove-support','.tools','kirim_cli.py'),'utf8');
 assert.match(cli,/http:\/\/127\.0\.0\.1:4400\/agent-ops\/cove-support\/sig-cove-support/);assert.doesNotMatch(cli,/kdv_|secrets|Bearer/);assert.match(await readFile(path.join(t.W,'cove-support','.tools','kirim'),'utf8'),/kirim_cli\.py" cove-support "\$@"/);
 assert.equal(await t.ops.ensureClients(),0,'unchanged files are left alone')});
test('agent keys: the app\'s own folder first, mode 600; the workspace only until the migration; names are checked',async()=>{const t=await make(),D=path.join(t.W,'data');const said=[];const k=createAgentKeys({DATA:D,WORK:t.W,log:m=>said.push(m)});
 await writeFile(path.join(t.W,'cove-support','.secrets','TRIPAY_API_KEY'),'in-workspace\n');
 assert.equal(await k.get('cove-support','TRIPAY_API_KEY'),'in-workspace');assert.equal(await k.where('cove-support','TRIPAY_API_KEY'),'workspace');await k.get('cove-support','TRIPAY_API_KEY');assert.equal(said.length,1,'said once');
 assert.deepEqual(await k.exposed(['cove-support']),[{agent:'cove-support',name:'TRIPAY_API_KEY'}]);
 await k.set('cove-support','TRIPAY_API_KEY','in-app');assert.equal(await k.get('cove-support','TRIPAY_API_KEY'),'in-app');assert.equal(await k.where('cove-support','TRIPAY_API_KEY'),'app');
 if(process.platform!=='win32')assert.equal((await stat(path.join(D,'agent-keys','cove-support','TRIPAY_API_KEY'))).mode&0o777,0o600);
 assert.equal(await k.get('cove-support','../../etc/passwd'),'');assert.equal(await k.get('../x','TRIPAY_API_KEY'),'');await assert.rejects(k.set('cove-support','lower','x'));assert.ok(MOVED.includes('KIRIMDEV_API_KEY'))});
test('the engine hook for team approvals only forwards who wrote what, to a signed local address',async()=>{const H=await mkdtemp(path.join(tmpdir(),'hk-'));
 assert.equal(await ensureTeamHook({HERMES_HOME:H,agent:'cove-support',url:'http://127.0.0.1:4400/team-message/cove-support/sig'}),2);assert.equal(await ensureTeamHook({HERMES_HOME:H,agent:'cove-support',url:'http://127.0.0.1:4400/team-message/cove-support/sig'}),0);
 const y=await readFile(path.join(H,'profiles','cove-support','hooks','aqeelos-team','HOOK.yaml'),'utf8'),h=teamHookHandler('http://127.0.0.1:4400/team-message/cove-support/sig');
 assert.match(y,/events:\n  - agent:start/);assert.match(h,/def handle\(event_type,context\):/);assert.match(h,/'userId':str\(context\.get\('user_id'\)/);assert.doesNotMatch(h,/draft|send|approve/i)});

// the migration that takes the keys out of the agents' folders: a dry run changes nothing; --apply moves, checks, then deletes
import {migrate} from './migrate-agent-keys.mjs';
test('migrate-agent-keys: dry run by default; apply moves the keys to the app, retires the scripts that read them, and never prints a key',async()=>{
 const R0=await mkdtemp(path.join(tmpdir(),'mg-')),DATA=path.join(R0,'data'),WORK=path.join(R0,'work'),HERMES=path.join(R0,'hermes'),W=path.join(WORK,'cove-support');
 for(const d of [DATA,path.join(W,'.secrets'),path.join(W,'.tools'),path.join(HERMES,'secrets'),path.join(HERMES,'profiles','cove-support')])await mkdir(d,{recursive:true});
 await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines:{'cove-support':{phoneNumberId:'111',mode:'test',payment:{min:10000,max:5000000,card:'.tools/card'}}}}));
 await writeFile(path.join(HERMES,'secrets','kirimdev.env'),'KIRIMDEV_API_KEY=kdv_secret_value\n');await writeFile(path.join(HERMES,'profiles','cove-support','.env'),'TELEGRAM_BOT_TOKEN=keepme\nKIRIMDEV_API_KEY=kdv_secret_value\nOTHER=1\n');
 for(const [n,v] of [['KIRIMDEV_API_KEY','kdv_secret_value'],['TRIPAY_API_KEY','tp_secret_value'],['TRIPAY_PRIVATE_KEY','tp_private_value'],['XENDIT_SECRET_KEY','xnd_secret_value'],['STORE_PASSWORD','stays-here']])await writeFile(path.join(W,'.secrets',n),v+'\n');
 await writeFile(path.join(W,'.tools','qris'),"key = (W / '.secrets/TRIPAY_API_KEY').read_text()\nMC = 'T12345'\n");await writeFile(path.join(W,'.tools','card'),"key = (W / '.secrets/XENDIT_SECRET_KEY').read_text()\n");
 await writeFile(path.join(W,'.tools','kirim.bak-1105'),'K="$(cat .secrets/KIRIMDEV_API_KEY)"');await writeFile(path.join(W,'.tools','sheet'),'no key here');
 const out=[];const dry=await migrate({DATA,WORK,HERMES,log:m=>out.push(m)});
 assert.ok(dry.steps.length>=7);assert.equal(dry.left,4);assert.equal((await readFile(path.join(W,'.secrets','TRIPAY_API_KEY'),'utf8')).trim(),'tp_secret_value','a dry run changes nothing');assert.equal(await stat(path.join(DATA,'agent-keys')).catch(()=>null),null);
 const done=await migrate({DATA,WORK,HERMES,apply:true,log:m=>out.push(m)});assert.equal(done.left,0);
 for(const n of ['KIRIMDEV_API_KEY','TRIPAY_API_KEY','TRIPAY_PRIVATE_KEY','XENDIT_SECRET_KEY'])assert.equal(await stat(path.join(W,'.secrets',n)).catch(()=>null),null,n+' left the workspace');
 assert.equal((await readFile(path.join(W,'.secrets','STORE_PASSWORD'),'utf8')).trim(),'stays-here','other keys are not touched');
 const keys=createAgentKeys({DATA,WORK,log:()=>{}});assert.equal(await keys.get('cove-support','TRIPAY_PRIVATE_KEY'),'tp_private_value');assert.equal(await keys.where('cove-support','XENDIT_SECRET_KEY'),'app');assert.deepEqual(await keys.list('cove-support'),['TRIPAY_API_KEY','TRIPAY_PRIVATE_KEY','XENDIT_SECRET_KEY']);
 assert.equal(await readFile(path.join(HERMES,'profiles','cove-support','.env'),'utf8'),'TELEGRAM_BOT_TOKEN=keepme\nOTHER=1\n');
 assert.match(await readFile(path.join(W,'.tools','qris'),'utf8'),/payments are made by aqeelOS itself/);assert.match(await readFile(path.join(W,'.tools','qris.before-keys-moved'),'utf8'),/T12345/);
 assert.equal(await stat(path.join(W,'.tools','kirim.bak-1105')).catch(()=>null),null);assert.equal(await readFile(path.join(W,'.tools','sheet'),'utf8'),'no key here');
 const conf=JSON.parse(await readFile(path.join(DATA,'kirimdev.json'),'utf8')).lines['cove-support'];assert.deepEqual(conf.payment.provider,{tripay:{merchantCode:'T12345',refPrefix:'BM'},xendit:{}});assert.equal(conf.payment.card,undefined);assert.equal(conf.mode,'test','the mode is not touched');
 assert.ok(!out.join('\n').match(/secret_value|private_value/),'no key is ever printed');
 const again=await migrate({DATA,WORK,HERMES,log:m=>out.push(m)});assert.equal(again.steps.length,0);assert.match(out.at(-1),/Nothing left to move/)});
