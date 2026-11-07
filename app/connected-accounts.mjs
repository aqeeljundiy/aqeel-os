// Connected accounts (31 Oct 2026): every login where an agent acts AS THE OWNER, not as a bot: the owner's own Google
// accounts, Slack and Notion sign-ins (user sign-ins, so a message goes out with the owner's name on it) and, once one is
// made, a personal Telegram session. Bots people message are Channels; services the agents work through (n8n,
// Composio, API keys) stay under Connected apps and Keys. For each login aqeelOS keeps:
//   - who it is (the email, the Slack user and workspace, the Notion user), the agents that use it (access.mjs) and what
//     they may do: read, draft, send (all three unless the owner takes one away; for Google gapi.py refuses the rest,
//     for apps the tools for it are left out of the agents' tool list);
//   - its state, checked cheaply (Google: Gmail getProfile through gapi.py; Slack: auth.test; others: the saved sign-in),
//     when it was last used and the last 10 things agents did with it, in plain words ("Read 4 Slack channels"), from the
//     engine logs (mcp__<server>__<tool> lines) and the gapi.py commands in the agents' chats (state.db, read only);
//   - Pause: every agent at once, undone exactly by Resume. An app is removed from each agent through the engine's
//     dashboard (that is what makes the engine drop it at once) and added back switched off, its settings kept here to
//     put back; a Google sign-in file is moved aside (<file>.paused), and gapi.py says "paused in aqeelOS";
//   - Disconnect: revoked at Google or Slack, the saved sign-in deleted, the app removed from every agent and from Access.
// A login that appears without the agent calling register_account (an aqeelOS tool) shows "Not registered", adds one
// Bottlenecks item and waits for the owner to approve or disconnect it. The logins there were when this first ran count as
// registered. The parts that only decide are exported and tested in scripts/connected-accounts.test.mjs.
// 1 Nov 2026 (Abilities › Connections): a login's name is always the service and who it is ("Google · a@b.com",
// "Slack · Pixel & Profits"), never what an agent called it (register_account's label is kept as a note), and what
// it may do is per agent: canBy[agent] (Read, Read & draft, Full) over the login's own can.
import {canOfLevel} from './sharing.mjs';
import {readFile,writeFile,mkdir,rename,readdir,stat,lstat,realpath,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {parseLogLine,createTail,readRange} from './automation-guard.mjs';

/* ---------- the parts that only decide (tested) ---------- */
const h8=s=>createHash('sha256').update(String(s)).digest('hex').slice(0,8);
// edit (5 Nov 2026): change Sheets, Docs and Drive files without sending mail; send also allows edit and draft
export const CAN=['read','edit','draft','send'];
// services the agents work through, never "as you" (their own accounts, or the owner's apps behind one more sign-in)
export const SERVICE_RE=/composio|rube\.app|\bn8n\b|zapier|pipedream|make\.com|aqeelos/i;
const BOT_KEY=/^(SLACK_BOT_TOKEN|SLACK_APP_TOKEN|TELEGRAM_BOT_TOKEN|DISCORD_BOT_TOKEN|WHATSAPP_.*|SIGNAL_.*|TEAMS_.*)$/;
export const PROVIDERS=[{id:'slack',re:/slack/i,name:'Slack',logo:'slack.com'},{id:'notion',re:/notion/i,name:'Notion',logo:'notion.so'},{id:'google',re:/google|gmail/i,name:'Google',logo:'google.com'},
 {id:'telegram',re:/telegram/i,name:'Telegram',logo:'telegram.org'},{id:'github',re:/github/i,name:'GitHub',logo:'github.com'},{id:'linear',re:/linear/i,name:'Linear',logo:'linear.app'},
 {id:'atlassian',re:/atlassian|jira|confluence/i,name:'Atlassian',logo:'atlassian.com'},{id:'figma',re:/figma/i,name:'Figma',logo:'figma.com'},{id:'asana',re:/asana/i,name:'Asana',logo:'asana.com'},{id:'hubspot',re:/hubspot/i,name:'HubSpot',logo:'hubspot.com'}];
export function providerOf(...texts){const s=texts.filter(Boolean).join(' ');const p=PROVIDERS.find(x=>x.re.test(s));if(p)return {id:p.id,name:p.name,logo:p.logo};
 const host=(/https?:\/\/([^/\s:]+)/.exec(s)||[])[1]||'',base=host.split('.').slice(-2).join('.');return {id:base||'other',name:base?base.split('.')[0].replace(/^./,c=>c.toUpperCase()):'Account',logo:base}}
// what a login is: as 'me' (acts as the owner), 'bot' (a bot people message), 'service' (a service the agents work
// through) or null (nothing signed in yet). x: {type:'mcp',name,entry,token,meta} | {type:'key',name,value} | {type:'file',file}
export function classify(x={}){
 if(x.type==='file'){const f=path.basename(String(x.file||''));if(/^google_token(?:_[\w.-]+)?\.json(?:\.paused)?$/.test(f))return {as:'me',kind:'google'};if(/\.session(?:\.paused)?$/.test(f))return {as:'me',kind:'telegram-user'};return {as:null}}
 if(x.type==='key'){const n=String(x.name||''),v=String(x.value||'');if(BOT_KEY.test(n)||/^xox[ba]-/.test(v))return {as:'bot'};if(/^xoxp-/.test(v)||/_USER_(TOKEN|SESSION)$/.test(n))return {as:'me',kind:'other'};return {as:'service'}}
 if(x.type==='mcp'){const e=x.entry||{},t=x.token||null,where=[x.name,e.url,e.command,t?.hermes_issuer,x.meta?.issuer].filter(Boolean).join(' ');
  if(x.name==='aqeelos-notify'||SERVICE_RE.test(where))return {as:'service'};
  if(/^xox[ba]-/.test(String(t?.access_token||'')))return {as:'bot'};
  if(t&&(t.access_token||t.refresh_token))return {as:'me',kind:'mcp-oauth'};
  return e.auth==='oauth'?{as:null,kind:'mcp-oauth'}:{as:'service'}}   // set up for a sign-in nobody made yet: nothing to show
 return {as:null}}

// one engine log line about an app's tool: {t (UTC ms), tool, ok, session}; null for anything else
const TS=/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(?:,(\d{1,3}))?\s/;
export function parseToolLine(l){const m=TS.exec(l||'');if(!m)return null;const x=/agent\.tool_executor: (?:tool (mcp__\S+) (completed|failed)|Tool (mcp__\S+) returned error)/.exec(l);if(!x)return null;
 const s=/\[([^\]\s]{4,120})\]\s+agent\.tool_executor/.exec(l);return {t:Date.parse(m[1]+'T'+m[2]+'.'+(m[3]||'0').padEnd(3,'0')+'Z'),tool:x[1]||x[3],ok:x[2]==='completed',session:s?s[1]:''}}
