// Small, re-appliable improvements to engine skills (an engine update can replace skill files, so
// deploy.sh runs this every time; each change is skipped when it is already there).
// Run on the box: node scripts/apply-skill-patches.mjs
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import path from 'node:path';import {homedir} from 'node:os';import {readdirSync,existsSync} from 'node:fs';
const HOME=path.join(homedir(),'.hermes');
const homes=[HOME];for(const d of await readdir(path.join(HOME,'profiles'),{withFileTypes:true}).catch(()=>[]))if(d.isDirectory()&&!d.name.startsWith('.'))homes.push(path.join(HOME,'profiles',d.name));
const exists=p=>access(p).then(()=>true,()=>false);
let changed=0;

const GOOGLE_SECTION=`
<!-- aqeelos:composio-first -->
## Not set up yet? This skill first (free); Composio only as the fallback

If no Google account is set up here yet (\`setup.py --list-accounts\` shows none), set one up with this skill: it is
free. Send the sign-in link from \`--auth-url\` (see Signing in below). If there is no OAuth client yet, walk the
person through creating one (or do it with them in the browser) and have them send its JSON with the lock button.
Only if that is not possible (no access to Google Cloud) or they do not want it, offer Composio's Gmail, Drive,
Calendar, Sheets and Docs tools, and say plainly that Composio's free plan has a limit on actions and costs money
beyond it. Use Composio only after they agree.
<!-- /aqeelos:composio-first -->

<!-- aqeelos:multi-account --><!-- aqeelos:signin-v2 -->
## Several Google accounts (one agent, many accounts)

The person may have several Google accounts (for example work, personal, shop). Each one is a **named account**
with its own sign-in; the OAuth client (google_client_secret.json) is shared, so it is set up only once.

- **See which accounts exist:** \`python3 scripts/setup.py --list-accounts\` ("(default)" is the account added without a name).
- **Add another account:** pick a short name (letters, digits, - or _), then run the usual sign-in with \`--account NAME\`:
  \`setup.py --account work --auth-url\` → send the link → \`setup.py --account work --auth-code CODE\` → \`setup.py --account work --check\`.
  Ask which email they signed in with and remember it (memory: "Google accounts: work = a@company.com, personal = b@gmail.com").
- **Use an account:** put \`--account NAME\` on EVERY command, e.g. \`google_api.py --account work gmail search "is:unread"\`
  or \`gws_bridge.py --account work gmail users messages list ...\`. No flag = the default account.
  (Or set \`HERMES_GOOGLE_ACCOUNT=work\` for one command.)
- **Which account?** Use the one the person names (by name or email). If more than one exists and it is not clear,
  ask, listing the names with their emails. Never send or change anything from a guessed account.
- **Across all accounts** ("any unread mail?", "what's on my calendars today?"): run the command once per account
  and label each result with the account's name/email.
- **Remove an account:** \`setup.py --account NAME --revoke\`.
- **Signing in:** if \`--auth-url\` gives a link with redirect_uri https://ai.elkiya.com/google-oauth/callback, just send the
  link. After the person clicks Allow, aqeelOS finishes the sign-in by itself and shows "Google account connected";
  then run \`--check\`. Do NOT ask them to paste anything. If the link has redirect_uri http://localhost:1 (a Desktop
  client), offer the one-time switch: in Google Cloud › APIs & Services › Credentials, create an OAuth client of type
  "Web application" with the authorised redirect URI https://ai.elkiya.com/google-oauth/callback, and save its JSON with
  \`setup.py --client-secret <file>\`. Until then the paste method still works.
<!-- /aqeelos:multi-account -->
`;

