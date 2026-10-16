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
## Not set up yet? Use Composio first

If no Google account is set up here yet (\`setup.py --list-accounts\` shows none) and the agent has the Composio
tools (composio), use Composio's Gmail, Google Drive, Calendar, Sheets and Docs tools instead. Do NOT ask the
person to create a Google Cloud project or OAuth client: that is slow and error-prone. Only set Google up here
when the person asks for it, or when Composio cannot do the job.
<!-- /aqeelos:composio-first -->

<!-- aqeelos:multi-account -->
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
  if(!s.includes('aqeelos:composio-first')){s=s.replace(/\n?<!-- aqeelos:multi-account -->[\s\S]*?<!-- \/aqeelos:multi-account -->\n?/,'\n');const at=s.search(/\n## /);s=at>0?s.slice(0,at)+'\n'+GOOGLE_SECTION+s.slice(at):s+GOOGLE_SECTION;await writeFile(md,s);changed++;console.log('patched',md)}}}
console.log(changed?changed+' change(s)':'skill patches already in place');
