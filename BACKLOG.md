# aqeelOS backlog

This is the one list of everything still open in aqeelOS. It lives in git, so this PC, the Mac and every session see the same list.

**How it works**
- Every request goes here first, the same turn it's asked.
- `[ ]` is open, `[~]` is being worked on now, `[x]` is done. Done means **live on the servers and checked**, not just built.
- A session only stops when everything left is waiting on the owner. Those items go under **Waiting on you** with the exact step needed.
- Each session ends by updating this file: what's done, what's still left and why.

_Last updated: 11 Nov 2026_

---

## Now

- [~] **GIT-1** Taking the fixer's lost fixes into git: on GitHub main as `4f7243a` (88 tests pass), waiting for the deploy:
  - [x] `website_form` customer tool: Continue's support agent reads the quiz a customer filled in on continuelongevity.com (issue i77296280). Two deploys had removed it. Setting restored on Elkiya (`kirimdev.json`, backup `.bak-20261111-websiteform`).
  - [x] change_instructions: an agent can read its own instructions, and a miss shows the closest part (id051b007).
  - [x] A fixer rollback undoes only its own change, not edits made later (ibd8a5021; a rollback had erased Biomarkers rules).
  - [x] Chat uploads readable by the agents that receive them (P&P, i03f117e5), as an engine patch that comes back after every engine update.
  - [x] Agents resume work cut off by a restart (i83a0f438), as an engine patch.
  - [x] The live test reads the engine's keys itself (P&P, i46105c3e). May be why P&P's live test hangs (OPS-11).
  - [x] Kirimdev: resume a chat when the team doesn't answer a handoff within 5 min (i87fbcb7b), loose picture tags (ie54d1284), recent payment not taken as a false claim.
  - Already in git, nothing to do: the payment fixes, the empty order form check, the auto-update message, older drift saves.
  - Note: `scripts/issues.test.mjs` fails on this PC with or without these changes (one timing assertion). Check it on Linux.

## Waiting on you

- [x] **DEPLOY-6** Both servers run 8abacb9 (11 Nov): owner rule, fixer rule, one alert per app, engine limit patch, type_secret through the browser. Live tests passed on both.
- [ ] **MODEL-0** Pick the model plan (see section 6).

- [ ] **DEPLOY** Approve deploying `4f7243a` (the recovered fixes) to Elkiya and P&P. Claude Code's safety check blocks each production deploy until you say yes in chat.

- [ ] **HEALTH-0** "Cost by profile": did you mean by **person** (who started the chat) or by **agent**?
- [ ] **CODE-50** aqeelOS app for Mac: run `gh auth refresh -s workflow` (from the old board).

## Next, in this order

### 1. Shipped today, check it on the live servers
Checked against P&P's live data and the code on 11 Nov: Aldillah is an employee, so her agent opens for partners, no Private switch is on yet, and Fakhri's agent is held as Aqeel's until he joins. Still to do: look at each one on screen.
- [ ] **ACC-1** Partners and employees: partners manage employees' agents and read their chats (read-only, logged), employees see only their own. Live in `996144f`.
- [ ] **ACC-2** Private switch on a partner's own agent (Agents › gear › Sharing). Aldillah's agent no longer shows as Private to Aqeel.
- [ ] **ACC-3** Fakhri's agent shows "Owner: Fakhri · invited" and becomes his when he joins.
- [ ] **ACC-4** Employees with no agent can create one.

### 2. Code that only exists on the servers (the next deploy would undo it)
- [ ] **GIT-1** See "Now". After the deploy, clear the "Code changes" list on Health on both servers.
- [ ] **GIT-2** Fixer ships through GitHub instead of patching live code, so this list stays empty.

### 3. Long-term reliability rules
- [ ] **OPS-2** Each agent runs in its own container group with a memory cap, and one command stops everything it started.
- [ ] **OPS-3** Restarts back off, and after 5 failures in an hour they stop and file one issue.
- [ ] **OPS-4** A screen and Chrome left idle for 30 min go to sleep and wake on use.
- [ ] **OPS-5** Janitor: every minute it compares expected and running processes per agent, reports anything extra and removes it.
- [ ] **OPS-6** Deploy checks: AI-dependent checks report but don't block, and a failed check gets one retry.
- [ ] **OPS-7** Logs, old patches and test users expire. Elkiya's disk is 73% full.
- [~] **OPS-8** [OPERATIONS.md](OPERATIONS.md) written (11 Nov). Still to do: tests that fail when new code breaks a rule.
- [ ] **OPS-12** Design question before building OPS-4: when an agent's sleeping screen is needed again, what wakes it? The engine's browser tool connects straight to Chrome's port, so the likely answer is a small proxy on that port that starts the screen on first use.

