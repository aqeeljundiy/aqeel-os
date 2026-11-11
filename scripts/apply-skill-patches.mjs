// Small, re-appliable improvements to engine skills (an engine update can replace skill files, so
// deploy.sh runs this every time; each change is skipped when it is already there).
// Run on the box: node scripts/apply-skill-patches.mjs
import {readFile,writeFile as rawWrite,readdir,access,rename,mkdir,rm,stat} from 'node:fs/promises';
import path from 'node:path';import {homedir} from 'node:os';import {readdirSync,existsSync,rmSync} from 'node:fs';
const HOME=path.join(homedir(),'.hermes');
import {publicUrl} from '../app/install.mjs';
const PUB=publicUrl();   // env PUBLIC_URL, else Your address from System › Settings (install.mjs)
// every file is replaced in one step (never left half-written), and only one run patches at a time (deploys, engine
// updates and new agents can all start this); a lock older than 15 minutes is a crashed run and is taken over
const writeFile=async(p,d,o)=>{const t=p+'.aq-'+process.pid+'-'+Math.random().toString(36).slice(2,7);await rawWrite(t,d,o);await rename(t,p)};
{const L=path.join(HOME,'.aqeelos-patch.lock');for(let i=0;;i++){try{await mkdir(L);break}catch{const s=await stat(L).catch(()=>null);if(s&&Date.now()-s.mtimeMs>8*60e3){await rm(L,{recursive:true,force:true});continue}if(i>=300){console.warn('! another patch run is still going; skipped');process.exit(0)}await new Promise(r=>setTimeout(r,2000))}}
 const free=()=>{try{rmSync(L,{recursive:true,force:true})}catch{}};process.on('exit',free);for(const sig of ['SIGTERM','SIGINT','SIGHUP'])process.on(sig,()=>{free();process.exit(1)})}
const homes=[HOME];for(const d of await readdir(path.join(HOME,'profiles'),{withFileTypes:true}).catch(()=>[]))if(d.isDirectory()&&!d.name.startsWith('.'))homes.push(path.join(HOME,'profiles',d.name));
const exists=p=>access(p).then(()=>true,()=>false);
let changed=0;
// a tool server's list of tools can be one event over the HTTP client's 1 MB limit (Higgsfield, 9 Nov 2026): 16 MB in every engine environment
{const envs=[path.join(HOME,'hermes-agent','venv')];for(const i of await readdir(path.join(HOME,'installs')).catch(()=>[]))for(const v of await readdir(path.join(HOME,'installs',i,'environments')).catch(()=>[]))envs.push(path.join(HOME,'installs',i,'environments',v,'venv'));
 for(const v of envs)for(const py of await readdir(path.join(v,'lib')).catch(()=>[])){const f=path.join(v,'lib',py,'site-packages','httpx2','_config.py');if(!await exists(f))continue;const s=await readFile(f,'utf8'),t=s.replace(/^(DEFAULT_MAX_EVENT_SIZE_BYTES\s*(?::\s*\w+\s*)?=\s*).*$/m,(m,a)=>a+'16 * 1024 * 1024');if(t!==s){await writeFile(f,t);changed++;console.log('MCP event limit: '+path.relative(HOME,f))}}}
for(const h of homes){const f=path.join(h,'skills','productivity','maps','SKILL.md');if(!await exists(f))continue;const s=await readFile(f,'utf8');if(s.includes('/skills/maps/scripts/')){await writeFile(f,s.split('/skills/maps/scripts/').join('/skills/productivity/maps/scripts/'));changed++;console.log('maps skill path: '+path.relative(HOME,f))}}

