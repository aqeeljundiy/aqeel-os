// Google files as a hard lock (6 Nov 2026). Before this, an agent limited to its own sheet got a short-lived Google key
// in its own folder plus a list of its file IDs, and its sheet helper checked the list. The agent could read the key
// and run any code with it, so the list was a guard rail, not a lock. Now an agent with a file list holds no Google key
// at all: its sheet helper calls this endpoint (from this box only, its address signed per agent), and aqeelOS makes
// the Google call with the owner's sign-in, only on the files listed for that agent and only at its sharing level.
// Settings (owner-only file ~/.hermes/aqeelos-accounts.json, which agents cannot read):
//   google_files.<email>.<agent> = [file IDs]   the agent's files on that account; set = locked to them
// (its own key, next to the google policy that Connections rewrites, so saving levels never drops it)
// Calls: sheets v4 (spreadsheets.get/batchUpdate, values.*), docs v1 (documents.get/batchUpdate), drive v3 files.get.
import {readFile,writeFile,rename,stat,chmod,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';

const SHEETS='https://sheets.googleapis.com/v4/spreadsheets/',DOCS='https://docs.googleapis.com/v1/documents/',DRIVE='https://www.googleapis.com/drive/v3/files/';
const e=encodeURIComponent;
// method -> [http method, url builder, needs edit, id param]
export const METHODS={
 'sheets.spreadsheets.get':['GET',(id)=>SHEETS+e(id),false,'spreadsheetId'],
 'sheets.spreadsheets.batchUpdate':['POST',(id)=>SHEETS+e(id)+':batchUpdate',true,'spreadsheetId'],
 'sheets.spreadsheets.values.get':['GET',(id,p)=>SHEETS+e(id)+'/values/'+e(p.range),false,'spreadsheetId','range'],
 'sheets.spreadsheets.values.batchGet':['GET',(id)=>SHEETS+e(id)+'/values:batchGet',false,'spreadsheetId'],
 'sheets.spreadsheets.values.update':['PUT',(id,p)=>SHEETS+e(id)+'/values/'+e(p.range),true,'spreadsheetId','range'],
 'sheets.spreadsheets.values.append':['POST',(id,p)=>SHEETS+e(id)+'/values/'+e(p.range)+':append',true,'spreadsheetId','range'],
 'sheets.spreadsheets.values.clear':['POST',(id,p)=>SHEETS+e(id)+'/values/'+e(p.range)+':clear',true,'spreadsheetId','range'],
 'sheets.spreadsheets.values.batchUpdate':['POST',(id)=>SHEETS+e(id)+'/values:batchUpdate',true,'spreadsheetId'],
 'sheets.spreadsheets.values.batchClear':['POST',(id)=>SHEETS+e(id)+'/values:batchClear',true,'spreadsheetId'],
 'docs.documents.get':['GET',(id)=>DOCS+e(id),false,'documentId'],
 'docs.documents.batchUpdate':['POST',(id)=>DOCS+e(id)+':batchUpdate',true,'documentId'],
 'drive.files.get':['GET',(id)=>DRIVE+e(id),false,'fileId']};
const EDIT=new Set(['edit','draft','full']);

export function createGoogleFiles({HERMES_HOME,WORK,PORT,sig,token,levelOf,fetchImpl=fetch,log=m=>console.log(m)}){
 const policyFile=path.join(HERMES_HOME,'aqeelos-accounts.json');
 const readJson=async f=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return null}};
 // {email: [ids]} for one agent (its copies share the base agent's list)
 async function filesOf(agent){const g=(await readJson(policyFile))?.google_files||{},a=String(agent).split('--')[0],out={};
  for(const [email,ent] of Object.entries(g)){const l=ent?.[a];if(Array.isArray(l))out[email.toLowerCase()]=l.map(String)}return out}
 async function lockedAgents(){const g=(await readJson(policyFile))?.google_files||{},s=new Set();for(const ent of Object.values(g))for(const [a,l] of Object.entries(ent||{}))if(Array.isArray(l))s.add(a);return s}
 const locked=async agent=>(await lockedAgents()).has(String(agent).split('--')[0]);
 const url=a=>`http://127.0.0.1:${PORT}/google-files/${a}/${sig(a)}`;
 // one call for an agent: {service,version,method,params,body,account?} -> {status, json}
 async function call(agent,req){const fail=(status,error)=>({status,json:{error}});
  const service=String(req?.service||''),method=String(req?.method||''),key=service+'.'+method;const m=METHODS[key];
  if(!m)return fail(400,'aqeelOS does not offer '+key+' here. Allowed: '+Object.keys(METHODS).join(', ')+'.');
  const params={...(req.params&&typeof req.params==='object'?req.params:{})};const id=String(params[m[3]]||'');
  if(!id)return fail(400,'Missing '+m[3]+'.');if(m[4]&&!params[m[4]])return fail(400,'Missing '+m[4]+'.');
  const mine=await filesOf(agent);let email=req.account?String(req.account).toLowerCase():Object.keys(mine).find(x=>mine[x].includes(id));
  if(!email||!mine[email]?.includes(id))return fail(403,'aqeelOS only lets this agent use its own Google files (Abilities, Connections). Do not retry; tell the person which file you needed.');
  const level=await levelOf(email,agent).catch(()=>null);if(!level||level==='none')return fail(403,'This Google account is not shared with you in aqeelOS (Abilities, Connections).');
  if(m[2]&&!EDIT.has(level))return fail(403,'aqeelOS does not let this agent change Sheets, Docs or Drive files (Abilities, Connections). Do not retry; tell the person what you would have done.');
  let tok;try{tok=await token(email,EDIT.has(level)?'edit':'read')}catch(x){return fail(502,'aqeelOS could not get a Google key: '+x.message)}
  delete params[m[3]];if(m[4])delete params[m[4]];
  const q=new URLSearchParams();for(const [k,v] of Object.entries(params))for(const x of [].concat(v))q.append(k,typeof x==='object'?JSON.stringify(x):String(x));
  const u=m[1](id,{...req.params})+(q.toString()?'?'+q:'');
  const r=await fetchImpl(u,{method:m[0],headers:{authorization:'Bearer '+tok,'content-type':'application/json'},body:m[0]==='GET'?undefined:JSON.stringify(req.body||{}),signal:AbortSignal.timeout(60000)}).catch(x=>({ok:false,status:502,json:async()=>({error:String(x.message)})}));
  const j=await r.json().catch(()=>({}));log('google files: '+agent+' '+key+' '+id.slice(0,8)+'… '+r.status);return {status:r.ok?200:r.status,json:r.ok?j:{error:j.error||j}}}
 // the agent's sheet helper: .tools/sheet in its workspace, same commands as before ("call sheets v4 METHOD --params --body")
 const CLIENT=u=>`#!/usr/bin/env python3
# aqeelOS: this agent's Google files go through aqeelOS (it holds no Google key). Written by aqeelOS; edits are replaced.
# usage: sheet call SERVICE VERSION METHOD [--params JSON|@file] [--body JSON|@file] [--account EMAIL] [--out FILE]
import json,sys,urllib.request,urllib.error
U=${JSON.stringify(u)}
a=sys.argv[1:]
def pop(f):
    if f in a:
        i=a.index(f);v=a[i+1];del a[i:i+2];return v
    for i,x in enumerate(a):
        if x.startswith(f+'='):del a[i];return x.split('=',1)[1]
def load(v):
    if v is None:return None
    if v.startswith('@'):v=open(v[1:]).read()
    return json.loads(v)
p,b,acc,out=load(pop('--params')),load(pop('--body')),pop('--account'),pop('--out')
if a[:1]==['whoami']:print(json.dumps({"note":"aqeelOS makes this agent's Google calls; it holds no key"}));sys.exit(0)
if len(a)<4 or a[0]!='call':print(json.dumps({"error":"usage: sheet call sheets v4 spreadsheets.values.get --params JSON"}));sys.exit(1)
req=json.dumps({"service":a[1],"version":a[2],"method":a[3],"params":p or {},"body":b,"account":acc}).encode()
try:r=urllib.request.urlopen(urllib.request.Request(U,req,{"content-type":"application/json"}),timeout=90);t=r.read().decode();ok=True
except urllib.error.HTTPError as x:t=x.read().decode();ok=False
except Exception as x:t=json.dumps({"error":"aqeelOS could not be reached: "+str(x)});ok=False
if out and ok:open(out,'w').write(t);print(json.dumps({"saved":out}))
else:print(t)
sys.exit(0 if ok else (2 if '"error"' in t and 'aqeelOS' in t else 1))
`;
 async function ensureClients(){let n=0;for(const a of await lockedAgents()){const dir=path.join(WORK,a,'.tools');if(!await stat(dir).catch(()=>null))continue;
  const f=path.join(dir,'sheet'),want=CLIENT(url(a));if((await readFile(f,'utf8').catch(()=>''))===want)continue;
  const t=f+'.'+process.pid+'.tmp';await writeFile(t,want);await chmod(t,0o775);await rename(t,f);n++;log('google files: sheet helper set for '+a)}
  // the copies the engine synced into its own user's home earlier (aqeelOS-managed keys only; an own sign-in stays)
  for(const a of await lockedAgents()){const h=path.join(WORK,a,'.hermes');for(const f of await readdir(h).catch(()=>[])){if(!/^google_token(_[\w.-]+)?\.json$/.test(f))continue;
   const d=await readJson(path.join(h,f));if(d?.aqeelos_managed){await unlink(path.join(h,f)).catch(()=>{});n++;log('google files: synced key '+f+' removed from '+a)}}}
  return n}
 return {call,filesOf,locked,lockedAgents,ensureClients,url,METHODS}}
