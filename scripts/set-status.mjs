// Mark inventory items as done/partial/planned in parity-features.mjs.
// Usage: node scripts/set-status.mjs done PROJ-03 PROJ-04 ...
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const [status,...ids]=process.argv.slice(2);
if(!['done','partial','planned'].includes(status)||!ids.length){console.error('usage: set-status.mjs done|partial|planned ID...');process.exit(1)}
const file=path.join(path.dirname(fileURLToPath(import.meta.url)),'parity-features.mjs');let src=await readFile(file,'utf8');
for(const id of ids){const re=new RegExp(`(\\['${id}','[^']*','[^']*','P\\d',')(done|partial|planned)(')`);if(!re.test(src)){console.error('not found: '+id);process.exitCode=1;continue}src=src.replace(re,`$1${status}$3`)}
await writeFile(file,src);console.log(status+': '+ids.join(', '));
