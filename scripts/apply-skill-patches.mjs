// Small, re-appliable improvements to engine skills (an engine update can replace skill files, so
// deploy.sh runs this every time; each change is skipped when it is already there).
// Run on the box: node scripts/apply-skill-patches.mjs
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import path from 'node:path';import {homedir} from 'node:os';
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
console.log(changed?changed+' change(s)':'skill patches already in place');
