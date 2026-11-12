# aqeelOS architecture

For anyone (a person or an AI assistant) who has to change this code. Written 12 Nov 2026 from the code at that date and the
maintainability audit (action 5). Statements here were checked against the files named next to them; when you change one of
those files, change this page in the same commit. Rules for working in this repo: [AGENTS.md](../AGENTS.md).

## 1. What runs where

```
  browser / desktop app / phone ──https──▶  reverse proxy ──▶  aqeelOS  (node app/server.mjs, port 4400)
                                                                  │  loopback, signed per agent        ▲ agents call tools back
                      ┌───────────────────────────────────────────┤                                    │
                      ▼                                           ▼                                    │
          Hermes Agent engine (not in this repo)         the box (Linux, one container per install)    │
          dashboard :9119  gateway API :8642              agents: one Linux user ag-<agent> each ──────┘
          webhooks :8644   WhatsApp cloud :8090           screens (Xvfb + fluxbox, noVNC :6080), Chrome,
          ~/.hermes/profiles/<agent>/…                    AdsPower, n8n, the root script agent-users.sh
```

| Part | What it is | Where |
|---|---|---|
| **The app** | One Node 22 process, no dependencies, no build step. Serves the UI, signs people in, owns every rule about who may do what, keeps state in JSON files, proxies the engine. | `app/server.mjs` (3,356 lines, 498 KB) + 174 modules `app/*.mjs` |
| **The UI** | Plain browser scripts that share one global scope (no modules, no bundler), one CSS file. Page order is the order of `<script>` tags. | `app/index.html`, `app/*.js` (67), `app/app.css`; clash check `scripts/check-globals.mjs` |
| **The engine** | Hermes Agent (third party): runs the agents' chats, tools, schedules, channels (Telegram, WhatsApp, Slack, web). aqeelOS talks to its dashboard with the session token (`x-hermes-session-token`) and to its gateway with `API_SERVER_KEY`. The engine's keys come from `~/.hermes/.env` (`app/install.mjs: engineKeys`). | outside; `engine/` holds our plugins and `engine/patches/*.patch` applied by `scripts/apply-skill-patches.mjs` |
| **Agents** | A profile folder under `~/.hermes/profiles/<agent>` (the main agent is `~/.hermes` itself, `default`). On the box each agent's processes run as Linux user `ag-<agent>`. | home path: `homeOf(agent)` in `app/agentops.mjs` |
| **The root script** | A small root service: per-agent users, screens, Chrome, memory caps, janitor, orphan sweep. | `scripts/agent-users.sh`, `scripts/services.sh`, `scripts/install.sh` |
| **Code by aqeel** | A separate local app (workspace, terminals, Claude Code / Codex / Gemini CLI) with its own server and tests; also published online and as an Electron desktop app. | `code/` (own `package.json`), `code/desktop/`, `code-installer/`, `app/code*.mjs` embed it |
| **Browser extension** | Side-browser helper. | `extension/` |
| **Owner tooling** | `server.mjs` at the repo root only serves `mockup/` and `backlog/` for the owner's preview; `mockup/` is git-ignored. Not part of the product. | `server.mjs`, `backlog/` |
| **Live or test copy** | Only a copy with `AQEELOS_LIVE=1` (or on port 4400) runs the jobs that change agents. Deploy checks use a test copy on :4402. | `app/install.mjs: isLive()` |

State lives in two places, never in the repo:
- **The data folder** `UI_DATA_DIR` (default `../hermes-ui-data`): about 120 JSON files, one per area (`users.json`, `install.json`, `brand.json`, `team-policy.json`, `kirimdev.json`, `price-catalog.json`, `agent-limits.json`, `issues…`, logs). Read and written through `app/store.mjs` (section 5).
- **The engine home** `HERMES_HOME` (default `~/.hermes`): each agent's `config.yaml`, instructions (SOUL), skills, tokens, memory, sessions. aqeelOS edits some of these files (settings, instruction text, skills) and the engine reads them.

## 2. The main modules, by area

All in `app/` unless noted. Names are file names without `.mjs`.

