# aqeelOS

aqeelOS is a web interface and team layer for the [Hermes Agent](https://github.com/NousResearch/hermes-agent) engine: several agents, each with their own channels (Telegram, WhatsApp, Slack, web chat), schedules, tools, Google and n8n connections, sharing levels and a self-fixing issue loop, in five sections (Chat, Automations, Abilities, Models, System).

## Requirements
- Linux server, Node.js 22+, Python 3.11+
- Hermes Agent installed in `~/.hermes/hermes-agent` with its gateway (port 8642) and dashboard (port 9119) running
- Optional: n8n, Xvfb + noVNC (the live agent screen), the `gws` CLI for Google, AdsPower

## Setup
On the server, as your own user (not root):
1. Install [Hermes Agent](https://github.com/NousResearch/hermes-agent).
2. `git clone` this repo (e.g. `~/apps/aqeelos`), then run the installer once:
   ```bash
   sudo bash scripts/install.sh
   ```
   It checks Node.js, Python and the engine, adds the Claude sign-in plugin to the engine, sets up the per-agent Linux users (a small root service), and starts aqeelOS as a service on port 4400. Add `--open` to try it at `http://<server IP>:4400` before a proxy is in front, or `--port N` for another port.
3. Put an https proxy (Caddy, Traefik, nginx) in front of `127.0.0.1:4400`.

You never edit an env file:
- the engine's gateway key and dashboard token are read from `~/.hermes/.env`; a fresh engine has none, so aqeelOS writes them there on its first start (restart the engine once after that);
- the sign-in key (`UI_SECRET`) is made on the first start and kept in the data folder, so sign-ins survive restarts;
- the address, time zone, Code and app addresses are set in the app.
An env file is still read when you want to override something (`.env.example` lists every value; the installer's service reads `~/.config/aqeelos/aqeelos.env`). A value set there wins over the app's setting and shows as "Set in the environment".

## Desktop app
The Mac and Windows apps are on [the latest release](https://github.com/aqeeljundiy/aqeel-os/releases/latest). They aren't verified by Apple or Microsoft yet, so the first launch needs one extra step: [install on a Mac, step by step](docs/install-mac.md). On Windows, choose More info › Run anyway.

## First run
- Open your address. A new install shows **Create the owner account** (name, username, password) and then a recovery code: save it. The owner can do everything and invites the others under System › People.
- Lost password: **Forgot password?** on the sign-in page emails a one-hour link to a confirmed email. An admin can also set a new password for someone, sign them out or suspend them (People, the person's menu). The owner's recovery code signs them in once without the password or two-step; a new one is made in Your profile.
- The first sign-in asks for **Your address**, prefilled with the address in the browser, and checks that it reaches this install. Invites, WhatsApp Business, Kirimdev webhooks, Google and MCP sign-ins all send people back to it. Change it later on System › Settings › This install.
- System › Settings › This install also holds the **time zone** (one for the whole install: schedules, posting limits, backups and notices; every agent gets it) and the **Code and app addresses**.
- Models › **Install Claude sign-in** installs the Claude app on the server and turns on the engine's Claude plugin (shipped in `engine/claude-subscription-directsdk-experimental`, MIT, from Nous Research's official plugins), so a Claude Pro or Max plan can be added as an account.
- Agents says when the **per-agent Linux users** are missing (agents other than the main one then have no terminal, files, code or Runs itself of their own) and shows the one command that fixes it: `sudo bash scripts/install.sh --agent-users`.
- Automations › n8n asks for the n8n address when nothing answers there, and checks it.
- **Browser profiles (AdsPower)** and **Composio apps** are off for every agent until switched on in Edit agent › Abilities (AdsPower alone runs about a gigabyte per agent). Off, the agent has none of their tools and nothing asks it to sign in. On an existing install the first start keeps each only for agents that ran its tools in the last 14 days, with backups (`*.bak-optins-*`) and a note in Activity.
- **Sign-in apps** (Notion, Slack, any app that signs in through a page) are switched per agent the same way, in Edit agent › Abilities. The first count keeps an app only where the agent ran its tools in the last 14 days; the main agent keeps all its own (the owner's sign-ins). Agents can turn off an app they do not need themselves with the `switch_my_app_off` tool (never on). Their own reports about sign-ins for apps that are now off close by themselves.
- The name, logo and contact are set in the app (System › Branding); the engine persona name also with `AQEELOS_BRAND_NAME`/`AQEELOS_BRAND_MAKER` or `branding:` in `~/.hermes/config.yaml`.
- Apply the engine patches once and after every engine update: `node scripts/apply-skill-patches.mjs`.
- System › Health shows what else is missing (engine, gateway, screen). Channels › Who can message decides who may write to each agent; Abilities › Connections holds sign-ins.
- Data (users, shares, issues, logs, the install's settings in `install.json`) lives in `UI_DATA_DIR` (default `../hermes-ui-data`); back it up.

### Live copy or test copy
Only the live copy runs the background jobs that change agents (Help, backups, health ticks, defaults). `AQEELOS_LIVE=1` makes a copy live (the installer's service sets it); `AQEELOS_LIVE=0` makes it a test copy (the deploy checks and local development set it). Without it, only a copy on port 4400 is live. System › Settings › This install shows which one you are looking at.

### For other parts of aqeelOS
`app/install.mjs` exports `publicUrl()` (the current address; use it for every callback), `installTz()`, `isLive()` and `engineKeys()`. `PUBLIC_URL_REF` and `urlRef(suffix)` read as the current address wherever a string was passed at start.

## Tests
`node --test scripts/*.test.mjs` (unit tests, no network). End-to-end checks such as `scripts/e2e-check.mjs` need a running install.

## Kirimdev delivery semantics
- Customer turns resume an isolated, durable engine session keyed by agent, phone line, conversation and reset epoch. Pending inbound remains stored until the turn completes; interruption before completion can replay the turn after restart.
- This is **not exactly-once delivery**: if Kirimdev accepts a send and the process stops before pending inbound is cleared and saved, restart can generate/send another reply. Multi-part replies can also replay already accepted parts. The automatic reply path does not persist an outbound per-part acceptance ledger or use stable send idempotency keys.
- Nor is successful delivery guaranteed by a completed turn: automatic send exceptions are logged and caught, so pending inbound can be consumed even when a send failed. Fixing this requires durable outbound tracking and provider-supported idempotency/reconciliation, not simply retrying every failed turn (an ambiguous timeout may already have been accepted).
- A provider message ID is evidence of acceptance, not final delivery. Inbound event deduplication and durable engine context do not remove the acceptance/commit crash window.

## Not in this repository
Owner-private files are listed in `PUBLIC_EXCLUDE` and `.gitignore` (product notes, the development board, mockups, private skills, backups). Never commit an `.env` file; secrets belong in the env file or the engine's secret store.

## License
MIT, see `LICENSE`.

### Third-party credit
aqeelOS uses [billion-context](https://github.com/ranxianglei/billion-context) by ranxianglei, with its compression kernel [acp-kernel](https://github.com/ranxianglei/acp-kernel), to keep long chats short (MIT with an attribution term). Every install downloads the pinned version (`app/billion-context.mjs`) and switches its engine plugin on in each agent; switch it off per agent on the Plugins page.

---

## More details

### Main agent and agent access
- One main agent (`MAIN_AGENT`, default `default`) is the only agent that changes aqeelOS itself, other agents, keys, permissions, money and deletions.
- **Main agent rule** (written into the main agent's instructions by aqeelOS on every install): when another agent has a problem, the main agent does not fix that agent's work for it. It gives the agent the access or tools it lacks, then tells the person (and the agent, in its own chat or topic) to have the agent fix it itself. It fixes directly only when the owner explicitly asks, or when it is aqeelOS code no agent can reach. The engine plugin `engine/aqeelos-main-rule` adds a reminder to the main agent's tool results when it edits another agent's own files (a reminder, not a block). Install: copy it to `~/.hermes/plugins/` and run `hermes plugins enable aqeelos-main-rule`.
- **Agents as a shared resource** (`app/agent-access.mjs`, sharing type `agent`): one agent can look after another at a level. Viewer reads its setup and logs; Editor also changes its instructions, skills and schedules; Manager also its settings and shares it as Editor or Viewer; Owner does everything. Every agent owns itself. Keys are never shown at any level (a key is shared on its own), and settings about keys, permissions or aqeelOS itself stay with the main agent. Agents use it through the `manage_agent` tool; the level is checked on the server on every call, and every change is attributed and passed to `app/agent-versions.mjs` (`recordAgentChange`) when present. Set it per agent under Agents › Edit agent › Access.

### Restart hold and quiet alerts
- **Restart hold**: while a long build or migration runs, write `<UI_DATA_DIR>/restart-hold.json` as `{"until": <epoch ms>, "why": "<text>"}`. Automatic engine restarts (`restartGateway`) are skipped and logged until `until`; owner alerts from System › Health and the automations guard are written to the log instead of sent. Remove the file when done and restart once. An expired hold is ignored, so a forgotten file never blocks for good.
- **Test agents**: list agent names (one per line, `#` comments) in `$HERMES_HOME/.aqeelos-test-agents`. Their problems still show on Health, but the owner is not alerted about them.
- **Fixed notes**: when a problem the owner was alerted about goes away by itself, one short "Fixed by itself" line follows. Nothing is sent for problems that were never alerted.
- Code: `app/alert-quiet.mjs`; tests `scripts/alert-quiet.test.mjs`, `scripts/busy.test.mjs`.

### Local development
`node --env-file=<dev.env> app/server.mjs` with `HERMES_DASH`/`HERMES_API` pointing at an SSH tunnel to the box (see `.claude/launch.json`). `dev.env` holds `API_SERVER_KEY`, `HERMES_DASHBOARD_SESSION_TOKEN`, `UI_PASSWORD_HASH`, `UI_SECRET` and `UI_INSECURE_COOKIE=1`; keep it out of this folder.

### Live screen
The box runs a virtual display (`:99`, Xvfb + fluxbox), shared with x11vnc and streamed by noVNC on 127.0.0.1:6080. The app proxies it at `/screen/` behind the login (WebSocket only from this site). Hermes runs its browser headed (`browser.headed: true`) on that display. If the screen is blank, `~/services.sh` on the server restarts anything missing.

### Network lock
The container starts with firewall rules that refuse new connections from the container to private networks (other containers on the host), and to the server's own IP. It needs `cap_add: NET_ADMIN` in the compose file; the agent itself runs as `claude` without root and can't change them.