### 4. Health and fixer redesign
- [ ] **HEALTH-1** One verdict at the top: "Everything is patched and working", or what needs you.
- [ ] **HEALTH-2** Fixer panel: what it's doing now (step, try, model), then the queue in priority order with move up/down, pause and skip. Elkiya has 31 queued items that have never been started. Why (found 11 Nov): one issue at a time, at most 20 fix runs a day (`team-policy.json` fixer.cap), proof runs go first, and anything needing an engine reload waits for quiet hours. The panel must show this: "20 of 20 runs used today, next start tomorrow 00:00".
- [ ] **HEALTH-3** "Needs you" holds only person-only items, grouped (for example the four higgsfield sign-ins become one).
- [ ] **HEALTH-4** Fixed and closed issues move to a History tab.
- [ ] **HEALTH-5** "Code changes" in plain words, with a button that takes them into git.
- [ ] **HEALTH-6** Memory per agent, with a warning when one keeps growing.
- [ ] **HEALTH-7** Cost by person/profile next to cost by agent (see HEALTH-0).
- [ ] **HEALTH-8** False "can't reach the engine" alarm when the status call is slow.
- [ ] **HEALTH-9** Issues merge duplicates when they're filed.

### 4b. Randy's QRIS picture never reaches the customer (if734729a, Elkiya)
Found 11 Nov:
- Kirimdev and WhatsApp mark every QR as "delivered" and report no media error. Tripay serves the QR as a normal PNG, crawlers included.
- Gilang's working QRs use the same Tripay link, but go as **one picture with a caption**. Randy's went as text, a bare picture, then text, all in the same second.
- The fixer's caption fix was rolled back only because its proof needed a person to look at Amri's phone.
- [~] **QR-1** Fix: `06a44a6` (see "Waiting on you"). Done once a delivery check or a phone shows the QR.
- [~] **QR-2** Built in `4ceac9e` (69 tests pass, plus the bridge add-on's own 4 cases). Delivery probe, so the fixer can prove a picture arrived without a person:
  - The main agent's WhatsApp bridge on Elkiya messages the line once a day, which opens WhatsApp's 24-hour window.
  - aqeelOS sends a test picture to it with a hidden probe code.
  - The bridge sets probe messages aside instead of giving them to Donna, and records whether the picture downloaded.
  - The line's agent ignores inbound probe messages.
  - The fixer's proof step and Health use the result: "Pictures from Randy: arrived 10:02".
- [~] **QR-3** The fixer's fix and proof runs are now told to use the delivery check and never to ask a person to look at a phone (`4ceac9e`). Still to do: file "needs a person" at once for any other proof only a person can give.
- [ ] **ENG-1** Elkiya's WhatsApp bridge has local add-ons that aren't in git (`group_watch.js`, `inbox_log.js`, and edits in `bridge.js`). The next engine update would wipe them, so take them into `engine/patches`.
- Clue: Kirimdev reports Meta status `CONNECTED` for the Biomarkers line, but none for the main Continue line.

### 5b. Employees can't connect Google (P&P, Fakhri Agent, 11 Nov)
Found:
- P&P has no install-wide Google client (`~/.hermes/google_client_secret.json`). The only client is Pixel Agent's own: Google Cloud project `peaceful-app-511818-u2`, a Desktop client from 19 Oct, signed in as aqeel@pixelandprofits.com. It's not shared.
- Connections › Connect Google is admin-only (`/ui/google/*`: "Only admins connect Google accounts").
- So Fakhri's agent had no free route it could take for an employee. Its standing rule says to suggest Composio "when the setup needs admin access the person does not have", and no agent text mentions Connect Google at all.
- [ ] **GOOG-1** (needs an admin) One Web-type Google client per install: in Google Cloud (Pixel's existing project peaceful-app-511818-u2 is fine), create an OAuth client of type Web application with redirect https://ai.pixelandprofits.com/google-oauth/callback, and upload its file in Connections › Add › A Google account. Same once on Elkiya if it has none.
- [ ] **GOOG-7** Remove the "WO Dashboard - Google Sheet" entry from Fakhri Agent once his Google account is connected.
- [~] **GOOG-2** (live since 411d62b, built in b983ba0) Employees connect their **own** Google account for their own agents (sign-in link or the Connect Google card). Setting up the Google Cloud client stays admin-only.
- [~] **GOOG-4** (live since 411d62b, built in b983ba0) The "Add MCP tool" form accepted a Google Sheets link as a tool: "WO Dashboard - Google Sheet" in Fakhri Agent's config is just `url: https://docs.google.com/spreadsheets/...`. Fakhri saw a sign-in button and thought it was connected, then sign-in failed with "Bad name". The form must refuse a web page that isn't an MCP server, recognise Google links and send the person to Connect Google, and refuse tool names with spaces up front.
- [ ] **GOOG-5** Issue i7d96eb8c was closed as "needs a person" with the wrong person (the sheet owner). The real fix was the install-wide Google client. Once GOOG-1 to GOOG-3 are done, the fixer can guide this itself.
- [~] **GOOG-6** (live since 411d62b, built in b983ba0: the fixer tells the person who asked in their bell, linked to the chat) "Tell me when it's fixed": Fakhri's agent said it can't send a message on its own when an issue it filed is solved. The fixer should tell the chat that filed the issue when it's fixed, the aqeelOS web chat included.
- [~] **GOOG-3** (live since 411d62b, built in b983ba0) Agent guidance: if a client exists, send the sign-in link yourself. If not, say "an admin does the free 5-minute setup once in Connections › Connect Google". Composio only after that.

### 5c. The same pattern beyond Google (audit of both servers, 11 Nov)
**Apps that can never work**
- [x] **APP-1** The engine limit was already raised by hand on 7 Nov (tools/mcp_tool_transport.py, 10 MB), and the 1 MB error hasn't come back since. It is now in git as engine/patches/2026-11-11-mcp-sse-event-cap.patch (e5da3a7), so engine updates keep it. Higgsfield now only needs a normal sign-in on the agents that should have it (see HIGGS-1). One alert per app instead of one per agent is in 0bd063f.
- [ ] **HIGGS-1** (your call) Which Elkiya agents should have Higgsfield? Sign it in once on those; take it off the rest.
- [ ] **ENG-2** The live engines have more hand edits outside git than the known patches (git diff on Elkiya lists dozens of files, most from aqeelOS's renaming, which is re-applied after updates). Compare each against engine/patches and take the real fixes into git, so the next engine update loses nothing.
- [x] **APP-2** (live in 8abacb9, built in 0bd063f: technicalOnly in the fixer, and one sign-in alert per app instead of one per agent) Health: a "needs a person" issue must name something a person can actually do. A sign-in that fails for a technical reason is the fixer's job, not a person's.
- All other apps on both servers (88 entries) are fine. The only broken entry is Fakhri's Sheets link (GOOG-7).

**Things an employee can't do for their own agent (same as Google was)**
- [x] **OWN-1** (live in 8abacb9, built in 86a2772: ownsAgent rule plus scripts/route-rights.test.mjs) Edit or rename an app on their own agent, or change its key (`/ui/mcp/server`, `/ui/mcp/keys`, `/ui/share/rename-mcp` are admin-only). For example, Fakhri can't fix his own "WO Dashboard" entry.
- [x] **OWN-2** (live in 8abacb9, built in 86a2772) Reconnect or pause their own agent's Telegram or WhatsApp channel when it drops (`/ui/channels/reconnect`, `/ui/channels/pause`).
- [x] **OWN-3** (live in 8abacb9, built in 86a2772) Remove a Google account from their own agent in the Connected apps panel (`/ui/google-accounts` DELETE is still admin-only, while Connect Google now allows the owner).
- Stay admin-only, on purpose: branding, gateway restarts, plugins, sharing between agents, the owner's view of n8n, keys of other people, WhatsApp Business setup.

**Agents that get stuck signing in**
- [~] **AUTH-1** Fixed in c384c27, live in 8abacb9: type_secret finds the browser the agent's browser tool drives (config port, the engine Chromium's DevToolsActivePort file, or its own Chrome) and types into the focused sign-in field through it, with the same checks. Tested against real Chrome on Elkiya. Done once Donna signs in to KirimDev with it.

**Answers that went to the wrong person**
- P&P: 3 issues came from web chats; 1 answer went to the owner and 2 aren't answered yet. Elkiya: 1, not answered yet. GOOG-6 fixes all of these once deployed.

### 6. Token use and model choice
Today: the fixer runs on the main agent's profile, Sonnet 5.5 with the 1M context, through the Claude subscription, and its use is mixed into Donna's. This Claude Code work runs on Opus 5.5 at medium effort. API prices per million tokens in/out: Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50.
- [ ] **MODEL-1** The fixer gets its own profile, so Usage shows its cost on its own line (also part of HEALTH-7).
- [ ] **MODEL-2** Model per step, as settings (aqeelOS stays model-agnostic): sorting new issues (duplicates, needs a person, priority) is one cheap call on a small model, not an agent run. Fix runs use the mid model at medium effort, proof runs the small model, and the big model is used only on a third try or a stuck issue.
- [ ] **MODEL-3** Fewer wasted runs, which saves more than any model choice: merge duplicates, send person-only items to "Needs you", prove with delivery checks instead of fix-and-roll-back rounds, and don't spend the 20 daily runs on issues that will come back.
- [ ] **MODEL-4** Log tokens per fixer run, then compare cost per fixed issue before and after.
- [~] **MODEL-5** billion-context (github.com/ranxianglei/billion-context) in every install, so long chats use fewer tokens. Owner: "ship to all now" (11 Nov). On main as `8f2353a` (`app/billion-context.mjs`, pinned 0.1.213, self-update off, credit in README and the plugin's description), live on Elkiya since 05:32 UTC: every agent has the plugin switched on. The engine loads it at its next restart, which aqeelOS holds for the quiet hours (01:00-05:00). Emergency off: `touch ~/.hermes/.aqeelos-billion-context-off`.
  - Still to do: after tonight's restart, check that agents still answer on the Claude and ChatGPT sign-ins and whether chats actually get compressed (the Claude sign-in runs the `claude` program as its own process, so the proxy may not see that traffic). P&P (ai.pixelandprofits.com) runs `8abacb9` since 06:07 UTC (automatic deploy) and every agent there has the plugin switched on too; same quiet-hours restart. The engine's own summariser stays on as a fallback; it only acts if billion-context doesn't keep the chat short.

### 5. Small leftovers
- [ ] **OPS-9** The live test's setup test agent is missing on Elkiya (404 warning).
- [ ] **OPS-10** Remove the leftover test user `ag-zz-fornew` on P&P.
- [ ] **OPS-11** P&P's live test hung during a deploy on 11 Nov. Find out why.

## Done (11 Nov)

- [x] Deployed `996144f` to Elkiya and P&P (Private switch, partner/employee rule, self-create, Elkiya payment fixes, auto-fix guard).
- [x] **OPS-1** Screen desktops piling up (49 each on continue-support and biomarkers-support). Fixed in `25fd701`, live on both servers. Elkiya is back to 1 desktop per agent, both screens open again, and memory went from 28.0 to 22.5 GB of 28 GB.

---

## From the old /backlog board (last updated 5 Nov)

The "partly done" items need sorting: each one ends up done, split into a clear next step, or dropped.

### Doing (from the old board) (3)

- [ ] **ABIL-65** Every agent has Donna’s tools, Sesa included · P0
- [ ] **AUTO-47** Run rules: one run at a time, posting limits and live checks · P0
- [ ] **CODE-29** Live: publish apps from Code to <name>.app.elkiya.com · P0

### Blocked (from the old board) (2)

- [ ] **CODE-50** aqeelOS app for Mac · P1
  - 20 Oct: build ready (ARCH=arm64|x64, dmg, mic/camera/location texts); built on GitHub’s Macs by a workflow. Blocked: the owner runs gh auth refresh -s workflow,
- [ ] **MODEL-15** Gemini with your Google AI plan (chat, then images and video) · P1
  - Built and tried on 17 Oct: the sign-in worked (aqillaabdurrahmanjundiy@gmail.com), but Google now refuses the Gemini CLI for personal accounts, Google AI Pro in

### Planned (from the old board) (5)

- [ ] **CODE-10** Mac install checked on a Mac · P1
- [ ] **SHELL-49** Extension tested in real Chrome · P1
- [ ] **AUTO-23** Slack: as a bot, or as a person’s own Slack account · P2
- [ ] **SYS-45** More installs of aqeelOS, updated from GitHub · P2
- [ ] **CODE-22** Signed installers (Windows and Mac) · P3


<details><summary>Partly done (168, needs sorting)</summary>

- [ ] **AUDIT-1** Agents: Members can bypass the fresh-agent restriction and copy another agent's secrets · P0
- [ ] **AUDIT-2** People and access: Admins can bypass private-agent access through the legacy sharing endpoint · P0
- [ ] **AUDIT-3** Server: [P0] Unauthenticated WebSocket clients can exhaust server memory · P0
- [ ] **AUDIT-4** Code engine and desktop app: Online viewers can control runs and terminals despite view-only access · P0
- [ ] **AUDIT-6** Chrome extension: Password values can leak through snapshot element names · P0
- [ ] **CODE-07** Code uses agents, one way · P0
- [ ] **CODE-41** The aqeelOS desktop app, with a real browser in Code · P0
- [ ] **CODE-48** Stop doesn’t close the app · P0
- [ ] **CODE-52** Attach several agents to a Code message · P0
- [ ] **CODE-55** One model list in Code, as in aqeelOS · P0
- [ ] **SYS-61** Full audit: everything the engine's own dashboard has, aqeelOS has too · P0
- [ ] **AUDIT-10** Chat: Uploads can silently overwrite another chat's attachment · P1
- [ ] **AUDIT-11** Chat: Voice transcription is always routed to the default agent · P1
- [ ] **AUDIT-12** Memory and Files: Uploading a matching filename silently overwrites the existing file · P1
- [ ] **AUDIT-13** Memory and Files: A failed memory read opens an empty editor that can erase existing notes · P1
- [ ] **AUDIT-14** Memory and Files: All-agents Files shows members folders they cannot open · P1
- [ ] **AUDIT-15** Code page in aqeelOS: Fallback download installs an engine the browser refuses to open · P1
- [ ] **AUDIT-16** Code page in aqeelOS: A rejected connection attempt hides the connection form · P1
- [ ] **AUDIT-17** Automations: Editing interval or one-time schedules silently replaces their timing · P1
- [ ] **AUDIT-18** Automations: Failed access removal is reported as successful · P1
- [ ] **AUDIT-19** Automations: The timezone shortcut changes the chatting agent instead of the schedule's agent · P1
- [ ] **AUDIT-20** Channels: All agents omits requests from extra channel accounts · P1
- [ ] **AUDIT-21** Abilities: Renaming an app can overwrite another connection · P1
- [ ] **AUDIT-22** Abilities: Changing provider can leave an incompatible model selected · P1
- [ ] **AUDIT-23** Models: Switching providers can leave the agent with an unsupported model · P1
- [ ] **AUDIT-24** Models: Automatic switching stops after the first inaccessible fallback · P1
- [ ] **AUDIT-25** Models: Google sign-out leaves agents pointing at the disabled provider · P1
- [ ] **AUDIT-26** System: Backup controls never reach the Health page · P1
- [ ] **AUDIT-27** System: Daily limits ignore today's work in older chats · P1
- [ ] **AUDIT-28** People and access: Sharing a key silently destroys a different key already on the recipient · P1
- [ ] **AUDIT-29** People and access: Deleting an agent never frees the member's creation allowance · P1
- [ ] **AUDIT-30** People and access: Member connection lists are always filtered using a nonexistent field · P1
- [ ] **AUDIT-31** People and access: Password changes leave existing sessions authenticated · P1
- [ ] **AUDIT-32** Server: [P0] Shared-screen restriction can be bypassed through an agent screen · P1
- [ ] **AUDIT-33** Server: [P1] Code online sessions survive 'Sign out everywhere' · P1
- [ ] **AUDIT-34** Code engine and desktop app: Keeping a comparison corrupts changed image files · P1
- [ ] **AUDIT-35** Code engine and desktop app: Comparison deletions bypass undo history · P1
- [ ] **AUDIT-36** Code engine and desktop app: AI browser reads the person's tab but clicks its own tab · P1
- [ ] **AUDIT-37** Code engine and desktop app: PowerPoint, Word and Excel uploads are rejected as nontext · P1
- [ ] **AUDIT-38** Code engine and desktop app: Gemini loses all saved project secrets before launch · P1
- [ ] **AUDIT-39** Code engine and desktop app: Turning off web access also removes unrelated app and connected-agent tools · P1
- [ ] **AUDIT-40** Code engine and desktop app: A fourth running AI leaves a new comparison half-started forever · P1
- [ ] **AUDIT-41** Code engine and desktop app: Background self-update can terminate work started during the download · P1
- [ ] **AUDIT-42** Code engine and desktop app: Failed dependency installation still commits the self-update · P1
- [ ] **AUDIT-43** Chrome extension: Stop and Take over do not cancel a pending click or typing action · P1
- [ ] **AUDIT-44** Chrome extension: The browser cannot discover controls inside shadow roots · P1
- [ ] **AUDIT-45** Code app: Saving can silently discard edits typed during the request · P1
- [ ] **AUDIT-46** Code app: The project preview tab is never rendered · P1
- [ ] **AUDIT-47** Code app: Compare draft Preview buttons show the wrong browser · P1
- [ ] **AUDIT-48** Code app: Agent command updates repeatedly steal the terminal tab · P1
- [ ] **AUDIT-7** App shell: Signing out leaves private conversations available to the next account · P1
- [ ] **AUDIT-8** Chat: Sending locks out steering, queued messages, and other chats until the reply ends · P1
- [ ] **AUDIT-9** Chat: Images larger than 8 MB are sent without image data · P1
- [ ] **CODE-12** Code for the whole team · P1
- [ ] **CODE-39** Side browser: microphone, camera, location, downloads, uploads · P1
- [ ] **CODE-45** Rounded, centred device screens · P1
- [ ] **CODE-53** Agents introduce themselves to the coding model · P1
- [ ] **CODE-54** Files from agents land in the project · P1
- [ ] **CODE-56** Plan only on every model · P1
- [ ] **CODE-57** Open in Code from a chat · P1
- [ ] **PAR-11** Shell, Task board, Achievements: Configure orchestrator and default assignee · P1
- [ ] **PAR-12** Shell, Task board, Achievements: Toggle automatic triage decomposition · P1
- [ ] **PAR-13** Shell, Task board, Achievements: Task diagnostic and staleness indicators · P1
- [ ] **PAR-14** Shell, Task board, Achievements: Create tasks in the intended workflow destination · P1
- [ ] **PAR-15** Shell, Task board, Achievements: Select task workspace type and path · P1
- [ ] **PAR-16** Shell, Task board, Achievements: Choose a parent when creating a task · P1
- [ ] **PAR-17** Shell, Task board, Achievements: Move tasks by desktop drag and drop · P1
- [ ] **PAR-18** Shell, Task board, Achievements: Change task status through task controls · P1
- [ ] **PAR-19** Shell, Task board, Achievements: Completion summary and destructive transition confirmations · P1
- [ ] **PAR-2** Shell, Task board, Achievements: Standalone gateway warning on multi-profile installations · P1
- [ ] **PAR-20** Shell, Task board, Achievements: Specify and decompose triage work · P1
- [ ] **PAR-21** Shell, Task board, Achievements: Inspect and edit task dependencies · P1
- [ ] **PAR-22** Shell, Task board, Achievements: Final task result and run-summary fallback · P1
- [ ] **PAR-23** Shell, Task board, Achievements: Read child task results and open child tasks · P1
- [ ] **PAR-24** Shell, Task board, Achievements: Read and add task comments · P1
- [ ] **PAR-25** Shell, Task board, Achievements: Task attachment upload, download and deletion · P1
- [ ] **PAR-26** Shell, Task board, Achievements: Task diagnostics details and recovery actions · P1
- [ ] **PAR-27** Shell, Task board, Achievements: Worker log inspection · P1
- [ ] **PAR-28** Shell, Task board, Achievements: Complete task run history · P1
- [ ] **PAR-29** Shell, Task board, Achievements: Select tasks for bulk work · P1
- [ ] **PAR-30** Shell, Task board, Achievements: Bulk status changes and multi-card dragging · P1
- [ ] **PAR-31** Shell, Task board, Achievements: Bulk priority and reassignment with reclaim-first · P1
- [ ] **PAR-32** Shell, Task board, Achievements: Unlocked, discovered and secret achievement states · P1
- [ ] **PAR-33** Files and Memory: Enter an arbitrary absolute directory path and submit with Go or Enter · P1
- [ ] **PAR-34** Files and Memory: See accurate provider readiness states · P1
- [ ] **PAR-35** Files and Memory: Inspect and edit an already available provider's configuration · P1
- [ ] **PAR-36** Files and Memory: See detailed dependency setup results and failures · P1
- [ ] **PAR-37** Models and agents: Add, remove and change MoA reference-model slots · P1
- [ ] **PAR-38** Models and agents: Disconnect an OAuth provider with confirmation · P1
- [ ] **PAR-39** Settings and Keys: Complete environment-variable catalog · P1
- [ ] **PAR-4** Shell, Task board, Achievements: Kanban manual refresh and automatic updates · P1
- [ ] **PAR-40** System, Logs, Usage: Host memory used, total and percentage · P1
- [ ] **PAR-41** System, Logs, Usage: Gateway running status and detailed state description · P1
- [ ] **PAR-42** System, Logs, Usage: Stop the selected profile's gateway · P1
- [ ] **PAR-43** System, Logs, Usage: Create full engine backup and show archive path · P1
- [ ] **PAR-44** System, Logs, Usage: Download the completed engine backup archive · P1
- [ ] **PAR-45** System, Logs, Usage: Restore an uploaded archive with destructive confirmation · P1
- [ ] **PAR-47** System, Logs, Usage: Global critical and elevated disk warnings · P1
- [ ] **PAR-48** Channels: Show each platform's shared-listener callback URL · P1
- [ ] **PAR-49** Channels: Enable and disable individual channels · P1
- [ ] **PAR-50** Channels: Edit all returned platform environment settings · P1
- [ ] **PAR-51** Channels: View existing allowlist entries when opening settings · P1
- [ ] **PAR-52** Channels: Choose WhatsApp Bot or Self-chat mode · P1
- [ ] **PAR-53** Skills, Plugins, Connected apps: Learn a skill from local sources, a URL and free-form notes · P1
- [ ] **PAR-54** Skills, Plugins, Connected apps: Open hub skill details and preview SKILL.md before installation · P1
- [ ] **PAR-55** Skills, Plugins, Connected apps: Run or rerun a hub skill security scan · P1
- [ ] **PAR-56** Skills, Plugins, Connected apps: Inspect security verdict, install policy and severity totals · P1
- [ ] **PAR-57** Skills, Plugins, Connected apps: Install a plugin from an arbitrary identifier or repository URL · P1
- [ ] **PAR-58** Skills, Plugins, Connected apps: Browse and install curated, pinned catalog plugins · P1
- [ ] **PAR-59** Skills, Plugins, Connected apps: Review and accept expanded plugin capabilities during update · P1
- [ ] **PAR-6** Shell, Task board, Achievements: Create a board · P1
- [ ] **PAR-60** Skills, Plugins, Connected apps: Open any installed plugin dashboard tab · P1
- [ ] **PAR-61** Skills, Plugins, Connected apps: Edit and save schema-driven memory-provider settings · P1
- [ ] **PAR-62** Skills, Plugins, Connected apps: Install memory-provider dependencies and inspect per-step results · P1
- [ ] **PAR-63** Skills, Plugins, Connected apps: Add an HTTP MCP server with a bearer token · P1
- [ ] **PAR-64** Skills, Plugins, Connected apps: Authenticate an MCP server through browser OAuth · P1
- [ ] **PAR-65** Skills, Plugins, Connected apps: Enter and validate required MCP catalog credentials · P1
- [ ] **PAR-66** Chat: Choose a project folder or discovered repository · P1
- [ ] **PAR-67** Chat: Choose reasoning effort across all eight levels · P1
- [ ] **PAR-68** Schedules, Webhooks, Pairing: Attach one or multiple skills to a job · P1
- [ ] **PAR-69** Schedules, Webhooks, Pairing: Select a script for scheduled execution · P1
- [ ] **PAR-7** Shell, Task board, Achievements: Edit board name, description and default work directory · P1
- [ ] **PAR-70** Schedules, Webhooks, Pairing: Run script only and deliver stdout verbatim · P1
- [ ] **PAR-71** Schedules, Webhooks, Pairing: Continuity between successive runs · P1
- [ ] **PAR-72** Schedules, Webhooks, Pairing: Scheduler heartbeat staleness warning · P1
- [ ] **PAR-73** Schedules, Webhooks, Pairing: Automatic-enable restart outcome, errors and retry restart · P1
- [ ] **PAR-74** Schedules, Webhooks, Pairing: Webhook delivery choices: log, Telegram, Discord, Slack, email and GitHub comment · P1
- [ ] **PAR-75** Chats and history: Highlight matches within an opened transcript and jump to the first hit · P1
- [ ] **PAR-76** Chats and history: Automatically refresh session history when another process creates a session · P1
- [ ] **SHELL-51** Help: a chat that explains aqeelOS and finds what went wrong · P1
- [ ] **SYS-50** Email when the server goes down · P1
- [ ] **AUDIT-49** App shell: 12 smaller fixes · P2
- [ ] **AUDIT-50** Chat: 8 smaller fixes · P2
- [ ] **AUDIT-51** Agents: 8 smaller fixes · P2
- [ ] **AUDIT-52** Memory and Files: 6 smaller fixes · P2
- [ ] **AUDIT-53** Code page in aqeelOS: 6 smaller fixes · P2
- [ ] **AUDIT-54** Automations: 10 smaller fixes · P2
- [ ] **AUDIT-55** Channels: 5 smaller fixes · P2
- [ ] **AUDIT-56** Abilities: 7 smaller fixes · P2
- [ ] **AUDIT-57** Models: 10 smaller fixes · P2
- [ ] **AUDIT-58** System: 13 smaller fixes · P2
- [ ] **AUDIT-59** People and access: 4 smaller fixes · P2
- [ ] **AUDIT-60** Server: 6 smaller fixes · P2
- [ ] **AUDIT-61** Code app: 8 smaller fixes · P2
- [ ] **AUDIT-62** Code engine and desktop app: 4 smaller fixes · P2
- [ ] **AUDIT-63** Chrome extension: 5 smaller fixes · P2
- [ ] **AUDIT-65** Chrome extension: Stop should hold until the next chat turn · P2
- [ ] **AUTO-38** WhatsApp Business connection for a team number · P2
- [ ] **PAR-77** Shell, Task board, Achievements: 37 useful engine features to add · P2
- [ ] **PAR-79** Files and Memory: 15 useful engine features to add · P2
- [ ] **PAR-81** Models and agents: 40 useful engine features to add · P2
- [ ] **PAR-83** Settings and Keys: 23 useful engine features to add · P2
- [ ] **PAR-85** System, Logs, Usage: 34 useful engine features to add · P2
- [ ] **PAR-87** Channels: 13 useful engine features to add · P2
- [ ] **PAR-89** Skills, Plugins, Connected apps: 32 useful engine features to add · P2
- [ ] **PAR-91** Chat: 22 useful engine features to add · P2
- [ ] **PAR-93** Schedules, Webhooks, Pairing: 22 useful engine features to add · P2
- [ ] **PAR-95** Chats and history: 25 useful engine features to add · P2
- [ ] **PAR-78** Shell, Task board, Achievements: 4 small engine features to add · P3
- [ ] **PAR-80** Files and Memory: 6 small engine features to add · P3
- [ ] **PAR-82** Models and agents: 17 small engine features to add · P3
- [ ] **PAR-84** Settings and Keys: 12 small engine features to add · P3
- [ ] **PAR-86** System, Logs, Usage: 9 small engine features to add · P3
- [ ] **PAR-88** Channels: 8 small engine features to add · P3
- [ ] **PAR-90** Skills, Plugins, Connected apps: 7 small engine features to add · P3
- [ ] **PAR-92** Chat: 8 small engine features to add · P3
- [ ] **PAR-94** Schedules, Webhooks, Pairing: 4 small engine features to add · P3
- [ ] **PAR-96** Chats and history: 6 small engine features to add · P3

</details>
