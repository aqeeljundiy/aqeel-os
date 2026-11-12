// Every copy of a shipped engine plugin stays the shipped version (app/plugin-sync.mjs, scripts/plugin-sync.mjs; 12 Nov 2026: copies were made once
// and never updated, so a fix to the Claude sign-in plugin reached no agent of one install for weeks). What is proven here: a stale copy is
// updated and its old files are kept once; nothing that is not a shipped file is touched; a home without the plugin does not get it; a file the
// app may not write is written as the agent's own user; a copy that stays different is reported with the reason; a second pass changes nothing;
// the engine reload is asked for once and shown per agent until the engine restarted. Run: node --test scripts/plugin-sync.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat,symlink,rm,utimes} from 'node:fs/promises';
import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createPluginSync,shipped,SKIP} from '../app/plugin-sync.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url)),REPO=path.join(HERE,'..');
const put=async(f,t)=>{await mkdir(path.dirname(f),{recursive:true});await writeFile(f,t)};
const text=f=>readFile(f,'utf8').catch(()=>null);
const tree=async(d,rel='')=>{const out=[];for(const e of await readdir(path.join(d,rel),{withFileTypes:true}).catch(()=>[])){const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())out.push(...await tree(d,r));else out.push(r)}return out.sort()};
// a made-up install: the shipped plugins "harbor-model" (several files) and "harbor-note", the engine home and two agents
async function make(o={}){const T=await mkdtemp(path.join(tmpdir(),'plugsync-')),E=path.join(T,'engine'),H=path.join(T,'hermes'),D=path.join(T,'data');
 await put(path.join(E,'harbor-model','plugin.yaml'),'name: harbor-model\nversion: 0.4.0\n');await put(path.join(E,'harbor-model','__init__.py'),'NEW = 2\n');
 await put(path.join(E,'harbor-model','wire.py'),'HEADERS = ["x-fixed"]\n');await put(path.join(E,'harbor-model','tests','test_wire.py'),'def test(): pass\n');
 await put(path.join(E,'harbor-model','__pycache__','wire.cpython-311.pyc'),'cache');await put(path.join(E,'harbor-model','wire.py.bak-20261112'),'left by a person');
 await put(path.join(E,'harbor-note','plugin.yaml'),'name: harbor-note\nversion: "0.1.0"\n');await put(path.join(E,'harbor-note','__init__.py'),'NOTE = 1\n');
 await put(path.join(E,'patches','README.md'),'not a plugin: no plugin.yaml');
 const homeOf=a=>a==='default'?H:path.join(H,'profiles',a);const cfg={default:{plugins:{enabled:['harbor-model','harbor-note']}},'cove-support':{plugins:{enabled:['harbor-model']},terminal:{ssh_user:'ag-cove-support'}},'reef-sales':{plugins:{enabled:[]}}};
 // the engine home: an old copy of both; cove-support: an old harbor-model only; reef-sales: no plugin at all
 for(const a of ['default','cove-support']){const d=path.join(homeOf(a),'plugins','harbor-model');await put(path.join(d,'plugin.yaml'),'name: harbor-model\nversion: 0.3.0\n');await put(path.join(d,'__init__.py'),'NEW = 2\n');await put(path.join(d,'wire.py'),'HEADERS = []\n')}
 await put(path.join(H,'plugins','harbor-note','plugin.yaml'),'name: harbor-note\nversion: "0.1.0"\n');await put(path.join(H,'plugins','harbor-note','__init__.py'),'NOTE = 1\n');
 await mkdir(path.join(homeOf('reef-sales'),'plugins'),{recursive:true});
 const calls={restart:[],note:[],solved:0,run:[],log:[]};let clock=1_700_000_000_000,engine=0;
 const ps=createPluginSync({HERMES_HOME:H,DATA:D,engineDir:E,homeOf,readConfig:async a=>cfg[a]||null,pick:(c,k)=>k.split('.').reduce((x,y)=>x&&typeof x==='object'?x[y]:undefined,c),
  engineStart:async()=>engine,restartLater:async w=>{calls.restart.push(w)},isTest:async a=>a==='aq-livetest',note:async(t,d)=>{calls.note.push([t,d])},solved:async()=>{calls.solved++},
  holdDir:path.join(T,'deploy.lock'),now:()=>clock,log:m=>calls.log.push(m),...o});
 return {T,E,H,D,homeOf,cfg,calls,ps,engineAt:t=>{engine=t},tick:ms=>{clock+=ms},o}}
