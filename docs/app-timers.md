# Timers inside the app

Written 12 Nov 2026 from the audit of background load (finding 10). About 85 `setInterval` loops run in `app/`. Most are cheap (a stat, a counter, a heartbeat). This page lists the ones that cost something, why each exists, what it became, and what was left alone on purpose.

## How the changed loops work now

`app/reconcile.mjs` holds one reconciler. A task is the old loop body, unchanged. It runs:

1. **At start** (first pass 60 s after the app starts, tasks one after the other, 1.5 s apart).
2. **When what it reads changed.** Once a minute one pass takes a fingerprint of every agent's home (stat times only, no file contents, no process): `config.yaml`, the `plugins/` and `skills/` folders, `mcp-tokens/`, the home folder's own time, and a hash of what each schedule *is* in `cron/jobs.json` (the engine rewrites that file at every run, so its time is ignored; it is parsed again only when its time or size moves). Each task names the parts it reads, plus any files of its own. A task whose fingerprint equals the one taken after its last run is skipped.
3. **When an event asks.** `rec.trigger()` runs a task (or all) within a second. Wired now: an agent made or set up (`accountHooks.afterSetup`). A settings save moves `install.json`, which is in every fingerprint.
4. **As a safety sweep** that ignores fingerprints: every 4 hours by default, every hour for tasks that call the network or start processes (a failure there is not seen by a stat).
5. **After a failure**, 10 minutes later (before, the next 10-minute tick did this by itself).

A task's own writes do not start it again: the fingerprint is taken after the work. A trigger that arrives during a pass is kept for one more pass.

Per agent: the agent-defaults pass also skips an agent whose own inputs (settings, home folder time, install settings, users, skills policy) did not move since that agent's last successful pass (`createAgentGate`); a failed agent is never recorded, so it is tried again. The sweep and the start pass clear the memory and do everything.

## Counters

Every changed loop, plus the agent context and change-watch loops, is counted: runs (work done), skipped (looked, nothing changed), time spent, errors. They show on System > Health > Efficiency under "Background work". A loop that should be quiet and shows a growing "Ran" count is a regression.

## The table

Cost: P = starts a process, F = reads files of every agent, N = network call.

| Loop | Was | Cost | Why it exists | Now |
|---|---|---|---|---|
| Agent defaults (`applyDefaults`) | 10 min | F, P (settings writes, `ensure` per agent) | Agents made outside the app, or an engine update, reset settings | Task `agent defaults`: reads settings + home time + users; per-agent skip; sweep 4 h |
| Skills copy (`defaultsTick`) | 60 s | F (walks every skill folder of every agent) | A new skill of the main agent must reach all agents | Still a 60 s check, but it compares stat times of skill folders and the policy file first and walks only when one moved; the sweep forces a copy. Counted as "skills copy (every minute)" |
| New agents (`defaultsTick`) | 60 s | one directory listing | Agents made any way get the defaults once, after 5 minutes | Kept at 60 s (cheap, and the 5-minute wait needs a clock) |
| aqeelos-live plugin | 10 min | F | The engine plugin must be in every home | Task, reads settings + plugins; sweep 4 h |
| billion-context | 10 min | F | Same, for the context folding plugin | Task, reads settings + plugins |
| Efficient defaults | 10 min | F | Chat shortening and cache settings must stay on | Task, reads settings |
| Run gates | 10 min | F | Every schedule that starts the AI needs its gate script | Task, reads schedules + settings + the off marker; sweep 1 h |
| Rule conflicts | 10 min | F | Schedules that disagree are raised | Task, reads schedules + `posting-limits.json` |
| Graphify | 10 min | F, P (`pip`) | Shared Python package and the skill in every agent | Task, reads skills + settings; sweep 1 h |
| n8n users | 10 min | N, F | Each agent gets an n8n user once n8n is connected | Task, reads settings + `n8n.json`; sweep 1 h |
| Notify tool | 10 min | F, N (engine MCP call when missing) | Every agent needs the aqeelOS tools server | Task, reads settings; sweep 1 h |
| Connectors, sign-ins | 10 min | F | Tool catalog copies and the sign-in list | Task, reads settings + sign-in files; sweep 1 h |
| Tool lists | 10 min | N (one HTTP call per agent) | The engine reads a tool list once; a changed list needs a reload | Task, reads settings; sweep 1 h (an app restart, which is what changes the lists, runs it at start) |
| Skill change snapshots | 10 min | P (`git add`, `git diff` per agent) | An agent's own skill edits become versions with undo | Task, reads skill files (one level deeper, so an edited `SKILL.md` counts); sweep 1 h |
| Schedule descriptions | 10 min | N (a helper model for new or changed jobs) | Plain-language description of each schedule | Task, reads schedules; sweep 1 h |
| Agent care | 2 min | F | Turns "run this and repeat it" prompts into script-only jobs, checks script files | Task, reads schedules + settings + its policy files; sweep 30 min |
| Resume check | 30 s | **P: two Python processes** (every agent's run ledger and chat records) | Finds what a restart or update interrupted | Python starts only when the engine's run ledger (or its write-ahead log) moved, the engine's process changed, something is waiting to continue, or 5 minutes passed. The fixer's records are read in-process every time |

## Left alone, and why

- **Agent context** (`writeAgentContext`, 10 min). Its output depends on about ten live sources (people, conflicts, questions, channels, Google accounts, connections). It reads and writes only on change; no process is started apart from a settings write when the chat hint is wrong. A fingerprint of all those would be wrong more often than it saves. Counted, so it can be revisited.
- **Agent health pass** (5 min), **health tick** (5 min), **paid labels** (60 s), **Kirimdev** timers, **gateway watch**, **memory watchers**, **screen follow** (5 s `ps`), **AdsPower watch** (60 s process scan) and its 10-minute tools/skill rewrite, **connected accounts** (2 min), **log readers**. These need a different trigger (a provider callback, a process exit, a shared sampler) and belong to other changes: the audit lists them in section 2 rows 1, 5-10. Not touched here.
- **Change watch** (`versions.watchTick`, 60 s): counted only; it checks pings after an agent changed itself and returns at once when nothing is pending.
- **Heartbeats, idle reapers, 10-second pid read, timezone re-read**: a stat or a file read; not worth a trigger.
- Hand edits to an agent's home while the app runs are seen within a minute by the fingerprint, not by a file watcher: a watcher per home would hold many inotify handles, and `fs.watch` recursive is not dependable on Linux.

## What the fingerprint cannot see

Changes inside a skill's subfolders (below `SKILL.md` level) or in files other than the ones listed. Those heal at the next sweep (1 or 4 hours).
