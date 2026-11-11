Engine (Hermes Agent) changes made on the reference install on 6 Nov 2026 that `scripts/apply-skill-patches.mjs` (step 16) now applies on install and after engine updates: per-chat SSH ControlMaster sockets (tools/environments/ssh.py), configurable
persona branding (hermes_cli/branding.py, used by default_soul.py and prompt_builder.py), turn_finalizer fallback
notice, and matching tests. Apply to a Hermes Agent checkout with `git apply 2026-11-06-tonight.patch` and copy
`branding.py` to `hermes_cli/`. Verified with the engine's pytest: 180 passed, 0 related failures.

## 2026-11-06-shared-skills.patch (applied by step 17)

Skills for everyone. Every agent also reads the main profile's `skills/` folder (installed once) as its
lowest-precedence tier. Which shared skills an agent may see is data: `<HERMES_HOME>/skills-scope.json`

```json
{"skills": {"productivity/my-private-skill": ["default"], "creative/brand-kit": ["default", "shop-agent"]}}
```

Listed skills are visible only to the listed agents; unlisted skills are universal. No scope file = no shared
tier (fails closed, nothing private leaks). An agent's own copy always wins over the shared one, and
`skill_manage` on a shared skill first copies it into the agent's own `skills/` (copy-on-write), so the shared
skill is never changed by another agent. `skills.shared: false` in an agent's config turns the tier off.
Tests: `tests/agent/test_shared_skills.py`.

## 2026-11-11: what the live engines had beyond these patches (applied by step 17b)

Found by simulating an engine update on a clean copy (the live engine's commit, then every step of
`scripts/apply-skill-patches.mjs`) and comparing with the live engines on Elkiya and P&P.

- `2026-11-11-engine-hand-edits.patch` (19 files): edits made by hand on the live engines that no step re-applied, so
  the next engine update would have dropped them. Every channel grant listed and revocable (gateway/pairing.py), a silent
  pairing request for strangers and no second transcription of a voice note (gateway/run_inbound.py), Telegram retrying a
  stale session instead of giving up (adapter.py), titled sessions resumed with their launch flags, schedules not wrapping
  replies (wrap_response false), shared-skills guards in file_sync.py and credential_files.py, the WhatsApp bridge's
  group_watch.js and inbox_log.js add-ons, and the content of `2026-11-06-tonight.patch` (per-chat SSH sockets, persona
  branding, the fallback-notice setting).
- `2026-11-11-telegram-cross-topic-digest.patch` (3 files): Elkiya's Telegram cross-topic digest. P&P gets it at its
  next update step.
- `2026-11-06-tonight.patch` no longer fits a clean engine of this version, so step 16 warns "6 Nov patch does not fit".
  That is expected now: its content is in the hand-edits patch above. Keep branding.py here (step 16 still copies it).
- Proof (11 Nov): on Elkiya, a simulated update plus these patches gives every file exactly as live; both live engines
  already have both patches (git apply --reverse --check), except the Telegram digest on P&P.