const copy=(x,a,p='harbor-model')=>path.join(x.homeOf(a),'plugins',p);

test('the shipped list: every folder of engine/ with a plugin.yaml, its files without caches and backups; version and one hash per plugin',async()=>{const x=await make();
 const l=await shipped(x.E);assert.deepEqual(l.map(p=>p.name),['harbor-model','harbor-note']);assert.deepEqual(l[0].files.map(f=>f.rel),['__init__.py','plugin.yaml','tests/test_wire.py','wire.py']);
 assert.equal(l[0].version,'0.4.0');assert.equal(l[1].version,'0.1.0');assert.match(l[0].hash,/^[0-9a-f]{16}$/);
 await put(path.join(x.E,'harbor-model','wire.py'),'HEADERS = ["x-fixed","x-more"]\n');assert.notEqual((await shipped(x.E))[0].hash,l[0].hash,'a changed file changes the plugin hash');
 for(const f of ['__pycache__/a.pyc','a/.venv/x','wire.py.bak-20261112','wire.py.bak','run.log','x.tmp','.pytest_cache/v','a.orig'])assert.ok(SKIP.test(f),f);
 for(const f of ['wire.py','assets/card.png','bili.json','tests/test_wire.py','backup_models.py'])assert.ok(!SKIP.test(f),f);
 // the real repo: the plugins it ships, never the patches folder
 const real=(await shipped(path.join(REPO,'engine'))).map(p=>p.name);for(const n of ['claude-subscription-directsdk-experimental','aqeelos-live','aqeelos-group-context','aqeelos-main-rule','gemini-subscription','antigravity-subscription'])assert.ok(real.includes(n),n);
 assert.ok(!real.includes('patches'));await rm(x.T,{recursive:true,force:true})});

test('update: a stale copy becomes the shipped version in the engine home and in the agent\'s own copy, and its old files are kept once',async()=>{const x=await make();
 const r=await x.ps.sync();assert.deepEqual(r.updated.map(c=>c.agent+'/'+c.plugin).sort(),['cove-support/harbor-model','default/harbor-model']);assert.equal(r.differs.length,0);
 for(const a of ['default','cove-support']){assert.equal(await text(path.join(copy(x,a),'wire.py')),'HEADERS = ["x-fixed"]\n');assert.match(await text(path.join(copy(x,a),'plugin.yaml')),/0\.4\.0/);
  assert.equal(await text(path.join(copy(x,a),'tests','test_wire.py')),'def test(): pass\n','a shipped file the copy lacked is added');
  // the one backup: the replaced files as they were (the unchanged __init__.py and the file that did not exist are not in it)
  assert.deepEqual(await tree(path.join(x.D,'plugin-sync','prev',a,'harbor-model')),['plugin.yaml','wire.py']);assert.equal(await text(path.join(x.D,'plugin-sync','prev',a,'harbor-model','wire.py')),'HEADERS = []\n')}
 assert.deepEqual((await tree(copy(x,'default'))).filter(f=>/aq-sync|\.tmp$/.test(f)),[],'no half-written file stays behind');
 // recorded per copy: the plugin, its version and hash, when
 const st=JSON.parse(await text(path.join(x.D,'plugin-sync.json')));const sh=(await shipped(x.E))[0];
 assert.deepEqual(Object.keys(st.copies).sort(),['cove-support/harbor-model','default/harbor-model','default/harbor-note']);
 assert.equal(st.copies['cove-support/harbor-model'].version,'0.4.0');assert.equal(st.copies['cove-support/harbor-model'].hash,sh.hash);assert.equal(st.copies['cove-support/harbor-model'].status,'same');assert.equal(st.copies['cove-support/harbor-model'].files,3);
 assert.deepEqual(st.shipped['harbor-model'],{version:'0.4.0',hash:sh.hash});
 // the next version: the backup holds the version before it, not the first one
 await put(path.join(x.E,'harbor-model','wire.py'),'HEADERS = ["x-fixed","x-more"]\n');await x.ps.sync();
 assert.deepEqual(await tree(path.join(x.D,'plugin-sync','prev','default','harbor-model')),['wire.py']);assert.equal(await text(path.join(x.D,'plugin-sync','prev','default','harbor-model','wire.py')),'HEADERS = ["x-fixed"]\n');
 await rm(x.T,{recursive:true,force:true})});

