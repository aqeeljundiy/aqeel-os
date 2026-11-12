// Backup size (13 Nov 2026). Elkiya's nightly archive grew from 9 GB to 28.6 GB (41 GB of files: reels, frames, browser kernels, virtual
// environments) and took 112 minutes a night. These tests pin what was done about it (app/backup-media.mjs, app/backup.mjs):
//   - only what is provably made again is left out, by name; a virtual environment is left out with its package list kept;
//   - large files that did not change are packed once into a media pack and only named in the next nights' manifests, and a single
//     night restores completely from its archive + the packs its manifest names;
//   - packs are binned only when no kept night names them, and never when that cannot be known;
//   - unreadable files are listed once with a reason; the Backups card gets sizes, durations, progress and the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync,utimesSync,chmodSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBackups,EXCLUDE_ALL,excluded,LEFTOVER} from '../app/backup.mjs';
import {isVenv,plainName,sqliteHead,md5File,EXCLUDE_MORE,excludeTester,scan,eligible,plan,forgetMissing,buildManifest,manifestPacks,prunable,dropNights,chunkBySize,parseSkips,reasonFor,passwdUids,mergeSkipped,summarizeSkipped,restoreMedia,emptyIndex,MEDIA_NAME,PACK_MIN,PACK_QUIET,PACK_GRACE,PACK_MAX,sha256File} from '../app/backup-media.mjs';

const TOOLS=(()=>{const r=spawnSync('bash',['-c','tar --version && openssl version && gzip --version'],{stdio:'ignore'});return r.status===0})();
const NEED={skip:!TOOLS&&'needs bash, tar, gzip and openssl'};
// the restore code hands its folders to bash, which needs POSIX paths (the reason backup-restore.test.mjs does not run on Windows either)
const POSIX={skip:(!TOOLS&&'needs bash, tar, gzip and openssl')||(process.platform==='win32'&&'paths are handed to bash')};
const fwd=p=>p.split(path.sep).join('/');
const NOW=Date.now(),DAY=864e5,old=p=>{const t=new Date(NOW-3*DAY);utimesSync(p,t,t)};
const put=(f,data)=>{mkdirSync(path.dirname(f),{recursive:true});writeFileSync(f,data)};

/* ---------- what is left out by name */
test('the exclusion list: the measured big re-creatable things are in, and nothing a person makes is',()=>{
 const t=excludeTester(EXCLUDE_ALL),ex=p=>{const c=p.split('/');return c.some((_,i)=>t(c.slice(0,i+1).join('/')))};   // tar leaves out a folder with what is in it
 for(const p of ['workspaces/.aqeelos-adspower/resources/app.asar','workspaces/agent-a/.config/adspower_global/cwd_global/chrome_153/SunBrowser','apps/hermes-ui-data/agent-trash/x/.config/adspower_global/cwd_global/chrome_152/components/a.pak',
  'workspaces/a/.browser/component_crx_cache/abc','workspaces/a/.browser/CertificateRevocation/10896/crl-set','workspaces/a/.browser/Safe Browsing/UrlSoceng.store','workspaces/a/.browser/BrowserMetrics-spare.pma','workspaces/a/.browser/Default/DawnWebGPUCache/index'])
  assert.equal(ex(p),true,p);
 for(const p of ['workspaces/a/work/reels/r00055.png','workspaces/a/.config/adspower_global/SharedStorage','workspaces/a/.browser/Default/Cookies','.hermes/profiles/x/memories/m.md','apps/hermes-ui-data/agent-trash/old-agent__2026.tgz','workspaces/a/notes/BrowserMetrics.txt.keep/x','workspaces/default/deck/.venv-notes.md'])
  assert.equal(ex(p),false,p);
 assert.deepEqual(EXCLUDE_ALL.slice(-EXCLUDE_MORE.length),EXCLUDE_MORE);
 // the restore preview treats those the same way inside .hermes: a box-only browser cache is not "a file that stays"
 assert.equal(excluded('profiles/x/.browser/component_crx_cache'),true)});

test('scan: excluded folders are not entered, and a virtual environment is not entered but its configuration and packages are recorded',async()=>{const T=mkdtempSync(path.join(tmpdir(),'aq-scan-'));try{
 put(T+'/workspaces/a/keep.txt','x');put(T+'/workspaces/a/node_modules/m/z.js','x');put(T+'/workspaces/a/.browser/component_crx_cache/c','x');put(T+'/workspaces/a/.browser/Default/Cookies','x');
 put(T+'/workspaces/a/.venv/pyvenv.cfg','home = /usr/bin\nversion = 3.12.3\n');mkdirSync(T+'/workspaces/a/.venv/lib/python3.12/site-packages/requests-2.32.0.dist-info',{recursive:true});mkdirSync(T+'/workspaces/a/.venv/lib/python3.12/site-packages/idna-3.7.dist-info',{recursive:true});put(T+'/workspaces/a/.venv/lib/python3.12/site-packages/requests/__init__.py','x');
 put(T+'/.hermes/config.yaml','a: 1');put(T+'/not-included/x','x');
 const r=await scan({root:T,include:['.hermes','workspaces','missing-folder'],excl:excludeTester(EXCLUDE_ALL)});
 assert.deepEqual(r.files.map(f=>f.rel).sort(),['.hermes/config.yaml','workspaces/a/.browser/Default/Cookies','workspaces/a/keep.txt']);
 assert.equal(r.venvs.length,1);assert.equal(r.venvs[0].path,'workspaces/a/.venv');assert.match(r.venvs[0].cfg,/version = 3\.12\.3/);assert.deepEqual(r.venvs[0].packages,['idna-3.7','requests-2.32.0']);
 assert.ok(r.files.every(f=>f.size>=0&&Number.isInteger(f.mtime)))}finally{rmSync(T,{recursive:true,force:true})}});

/* ---------- what goes to a pack */
const F=(rel,size,age=3*DAY)=>({rel,size,mtime:Math.floor(NOW-age)});
test('which files are kept in packs: large, quiet, not a database, a plain name',()=>{const o={now:NOW};
 assert.equal(eligible(F('workspaces/a/r1.png',PACK_MIN),o),true);
 assert.equal(eligible(F('workspaces/a/r1.png',PACK_MIN-1),o),false,'too small');
 assert.equal(eligible(F('workspaces/a/r1.png',PACK_MIN,PACK_QUIET-1000),o),false,'written in the last 3 hours');
 assert.equal(eligible(F('workspaces/a/r1.png',PACK_MIN,PACK_QUIET+1000),o),true);
 for(const db of ['.hermes/state.db','.hermes/state.db-wal','x/a.sqlite3','x/a.sqlite','x/x.pid','x/x.lock'])assert.equal(eligible(F(db,5e6),o),false,db);
 assert.equal(eligible(F('workspaces/a/we*ird.png',5e6),o),false,'a tar pattern character in the name stays in the archive');
 for(const own of ['apps/hermes-ui-data/backup-media.json','apps/hermes-ui-data/backup-media.json.last-good','apps/hermes-ui-data/backup-manifest.json'])assert.equal(eligible(F(own,5e6),o),false,own+': the index and the manifest copy change every night');
 assert.equal(eligible(F('.hermes/config.yaml',5e6),{...o,never:['.hermes/config.yaml']}),false,'the files a restore test needs are never offloaded')});

