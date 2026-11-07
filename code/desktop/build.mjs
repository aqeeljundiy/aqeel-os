// Builds the aqeelOS app installer: node build.mjs win | mac (ARCH=arm64|x64|universal picks the chip; universal runs on
// Apple Silicon and Intel). Nothing about one install is built in: the app asks for its aqeelOS address on first launch.
// Your own build settings go in build.config.json next to this file (never in git; see build.config.example.json and
// BUILDING.md): the app id, an optional address to fill in for your people, and the publisher name. Signing and
// notarising use electron-builder's usual environment variables (CSC_LINK, APPLE_ID, APPLE_TEAM_ID...), also never in git.
// The bundled Code is stamped with its version (the commit), so the installed copy keeps itself up to date from the
// aqeelOS it is paired with.
import {execFileSync} from 'node:child_process';import {writeFileSync,rmSync,readFileSync,existsSync} from 'node:fs';import path from 'node:path';
const os=process.argv[2]==='mac'?'mac':'win',here=import.meta.dirname,root=path.resolve(here,'..');
const cfgFile=path.join(here,'build.config.json');const cfg=existsSync(cfgFile)?JSON.parse(readFileSync(cfgFile,'utf8')):{};
const clean=u=>{try{return u?new URL(u).origin:''}catch{throw Error('build.config.json: address must look like https://ai.example.com')}};
const base=clean(process.env.AQEELOS_URL||cfg.address||'');
if(cfg.appId&&!/^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/i.test(cfg.appId))throw Error('build.config.json: appId looks like org.example.aqeelos');
const version=execFileSync('git',['log','-1','--format=%H','--','.'],{cwd:root,encoding:'utf8'}).trim().slice(0,12);
const stamp=path.join(root,'aqeelos.json');writeFileSync(stamp,JSON.stringify({aqeelos:{...(base?{base,origins:[base]}:{}),version,brand:'aqeelOS'}},null,1));
// Mac: with no Developer ID (none in the keychain, no CSC_LINK) electron-builder leaves the app unsigned, and an
// unsigned app does not open on Apple Silicon at all; it is signed ad-hoc then (macOS asks once, in Privacy & Security)
const hasDevId=()=>{try{return /Developer ID Application/.test(execFileSync('security',['find-identity','-v','-p','codesigning'],{encoding:'utf8'}))}catch{return false}};
const macIdentity=os!=='mac'?'':cfg.macIdentity||(process.env.CSC_LINK||process.env.CSC_NAME||hasDevId()?'':'-');
const extra=[...(macIdentity?['-c.mac.identity='+macIdentity]:[]),...(cfg.appId?['-c.appId='+cfg.appId]:[]),...(cfg.publisherName&&os==='win'?['-c.win.signtoolOptions.publisherName='+cfg.publisherName]:[]),...(cfg.copyright?['-c.copyright='+cfg.copyright]:[])];
try{execFileSync(process.platform==='win32'?'npx.cmd':'npx',['electron-builder',os==='mac'?'--mac':'--win',...(os==='mac'?['dmg']:['nsis']),...(/^(arm64|x64|universal)$/.test(process.env.ARCH||'')?['--'+process.env.ARCH]:[]),...extra],{cwd:here,stdio:'inherit',shell:process.platform==='win32'})}
finally{rmSync(stamp,{force:true})}
console.log('built for',os,'· Code',version,'· app id',cfg.appId||'(package.json)','·',base?'address '+base:'asks for the address on first launch');
