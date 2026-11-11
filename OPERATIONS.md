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

## 3. Restarts back off, then stop and say so

A process that fails is restarted with a growing wait (5 s, 30 s, 2 min, 10 min). After 5 failures within an hour it stays stopped and files **one** issue. It never loops silently.

*Enforced:* agent screens (`restart_gate`) and their Chrome (`chrome_loop`) in `scripts/agent-users.sh`; the issue goes through `~/.aqeelos-agent-issues.jsonl` to `app/box-ops.mjs`. A given-up screen starts again after `echo <agent> >> ~/.aqeelos-agent-users.reset`. Tested in `scripts/agent-users.test.mjs` and `scripts/ops-rules.test.mjs`.

*Incidents:* the screen loop above; schedules that fail on every run (Threads runners, 10–11 Nov).

## 4. Expected equals running

A janitor compares, every minute, what should run for each agent with what does run. Anything extra is reported, then removed. Health shows it in one line ("47 expected, 47 running").

*Enforced:* the `janitor` in `scripts/agent-users.sh` (agent screens: one display, window manager, desktop, panel and Chrome each), written to `~/.aqeelos-janitor.json` and shown under System › Per agent with each agent's memory. The engine's and the app's own processes are not counted yet.

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
