// Debt may only go down (audit 06, action 4). scripts/debt-baseline.json records today's numbers; this test measures them again
// (scripts/lib/debt.mjs) and fails when one went UP. A fix is to remove the new debt, never to raise the recorded number. When a change
// REDUCES debt, lower the recorded number in the same commit:  node scripts/lib/debt.mjs --lower
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {measure,BASELINE,storeBypass,inlineHomePaths,envReads} from './lib/debt.mjs';
const base=JSON.parse(readFileSync(BASELINE,'utf8')),now=measure();
const HOW={
 serverBytes:'app/server.mjs got bigger. Put new code in its own module under app/ (and keep the wiring to one line), or move code out of server.mjs, instead of growing it.',
 serverLines:'app/server.mjs got more lines. Put new code in its own module under app/, or move code out of server.mjs, instead of growing it.',
 modulesSavingJsonWithoutStore:'a module saves JSON with writeFile without app/store.mjs (readStore/updateStore/writeStore: atomic, and a file it could not read is never saved over). Use the store. Modules now: ',
 inlineAgentHomePaths:"an agent's home folder is worked out in place (a==='default'?HERMES_HOME:...). Use homeOf() from app/agentops.mjs. Places now in: ",
 timersTotal:'a new setInterval. Reuse an existing loop (docs/app-timers.md lists them) or justify it by lowering another.',
 timersInServer:'a new setInterval in app/server.mjs. Start background loops from their own module.',
 exportsNothingImports:'a new export that no file in app/ or scripts/ imports. Do not export what is only used inside its own file. Run: node scripts/lib/debt.mjs --exports',
 envReadButNotInEnvExample:'the code reads an environment variable that .env.example does not list. Add it there with a one-line description and a safe example. Missing now: '};
test('the baseline names every measured count', () => assert.deepEqual(Object.keys(base.counts).sort(),Object.keys(now).sort()));
for(const k of Object.keys(now))test('debt may only go down: '+k,()=>{
 const extra=k==='modulesSavingJsonWithoutStore'?storeBypass().join(', '):k==='inlineAgentHomePaths'?[...new Set(inlineHomePaths().mods)].join(', '):k==='envReadButNotInEnvExample'?envReads().missing.join(', '):'';
 assert.ok(now[k]<=base.counts[k],k+' went up from '+base.counts[k]+' to '+now[k]+': '+HOW[k]+extra+'\nFix it. Do not raise the number in scripts/debt-baseline.json; it may only be lowered, in the same commit that reduces the debt (node scripts/lib/debt.mjs --lower).');
 if(now[k]<base.counts[k])console.log('# '+k+' is now '+now[k]+', recorded '+base.counts[k]+': lower it with node scripts/lib/debt.mjs --lower')});