| Area | Modules |
|---|---|
| **Wiring and shared base** | `server` (composition root: imports every module, wires them with `createX({DATA,HERMES_HOME,…})`, the request handler, loops) · the route modules it hands requests to (section 3: `signin-routes` `notify-tools-routes` `code-device-routes` `channels-routes` `health-routes` `connected-routes`) · `store` (JSON state) · `agentops` (home paths, config, locks, `hermes` CLI) · `install` / `install-routes` (address, time zone, live or test) · `tz` · `swr` (last-known answers for slow reads) · `reconcile` (the loops that were expensive) · `busy` (what may run during a restore) |
| **People and rights** | `users` (people, roles, `isAdmin`, `can`, shares) · `account-auth` · `sharing` · `agent-access` (one agent looking after another, levels) · `proxy-agent` (what a member may do through `/hapi`) · `design-guard` · `untrusted` · `secret-links` · `client-ip` · `access` `access-requests` · `local-owner` |
| **Agents** | `agent-defaults` `agent-settings` `agent-versions` (undo) `agent-care` `agent-live` `agent-health` `agent-keys` `agent-memory` `agent-name` `agent-optins` `agent-graph` `agent-adspower` `agent-ops`; `instructions` (text written into agents) · `builtin-skills` `skills-policy` `skill-check` |
| **Work agents do** | `schedules` `schedule-finish` `run-gates` `run-checks` `posting-limits` `event-hooks` `event-runs` `self-runs` `self-runs-box` `resume` `resume-engine` `relay-keys` (the per-agent signatures) `need-action` `questions` `escalations` |
| **Channels and customers** | `channels` `links` (extra connections) `relay` (shared channels between agents) `allowlist` `kirimdev` `kirimdev-agent` `kirim-guard` `tebar` `tebar-app` `customer-tools` `payment-providers` `payment-callbacks` `price-catalog` `paid-labels` `labels` `mail` |
| **Connections** | `connect` `connections` `connectors` `connected-accounts` `accounts` `account-pools` `google-connect` `google-tools` `google-files` `google-sheet-ops` `google-shares` `microsoft-connect` `slack-connect` `n8n` `addons` `share` `plugin-host` |
| **Operations** | `box-ops` `memwatch` `boxmem` `backup` `backup-job` `backup-models` `maintenance` `restart-later` `gateway-stop` `engine-updates` `engine-update-rules` `live-drift` `screens` `localbrowser` `browser-checks` `browser-tidy` `apply-on-start` |
| **Fixers and issues** | `issues` `cloud-fixer` `fixer-git` `fixer-watch` `bottlenecks` `rule-conflicts` `automation-guard` |
| **Insight** | `usage` `usage-extra` `efficiency` `efficiency-view` `chat-history` `news` `explain` `why` `starters` (empty-chat prompts) `morning` `graphify` `billion-context` `team-view` `team-folders` `team-group` `team-settings` |
| **Look** | `brand` `icons` `icons-off` `pwa` `pwa-zip` `png` `raster` (`pwa` → `pwa-zip` → `icons-off` is the one import cycle) |
| **Code app glue** | `code` `code-agents` `code-bridge` `code-changes` `code-online` |

## 3. How a request flows

Everything is in the function passed to `createServer` in `app/server.mjs` (search `createServer(async(req,res)=>`), in this order:

