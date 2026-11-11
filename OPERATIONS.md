# Operations rules

How aqeelOS keeps a server lean and steady as agents are added. Every change to what runs on a server follows these rules. Each rule names the incident that made it a rule, and what enforces it (a test, a check, or "not yet").

Status: agreed 11 Nov 2026. Rules marked **(planned)** are on [BACKLOG.md](BACKLOG.md) and not enforced yet.

## 1. One owner per process, and starting means stop-then-start

Every long-running process belongs to exactly one starter: the agent-users script for agent screens, the box's startup for the engine and the app, the engine for its own children. A starter that starts something again first stops what it started before.

- Never launch with a bare `( … & )` that nothing tracks.
- Each agent's processes run as its own Linux user `ag-<agent>`, which is its group: `aq-agent-users stop <agent>` (or a line in `~/.aqeelos-agent-users.stop`) stops everything that agent started. Kernel groups (cgroups) were ruled out on 11 Nov: the box's cgroup files are read-only and root inside it lacks the right to change that without a privileged box.

*Incident, 10 Nov 2026:* a screen whose socket went missing was restarted every 30 s while the old display still ran. Each restart failed and left a desktop behind: 49 each for continue-support and biomarkers-support, about 9 GB. Fixed in `25fd701` (`screen_kill`).

## 2. Every agent has a budget

