---
name: aqeelos-platform-changes
description: Use when fixing or auditing aqeelOS itself. Fix the root cause as a general feature any install can use, never hard-code names, numbers or people, and prove it live.
---

# Changing aqeelOS itself

aqeelOS is open source. Every change must work for a stranger who clones the repo, not only for this install.

This install's values (owner, chat ids, server paths, which agent is the main agent) are in
`references/local.md` next to this skill (kept on this server, never shared). Read it first when present.
Example (fake values):

```
- Owner: Alex (owner id in the app settings). Team reports come in the "Acme support" group.
- App folder: /srv/app   Env file: /srv/app.env   Engine config: <engine home>/config.yaml
- Main agent: "lead". Restarts only through apply_changes.
```

## Main-agent rule

When another agent has a problem, do not do that agent's work for it. Give it the missing tool, access or
setting so it can fix itself, then tell it in its own topic what it now has and that the fix is its job.
Fix directly only platform code no agent can reach. If the agent already had everything, say so and point the
reporter to the agent. Every report that reaches the main agent is a gap: make the agent able to handle it
next time.

## Agent model

- **Root cause first.** Before building, state the core problem in one paragraph and get the owner's
  agreement. Symptoms (a missing link, "no key", cannot self-fix) usually share one cause.
- **Standard set for every agent, including future ones:** all universal skills, connectors and tools on every
  channel, but vanilla (no owner logins). Per-channel limits are explicit exclude lists, never allow lists:
  naming one tool group in an allow list silently drops everything unnamed.
- **Self-repair:** each agent can read its own logs, runs, health and delivery status, edit its own
  instructions, skills, schedules and settings (versioned, auto-rollback on failure), re-test itself and
  reconnect its connectors. Out-of-scope problems go to the issues queue; the owner hears only if that fails.
- **One main agent** changes platform code, shared skills, other agents, keys, permissions, money and
  deletions. Enforce it on the server, not in prompt text.
- **Lead agent power equals its person's role, never more.** Reuse the existing people roles; do not invent a
  second permission system. Check the role on the server on every privileged tool.
- **Agents are shareable resources** at the same Owner / Manager / Editor / Viewer / No access levels as
  everything else. Nobody grants above their own level. Keys stay hidden at every level.
- Every session gets a short capability list generated from real config, so agents stop guessing from history.

## Always-on rules

1. **Proper fix first.** Name the real fix before any workaround. Label workarounds TEMPORARY with the real fix
   beside them. Never stack patches on a shortcut silently.
2. **No hard-coding.** No user ids, chat or topic ids, phone numbers, paths, brands or domains in code or
   prompts. They become settings or setup steps; one install's values live only in its config or env.
3. **Every fix is a visible feature** (setting, skill, schedule, connection, tool) addable to any agent,
   marked standard or optional.
4. **One home per thing.** An API plus its webhook is one integration entry, not three.
5. **Share, never copy.** A resource has one owner and is shared at a level, enforced on the server,
   revocable. A hand-copied token is a full login with no level: treat it as a bug.
6. **Confirmed side effects only.** Sent, posted or paid needs a provider id. An agent saying "done" is not
   proof. Failures alert the owner.
7. **Skills are universal.** Generic text, install specifics from settings or local.md.

## Procedure

1. Inspect the live server first: files, schedules per profile, processes, logs. Check recent edits
   (`find -newermt`) so you do not overwrite another session's work.
2. Check whether it already exists before building. Verify it live instead of rebuilding.
3. Back up, change, test, restart only through the app's apply step, re-test the affected agents.
4. Risky changes go to staging first. Never run a second copy of bots, schedules or polling there.
5. Long unattended work: a plan file with a PROGRESS log and a repeating self-trigger that resumes from it.
   Put the owner's main fixes first and forbid side cleanups until they are done. One final report: done with
   proof, or not done with why.
6. Big jobs: one sub-agent per item with full context, verify each claim on the server yourself, re-dispatch
   interrupted ones.
7. "Make sure nothing is left": walk the conversation item by item, check each against the live server, list
   leftovers. After any migration, look for the old mechanism still running beside the new one.
8. Questions the team asks agents are answered by looking them up first (the service API, the agent's data,
   past chats). Only true business decisions go to people, with what was checked.

## Open-source release

- One repo, one main branch: what is shared is what is deployed. Copy live-only edits into it, then verify a
  fresh clone diffs clean against the live app (only exclusions and repo-only files differ).
- Before going public: backup, scan tree and history for secrets and personal data, remove them from
  history, tests pass, deploy works from a fresh clone. If a check fails, stay private and report.
- Parallel workstreams: give each stream file ownership; shared files are re-read then small edits only; one
  stream owns restarts, the others write "RESTART NEEDED" in PROGRESS.

## Briefs for a coding app

Say "any coding app". Per issue: source, problem, desired outcome. Rules on top, a short "must keep working"
list. Require pasted proof from the server, then verify it yourself.

## Pitfalls

- "Fixed everything" must cover every place the team reports problems. Prompt-only fixes for sending bugs are
  not fixes: enforce them in the sending code.
- Scheduled and sandboxed runs see a different HOME. Resolve the real home from the user database
  (`os.userInfo().homedir` in Node), never from `$HOME` or a hard-coded path.
- Restarting the engine kills running sub-agents. During long builds use the restart hold (its `until` is epoch
  milliseconds; a string silently disables it) and confirm the "restart held" log line. Restart once at the end.
- Moving a shell loop to a schedule drops its lock and stop files. Recreate them as schedule features.
- After any restart, run one real agent turn to prove agents still work.
- Settings that re-apply every few minutes mean writes fail but are counted as applied. Count only confirmed
  writes; a second pass must apply 0.
- Before reporting "live", diff the live app against the repo. Live can lag the repo while tests pass.
- Process counts hide duplicates. List PIDs: duplicate pollers send double replies.
- Send guards must match the specific promise, not a keyword. Add a test for the false-positive case.
- When the app holds or changes a reply, tell the agent what was held, the rule and what was sent. Agents
  invent causes when they cannot see what happened.
- Delete agents through the app, not the engine CLI: the CLI skips the app's cleanup.
- Human checks (captchas): never build a bypass. Pause, alert the owner, resume after they take over.
- Group topics are separate sessions. Fix access with config-derived capability lists, not prompt text.
- Mark throwaway test agents as test agents as soon as they exist, and never mark a real agent as one.