1. `users.load()`, then `pwa.hook` (adds icon and theme tags to every HTML page) and PWA files.
2. `codeOnline.handle` (Code on its own host names, behind sign-in), `/install-ping`, `/local/*` (the owner's terminal on the box; anything else is a 404), `/healthz`.
3. **Pre-auth routes for the box itself** (about 66 routes before the sign-in gate): `/mcp/code/`, `/mcp/self/<agent>/<sig>`, `/mcp/notify/<agent>/<sig>`, `/agent-ops/…`, `/team-message/…`, `/google-files/…`, `/run-gate/…`, `/event-hook/…`, `/posting-*`. Each is **loopback only** (`remoteAddress` 127.0.0.1) **and signed per agent** (`relayKeys.ok` / `sign`, an HMAC kept from `UI_SECRET`). Then auth, invites, payment callbacks, public files.
4. **The `/ui/` gate** (line `const u=await me(req); if(!u) return 401`): a signed-in cookie (`hui`) is required, and every non-GET needs the header `x-hui: 1`. One place decides "signed in?"; keep it there.
5. About 230 `/ui/*` routes, each doing its own check inline: `users.isAdmin(u)` (about 177 times) or `ownsAgent(u,a)`, then `send(res,403,…)`. Only a few areas are delegated to modules with `handle(req,res,…)`: `plugins`, `help`, `install`, `connect`, `screens`, `agentAds`, `codeOnline`, `codeBridge`.
6. `/hapi/*` → `hermesCall`: the engine's dashboard API behind a filter (`proxyAgent.decide`) that decides, per person and per agent, what a member may call. `/gapi/*` is the gateway API. The browser never holds an engine credential.
7. `/app/*` static files, then the UI shell. `server.on('upgrade')` proxies WebSockets (screen, terminal); `process.on('uncaughtException')` logs and continues (deliberate: a restart cuts live customer turns).

Some of those blocks have moved out of the dispatcher into route modules (BACKLOG AUD-16), each answering **true** when it handled the request, at the same place in the order and with the same checks as before:

| Module | What it answers | Where the dispatcher calls it |
|---|---|---|
| `signin-routes` | `/auth/login` `/auth/code` `/auth/invite` `/auth/accept` | with the other `/auth/` routes |
| `notify-tools-routes` | `/mcp/notify/<agent>/<sig>`: the tools an agent calls from its own box (65 KB) | in the pre-auth block, loopback and signed |
| `code-device-routes` | `/ui/code/*` called by the Code desktop app with its `Bearer aqc_` key | just before the `/ui/` gate |
| `channels-routes` | `/ui/channels/*`: link, pause, WhatsApp pairing, approving a person on a channel | inside the `/ui/` gate |
| `health-routes` | `/ui/health/*`, `/ui/teams`, `/ui/alerts`, `/ui/cloud-fixer`: issues, fixer line, cost and memory views | inside the `/ui/` gate |
| `connected-routes` | `/ui/kirimdev`, `/ui/team-group`, `/ui/secret-links`, `/ui/automations`, `/ui/backups`, `/ui/engine-updates`, `/ui/self-runs`, `/ui/tebar`, `/ui/slack`, `/ui/microsoft`, `/ui/google`, `/ui/mcp/server` | inside the `/ui/` gate |

**How to add a route** (or move a block out of `server.mjs`): look in the table above for the module that owns the area and add it there, with its own rights check and a line in the rights matrix test (section 8). A new area gets its own `app/<feature>-routes.mjs` shaped like `signin-routes.mjs`: `export function createXRoutes({deps…}){return async function handle(req,res,p,url[,u]){… return false}}`, where every dependency is named in the one deps object (nothing is reached through a global), a handled request ends in `return send(…),true` and `return false` means "not mine, carry on". In `server.mjs` add one import (after the last `import`), one `const xRoutes=createXRoutes({…})` line before `createServer`, and replace the block by `if(await xRoutes(req,res,p,url[,u]))return;` at the same place. A dependency that `server.mjs` reassigns later (a `let`) must be passed as an accessor, never by value. Then add the file to `SOURCES` in `scripts/route-rights-matrix.test.mjs` and to `SPLIT` in `scripts/lib/source.mjs`, so the rights matrix and the source-text tests still read it. A move changes nothing else: the route matrix table must come out identical, and `node scripts/lib/debt.mjs --lower` records the smaller `server.mjs`.

A new route that reads or changes anything needs an explicit rights check in its own block, and a line in the rights matrix test (section 8).

## 4. How agents call tools

Agents never get an aqeelOS password. Each agent's `config.yaml` lists MCP servers whose URL is on loopback with the agent name and a signature: `http://127.0.0.1:4400/mcp/notify/<agent>/<sig>` (notify, sign-in links, an agent's own settings, versions and undo) and `/mcp/self/<agent>/<sig>` (`run_self`, `run_self_status`, `run_self_list`: tool list `SR_TOOLS` in `server.mjs`). The signature comes from `relayKeys` (`app/relay-keys.mjs`), so only a process on this box that was given the address can use it, and only as that agent. Kirimdev calls, Google files, run gates and posting guards use the same pattern (`/agent-ops/`, `/google-files/`, `/run-gate/`, `/posting-*`).

What the agent is told lives in text that aqeelOS writes into each agent's files: `writeAgentContext()` in `server.mjs` (about 21 KB of instruction lines), `app/instructions.mjs`, `app/agent-defaults.mjs` and the engine plugins in `engine/`. A tool added to the server but not described there is a tool the agent does not know about.

Tools that act on money, customers or other agents are the guarded ones: `customer-tools` (price list and payment, the amount comes from code, never from the model), `kirim-guard` (what may leave to a customer), `posting-limits`, `agent-access` (levels, checked on every call), `design-guard`.

## 5. Where state lives, and how to save it