test('never touched: state, sign-ins, caches, a profile\'s own assets, backups, files the repo does not ship, and other plugins',async()=>{const x=await make();
 const own={'assets/card.png':'PNG of this profile','bili.json':'{"proxyScript":"/opt/x.js"}','wire.py.bak-20261112':'HEADERS = [] # by hand','__pycache__/wire.cpython-311.pyc':'old cache','state.json':'{"runs":3}','.credentials.json':'{"token":"made-up"}','dropped_by_repo.py':'OLD = 1\n'};
 for(const [f,t] of Object.entries(own))await put(path.join(copy(x,'cove-support'),f),t);
 const outside={'plugins/.install-metadata.json':'{"pinned":true}','plugins/their-own-plugin/plugin.yaml':'name: their-own-plugin\n','plugins/their-own-plugin/__init__.py':'X = 1\n','config.yaml':'plugins: {}\n','.env':'KEY=made-up\n'};
 for(const [f,t] of Object.entries(outside))await put(path.join(x.homeOf('cove-support'),f),t);
 const before=Object.fromEntries(await Promise.all(Object.keys(own).map(async f=>[f,(await stat(path.join(copy(x,'cove-support'),f))).mtimeMs])));
 await x.ps.sync();
 for(const [f,t] of Object.entries(own)){assert.equal(await text(path.join(copy(x,'cove-support'),f)),t,f);assert.equal((await stat(path.join(copy(x,'cove-support'),f))).mtimeMs,before[f],f+' was not rewritten')}
 for(const [f,t] of Object.entries(outside))assert.equal(await text(path.join(x.homeOf('cove-support'),f)),t,f);
 assert.equal(await text(path.join(copy(x,'cove-support'),'wire.py')),'HEADERS = ["x-fixed"]\n','the shipped file beside them was updated');
 // what the repo's folder holds beside the shipped files never reaches a copy
 assert.deepEqual((await tree(copy(x,'default'))).filter(f=>/pycache|\.bak/.test(f)),[]);assert.equal(await text(path.join(x.H,'plugins','patches','README.md')),null);
 await rm(x.T,{recursive:true,force:true})});

test('a home without the plugin does not get it; only a home named in add does (the installer: the engine home)',async()=>{const x=await make();
 const r=await x.ps.sync();assert.deepEqual(await readdir(path.join(x.homeOf('reef-sales'),'plugins')),[],'reef-sales opted into nothing and has nothing');
 assert.equal(await text(path.join(copy(x,'cove-support','harbor-note'),'plugin.yaml')),null,'cove-support has harbor-model only');assert.ok(!r.copies.some(c=>c.agent==='reef-sales'));
 // a folder of that name without a plugin.yaml is not a copy either
 await mkdir(copy(x,'reef-sales','harbor-note'),{recursive:true});await x.ps.sync();assert.deepEqual(await readdir(copy(x,'reef-sales','harbor-note')),[]);
 const y=await make();await rm(path.join(y.H,'plugins','harbor-note'),{recursive:true});
 const a=await y.ps.sync({add:{default:['harbor-note']}});assert.deepEqual(a.copies.filter(c=>c.status==='added').map(c=>c.agent+'/'+c.plugin),['default/harbor-note']);
 assert.equal(await text(path.join(y.H,'plugins','harbor-note','__init__.py')),'NOTE = 1\n');assert.equal(await text(path.join(copy(y,'cove-support','harbor-note'),'plugin.yaml')),null,'adding to the engine home adds to no agent');
 assert.equal(await text(path.join(y.D,'plugin-sync','prev','default','harbor-note','plugin.yaml')),null,'nothing to keep for a new copy');
 await rm(x.T,{recursive:true,force:true});await rm(y.T,{recursive:true,force:true})});

