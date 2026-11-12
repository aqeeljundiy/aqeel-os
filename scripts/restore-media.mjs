// By hand: puts the files of one night's media packs back (13 Nov 2026). A night's archive holds a manifest (backup-manifest.json) that names, for every
// large file kept in a media pack, the pack that holds it. After unpacking the archive (RESTORE.md), download the packs it names from the Drive
// folder "aqeelOS backups media" into one folder and run:
//   node scripts/restore-media.mjs <backup-manifest.json> <folder with the packs> <target folder> --key-file <file holding the backup key> [--only <path prefix>]
// The target is the folder the archive was unpacked into (the box's home folder for a whole box). Each file is checked (size, sha-256) once it is out.
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {restoreMedia,manifestPacks} from '../app/backup-media.mjs';

const a=process.argv.slice(2),opt=n=>{const i=a.indexOf(n);return i<0?null:a.splice(i,2)[1]};
const keyFile=opt('--key-file'),only=opt('--only');const [mfile,packs,to]=a;
if(!mfile||!packs||!to||!keyFile){console.error('usage: node scripts/restore-media.mjs <backup-manifest.json> <folder with the packs> <target folder> --key-file <file> [--only <path prefix>]');process.exit(2)}
const manifest=JSON.parse(await readFile(mfile,'utf8')),key=(await readFile(keyFile,'utf8')).trim();
const need=manifestPacks(manifest).filter(n=>manifest.packs[n].some(e=>!only||e[0].startsWith(only))),gone=need.filter(n=>!existsSync(path.join(packs,n)));
if(gone.length){console.error('These packs are not in '+packs+' yet (download them from Google Drive, folder "aqeelOS backups media"):\n  '+gone.join('\n  '));process.exit(1)}
// a pack that is damaged or only half downloaded: said in one line (which pack, and what to do), not as a stack trace
const r=await restoreMedia({manifest,dir:to,key,only:rel=>!only||rel.startsWith(only),getPack:async n=>path.join(packs,n),onPack:(n,w)=>console.log(n+': '+w.length+' files')})
 .catch(e=>{console.error(e.message+'. The pack is damaged, not whole, or the key is not the one it was made with. Download it again from Google Drive (folder "aqeelOS backups media") and run this again; the packs before it were restored.');process.exit(1)});
console.log(r.restored+' files restored ('+(r.bytes/1e9).toFixed(2)+' GB) from '+r.packs+' pack(s).'+(r.missing.length?' Missing from their pack: '+r.missing.length:'')+(r.bad.length?' Not matching the manifest: '+r.bad.length:''));
for(const f of [...r.missing,...r.bad].slice(0,20))console.log('  '+f);
process.exit(r.missing.length||r.bad.length?1:0);