test('plan: a file with the same path, size and mtime that is in a pack is only named; anything else is packed',()=>{
 const ix=emptyIndex();ix.packs['p1']={id:'1',size:9,at:1};ix.files['a.png']={size:300000,mtime:Math.floor(NOW-3*DAY),sha:'s1',pack:'p1'};ix.files['b.png']={size:300000,mtime:5,sha:'s2',pack:'p1'};ix.files['c.png']={size:300000,mtime:Math.floor(NOW-3*DAY),sha:'s3',pack:'gone'};
 const files=[F('a.png',300000),F('b.png',300000),F('c.png',300000),F('d.png',300000),F('small.png',10)];
 const p=plan(files,ix,{now:NOW});assert.deepEqual(p.reused.map(f=>[f.rel,f.pack,f.sha]),[['a.png','p1','s1']]);assert.deepEqual(p.fresh.map(f=>f.rel),['b.png','c.png','d.png'],'changed mtime, a pack that is gone, a new file');
 // a pack Drive no longer holds (or holds with another size) is forgotten with its files
 const gone=forgetMissing(ix,{p1:10});assert.deepEqual(gone,['p1']);assert.deepEqual(ix.files,{});assert.deepEqual(ix.packs,{})});

test('chunks: a pack stays under its size limit, and a file bigger than the limit is a pack of its own',()=>{
 assert.deepEqual(chunkBySize([F('a',3e9),F('b',2e9),F('c',9e9),F('d',1e9)],PACK_MAX).map(x=>x.map(f=>f.rel)),[['a'],['b'],['c'],['d']]);
 assert.deepEqual(chunkBySize([F('a',1e9),F('b',2e9),F('c',2e9),F('d',1e9)],PACK_MAX).map(x=>x.map(f=>f.rel)),[['a','b'],['c','d']]);
 assert.deepEqual(chunkBySize([],PACK_MAX),[])});

test('prunable: a pack goes to the bin only when no kept night names it and it is not new; never when the index lost a night',()=>{
 const ix=emptyIndex();ix.packs={old1:{id:'a',size:1,at:NOW-5*DAY},used:{id:'b',size:1,at:NOW-5*DAY},young:{id:'c',size:1,at:NOW-1000},mid:{id:'d',size:1,at:NOW-5*DAY}};
 ix.nights={n1:['used'],n2:['used','mid'],n0:['old1']};
 // n0 has been dropped from Drive (not kept): old1 is named by nobody
 assert.deepEqual(prunable(ix,[{name:'n1',media:true},{name:'n2',media:true}],NOW).sort(),['old1']);
 assert.deepEqual(prunable(ix,[{name:'n1',media:true}],NOW).sort(),['mid','old1'],'mid was named only by n2, which is no longer kept');
 assert.equal(prunable(ix,[{name:'n1',media:true},{name:'lost',media:true}],NOW),null,'a kept night with a manifest that the index does not know: nothing is binned');
 assert.deepEqual(prunable(ix,[{name:'n1',media:true},{name:'before',media:false}],NOW).sort(),['mid','old1'],'a night from before manifests names no packs');
 dropNights(ix,['n1','n2']);assert.deepEqual(Object.keys(ix.nights).sort(),['n1','n2'])});

test('the manifest names every file in a pack, grouped by pack, and the virtual environments to make again',()=>{
 const m=buildManifest({name:'aqeelos-x',at:5,entries:[{rel:'a/1.png',size:5,mtime:2,sha:'h1',pack:'p1',mode:0o644},{rel:'a/2.png',size:7,mtime:3,sha:'h2',pack:'p2',mode:0o600},{rel:'a/3.png',size:1,mtime:4,sha:'h3',pack:'p1',mode:0o644}],venvs:[{path:'a/.venv',cfg:'c',packages:['x-1']}]});
 assert.deepEqual(manifestPacks(m).sort(),['p1','p2']);assert.equal(m.files,3);assert.equal(m.bytes,13);assert.deepEqual(m.packs.p1.map(e=>e[0]),['a/1.png','a/3.png']);assert.equal(m.venvs[0].packages[0],'x-1');
 assert.ok(MEDIA_NAME.test('aqeelos-media-2026-11-13-03-04-3fa9.tar.gz.enc')&&MEDIA_NAME.test('aqeelos-media-2026-11-13-03-04-3fa9-2.tar.gz.enc')&&!MEDIA_NAME.test('aqeelos-2026-11-13-03-04.tar.gz.enc'));
 assert.ok(LEFTOVER.test('aqeelos-media-2026-11-13-03-04-3fa9-2.tar.gz.enc')&&LEFTOVER.test('aqeelos-media-2026-11-13-03-04-3fa9.tar.gz.enc.list')&&LEFTOVER.test('aqeelos-2026-11-13-03-04.tar.gz.enc.excl')&&LEFTOVER.test('aqeelos-2026-11-13-03-04.tar.gz.enc'))});

/* ---------- skipped files */
test('skipped files: tar\'s complaints are read, a vanished file is not a skipped one, the reason is in words',()=>{
 const err=['tar: workspaces/a/.browser/Safe Browsing/x.store: Cannot open: Permission denied','tar: apps/hermes-ui-data/agent-trash/t/.browser/lock: Cannot savedir: Permission denied','tar: workspaces/a/gone.txt: Cannot stat: No such file or directory','tar: workspaces/a/f: file changed as we read it','tar: ./workspaces/b/y: Cannot open: Permission denied'].join('\n');
 const p=parseSkips(err);assert.deepEqual(p.map(x=>x.path),['workspaces/a/.browser/Safe Browsing/x.store','apps/hermes-ui-data/agent-trash/t/.browser/lock','workspaces/b/y']);
 const users=passwdUids('root:x:0:0::/root:/bin/bash\nclaude:x:1001:1001::/home/claude:/bin/bash\nag-sesa:x:2001:2001::/h:/bin/bash\n');assert.deepEqual([...users].sort(),[0,1001,2001]);
 assert.match(reasonFor('apps/hermes-ui-data/agent-trash/t/f',{uid:2019,mode:0o100600},users),/deleted agent.*cannot read.*agent trash/);
 assert.match(reasonFor('workspaces/x/f',{uid:2019,mode:0o100600},users),/no longer exists/);
 assert.match(reasonFor('workspaces/agent-b/.browser/f',{uid:2001,mode:0o100600},users),/private file of another user \(mode 600\)/)});