test('a copy the app may not write is written as the agent\'s own user, over ssh, beside the file and renamed over it',async()=>{const ran=[];
 const denied=f=>f.includes(path.join('profiles','cove-support'));const fs=await import('node:fs/promises');
 const io={mkdir:fs.mkdir,rename:fs.rename,writeFile:async(f,b,o)=>{if(denied(f))throw Object.assign(Error('EACCES: permission denied'),{code:'EACCES'});return fs.writeFile(f,b,o)}};
 // the stand-in for ssh: checks the command and does what the agent's user would
 const run=async(args,input)=>{ran.push({args,input});const cmd=args[args.length-1],m=/cat > '([^']+)' && chmod (\d+) '([^']+)' && mv -f '([^']+)' '([^']+)'$/.exec(cmd);assert.ok(m,cmd);assert.equal(m[1],m[3]);assert.equal(m[1],m[4]);assert.equal(m[1],m[5]+'.aq-sync.tmp');
  await fs.mkdir(path.dirname(m[5]),{recursive:true});await fs.writeFile(m[1],input);await fs.rename(m[1],m[5]);return true};
 const x=await make({io,run});const r=await x.ps.sync();
 const c=r.updated.find(c=>c.agent==='cove-support');assert.equal(c.by,'agent');assert.equal(r.updated.find(c=>c.agent==='default').by,'app');assert.equal(r.differs.length,0);
 assert.equal(await text(path.join(copy(x,'cove-support'),'wire.py')),'HEADERS = ["x-fixed"]\n');assert.equal(ran.length,3,'the three files that differed, nothing else');
 for(const {args,input} of ran){assert.equal(args[args.length-2],'ag-cove-support@127.0.0.1');assert.ok(args.includes('BatchMode=yes'));assert.equal(args[args.indexOf('-i')+1],path.join(x.H,'agent-ssh','id_ed25519'));assert.ok(Buffer.isBuffer(input))}
 assert.ok(!ran.some(c=>c.args[c.args.length-1].includes('HEADERS')),'the content goes over ssh\'s input, never on the command line');
 assert.match(x.calls.log.join('\n'),/cove-support\/harbor-model updated to 0\.4\.0 \(3 file\(s\), written as the agent’s own user\)/);
 await rm(x.T,{recursive:true,force:true})});