const GOOGLE_SECTION=`
<!-- aqeelos:direct-first -->
## Not set up yet? Set it up with this skill (free)

If no Google account is set up here yet (\`setup.py --list-accounts\` shows none), set one up with this skill: it is
free. Send the sign-in link from \`--auth-url\` (see Signing in below). If there is no OAuth client yet, walk the
person through creating one (or do it with them in the browser) and have them send its JSON with the lock button.
If that is not possible (no access to Google Cloud), tell them an admin sets up Google once for everyone in aqeelOS
(Connections › Add › A Google account) and report it with report_bottleneck. Google is always connected directly,
never through a middleman service.
<!-- /aqeelos:direct-first -->

<!-- aqeelos:multi-account --><!-- aqeelos:signin-v3 -->
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
- **Signing in:** if \`--auth-url\` gives a link with redirect_uri ${PUB}/google-oauth/callback, just send the
  link. After the person clicks Allow, aqeelOS finishes the sign-in by itself and shows "Google account connected";
  then run \`--check\`. Do NOT ask them to paste anything. If the link has redirect_uri http://localhost:1 (a Desktop
  client), offer the one-time switch: in Google Cloud › APIs & Services › Credentials, create an OAuth client of type
  "Web application" with the authorised redirect URI ${PUB}/google-oauth/callback, and save its JSON with
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
  // (v3, 11 Nov 2026: the old "composio-first" block, which offered a middleman, is taken out of every install)
  if(!s.includes('aqeelos:signin-v3')){s=s.replace(/\n?<!-- aqeelos:(composio|direct)-first -->[\s\S]*?<!-- \/aqeelos:(composio|direct)-first -->\n?/,'\n').replace(/\n?<!-- aqeelos:multi-account -->[\s\S]*?<!-- \/aqeelos:multi-account -->\n?/,'\n');const at=s.search(/\n## /);s=at>0?s.slice(0,at)+'\n'+GOOGLE_SECTION+s.slice(at):s+GOOGLE_SECTION;await writeFile(md,s);changed++;console.log('patched',md)}}}
// 3) Google sign-ins return to the aqeelOS site when the Google client is a "Web application" one: aqeelOS then
//    finishes the sign-in itself (no "copy the localhost address"). A Desktop client keeps the localhost method.
const WEB_REDIRECT=`REDIRECT_URI = "http://localhost:1"
# aqeelos:web-redirect: a Web-application client returns to the aqeelOS site, which finishes the sign-in by itself
try:
    if "web" in json.loads(CLIENT_SECRET_PATH.read_text(encoding="utf-8")):
        REDIRECT_URI = os.environ.get("AQEELOS_GOOGLE_REDIRECT", "${PUB}/google-oauth/callback")
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
  const next=s.split('\n').map(l=>/^\s*[\w.-]+:\s/.test(l)||/^\s+["']/.test(l)?l.replace(/Hermes Agent/g,'aqeelOS').replace(/\bHermes\b/g,'aqeelOS').replace('a markdown implementation plan to .hermes/plans/ without executing anything','a step-by-step plan as a markdown file, without doing anything yet'):l).join('\n');
  if(next!==s){await writeFile(p,next);changed++;console.log('renamed engine messages in',f)}}}
// 8) Words the engine sends straight to people outside its message files: approval prompts, the WhatsApp reply
//    header, schedule results and failures, "is working", the Telegram command menu, tool errors the agent repeats,
//    sign-in pages. scripts/rename-engine.py changes only real string literals (Python's own tokenizer decides), never
//    names in code or strings that are compared; every file must still compile and is replaced atomically.
{const {execFileSync}=await import('node:child_process');
 const py=(()=>{try{const base=path.join(HOME,'installs');const l=[];for(const i of readdirSync(base))for(const e of readdirSync(path.join(base,i,'environments'))){const p=path.join(base,i,'environments',e,'venv','bin','python');if(existsSync(p))l.push(p)}return l[0]||'python3'}catch{return 'python3'}})();
 try{const out=execFileSync(py,[path.join(path.dirname(new URL(import.meta.url).pathname),'rename-engine.py'),path.join(HOME,'hermes-agent'),'gateway','cron','agent','tools','hermes_cli','plugins'],{timeout:300000,encoding:'utf8',maxBuffer:16e6});
  const n=Number((/(\d+) file\(s\) renamed/.exec(out)||[])[1]||0);if(n){changed+=n;console.log('renamed engine words in',n,'file(s)')}for(const l of out.split('\n').filter(l=>l.startsWith('!')))console.warn(l)}
 catch(e){console.warn('! engine wording:',String(e.message).split('\n')[0])}}
