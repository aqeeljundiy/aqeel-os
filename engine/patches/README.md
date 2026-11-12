Engine (Hermes Agent) changes made on the reference install on 6 Nov 2026: per-chat SSH ControlMaster sockets (tools/environments/ssh.py), configurable
persona branding (hermes_cli/branding.py, used by default_soul.py and prompt_builder.py), turn_finalizer fallback
notice, and matching tests. Verified then with the engine's pytest: 180 passed, 0 related failures. Step 16 of
`scripts/apply-skill-patches.mjs` still copies `branding.py` to `hermes_cli/`; the patch itself is retired (below).

## Retired: 2026-11-06-tonight.patch (12 Nov 2026, now `retired/`)

Every deploy printed `! MISFIT 2026-11-06-tonight.patch` in the engine update check. Checked read-only on both live engines
(same commit bf0203a794, v0.22.5): the patch reverse-applies on each live engine (in place) and applies cleanly to the bare
commit (`git apply --cached --check`), but never inside a run of the steps: step 8 (the engine wording rename) and the
prompt_builder and turn_finalizer steps rewrite its context lines before step 16, so on a clean update it always failed and
changed nothing. Its content reaches a clean engine through `2026-11-11-engine-hand-edits.patch` (step 17b), whose base is
exactly "clean engine plus the steps without this patch"; the engine update check passing with the MISFIT showing proves the
update copy equals the live engine without it. So the git apply was a no-op on every path: step 16 now only copies
branding.py. The file is kept in `retired/` for the record; step 17b reads only this folder's own `*.patch` files.

## Retired: step 5 "port-reuse" (12 Nov 2026)

`plugins/platforms/whatsapp/bridge_ownership.py` `port_is_free` sets `SO_REUSEADDR` itself upstream (engine commits
155588754a "reuse bridge ports after restart", 1848982075 "POSIX-only reuse in the probe", 7d9f04469b docs), in both live
engines. Our text replacement no longer matched the new code, so every deploy printed `MISFIT port-reuse` and the go-live
step ended with exit 3 ("! skill patches: see the message above (exit 3)" on P&P). The step is removed.

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
- `2026-11-06-tonight.patch` no longer fit a clean engine of this version, so step 16 warned "6 Nov patch does not fit" until
  12 Nov, when its git apply was retired (see "Retired" above). Keep branding.py here (step 16 still copies it).