test('drift: a copy nobody may write is reported with the reason, on Health as one item and on the agent\'s row, until it is the shipped version',async()=>{let locked=true;const fs=await import('node:fs/promises');
 const io={mkdir:fs.mkdir,rename:fs.rename,writeFile:async(f,b,o)=>{if(locked&&f.includes(path.join('profiles','cove-support')))throw Object.assign(Error('EACCES'),{code:'EACCES'});return fs.writeFile(f,b,o)}};
 const x=await make({io,run:async()=>false});
 // looking only: nothing is changed, both stale copies are listed
 const c=await x.ps.sync({check:true});assert.deepEqual(c.differs.map(d=>d.agent).sort(),['cove-support','default']);assert.equal(await text(path.join(copy(x,'default'),'wire.py')),'HEADERS = []\n');assert.equal(await text(path.join(x.D,'plugin-sync.json')),null);
 const r=await x.ps.tick();assert.deepEqual(r.differs.map(d=>d.agent+'/'+d.plugin),['cove-support/harbor-model']);assert.match(r.differs[0].reason,/^not writable \(also not as the agent’s own user\)$/);
 assert.deepEqual(r.differs[0].files.sort(),['plugin.yaml','tests/test_wire.py','wire.py']);assert.equal(await text(path.join(copy(x,'cove-support'),'wire.py')),'HEADERS = []\n');
 assert.equal(x.calls.note.length,1);assert.equal(x.calls.note[0][0],'1 plugin copy differs from the shipped version');assert.match(x.calls.note[0][1],/harbor-model of cove-support: not writable/);
 assert.equal(JSON.parse(await text(path.join(x.D,'plugin-sync.json'))).copies['cove-support/harbor-model'].status,'differs');
 assert.match(x.ps.line('cove-support').text,/Plugin older than shipped: harbor-model \(not writable/);assert.equal(x.ps.line('cove-support').warn,true);assert.equal(x.ps.line('reef-sales'),null);
 await x.ps.tick();assert.equal(x.calls.note.length,1,'the same difference is one item, not one per pass');assert.equal(x.calls.solved,0);
 // an agent without a Linux user of its own says so
 delete x.cfg['cove-support'].terminal;assert.match((await x.ps.tick()).differs[0].reason,/the folder is not the app’s to write/);assert.equal(x.calls.note.length,2);
 locked=false;const ok=await x.ps.tick();assert.equal(ok.differs.length,0);assert.equal(x.calls.solved,1);assert.equal(x.ps.line('cove-support'),null);assert.equal(await text(path.join(copy(x,'cove-support'),'wire.py')),'HEADERS = ["x-fixed"]\n');
 await x.ps.tick();assert.equal(x.calls.solved,1);await rm(x.T,{recursive:true,force:true})});

test('idempotent: a second pass writes nothing, keeps the backup and reports every copy as the shipped version',async()=>{const x=await make();await x.ps.sync();
 const files=['plugin.yaml','wire.py','__init__.py','tests/test_wire.py'],times=async()=>Promise.all(['default','cove-support'].flatMap(a=>files.map(async f=>(await stat(path.join(copy(x,a),f))).mtimeMs)));
 const t0=await times(),b0=await tree(path.join(x.D,'plugin-sync','prev'));x.tick(60e3);
 const r=await x.ps.sync();assert.equal(r.updated.length,0);assert.equal(r.differs.length,0);assert.deepEqual(r.copies.map(c=>c.status),['same','same','same']);
 assert.deepEqual(await times(),t0);assert.deepEqual(await tree(path.join(x.D,'plugin-sync','prev')),b0);
 const st=JSON.parse(await text(path.join(x.D,'plugin-sync.json')));assert.equal(st.copies['default/harbor-model'].updated,1_700_000_000_000,'when it was updated stays the first pass');
 await rm(x.T,{recursive:true,force:true})});

test('after an update the reload is asked for once, the agent\'s row says "reload pending" until the engine restarted, and a deploy in progress is left alone',async()=>{const x=await make();
 x.engineAt(Date.now()-3600e3);   // the engine started an hour ago, before the files below are written
 // harbor-note was written long before the engine started and is not updated: it never waits for a reload
 const old=new Date(Date.now()-7200e3);for(const f of ['plugin.yaml','__init__.py'])await utimes(path.join(x.H,'plugins','harbor-note',f),old,old);
 const r=await x.ps.tick();assert.deepEqual(r.pending,{default:['harbor-model'],'cove-support':['harbor-model']});
 assert.deepEqual(x.calls.restart,['plugin update (harbor-model) for 2 agent(s)']);await x.ps.tick();assert.deepEqual([...new Set(x.calls.restart)],['plugin update (harbor-model) for 2 agent(s)'],'the same reason every pass: restart-later keeps it once');
 assert.match(x.ps.line('cove-support').text,/^Plugin updated, reload pending: harbor-model \(the engine reloads in the maintenance window\)$/);assert.equal(x.ps.line('cove-support').warn,false);assert.equal(x.ps.line('reef-sales'),null);
 // a plugin that is switched off for an agent needs no reload
 x.cfg.default.plugins.enabled=['harbor-note'];assert.deepEqual(await x.ps.pending(),{'cove-support':['harbor-model']});
 // the engine restarted: nothing waits
 const n=x.calls.restart.length;x.engineAt(Date.now()+60e3);const done=await x.ps.tick();assert.deepEqual(done.pending,{});assert.equal(x.ps.line('cove-support'),null);assert.equal(x.calls.restart.length,n);
 // no engine running: nothing to reload
 x.engineAt(0);assert.deepEqual(await x.ps.pending(),{});
 // the test agent alone never restarts the engine
 const y=await make();y.cfg['aq-livetest']={plugins:{enabled:['harbor-model']}};await put(path.join(copy(y,'aq-livetest'),'plugin.yaml'),'name: harbor-model\nversion: 0.1.0\n');
 for(const a of ['default','cove-support'])y.cfg[a].plugins.enabled=[];y.engineAt(Date.now()-3600e3);const t=await y.ps.tick();assert.deepEqual(Object.keys(t.pending),['aq-livetest']);assert.deepEqual(y.calls.restart,[]);
 // while a deploy is between its switch and the end of its live test the app's pass does nothing (the deploy runs the pass itself afterwards)
 const timers=[];const z=await make({again:(fn,ms)=>timers.push([fn,ms])});await mkdir(path.join(z.T,'deploy.lock'));const now=new Date(1_700_000_000_000);await utimes(path.join(z.T,'deploy.lock'),now,now);
 assert.deepEqual(await z.ps.tick(),{skipped:true});assert.equal(await text(path.join(copy(z,'default'),'wire.py')),'HEADERS = []\n');
 assert.deepEqual(await z.ps.tick(),{skipped:true});assert.deepEqual(timers.map(t=>t[1]),[5*60e3],'it looks again once, 5 minutes later');
 await rm(path.join(z.T,'deploy.lock'),{recursive:true});await timers[0][0]();await new Promise(r=>setTimeout(r,300));assert.equal(await text(path.join(copy(z,'default'),'wire.py')),'HEADERS = ["x-fixed"]\n','the deploy ended: the pass that waited ran');
 const w=await make();await mkdir(path.join(w.T,'deploy.lock'));await utimes(path.join(w.T,'deploy.lock'),now,now);w.tick(21*60e3);assert.equal((await w.ps.tick()).updated.length,2,'a lock nobody touched for 20 minutes is a dead one');await rm(w.T,{recursive:true,force:true});
 for(const v of [x,y,z])await rm(v.T,{recursive:true,force:true})});

test('an agent\'s extra-number copy shares its agent\'s plugins folder through a link: counted once, never written twice',{skip:process.platform==='win32'},async()=>{const x=await make();
 await mkdir(x.homeOf('cove-support--wa2'),{recursive:true});await symlink(path.join(x.homeOf('cove-support'),'plugins'),path.join(x.homeOf('cove-support--wa2'),'plugins'));
 const r=await x.ps.sync();assert.deepEqual(r.copies.map(c=>c.agent).sort(),['cove-support','default','default']);await rm(x.T,{recursive:true,force:true})});

test('the command: the installer adds the Claude plugin to the engine home only and updates stale copies; --check lists what differs and changes nothing',async()=>{
 const T=await mkdtemp(path.join(tmpdir(),'plugsync-cli-')),H=path.join(T,'hermes'),D=path.join(T,'data'),P='claude-subscription-directsdk-experimental';
 const env={...process.env,HERMES_HOME:H,UI_DATA_DIR:D},run=(...a)=>spawnSync(process.execPath,[path.join(HERE,'plugin-sync.mjs'),...a],{env,encoding:'utf8'});
 // an agent with an old copy of the Claude plugin, one without any plugin
 await put(path.join(H,'profiles','cove-support','plugins',P,'plugin.yaml'),'name: old\n');await put(path.join(H,'profiles','cove-support','plugins',P,'directsdk.py'),'# weeks old\n');await mkdir(path.join(H,'profiles','reef-sales','plugins'),{recursive:true});
 const c=run('--check');assert.equal(c.status,1,c.stderr);assert.match(c.stdout,new RegExp('! plugin '+P+' of cove-support: differs from the shipped version'));assert.equal(await text(path.join(H,'profiles','cove-support','plugins',P,'directsdk.py')),'# weeks old\n');
 const r=run('--ensure',P);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/1 updated/);assert.match(r.stdout,/1 added/);
 const want=readFileSync(path.join(REPO,'engine',P,'directsdk.py'),'utf8');assert.equal(await text(path.join(H,'plugins',P,'directsdk.py')),want);assert.equal(await text(path.join(H,'profiles','cove-support','plugins',P,'directsdk.py')),want);
 assert.deepEqual(await readdir(path.join(H,'plugins')),[P],'no other shipped plugin was added to the engine home');assert.deepEqual(await readdir(path.join(H,'profiles','reef-sales','plugins')),[]);
 assert.equal(await text(path.join(D,'plugin-sync','prev','cove-support',P,'directsdk.py')),'# weeks old\n');
 const again=run('--ensure',P);assert.equal(again.status,0);assert.match(again.stdout,/2 copies, 2 already the shipped version$/m);assert.equal(run('--check').status,0);
 await rm(T,{recursive:true,force:true})});

