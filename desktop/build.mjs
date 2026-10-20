// Builds the aqeelOS app installer: node build.mjs win | mac (ARCH=arm64|x64 picks the chip; the Mac one is built by
// .github/workflows/mac-app.yml on GitHub's Macs). Stamps the bundled Code with this install's aqeelOS address
// and Code's version (the commit, as aqeelOS reports it), so the installed copy keeps itself up to date from aqeelOS.
import {execFileSync} from 'node:child_process';import {writeFileSync,rmSync} from 'node:fs';import path from 'node:path';
const os=process.argv[2]==='mac'?'mac':'win',base=(process.env.AQEELOS_URL||'https://ai.elkiya.com').replace(/\/$/,'');
const root=path.resolve(import.meta.dirname,'..');const version=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim().slice(0,12);
const cfg=path.join(root,'aqeelos.json');writeFileSync(cfg,JSON.stringify({aqeelos:{base,origins:[base],version,brand:'aqeelOS'}},null,1));
try{execFileSync(process.platform==='win32'?'npx.cmd':'npx',['electron-builder',os==='mac'?'--mac':'--win',...(os==='mac'?['dmg']:['nsis']),...(/^(arm64|x64)$/.test(process.env.ARCH||'')?['--'+process.env.ARCH]:[])],{cwd:import.meta.dirname,stdio:'inherit',shell:process.platform==='win32'})}
finally{rmSync(cfg,{force:true})}
console.log('built for',os,'· Code',version,'· aqeelOS',base);
