#!/usr/bin/env node
// What a skill points to that is not there (the same check Health runs hourly, app/skill-check.mjs).
//   node scripts/skill-check.mjs <skill folder or skills folder> [...more]
// Prints each skill with its missing files and exits 1; prints "all present" and exits 0 when nothing is missing.
// The fixer uses it as the proof that a skill's references all resolve again.
import {homedir} from 'node:os';
import path from 'node:path';
import {checkSkills} from '../app/skill-check.mjs';

const dirs=process.argv.slice(2);if(!dirs.length){console.error('Use: node scripts/skill-check.mjs <skill folder> [...]');process.exit(2)}
let bad=0;
for(const d of dirs){const dir=path.resolve(d.replace(/^~(?=\/|$)/,homedir()));
 for(const x of await checkSkills(dir,{home:homedir()})){bad++;console.log(path.join(dir,x.skill)+': missing '+x.missing.join(', '))}}
if(bad)process.exit(1);console.log('all present');