- A memory cap per agent, so one leak slows one agent, never the server. The janitor checks each agent's real memory (Pss) every minute: over its cap for 3 minutes, its Chrome starts again; still over, one issue; over twice the cap, its biggest process stops. A soft cap, not a kernel one: a sudden spike can reach the box's limit first.
- A screen and Chrome idle for 30 minutes go to sleep and wake when used. Chrome listens 10000 above the agent's DevTools port; the wake proxy (`scripts/wake-proxy.mjs`, user `aq-wake`) holds the agent's own port, starts a sleeping screen on the first connection and passes traffic through; the screen viewer wakes it too. Tabs come back (restore-last-session), sign-ins stay. A screen running the agent's own AdsPower never sleeps.
- Caps and sleep per agent: `hermes-ui-data/agent-limits.json`, `{"default":{"memory_cap_gb":4,"sleep_minutes":30},"agents":{"<agent>":{...}}}`; 0 turns either off, and `"sleep_minutes":0` puts that agent's Chrome back on its own port (the rollback). Until aqeelOS writes `~/.aqeelos-agent-limits`, both are off. Tested in `scripts/agent-users.test.mjs`, `scripts/wake-proxy.test.mjs`, `scripts/ops-rules.test.mjs`.
- Health shows memory per agent and warns when one keeps growing. **(planned, HEALTH-6)**
- Agent maps (`app/agent-graph.mjs`, 11 Nov): each agent gets a map of its workspace documents and code (`<profile>/graph/`, rebuilt by itself, not backed up) and a `graphify` tool in `mcp_servers` (graphify's MCP server, three tools, added only once the map exists). One agent per 20-minute pass, an agent looked at every 6 h at most, at most 30 changed documents per run, never while it replies. Code is mapped without a model. Documents are read for free through the owner's Google AI plan, never a paid key and never Claude: `app/graph-relay.mjs` is a loopback OpenAI-style relay that lives only during a run (random port, one-run key) and turns each request into one `agy --print` call with a text-only agent and a Gemini model (`gemini-3.8-flash-low`; `DATA/agent-graph/model.json` `{"model":"gemini-..."}` changes it, `{"route":"none"}` turns documents off). The Gemini CLI route is closed by Google ("no longer supported", checked 11 Nov); agy's own default model was out of quota that day, so a model is always named. graphify runs with a bare environment (no keys). If the plan reports its limit, documents wait 6 hours and code is still mapped; without agy or its sign-in, code only. **Pilot first:** only `sesa` (one document, no code on Elkiya; pepclub-social has nothing to map) is mapped until a person turns on the rest (Health › Agents › "Turn on for every agent", or `DATA/agent-graph/enabled.json`), because each mapped agent adds a tool process (about 1 to 1.5 GB in all). Never mapped: dot folders except `.tools`, `.env`, auth, tokens, credentials, sessions, logs, databases, and any file whose text looks like a key. Health shows each agent's always-sent size (SOUL.md + memories, budget 16 KB) and, when over, a proposal to move clearly-reference sections into the map; nothing in the instructions changes until a person accepts (backup first, History keeps the old version). Emergency off: `touch ~/.hermes/.aqeelos-graph-off`. Tested in `scripts/agent-graph.test.mjs`.
- The box as a whole (OPS-17): what counts is the container's own limit (memory.max, 28 GB on Elkiya), not the host's free memory. Over its cap, an agent at work (an engine session running, a reply in aqeelOS, its screen used in the last 5 minutes) is left alone unless it holds three times the cap, and the bigger of its Chrome and its AdsPower is the one started again. Under 15% free, the memory watchdog (`app/memwatch.mjs`, every 2 minutes) sleeps idle screens and closes idle tabs, then starts the biggest idle agent Chrome or AdsPower again (one every 15 minutes, the same one not twice in an hour), then restarts the engine gracefully when it holds 3 GB or more (once in 6 hours); the owner hears once per spell what was done. Requests to the root script go through `~/.aqeelos-agent-users.mem` and are checked again there. The engine's language servers are capped (TypeScript 1.5 GB, Python 1 GB, stopped after 5 idle minutes) and agent Chromes start with `--renderer-process-limit=6 --disable-back-forward-cache`. System › Health shows the box's use, its biggest apps and any app that grew 1 GB and a third in a day. Tested in `scripts/memwatch.test.mjs` and `scripts/agent-users.test.mjs`.

## 3. Restarts back off, then stop and say so

A process that fails is restarted with a growing wait (5 s, 30 s, 2 min, 10 min). After 5 failures within an hour it stays stopped and files **one** issue. It never loops silently.

*Enforced:* agent screens (`restart_gate`) and their Chrome (`chrome_loop`) in `scripts/agent-users.sh`; the issue goes through `~/.aqeelos-agent-issues.jsonl` to `app/box-ops.mjs`. A given-up screen starts again after `echo <agent> >> ~/.aqeelos-agent-users.reset`. Tested in `scripts/agent-users.test.mjs` and `scripts/ops-rules.test.mjs`.

*Incidents:* the screen loop above; schedules that fail on every run (Threads runners, 10–11 Nov).

## 4. Expected equals running

A janitor compares, every minute, what should run for each agent with what does run. Anything extra is reported, then removed. Health shows it in one line ("47 expected, 47 running").

*Enforced:* the `janitor` in `scripts/agent-users.sh` (agent screens: one display, window manager, desktop, panel and Chrome each), written to `~/.aqeelos-janitor.json` and shown under System › Per agent with each agent's memory. Missing is put right too (OPS-13): a window manager, desktop background or panel gone from a running display for 10 minutes gets the desktop alone started again (display and Chrome keep running), through `restart_gate`, never while the agent replies or used its screen in the last 5 minutes. The engine's and the app's own processes are not counted yet.

## 5. Only git reaches a server

- Code on a server is exactly a commit on GitHub main. Deploys refuse anything else (`scripts/deploy.sh`, since 9 Nov).
- The fixer never edits live code. It commits its fix and the normal deploy ships it. **(planned, GIT-2)**
- Engine fixes live in `engine/patches/<date>-<what>.patch`; `scripts/apply-skill-patches.mjs` puts them back after every engine update.
- Settings are data (`kirimdev.json`, team policy), never code. A business rule is a per-line setting.

*Incident, 7–11 Nov:* 11 fixer patches existed only on servers, and deploys put the old files back. Some fixes were lost twice and queued to be redone a third time. Taken into git in `4f7243a`.

## 6. Checks give the same answer every time

- A check that can block a deploy must be deterministic.
- A check that depends on a model's choices (the my-browser check) reports but does not block. **(planned, OPS-6)**
- A failed check gets one retry before it counts. **(planned, OPS-6)**

*Incident, 10 Nov:* deploys failed six times on random misses, and every check passed when run alone.

## 7. Everything temporary expires

Logs rotate. Fixer patches, drift saves, test users and old backups are removed after 30 days.

*Enforced:* `app/box-ops.mjs` once a day (fixer patches and work, drift, `*.bak-*` copies, `~/backups`, `*.broken-*` Python environments, deploy files in /tmp, engine logs over 50 MB cut to 5 MB, gone test agents off the list); `trim_logs` in `scripts/agent-users.sh` for screen logs; `dropLeftovers` in `app/backup.mjs` for backups cut off by a restart (55ec552).

*Incident, 11 Nov 2026:* seven backups cut off by deploys each left a 26 GB file in /tmp; Elkiya's disk reached 99% (5.7 GB free). Removed with the owner's yes; the backup now removes them on start.

## 8. The rules are tested

Tests fail when new code breaks a rule: for example, a screen or process launch that bypasses the shared starter, or a check marked blocking that calls a model.

*Enforced:* `scripts/ops-rules.test.mjs` (rules 1, 3, 4, 7). Rule 6's check (a blocking check that calls a model) comes with OPS-6.