// 9) Read aloud: Microsoft's free voice refuses old edge-tts versions (403). Any engine environment that carries an
//    older edge-tts gets 7.3.1 (the old one is kept next to it as a backup); the dashboard picks it up when it restarts.
{const base=path.join(HOME,'installs');const WANT='7.3.1';
 const URL_='https://files.pythonhosted.org/packages/35/86/3b97d755992777d5a9ca0e45a8ec96cc9858b2d6dd8f65f3f688d60e8709/edge_tts-7.3.1-py3-none-any.whl';
 const older=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)<(y[i]||0)}return false};
 const {execFileSync}=await import('node:child_process');let whl=null;
 for(const i of (()=>{try{return readdirSync(base,{withFileTypes:true})}catch{return []}})().filter(d=>d.isDirectory()).map(d=>d.name))for(const e of (()=>{try{return readdirSync(path.join(base,i,'environments'))}catch{return []}})()){
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
// 11) Skills are instructions the agents read and sometimes quote: their prose says aqeelOS too. Code blocks, `inline
//     code`, paths and commands are left exactly as they are (they must keep working).
{const roots=[path.join(HOME,'skills')];for(const p of (()=>{try{return readdirSync(path.join(HOME,'profiles'))}catch{return []}})())roots.push(path.join(HOME,'profiles',p,'skills'));
 const walk=(d,out)=>{let l=[];try{l=readdirSync(d,{withFileTypes:true})}catch{return out}for(const e of l){const p=path.join(d,e.name);if(e.isDirectory()&&!e.name.startsWith('.'))walk(p,out);else if(/^(SKILL|README)\.md$|\.md$/.test(e.name))out.push(p)}return out};
 const prose=l=>l.split(/(`[^`]*`)/).map((part,i)=>i%2?part:part.replace(/Hermes Agent/g,'aqeelOS').replace(/(?<![\w./~-])Hermes(?![\w/-])/g,'aqeelOS')).join('');
 let n=0;for(const r of roots)for(const f of walk(r,[])){const s=await readFile(f,'utf8').catch(()=>null);if(s==null||!/Hermes/.test(s))continue;let fence=false;
  const next=s.split('\n').map(l=>{if(/^\s*(```|~~~)/.test(l)){fence=!fence;return l}return fence?l:prose(l)}).join('\n');
  if(next!==s){await writeFile(f,next);n++}}
 if(n){changed+=n;console.log('skills say aqeelOS in',n,'file(s)')}}
// 12) The engine told agents that aqeelOS's documentation lives on the original engine's website, and an agent without
//     the engine-help skill sent people there ("ask an admin, see hermes-agent.nousresearch.com"). Now no link is
//     given out, and an agent changes its own settings or names the aqeelOS page that does it.
{const pf=path.join(HOME,'hermes-agent','agent','prompt_builder.py');let s=await readFile(pf,'utf8').catch(()=>null);
 if(s!=null&&s.includes('https://hermes-agent.nousresearch.com/docs')){
  s=s.replace('"tools, or capabilities, the documentation at https://hermes-agent.nousresearch.com/docs is your "','"tools, or capabilities, the engine documentation (for your own reading only: never give the person a link to it) is your "')
   .replace('"tools, or capabilities, the documentation at https://hermes-agent.nousresearch.com/docs is the "','"tools, or capabilities, remember that your own settings are yours to change: they live in config.yaml in your folder and change with the "')
   .replace('"authoritative reference and always holds the latest, most up-to-date information. Point the user there "','"aqeelos config set command (aqeelos config show lists them). When the person asks for a change, make it, "')
   .replace('"(or read it yourself if you have a way to fetch web content)."','"or name the aqeelOS page that does it (Settings, Channels, Connected apps). Never send them to outside documentation."');
  if(!s.includes('https://hermes-agent.nousresearch.com/docs')){const t=pf+'.aq.tmp';await writeFile(t,s);
   const {execFileSync}=await import('node:child_process');try{execFileSync('python3',['-c','import ast,sys;ast.parse(open(sys.argv[1]).read())',t]);await rename(t,pf);changed++;console.log('engine help text gives no outside link')}catch(e){await rm(t,{force:true});console.warn('! engine help text: would not compile, left alone')}}
  else console.warn('! engine help text changed upstream: link still there')}}
