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
- Since 11 Nov this runs in every deploy check (ENG-3): `scripts/engine-sim.sh` makes two throwaway copies under /tmp
  (a clean update of the live engine's commit, and the live engine itself), runs every patch step on both with HOME
  pointed at each copy, and fails the deploy with the names of the files that differ. Allowed differences are listed in
  `known-differences.txt` (today only gateway/platforms/webhook.py). To look at one by hand on the box:
  `ENGINE_SIM_KEEP=1 bash ~/apps/hermes-ui/scripts/engine-sim.sh`, then diff the two copies it names.
- Proof (11 Nov): on Elkiya, a simulated update plus these patches gives every file exactly as live; both live engines
  already have both patches (git apply --reverse --check), except the Telegram digest on P&P.

## 2026-11-11-harness-idle-stop.patch (OPS-16, applied by step 17b)

The browser helpers of `browser_exec` (`python -m browser_harness.daemon`, one per named browser session) never exit by
themselves, not even when their Chrome closes under them, and the engine stopped them only at a profile's cleanup or at
exit when an agent-browser session was still open. A long-lived gateway therefore left about one per agent per day
(Elkiya, 10 Nov: 35 of ~45 MB, every one's Chrome long gone). The patch (tools/browser_use_cli.py,
tools/browser_tool_lifecycle.py, marked `aqeelos:harness-idle-stop`):

- the browser cleanup thread stops a daemon after 30 minutes without a call (`HARNESS_DAEMON_IDLE_S`, or
  `BROWSER_INACTIVITY_TIMEOUT` when longer), never one with a call running; the next call starts one again;
- `browser_exec` starts that cleanup thread (a CDP override or cloud browser never did);
- at exit the daemons are stopped even when no agent-browser session is left.

Tests (11 Nov, on a clean worktree of the Elkiya engine with the patch): the engine's browser tests that touch these
functions, 200 passed, 1 skipped; plus a check of the idle rule. Daemons of a process that died first are stopped by the
root script's janitor (`harness_sweep` in scripts/agent-users.sh). It takes effect after the engine restarts.

## 2026-11-12-mcp-oauth-no-retry.patch (OPS-18, applied by step 17b)

A tool server that signs in with OAuth and has no sign-in on disk (Slack on Elkiya, nobody ever signed in) was tried again by
every discovery pass of a gateway that cannot ask a person: "MCP OAuth setup failed ... non-interactive environment and no
cached tokens", one WARNING every five minutes, 295 errors in 24 hours. `tools/mcp_tool_discovery.py` now skips such a server
(`_oauth_signin_pending`) until its tokens file exists; signing in writes it and the next pass connects. A gateway with the
dashboard's sign-in flow, or a terminal, keeps the normal path. The same file is on both live engines (same md5), and the patch
applies to it cleanly; it takes effect after the engine restarts. aqeelOS still shows the missing sign-in as one Health item.

## Telegram over IPv4 (OPS-18): no patch, the engine's own setting

`network.force_ipv4: true` in config.yaml (engine default false; `hermes_constants.apply_ipv4_preference` makes name lookups
answer IPv4 first, read when the gateway starts) is what the engine offers for a box whose IPv6 has no route (Elkiya:
`curl -4 https://api.telegram.org/` answers in 0.7 s, `curl -6` cannot connect; about 100 Telegram warnings an hour from the
dual-stack path). aqeelOS writes it itself: `app/net-prefer.mjs` probes a real connection to api.telegram.org:443 over IPv4 and
over IPv6, and `app/agent-defaults.mjs` sets the key for every agent when only IPv6 fails (engine restarts in the quiet hours).