- **Use `app/store.mjs`.** `readStore(file,fallback)`, `updateStore(file,fallback,fn)`, `saveStore`, and for the few synchronous callers `readStoreSync`/`saveStoreSync`. Rules: only "does not exist" means new; any other read failure marks the file BAD, leaves it untouched, serves the last good copy and **refuses every save** (one Health item names the file); writes are atomic and keep `<file>.last-good`. Never write `try{JSON.parse(await readFile(f))}catch{return {}}` followed by a save: one bad read would erase the file (this is what the audit found in `price-catalog` and `install`, now fixed).
- **Agent home path**: `homeOf(agent)` from `app/agentops.mjs`, not `a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a)`.
- **Time zone**: one for the whole install (`installTz()` in `install.mjs`, helpers in `tz.mjs`).
- **Settings that differ per install** are data (`install.json`, `kirimdev.json`, `team-policy.json`), never code; a value in the environment wins over the app's setting. Every environment variable the code reads is listed in `.env.example` (the debt test fails otherwise).
- **Install-specific facts never go in git** (names, numbers, addresses, keys): `CONTRIBUTING.md`; enforced by `scripts/repo-privacy.test.mjs`, gitleaks and `PUBLIC_EXCLUDE`.
- Kill and hold files (rollbacks, all legitimate): `.aqeelos-billion-context-off`, `.aqeelos-graph-off`, `.aqeelos-run-gates-off`, `.aqeelos-agent-users.stop`, `engine-off`, `two-step-off`, `restart-hold.json`, `provider-hold.json`, `channel-paused.json`, `aqeelos-hold-cron`, `chrome.stopped`, `screen-stopped`.

## 6. Deploy, update and undo

Only a commit on GitHub `main` goes live (`OPERATIONS.md` rule 5).

1. **`bash scripts/deploy.sh`** on a PC: `check-globals`, **`premerge-check`**, the privacy test when the private word list is present, `node --check` of every browser script; refuses uncommitted changes, a commit not on `origin/main`, and a commit that does not contain the commit the box runs now (`.deployed-commit`). Nothing is sent before these pass. `DRY_RUN=1` stops there.
2. It starts **`scripts/box-deploy.sh`** on the box, detached, and follows its log (a dropped connection does not stop it): `box-pack.sh` fetches the commit from GitHub, `box-idle.sh` (a deploy no longer waits for an idle box; what it cuts off is continued by `app/resume.mjs`), `box-check.sh` (scripts parse, `check-globals`, `engine-sim.sh` = the engine update check; the browser checks run once a night, `FULL_CHECK=1` runs them now), then **`box-live.sh`**.
3. **`box-live.sh`** swaps the folders by rename (`aq_switch`: the old version goes to `.prev`), restarts once nothing is in progress, and runs `scripts/live-test.mjs`. Any failure after the swap, or a failed live test, runs **`aq_put_back`/`aq_undo`**: the previous version and its commit come back and only the web app restarts. `scripts/box-undo.test.mjs` runs this with stubs (Linux only).
4. **Automatic updates**: `scripts/auto-update.mjs` in each install's maintenance window takes `main` if the required checks (`tests.yml`) passed for that commit; a Docker box goes through the same `box-deploy.sh`, an installer install fast-forwards, restarts and goes back if it stops answering. Only code travels: agents, skills, memory, keys and settings stay.
5. **Engine updates** are separate: `app/engine-updates.mjs` and `engine-update-rules.mjs`, with `engine/patches/` reapplied by `apply-skill-patches.mjs` and checked by `engine-sim.sh` on every deploy.
6. **Fixes by the fixer** arrive as pull requests from a `claude/` branch: `.github/workflows/fixer-gate.yml` (see 7) and `docs/cloud-fixer.md`.

## 7. Tests and CI gates