// 13) Backup models (30 Oct 2026, with app/backup-models.mjs). When every model failed, the person got the engine's own
//     words ("Claude Subscription DirectSDK (Experimental) didn't answer after 3 attempts ... add a backup provider with
//     `hermes fallback add`. Provider said: ..."). Now: "I couldn't reach any of my models just now (Claude and GPT). Please
//     send it again in a minute." The engine has no setting or hook for that text (the failed reply skips the
//     transform_llm_output hook), so the copy is changed where it is made, and the gateway's "Your request was not
//     processed" is not added under it (it is still saved in the chat's history). When a backup model answered, the reply
//     ends with one short line: "(Answered with GPT, Claude was down.)" (the engine's own notice of this is hidden by
//     suppress_warning_notifications, and names the engine's providers). A plain name per model: Claude, GPT, Gemini.
{const brand=`def _aq_brand(p, m):
                s = str(m or "").lower(); q = str(p or "").lower()
                for k, n in (("claude", "Claude"), ("opus", "Claude"), ("sonnet", "Claude"), ("haiku", "Claude"), ("gpt", "GPT"), ("codex", "GPT"), ("gemini", "Gemini")):
                    if k in s: return n
                for k, n in (("claude", "Claude"), ("anthropic", "Claude"), ("openai", "GPT"), ("codex", "GPT"), ("gemini", "Gemini"), ("antigravity", "Gemini"), ("google", "Gemini")):
                    if k in q: return n
                return "another model"`;
 const P=[{f:'agent/turn_recovery.py',tag:'aqeelos:plain-failure',
   from:`    result = _failed_turn_result(_final_response, messages, api_call_count, _final_summary)`,
   to:`    # aqeelos:plain-failure: every model failed: one plain sentence naming the models tried, no engine words
    if not _is_billing and not _free_tier_kind:
        try:
            ${brand}
            _aq_seen = []
            _aq_prim = getattr(agent, "_primary_runtime", None) or {}
            for _p, _m in [(_aq_prim.get("provider"), _aq_prim.get("model"))] + [(f.get("provider"), f.get("model")) for f in (getattr(agent, "_fallback_chain", None) or [])] + [(provider, model)]:
                if _p and _aq_brand(_p, _m) not in _aq_seen: _aq_seen.append(_aq_brand(_p, _m))
            _aq_names = " and ".join(_aq_seen) if len(_aq_seen) < 3 else ", ".join(_aq_seen[:-1]) + " and " + _aq_seen[-1]
            _final_response = f"I couldn't reach any of my models just now ({_aq_names}). Please send it again in a minute."
            if _reset_at and _reset_at - time.time() >= 120:
                from agent.retry_utils import format_reset_window
                _final_response = f"I couldn't reach any of my models just now ({_aq_names}). {_aq_seen[0]}'s limit resets in {format_reset_window(_reset_at - time.time())}."
        except Exception:
            pass
    result = _failed_turn_result(_final_response, messages, api_call_count, _final_summary)`},
  {f:'gateway/run_turn_persistence.py',tag:'aqeelos:plain-failure',
   from:`        response = str(response or "").strip()
        return f"{response}\\n\\n{notice}" if response else notice`,
   to:`        response = str(response or "").strip()
        if response.startswith("I couldn't reach any of my models just now"):  # aqeelos:plain-failure (it says what to do)
            return response
        return f"{response}\\n\\n{notice}" if response else notice`},
  {f:'agent/turn_finalizer.py',tag:'aqeelos:backup-note',
   from:`    agent._llm_output_transform = (turn_id, transformed, pre_transform)
    return final_response, transformed, pre_transform`,
   to:`    # aqeelos:backup-note: a backup model answered this turn: one short line under the reply
    try:
        _aq_fb = getattr(agent, "_provider_fallback_route", None) if getattr(agent, "_provider_fallback_active", False) else None
        if isinstance(_aq_fb, (list, tuple)) and len(_aq_fb) == 2 and isinstance(final_response, str) and final_response.strip():
            ${brand}
            _aq_prim = getattr(agent, "_primary_runtime", None) or {}
            _aq_new, _aq_old = _aq_brand(_aq_fb[1], _aq_fb[0]), _aq_brand(_aq_prim.get("provider"), _aq_prim.get("model"))
            if _aq_new != _aq_old and "(Answered with " not in final_response:
                if not transformed:
                    pre_transform = final_response
                final_response, transformed = f"{final_response}\\n\\n(Answered with {_aq_new}, {_aq_old} was down.)", True
    except Exception:
        pass
    agent._llm_output_transform = (turn_id, transformed, pre_transform)
    return final_response, transformed, pre_transform`}];
 const {execFileSync}=await import('node:child_process');
 for(const x of P){const pf=path.join(HOME,'hermes-agent',x.f);let s=await readFile(pf,'utf8').catch(()=>null);if(s==null)continue;
  if(s.includes(x.tag))continue;   // in place already
  if(s.split(x.from).length!==2){console.warn('! backup models: '+x.f+' changed upstream; its plain words are not in place');continue}
  const t=pf+'.aq.tmp';await rawWrite(t,s.replace(x.from,x.to));
  try{execFileSync('python3',['-c','import ast,sys;ast.parse(open(sys.argv[1]).read())',t]);await rename(t,pf);changed++;console.log('backup models: plain words in',x.f)}catch(e){await rm(t,{force:true});console.warn('! backup models: '+x.f+' would not compile, left alone')}}}