- Since 11 Nov this runs in every deploy check (ENG-3): `scripts/engine-sim.sh` makes two throwaway copies under /tmp
  (a clean update of the live engine's commit, and the live engine itself), runs every patch step on both with HOME
  pointed at each copy, and fails the deploy with the names of the files that differ. Allowed differences are listed in
  `known-differences.txt` (today only gateway/platforms/webhook.py). To look at one by hand on the box:
  `ENGINE_SIM_KEEP=1 bash ~/apps/hermes-ui/scripts/engine-sim.sh`, then diff the two copies it names.
- Proof (11 Nov): on Elkiya, a simulated update plus these patches gives every file exactly as live; both live engines
  already have both patches (git apply --reverse --check), except the Telegram digest on P&P.

## Layered patches (12 Nov 2026)

A later patch can change lines an earlier one added (`2026-11-12-delivery-probe-document` on `2026-11-11-delivery-probe`). Then the earlier one fails `git apply --reverse --check` on the live files although it is in place, and every deploy warned "does not fit this engine version". Step 17b (`scripts/engine-patch-layers.mjs`) now decides for the whole ordered list: on a scratch copy of only the files the patches touch it reverse-applies from the newest down, and a patch that reverses is in place. The rest are applied oldest first; one that cannot be applied still warns. Test: `scripts/engine-patch-layers.test.mjs`. `engine-sim.sh` runs the same script, so the engine update check agrees.

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

## 2026-11-12-channel-resume-continue.patch (applied by step 17b)

A Telegram or WhatsApp chat whose turn a restart cut off (a deploy, the nightly update, a crash) was picked up by the engine's
own boot recovery (`gateway/run_startup.py` `_schedule_resume_pending_sessions`, the chat's `resume_pending` mark; a reply that
was already stored is delivered, not regenerated) but with the interactive wording of `build_resume_recovery_note`: "report that the
session was restored and ask what they would like to do next". The patch adds `agent.gateway_resume_continue` (default false,
bridged to `HERMES_RESUME_CONTINUE`; files `gateway/run.py`, `gateway/run_turn_runner.py`, `hermes_cli/config_defaults.py`, marked
`aqeelos:channel-resume-continue`). When it is true the note instead says: you were interrupted by a restart at HH:MM (the mark's
time, in the engine's timezone); continue the person's last request in this chat; check what already went out before repeating it;
never send the same thing twice; no "session restored", no "what next?". Real text from the person while the mark is pending still
wins (the note then only wraps their message, as before). Nothing else changes: once only (the mark is cleared after a successful
turn), the engine's own restart-loop breaker, and `agent.gateway_auto_continue_freshness` as the age limit.
aqeelOS switches the flag on for every agent and sets the freshness to the install's `resumeMaxHours` (`app/agent-defaults.mjs`), and
watches the marks (`app/resume.mjs` kind `channel`, read from `gateway_routing` in each agent's state.db) to count them on Health.
Checked 12 Nov on both live engines (same commit bf0203a, same md5 for the three files on Elkiya and P&P): `git apply --check` clean
on each live engine and on a clean checkout of that commit with the Telegram digest patch applied before it.

## 2026-11-12-delivery-probe-document.patch (issue i19b649d9, applied by step 17b)

The delivery probe (`scripts/whatsapp-bridge/probe_watch.js`, 11 Nov patch) only downloaded pictures. A document probe now
downloads the file too and counts as arrived only when it starts with `%PDF` (`ok`, `bytes`, `type: document` in
`<session>/../probes/<id>.json`). aqeelOS uses it to prove that the protocol PDF path works end to end:
`node scripts/delivery-check.mjs <agent> --document`. Applies on top of the 11 Nov probe patch; takes effect after the engine's
WhatsApp bridge restarts.

## 2026-11-12-delivery-probe-document-caption.patch (applied by step 17b)

First live document check (12 Nov, Elkiya): Kirimdev said "delivered" but the bridge recorded nothing. WhatsApp wraps a document
that has a caption in `documentWithCaptionMessage`, and `probe_watch.js` looked only at the plain `documentMessage`, so it never
saw the `aqeelos-probe:` mark (the message even went on to the agent). `inner()` now unwraps it. Applies on top of the
`delivery-probe-document` patch; takes effect after the engine's WhatsApp bridge restarts.

## 2026-11-12-route-order.patch (route order, applied by step 17b)

A run asked for one model stayed on its vendor only by accident: the fallback list fired on the first failed call, whatever it was
(Elkiya, 9 to 12 Nov: 9 of 34 fixer runs that asked for Claude ran on GPT or Gemini, about $15.77; 241 chat and schedule replies on a
fallback; P&P pixel-agent: 483 switches to Gemini on an engine ValueError). The patch adds `agent/aqeelos_route.py` (pure, no engine
imports) and one hook in `try_activate_fallback` (`agent/chat_completion_helpers.py`); the two callers that know the error text
(`turn_api_error.py`, `turn_recovery.py`) pass it as `message=`. The order:

1. a different vendor is only tried when the ACCOUNT failed (billing, used up, signed out, refused). A timeout, an overload, an engine
   error, or the relay's "Server is temporarily limiting requests (not your usage limit)" 429 (classified as billing) never moves the run;
2. not while another signed-in account of the agent's pool has room for the same model: the app (accounts.mjs poolRoom, backup-models.mjs)
   moves the agent there. The app says so in `<home>/aqeelos-route.json` (written every 5 minutes; the engine ignores one older than 15);
3. a background run (fixer `AQEELOS_FIXER=1`, schedule `platform=cron`) waits when the provider's reset is within `waitMinutes`;
4. then the owner's explicit list (`fallback_providers`, written from Models › If an account fails), in its order; else the run stops and
   the reply says why.

Every switch and every refusal is a line in `<home>/logs/route-switches.jsonl` (asked model, actual model, reason, step, kind chat /
schedule / fixer). The app reads them (backup-models.mjs) for Health (System › Health › Tools and schedules, the fixer card), Usage
(Model switches) and one Health item when an agent has been answering on a fallback for `route.fallbackHours` (default 3). Settings, in
`team-policy.json`: `route.waitMinutes` (default 15, 0 = never wait) and `route.fallbackHours`. Tests: `tests/agent/test_aqeelos_route.py`
(12 cases, run on Elkiya's Python in memory: 12 passed) and `scripts/route-order.test.mjs`. Not covered: auxiliary calls (title
generation) still walk `fallback_providers` in `agent/auxiliary_client.py`.