for(const h of homes){const dir=path.join(h,'skills','productivity','google-workspace');if(!await exists(dir))continue;
 // 1) the gws bridge must use the selected account's sign-in, not always the default one
 const br=path.join(dir,'scripts','gws_bridge.py');if(await exists(br)){let s=await readFile(br,'utf8');
  if(!s.includes('google_file("google_token")')&&s.includes('return get_hermes_home() / "google_token.json"')){
   s=s.replace('from _hermes_home import get_hermes_home','from _hermes_home import get_hermes_home, google_file').replace('return get_hermes_home() / "google_token.json"','return google_file("google_token")  # aqeelos: honours --account NAME');
   await writeFile(br,s);changed++;console.log('patched',br)}}
 // 2) the instructions tell the agent how to work with several accounts
 const md=path.join(dir,'SKILL.md');if(await exists(md)){let s=await readFile(md,'utf8');
  // (re)apply when our block is missing or older: drop an earlier aqeelOS block, then insert the current one
  if(!s.includes('aqeelos:signin-v2')){s=s.replace(/\n?<!-- aqeelos:composio-first -->[\s\S]*?<!-- \/aqeelos:composio-first -->\n?/,'\n').replace(/\n?<!-- aqeelos:multi-account -->[\s\S]*?<!-- \/aqeelos:multi-account -->\n?/,'\n');const at=s.search(/\n## /);s=at>0?s.slice(0,at)+'\n'+GOOGLE_SECTION+s.slice(at):s+GOOGLE_SECTION;await writeFile(md,s);changed++;console.log('patched',md)}}}
// 3) Google sign-ins return to the aqeelOS site when the Google client is a "Web application" one: aqeelOS then
//    finishes the sign-in itself (no "copy the localhost address"). A Desktop client keeps the localhost method.
const WEB_REDIRECT=`REDIRECT_URI = "http://localhost:1"
# aqeelos:web-redirect: a Web-application client returns to the aqeelOS site, which finishes the sign-in by itself
try:
    if "web" in json.loads(CLIENT_SECRET_PATH.read_text(encoding="utf-8")):
        REDIRECT_URI = os.environ.get("AQEELOS_GOOGLE_REDIRECT", "https://ai.elkiya.com/google-oauth/callback")
except Exception:
    pass`;
for(const h of homes){const sp=path.join(h,'skills','productivity','google-workspace','scripts','setup.py');if(!await exists(sp))continue;let s=await readFile(sp,'utf8');
 if(!s.includes('aqeelos:web-redirect')&&s.includes('REDIRECT_URI = "http://localhost:1"')){s=s.replace('REDIRECT_URI = "http://localhost:1"',WEB_REDIRECT);await writeFile(sp,s);changed++;console.log('patched',sp)}}
// 4) Engine: accept token replies that are valid but not to the letter of the spec. Slack's personal ("as you")
//    tokens come back with token_type "user" (the engine only accepts "Bearer"), and Slack reports refusals as
//    HTTP 200 + {"ok": false, "error": …}; both ended as a bare "Invalid token response". Now the first is
//    accepted and the second shows Slack's own reason.
{const pf=path.join(HOME,'hermes-agent','tools','mcp_oauth_provider.py');if(await exists(pf)){let s=await readFile(pf,'utf8');
 const from=`        try:
            token_response = await handle_token_response_scopes(response)
        except (HTTPError, OAuthTokenError):
            raise OAuthTokenError("Invalid token response") from None`;
 const to=`        try:
            token_response = await handle_token_response_scopes(response)
        except (HTTPError, OAuthTokenError):
            # aqeelos:token-type: Slack user tokens say token_type "user"; refusals come as 200 + ok:false
            try:
                import json as _aq_json
                from mcp.shared.auth import OAuthToken as _AqToken
                _aq = _aq_json.loads(response.text or "{}")
            except Exception:
                raise OAuthTokenError("Invalid token response") from None
            if isinstance(_aq, dict) and _aq.get("ok") is False:
                raise OAuthTokenError("Token exchange refused: " + str(_aq.get("error") or "unknown error")) from None
            if isinstance(_aq, dict) and not _aq.get("access_token") and isinstance(_aq.get("authed_user"), dict):
                _aq = _aq["authed_user"]
            if not (isinstance(_aq, dict) and _aq.get("access_token")):
                raise OAuthTokenError("Invalid token response") from None
            _aq = {k: v for k, v in _aq.items() if k in ("access_token", "expires_in", "scope", "refresh_token")}
            _aq["token_type"] = "Bearer"
            token_response = _AqToken.model_validate(_aq)`;
 if(!s.includes('aqeelos:token-type')&&s.includes(from)){await writeFile(pf,s.replace(from,to));changed++;console.log('patched',pf)}}}
// 5) Engine: a WhatsApp bridge port that was just closed (TIME_WAIT, ~60 s after a restart) was treated as "bound by
//    another process", a permanent error with no retry, so a second agent's WhatsApp stayed down after every restart.
//    SO_REUSEADDR ignores just-closed connections; a port really in use still fails the bind.
{const pf=path.join(HOME,'hermes-agent','plugins','platforms','whatsapp','bridge_ownership.py');if(await exists(pf)){let s=await readFile(pf,'utf8');
 const from=`    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", port))`;
 const to=`    with socket.socket() as sock:
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)  # aqeelos:port-reuse (TIME_WAIT is not "in use")
            sock.bind(("127.0.0.1", port))`;
 if(!s.includes('aqeelos:port-reuse')&&s.includes(from)){await writeFile(pf,s.replace(from,to));changed++;console.log('patched',pf)}}}
// 7) The engine's own messages (to WhatsApp, Telegram, the chat: "Hermes is shutting down", "Hermes is back"…)
//    say aqeelOS. Only the words people read change; commands such as `hermes gateway restart` stay as they are.
{const dir=path.join(HOME,'hermes-agent','locales');
 for(const f of await readdir(dir).catch(()=>[])){if(!/\.ya?ml$/.test(f))continue;const p=path.join(dir,f);const s=await readFile(p,'utf8');
  const next=s.split('\n').map(l=>/^\s*[\w.-]+:\s/.test(l)||/^\s+["']/.test(l)?l.replace(/Hermes Agent/g,'aqeelOS').replace(/\bHermes\b/g,'aqeelOS'):l).join('\n');
  if(next!==s){await writeFile(p,next);changed++;console.log('renamed engine messages in',f)}}}
// 8) Words the engine sends straight to people outside its message files: the approval prompt on WhatsApp and
//    Telegram, the WhatsApp reply header, schedule result threads, "is working", the Telegram command menu, sign-in
//    pages. Only text inside quotes that reads as a sentence changes; code that compares the name is left alone, and a
//    file that no longer compiles afterwards is put back.
//    Every engine file is covered (channels, schedules, tools, the agent loop, the dashboard), since any of them can put
//    a sentence in front of a person ("⏳ Another Hermes process…", "Hermes will try again…", tool errors the agent repeats).
{const ROOT=path.join(HOME,'hermes-agent');const files=[];
 const walk=rel=>{let l=[];try{l=readdirSync(path.join(ROOT,rel),{withFileTypes:true})}catch{return}for(const d of l){if(/^(tests?|__pycache__|node_modules|\.git)$/.test(d.name))continue;const r=rel+'/'+d.name;if(d.isDirectory())walk(r);else if(d.name.endsWith('.py'))files.push(r.slice(1))}};
 for(const d of ['gateway','cron','agent','tools','hermes_cli','plugins'])walk('/'+d);
 const {execFileSync}=await import('node:child_process');const py=(()=>{try{const base=path.join(HOME,'installs');for(const i of readdirSync(base))for(const e of readdirSync(path.join(base,i,'environments'))){const p=path.join(base,i,'environments',e,'venv','bin','python');if(existsSync(p))return p}}catch{}return 'python3'})();
 for(const rel of files){const p=path.join(HOME,'hermes-agent',rel);const s=await readFile(p,'utf8').catch(()=>null);if(s==null)continue;
  const next=s.split('\n').map(l=>/==\s*["']Hermes|["']Hermes Agent["']\s*[:)\]]|X-Hermes|HermesAgent\/|["'][^"']*Hermes[^"']*["']\s*(?:in|==|!=)\s|(?:==|!=|startswith\(|endswith\(|\bin)\s*\(?\s*["'][^"']*Hermes|re\.(?:compile|search|match|sub)\(/.test(l)?l:l.replace(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g,(m,q,body)=>/\s/.test(body)&&/(?<![\w-])Hermes(?![\w-])/.test(body)?q+body.replace(/Hermes Agent/g,'aqeelOS').replace(/(?<![\w-])Hermes(?![\w-])/g,'aqeelOS')+q:m)).join('\n');
  if(next===s)continue;await writeFile(p,next);
  try{execFileSync(py,['-m','py_compile',p],{timeout:30000});changed++;console.log('renamed engine words in',rel)}catch{await writeFile(p,s);console.warn('! left',rel,'as it was (did not compile after renaming)')}}}
// 9) Read aloud: Microsoft's free voice refuses old edge-tts versions (403). Any engine environment that carries an
//    older edge-tts gets 7.3.1 (the old one is kept next to it as a backup); the dashboard picks it up when it restarts.
{const base=path.join(HOME,'installs');const WANT='7.3.1';
 const URL_='https://files.pythonhosted.org/packages/35/86/3b97d755992777d5a9ca0e45a8ec96cc9858b2d6dd8f65f3f688d60e8709/edge_tts-7.3.1-py3-none-any.whl';
 const older=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)<(y[i]||0)}return false};
 const {execFileSync}=await import('node:child_process');let whl=null;
 for(const i of readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name))for(const e of (()=>{try{return readdirSync(path.join(base,i,'environments'))}catch{return []}})()){
  const lib=path.join(base,i,'environments',e,'venv','lib');let sp=null;try{const py=readdirSync(lib).find(x=>x.startsWith('python'));if(py)sp=path.join(lib,py,'site-packages')}catch{}if(!sp)continue;
  const info=(()=>{try{return readdirSync(sp).find(x=>/^edge_tts-[\d.]+\.dist-info$/.test(x))}catch{return null}})();if(!info)continue;const have=info.slice(9,-10);if(!older(have,WANT))continue;
  try{if(!whl){whl='/tmp/edge_tts-'+WANT+'.whl';execFileSync('curl',['-sf','-o',whl,URL_],{timeout:60000})}
   const bak=path.join(sp,'..','edge-tts-'+have+'.bak');execFileSync('mkdir',['-p',bak]);execFileSync('cp',['-a',path.join(sp,'edge_tts'),path.join(sp,info),bak]);
   execFileSync('rm',['-rf',path.join(sp,'edge_tts'),path.join(sp,info)]);execFileSync('python3',['-c','import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',whl,sp]);changed++;console.log('read aloud: edge-tts',have,'→',WANT,'in',e)}catch(err){console.warn('! read aloud: could not update edge-tts in',e,err.message)}}}
// 10) The agents' own memory notes (MEMORY.md, USER.md) name the system they run on in plain sentences; they say
//     aqeelOS, so an agent never tells someone it is "Hermes". Paths and commands (~/.hermes, hermes …) are left alone.
{const dirs=[path.join(HOME,'memories')];for(const p of (()=>{try{return readdirSync(path.join(HOME,'profiles'))}catch{return []}})())dirs.push(path.join(HOME,'profiles',p,'memories'));
 for(const d of dirs)for(const f of ['MEMORY.md','USER.md']){const p=path.join(d,f);const s=await readFile(p,'utf8').catch(()=>null);if(s==null)continue;
  const next=s.replace(/Hermes Agent/g,'aqeelOS').replace(/(?<![\w./-])Hermes(?![\w/-])/g,'aqeelOS');if(next!==s){await writeFile(p,next);changed++;console.log('memory notes say aqeelOS:',p.replace(HOME,'~'))}}}
console.log(changed?changed+' change(s)':'skill patches already in place');