// 14) Engine: Kirimdev's webhook signatures (X-Kirim-Signature), and webhook routes bound to an agent reaching it; see
//     scripts/kirim-signature-patch.mjs. Each fix all or nothing, and the file must still compile before it replaces the engine's.
{const {kirimPatch}=await import('./kirim-signature-patch.mjs');const pf=path.join(HOME,'hermes-agent','gateway','platforms','webhook.py');
 const s=await readFile(pf,'utf8').catch(()=>null);
 if(s!=null){const r=kirimPatch(s);
  for(const e of r.errors)console.warn('! webhook.py: '+e+'; left as it is');
  if(r.out){const {execFileSync}=await import('node:child_process');const t=pf+'.aq.tmp';await rawWrite(t,r.out);
   try{execFileSync('python3',['-c','import ast,sys;ast.parse(open(sys.argv[1]).read())',t]);await rename(t,pf);changed++;console.log('webhook.py: '+r.applied.join(', ')+' in place')}
   catch{await rm(t,{force:true});console.warn('! webhook.py would not compile with '+r.applied.join(', ')+', left alone')}}}}
// 15) Engine fixes from the 5 Nov 2026 audit (scripts/engine-fixes-patch.mjs): engines started by a chat run get the
//     real home (Claude's login), and the backup-model note stays out of customer chats. Same rules as 14.
{const {fixFile,FILES}=await import('./engine-fixes-patch.mjs');const {execFileSync}=await import('node:child_process');
 for(const f of FILES){const pf=path.join(HOME,'hermes-agent',f);const s=await readFile(pf,'utf8').catch(()=>null);if(s==null)continue;
  const r=fixFile(f,s);for(const e of r.errors)console.warn('! '+f+': '+e+'; left as it is');
  if(!r.out)continue;const t=pf+'.aq.tmp';await rawWrite(t,r.out);
  try{execFileSync('python3',['-c','import ast,sys;ast.parse(open(sys.argv[1]).read())',t]);await rename(t,pf);changed++;console.log(f+': '+r.applied.join(', ')+' in place')}
  catch{await rm(t,{force:true});console.warn('! '+f+' would not compile with '+r.applied.join(', ')+', left alone')}}}
// 16) Engine changes of 6 Nov 2026 (engine/patches: per-chat SSH sockets, persona branding, turn_finalizer notice,
//     prompt_builder). Applied with git, all or nothing: skipped when already in, a warning when upstream changed.
{const {execFileSync}=await import('node:child_process');const E=path.join(HOME,'hermes-agent');
 const D=path.join(path.dirname(new URL(import.meta.url).pathname),'..','engine','patches');const pf=path.join(D,'2026-11-06-tonight.patch');
 if(await exists(path.join(E,'.git'))&&await exists(pf)){const g=a=>execFileSync('git',['-C',E,...a],{stdio:'pipe'});
  let inPlace=false;try{g(['apply','--reverse','--check',pf]);inPlace=true}catch{}
  if(!inPlace){try{g(['apply','--check',pf]);g(['apply',pf]);changed++;console.log('engine: 6 Nov patch in place')}catch{console.warn('! engine: 6 Nov patch does not fit this engine version; see engine/patches/README.md')}}
  const b=path.join(E,'hermes_cli','branding.py');if(!await exists(b)){await writeFile(b,await readFile(path.join(D,'branding.py')));changed++;console.log('engine: branding.py in place')}}}
// 17) Shared skills (engine/patches/2026-11-06-shared-skills.patch): every agent reads the main profile's skills,
//     installed once; <HERMES_HOME>/skills-scope.json limits private ones to listed agents; editing a shared skill
//     makes the agent's own copy. Same all-or-nothing git apply as step 16.
{const {execFileSync}=await import('node:child_process');const E=path.join(HOME,'hermes-agent');
 const pf=path.join(path.dirname(new URL(import.meta.url).pathname),'..','engine','patches','2026-11-06-shared-skills.patch');
 if(await exists(path.join(E,'.git'))&&await exists(pf)){const g=a=>execFileSync('git',['-C',E,...a],{stdio:'pipe'});
  let inPlace=false;try{g(['apply','--reverse','--check',pf]);inPlace=true}catch{}
  if(!inPlace){try{g(['apply','--check',pf]);g(['apply',pf]);changed++;console.log('engine: shared skills in place')}catch{console.warn('! engine: shared skills patch does not fit this engine version; see engine/patches/README.md')}}}}