| Gate | What | Where |
|---|---|---|
| Pre-merge check | no conflict markers; every JS, shell, JSON, YAML, Python file parses; a regex that lost its backslashes; no file over 1 MB or scratch file | `scripts/premerge-check.mjs`; CI step, fixer-gate (main's copy), pre-push, `deploy.sh` |
| Secret and privacy scans | gitleaks (pinned), `repo-privacy.test.mjs` | `tests.yml`, pre-push |
| Browser globals | no two UI scripts declare the same top-level name | `scripts/check-globals.mjs` |
| Unit and integration | `node --test --test-concurrency=2 --test-timeout=120000 scripts/*.test.mjs` (about 1,400 tests, no network). Three files boot the real server (`proxy-agent`, `sec-high`, `sec-medium`); `route-rights-matrix` checks every route for every kind of person. | `tests.yml` |
| Debt may only go down | server.mjs size, JSON saved without the store, inline agent-home paths, timers, exports nothing imports, env variables not in `.env.example` | `scripts/debt.test.mjs`, numbers in `scripts/debt-baseline.json`, measured by `scripts/lib/debt.mjs` |
| Code app | `cd code && npm ci && node --test test.mjs *.test.mjs desktop/*.test.mjs` | `tests.yml` |
| Python | `scripts/group-context.test.py` | `tests.yml` |
| Flicker | headless Chrome on an empty install | `scripts/flicker-ci.mjs` |
| Fixer gate | a pull request is judged by **main's** workflow, runner, pre-merge check and a copy of **main's** version of every existing test and of `scripts/lib/` and the debt numbers laid over it (`tests-from-main`); small fixes inside the allow-list pass, the rest wait for the owner | `.github/workflows/fixer-gate.yml`, `scripts/pr-gate.mjs`, `.github/fixer-gate.json`, `.github/CODEOWNERS` |

Not run in CI, on purpose (documented in `.github/workflows/tests.yml`): `scripts/engine-fixes.test.py`, `scripts/kirim-signature.test.py` and the plugin suite in `engine/claude-subscription-directsdk-experimental/tests` import the installed engine and cannot run on a bare runner (they run on a box). Source-text tests read app code through `scripts/lib/source.mjs` (`src('app/server.mjs')`), so splitting `server.mjs` later does not break them. **Run tests on Linux** (the box, CI, or a container): on Windows about 78 fail for platform reasons (no bash, symlinks, `C:\` paths), which hides real failures.

Before a change to `server.mjs` splits it: land the guards first (this page's gates), move code verbatim one area at a time into `app/<feature>-routes.mjs` (the pattern in section 3, six areas done), keep the top-level dispatcher order and the `/ui/` gate where they are, and review with `git diff --color-moved=dimmed-zebra`.

## 8. To change X, touch these files, run these tests

Run the named tests with `node --test scripts/<name>.test.mjs`, then the full suite on Linux. "UI" = `app/*.js`, `app/app.css`, `app/index.html`.

| # | To change… | Touch | Run |
|---|---|---|---|
| 1 | Add or change a `/ui/*` route | its block in `app/server.mjs` or the route module that owns the area (section 3), with its rights check; the UI page that calls it; the rights matrix | `route-rights-matrix`, `route-rights`, `route-handlers`, `sec-high`, `sec-medium`, `debt` |
| 2 | Who may do what (roles, sharing, agent levels) | `users`, `sharing`, `agent-access`, `proxy-agent` (`/hapi` filter); owner approval needed (`.github/fixer-gate.json` "never") | `users`, `sharing`, `agent-access`, `proxy-agent`, `agents-equal`, `route-rights-matrix` |
| 3 | A tool an agent can call | `/mcp/notify` or `SR_TOOLS` block in `server.mjs`; `agent-ops` for Kirimdev; the text telling agents about it | `notify-tools`, `self-runs`, `agent-ops`, `instructions` |
| 4 | What agents are told | `writeAgentContext` in `server.mjs`, `instructions`, `agent-defaults`; engine plugins in `engine/` | `instructions`, `agent-name`, `agent-defaults-idempotent`, `agents-equal` |
| 5 | An agent's settings or defaults | `agent-settings`, `agent-defaults`, `agent-versions` (undo), `agent-optins` | `agent-settings`, `agent-defaults-idempotent`, `agent-versions`, `agent-optins` |
| 6 | Save a new kind of state | `app/store.mjs` (`readStore`/`updateStore`), never raw `writeFile`; record nothing new in `debt-baseline.json` | `store`, `store-bypass-fixes`, `debt` |
| 7 | A background loop | `app/reconcile.mjs` (expensive checks) or a module `start()`; list it in `docs/app-timers.md` | `reconcile`, `busy`, `debt` (timers), `ops-rules` |
| 8 | A setting from the environment | read it where used; add `# NAME=example` with a one-line description to `.env.example`; prefer `install.json` over a new variable | `debt`, `install` |
| 9 | A UI page or control | `app/*-page.js` or the area's script, `app/app.css`, `app/index.html` (script order); no native `<select>`; check in a real browser | `check-globals`, `flicker`, `labels`, `abilities-ui`, `first-run-ui`, `node scripts/flicker-ci.mjs` |
| 10 | Wording or the Indonesian text | `app/lang.js`, `app/lang-id-more.js` (data), `labels` | `labels`, `name-rules` |
| 11 | Schedules, run gates, posting limits | `schedules`, `run-gates`, `run-checks`, `posting-limits`, `scripts/posting-guard.py` | `schedules`, `run-gates`, `run-gates-cadence`, `posting-limits`, `posting-guard` |
| 12 | Kirimdev (WhatsApp CRM) | `kirimdev`, `kirimdev-agent`, `kirim-guard`, `tebar` | `kirimdev`, `kirimdev-agent`, `kirimdev-outbox`, `kirim-guard`, `kirim-guard-leaks`, `proof-whatsapp` (the chain: script, app, Kirimdev, phone) |
| 13 | Channels and who may message an agent | `channels`, `allowlist`, `route-handlers` (`channelsPause`) | `allowlist`, `own-gateways`, `route-handlers` |
| 14 | Prices, orders, payments | `price-catalog`, `customer-tools`, `payment-providers`, `payment-callbacks`, `route-handlers` (`payHook`) | `customer-tools`, `paid-orders`, `payment-callbacks`, `store-bypass-fixes`, `proof-events` (webhook or callback to one run, on the real app) |
| 15 | Google, Microsoft, Slack, other connections | `google-connect`, `google-tools`, `connected-accounts`, `microsoft-connect`, `slack-connect`, `connect` | `google-connect`, `google-tools`, `connected-accounts`, `microsoft-connect`, `slack-connect`, `connections-status` |
| 16 | Backups and restore | `backup`, `backup-job`, `backup-models` | `backup-restore` (Linux), `backup-job`, `backup-local`, `backup-models` |
| 17 | Engine update or an engine patch | `engine/patches/`, `engine-updates`, `engine-update-rules`, `scripts/apply-skill-patches.mjs`; never edit an applied patch's meaning without `engine-sim.sh` | `engine-patch-layers`, `engine-sim`, `engine-updates` |
| 18 | Per-agent users, screens, memory caps | `scripts/agent-users.sh` (root script), `wake-proxy.mjs`, `box-ops` | `agent-users` (Linux), `root-script-safety`, `lean-screen`, `proof-lean-screen` (real fluxbox and Chrome, Linux box), `wake-proxy`, `box-ops`, `ops-rules` |
| 19 | Deploy, update, undo | `scripts/deploy.sh`, `box-deploy.sh`, `box-check.sh`, `box-live.sh`, `auto-update.mjs` | `box-undo` (Linux), `light-deploy`, `box-hardening`, `auto-update`, `services` |
| 20 | Issues and the fixers; CI | `issues`, `cloud-fixer`, `fixer-git`, `route-handlers` (`issueReply`: who hears about an issue), `scripts/pr-gate.mjs`, `.github/` (owner territory) | `issues`, `cloud-fixer`, `fixer-git`, `fixer-untrusted`, `proof-fixer-tells`, `proof-needs` (the Needs-you buttons on the real app, `scripts/lib/app-rig.mjs`), `pr-gate`, `premerge-check` |
| 21 | Code by aqeel | `code/` | `cd code && node --test test.mjs *.test.mjs desktop/*.test.mjs` |
| 22 | First run, address, time zone, brand | `install`, `install-routes`, `tz`, `brand` | `install`, `accounts-brand`, `store-bypass-fixes` |

When a test you did not write fails: read what it says before changing it. Existing tests are judged from **main's** copy in the fixer gate; a pull request that must change one needs the owner.

## 9. Known weak spots (so you do not walk into them)

- `app/server.mjs` is 43 % of all changes and where most merge conflicts happen: the import block, the `createX({…})` wiring, the agent instruction text. Add new features as their own module and add **one** wiring line; never reformat. The dense style (long lines, median 125 characters) is deliberate: reformatting would conflict with every open branch and erase blame history.
- Route authorization is inline, per route; the rights matrix test is the net under it.
- 184 exported names nothing imports by `scripts/lib/debt.mjs`'s count (the audit's looser count was 130): drop the `export` when you next touch the file; the debt test only stops it growing.
- `app.css` (348 KB), `pages.js` (258 KB), `lang-id-more.js` (180 KB): large on purpose; leave alone.