test('the skipped list is recorded once: only files new on it are fresh, and a file that can be read again leaves it',()=>{
 const night1=mergeSkipped(undefined,[{path:'a',reason:'r1'},{path:'b',reason:'r2'}],1000);assert.deepEqual(night1.fresh,['a','b']);assert.equal(night1.list.since,1000);
 const night2=mergeSkipped(night1.list,[{path:'a',reason:'r1'},{path:'b',reason:'r2'},{path:'c',reason:'r2'}],2000);assert.deepEqual(night2.fresh,['c'],'a and b were said on the first night, not again');
 assert.equal(night2.list.files.a.first,1000);assert.equal(night2.list.files.a.last,2000);assert.equal(night2.list.since,1000);
 const night3=mergeSkipped(night2.list,[{path:'c',reason:'r2'}],3000);assert.deepEqual(Object.keys(night3.list.files),['c']);assert.deepEqual(night3.fresh,[]);
 const s=summarizeSkipped(night2.list);assert.equal(s.count,3);assert.deepEqual(s.reasons.map(r=>[r.reason,r.n]),[['r2',2],['r1',1]]);assert.equal(summarizeSkipped(undefined).count,0)});

/* ---------- a fake Google Drive that keeps every file it is given */
function fakeDrive(){const files=new Map(),folders=new Map(),up=new Map();let n=0;const calls={put:0,list:0,trash:0};const hold={put:null};
 const json=(o,status=200,h={})=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json',...h}});
 const meta=f=>({id:f.id,name:f.name,size:String(f.data?.length??0),appProperties:f.appProperties,parents:f.parents,createdTime:new Date(f.at).toISOString(),trashed:!!f.trashed});
 const fetchImpl=async(u,o={})=>{u=String(u);const m=o.method||'GET';
  if(u.includes('oauth2'))return json({access_token:'tok'});
  if(u.startsWith('https://www.googleapis.com/drive/v3/files?q=')){calls.list++;const q=decodeURIComponent(u.split('?q=')[1].split('&')[0]);let mm;
   if(mm=/^name='(.*)' and mimeType='application\/vnd\.google-apps\.folder'/.exec(q)){const f=[...folders.values()].find(x=>x.name===mm[1].replace(/\\'/g,"'"));return json({files:f?[{id:f.id}]:[]})}
   if(mm=/^'(.*)' in parents and trashed=false/.exec(q)){const l=[...files.values()].filter(f=>f.parents[0]===mm[1]&&!f.trashed).sort((a,b)=>b.at-a.at).map(meta);return json({files:l})}}
  if(u==='https://www.googleapis.com/drive/v3/files'&&m==='POST'){const b=JSON.parse(o.body);const id='fold'+(++n);folders.set(id,{id,name:b.name});return json({id})}
  if(u.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable')){const b=JSON.parse(o.body),id='file'+(++n);up.set(id,{id,name:b.name,parents:b.parents,appProperties:b.appProperties,total:Number(o.headers['x-upload-content-length']),chunks:[],got:0});return new Response('',{status:200,headers:{location:'https://upload.test/'+id}})}
  if(u.startsWith('https://upload.test/')){const s=up.get(u.split('/').pop()),cr=/bytes (?:(\d+)-(\d+)|\*)\/(\d+)/.exec(o.headers['content-range']);
   if(o.body){calls.put++;if(hold.put)await hold.put;const buf=Buffer.from(await new Response(o.body).arrayBuffer());s.chunks.push(buf);s.got+=buf.length}
   if(s.got>=s.total){const f={id:s.id,name:s.name,parents:s.parents,appProperties:s.appProperties,data:Buffer.concat(s.chunks),at:Date.now()+files.size};files.set(f.id,f);return json({id:f.id,name:f.name,size:String(f.data.length)})}
   return new Response('',{status:308,headers:{range:'bytes=0-'+(s.got-1)}})}
  if(m==='PATCH'){const f=files.get(u.split('/files/')[1]);if(f&&JSON.parse(o.body).trashed){f.trashed=true;calls.trash++}return json({})}
  if(u.includes('alt=media')){const f=files.get(u.split('/files/')[1].split('?')[0]),[a,b]=/bytes=(\d+)-(\d+)/.exec(o.headers.range).slice(1).map(Number);return new Response(f.data.subarray(a,b+1),{status:206})}
  if(/\/files\/[^?]+\?fields=/.test(u)){const f=files.get(u.split('/files/')[1].split('?')[0]);return json(meta(f))}
  throw Error('unexpected '+m+' '+u)};
 return {fetchImpl,files,folders,calls,hold,byName:name=>[...files.values()].find(f=>f.name===name),live:()=>[...files.values()].filter(f=>!f.trashed),inFolder:name=>{const id=[...folders.values()].find(f=>f.name===name)?.id;return [...files.values()].filter(f=>f.parents[0]===id&&!f.trashed)}}}

// a box: ~/.hermes, workspaces with media of every kind, the app's data folder, a Google sign-in
function box(){const T=fwd(mkdtempSync(path.join(tmpdir(),'aq-bksize-'))),HOME=T+'/home',H=HOME+'/.hermes',DATA=HOME+'/apps/hermes-ui-data',TMP=T+'/tmp';   // the data folder is inside the home folder, as on the boxes
 for(const d of [H,DATA,TMP])mkdirSync(d,{recursive:true});
 writeFileSync(H+'/config.yaml','x: 1\n'.repeat(50));writeFileSync(H+'/.env','K=v\n'.repeat(10));
 writeFileSync(HOME+'/apps/hermes-ui.env','A=1\n');writeFileSync(DATA+'/users.json','{}'.repeat(40));
 writeFileSync(H+'/google_token.json',JSON.stringify({account:'a@b.test',refresh_token:'r',client_id:'c',client_secret:'s',scopes:['https://www.googleapis.com/auth/drive']}));
 const g=fakeDrive(),mk=(x={})=>createBackups({DATA,HOME,HERMES_HOME:H,TMP,MIN:1,tz:()=>'UTC',fetchImpl:g.fetchImpl,disk:async()=>({free:1e12,dev:'d'}),mem:async()=>20e9,PIECE:1<<20,...x});
 return {T,HOME,H,DATA,TMP,g,mk,state:()=>JSON.parse(readFileSync(DATA+'/backups.json','utf8')),index:()=>JSON.parse(readFileSync(DATA+'/backup-media.json','utf8')),done:()=>rmSync(T,{recursive:true,force:true})}}
const media=(HOME,rel,size,age=true)=>{const f=HOME+'/'+rel;put(f,randomBytes(size));if(age)old(f);return f};
function decryptTo(enc,key,dir,names=''){mkdirSync(dir,{recursive:true});const r=spawnSync('bash',['-c','set -o pipefail; openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:K -in "$E" | tar -xzf - -C "$D" '+names],{env:{...process.env,K:key,E:enc,D:dir}});assert.equal(r.status,0,String(r.stderr))}
const keyOf=b=>readFileSync(b.DATA+'/backup-key','utf8').trim();
const membersOf=(file,key)=>{const r=spawnSync('bash',['-c','openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:K -in "$E" | tar -tzf -'],{env:{...process.env,K:key,E:file},maxBuffer:1e8});assert.equal(r.status,0,String(r.stderr));return String(r.stdout).split('\n').filter(Boolean)};
const diskFile=(b,f)=>{const p=b.T+'/dl-'+f.name;writeFileSync(p,f.data);return p};

test('first night: big quiet files go to a media pack, the rest and a manifest to the archive; excluded things and virtual environments are in neither',NEED,async()=>{const b=box();try{
 const big=media(b.HOME,'workspaces/agent/reels/r1.png',300e3),big2=media(b.HOME,'.hermes/profiles/p/media/r2.png',200e3),recent=media(b.HOME,'workspaces/agent/reels/new.png',300e3,false);
 put(b.HOME+'/workspaces/agent/notes.txt','hello');put(b.HOME+'/workspaces/agent/small.png',randomBytes(5000));old(b.HOME+'/workspaces/agent/small.png');
 media(b.HOME,'.hermes/state.db',400e3);   // a database: never packed
 media(b.HOME,'workspaces/agent/.config/adspower_global/cwd_global/chrome_153/SunBrowser',400e3);   // left out by name
 put(b.HOME+'/workspaces/agent/.venv/pyvenv.cfg','version = 3.12\n');mkdirSync(b.HOME+'/workspaces/agent/.venv/lib/python3.12/site-packages/idna-3.7.dist-info',{recursive:true});media(b.HOME,'workspaces/agent/.venv/lib/python3.12/site-packages/big.so',300e3);
 const bk=b.mk();const last=await bk.run('by hand');
 assert.equal(last.ok,true);assert.equal(last.media.files,2,'the two big quiet files');assert.equal(last.media.newFiles,2);assert.ok(last.media.packBytes>=490e3);assert.equal(last.venvs,1);assert.ok(last.uploaded>last.size);assert.ok(last.parts.archive>=0&&last.parts.scan>=0);
 // Drive: the nightly archive in the backups folder (flagged), the packs in their own folder, one for the agents' file and one for the rest
 const night=b.g.inFolder('aqeelOS backups');assert.equal(night.length,1);assert.equal(night[0].appProperties.media,'1');
 const packs=b.g.inFolder('aqeelOS backups media');assert.equal(packs.length,2);assert.ok(packs.every(p=>MEDIA_NAME.test(p.name)));
 const key=keyOf(b),members=membersOf(diskFile(b,night[0]),key);
 assert.ok(members.includes('workspaces/agent/notes.txt')&&members.includes('workspaces/agent/reels/new.png')&&members.includes('.hermes/state.db')&&members.includes('workspaces/agent/small.png')&&members.includes('backup-manifest.json'));
 assert.ok(!members.includes('workspaces/agent/reels/r1.png')&&!members.includes('.hermes/profiles/p/media/r2.png'),'files in packs are not in the archive');
 assert.ok(!members.some(m=>/chrome_153|\.venv/.test(m)),'kept out by name, and the virtual environment too');
 // the manifest
 const dir=b.T+'/x1';decryptTo(diskFile(b,night[0]),key,dir,'backup-manifest.json');const mf=JSON.parse(readFileSync(dir+'/backup-manifest.json','utf8'));
 assert.equal(mf.files,2);assert.equal(mf.venvs[0].path,'workspaces/agent/.venv');assert.deepEqual(mf.venvs[0].packages,['idna-3.7']);assert.equal(manifestPacks(mf).length,2);
 // the index records both, and the night
 const ix=b.index();assert.equal(Object.keys(ix.files).length,2);assert.equal(Object.keys(ix.packs).length,2);assert.deepEqual(ix.nights[night[0].name].sort(),manifestPacks(mf).sort());
 assert.deepEqual(readdirSync(b.TMP),[],'nothing left in the scratch folder');
 // one night restores completely: archive + the packs its manifest names
 const out=b.T+'/restored';decryptTo(diskFile(b,night[0]),key,out);
 const byName=Object.fromEntries(packs.map(p=>[p.name,p]));const r=await restoreMedia({manifest:mf,dir:out,key,getPack:async n=>diskFile(b,byName[n])});
 assert.equal(r.restored,2);assert.deepEqual([r.missing,r.bad],[[],[]]);
 assert.deepEqual(readFileSync(out+'/workspaces/agent/reels/r1.png'),readFileSync(big));assert.deepEqual(readFileSync(out+'/.hermes/profiles/p/media/r2.png'),readFileSync(big2));assert.deepEqual(readFileSync(out+'/workspaces/agent/reels/new.png'),readFileSync(recent));
 // the agents' files restore from their own pack alone
 const o2=b.T+'/only-hermes';mkdirSync(o2);const ph=await restoreMedia({manifest:mf,dir:o2,key,only:rel=>rel.startsWith('.hermes/'),getPack:async n=>{assert.ok(mf.packs[n].every(e=>e[0].startsWith('.hermes/')),'a pack never mixes the agents\' files with the rest');return diskFile(b,byName[n])}});
 assert.equal(ph.restored,1);
 // by hand, with the script: the packs downloaded into a folder, the key in a file
 const pk=b.T+'/packs',o3=b.T+'/by-hand';mkdirSync(pk);mkdirSync(o3);for(const p of packs)writeFileSync(pk+'/'+p.name,p.data);writeFileSync(b.T+'/key.txt',key);
 const cli=spawnSync(process.execPath,[fileURLToPath(new URL('./restore-media.mjs',import.meta.url)),dir+'/backup-manifest.json',pk,o3,'--key-file',b.T+'/key.txt'],{encoding:'utf8'});
 assert.equal(cli.status,0,cli.stderr+cli.stdout);assert.match(cli.stdout,/2 files restored/);assert.deepEqual(readFileSync(o3+'/workspaces/agent/reels/r1.png'),readFileSync(big));
 const none=spawnSync(process.execPath,[fileURLToPath(new URL('./restore-media.mjs',import.meta.url)),dir+'/backup-manifest.json',b.T+'/nowhere',o3,'--key-file',b.T+'/key.txt'],{encoding:'utf8'});assert.equal(none.status,1);assert.match(none.stderr,/not in .* yet/)}finally{b.done()}});

test('second night: files already in a pack are not packed again, a changed one is, and the night still restores whole',NEED,async()=>{const b=box();try{
 const a=media(b.HOME,'workspaces/agent/reels/a.png',300e3),c=media(b.HOME,'workspaces/agent/reels/c.png',300e3);let bk=b.mk();await bk.run('by hand');
 const packs1=b.g.inFolder('aqeelOS backups media').map(p=>p.name);assert.equal(packs1.length,1);
 // night two: a is unchanged, c was rewritten, d is new
 const c2=randomBytes(310e3);writeFileSync(c,c2);old(c);const d=media(b.HOME,'workspaces/agent/reels/d.png',250e3);
 bk=b.mk();const last=await bk.run('by hand');
 assert.equal(last.media.files,3);assert.equal(last.media.newFiles,2,'c and d only');assert.equal(b.g.inFolder('aqeelOS backups media').length,2,'one more pack, the first untouched');
 const night2=b.g.inFolder('aqeelOS backups').sort((x,y)=>y.at-x.at)[0],key=keyOf(b);
 const dir=b.T+'/n2';decryptTo(diskFile(b,night2),key,dir);const mf=JSON.parse(readFileSync(dir+'/backup-manifest.json','utf8'));
 const packsNow=b.g.inFolder('aqeelOS backups media'),byName=Object.fromEntries(packsNow.map(p=>[p.name,p]));
 assert.equal(mf.packs[packs1[0]].map(e=>e[0]).join(),'workspaces/agent/reels/a.png','a is named in the first night\'s pack');
 const r=await restoreMedia({manifest:mf,dir,key,getPack:async n=>diskFile(b,byName[n])});assert.equal(r.restored,3);assert.deepEqual(r.bad,[]);
 assert.deepEqual(readFileSync(dir+'/workspaces/agent/reels/a.png'),readFileSync(a));assert.deepEqual(readFileSync(dir+'/workspaces/agent/reels/c.png'),c2,'the new version of c');assert.deepEqual(readFileSync(dir+'/workspaces/agent/reels/d.png'),readFileSync(d));
 // and the first night still restores the OLD c, from the pack that night named
 const night1=b.g.inFolder('aqeelOS backups').sort((x,y)=>x.at-y.at)[0],d1=b.T+'/n1';decryptTo(diskFile(b,night1),key,d1);const mf1=JSON.parse(readFileSync(d1+'/backup-manifest.json','utf8'));
 const r1=await restoreMedia({manifest:mf1,dir:d1,key,getPack:async n=>diskFile(b,byName[n])});assert.equal(r1.restored,2);assert.notDeepEqual(readFileSync(d1+'/workspaces/agent/reels/c.png'),c2)}finally{b.done()}});

test('a night that fails after its packs were uploaded does not pack them again; a pack Drive lost is packed again',NEED,async()=>{const b=box();try{
 media(b.HOME,'workspaces/agent/reels/a.png',300e3);
 let bk;
 // the archive upload fails: the second resumable upload start (the first is the pack) is refused
 let starts=0;const flaky=async(u,o={})=>{if(String(u).includes('uploadType=resumable')&&++starts===2)return new Response('no',{status:500});return b.g.fetchImpl(u,o)};
 bk=b.mk({fetchImpl:flaky});await assert.rejects(()=>bk.run('by hand'),/Drive said 500/);
 assert.equal(b.g.inFolder('aqeelOS backups media').length,1,'the pack is in Drive');assert.equal(Object.keys(b.index().files).length,1,'and in the index');assert.equal(b.g.inFolder('aqeelOS backups').length,0);
 bk=b.mk();const last=await bk.run('by hand');assert.equal(last.media.newFiles,0,'nothing is packed again');assert.equal(last.media.files,1);assert.equal(b.g.inFolder('aqeelOS backups media').length,1);
 // someone deletes the pack in Drive: the next night notices and packs the file again
 for(const f of b.g.inFolder('aqeelOS backups media'))f.trashed=true;
 const again=await b.mk().run('by hand');assert.equal(again.media.newFiles,1);assert.equal(b.g.inFolder('aqeelOS backups media').length,1)}finally{b.done()}});

test('retention: a pack stays while a kept night names it, goes to the Drive bin (never deleted) when none does',NEED,async()=>{const b=box();try{
 await b.mk().setSettings({keep:2});const run=m=>b.mk({now:()=>NOW+m*60e3}).run('by hand');   // the backup's name is made from the clock: a clock per night
 const a=media(b.HOME,'workspaces/agent/reels/a.png',300e3),c=media(b.HOME,'workspaces/agent/reels/c.png',300e3);
 await run(0);const P1=b.g.inFolder('aqeelOS backups media')[0].name;                       // night 1: a and c, in pack 1
 rmSync(c);media(b.HOME,'workspaces/agent/reels/e.png',300e3);await run(1);                  // night 2: e is new, in pack 2
 const P2=b.g.inFolder('aqeelOS backups media').map(p=>p.name).find(n=>n!==P1);assert.ok(P2);
 rmSync(a);await run(2);                                                                     // night 3: a is gone too; night 1 leaves the kept nights, night 2 still names pack 1
 assert.equal(b.g.inFolder('aqeelOS backups').length,2,'the newest 2 nights');assert.equal(b.g.files.get(b.g.byName(P1).id).trashed,undefined,'pack 1 is still named by night 2');
 // pack 1 is old enough to be binned (the grace is a day), and night 4 pushes night 2 out
 const ix=b.index();ix.packs[P1].at=NOW-5*PACK_GRACE;writeFileSync(b.DATA+'/backup-media.json',JSON.stringify(ix));
 await run(3);assert.equal(b.g.byName(P1).trashed,true,'no kept night names pack 1 any more');assert.ok(!b.g.byName(P2).trashed);
 assert.deepEqual(Object.keys(b.index().packs),[P2]);assert.deepEqual(Object.keys(b.index().nights).length,2);
 for(const f of b.g.files.values())assert.ok(f.data,'nothing was deleted: trashed files are still in Drive for 30 days')}finally{b.done()}});

test('the index lost: nothing is binned while a kept night with a manifest is unknown to it, and the files are packed again',NEED,async()=>{const b=box();try{
 media(b.HOME,'workspaces/agent/reels/a.png',300e3);await b.mk().run('by hand');const n1=b.g.inFolder('aqeelOS backups media').length;
 rmSync(b.DATA+'/backup-media.json');rmSync(b.DATA+'/backup-media.json.last-good',{force:true});
 const last=await b.mk({now:()=>NOW+60e3}).run('by hand');assert.equal(last.media.newFiles,1,'the index is rebuilt: the file is packed again');
 assert.equal(b.g.inFolder('aqeelOS backups media').length,n1+1,'the old pack is not binned: the first night still names it');assert.equal(b.g.calls.trash,0)}finally{b.done()}});

test('without Google the backup stays as it was: one archive on the box, no packs, a manifest with the virtual environments',NEED,async()=>{const b=box();try{
 rmSync(b.H+'/google_token.json');media(b.HOME,'workspaces/agent/reels/a.png',300e3);put(b.HOME+'/workspaces/agent/.venv/pyvenv.cfg','v=1\n');
 const bk=b.mk();const last=await bk.run('by hand');assert.equal(last.local,true);assert.equal(last.media,undefined);assert.equal(last.venvs,1);
 const f=readdirSync(b.HOME+'/aqeelos-local-backups').filter(x=>x.endsWith('.enc'))[0],members=membersOf(b.HOME+'/aqeelos-local-backups/'+f,keyOf(b));
 assert.ok(members.includes('workspaces/agent/reels/a.png'),'the big file is in the archive itself');assert.ok(!members.some(m=>/\.venv/.test(m)));assert.ok(members.includes('backup-manifest.json'));assert.equal(b.g.files.size,0)}finally{b.done()}});

// tar that reports what Linux reports for a file it may not read (the real thing is the next test, for a user that is not root): the shim
// runs the real tar and adds the complaint to the archive step only
test('a night with an unreadable file: it is listed once with a reason, the backup still succeeds, the next night says nothing new',NEED,async()=>{const b=box();const PATH0=process.env.PATH;try{
 mkdirSync(b.T+'/shim');writeFileSync(b.T+'/shim/tar','#!/bin/bash\nreal=$(PATH="${PATH#*:}" command -v tar)\n"$real" "$@"; c=$?\ncase " $* " in *" -czf - "*) echo "tar: workspaces/agent/secret.txt: Cannot open: Permission denied" >&2; echo "tar: workspaces/agent/vanished: Cannot stat: No such file or directory" >&2;; esac\nexit $c\n');chmodSync(b.T+'/shim/tar',0o755);
 process.env.PATH=b.T+'/shim'+(process.platform==='win32'?';':':')+PATH0;
 put(b.HOME+'/workspaces/agent/secret.txt','x');put(b.HOME+'/workspaces/agent/ok.txt','fine');
 const l1=await b.mk().run('by hand');assert.equal(l1.ok,true);assert.equal(l1.skipped,1,'the vanished file is not a skipped one');assert.equal(l1.skippedNew,1);
 const sk=JSON.parse(readFileSync(b.DATA+'/backup-skipped.json','utf8'));assert.deepEqual(Object.keys(sk.files),['workspaces/agent/secret.txt']);assert.match(sk.files['workspaces/agent/secret.txt'].reason,/cannot read it/);
 const l2=await b.mk({now:()=>NOW+DAY}).run('by hand');assert.equal(l2.skipped,1);assert.equal(l2.skippedNew,0,'the second night does not report it again');
 assert.equal(JSON.parse(readFileSync(b.DATA+'/backup-skipped.json','utf8')).files['workspaces/agent/secret.txt'].first,sk.files['workspaces/agent/secret.txt'].first,'first seen stays');
 const st=await b.mk().status();assert.equal(st.skipped.count,1);assert.equal(st.skipped.files[0].path,'workspaces/agent/secret.txt');assert.equal(st.skipped.reasons.length,1);
 // the file can be read again (the shim stops complaining): it leaves the list
 process.env.PATH=PATH0;await b.mk({now:()=>NOW+2*DAY}).run('by hand');assert.equal((await b.mk().status()).skipped.count,0)}finally{process.env.PATH=PATH0;b.done()}});

test('unreadable files are listed once with a reason, and not said again',{skip:(!TOOLS||process.platform==='win32'||process.getuid?.()===0)&&'needs tools and a user that is not root'},async()=>{const b=box();try{
 put(b.HOME+'/workspaces/agent/ok.txt','fine');put(b.HOME+'/workspaces/agent/secret.txt','nope');chmodSync(b.HOME+'/workspaces/agent/secret.txt',0);
 const l1=await b.mk().run('by hand');assert.equal(l1.skipped,1);assert.equal(l1.skippedNew,1);
 const sk=JSON.parse(readFileSync(b.DATA+'/backup-skipped.json','utf8'));assert.deepEqual(Object.keys(sk.files),['workspaces/agent/secret.txt']);assert.match(sk.files['workspaces/agent/secret.txt'].reason,/cannot read it/);
 const l2=await b.mk({now:()=>NOW+DAY}).run('by hand');assert.equal(l2.skipped,1);assert.equal(l2.skippedNew,0,'the second night does not report it again');
 assert.equal(JSON.parse(readFileSync(b.DATA+'/backup-skipped.json','utf8')).files['workspaces/agent/secret.txt'].first,sk.files['workspaces/agent/secret.txt'].first);
 const st=await b.mk().status();assert.equal(st.skipped.count,1);assert.equal(st.skipped.files[0].path,'workspaces/agent/secret.txt');
 chmodSync(b.HOME+'/workspaces/agent/secret.txt',0o600);await b.mk({now:()=>NOW+2*DAY}).run('by hand');assert.equal((await b.mk().status()).skipped.count,0,'readable again: off the list')}finally{b.done()}});

test('the Backups card gets the progress of a running upload (what, how much of how much, speed) and, afterwards, sizes and durations',NEED,async()=>{const b=box();try{
 media(b.HOME,'workspaces/agent/reels/a.png',300e3);let release;b.g.hold.put=new Promise(r=>release=r);
 const bk=b.mk();const run=bk.run('by hand');let p=null;for(let i=0;i<600&&!(p=(await bk.status()).progress)?.phase?.startsWith('uploading');i++)await new Promise(r=>setTimeout(r,20));
 assert.match(p.phase,/^uploading/);assert.ok(p.total>0);assert.equal(p.done,0);release();b.g.hold.put=null;await run;
 const st=await bk.status();assert.equal(st.progress,null);assert.equal(st.last.ok,true);assert.ok(st.last.size>0&&st.last.secs>=0&&st.last.parts&&st.last.media.files===1&&st.last.uploaded>st.last.size)}finally{b.done()}});

test('restoring the agents from a night with media: Prepare fetches only the agents\' packs and the agents\' big files come back',POSIX,async()=>{const b=box();try{
 const big=media(b.HOME,'.hermes/profiles/p/media/r2.png',200e3);media(b.HOME,'workspaces/agent/reels/r1.png',300e3);writeFileSync(b.H+'/.env','K=v\n'.repeat(10));
 await b.mk().run('by hand');const night=b.g.inFolder('aqeelOS backups')[0];
 rmSync(big);const bk=b.mk();const st=await bk.estimate(night.id);assert.ok(st.media>=200e3,'the estimate counts the agents\' big files in packs');
 const dl=[];const wrapped=async(u,o={})=>{if(String(u).includes('alt=media'))dl.push(b.g.files.get(String(u).split('/files/')[1].split('?')[0]).name);return b.g.fetchImpl(u,o)};
 const bk2=b.mk({fetchImpl:wrapped});await bk2.prepare(night.id);await bk2.settled();const s=b.state();assert.equal(s.restore.phase,'ready',JSON.stringify(s.restore));
 assert.equal(dl.filter(n=>MEDIA_NAME.test(n)).length,1,'one pack downloaded: the agents\'');assert.equal(dl.filter(n=>!MEDIA_NAME.test(n)).length,1);
 assert.ok(existsSync(s.prepared.src+'/profiles/p/media/r2.png'),'the big file of the agents is in the prepared folder');assert.ok(s.prepared.preview.add>=1);
 await bk2.cancel();assert.deepEqual(readdirSync(b.TMP).filter(x=>MEDIA_NAME.test(x)),[])}finally{b.done()}});

test('the restore test opens the newest night: manifest there, every pack in Drive, the smallest pack checked file by file',POSIX,async()=>{const b=box();try{
 media(b.HOME,'workspaces/agent/reels/r1.png',300e3);await b.mk().run('by hand');
 const t=await b.mk().test();assert.equal(t.ok,true);assert.match(t.detail,/1 big files .* in 1 media pack\(s\), all in Drive; one was opened and checked/);
 for(const f of b.g.inFolder('aqeelOS backups media'))f.trashed=true;
 await assert.rejects(()=>b.mk().test(),/Missing from Google Drive: the media pack aqeelos-media-/)}finally{b.done()}});

test('sha-256 of a file, as the index records it',async()=>{const T=mkdtempSync(path.join(tmpdir(),'aq-sha-'));try{writeFileSync(T+'/f','abc');assert.equal(await sha256File(T+'/f'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')}finally{rmSync(T,{recursive:true,force:true})}});

/* ---------- the independent check of 13 Nov 2026 (a real round trip on Elkiya): what it found, pinned */
test('tar says "Warning: Cannot open" with --ignore-failed-read: the path is still read right, so an unreadable file is never recorded as packed',()=>{
 const p=parseSkips('tar: workspaces/agent/secret.txt: Warning: Cannot open: Permission denied\ntar: workspaces/a/gone.bin: Warning: Cannot stat: No such file or directory\ntar: workspaces/a/d: Cannot savedir: Permission denied');
 assert.deepEqual(p.map(x=>x.path),['workspaces/agent/secret.txt','workspaces/a/d']);assert.equal(p[0].why,'Permission denied')});

test('a project folder with a pyvenv.cfg in it (python -m venv .) is not a virtual environment: it is backed up whole',async()=>{const T=mkdtempSync(path.join(tmpdir(),'aq-venv-'));try{
 assert.equal(isVenv(['pyvenv.cfg','bin','lib','lib64','include','.gitignore','CACHEDIR.TAG','share']),true);assert.equal(isVenv(['pyvenv.cfg','bin','lib','app.py']),false);assert.equal(isVenv(['bin','lib']),false);
 put(T+'/workspaces/a/proj/pyvenv.cfg','version = 3.12\n');put(T+'/workspaces/a/proj/app.py','print(1)');put(T+'/workspaces/a/proj/lib/python3.12/site-packages/x.py','x');put(T+'/workspaces/a/proj/bin/python','x');put(T+'/workspaces/a/proj/notes/plan.md','mine');
 put(T+'/workspaces/a/real/pyvenv.cfg','version = 3.12\n');put(T+'/workspaces/a/real/lib/python3.12/site-packages/x.py','x');put(T+'/workspaces/a/real/bin/python','x');
 const r=await scan({root:T,include:['workspaces'],excl:excludeTester(EXCLUDE_ALL)});
 assert.deepEqual(r.venvs.map(v=>v.path),['workspaces/a/real']);assert.ok(r.files.some(f=>f.rel==='workspaces/a/proj/app.py')&&r.files.some(f=>f.rel==='workspaces/a/proj/notes/plan.md')&&r.files.some(f=>f.rel==='workspaces/a/proj/lib/python3.12/site-packages/x.py'));
 assert.ok(!r.files.some(f=>f.rel.startsWith('workspaces/a/real/')))}finally{rmSync(T,{recursive:true,force:true})}});

test('a name that ends or starts with white space is never excluded by name (tar trims its exclude lines), and a replaced file with the old size and time is packed again',()=>{
 assert.equal(plainName('workspaces/a/clip.mp4 '),false);assert.equal(plainName(' workspaces/a/clip.mp4'),false);assert.equal(plainName('workspaces/a/my clip é.mp4'),true);
 assert.equal(eligible(F('workspaces/a/clip.mp4 ',5e6),{now:NOW}),false);
 const ix=emptyIndex();ix.packs.p1={id:'1',size:9,at:1};const f={...F('a.png',300000),ino:77};ix.files['a.png']={size:f.size,mtime:f.mtime,ino:77,sha:'s',pack:'p1'};
 assert.equal(plan([f],ix,{now:NOW}).reused.length,1);assert.equal(plan([{...f,ino:78}],ix,{now:NOW}).fresh.length,1,'another inode: another file');
 delete ix.files['a.png'].ino;assert.equal(plan([{...f,ino:78}],ix,{now:NOW}).reused.length,1,'an index from before inodes were recorded still counts')});

test('a pack Drive holds with another checksum is forgotten like a missing one',()=>{
 const ix=emptyIndex();ix.packs={good:{id:'a',size:5,md5:'m1',at:1},bad:{id:'b',size:5,md5:'m2',at:1},old:{id:'c',size:5,at:1}};ix.files={x:{pack:'good'},y:{pack:'bad'},z:{pack:'old'}};
 assert.deepEqual(forgetMissing(ix,{good:{size:5,md5:'m1'},bad:{size:5,md5:'other'},old:{size:5,md5:'whatever'}}),['bad']);assert.deepEqual(Object.keys(ix.files),['x','z'])});

// Drive's own md5 of every file, as the real one gives it (the fake above does not)
const withMd5=(b,{lie=()=>false}={})=>async(u,o={})=>{const r=await b.g.fetchImpl(u,o);if(!r.ok||!/json/.test(r.headers.get('content-type')||''))return r;const j=await r.json();
 const add=x=>{const f=b.g.files.get(x.id);if(f)x.md5Checksum=lie(f)?'0'.repeat(32):createHash('md5').update(f.data).digest('hex');return x};
 if(Array.isArray(j.files))j.files.forEach(add);else if(j.id)add(j);return new Response(JSON.stringify(j),{status:r.status,headers:{'content-type':'application/json'}})};

test('a database under any name (a browser\'s Cookies) is never packed: it stays in the archive with its journal',NEED,async()=>{const b=box();try{
 const db=b.HOME+'/workspaces/agent/.browser/Default/Cookies';put(db,Buffer.concat([Buffer.from('SQLite format 3\0'),randomBytes(300e3)]));old(db);media(b.HOME,'workspaces/agent/reels/a.png',300e3);
 assert.equal(await sqliteHead(db),true);assert.equal(await sqliteHead(b.HOME+'/workspaces/agent/reels/a.png'),false);assert.equal(await sqliteHead(b.HOME+'/nothing'),false);
 const last=await b.mk().run('by hand');assert.equal(last.media.files,1,'the picture only');
 const members=membersOf(diskFile(b,b.g.inFolder('aqeelOS backups')[0]),keyOf(b));assert.ok(members.includes('workspaces/agent/.browser/Default/Cookies'));assert.ok(!members.includes('workspaces/agent/reels/a.png'))}finally{b.done()}});

test('an upload Drive holds damaged fails the night and goes to the bin; a pack damaged later is found the next night, packed again and said',NEED,async()=>{const b=box();try{
 const a=media(b.HOME,'workspaces/agent/reels/a.png',300e3);
 // the pack arrives damaged: nothing is recorded, no archive is made
 await assert.rejects(()=>b.mk({fetchImpl:withMd5(b,{lie:f=>MEDIA_NAME.test(f.name)})}).run('by hand'),/damaged/);
 assert.equal(b.g.inFolder('aqeelOS backups media').length,0,'in the Drive bin');assert.equal(b.g.inFolder('aqeelOS backups').length,0);assert.deepEqual(readdirSync(b.TMP),[]);
 // a good night
 const n1=await b.mk({fetchImpl:withMd5(b)}).run('by hand');assert.equal(n1.media.newFiles,1);const pack=b.g.inFolder('aqeelOS backups media')[0];assert.equal(b.index().packs[pack.name].md5,createHash('md5').update(pack.data).digest('hex'));
 assert.equal(await md5File(diskFile(b,pack)),b.index().packs[pack.name].md5);
 // the pack rots in Drive (same size): the next night notices at backup time, packs the file again and says an earlier night lost it
 pack.data=Buffer.from(pack.data);pack.data[100]^=0xff;
 const told=[],n2=await b.mk({fetchImpl:withMd5(b),notify:t=>told.push(t)}).run('by hand');assert.equal(n2.media.newFiles,1);assert.equal(n2.media.lostPacks,1);assert.equal(told.length,1);assert.match(told[0],/missing or damaged/);
 const night2=b.g.inFolder('aqeelOS backups').sort((x,y)=>y.at-x.at)[0],dir=b.T+'/n2',key=keyOf(b);decryptTo(diskFile(b,night2),key,dir);const mf=JSON.parse(readFileSync(dir+'/backup-manifest.json','utf8'));
 assert.ok(!manifestPacks(mf).includes(pack.name),'tonight names the new pack');const byName=Object.fromEntries(b.g.inFolder('aqeelOS backups media').map(p=>[p.name,p]));
 const r=await restoreMedia({manifest:mf,dir,key,getPack:async n=>diskFile(b,byName[n])});assert.equal(r.restored,1);assert.deepEqual(readFileSync(dir+'/workspaces/agent/reels/a.png'),readFileSync(a))}finally{b.done()}});

test('restoring: a file the manifest names that its pack does not hold is reported as missing, the others come back; a damaged pack is an error',POSIX,async()=>{const b=box();try{
 const a=media(b.HOME,'workspaces/agent/reels/a.png',300e3);media(b.HOME,'workspaces/agent/reels/with space é.png',200e3);await b.mk().run('by hand');
 const night=b.g.inFolder('aqeelOS backups')[0],pack=b.g.inFolder('aqeelOS backups media')[0],key=keyOf(b),dir=b.T+'/r';decryptTo(diskFile(b,night),key,dir);const mf=JSON.parse(readFileSync(dir+'/backup-manifest.json','utf8'));
 mf.packs[pack.name].push(['workspaces/agent/reels/never-packed.png',5,1,'00',0o644]);
 const r=await restoreMedia({manifest:mf,dir,key,getPack:async()=>diskFile(b,pack)});assert.equal(r.restored,2);assert.deepEqual(r.missing,['workspaces/agent/reels/never-packed.png']);
 assert.deepEqual(readFileSync(dir+'/workspaces/agent/reels/a.png'),readFileSync(a));assert.ok(existsSync(dir+'/workspaces/agent/reels/with space é.png'));
 // content that is not what the manifest says
 mf.packs[pack.name].pop();mf.packs[pack.name][0][3]='f'.repeat(64);const r2=await restoreMedia({manifest:mf,dir,key,getPack:async()=>diskFile(b,pack)});assert.equal(r2.bad.length,1);
 // half a pack
 const half=b.T+'/half.enc';writeFileSync(half,pack.data.subarray(0,pack.data.length>>1));await assert.rejects(()=>restoreMedia({manifest:mf,dir:b.T+'/r3',key,getPack:async()=>half}),/could not be opened/);
 // by hand the same is one plain line and exit 1, not a stack trace
 const pk=b.T+'/pk';mkdirSync(pk);writeFileSync(pk+'/'+pack.name,pack.data.subarray(0,pack.data.length>>1));writeFileSync(b.T+'/key.txt',key);writeFileSync(b.T+'/mf.json',JSON.stringify(mf));
 const cli=spawnSync(process.execPath,[fileURLToPath(new URL('./restore-media.mjs',import.meta.url)),b.T+'/mf.json',pk,b.T+'/r4','--key-file',b.T+'/key.txt'],{encoding:'utf8'});
 assert.equal(cli.status,1);assert.match(cli.stderr,/could not be opened/);assert.match(cli.stderr,/Download it again/);assert.doesNotMatch(cli.stderr,/at restoreMedia|node:internal/)}finally{b.done()}});

test('only what tar itself lists as put in a pack is recorded as packed: a file tar leaves out without saying why stays in the archive',{skip:(!TOOLS||process.platform==='win32')&&'needs tools and a shell script on the PATH'},async()=>{const b=box();const PATH0=process.env.PATH;try{
 media(b.HOME,'workspaces/agent/reels/a.png',300e3);media(b.HOME,'workspaces/agent/reels/b é.png',300e3);
 // a tar that silently drops a.png from a pack's file list (and is the real tar otherwise)
 const bin=b.T+'/bin';mkdirSync(bin);const real=String(spawnSync('bash',['-c','command -v tar']).stdout).trim();
 writeFileSync(bin+'/tar','#!/bin/bash\nfor a in "$@"; do case "$a" in *.list) tr "\\0" "\\n" <"$a" | grep -v "a\\.png" | tr "\\n" "\\0" >"$a.2"; mv "$a.2" "$a";; esac; done\nexec '+real+' "$@"\n');chmodSync(bin+'/tar',0o755);process.env.PATH=bin+':'+PATH0;
 const last=await b.mk().run('by hand');process.env.PATH=PATH0;
 assert.equal(last.media.files,1,'b only');assert.deepEqual(Object.keys(b.index().files),['workspaces/agent/reels/b é.png']);
 const members=membersOf(diskFile(b,b.g.inFolder('aqeelOS backups')[0]),keyOf(b));assert.ok(members.includes('workspaces/agent/reels/a.png'),'a is in the archive, not lost');assert.ok(!members.some(m=>/reels\/b /.test(m)),'b is in its pack');
 assert.ok(LEFTOVER.test('aqeelos-media-2026-11-13-03-04-3fa9.tar.gz.enc.idx'));assert.deepEqual(readdirSync(b.TMP),[])}finally{process.env.PATH=PATH0;b.done()}});