// 17b) Every later engine fix in engine/patches (named <date>-<what>.patch; 11 Nov 2026: fixes the fixer had made only
//     on a live engine, which the next engine update would have dropped). Same all-or-nothing git apply per patch, but
//     "already in" is decided for the whole ordered list (engine-patch-layers.mjs): a later patch on the same lines as an
//     earlier one hides the earlier one from a reverse check on the live files. Skipped when in, a warning when upstream changed.
{const {applyLayers}=await import('./engine-patch-layers.mjs');const E=path.join(HOME,'hermes-agent');
 const D=path.join(path.dirname(new URL(import.meta.url).pathname),'..','engine','patches');
 const OWN=new Set(['2026-11-06-tonight.patch','2026-11-06-shared-skills.patch']);
 const list=(await readdir(D).catch(()=>[])).filter(f=>/^\d{4}-\d\d-\d\d-[\w-]+\.patch$/.test(f)&&!OWN.has(f)).sort();
 if(list.length&&await exists(path.join(E,'.git'))){
  let r=null;try{r=applyLayers(E,list.map(f=>path.join(D,f)))}catch(e){console.warn('! engine: could not tell which patches are in ('+String(e.message||e).split('\n')[0]+')')}
  if(r){for(const f of r.applied){changed++;console.log('engine: '+f+' in place')}
   for(const f of r.misfit)console.warn('! engine: '+f+' does not fit this engine version; see engine/patches/README.md')}}}
// 18) Kirimdev is not WhatsApp (the owner, 7 Nov 2026: "Kirimdev is WhatsApp CRM. Kirimdev we only use API key"). The
//     support agents' skill called Kirimdev lines "WhatsApp" and sent people to Channels > Connections for them; the
//     agents' own WhatsApp channel (the engine's WhatsApp platform) is something else. Every copy gets a short note on
//     top and the wrong pointers fixed; each change is skipped when it is there already.
{const NOTE=`<!-- aqeelos:kirimdev-not-whatsapp -->
> Kirimdev is the team's WhatsApp CRM. You reach it only through its API key (\`.tools/kirim\`, \`whatsapp_reply\`); call
> it your **Kirimdev line**. It is NOT a WhatsApp channel of yours (the engine's WhatsApp platform, like the main
> agent's extra numbers). A Kirimdev API error (an empty or non-JSON answer, 401, a timeout) is a Kirimdev problem:
> say "the Kirimdev API", never "WhatsApp is down". aqeelOS checks the key, the API and your webhook every 10 minutes
> (Channels > Kirimdev, and System > Health as "Kirimdev line (<you>)").
`;
 const FIX=[['# WhatsApp support agents (Kirimdev)','# Kirimdev support agents (customer chats in the Kirimdev WhatsApp CRM)'],
  ['- WhatsApp runs inside aqeelOS: Kirimdev webhooks (Channels > Connections) deliver customer messages to the agent.','- Your Kirimdev line runs inside aqeelOS: the Kirimdev API key, plus a webhook per line (Channels > Kirimdev) that delivers customer messages to the agent.'],
  ['replies won\'t reach them until they are added (Channels > Connections).','replies won\'t reach them until they are added (Channels > Kirimdev).'],
  ['The test list is set in aqeelOS (Channels > Connections), not by the brand agent','The test list is set in aqeelOS (Channels > Kirimdev), not by the brand agent']];
 for(const h of homes){const f=path.join(h,'skills','productivity','whatsapp-support-agents','SKILL.md');if(!await exists(f))continue;let s=await readFile(f,'utf8'),t=s;
  for(const [a,b] of FIX)t=t.split(a).join(b);
  if(!t.includes('aqeelos:kirimdev-not-whatsapp')){const m=/^# .*\n/m.exec(t);t=m?t.slice(0,m.index+m[0].length)+'\n'+NOTE+t.slice(m.index+m[0].length):NOTE+'\n'+t}
  if(t!==s){await writeFile(f,t);changed++;console.log('kirimdev skill note: '+path.relative(HOME,f))}}}
console.log(changed?changed+' change(s)':'skill patches already in place');
