# aqeelOS

aqeelOS is a web interface and team layer for the [Hermes Agent](https://github.com/NousResearch/hermes-agent) engine: several agents, each with their own channels (Telegram, WhatsApp, Slack, web chat), schedules, tools, Google and n8n connections, sharing levels and a self-fixing issue loop, in five sections (Chat, Automations, Abilities, Models, System).

## Requirements
- Linux server, Node.js 22+, Python 3.11+
- Hermes Agent installed in `~/.hermes/hermes-agent` with its gateway (port 8642) and dashboard (port 9119) running
- Optional: n8n, Xvfb + noVNC (the live agent screen), the `gws` CLI for Google, AdsPower

## Setup
1. `git clone` this repo on the server (e.g. `~/apps/aqeelos`).
2. Copy `.env.example` to a file **outside** the repo (e.g. `~/apps/aqeelos.env`) and fill it:
   - `UI_PASSWORD_HASH`: `node app/server.mjs hash 'your password'`
   - `UI_SECRET`: a long random string (`openssl rand -hex 32`)
   - `API_SERVER_KEY` and `HERMES_DASHBOARD_SESSION_TOKEN`: from the engine's `~/.hermes/.env`
   - `PUBLIC_URL`, `N8N_URL`, `LIVE_DOMAIN`, `CODE_HOST`, `OWNER_CONTACT`, branding: your own install's values
3. Start: `node --env-file=$HOME/apps/aqeelos.env app/server.mjs` (put it under tmux/systemd; listens on `UI_PORT`, default 4400).
4. Put a TLS reverse proxy (Traefik, Caddy, nginx) in front of `UI_PORT` for `PUBLIC_URL`.
5. Apply the engine patches once and after every engine update: `node scripts/apply-skill-patches.mjs` (each patch is tagged, all-or-nothing, and skipped with a warning when upstream changed).

## First run
- Open `PUBLIC_URL`, sign in with the password from step 2; the first account is the owner/admin.
- System › Health shows what is missing (engine keys, gateway, screen). It adds the gateway key to agents that lack it.
- Set the engine persona name with `AQEELOS_BRAND_NAME`/`AQEELOS_BRAND_MAKER` or `branding:` in `~/.hermes/config.yaml`.
- Channels › Who can message decides who may write to each agent; Abilities › Connections holds sign-ins.
- Data (users, shares, issues, logs) lives in `UI_DATA_DIR` (default `../hermes-ui-data`); back it up.

## Tests
`node --test scripts/*.test.mjs` (unit tests, no network). End-to-end checks such as `scripts/e2e-check.mjs` need a running install.

## Not in this repository
Owner-private files are listed in `PUBLIC_EXCLUDE` and `.gitignore` (product notes, the development board, mockups, private skills, backups). Never commit an `.env` file; secrets belong in the env file or the engine's secret store.

## License
MIT, see `LICENSE`.

---

## Notes from the reference install
aqeelOS: a new interface for Hermes Agent on the AI VPS, in the Elkiya design. Live at **https://ai.elkiya.com** (password sign-in). It keeps every Hermes dashboard feature in five sections (Chat, Automations, Abilities, Models, System) and replaces the terminal chat with a Claude-style chat.

## How it works
- `app/server.mjs` runs inside the `ai-box` container (Dokploy project **AI VPS**). It serves the UI, handles sign-in, and forwards `/hapi/*` to the Hermes dashboard API (127.0.0.1:9119) and `/gapi/*` to the Hermes gateway API (127.0.0.1:8642). Hermes keys never reach the browser.
- Traefik (Dokploy) routes ai.elkiya.com → container port 4400 with Let's Encrypt.
- `~/services.sh` on the box starts the gateway, the dashboard and this UI in tmux; the container runs it on every start.

## Everyday tasks
| Task | How |
|---|---|
| Deploy changes | `bash scripts/deploy.sh` (from this folder) |
| Check every Hermes feature still answers | `ssh ai-vps 'cd ~/apps/hermes-ui && node --env-file=$HOME/.hermes/.env scripts/parity-check.mjs --chat'` |
| Change the password | `ssh ai-vps` then `node ~/apps/hermes-ui/app/server.mjs hash 'new password'`, put the result in `UI_PASSWORD_HASH=` in `~/apps/hermes-ui.env`, then `tmux kill-session -t ui; ~/services.sh` |
| Sign everyone out | Change `UI_SECRET=` in `~/apps/hermes-ui.env` and restart as above |
| Feature board | https://ai.elkiya.com/backlog (after sign-in) · source `scripts/features.mjs` |
| The approved mockup | https://ai.elkiya.com/mockup |
| The original Hermes dashboard | still runs on the box: `ssh -N -L 9119:127.0.0.1:9119 ai-vps`, then http://localhost:9119 |

## Local development
`node --env-file=<dev.env> app/server.mjs` with `HERMES_DASH`/`HERMES_API` pointing at an SSH tunnel to the box (see `.claude/launch.json`). `dev.env` holds `API_SERVER_KEY`, `HERMES_DASHBOARD_SESSION_TOKEN`, `UI_PASSWORD_HASH`, `UI_SECRET` and `UI_INSECURE_COOKIE=1`; keep it out of this folder.

## Live screen
The box runs a virtual display (`:99`, Xvfb + fluxbox), shared with x11vnc and streamed by noVNC on 127.0.0.1:6080. The app proxies it at `/screen/` behind the login (WebSocket only from this site). Hermes runs its browser headed (`browser.headed: true`) on that display. If the screen is blank, `ssh ai-vps '~/services.sh'` restarts anything missing.

## Network lock
The container starts with firewall rules that refuse new connections from ai-box to private networks (other Dokploy containers), and to the server's own IP. It needs `cap_add: NET_ADMIN` in the compose file; the agent itself runs as `claude` without root and can't change them.