// the engine names an app's tools mcp__<server>__<tool> with the server's - and . turned into _ (notion-aqeel: mcp__notion_aqeel__…)
export const toolSlug=n=>String(n).replace(/[^A-Za-z0-9_]/g,'_');
export function serverOfTool(tool,servers){let best=null;for(const s of servers||[]){const p='mcp__'+toolSlug(s)+'__';if(String(tool).startsWith(p)&&(!best||p.length>best.p.length))best={s,p}}return best?{server:best.s,fn:String(tool).slice(best.p.length)}:null}
// the Google calls in one terminal command: gapi.py [--account N] call SERVICE VERSION METHOD, its draft / upload /
// export / sheet-pdf commands, and the skill's google_api.py [--account N] SERVICE ACTION. Calls through a shell
// variable ($a) are skipped: which account they used is not known.
export function parseGapi(cmd){const out=[];
 for(const m of String(cmd||'').matchAll(/\b(gapi|google_api)\.py\b([^\n;&|]*)/g)){const args=m[2].trim().split(/\s+/).filter(Boolean).map(a=>a.replace(/^['"]+|['"]+$/g,''));let account='';
  for(let i=0;i<args.length;i++){if(args[i]==='--account'){account=args[i+1]||'';args.splice(i,2);i--}else if(args[i].startsWith('--account=')){account=args[i].slice(10);args.splice(i,1);i--}}
  if(/[$`]/.test(account)||account&&!/^[\w.-]{1,60}$/.test(account))continue;const w=args.map(a=>a.toLowerCase());let service='',method='';
  if(m[1]==='gapi'){if(w[0]==='call'){service=w[1];method=args[3]||''}else if(w[0]==='draft'){service='gmail';method='users.drafts.create'}else if(w[0]==='upload'){service='drive';method='files.create'}else if(w[0]==='export'){service='drive';method='files.export'}else if(w[0]==='sheet-pdf'){service='sheets';method='spreadsheets.export'}else continue}
  else{service=w[0];method=w[1]||''}
  if(!/^[a-z]{3,20}$/.test(service||'')||!/^[A-Za-z][\w.]{1,80}$/.test(method||''))continue;out.push({account,service,method})}
 return out}

// one action in plain words: {kind: read | draft | send | write, verb, noun} from an app's tool name (slack_read_channel,
// verb first) or a Google method (users.drafts.create, verb last)
const VERBS={read:['read','Read'],get:['read','Read'],fetch:['read','Opened'],view:['read','Read'],open:['read','Opened'],describe:['read','Read'],export:['read','Exported'],download:['read','Downloaded'],history:['read','Read'],batchget:['read','Read'],getprofile:['read','Read'],
 search:['read','Searched'],query:['read','Searched'],list:['read','Searched'],find:['read','Searched'],lookup:['read','Looked up'],
 send:['send','Sent'],post:['send','Sent'],reply:['send','Sent'],forward:['send','Forwarded'],publish:['send','Published'],schedule:['send','Scheduled'],
 create:['write','Created'],add:['write','Added'],append:['write','Added to'],insert:['write','Added'],upload:['write','Uploaded'],copy:['write','Copied'],
 update:['write','Changed'],edit:['write','Changed'],patch:['write','Changed'],set:['write','Changed'],move:['write','Moved'],modify:['write','Changed'],batchupdate:['write','Changed'],rename:['write','Renamed'],share:['write','Shared'],react:['write','Reacted to'],reactions:['write','Reacted to'],
 delete:['write','Deleted'],remove:['write','Removed'],trash:['write','Deleted'],archive:['write','Archived'],clear:['write','Cleared']};
const FILLER=new Set(['public','and','private','data','sources','source','by','id','ids','v1','v2','v3','v4','me','self','batch','info','all','my','the','a','to','in','of','for','users','with','status','message_draft']);
const NOUN={spreadsheets:'sheet',spreadsheet:'sheet',values:'sheet',sheets:'sheet',files:'Drive file',file:'file',documents:'doc',document:'doc',docs:'doc',events:'calendar event',event:'calendar event',messages:'message',threads:'thread',drafts:'draft',labels:'label',permissions:'sharing',
 channels:'channel',canvases:'canvas',canvas:'canvas',pages:'page',database:'database',databases:'database',view:'view',views:'view',user:'person',profile:'person',people:'person',calendars:'calendar',comments:'comment',comment:'comment',records:'record',record:'record',lists:'list'};
const one=w=>NOUN[w]||(w.endsWith('ies')?w.slice(0,-3)+'y':w.length>3&&w.endsWith('s')&&!w.endsWith('ss')?w.slice(0,-1):w);
export function actionOf(provider,fn,{verbLast=false}={}){const tok=String(fn||'').toLowerCase().split(/[._\s-]+/).filter(Boolean).filter(t=>t!==provider);
 const order=verbLast?[...tok].reverse():tok;const vt=order.find(t=>VERBS[t]);let [kind,verb]=vt?VERBS[vt]:['read','Used'];
 // a draft is saved, not sent: slack_send_message_draft, users.drafts.create (users.drafts.send sends it)
 if(tok.some(t=>t==='draft'||t==='drafts')&&kind!=='read'&&tok[tok.length-1]!=='send'){kind='draft';verb='Saved'}
 const nt=tok.find(t=>t!==vt&&!VERBS[t]&&!FILLER.has(t)&&!(kind==='draft'&&/^drafts?$/.test(t))&&!/^\d/.test(t));const noun=kind==='draft'?'draft':nt?one(nt):'';
 return {kind,verb,noun}}
// may an action of this kind run with these allowed actions (read always may)
export const allowed=(kind,can)=>kind==='read'||(kind==='draft'?can.includes('draft'):can.includes('send'));
// what one app tool needs (1 Nov 2026): read, draft or send. A comment counts as a draft (it stays a note on the thing,
// not a message out), so Read & draft may comment; everything else that changes or sends needs Full, and so does a tool
// whose name does not say what it does.
export function toolNeed(prov,tool){const a=actionOf(prov,tool);if(a.kind==='draft'||a.kind==='read'&&a.verb!=='Used')return a.kind;   // a tool whose name says nothing known (COMPOSIO_EXECUTE) needs Full
 const t=String(tool||'').toLowerCase().split(/[._\s-]+/);return t.some(w=>/^comments?$/.test(w))&&t.some(w=>/^(create|add|reply|post|insert)$/.test(w))?'draft':'send'}
const PROV_WORD={gmail:'Gmail',drive:'Drive',sheets:'Sheets',docs:'Docs',calendar:'Calendar',slack:'Slack',notion:'Notion'};
const pl=(n,w)=>n===1?w:w==='person'?'people':w==='sharing'?w:/(s|sh|ch|x)$/.test(w)?w+'es':w+'s';
// "Read 4 Slack channels", "Saved 1 draft", "Searched Notion 3 times", "Sent 1 email"
export function sentence(a,n=1,prov=''){const P=PROV_WORD[prov]||prov.replace(/^./,c=>c.toUpperCase());let noun=a.noun;
 if(prov==='gmail'&&(noun==='message'||noun==='thread'))noun=noun==='message'?'email':'email thread';
 const google=['gmail','drive','sheets','docs','calendar'].includes(prov),withProv=!google||!noun;
 let t;if(a.kind==='draft')t='Saved '+n+' '+pl(n,'draft');
 else if(a.verb==='Searched'||a.verb==='Looked up'&&!noun)t=a.verb+' '+(P||'it')+(n>1?' '+n+' times':'');
 else if(noun==='sharing')t=a.kind==='read'?'Checked who can open '+n+' '+pl(n,'file'):'Shared '+n+' '+pl(n,'file');
 else if(!noun)t=(a.kind==='read'?'Looked at ':a.verb+' in ')+(P||'it')+(n>1?' '+n+' times':'');
 else if(a.kind==='send'&&prov==='slack'&&noun==='message'||a.kind==='send'&&!noun)t=a.verb+' '+n+' '+(P?P+' ':'')+pl(n,'message');
 else t=a.verb+' '+n+' '+(withProv&&P&&!noun.startsWith(P)?P+' ':'')+pl(n,noun);
 return t}
// the last actions of one account, put together: one line for a run of the same thing by the same agent within 15 min
export function summarise(events,{limit=10,gap=15*60e3}={}){const ev=[...(events||[])].sort((a,b)=>a.t-b.t),groups=[];
 for(const e of ev){const k=e.agent+'|'+e.kind+'|'+e.verb+'|'+e.noun+'|'+(e.ok!==false)+'|'+(e.prov||''),g=groups[groups.length-1];
  if(g&&g.k===k&&e.t-g.at<=gap){g.n++;g.at=e.t;if(e.raw&&!g.tools.includes(e.raw))g.tools.push(e.raw);continue}
  groups.push({k,from:e.t,at:e.t,n:1,agent:e.agent,kind:e.kind,verb:e.verb,noun:e.noun,prov:e.prov||'',ok:e.ok!==false,tools:e.raw?[e.raw]:[]})}
 return groups.slice(-limit).reverse().map(g=>({at:g.at,from:g.from,n:g.n,agent:g.agent,kind:g.kind,ok:g.ok,text:sentence(g,g.n,g.prov)+(g.ok?'':' (it failed)'),tools:g.tools.slice(0,6)}))}

// an app's settings with some of its tools left out (what the owner took away), and back: orig is its own `tools`
// setting from before aqeelOS changed it (undefined: it had none)
export function withCan(entry,blocked,orig){const e=structuredClone(entry||{});const o=orig===undefined?undefined:structuredClone(orig);
 if(!blocked?.length){if(o===undefined)delete e.tools;else e.tools=o;return e}
 const t=o&&typeof o==='object'?{...o}:{};if(Array.isArray(t.include))t.include=t.include.filter(x=>!blocked.includes(x));else t.exclude=[...new Set([...(Array.isArray(t.exclude)?t.exclude:[]),...blocked])];
 e.tools=t;return e}
export const pausedEntry=entry=>({...structuredClone(entry||{}),enabled:false});
// the tools of an app the allowed actions leave out
export const blockedTools=(tools,can,prov)=>(tools||[]).filter(t=>{const n=toolNeed(prov,t);return n!=='read'&&!can.includes(n)});
// does a registration an agent made (register_account) describe this login: the same place, or the same kind and app
const tilde=(p,home)=>String(p||'').replace(/^~(?=\/|$)/,home||homedir());
export function matches(reg,acct,home){if(!reg||!acct)return false;const w=tilde(reg.where,home);
 if(w&&(acct.paths||[]).some(p=>p===w||p===w+'.paused'||path.basename(p)===path.basename(w)&&w.includes(path.sep)===false))return true;
 if(w&&acct.mcp&&(path.basename(w).replace(/\.json$/,'')===acct.mcp))return true;
 const k=String(reg.kind||'').toLowerCase();if(k&&k!==acct.kind)return false;
 const words=String(reg.label||'').toLowerCase().split(/[^a-z0-9@.]+/).filter(x=>x.length>2);const hay=[acct.label||displayName(acct),acct.identity,acct.mcp,acct.provider].join(' ').toLowerCase();
 return words.length>0&&words.filter(x=>hay.includes(x)).length>=Math.min(2,words.length)}
// a login's name (1 Nov 2026): the service, then who it is, from what the service itself says; never an agent's label
const SERVICE_CASE={n8n:'n8n',github:'GitHub',adspower:'AdsPower',aqeelos:'aqeelOS',hubspot:'HubSpot',composio:'Composio'};
export const serviceName=(id,fallback='')=>SERVICE_CASE[String(id).toLowerCase()]||(PROVIDERS.find(p=>p.id===id)?.name)||fallback||String(id||'').split(/[-_\s]+/).filter(Boolean).map((w,i)=>SERVICE_CASE[w.toLowerCase()]||(i?w:w.replace(/^./,c=>c.toUpperCase()))).join(' ');
export function displayName(x={}){const who=x.who||{};
 if(x.kind==='google')return 'Google · '+(x.identity||'not checked yet');
 if(x.kind==='mcp-oauth'){const p=providerOf(x.mcp,x.url,x.provider);const last=String(x.identity||'').split(' · ').pop();return serviceName(p.id,p.name)+' · '+(who.workspace||who.user||who.email||last||x.mcp)}
 if(x.kind==='telegram-user')return 'Telegram · '+(x.identity||path.basename(String(x.paths?.[0]||x.files?.[0]?.path||'')).replace(/\.session(\.paused)?$/,'')||'personal account');
 const p=providerOf(x.provider);return serviceName(p.id,p.name)+' · '+(x.identity||path.basename(String(x.where||''))||x.id)}
export const normCan=v=>{const l=(Array.isArray(v)?v:String(v||'').split(/[\s,·]+/)).map(x=>String(x).toLowerCase().trim()).map(x=>x==='write'?'send':x).filter(x=>CAN.includes(x));return CAN.filter(c=>l.includes(c))};

/* ---------- gapi.py: the paused marker and the allowed actions (an idempotent patch, applied at start) ---------- */
const GAPI_TAG='aqeelos:accounts-guard',GAPI_V2='aqeelos:accounts-guard-v2',GAPI_V3='aqeelos:accounts-guard-v3',GAPI_V4='aqeelos:accounts-guard-v4';
// the first guard (31 Oct 2026), exactly as it went in: a gapi.py that has it gets the per-agent one in its place
const GAPI_V1=`
# ${GAPI_TAG} (31 Oct 2026): aqeelOS (Abilities, Connected accounts) can pause a Google account (its token file is
# moved aside as <file>.paused) or limit what it may do (read, draft, send, in aqeelos-accounts.json). Nothing changes
# while neither is set.
def _aq_policy():
    for d in (HOME, HOME.parent.parent, Path.home() / ".hermes"):
        f = d / "aqeelos-accounts.json"
        if f.is_file():
            try:
                return json.loads(f.read_text()) or {}
            except Exception:
                return {}
    return {}


def _aq_paused(account):
    name = f"google_token_{account}.json" if account else "google_token.json"
    if not (HOME / name).exists() and (HOME / (name + ".paused")).exists():
        raise SystemExit(json.dumps({"error": "this Google account is paused in aqeelOS (Abilities, Connected accounts). "
                                              "Do not retry; tell the person it is paused and ask them to resume it there."}))


def _aq_guard(account, cmd, rest):
    _aq_paused(account)
    pol = (_aq_policy().get("google") or {})
    if not pol:
        return
    name = f"google_token_{account}.json" if account else "google_token.json"
    try:
        email = json.loads((HOME / name).read_text()).get("account", "")
    except Exception:
        return
    can = (pol.get(email) or {}).get("can")
    if not isinstance(can, list):
        return
    need = None
    if cmd == "draft":
        need = "draft"
    elif cmd == "upload":
        need = "send"
    elif cmd == "call" and len(rest) >= 3:
        parts = rest[2].split(".")
        if rest[0] == "gmail" and "drafts" in parts and parts[-1] in ("create", "update"):
            need = "draft"
        elif not parts[-1].endswith(("get", "list", "batchGet", "getByDataFilter", "batchGetByDataFilter", "export", "getProfile")):
            need = "send"
    if need and need not in can:
        print(json.dumps({"error": "aqeelOS does not let this Google account " + ("save drafts" if need == "draft" else "send or change things")
                                   + " (Abilities, Connected accounts). Do not retry; tell the person what you would have done."}))
        sys.exit(2)

`;
const GAPI_V2_FNS=`
# ${GAPI_TAG} (31 Oct 2026, ${GAPI_V2} 1 Nov 2026): aqeelOS (Abilities, Connections) can pause a Google account (its
# token file is moved aside as <file>.paused) or limit what each agent may do with it (read, draft, send, in
# aqeelos-accounts.json: google.<email>.agents.<agent>, else google.<email>.can). Nothing changes while neither is set.
def _aq_policy():
    for d in (HOME, HOME.parent.parent, Path.home() / ".hermes"):
        f = d / "aqeelos-accounts.json"
        if f.is_file():
            try:
                return json.loads(f.read_text()) or {}
            except Exception:
                return {}
    return {}


def _aq_paused(account):
    name = f"google_token_{account}.json" if account else "google_token.json"
    if not (HOME / name).exists() and (HOME / (name + ".paused")).exists():
        raise SystemExit(json.dumps({"error": "this Google account is paused in aqeelOS (Abilities, Connections). "
                                              "Do not retry; tell the person it is paused and ask them to resume it there."}))


def _aq_guard(account, cmd, rest):
    _aq_paused(account)
    pol = (_aq_policy().get("google") or {})
    if not pol:
        return
    name = f"google_token_{account}.json" if account else "google_token.json"
    try:
        email = json.loads((HOME / name).read_text()).get("account", "")
    except Exception:
        return
    ent = pol.get(email) or {}
    # the agent running this: its own engine home is .../profiles/<agent>, the main one is "default"
    me = HOME.name if HOME.parent.name == "profiles" else "default"
    per = ent.get("agents") if isinstance(ent.get("agents"), dict) else {}
    can = per.get(me, per.get(me.split("--")[0], ent.get("can")))
    if not isinstance(can, list):
        return
    need = None
    if cmd == "draft":
        need = "draft"
    elif cmd == "upload":
        need = "send"
    elif cmd == "call" and len(rest) >= 3:
        parts = rest[2].split(".")
        if rest[0] == "gmail" and "drafts" in parts and parts[-1] in ("create", "update"):
            need = "draft"
        elif not parts[-1].endswith(("get", "list", "batchGet", "getByDataFilter", "batchGetByDataFilter", "export", "getProfile")):
            need = "send"
    if need and need not in can:
        print(json.dumps({"error": "aqeelOS does not let this Google account " + ("save drafts" if need == "draft" else "send or change things")
                                   + " (Abilities, Connections). Do not retry; tell the person what you would have done."}))
        sys.exit(2)

`;
const GAPI_V3_FNS=`
# ${GAPI_TAG} (31 Oct 2026, ${GAPI_V2} 1 Nov 2026, ${GAPI_V3} 5 Nov 2026: edit = Sheets/Docs/Drive changes without mail): aqeelOS (Abilities, Connections) can pause a Google account (its
# token file is moved aside as <file>.paused) or limit what each agent may do with it (read, draft, send, in
# aqeelos-accounts.json: google.<email>.agents.<agent>, else google.<email>.can). Nothing changes while neither is set.
def _aq_policy():
    for d in (HOME, HOME.parent.parent, Path.home() / ".hermes"):
        f = d / "aqeelos-accounts.json"
        if f.is_file():
            try:
                return json.loads(f.read_text()) or {}
            except Exception:
                return {}
    return {}


def _aq_paused(account):
    name = f"google_token_{account}.json" if account else "google_token.json"
    if not (HOME / name).exists() and (HOME / (name + ".paused")).exists():
        raise SystemExit(json.dumps({"error": "this Google account is paused in aqeelOS (Abilities, Connections). "
                                              "Do not retry; tell the person it is paused and ask them to resume it there."}))


def _aq_guard(account, cmd, rest):
    _aq_paused(account)
    pol = (_aq_policy().get("google") or {})
    if not pol:
        return
    name = f"google_token_{account}.json" if account else "google_token.json"
    try:
        email = json.loads((HOME / name).read_text()).get("account", "")
    except Exception:
        return
    ent = pol.get(email) or {}
    # the agent running this: its own engine home is .../profiles/<agent>, the main one is "default"
    me = HOME.name if HOME.parent.name == "profiles" else "default"
    per = ent.get("agents") if isinstance(ent.get("agents"), dict) else {}
    can = per.get(me, per.get(me.split("--")[0], ent.get("can")))
    if not isinstance(can, list):
        return
    need = None
    if cmd == "draft":
        need = "draft"
    elif cmd == "upload":
        need = "edit"
    elif cmd == "call" and len(rest) >= 3:
        parts = rest[2].split(".")
        if rest[0] == "gmail" and "drafts" in parts and parts[-1] in ("create", "update"):
            need = "draft"
        elif not parts[-1].endswith(("get", "list", "batchGet", "getByDataFilter", "batchGetByDataFilter", "export", "getProfile")):
            need = "send" if rest[0] in ("gmail", "calendar", "people", "contacts") else "edit"
    have = set(can)
    if "send" in have:
        have |= {"edit", "draft"}
    if "draft" in have:
        have.add("edit")
    if need and need not in have:
        print(json.dumps({"error": "aqeelOS does not let this Google account " + ("save drafts" if need == "draft" else "change Sheets, Docs or Drive files" if need == "edit" else "send or change mail and calendars")
                                   + " (Abilities, Connections). Do not retry; tell the person what you would have done."}))
        sys.exit(2)

`;
const GAPI_FNS=`
# ${GAPI_TAG} (31 Oct 2026, ${GAPI_V2} 1 Nov 2026, ${GAPI_V3} 5 Nov 2026: edit = Sheets/Docs/Drive changes without mail, ${GAPI_V4}: sharing levels): aqeelOS (Abilities, Connections) can pause a Google account (its
# token file is moved aside as <file>.paused) or limit what each agent may do with it (read, draft, send, in
# aqeelos-accounts.json: google.<email>.agents.<agent>, else google.<email>.can). Nothing changes while neither is set.
def _aq_policy():
    for d in (HOME, HOME.parent.parent, Path.home() / ".hermes"):
        f = d / "aqeelos-accounts.json"
        if f.is_file():
            try:
                return json.loads(f.read_text()) or {}
            except Exception:
                return {}
    return {}


def _aq_paused(account):
    name = f"google_token_{account}.json" if account else "google_token.json"
    if not (HOME / name).exists() and (HOME / (name + ".paused")).exists():
        raise SystemExit(json.dumps({"error": "this Google account is paused in aqeelOS (Abilities, Connections). "
                                              "Do not retry; tell the person it is paused and ask them to resume it there."}))


def _aq_guard(account, cmd, rest):
    _aq_paused(account)
    pol = (_aq_policy().get("google") or {})
    if not pol:
        return
    name = f"google_token_{account}.json" if account else "google_token.json"
    try:
        email = json.loads((HOME / name).read_text()).get("account", "")
    except Exception:
        return
    ent = pol.get(email) or {}
    # the agent running this: its own engine home is .../profiles/<agent>, the main one is "default"
    me = HOME.name if HOME.parent.name == "profiles" else "default"
    per = ent.get("agents") if isinstance(ent.get("agents"), dict) else {}
    can = per.get(me, per.get(me.split("--")[0], ent.get("can")))
    # aqeelos:accounts-guard-v4: sharing levels; an agent with no access to this account may not use it at all
    if me.split("--")[0] in (ent.get("deny") or []):
        print(json.dumps({"error": "this Google account is not shared with you in aqeelOS (Abilities, Connections). "
                                   "Do not retry; ask its owner agent or the person to share it."}))
        sys.exit(2)
    if not isinstance(can, list):
        return
    need = None
    if cmd == "draft":
        need = "draft"
    elif cmd == "upload":
        need = "edit"
    elif cmd == "call" and len(rest) >= 3:
        parts = rest[2].split(".")
        if rest[0] == "gmail" and "drafts" in parts and parts[-1] in ("create", "update"):
            need = "draft"
        elif not parts[-1].endswith(("get", "list", "batchGet", "getByDataFilter", "batchGetByDataFilter", "export", "getProfile")):
            need = "send" if rest[0] in ("gmail", "calendar", "people", "contacts") else "edit"
    have = set(can)
    if "send" in have:
        have |= {"edit", "draft"}
    if "draft" in have:
        have.add("edit")
    if need and need not in have:
        print(json.dumps({"error": "aqeelOS does not let this Google account " + ("save drafts" if need == "draft" else "change Sheets, Docs or Drive files" if need == "edit" else "send or change mail and calendars")
                                   + " (Abilities, Connections). Do not retry; tell the person what you would have done."}))
        sys.exit(2)

`;
// gapi.py with the guard in, or null when its known places are not there (a newer gapi.py: left alone, said once)
export function patchGapiText(s){if(s.includes(GAPI_V4))return s;
 if(s.includes(GAPI_V3)){const o=GAPI_V3_FNS.split('\n').slice(1).join('\n'),n=GAPI_FNS.split('\n').slice(1).join('\n');return s.split(o).length===2?s.replace(o,n):null}
 if(s.includes(GAPI_V2)){const o=GAPI_V2_FNS.split('\n').slice(1).join('\n'),n=GAPI_FNS.split('\n').slice(1).join('\n');return s.split(o).length===2?s.replace(o,n):null}
 if(s.includes(GAPI_TAG)){const v1=GAPI_V1.split('\n').slice(1).join('\n'),v2=GAPI_FNS.split('\n').slice(1).join('\n');return s.split(v1).length===2?s.replace(v1,v2):null}
 const a='HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))\n',b='def _creds(account):\n',c='    _readonly_guard(account, cmd, rest)\n';
 if(s.split(a).length!==2||s.split(b).length!==2||s.split(c).length!==2)return null;
 return s.replace(a,a+'\n'+GAPI_FNS).replace(b,b+'    _aq_paused(account)  # '+GAPI_TAG+'\n').replace(c,'    _aq_guard(account, cmd, rest)  # '+GAPI_TAG+'\n'+c)}

/* ---------- the registry ---------- */
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const readJson=async f=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return null}};
const run=(cmd,args,{timeout=30000,env}={})=>new Promise(res=>execFile(cmd,args,{timeout,maxBuffer:8e6,env:env||process.env},(e,o,er)=>res({ok:!e,out:String(o||''),err:String(er||'')})));
// the gapi.py commands in the agents' chats since a message id (read only): [[id, time, chat, command, ok]]
const CHATS_PY=`import sqlite3,sys,json
since=float(sys.argv[1]);out={}
for i in range(2,len(sys.argv),2):
    f,last=sys.argv[i],int(sys.argv[i+1]);rows=[];mx=last
    try:
        c=sqlite3.connect('file:'+f+'?mode=ro',uri=True)
        top=c.execute("select coalesce(max(id),0) from messages").fetchone()[0]
        got=c.execute("select id,timestamp,session_id,tool_calls from messages where id>? and timestamp>? and (tool_calls like '%gapi.py%' or tool_calls like '%google_api.py%') order by id limit 2000",(last,since)).fetchall()
        mx=got[-1][0] if len(got)==2000 else max(last,top)
        for mid,ts,sid,tc in got:
            try:
                calls=json.loads(tc or '[]')
            except Exception:
                continue
            for x in calls if isinstance(calls,list) else []:
                fn=(x or {}).get('function') or {}
                if fn.get('name')!='terminal':
                    continue
                try:
                    cmd=json.loads(fn.get('arguments') or '{}').get('command','')
                except Exception:
                    continue
                if 'gapi.py' not in cmd and 'google_api.py' not in cmd:
                    continue
                r=c.execute("select content from messages where tool_call_id=? and role='tool' limit 1",(x.get('id') or '',)).fetchone()
                ok=True
                if r and r[0]:
                    try:
                        j=json.loads(r[0])
                        ok=j.get('exit_code') in (0,None) and '{"error"' not in str(j.get('output') or '')[:4000] if isinstance(j,dict) else True
                    except Exception:
                        ok='{"error"' not in r[0][:4000]
                rows.append([mid,ts,sid,cmd[:4000],ok])
        c.close()
    except Exception:
        pass
    out[f]={'max':mx,'rows':rows}
print(json.dumps(out))`;

export function createConnectedAccounts({DATA,HERMES_HOME,WORK=path.join(homedir(),'workspaces'),active=false,listAgents,readConfig,setKey,withAgent=(a,f)=>f(),dash,python=async()=>null,access=null,whyOf=null,
 googleLabel=async()=>'',signinNeeded=()=>false,bell=async()=>{},nameOf=a=>a,ends={},STEP=5000,sharing=null}){
 const API={slack:ends.slack||'https://slack.com/api',revoke:ends.revoke||'https://oauth2.googleapis.com/revoke'};
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const FILE=path.join(DATA,'connected-accounts.json');let db=null;
 const load=async()=>{if(!db){db=await readJson(FILE)||{};for(const k of ['accounts','offsets','chats','events','alias','told'])db[k]||={};db.pending||=[];
  // names are worked out now (1 Nov 2026): what an agent called a login becomes its note, the owner's own name for a
  // Google account stays as ownerLabel, and no stored label is shown as the name any more
  for(const x of Object.values(db.accounts)){if(x.labelBy==='agent'&&x.label)x.agentLabel||=x.label;delete x.label;delete x.labelBy}}return db};
 let saving=Promise.resolve();const save=()=>saving=saving.then(async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1),{mode:0o600});await rename(FILE+'.tmp',FILE)}).catch(e=>console.warn('accounts: saving',e.message));
 const tail=createTail(()=>db.offsets,3e6);
 const servers=async a=>{const c=await readConfig(a).catch(()=>null);const m=c?.mcp_servers;return m&&typeof m==='object'?m:{}};
 const q=a=>'?profile='+encodeURIComponent(a);

 /* ---------- finding the logins ---------- */
 // every *.session file under ~/.hermes and the agents' workspaces (3 folders deep) that is a SQLite file (Telethon, Pyrogram)
 const SKIP=new Set(['hermes-agent','aqeelos-agent','installs','node_modules','cache','logs','tools','lsp','audio_cache','image_cache','models_dev_cache.json','.git','venv','skills','backups','pixel-tools','sessions','plugins','bot-desktop']);
 async function sessions(){const out=[];const walk=async(d,depth)=>{for(const e of await readdir(d,{withFileTypes:true}).catch(()=>[])){const p=path.join(d,e.name);
   if(e.isDirectory()){if(depth>0&&!SKIP.has(e.name)&&!/venv|\.broken/.test(e.name))await walk(p,depth-1);continue}
   if(!e.isFile()||!/\.session(?:\.paused)?$/.test(e.name))continue;const head=await readRange(p,0,16);if(head.toString('latin1').startsWith('SQLite format 3'))out.push(p)}};
  await walk(HERMES_HOME,3);await walk(WORK,3);return [...new Set(out)]}
 async function scanNow(){await load();const agents=await listAgents();const found=new Map();const seenPath=new Set();
  const add=(id,base)=>{if(!found.has(id))found.set(id,{id,agents:[],paths:[],files:[],...base});return found.get(id)};
  // Google: every agent's google_token*.json (also the ones moved aside by Pause), one account per email
  for(const a of agents){const home=homeOf(a);for(const f of await readdir(home).catch(()=>[])){const m=/^google_token(?:_([\w.-]+))?\.json(\.paused)?$/.exec(f);if(!m)continue;const p=path.join(home,f);
    const rp=await realpath(p).catch(()=>p);if(seenPath.has(rp))continue;seenPath.add(rp);const j=await readJson(p);if(!j)continue;
    const email=j.account||db.alias[h8(j.refresh_token||rp)]||'';const id='google:'+(email||h8(j.refresh_token||rp));
    const x=add(id,{kind:'google',provider:'google',identity:email,refresh:h8(j.refresh_token||'')});if(!x.agents.includes(a))x.agents.push(a);x.paths.push(p);x.files.push({agent:a,path:p,name:m[1]||'',paused:!!m[2]});
    if(x.ownerLabel===undefined){x.ownerLabel=await googleLabel(a,m[1]||'').catch(()=>'')||''}}}
  // apps signed in as a person: every agent's mcp_servers with its saved sign-in; the same name with another address is another login
  const tokOf=async(a,n)=>{const d=path.join(homeOf(a),'mcp-tokens');const p=path.join(d,n+'.json');return {p,rp:await realpath(p).catch(()=>p),tok:await readJson(p),meta:await readJson(path.join(d,n+'.meta.json'))}};
  const named=new Set();
  for(const a of agents)for(const [n,e] of Object.entries(await servers(a))){if(!e||typeof e!=='object')continue;named.add(n);const t=await tokOf(a,n);const c=classify({type:'mcp',name:n,entry:e,token:t.tok,meta:t.meta});if(c.as!=='me')continue;
   const host=(/https?:\/\/([^/\s:]+)/.exec(e.url||'')||[])[1]||'';let id='mcp:'+n;const prev=found.get(id);if(prev&&prev.host!==host)id='mcp:'+n+'@'+a;
   const pv=providerOf(n,e.url,t.tok?.hermes_issuer);const x=add(id,{kind:'mcp-oauth',provider:pv.id,mcp:n,host,url:e.url||''});if(!x.agents.includes(a))x.agents.push(a);
   if(!x.paths.includes(t.rp))x.paths.push(t.rp);x.tokens||=[];if(!x.tokens.some(y=>y.rp===t.rp))x.tokens.push({agent:a,path:t.p,rp:t.rp});x.off=(x.off??true)&&e.enabled===false;x.expires=t.tok?.expires_at||null;x.refreshable=!!t.tok?.refresh_token}
  // a saved sign-in no agent has in its settings any more (left behind, or made by hand): still a login as the owner
  for(const a of agents){const d=path.join(homeOf(a),'mcp-tokens');for(const f of await readdir(d).catch(()=>[])){const m=/^([\w.-]+)\.json$/.exec(f);if(!m||/\.(meta|client)$/.test(m[1])||named.has(m[1]))continue;
    const t=await tokOf(a,m[1]);if([...found.values()].some(x=>x.paths.includes(t.rp)))continue;const c=classify({type:'mcp',name:m[1],entry:{},token:t.tok,meta:t.meta});if(c.as!=='me')continue;
    const pv=providerOf(m[1],t.meta?.issuer,t.tok?.hermes_issuer);const x=add('mcp:'+m[1],{kind:'mcp-oauth',provider:pv.id,mcp:m[1],host:'',url:'',orphan:true});if(!x.paths.includes(t.rp))x.paths.push(t.rp);x.tokens||=[];x.tokens.push({agent:a,path:t.p,rp:t.rp})}}
  // a personal Telegram session (made by a script or a skill; aqeelOS does not make one yet)
  for(const p of await sessions()){const x=add('telegram:'+h8(p),{kind:'telegram-user',provider:'telegram',identity:''});x.paths.push(p);x.files.push({path:p,paused:p.endsWith('.paused')})}
  return found}
 // the scan written into the registry: new logins (registered when this is the first look or an agent said so), gone ones dropped
 let scanning=null;
 function scan(){if(scanning)return scanning;scanning=(async()=>{const found=await scanNow();const now=Date.now(),first=!db.seeded,fresh=[];
   for(const [id,f] of found){let x=db.accounts[id];
    if(!x){const reg=db.pending.find(r=>matches(r,f,homedir()));x=db.accounts[id]={id,kind:f.kind,provider:f.provider,identity:'',can:[...CAN],canSet:false,canBy:{},registered:first||!!reg,registeredBy:first?'seed':reg?reg.by:'',firstSeen:now};
     if(reg){db.pending=db.pending.filter(r=>r!==reg);if(reg.label)x.agentLabel=reg.label;if(reg.can?.length){x.can=reg.can;x.canSet=true;x.wantCan=true}if(reg.note)x.note=reg.note}
     if(!x.registered)fresh.push(x)}
    for(const k of ['kind','provider','mcp','host','url','agents','paths','files','tokens','off','expires','refreshable','orphan','refresh'])x[k]=f[k];
    if(f.ownerLabel!==undefined)x.ownerLabel=f.ownerLabel;if(f.identity&&!x.identity)x.identity=f.identity;x.seenAt=now}
   for(const id of Object.keys(db.accounts))if(!found.has(id)&&!db.accounts[id].manual){delete db.accounts[id];delete db.events[id]}
   db.pending=db.pending.filter(r=>now-r.at<24*3600e3);db.seeded=true;db.scanAt=now;await save();
   if(fresh.length&&active)for(const x of fresh){if(db.told[x.id])continue;db.told[x.id]=now;await save();
    await bell('A login acting as you was found: '+labelOf(x),'An agent signed in as you ('+(x.identity||x.mcp||x.kind)+') without registering it. Open Abilities › Connections to approve it or disconnect it.').catch(()=>{})}
   for(const x of Object.values(db.accounts))if(x.wantCan){delete x.wantCan;applyCan(x).catch(e=>console.warn('accounts: allowed actions',x.id,e.message))}
   return found})().finally(()=>{scanning=null});return scanning}
 const labelOf=x=>displayName(x);

 /* ---------- who it is and whether it works (cheap, at most every 30 min per login) ---------- */
 async function slackTest(tok){try{const r=await fetch(API.slack+'/auth.test',{method:'POST',headers:{authorization:'Bearer '+tok},signal:AbortSignal.timeout(15000)}).then(r=>r.json());return r}catch(e){return {ok:false,error:'unreachable',net:true}}}
 // the person's own name in that workspace (auth.test gives only the handle)
 async function slackName(tok,id){if(!id)return '';try{const r=await fetch(API.slack+'/users.info?user='+encodeURIComponent(id),{headers:{authorization:'Bearer '+tok},signal:AbortSignal.timeout(15000)}).then(r=>r.json());const p=r.user?.profile||{};return p.real_name||p.display_name||r.user?.real_name||''}catch{return ''}}
 async function check(x,{force=false}={}){const now=Date.now();if(!force&&x.checkedAt&&now-x.checkedAt<30*60e3)return;x.checkedAt=now;let state='connected',why='';
  if(x.paused)return save();
  if(x.kind==='google'){const f=x.files.find(f=>!f.paused);const gapi=path.join(HERMES_HOME,'scripts','gapi.py');const py=await python().catch(()=>null);
   if(!f){state='signed-out';why='No saved sign-in'}
   else if(py&&await stat(gapi).catch(()=>null)){const r=await run(py,[gapi,...(f.name?['--account',f.name]:[]),'whoami'],{env:{...process.env,HERMES_HOME:homeOf(f.agent||'default')},timeout:40000});let j=null;try{j=JSON.parse(r.out)}catch{}
    if(j?.emailAddress){if(!x.identity){x.identity=j.emailAddress;db.alias[x.refresh]=j.emailAddress}}else if(/invalid_grant|revoked|expired|unauthori|401/i.test(r.out+r.err)){state='signed-out';why='Google says the sign-in ran out'}else why='Could not ask Google just now'}
   else{const j=await readJson(f.path);if(!j?.refresh_token){state='signed-out';why='The sign-in does not renew'}}}
  else if(x.kind==='mcp-oauth'){const t=x.tokens?.[0];const tok=t?await readJson(t.path):null;
   if(!tok?.access_token&&!tok?.refresh_token){state='signed-out';why='No saved sign-in'}
   else if(x.provider==='slack'&&/^xoxp-/.test(tok.access_token||'')){const r=await slackTest(tok.access_token);if(r.ok){const name=await slackName(tok.access_token,r.user_id);x.who={user:name||String(r.user||'').replace(/^./,c=>c.toUpperCase()),workspace:r.team||''}}else if(!r.net){state='signed-out';why='Slack says: '+String(r.error||'not signed in').replace(/_/g,' ')}}
   else if(tok.expires_at&&tok.expires_at*1000<now&&!tok.refresh_token){state='signed-out';why='The sign-in ran out'}
   if(state==='connected'&&x.agents?.some(a=>signinNeeded(a,x.mcp))){state='signed-out';why='It needs someone to sign in again'}
   if(x.provider!=='slack'&&whyOf&&x.agents?.length){const a=x.agents[0];let acc=await whyOf.accountOf(a,x.mcp).catch(()=>null);if(!acc&&state==='connected'&&x.url&&t)acc=await whyOf.learnAccount(a,x.mcp,x.url,t.path).catch(()=>null);
    if(acc)x.who={user:acc.user||'',workspace:acc.workspace||'',email:acc.email||''}}
   // "Slack, Sam (Acme)": the user, then the workspace
   const u=x.who?.user,w=x.who?.workspace;if(x.who)x.identity=[u,w].filter(Boolean).join(' · ')||x.who.email||x.identity;
   }
  else if(x.kind==='telegram-user'){if(!x.files?.some(f=>!f.paused)){state='signed-out';why='The session file is gone'}}
  else if(x.manual&&x.where){if(!await stat(tilde(x.where)).catch(()=>null)){state='signed-out';why='Its saved sign-in is not there any more'}}
  x.state=state;x.why=why;await save()}
 let checking=null;
 function checkAll(o){if(checking)return checking;checking=(async()=>{for(const x of Object.values(db.accounts))await check(x,o).catch(e=>console.warn('accounts: check',x.id,e.message))})().finally(()=>{checking=null});return checking}

 /* ---------- what the agents did with each login ---------- */
 const push=(id,e)=>{const l=db.events[id]||=[];l.push(e);if(l.length>300)l.splice(0,l.length-300)};
 async function readLogs(){const seen=new Set();const map=new Map();for(const x of Object.values(db.accounts))if(x.kind==='mcp-oauth')for(const a of x.agents||[])map.set(a+'|'+x.mcp,x);
  const byName=new Map();for(const x of Object.values(db.accounts))if(x.kind==='mcp-oauth'&&!byName.has(x.mcp))byName.set(x.mcp,x);
  for(const a of await listAgents()){const f=path.join(homeOf(a),'logs','agent.log');const rp=await realpath(f).catch(()=>null);if(!rp||seen.has(rp))continue;seen.add(rp);const text=await tail(rp);if(!text)continue;
   const names=[...byName.keys()];for(const l of text.split('\n')){if(!l.includes('tool_executor'))continue;const ev=parseToolLine(l);if(!ev)continue;const s=serverOfTool(ev.tool,names);if(!s)continue;
    const x=map.get(a+'|'+s.server)||byName.get(s.server);const who=String(map.has(a+'|'+s.server)?a:(x.agents||[])[0]||a).split('--')[0];const act=actionOf(x.provider,s.fn);
    push(x.id,{t:ev.t,agent:who,kind:act.kind,verb:act.verb,noun:act.noun,prov:x.provider,ok:ev.ok,raw:s.fn,chat:ev.session})}}}
 async function readChats(){const py=await python().catch(()=>null);if(!py)return;const files=[];for(const a of await listAgents()){const f=path.join(homeOf(a),'state.db');if(await stat(f).catch(()=>null))files.push([a,f])}if(!files.length)return;
  const args=[String(Date.now()/1000-14*86400)];for(const [,f] of files)args.push(f,String(db.chats[f]||0));const r=await run(py,['-c',CHATS_PY,...args],{timeout:60000});let j;try{j=JSON.parse(r.out)}catch{return}
  for(const [a,f] of files){const got=j[f];if(!got)continue;db.chats[f]=got.max;
   for(const [,ts,sid,cmd,ok] of got.rows)for(const g of parseGapi(cmd)){const x=googleFor(a,g.account);if(!x)continue;const act=actionOf(g.service,g.method,{verbLast:true});
    push(x.id,{t:Math.round(ts*1000),agent:a.split('--')[0],kind:act.kind,verb:act.verb,noun:act.noun,prov:g.service,ok,raw:g.service+' '+g.method,chat:sid})}}}
 const googleFor=(a,name)=>Object.values(db.accounts).find(x=>x.kind==='google'&&x.files?.some(f=>f.agent===a&&f.name===(name==='default'?'':name)));
 let reading=null;
 function readActions(){if(reading)return reading;reading=(async()=>{await load();await readLogs().catch(e=>console.warn('accounts: logs',e.message));await readChats().catch(e=>console.warn('accounts: chats',e.message));
   for(const x of Object.values(db.accounts)){const l=db.events[x.id];if(l?.length){l.sort((p,q)=>p.t-q.t);x.lastUsed=l[l.length-1].t}}db.actionsAt=Date.now();await save()})().finally(()=>{reading=null});return reading}

 /* ---------- Pause, Resume, allowed actions: the engine drops and adds an app on its own clock ---------- */
 const logSize=async a=>(await stat(path.join(homeOf(a),'logs','agent.log')).catch(()=>null))?.size||0;
 async function waitLog(a,from,s,what,ms){const f=path.join(homeOf(a),'logs','agent.log');const end=Date.now()+ms;
  while(Date.now()<end){await sleep(STEP);const st=await stat(f).catch(()=>null);if(!st)continue;const b=await readRange(f,st.size<from?0:from,st.size);
   for(const l of b.toString('utf8').split('\n'))for(const ev of parseLogLine(l))if(ev.kind==='reconciled'&&ev[what].includes(s))return true}return false}
 // the app off one agent and its new settings in: removed through the dashboard (the engine drops it from that agent at
 // its next look, seen in its log), then written back as given. Its settings are put back if writing fails.
 async function swap(a,name,next,was){const at=await logSize(a);const del=await withAgent(a,()=>dash('DELETE','/api/mcp/servers/'+encodeURIComponent(name)+q(a)));
  if(!del.ok&&del.status!==404)return {ok:false,why:'the engine would not remove it ('+del.status+')'};
  const gone=await waitLog(a,at,name,'removed',90000);const r=await setKey(a,'mcp_servers.'+name,next);
  if(!r.ok){const back=was?await setKey(a,'mcp_servers.'+name,was):{ok:true};return {ok:false,why:'writing its settings failed: '+(r.err||'')+(back.ok?' (put back as it was)':'')}}return {ok:true,gone}}
 const jobs=new Map();const bg=(id,fn)=>{const p=(jobs.get(id)||Promise.resolve()).then(fn,fn).catch(e=>console.warn('accounts:',id,e.message));jobs.set(id,p);p.finally(()=>{if(jobs.get(id)===p)jobs.delete(id)});return p};
 const busy=id=>jobs.has(id);
 async function pause(id,on,by=''){await load();const x=db.accounts[id];if(!x)throw new Error('That login is gone. Reload the page.');const now=Date.now();
  if(on){if(x.paused)return {already:true};
   if(x.kind==='google'||x.kind==='telegram-user'){const moved=[];for(const f of x.files.filter(f=>!f.paused)){await rename(f.path,f.path+'.paused');moved.push(f.path)}x.paused={at:now,by,files:moved,state:'paused'};await save();
    // a gapi.py run that was just renewing its sign-in may write the file once more: moved aside again
    setTimeout(async()=>{for(const p of moved)if(await stat(p).catch(()=>null)){await rename(p,p+'.paused').catch(()=>{})}scan().catch(()=>{})},4000).unref?.();await scan();return {ok:true}}
   if(x.kind!=='mcp-oauth')throw new Error('This login can only be disconnected.');
   const entries={};for(const a of x.agents||[]){const e=(await servers(a))[x.mcp];if(e)entries[a]=e}x.paused={at:now,by,entries,state:'pausing',agents:{}};await save();
   bg(id,async()=>{const p=x.paused;await Promise.all(Object.entries(p.entries).map(async([a,e])=>{const r=await swap(a,x.mcp,pausedEntry(e),e);p.agents[a]=r.ok?(r.gone?'stopped':'off'):'failed: '+r.why}));
    p.state=Object.values(p.agents).some(v=>v.startsWith('failed'))?'failed':'paused';p.doneAt=Date.now();await save();console.log('accounts: paused',id,JSON.stringify(p.agents))});return {ok:true,background:true}}
  if(!x.paused)return {already:true};const p=x.paused;
  if(x.kind==='google'||x.kind==='telegram-user'){const left=[];for(const f of p.files||[]){if(await stat(f).catch(()=>null)){left.push(f);continue}await rename(f+'.paused',f).catch(()=>left.push(f))}
   x.paused=null;x.checkedAt=0;await save();await scan();return {ok:true,left}}
  if(p.state==='pausing')throw new Error('Still pausing. Try again in a minute.');x.paused={...p,state:'resuming'};await save();
  bg(id,async()=>{const res={};await Promise.all(Object.entries(p.entries||{}).map(async([a,e])=>{const at=await logSize(a);const r=await setKey(a,'mcp_servers.'+x.mcp,e);res[a]=r.ok?(await waitLog(a,at,x.mcp,'added',90000)?'working':'on'):'failed: '+(r.err||'')}));
   x.paused=Object.values(res).some(v=>v.startsWith('failed'))?{...p,state:'failed',agents:res}:null;x.checkedAt=0;await save();console.log('accounts: resumed',id,JSON.stringify(res))});return {ok:true,background:true}}

 // allowed actions: Google in aqeelos-accounts.json (gapi.py reads it), apps by leaving their tools out
 async function writePolicy(){const g={};for(const x of Object.values(db.accounts)){if(x.kind!=='google'||!x.identity)continue;const e={};if(x.canSet&&x.can.length<CAN.length)e.can=x.can;
   const per=Object.entries(x.canBy||{}).filter(([,c])=>c.length<CAN.length);
   if(await shareOn()){const deny=[];for(const a of new Set([...(x.agents||[]).map(a=>String(a).split('--')[0]),...Object.keys(x.canBy||{})])){const c=await canNow(x,a);if(!c.length){deny.push(a);continue}if(c.length<CAN.length)per.push([a,c])}if(deny.length)e.deny=deny}
   if(per.length)e.agents=Object.fromEntries(per);if(e.can||e.agents||e.deny)g[x.identity]=e}
  const f=path.join(HERMES_HOME,'aqeelos-accounts.json');const cur=await readJson(f)||{};if(JSON.stringify(cur.google||{})===JSON.stringify(g))return;cur.google=g;await writeFile(f+'.tmp',JSON.stringify(cur,null,1));await rename(f+'.tmp',f)}
 async function toolsOf(a,name){try{const j=JSON.parse(await readFile(path.join(homeOf(a),'cache','mcp_schema_cache.json'),'utf8'));const l=(j?.[name]?.tools||[]).map(t=>t?.name).filter(Boolean);if(l.length)return l}catch{}
  const r=await dash('POST','/api/mcp/servers/'+encodeURIComponent(name)+'/test'+q(a),{}).catch(()=>null);return (r?.j?.tools||[]).map(t=>typeof t==='string'?t:t?.name).filter(Boolean)}
 // one app on one agent with only the tools these allowed actions leave (orig: where its own tools setting from before
 // aqeelOS changed it is kept, per agent). paused: the settings to put back on Resume, changed instead of the live ones.
 // Used for logins as the owner here and for every other app by Connections (connections.mjs). known: tools another
 // agent's copy has, for an agent that has not listed them yet (a copy just given).
 async function applyTools(a,name,can,prov,orig,paused=null,known=[]){const cur=(paused||{})[a]||(await servers(a))[name];if(!cur)return {ok:true,none:true};if(!(a in orig))orig[a]=cur.tools===undefined?null:cur.tools;
  // the engine's list may already lack the tools aqeelOS left out before: those count too
  const o=orig[a]===null?undefined:orig[a],before=Array.isArray(o?.include)?o.include.filter(t=>!(cur.tools?.include||[]).includes(t)):(cur.tools?.exclude||[]).filter(t=>!(o?.exclude||[]).includes(t));
  const all=[...new Set([...await toolsOf(a,name),...known,...before])],blocked=blockedTools(all,can,prov);const next=withCan(cur,blocked,o);if(!blocked.length)delete orig[a];
  if(JSON.stringify(next)===JSON.stringify(cur))return {ok:true,same:true,tools:all.length,left:all.length-blocked.length};if(paused){paused[a]=next;return {ok:true,paused:true}}
  const r=await swap(a,name,next,cur);return {...r,tools:all.length,left:all.length-blocked.length}}
 // what one agent may do with a login: its own (canBy, by its agent name without the extra number) or the login's
 const canFor=(x,a)=>x.canBy?.[String(a).split('--')[0]]||x.can||[...CAN];
 // sharing levels (sharing.mjs), when switched on: the agent's level caps what it may do (viewer: read; editor and up:
 // the login's own allowed actions; none: nothing), so a share or a revoke counts at the next call
 const shareOn=async()=>!!sharing&&await sharing.enabled();
 async function claimAll(){if(!await shareOn())return;for(const x of Object.values(db.accounts)){const o=x.registeredBy&&!/^(seed|owner|google|mcp|system)/.test(x.registeredBy)&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(x.registeredBy)?x.registeredBy:((x.agents||[]).map(a=>String(a).split('--')[0]).includes('default')||!(x.agents||[]).length?'default':String(x.agents[0]).split('--')[0]);
  // first claim: the connecting agent (else the main agent) owns it, every agent already using it keeps Editor, so nothing loses access
  if(!await sharing.exists('account',x.id)){await sharing.claim('account',x.id,o,{label:labelOf(x),by:'connected-accounts'}).catch(()=>{});
   for(const a of new Set((x.agents||[]).map(a=>String(a).split('--')[0])))if(a!==o)await sharing.share('account',x.id,{person:'migration',admin:true},a,'editor').catch(()=>{})}}}
 async function canNow(x,a){const own=canFor(x,a);if(!await shareOn())return own;const l=await sharing.levelOf('account',x.id,a);const cap=canOfLevel(l);return own.filter(c=>cap.includes(c))}
 async function applyCan(x){if(x.kind==='google')return writePolicy();if(x.kind!=='mcp-oauth')return;
  return bg(x.id,async()=>{x.applying=true;await save();x.origTools||={};
   for(const a of x.agents||[]){const r=await applyTools(a,x.mcp,await canNow(x,a),x.provider,x.origTools,x.paused?.entries||null);if(!r.ok)console.warn('accounts: allowed actions on',a,r.why)}
   x.applying=false;await save()})}
 async function setCan(id,can){await load();const x=db.accounts[id];if(!x)throw new Error('That login is gone. Reload the page.');const c=normCan(can);
  if(x.kind==='google'&&!x.identity)throw new Error('aqeelOS does not know this account’s email yet. Try again after its check.');
  x.can=c;x.canSet=true;await save();await applyCan(x);return {ok:true,can:c,background:x.kind==='mcp-oauth'}}
 // what one agent may do (Connections, 1 Nov 2026); null takes its own setting away (the login's can again)
 async function setAgentCan(id,agent,can){await load();const x=db.accounts[id];if(!x)throw new Error('That login is gone. Reload the page.');const b=String(agent).split('--')[0];
  if(x.kind==='google'&&!x.identity)throw new Error('aqeelOS does not know this account’s email yet. Try again after its check.');
  x.canBy||={};if(can==null)delete x.canBy[b];else x.canBy[b]=normCan(can);await save();await applyCan(x);return {ok:true,can:canFor(x,b),background:x.kind==='mcp-oauth'}}

 /* ---------- Disconnect ---------- */
 const rmF=f=>unlink(f).then(()=>true,()=>false);
 async function disconnect(id){await load();await scan();const x=db.accounts[id];if(!x)throw new Error('That login is gone. Reload the page.');const done=[];let revoked=null;
  if(x.kind==='google'){const f=x.files.find(f=>!f.paused)||x.files[0];const j=f?await readJson(f.path):null;
   if(j?.refresh_token||j?.token){try{const r=await fetch(API.revoke,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:j.refresh_token||j.token}),signal:AbortSignal.timeout(15000)});revoked=r.ok||r.status===400}catch{revoked=false}}
   for(const f of x.files)if(await rmF(f.path))done.push(f.path);if(x.paused?.files)for(const p of x.paused.files){await rmF(p);await rmF(p+'.paused')}
   await access?.forget?.('google',x.identity).catch(()=>{})}
  else if(x.kind==='mcp-oauth'){const t=x.tokens?.[0];const tok=t?await readJson(t.path):null;
   if(x.provider==='slack'&&tok?.access_token){try{const r=await fetch(API.slack+'/auth.revoke',{method:'POST',headers:{authorization:'Bearer '+tok.access_token},signal:AbortSignal.timeout(15000)}).then(r=>r.json());revoked=!!r.ok||r.error==='invalid_auth'||r.error==='token_revoked'}catch{revoked=false}}
   for(const a of await listAgents())if((await servers(a))[x.mcp]&&(x.agents||[]).includes(a)){const r=await withAgent(a,()=>dash('DELETE','/api/mcp/servers/'+encodeURIComponent(x.mcp)+q(a)));if(r.ok||r.status===404)done.push(nameOf(a))}
   const dirs=new Set();for(const y of x.tokens||[])dirs.add(path.dirname(y.rp));
   for(const d of dirs)for(const f of await readdir(d).catch(()=>[]))if(f.startsWith(x.mcp+'.')&&/^\.(json|meta\.json|client\.json|json\.aqbak|json\.refresh\.lock)$/.test(f.slice(x.mcp.length)))await rmF(path.join(d,f));
   await access?.forget?.('mcp',x.mcp).catch(()=>{})}
  else if(x.kind==='telegram-user'){for(const f of x.files){await rmF(f.path);await rmF(f.path.replace(/\.paused$/,'')+'-journal')}}
  else if(x.manual&&x.where){await rmF(tilde(x.where))}
  delete db.accounts[id];delete db.events[id];delete db.told[id];await save();if(x.kind==='google')await writePolicy();console.log('accounts: disconnected',id,revoked===null?'(deleted only)':revoked?'(revoked)':'(could not revoke)');
  return {ok:true,revoked,label:labelOf(x)}}

 /* ---------- registering (agents) and approving (the owner) ---------- */
 // owner: the owner adds it under Connections › Add › A login (7 Nov 2026): registered as theirs at once, and the place
 // must exist (an agent's registration may come before aqeelOS sees the sign-in; the owner's is for something already there)
 async function register(agent,a={},{owner=null}={}){await load();const kind=String(a.kind||'').toLowerCase().trim();if(!['google','mcp-oauth','telegram-user','other'].includes(kind))return {isError:true,text:'kind must be google, mcp-oauth, telegram-user or other.'};
  const label=String(a.label||'').replace(/[\r\n]+/g,' ').trim().slice(0,80),where=String(a.where||'').trim().slice(0,400),can=normCan(a.can),note=String(a.note||'').trim().slice(0,300);
  if(!label)return {isError:true,text:'Give a label, for example "Slack, Sam (Acme)".'};
  await scan();const r={kind,label,where,can,note,by:agent,at:Date.now()};
  const hit=Object.values(db.accounts).find(x=>matches(r,x,homedir())&&(owner!=null||!x.registered||x.registeredBy==='seed'||x.registeredBy===agent));
  const by=owner!=null?'owner'+(owner?': '+owner:''):agent;
  if(owner!=null&&where&&!await stat(tilde(where)).catch(()=>null))return {isError:true,text:'Nothing is stored at '+where+'. Check the place, for example ~/.hermes/profiles/sales/mcp-tokens/slack.json.'};
  if(hit){hit.registered=true;hit.registeredBy=by;hit.agentLabel=label;if(note)hit.note=note;if(can.length){hit.can=can;hit.canSet=true}await save();if(can.length)await applyCan(hit).catch(()=>{});
   return {id:hit.id,text:'Registered "'+label+'" as '+displayName(hit)+'. The owner sees it under Abilities › Connections'+(can.length?', allowed to: '+can.join(', '):'')+'.'}}
  if(kind==='other'&&where&&await stat(tilde(where)).catch(()=>null)){const id='other:'+h8(tilde(where));db.accounts[id]={id,kind:'other',provider:providerOf(label).id,agentLabel:label,identity:owner!=null?label:'',where,paths:[tilde(where)],agents:[agent],can:can.length?can:[...CAN],canSet:!!can.length,registered:true,registeredBy:by,manual:true,firstSeen:Date.now(),note};await save();return {id,text:'Registered "'+label+'".'}}
  if(owner!=null)return {isError:true,text:'aqeelOS does not see a '+(kind==='mcp-oauth'?'app sign-in':kind==='telegram-user'?'Telegram session':'Google sign-in')+' at '+(where||'that place')+' yet. Connect it first, then add it here.'};
  db.pending=db.pending.filter(x=>!(x.by===agent&&x.label===label));db.pending.push(r);await save();
  return {text:'Noted "'+label+'". It shows under Abilities › Connections as soon as aqeelOS sees the sign-in (within 2 minutes). Say where the credential is stored (where) if it does not show.'}}
 async function approve(id,by=''){await load();const x=db.accounts[id];if(!x)throw new Error('That login is gone. Reload the page.');x.registered=true;x.registeredBy='owner'+(by?': '+by:'');await save();return {ok:true}}

 /* ---------- what the page shows ---------- */
 async function list({fresh=false}={}){await load();if(fresh||!db.scanAt||Date.now()-db.scanAt>2*60e3)await scan();if(fresh||!db.actionsAt)await readActions();else if(Date.now()-db.actionsAt>2*60e3)readActions().catch(()=>{});   // older ones show while the logs are read again
  if(fresh)await checkAll({force:true});else checkAll().catch(()=>{});
  const acc={};for(const k of ['mcp','google']){try{acc[k]=await access?.list?.(k)}catch{acc[k]=null}}
  const items=Object.values(db.accounts).map(x=>{const it=x.kind==='mcp-oauth'?acc.mcp?.items?.find(y=>y.id===x.mcp):x.kind==='google'?acc.google?.items?.find(y=>y.id===x.identity):null;
   const pv=x.kind==='mcp-oauth'?providerOf(x.mcp,x.url,x.provider):providerOf(x.provider);
   const users=(it?.users||[]).map(u=>({id:u.id,name:u.name}));for(const a of x.agents||[]){const b=String(a).split('--')[0];if(!users.some(u=>u.id===b))users.push({id:b,name:nameOf(b)})}
   const state=x.paused?(x.paused.state==='paused'?'paused':x.paused.state==='failed'?'failed':x.paused.state):x.applying||busy(x.id)?'applying':x.off?'off':x.state||'checking';
   return {id:x.id,kind:x.kind,provider:pv.id,logo:pv.logo,app:serviceName(pv.id,pv.name),label:labelOf(x),name:labelOf(x),identity:x.identity||'',mcp:x.mcp||'',who:x.who||null,ownerLabel:x.ownerLabel||'',agentLabel:x.agentLabel||'',
    agents:users,owner:it?.owner||users[0]?.id||null,can:x.can||[...CAN],canSet:!!x.canSet,canBy:Object.fromEntries(users.map(u=>[u.id,canFor(x,u.id)])),
    state,why:x.paused?.state==='failed'?Object.entries(x.paused.agents||{}).filter(([,v])=>v.startsWith('failed')).map(([a,v])=>nameOf(a)+': '+v.slice(8)).join('; '):x.why||'',pausedAt:x.paused?.at||null,
    lastUsed:x.lastUsed||null,recent:summarise(db.events[x.id]),registered:!!x.registered,registeredBy:x.registeredBy||'',where:(x.where||x.paths?.[0]||'').replace(homedir(),'~'),note:x.note||'',
    enforce:x.kind==='google'?'gapi':x.kind==='mcp-oauth'?'tools':'note',mayPause:['google','mcp-oauth','telegram-user'].includes(x.kind),firstSeen:x.firstSeen||null}});
  items.sort((a,b)=>(a.registered-b.registered)||a.label.localeCompare(b.label));
  return {at:db.scanAt||null,actionsAt:db.actionsAt||null,items}}
 async function actions(id){await load();const x=db.accounts[id];if(!x)throw new Error('That login is gone. Reload the page.');return {items:summarise(db.events[id],{limit:10,gap:15*60e3}),label:labelOf(x)}}

 // the gapi.py guard put in at start (and again if gapi.py was replaced); a test copy only with its own engine home
 async function patchGapi(){const f=path.join(HERMES_HOME,'scripts','gapi.py');const s=await readFile(f,'utf8').catch(()=>null);if(s==null)return {changed:false,why:'no gapi.py'};const n=patchGapiText(s);
  if(n===null){if(!db?.toldGapi){await load();db.toldGapi=true;await save();console.warn('accounts: gapi.py changed; its pause and allowed-actions guard is not in place')}return {changed:false,why:'changed upstream'}}
  if(n===s)return {changed:false};const st=await stat(f);await writeFile(f+'.aq.tmp',n,{mode:st.mode});await rename(f+'.aq.tmp',f);console.log('accounts: gapi.py now honours Pause and allowed actions');return {changed:true}}
 if(active){const tick=()=>(async()=>{await patchGapi().catch(e=>console.warn('accounts: gapi.py',e.message));await scan();await claimAll();await readActions();await checkAll()})().catch(e=>console.warn('accounts',e.message));
  setTimeout(tick,8000).unref?.();setInterval(tick,2*60e3).unref?.()}
 // a share, a revoke or a transfer on an account: write its allowed actions again right away
 async function levelsChanged(id){await load();const x=db.accounts[id];if(x)await applyCan(x)}
 return {levelsChanged,claimAll,canNow:async(id,a)=>{await load();const x=db.accounts[id];return x?canNow(x,a):[]},list,actions,scan,readActions,pause,setCan,setAgentCan,applyTools,toolsOf,busy,disconnect,register,approve,patchGapi,levelFor:async(email,agent)=>{await load();const x=Object.values(db.accounts).find(y=>y.kind==='google'&&String(y.identity||'').toLowerCase()===String(email).toLowerCase());if(!x)return null;const c=new Set(canFor(x,agent));return c.has('send')?'full':c.has('draft')?'draft':c.has('edit')?'edit':'read'},check:async id=>{await load();const x=db.accounts[id];if(x)await check(x,{force:true})},_db:async()=>load()}}
