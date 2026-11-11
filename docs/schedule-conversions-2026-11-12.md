# Schedule conversions, 12 Nov 2026

Prepared, not applied. Nothing on Elkiya (`ai-vps`) or P&P (`pnp-box`) was changed: every server step below was read-only (file reads, run records, a Google Sheets read, a dry run of one script with `--dry`). Nothing is merged or deployed. All code is on branch `w-sweep`.
Source of the findings: `scratchpad/audit-design.md`. Numbers are from the engine's run records (`cron/usage_audit.jsonl`, last 2 days on Elkiya, last 7 on P&P) unless marked "estimate". No message text, customer data or keys are quoted.

## What is in the branch

| Piece | Files | Tests |
|---|---|---|
| (h) Provider "paid" callbacks: `POST /hooks/pay/tripay/<agent>`, `POST /hooks/pay/xendit/<agent>`; a callback only wakes the check, the provider's own API still says "paid"; the minute poll slows to 10 min per agent once a verified callback was seen | `app/payment-callbacks.mjs`, `app/paid-labels.mjs` (`nudge`, `callbackActive`), `app/server.mjs` | `scripts/payment-callbacks.test.mjs` (7) |
| A command check in front of the model: `run-check.mjs --cmd "<cmd>"` (run here) and `--agent-cmd "<cmd>"` (run as the agent's own user in its folder), `--cmd-once` (the same output twice is not work twice) | `app/run-checks.mjs`, `scripts/run-check.mjs` | `scripts/run-checks.test.mjs` (+4) |
| "A schedule finished" as an event, and chains: event rules with `after` / `ok` | `app/schedule-finish.mjs`, `app/event-runs.mjs`, `app/server.mjs` | `scripts/schedule-finish.test.mjs` (3) |
| `events-wire.mjs` gets `--check-only`, `--after`, `--keep-schedule`, `--undo` | `scripts/events-wire.mjs` | dry-run and apply/undo exercised by hand |
| Close stage due check (reads `AI RUN STATUS`), sheet fingerprint | `scripts/close-stage-due.mjs`, `scripts/sheet-fingerprint.mjs` | 4 + 2 tests; both also run read-only against the real sheets (below) |
| Script-only conversion with undo | `scripts/job-script-wire.mjs` | `scripts/job-script-wire.test.mjs` (3, against a fake engine) |
| Rules digest for the Threads runners | `scripts/threads-digest.mjs` | `scripts/threads-digest.test.mjs` (7); also run on the real files (copied locally, nothing printed) |
| A script can ask the posting limits and record a post: `GET /posting-gate/<agent>/<sig>?json=1`, `POST /posting-record/<agent>/<sig>` | `app/posting-limits.mjs` (`allowNow`), `app/server.mjs` | `scripts/posting-limits.test.mjs` (+1) |
| Prototypes, not run on a box: 4AM nudges, P&P check-in change probe, the Threads comment queue, new run prompts | `scripts/box-checks/*.py`, `docs/schedule-conversions-2026-11-12/threads/queue_post.py`, `.../prompts/*` | syntax-checked on the boxes; `wakeup-nudge.py --dry` run once (read-only) |

`node --test scripts/*.test.mjs` on this Windows machine has 135 failures before and the same 135 after (the boxes' Python/bash dependencies), so nothing regressed; all tests above pass.

Common setup for every command below (on the box, as the app user):

```
R=~/apps/hermes-ui; D=~/apps/hermes-ui-data     # R must be at a main that contains w-sweep
export HERMES_DASH=http://127.0.0.1:9119
N="node --env-file=$HOME/.hermes/.env"           # puts HERMES_DASHBOARD_SESSION_TOKEN in the environment
# set or restore a prompt (used by items a, b):
setprompt(){ $N -e 'const fs=require("fs");const [a,j,f]=process.argv.slice(1);fetch(process.env.HERMES_DASH+"/api/cron/jobs/"+j+"?profile="+a,{method:"PUT",headers:{"x-hermes-session-token":process.env.HERMES_DASHBOARD_SESSION_TOKEN,"content-type":"application/json"},body:JSON.stringify({updates:{prompt:fs.readFileSync(f,"utf8")}})}).then(r=>console.log(r.status))' "$@"; }
P=$R/docs/schedule-conversions-2026-11-12/prompts
# pause / resume a schedule: POST $HERMES_DASH/api/cron/jobs/<id>/pause|resume?profile=<agent> with the x-hermes-session-token header
```

## Totals

| | Starts a day now | After | Saved |
|---|---|---|---|
| a. Threads rules digest | about 290 (4 runners; the outbound runner is hourly since 11 Nov) | about 290 | 0 starts; tokens per run roughly 5 times fewer (estimate) |
| b. Threads comment queue | 122 | 24 | 98 |
| c. P&P meeting watcher | 16 (22 on a weekday) | about 2 | 14-20 |
| d. Master To Do sync | 11 on a weekday | 3-4 (0-1 with a Notion token) | 7-11 |
| e. Close 2/3 + 3/3, P&P check-in | 2 on days 1-10, and 6 | about 0, and 2-3 | 2 on 10 days a month, and 3-4 |
| f. 4AM wake-up, invoice reminder | 1, and 2 a month | 0 | 1 |
| g. Feed job, watchdogs, away reply | 0 (script runs only) | 0 | 0 starts; feed job 720 script runs a day removed |
| h. Payment callbacks | 0 | 0 | none; payment known in seconds, provider asked 6 times less |
| **Total** | | | **about 125-135 AI starts a day** (not counting item a's tokens) |

These come on top of tonight's gates and the recap hooks. Another large part of the 290 Threads starts (the replies runner, 129 a day) depends on the unread-DM check and Tebar, which this work does not change.

---

## a. Continue Threads runners re-read the rules every run

**Now.** Four runners (replies 7ab01824ed01, comments 198bc372ee48, outbound DMs 2ea603717676, own posts 738e7a2cea4f) start with "STEP 0 READ" of three files (the comment runner a fourth). Measured: 129, 122, 88 and 7 runs a day, 477k, 602k, 469k and 824k tokens a run, 3.6 to 5.6 minutes.
The files, in `/home/claude/workspaces/continue-threads`:

| File | Size | What it really is |
|---|---|---|
| `AQEEL_DECISIONS.md` | 317,485 bytes, 1,572 lines (about 80,000 tokens) | An append-only log. **1,420 of its lines (about 255 KB, 80%) are one-line run logs** ("... comment run: ~300 results; 0 comments"), written by the runners themselves. About 150 lines (57 KB) are decisions. Donna writes to the same file. |
| `THREADS_KNOWLEDGE.md` | 8,513 bytes | About 60 lines of run log, then two short rule sections. The sections the prompts name (HARD RULE, SELF-HEAL, LEDGER) are not in it; they are in `SOUL.md` (4 mentions). |
| `CONTENT_PLAYBOOK.md` | 12,032 bytes | Stable rules (about 3,000 tokens). |
| `FORUM_FACTS.md` | 1,133 bytes | Small. |

`SOUL.md` (39,941 bytes) and `AGENTS.md` are already the standing instructions and are in every run's context. So the cost is the decisions file: it is read once, then stays in the context for every later step of the run, so each of the 5-6 steps pays for it again. The fix is not to move 317 KB into the standing instructions; most of it is not rules.

**New design.**
1. `scripts/threads-digest.mjs` (no model) writes `RULES_DIGEST.md` in the workspace: the rule sections of THREADS_KNOWLEDGE.md, the playbook, the forum facts, and the decision lines of AQEEL_DECISIONS.md in file order (newest last, so "newest wins" still works) with the run-log lines left out. A content hash in its first line means it rewrites only when a source changed; the source files are never edited. Run on the real files: 317,485 -> 73,402 bytes (about 18,000 tokens, 4.6 times less), 1,420 run-log lines dropped, 150 decision lines kept verbatim. I checked the dropped lines that mention the owner: all were status lines ("still holding for the pause decision"); one real rule ("Every run ... answer new replies") was wrongly classed as a log and the rule markers were widened for it; the 56 other matches are logs.
2. One step further, needs a person (the part that is judgement): a reviewed distilled base of the 150 decision lines (they contradict each other over time: "hot = ...", then "CORRECTION: warm = ..."), written once by a model run and read by the owner, goes to `BASE_DECISIONS.md`; `threads-digest.mjs --base BASE_DECISIONS.md --base-until 2026-11-12` then replaces everything up to that date by the base. Expected size about 25 KB (6,000 tokens). Not applied here because it changes what the posting agent believes.
3. Run prompts read only the digest and stop writing run summaries into the shared files. The proposed prompts are in `docs/schedule-conversions-2026-11-12/prompts/before-*.txt` and `after-a-*.txt` (a text diff of each pair is only the STEP 0 paragraph).
4. Standing instructions: one new section in `SOUL.md`, and one changed line. Proposed text:

```
## Where the rules are (12 Nov 2026)
- The rules you need at the start of a run are in ONE file: /home/claude/workspaces/continue-threads/RULES_DIGEST.md. It is made automatically from THREADS_KNOWLEDGE.md, CONTENT_PLAYBOOK.md, FORUM_FACTS.md and AQEEL_DECISIONS.md; never edit it. Read it once per run. Do not open the four source files unless Aqeel asks you to change one.
- Run summaries go to RUNLOG.txt, one line each. Never into AQEEL_DECISIONS.md or THREADS_KNOWLEDGE.md. AQEEL_DECISIONS.md is only for decisions Aqeel gives you or Donna.
- When Aqeel gives you a new rule: append the decision line to AQEEL_DECISIONS.md as before ("YYYY-MM-DD HH:MM WIB | Threads agent | ..."). The digest picks it up within 30 minutes; say it back to him in chat so he knows it is logged.
- Newest decision wins over anything older in this file.
```
and in "Shared decisions log with Donna", the line "At the START of every chat and every run, read that file" becomes "At the START of every chat and every run, read RULES_DIGEST.md (it contains that file's decisions)".

**Apply** (the prompts and SOUL are what change a live posting agent: do it in a quiet hour, one runner at a time, watch its next run):
```
node $R/scripts/threads-digest.mjs --dir /home/claude/workspaces/continue-threads          # safe: writes RULES_DIGEST.md, edits nothing else
ssh ag-continue-threads@127.0.0.1 'head -c 200 /home/claude/workspaces/continue-threads/RULES_DIGEST.md'   # the agent's user can read it
setprompt continue-threads 738e7a2cea4f $P/after-a-738e7a2cea4f.txt     # the least busy one first
setprompt continue-threads 2ea603717676 $P/after-a-2ea603717676.txt
setprompt continue-threads 7ab01824ed01 $P/after-a-7ab01824ed01.txt
setprompt continue-threads 198bc372ee48 $P/after-a-198bc372ee48.txt     # skip if item b is applied: its drafter prompt already has the same STEP 0
# keep the digest fresh without a model: a script-only schedule "Threads rules digest", every 30 min, script ~/.hermes/scripts/threads-digest.sh containing
#   exec node /home/claude/apps/hermes-ui/scripts/threads-digest.mjs --dir /home/claude/workspaces/continue-threads
# then edit SOUL.md as above (the agent may edit its own SOUL.md; a person or Donna can paste the section).
```
**Undo.** `setprompt` each job with `$P/before-<job>.txt`; remove the new SOUL section; pause the digest schedule. The source files were never touched, so nothing else to restore.
**Risk.** A rule that is only in a source file and was misfiled as a run log would be missing from the digest: the classifier keeps any line whose opening carries a marker (AJ, CORRECTION, PRIORITY, NEVER, ALWAYS, RULE, PATCHED, Every run ...), and it reports counts so a person can compare; `--check` shows when the digest is stale. A decision written at 10:00 reaches the digest within the refresh interval (30 min); for faster, call `threads-digest.mjs` from the two check scripts (it is free when nothing changed). Donna reads the same file in her own chats; she is unaffected until she is pointed at the digest.
**Starts.** 290 -> 290. Tokens: about 139 million a day now (290 runs x about 480k), estimate about 30 million after (each run carries about 18,000 instead of about 80,000 tokens of rules through its steps); about 6 million with the distilled base. Shorter runs also free CPU on Elkiya.

## b. Continue Threads comment runner: model drafts hourly, a script posts at the allowed gaps

**Now (measured).** Runs every 10 minutes: 122 a day, 602k tokens, 4.9 minutes, `last_status` ok. Each run searches about 12 keywords and 250-300 results, mostly Malay/Filipino/Portuguese/seller posts; the notes of the last 12 hours show "0 comments" for most runs. The tracker (`sent_log.jsonl`) shows 29 comments on 11 Nov and 70-77 a day on 2-3 Nov. Posting limits (live, `posting-limits.json`): 70 a day, 6 an hour, 8 minutes apart, `perRun` 2. **Only 1 post is recorded by aqeelOS in 14 days**, because `record_post` was missing from the runner's tool list for most of that time (the runner's own failure note on 11 Nov 23:58 says so). A script removes that dependency.

**How posting is really done.** `.tools/comment_send.py <post_url> <textfile> --send` opens the post in the agent's own Chrome through its DevTools port (9600), types the text, presses Post. It already refuses a banned phrase (exit 3) and a second comment on a thread we already commented on (exit 4, from `ledger.json` and `sent_log.jsonl`). The model adds: choosing the thread and checking the author (draft time), `style_pick.py` for wording (draft time), then after posting verifying the link on the Replies tab, the tracker row, `ledger_sync.py`, a Telegram line to topic 3, and `record_post`. Every one of those after-steps is a command.

**Can a script post safely? Yes for plain comments, no for two kinds of case.**
- Safe: the posting command is already plain automation with its own guards. The visibility check by aqeelOS (a fresh signed-out browser looks for the text, then again after 30 min) is stronger than the model's own look at the Replies tab. The allowed gaps are exactly `decide()` in `posting-limits.mjs`; the script asks it.
- Not safe: (1) the comment-first DM pairing ("udah aku kirim lewat pesan ya kak"): the comment promises a DM, so both must happen or neither. Those stay with the model, DM first and the comment only after the DM is verified. (2) Browser trouble: the model runs the SELF-HEAL rule (clear cache, restart Chrome, patch a tool); a script cannot improvise. It stops the queue after 2 failures in a row and tells General; the next hourly drafting run fixes the cause and resumes.
- Residual risk: a draft is up to 90 minutes old when posted (the playbook says thread age does not matter, but a thread can be deleted, or a seller can have answered below, in that time). `comment_send.py` fails when the thread or reply box is gone; a seller pitch arriving in between is not detected. The queue's expiry is 90 minutes for that reason.

**New design.**
1. Hourly drafting run (24 a day), model: the same search, checklist and `style_pick.py` as today, but STEP 4 is `queue_post.py --add <url> <textfile> --lead ... --author ...` instead of posting. Up to 6 drafts. Prompt: `prompts/after-b-198bc372ee48-drafter.txt`. Set Run rules `perRun` to 6 (the gate text prepended to the run says how many to post).
2. Script-only schedule "Threads comment poster" every 8 minutes (no model): runs `queue_post.py` as the agent's user. It asks `GET /posting-gate/<agent>/<sig>?json=1` (new, `allowNow`): the pause file, day, hour and gap limits; if allowed, posts the oldest draft younger than 90 minutes with `comment_send.py` under `browser.lock`, then `POST /posting-record/<agent>/<sig>` (new; the same code as the `record_post` tool: counts it and checks it is visible), then `ledger_sync.py` and the topic-3 line. Prototype: `docs/schedule-conversions-2026-11-12/threads/queue_post.py` (untested on the box; syntax-checked; `--status`, `--add`, `--resume`).
3. The limits enforce 8 minutes between posts, so the poster's timer is `*/8` (6 an hour is then possible).

**Apply** (after item a, outside the busy hours; the poster first, dry):
```
cat $R/docs/schedule-conversions-2026-11-12/threads/queue_post.py | ssh ag-continue-threads@127.0.0.1 'cat > /home/claude/workspaces/continue-threads/.tools/queue_post.py && chmod 750 /home/claude/workspaces/continue-threads/.tools/queue_post.py'
SIG=$(grep -o 'posting-gate/continue-threads/[^"?]*' ~/.hermes/profiles/continue-threads/scripts/aqeelos-posting-gate.sh | cut -d/ -f3)
printf %s "$SIG" | ssh ag-continue-threads@127.0.0.1 'cat > /home/claude/workspaces/continue-threads/.tools/.aqeelos-sig && chmod 600 /home/claude/workspaces/continue-threads/.tools/.aqeelos-sig'
ssh ag-continue-threads@127.0.0.1 'cd /home/claude/workspaces/continue-threads/.tools && python3 queue_post.py --status'     # expect waiting 0 and allowed_now
# create the script-only schedule "Threads comment poster" (Schedules > new > script only, */8 * * * *, deliver local) whose script runs:
#   ssh -i ~/.hermes/agent-ssh/id_ed25519 -o BatchMode=yes ag-continue-threads@127.0.0.1 "cd /home/claude/workspaces/continue-threads/.tools && flock -n .poster.lock python3 queue_post.py"
# (the same pattern agent-care.mjs writes for aq-job-*.sh). Leave it paused until the first drafts exist.
setprompt continue-threads 198bc372ee48 $P/after-b-198bc372ee48-drafter.txt
# the drafter schedule: hourly instead of every 10 minutes, keeping its --posting check
$N -e 'fetch(process.env.HERMES_DASH+"/api/cron/jobs/198bc372ee48?profile=continue-threads",{method:"PUT",headers:{"x-hermes-session-token":process.env.HERMES_DASHBOARD_SESSION_TOKEN,"content-type":"application/json"},body:JSON.stringify({updates:{schedule:"7 * * * *"}})}).then(r=>console.log(r.status))'
# then resume the poster; set Run rules perRun = 6 on Schedules > Run rules for continue-threads
```
**Undo.** Pause the poster; `setprompt continue-threads 198bc372ee48 $P/before-198bc372ee48.txt` (or the `after-a` version); schedule back to `*/10 * * * *`; `perRun` back to 2. Drafts left in `.tools/comment_queue.json` are harmless (they expire).
**Risk.** Medium-high: this changes how a live posting agent posts. Run the poster with `--dry` first (it only says what it would post) for a few drafts and compare with what the model would have posted; then drop `--dry`. Also: the script's success test (`BOX_AFTER: [0`) was read from `comment_send.py`'s output format and has not been seen on a real post.
**Starts.** 122 -> 24 (and 180 script runs a day, no AI). Tokens: 73M a day -> about 12M.

## c. P&P meeting watcher

**Now.** `[Pixel] Meeting watcher: transcripts to backlog` `fe245c6a315e`, every 30 min 9-19 on weekdays. Its prompt's STEP 0 has the model run `meeting_watch.py` and reply `[SILENT]` when it prints nothing. 110 runs in 7 days, 106 silent, 80k tokens each, 61 s. The script is a no-model monitor (its header says so): it lists new Meet recordings in Drive, starts the download and Whisper in the background, and prints READY/FAILED lines. It lives in the agent's own home: `/home/claude/workspaces/pixel-agent/.hermes/profiles/pixel-agent/scripts/meeting_watch.py` (the prompt's `~/.hermes/profiles/...` path is the agent's view of it).

**New design.** The script becomes the schedule's check: `aqeelos-check-fe245c6a315e.sh` runs it as the agent's user (`--agent-cmd`); a printed line means "go", nothing means no AI start. The model's STEP 0 then runs the same script again to get its lines (it is idempotent: it only lists). The watcher has side effects (it starts downloads), which is why it is run by the check itself, once per tick, rather than by the gate and the model both; the second call in the model's step is a list. Prompt change: only the `[SILENT]` sentence goes (`after-pnp-fe245c6a315e.txt`).
A later step (not worth it now): a Drive change notification instead of a 30-minute poll needs a public address Google can call and Drive `changes.watch` renewal every week; the saving would be the poll itself, which now costs no AI.

**Apply** (on P&P, as the app user):
```
$N $R/scripts/events-wire.mjs --agent pixel-agent --job fe245c6a315e --data $D --check-only \
   --checks '--agent-cmd ".hermes/profiles/pixel-agent/scripts/meeting_watch.py" --cmd-timeout 25' --apply
setprompt pixel-agent fe245c6a315e $P/after-pnp-fe245c6a315e.txt
```
(`--checks` allows the one quoted value; the command is run by `run-check.mjs` over ssh as `ag-pixel-agent`, in `/home/claude/workspaces/pixel-agent`.) Check: `bash ~/.hermes/profiles/pixel-agent/scripts/aqeelos-check-fe245c6a315e.sh` prints `{"anythingToDo": false,...}` when nothing is ready.
**Undo.** `$N $R/scripts/events-wire.mjs --agent pixel-agent --job fe245c6a315e --data $D --undo --apply` (removes the check; the schedule's clock was not touched) and `setprompt pixel-agent fe245c6a315e $P/before-pnp-fe245c6a315e.txt`.
**Risk.** Low. If the script fails or takes over 25 s the answer is "unknown" and the run goes ahead, as today. The gate wrapper's own limit on a check is 30 s. I did not run `meeting_watch.py` (it starts downloads).
**Starts.** 16 a day (22 on a weekday) -> about 2 (only when a transcript is ready, or failed).

## d. Master To Do sync

**Now.** `995f08f40e51`, hourly at :05 8-18 on weekdays: 11 runs, 69 of 75 silent, 200k tokens, 67 s. The prompt is a written three-way compare (Notion master status, source status, last synced status in `todo-sync-state.json`) with a status map, "Done wins", duplicates, and new-task creation for rows where the owner is Aqeel. Everything in it is a rule, except wording nothing. Sources: the Pixel Master Backlog sheet (Google, readable by a script through `gapi.py --account pixel`) and two Notion workspaces.

**The honest limit.** The Notion side is reached through the engine's OAuth MCP connectors (`notion-aqeel`, `notion`, `notion-polyspeech`; the engine holds the tokens). There is no Notion API key on the box (`NOTION_` appears in no `.env`), so a plain script cannot read or write Notion. A script-only sync needs an owner step: create a Notion internal integration, share the To Do databases with it, and give the token to the box (as a secret file, not in a prompt).

**New design, two steps.**
1. No owner step (do now): a check in front of the model. `scripts/sheet-fingerprint.mjs` reads the Master Backlog range and prints `sheet=<hash>`; with `--cmd-once` the model starts only when the sheet changed since the last run, and `--max-idle 180` forces a run every 3 hours so a change made only in Notion is picked up within 3 hours (today: within the hour). Run on the real sheet it printed a fingerprint in under a second. Trade-off: a Notion-only change waits up to 3 hours instead of 1; if that matters, use `--max-idle 60` (about 11 starts a day only on weekdays, no saving) or do step 2.
2. With a Notion integration token: a script (new, not written: it must reproduce the written rules exactly, Done-wins and the duplicate rule included, with a test per rule) does the compare, writes the state file, and starts the model only for the one case the prompt itself says needs a person: a real conflict where neither side is Done. Then starts go to about 0-1 a day.

**Apply (step 1)**, on Elkiya:
```
$N $R/scripts/events-wire.mjs --agent default --job 995f08f40e51 --data $D --check-only \
   --checks '--cmd "node /home/claude/apps/hermes-ui/scripts/sheet-fingerprint.mjs --sheet 1hhjDTh7wc_IQoRyjuKMNO6_fHFCj_b0YEGsBqwQrooA --range Master_Backlog!A2:I400 --account pixel" --cmd-once --max-idle 180' --apply
```
**Undo.** `... events-wire.mjs --agent default --job 995f08f40e51 --data $D --undo --apply`.
**Risk.** Low for step 1: nothing about the sync changes; only how often the model starts. The first run after applying always goes (first fingerprint). A failed read of the sheet is "unknown": the run goes ahead.
**Starts.** 11 on a weekday -> 3-4 (sheet changes plus the 3-hour safety); with step 2, 0-1.

## e. Elkiya Close stages 2 and 3, and the P&P 4-hour check-in

**Close, now.** Stage 2 (`d37f72f40913`, 05:00) and stage 3 (`84282191bd14`, 07:00), daily on days 1-10, were an event chain in ChatGPT and became "guarded retries": the model opens `AI RUN STATUS` and says `[SILENT]` unless the earlier stage is Verified and this one is not. 6 + 6 runs in the first 6 days of November, all silent, about 100k tokens each. The tab (checked read-only on 12 Nov: `Work month, Revision, Run ID, Stage, Status, ...`) has one row per month + revision + stage, with Status Pending / In progress / Verified / Blocked.

**Close, new design.** (1) Chain: when stage 1 (`0076621ae618`, day 1 at 03:00) finishes ok, stage 2 starts; when stage 2 finishes ok, stage 3 starts. It is an event: `app/schedule-finish.mjs` watches `last_run_at` in the jobs file (one `stat` every 30 s, only for the jobs that rules name) and fires `schedule.finished`; `event-runs.mjs` rules with `after` start the next job through the engine's trigger. The gate's check still runs first. (2) A due-check as the job's check: `scripts/close-stage-due.mjs --stage 2` prints one line when the tab says stage 2 is due (stage 1 Verified for a revision, stage 2 not) and nothing otherwise; `--cmd-once` keeps a blocker already reported quiet. The daily 05:00 and 07:00 clocks stay as the slow retry, but they now cost nothing when nothing is due. Run read-only on the real tab for work month 2026-10: stage 2 prints nothing (R2 is Verified), stage 3 prints `stage 3 is due for 2026-10 R2 (now Blocked)` (it is Blocked in the sheet), which is the right answer and one run, then silent.
**Apply** (Elkiya):
```
$N $R/scripts/events-wire.mjs --agent default --job d37f72f40913 --data $D --after 0076621ae618 --keep-schedule \
   --checks '--cmd "node /home/claude/apps/hermes-ui/scripts/close-stage-due.mjs --stage 2" --cmd-once' --apply
$N $R/scripts/events-wire.mjs --agent default --job 84282191bd14 --data $D --after d37f72f40913 --keep-schedule \
   --checks '--cmd "node /home/claude/apps/hermes-ui/scripts/close-stage-due.mjs --stage 3" --cmd-once' --apply
```
**Undo.** `... events-wire.mjs --agent default --job <id> --data $D --undo --apply` for each. **Risk.** Low. Stage 1 finishing "ok" does not mean "Verified": the check decides, so a blocked stage 1 costs no stage-2 run. If stage 1 ran while the app was down, the event is missed and the daily clock picks stage 2 up the next morning. **Starts.** 2 a day on days 1-10 -> about 0 (a run only when a stage is due: 1-3 a month).

**P&P 4-hour check-in, now.** `ab5774438ad0`, 6 a day, 43 runs in 7 days, 39 silent, 114k tokens each. The model reads project channels and the backlog and posts only on a material change.
**New design.** A change probe as the check: `scripts/box-checks/pixel-checkin-changed.py` prints one fingerprint (the newest message by a person across the channels the bot is in, and a hash of the Master Backlog rows); `--cmd-once --max-idle 480` starts the model when it changed, and anyway every 8 hours. **Status: prototype, not run to the end.** My first attempt took over two minutes because `pixel_mcp` checks the bot's identity before every Slack call and I listed every channel of the workspace; the script now reads a cached channel list (`--build` makes it once, by hand) and asks about 15 channels, which should take 10-15 s: it needs a trial on the box, and the gate gives a check 30 s.
**Apply** (P&P, after a trial): `/home/claude/.hermes/pixel-tools/venv/bin/python -I <file> --build` once; copy `pixel-checkin-changed.py` to `/home/claude/.hermes/pixel-tools/`; then `events-wire.mjs --agent pixel-agent --job ab5774438ad0 --data $D --check-only --checks '--cmd "/home/claude/.hermes/pixel-tools/venv/bin/python -I /home/claude/.hermes/pixel-tools/pixel-checkin-changed.py" --cmd-once --max-idle 480 --cmd-timeout 25' --apply`. **Undo.** `--undo --apply`. **Risk.** Low (unknown means the run goes ahead); the probe ignores the bot's own posts so it cannot trigger itself. **Starts.** 6 -> 2-3.

## f. 4AM wake-up and the invoice reminder

**Now.** `c0a6ba56f9c3`: daily 04:00, a model run of about 10 minutes (580 s), 153k tokens, sends up to 5 nudges with `sleep 120` between them and uses `session_search` to look for a "Hello" reply. `600fe15b50ab`: the 10th and 20th at 09:00, a model writes a fixed 2-3 line reminder, 27k tokens.

**New design.** Script-only schedules; the engine delivers what the script prints to the job's `deliver` target, nothing printed = nothing sent.
- Wake-up: `scripts/box-checks/wakeup-nudge.py`, schedule `0,2,4,6,8 4 * * *` (five fires, two minutes apart). Each fire prints the next of five escalating nudges; if a WhatsApp message that is just "hello" arrived since 04:00 (read-only query on `state.db`: `sessions.source = 'whatsapp'`, `messages.role = 'user'`), it prints "Morning! Stopping now." once and nothing after. State in `~/.hermes/cron/wakeup-state.json`. I ran it once with `--dry` on Elkiya: it printed the first nudge and wrote nothing; "hello" messages exist in the WhatsApp sessions (6 in `state.db`), so the lookup finds the right rows. The wording of the five lines is mine and should be changed to taste.
- Invoice reminder: a script that prints the fixed text. `printf` the three lines in `~/.hermes/scripts/invoice-reminder.sh`:
```
#!/bin/bash
cat <<'TXT'
Hi Aqeel, quick check: have the last invoices from Fotocadeau, Guldbrev and MPF (MyPetFrame) been paid?
Reply with which ones are paid and which are still open, and I can draft a Gmail follow-up for the unpaid ones.
TXT
```
**Apply** (Elkiya; `deliver` stays the WhatsApp target the model jobs use):
```
$N $R/scripts/job-script-wire.mjs --agent default --job c0a6ba56f9c3 --script wakeup-nudge.py --from $R/scripts/box-checks/wakeup-nudge.py --deliver 'whatsapp:263015307980843@lid' --expr '0,2,4,6,8 4 * * *' --data $D --apply
$N $R/scripts/job-script-wire.mjs --agent default --job 600fe15b50ab --script invoice-reminder.sh --from <the file above> --data $D --apply
```
Test before the first night: trigger the job once at a daytime hour (it should send nudge 1 to WhatsApp), then delete `~/.hermes/cron/wakeup-state.json`.
**Undo.** `$N $R/scripts/job-script-wire.mjs --agent default --job <id> --undo` (restores no_agent, script, deliver, schedule and the prompt from `$D/job-wired/`). **Risk.** Low-medium: delivery of a script-only schedule to a WhatsApp `@lid` target has not been proven (the existing script-only jobs deliver to Telegram or `origin`); the daytime test settles it. If the engine cannot, the fallback is the app's `send_to_person` route. **Starts.** 1 a day and 2 a month -> 0; the 10-minute model run disappears.

## g. Chat watchdogs, paid-orders feed, away auto-reply

- **Paid-orders feed (`eac8696c1130`, every 2 min): ready.** The recap hooks already refresh the agent's `sales-recap/feed` on every `payment.paid` and `order.posted` (`event-hooks.json` on Elkiya has `"feed": "sales-recap/feed"` for both agents) and on the hourly fallback. Pause the job: `POST $HERMES_DASH/api/cron/jobs/eac8696c1130/pause?profile=default`; undo `.../resume`. Check afterwards that `sales-recap/feed/payments.jsonl` of both agents still moves after a test payment. Removes 720 script runs a day. One gap: the labelled state changes after `payment.paid` without an event of its own; `order.posted` follows within a minute, which refreshes the feed again.
- **Chat watchdogs (Biomarkers every 15 min, Continue test chats every 5 min): not worth it now.** Both are script-only already (0 AI starts); they cost one Python start and Kirimdev API calls per run (96 and 288 a day). What the app already sees: `kirimdev.mjs` ingests every inbound message (`ingest`, with `st.recent[agent|from]`) and sends every reply (`prepare`/`deliver`, and `answered()` clears a handoff when the agent replies); it already keeps `st.asked` with a 30-minute timer that raises a Health item for an unanswered hand-off. A timer started by the inbound message and cancelled by the reply is a small extension of that (a new `st.waiting` map and one more branch in `unanswered()`), but it changes a customer-facing module (762 lines) to save script runs that cost no AI, and the Biomarkers script also reports "pending or failed outbound messages", which the timer would not cover. Recommendation: leave as is; if wanted, lengthen the test-chat watchdog from 5 to 10 minutes.
- **Away auto-reply (P&P, every 2 min): needs the owner, and the saving is small.** The app does **not** see Slack events: Slack is connected by the Slack MCP sign-in and the Pixel bot token is used by `pixel_mcp.py`; the Slack app manifest has Socket Mode off and no Events API request URL. A mention-started timer needs the owner to turn on Event Subscriptions (`app_mention`, `message.channels`) on the Pixel Slack app with a public request URL (ai.pixelandprofits.com), plus a Slack signature check route in the app like `/hooks/tebar/<agent>`. Until then the script waits 10 minutes by its own rule, so running it every 5 minutes instead of 2 loses nothing: 720 -> 288 runs a day (`PUT` the schedule to `*/5 * * * *`; undo `*/2`).

## h. Payment confirmation by the providers' "paid" callback (built, with tests)

**Now.** `paid-labels.mjs` asks Tripay (and Xendit for card payments) about each payment of the last 3 hours (25 for cards) every minute, and an old unpaid card link every 10 minutes. Nothing calls aqeelOS when a payment succeeds.

**What was built.**
- `POST /hooks/pay/tripay/<agent>`: Tripay's documented callback: header `X-Callback-Signature` = HMAC-SHA256 (hex) of the **raw** JSON body with the merchant **private key**; header `X-Callback-Event: payment_status`; body fields include `reference`, `merchant_ref`, `status` (PAID, FAILED, EXPIRED, REFUND). It expects `{"success": true}` and retries 3 times, 2 minutes apart, otherwise. The key is read from the agent's `.secrets/TRIPAY_PRIVATE_KEY` (present for Continue Support and Biomarkers Support).
- `POST /hooks/pay/xendit/<agent>`: Xendit's invoice callback: header `x-callback-token` equals the "callback verification token" of the dashboard; the body is **not signed**. Read from `.secrets/XENDIT_CALLBACK_TOKEN` (present for both agents). Compared in constant time; an empty token never matches.
- A callback is only a wake-up. After the check passes, `paidLabels.nudge(agent)` asks the provider's own API about that agent's payments right now (skipping the slow-poll wait), so a forged, replayed or stale body (Xendit has no signature or timestamp) can never mark an order paid. The same state, labels, order post and `payment.paid` / `order.posted` events (and so the recap hooks) follow as before. A repeated callback labels nothing twice (tested).
- A refused call gets `401 {"success":false}` and the log line "payment callback: <provider> for <agent> refused"; no key saved = refused; unknown provider/agent name 404; body over 64 KB 413.
- The poll: once a verified callback has been seen for an agent and provider (kept in `DATA/payment-callbacks.json`), that provider's payments of that agent are asked about every 10 minutes instead of every minute; with no callback for 14 days it goes back to every minute by itself. The first payment after setup is therefore still polled every minute until the first verified callback arrives.
- Sources for the schemes: Tripay developer documentation, "Callback" (tripay.co.id/developer); Xendit "How to validate if the webhook is sent from Xendit" and "Integration security" (help.xendit.co, docs.xendit.co). I looked up Tripay's page directly; for Xendit the docs page for invoice callbacks returned 404 and I relied on the help article and the security page, which agree on the token header; they list PAID and EXPIRED for invoices (the app's own poll maps `SETTLED` to PAID; a callback with any status only wakes the check, so this does not matter).

**What only the owner can do (provider dashboards).** Public address: the box's address (Elkiya `ai.elkiya.com`, from the engine's OAuth return URLs; P&P has no payment agents).
1. Tripay merchant dashboard, once per merchant (Continue Support, Biomarkers Support each have their own): Merchant > Settings > Callback URL = `https://ai.elkiya.com/hooks/pay/tripay/continue-support` and `.../biomarkers-support`.
2. Xendit dashboard, once per business: Settings > Webhooks > "Invoices paid" (and, if wanted, "Invoices expired") = `https://ai.elkiya.com/hooks/pay/xendit/continue-support` and `.../biomarkers-support`. Check that the "Callback verification token" shown there is the value saved as `.secrets/XENDIT_CALLBACK_TOKEN` for that agent.
3. Check the route is reachable before touching the dashboards: `curl -i -X POST https://ai.elkiya.com/hooks/pay/tripay/continue-support -d '{}'` must answer `401 {"success":false,...}` (404 or a login page means the reverse proxy does not forward `/hooks/pay/`; the Tebar route `/hooks/tebar/` is forwarded the same way, so it should).
4. After the first real or test payment: `cat $D/payment-callbacks.json` shows `seen["<agent>|tripay"]` with a count and the last status; Health shows nothing new.
**Undo.** Clear the URLs in the dashboards (the poll returns to every minute after 14 days of silence, or at once with `rm $D/payment-callbacks.json` and a graceful app restart), or revert the deploy.
**Risk.** Low: a callback cannot change a payment's state by itself; the worst case of a bad URL is that the poll stays every minute. The new route is public and unauthenticated by design, like Tebar's and Kirimdev's, with a 64 KB body limit and a secret check before any work.
**Starts.** No AI starts involved. Payment known in seconds instead of up to a minute (and the sales recap fires at once); provider API calls drop to about a sixth.

---

## Order to apply

1. Merge and deploy `w-sweep` (graceful restart only, at an idle time): this adds routes and checks; nothing changes behaviour until a rule or dashboard URL exists.
2. h: owner sets the callback URLs. g: pause the feed job.
3. c, e (Close), d step 1, f: the small ones, each with its own undo.
4. a: digest, then the prompts one runner at a time.
5. b: after a, in a quiet hour, dry first.
6. e (P&P check-in): after a trial run of the probe.

## Not done, and why

- The distilled decisions base (item a, step 2) and a script-only Master To Do sync (item d, step 2): the first is a judgement about what the owner decided, the second needs a Notion token from the owner.
- No change to the chat watchdogs; no Slack event route (needs the owner's Slack app settings).
- `queue_post.py` has not run against the real Chrome; the check-in probe has not run to the end; neither has `meeting_watch.py` been run (side effects).
