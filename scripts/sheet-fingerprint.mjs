#!/usr/bin/env node
// Prints one line, "sheet=<hash>", a fingerprint of a Google Sheet range, for run-check.mjs --cmd "node .../sheet-fingerprint.mjs ..." --cmd-once (12 Nov 2026):
// the model starts only when the range changed since the last run. Reads only. Exit 1 and nothing printed when the sheet cannot be read (the run goes ahead).
// Usage: node sheet-fingerprint.mjs --sheet <id> --range Master_Backlog!A2:I400 [--account pixel] [--gapi ~/.hermes/scripts/gapi.py]
//        (a "_" in the range is a space, so the command stays plain words: Master_Backlog means the tab "Master Backlog")
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const rangeOf=r=>{const [tab,cells]=String(r||'').split('!');if(!tab||!cells)throw Error('--range is Tab_name!A1:Z100');return "'"+tab.replace(/_/g,' ')+"'!"+cells};
export const fingerprint=values=>createHash('sha1').update(JSON.stringify(values||[])).digest('hex').slice(0,12);

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
 const args=process.argv.slice(2),opt=(n,d)=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:d};
 try{
  const sheet=opt('sheet'),range=rangeOf(opt('range'));if(!/^[\w-]{20,80}$/.test(sheet||''))throw Error('--sheet is a spreadsheet id');
  const gapi=opt('gapi',path.join(homedir(),'.hermes','scripts','gapi.py')),account=opt('account','default');
  execFile('python3',[gapi,'--account',account,'call','sheets','v4','spreadsheets.values.get','--params',JSON.stringify({spreadsheetId:sheet,range})],{timeout:25000,maxBuffer:8e6},(e,out)=>{
   try{if(e)throw e;console.log('sheet='+fingerprint(JSON.parse(out).values))}catch(x){console.error('sheet-fingerprint: '+String(x.message||x).slice(0,160));process.exit(1)}})
 }catch(x){console.error('sheet-fingerprint: '+x.message);process.exit(2)}}