test('wiring: the installer, a deploy and the app all use this one mechanism',()=>{const read=f=>readFileSync(path.join(REPO,f),'utf8');
 const inst=read('scripts/install.sh');assert.match(inst,/node "\$APP\/scripts\/plugin-sync\.mjs" --ensure "\$P"/);assert.doesNotMatch(inst,/ok "already there"/);assert.doesNotMatch(inst,/cp -a "\$APP\/engine\/\$P"/);
 // a deploy: after the live test passed (H8), and it can never fail the deploy
 const live=read('scripts/box-live.sh');const i=live.indexOf('scripts/plugin-sync.mjs) || echo "! plugin sync');assert.ok(i>live.indexOf('\nAQ_STAGE=done'),'after the live test');
 const srv=read('app/server.mjs');assert.match(srv,/\.add\('plugin sync',\{run:\(\)=>pluginSync\.tick\(\),reads:\['plugins'\]\}\)/);assert.match(srv,/createAgentHealth\(\{pluginLine:a=>pluginSync\.line\(a\),/);
 assert.match(srv,/createPluginSync\(\{DATA,engineDir:path\.join\(root,'engine'\),readConfig,pick,restartLater,isTest:isTestAgent,nameOf:agentName,enginePid:gatewayPid,bottlenecks\}\)/);
 assert.match(read('app/health-page.js'),/r\.plugins\?'<div class="ah-post'\+\(r\.plugins\.warn\?' warn':''\)/)});
