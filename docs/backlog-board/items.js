// One list for BACKLOG.md and the board. status: todo | doing | you | check | done.
window.BOARD = {
 "updated": "19 Nov 2026, 07:55 UTC",
 "areas": {
  "fixer": "Fixer",
  "sales": "Customer lines (Kirimdev)",
  "pnp": "P&P agents",
  "threads": "Continue Threads",
  "engine": "Engine and agents",
  "roles": "Roles",
  "owner": "Owner items"
 },
 "items": [
  {
   "id": "FX-1",
   "area": "fixer",
   "p": 1,
   "status": "done",
   "server": "Both",
   "title": "Unblock the Fixer: its isolation check fails",
   "detail": "Fixed 19 Nov in three steps (a75c37d, a790ed2, dc78812): its own profile pinned to aq-fixer, a reused run folder no longer ends a run, the check makes its own work folder. Check passed on Elkiya (03:51) and P&P (04:48); proofs run to the end.",
   "refs": [
    "i4739f042",
    "i58e99224",
    "i32f78955",
    "i9acabc70"
   ]
  },
  {
   "id": "FX-2",
   "area": "fixer",
   "p": 2,
   "status": "done",
   "server": "Elkiya",
   "title": "Quick fixes made live could be lost on the next update",
   "detail": "Checked 19 Nov: both parts are in main and live (888e093): check_payment labels a tester's test-amount QRIS, and [FOTO] finds a Tripay ?f= picture, each with a test. The deploy's drift check found no live-only change. Fixer item closed.",
   "refs": [
    "i9530ba20"
   ]
  },
  {
   "id": "FX-3",
   "area": "fixer",
   "p": 3,
   "status": "done",
   "server": "Elkiya",
   "title": "New issues wrongly marked urgent for two agents",
   "detail": "Checked 19 Nov: the urgent-agents rule (Randy and Gilang's new issues filed urgent, Donna's setting) is in main with its test, and saving the Fixer settings keeps it (new test). Fixer item closed.",
   "refs": [
    "i5b45a23c"
   ]
  },
  {
   "id": "FX-4",
   "area": "fixer",
   "p": 3,
   "status": "done",
   "server": "Elkiya",
   "title": "Health check flags separate background helpers as duplicate work",
   "detail": "Fixed 19 Nov (e25809e): the engine's code kernels (one per session) are never counted as a script running twice.",
   "refs": [
    "i7768eb6f"
   ]
  },
  {
   "id": "FX-5",
   "area": "fixer",
   "p": 3,
   "status": "done",
   "server": "Both",
   "title": "Clean out Fixer items with no title",
   "detail": "19 Nov: untitled items read and handled one by one (closed with evidence, or fixed below).",
   "refs": [
    "i73d2e707",
    "i427ff007",
    "ib69acf62",
    "i04f68157"
   ]
  },
  {
   "id": "FX-6",
   "area": "fixer",
   "p": 3,
   "status": "done",
   "server": "Both",
   "title": "Give unnamed keys a plain name and purpose",
   "detail": "19 Nov: descriptions set for the Elkiya Creative bot token, the PnP Design key and Pixel's Slack bot token.",
   "refs": [
    "i3783c4a3",
    "i54c9d693",
    "i160b59d0"
   ]
  },
  {
   "id": "KD-1",
   "area": "sales",
   "p": 1,
   "status": "check",
   "server": "Elkiya",
   "title": "One answer per burst of customer messages",
   "detail": "Set 19 Nov: both lines answer 150 s after the customer's last message (resets on each bubble), at most 7 min after the first. To see in a test chat. Before: Amri #1: replies come per bubble, 3-5 min late, and miss the last question. The quiet wait already exists (90 s default, resets on each message): check Randy's and Gilang's quietSec, set 2-4 min, and make sure a new message replaces a reply already being written so one reply answers everything. Biomarkers also 4-6 min slow.",
   "refs": [
    "i0003b8dc"
   ]
  },
  {
   "id": "KD-2",
   "area": "sales",
   "p": 1,
   "status": "check",
   "server": "Elkiya",
   "title": "Fewer false handoffs to the team",
   "detail": "19 Nov: kit photos once per chat and the check's true facts are live (a636781, 5bb3fbc); a lost chat thread now gets one more try on a fresh thread (29cb177, the Fixer's ic17c5666 change that never reached main). To see in a test chat.",
   "refs": [
    "ic17c5666",
    "i5026fc4a"
   ]
  },
  {
   "id": "KD-3",
   "area": "sales",
   "p": 1,
   "status": "check",
   "server": "Elkiya",
   "title": "Gilang can't take any payment",
   "detail": "19 Nov: Gilang does make the QRIS; the check then held it as a wrong amount (test amount) and two holds handed the chat over. Fixed with KD-2. To see in a test chat. Before: Amri #7. Check Gilang's line: payment tool, price list and limits. Biomarkers also hands off payments it should create itself, and can't create them from the team topic.",
   "refs": [
    "i03cf9999"
   ]
  },
  {
   "id": "KD-4",
   "area": "sales",
   "p": 1,
   "status": "check",
   "server": "Elkiya",
   "title": "Payment QR made but not delivered to the customer",
   "detail": "19 Nov checked against the code: QR delivery fixes are in main with tests (kirim-guard, customer-tools). The check before sending was still holding QR replies for their [FOTO:] picture part (03:45 today): fixed in 27247bb. To see in a test chat with a QRIS.",
   "refs": [
    "i10e323ba",
    "i2043b125",
    "i5784e2f1",
    "i4717e236",
    "id1b17621"
   ]
  },
  {
   "id": "KD-5",
   "area": "sales",
   "p": 1,
   "status": "check",
   "server": "Elkiya",
   "title": "QRIS expiry time shown 1 hour later than real",
   "detail": "Fixed 19 Nov (daae2a4), live on Elkiya.",
   "refs": [
    "i10e323ba"
   ]
  },
  {
   "id": "KD-6",
   "area": "sales",
   "p": 1,
   "status": "check",
   "server": "Elkiya",
   "title": "Card payment links, not only QRIS",
   "detail": "Waiting to be checked.",
   "refs": [
    "i512d2725"
   ]
  },
  {
   "id": "KD-7",
   "area": "sales",
   "p": 1,
   "status": "check",
   "server": "Elkiya",
   "title": "Payment status: paid orders confirmed, no false \"no payment\"",
   "detail": "Biomarkers can't confirm a payment the provider marked paid; Continue Support says no payment was made when listing options. Waiting to be checked.",
   "refs": [
    "i5db7aedb",
    "i1b25ec10"
   ]
  },
  {
   "id": "KD-8",
   "area": "sales",
   "p": 1,
   "status": "check",
   "server": "Elkiya",
   "title": "Paid orders reach the team with the buyer's order details",
   "detail": "Two reports, waiting to be checked.",
   "refs": [
    "i52af1a58",
    "icb4dab9c"
   ]
  },
  {
   "id": "KD-9",
   "area": "sales",
   "p": 2,
   "status": "check",
   "server": "Elkiya",
   "title": "Test bank transfer charged the wrong amount",
   "detail": "In main: the tester amount applies to QRIS, VA and card (customer-tools). Tests cover QRIS only; to see a VA or card test payment live.",
   "refs": [
    "i28f521e1"
   ]
  },
  {
   "id": "KD-10",
   "area": "sales",
   "p": 1,
   "status": "done",
   "server": "Elkiya",
   "title": "Bundle price: approved Rp3.900.000 and a custom price link",
   "detail": "Checked 19 Nov: the price list charges the Reta+Pen bundle as one item at Rp3.900.000 and IG5 applies on top; no custom price needed.",
   "refs": [
    "i4168befc",
    "if04e2b00"
   ]
  },
  {
   "id": "KD-11",
   "area": "sales",
   "p": 1,
   "status": "check",
   "server": "Elkiya",
   "title": "Free pen or 5% code: one or the other, said up front",
   "detail": "Done 19 Nov: Randy's instructions say the free pen needs the total AFTER the 5% code above Rp5jt; if the code drops it below, he says so at once and lets the customer choose (Amri's fix). Before: Amri #6: Randy offered the free pen at 5.2 jt, then after the 5% code (4.94 jt) didn't, and the customer felt lied to. price-catalog checks the free item before the discount; the rule is one or the other. Fix the check, and Randy explains the choice before the code is used.",
   "refs": []
  },
  {
   "id": "KD-12",
   "area": "sales",
   "p": 1,
   "status": "check",
   "server": "Elkiya",
   "title": "A customer reply leaked internal planning notes again",
   "detail": "Second time. Waiting to be checked; add the case to the exit guard's leak tests.",
   "refs": [
    "i5e349bf6"
   ]
  },
  {
   "id": "KD-13",
   "area": "sales",
   "p": 2,
   "status": "check",
   "server": "Elkiya",
   "title": "Gilang's combination = main recommendation + add-on",
   "detail": "Done 19 Nov: Gilang's instructions define Combination Option = main product + one product for the other goal, with prices and total (it was only in the decisions file). Before: Amri #3: the combination option gives only the added product.",
   "refs": []
  },
  {
   "id": "KD-14",
   "area": "sales",
   "p": 2,
   "status": "todo",
   "server": "Elkiya",
   "title": "Gilang labels interested customers (I-<pep>)",
   "detail": "Gilang's interest labels are live (d23aca4). Left: the Fixer's \"clear a tester's labels\" tool (i98eb0fad) never reached main; to reapply with a test.",
   "refs": [
    "i98eb0fad"
   ]
  },
  {
   "id": "KD-15",
   "area": "sales",
   "p": 2,
   "status": "check",
   "server": "Elkiya",
   "title": "\"Not a doctor's service\" wording",
   "detail": "Done 19 Nov: both agents say they are research consultants for research compounds, cannot share a doctor's identity, and assure guidance by an experienced expert team. Before: Amri #5: Randy and Gilang say it badly. Say: compound research; we can't name a doctor, but customers are guided by an experienced team in research peptides.",
   "refs": []
  },
  {
   "id": "KD-16",
   "area": "sales",
   "p": 2,
   "status": "check",
   "server": "Elkiya",
   "title": "Don't let a lost lead go",
   "detail": "Done 19 Nov: both agents apologise once and keep the sale open with the best deal; never \"kabari saja kalau mau lanjut\". Before: Amri #8: Randy apologised and let Kak Helen go. Apologise, then offer the best deal.",
   "refs": []
  },
  {
   "id": "KD-17",
   "area": "sales",
   "p": 1,
   "status": "check",
   "server": "Elkiya",
   "title": "After payment: confirmation, pen tutorial, cartridge, calibration",
   "detail": "Built and live 19 Nov (e093c70): after a confirmed payment aqeelOS sends the line's list once: confirmation, and for pen orders the pen, cartridge and calibration tutorials with videos (vial orders: mixing). Set on Randy and Gilang. Before: Amri #9: Randy skips what the SOP says to send after a payment. Make it a fixed step after a paid status. Also: protocol PDFs couldn't be sent after setting protocols.",
   "refs": [
    "i19b649d9"
   ]
  },
  {
   "id": "KD-18",
   "area": "sales",
   "p": 2,
   "status": "check",
   "server": "Elkiya",
   "title": "Randy reads his full instructions and the website quiz answers",
   "detail": "19 Nov: Randy's full-instructions read is in main; the tool now offers read: true (2690361). To see live.",
   "refs": [
    "id051b007",
    "i77296280"
   ]
  },
  {
   "id": "KD-19",
   "area": "sales",
   "p": 2,
   "status": "done",
   "server": "Elkiya",
   "title": "Biomarkers Support lost seven instruction lines",
   "detail": "Checked 19 Nov: Gilang's instructions hold all the lost rules again (order-forward tag, tutorial videos, check_payment steps, Ask don't assume). Fixer item closed.",
   "refs": [
    "ibd8a5021"
   ]
  },
  {
   "id": "KD-20",
   "area": "sales",
   "p": 2,
   "status": "todo",
   "server": "Elkiya",
   "title": "Tester safety on deploys",
   "detail": "Tester chats never pause and the engine's fallback text never reaches a customer (in main, tested). Left: the Fixer's live-test change that treats a tester with an open turn as busy (i877d1a2d try 2) never reached main; to reapply.",
   "refs": [
    "i877d1a2d",
    "i87c8beb0",
    "ic88fca57"
   ]
  },
  {
   "id": "KD-21",
   "area": "sales",
   "p": 1,
   "status": "you",
   "server": "Elkiya",
   "title": "Donna can't sign back in to KirimDev",
   "detail": "19 Nov: Donna is the main agent, so aqeelOS cannot wake her screen; it wakes when she browses. Ask Donna to open the KirimDev sign-in page, then use Type a secret. Her daily fee-approval schedule uses the same session (from 12 Nov).",
   "refs": [
    "ia9525300"
   ]
  },
  {
   "id": "PP-1",
   "area": "pnp",
   "p": 1,
   "status": "done",
   "server": "P&P",
   "title": "Stop the rollback loop on every agent",
   "detail": "Done 19 Nov: the loop stopped on 12 Nov (15 Nov fix); no rollback since; every agent has the current graphify skill. The 10 stale items were closed. Before: Each agent shows \"Automatic rollback\" up to 221 times: the graphify SKILL.md copied in counts as the agent changing itself, it doesn't answer within 120 s on the busy box, aqeelOS undoes it, and it repeats. Copies made by aqeelOS must not count as self changes.",
   "refs": [
    "i6e684c36",
    "i7ee9c6c6",
    "i0fd55239",
    "if2adf215",
    "i14fb4524",
    "ic21ba295",
    "i91b9b9be",
    "iac0f63e7",
    "i2516b3d8",
    "i601b92f2"
   ]
  },
  {
   "id": "PP-2",
   "area": "pnp",
   "p": 1,
   "status": "doing",
   "server": "P&P",
   "title": "Fakhri's Wood Origins Airtable to Sheet sync",
   "detail": "19 Nov: the sync now runs as a script (not through the chat, since 17 Nov). Today's 06:00 run read 12,000 of 17,541 Airtable records, then Airtable answered 502 once and aqeelOS's tool bridge never reconnected (\"'NoneType' object has no attribute 'call_tool'\"), so nothing was written. Fixed: the bridge reconnects and retries the call once. Live with the next P&P deploy; tomorrow's 06:00 run is the proof. Sheet write access still needs OW-12.",
   "refs": [
    "i6c13dcf5",
    "i0772eb6f",
    "i20f9b25b",
    "i9cda9d1a",
    "i1c6ea691"
   ]
  },
  {
   "id": "PP-3",
   "area": "pnp",
   "p": 2,
   "status": "done",
   "server": "P&P",
   "title": "Fakhri signs in to Google Sheets in n8n",
   "detail": "Closed 19 Nov: not needed, the sync uses the agent's own sign-ins through the tool bridge. Before: Open n8n on Fakhri Agent's screen so Fakhri signs in. Possibly not needed once PP-2 works through the tool bridge; close it then.",
   "refs": [
    "ibad82e9f"
   ]
  },
  {
   "id": "PP-4",
   "area": "pnp",
   "p": 3,
   "status": "done",
   "server": "P&P",
   "title": "Read-only Airtable key for Wood Origins",
   "detail": "Closed 19 Nov: not needed, no key is used. Before: Not needed if the tool bridge works (it uses the agent's own Airtable sign-in). Close after PP-2.",
   "refs": [
    "i9c3f0be5"
   ]
  },
  {
   "id": "PP-5",
   "area": "pnp",
   "p": 2,
   "status": "done",
   "server": "P&P",
   "title": "SDR and Content assistant read uploaded files",
   "detail": "Checked 19 Nov: every uploaded file is readable and both agents have folder access, also for new files (OPS-18).",
   "refs": [
    "i3a7a4cb6",
    "i03f117e5"
   ]
  },
  {
   "id": "PP-6",
   "area": "pnp",
   "p": 2,
   "status": "done",
   "server": "P&P",
   "title": "Automatic update failed its final check",
   "detail": "Checked 19 Nov: a one-off on 11 Nov; every update since passed. The real blocker was GitHub's tests failing on main since a75c37d (my commits): fixed, green again on ae47165, so P&P updates itself again.",
   "refs": [
    "i46105c3e"
   ]
  },
  {
   "id": "PP-7",
   "area": "pnp",
   "p": 1,
   "status": "check",
   "server": "P&P",
   "title": "Pixel answers team members in Slack",
   "detail": "Done 19 Nov: team list filled (owner + 6). To see: Pixel answers Aldillah. Before: Done 19 Nov: P&P's team list was empty, so every Slack sender was unverified. Filled from the Slack member list (owner Aqeel + 6 members, guests out). Still to see: Pixel answering Aldillah.",
   "refs": [
    "i9b077056"
   ]
  },
  {
   "id": "PP-8",
   "area": "pnp",
   "p": 2,
   "status": "check",
   "server": "Both",
   "title": "Alert when an install's team list is empty",
   "detail": "Built 19 Nov (6275127), live on both servers.",
   "refs": []
  },
  {
   "id": "TH-1",
   "area": "threads",
   "p": 1,
   "status": "done",
   "server": "Elkiya",
   "title": "Restore the Threads runners",
   "detail": "Checked 19 Nov: all four runners are on and ran this morning; stale items closed.",
   "refs": [
    "i042a5d9d",
    "i2264ae15",
    "i72e2e9f9",
    "i00664cc8"
   ]
  },
  {
   "id": "TH-2",
   "area": "threads",
   "p": 2,
   "status": "you",
   "server": "Elkiya",
   "title": "Threads Manager's Telegram connection",
   "detail": "19 Nov: the 18 Nov route that sends Telegram outside the VPN never went live: the running VPN script is the 23 Oct copy, installed only when the container starts. Needs the AI box container restarted in quiet hours (OW-10). Telegram errors already fell from ~12,400 a day to ~150.",
   "refs": [
    "i9bee39e2",
    "i70899556"
   ]
  },
  {
   "id": "TH-3",
   "area": "threads",
   "p": 2,
   "status": "done",
   "server": "Elkiya",
   "title": "n8n tool server won't start (Threads, SEO specialist)",
   "detail": "Checked 19 Nov: n8n answers with its full tool list for Threads and the SEO specialist.",
   "refs": [
    "i76f30eaf",
    "i4682773e"
   ]
  },
  {
   "id": "TH-4",
   "area": "threads",
   "p": 2,
   "status": "done",
   "server": "Elkiya",
   "title": "A post may have gone live without being recorded",
   "detail": "Expired by its own rule; posts are recorded normally.",
   "refs": [
    "i0200628e"
   ]
  },
  {
   "id": "TH-5",
   "area": "threads",
   "p": 2,
   "status": "done",
   "server": "Elkiya",
   "title": "Schedules still run old instructions",
   "detail": "The old schedules are off; their work moved to the runners, which use the current instructions.",
   "refs": [
    "i29f8ce5c"
   ]
  },
  {
   "id": "TH-6",
   "area": "threads",
   "p": 2,
   "status": "done",
   "server": "Elkiya",
   "title": "Posting gate script can't be checked",
   "detail": "By design: the posting gate is aqeelOS's limit check, not instructions to edit.",
   "refs": [
    "i2b72c1c4"
   ]
  },
  {
   "id": "TH-7",
   "area": "threads",
   "p": 2,
   "status": "done",
   "server": "Elkiya",
   "title": "Label and video tool folders unreachable",
   "detail": "The tools are in the agent's own home (~/work/labels), owned by it.",
   "refs": [
    "i7a41d501"
   ]
  },
  {
   "id": "TH-8",
   "area": "threads",
   "p": 3,
   "status": "done",
   "server": "Elkiya",
   "title": "Threads reply schedule reports a missing tool",
   "detail": "No missing tool in the last 40 runs; one-off.",
   "refs": [
    "iea5a7e6a"
   ]
  },
  {
   "id": "EN-1",
   "area": "engine",
   "p": 1,
   "status": "you",
   "server": "Elkiya",
   "title": "Telegram replies and Donna's voice notes",
   "detail": "See TH-2: the Telegram route needs the box container restarted (OW-10).",
   "refs": [
    "i02fd3fa8"
   ]
  },
  {
   "id": "EN-2",
   "area": "engine",
   "p": 2,
   "status": "you",
   "server": "Elkiya",
   "title": "Donna's Meta Ads tools don't start",
   "detail": "19 Nov: Donna's Meta Ads connection was never signed in (no saved sign-in). Sign in on Connections › Meta Ads (OW-11).",
   "refs": [
    "i76088b47"
   ]
  },
  {
   "id": "EN-3",
   "area": "engine",
   "p": 2,
   "status": "done",
   "server": "Elkiya",
   "title": "Agent stuck loading the same skill, no reply",
   "detail": "One-off: the loop guard stopped a repeat, as designed.",
   "refs": [
    "icf43ba65"
   ]
  },
  {
   "id": "EN-4",
   "area": "engine",
   "p": 3,
   "status": "done",
   "server": "Elkiya",
   "title": "Maps skill points to a missing script",
   "detail": "Every agent's maps skill finds its script.",
   "refs": [
    "i13138cea"
   ]
  },
  {
   "id": "EN-5",
   "area": "engine",
   "p": 2,
   "status": "done",
   "server": "Elkiya",
   "title": "AI account moves: spare quota failing, daily cap hit",
   "detail": "The moves were real limits (Claude accounts at 96-100%), as designed; the subscriptions run full on busy days.",
   "refs": [
    "ibf0203b5",
    "i2cf129b0"
   ]
  },
  {
   "id": "EN-6",
   "area": "engine",
   "p": 3,
   "status": "you",
   "server": "Elkiya",
   "title": "Pep Club chat uses a different model than selected",
   "detail": "19 Nov: the old fix is replaced by per-agent model order (16 Nov). Pep Club Social has no order of its own yet: set its model order (fallbacks off) in Models, or tell me which model.",
   "refs": [
    "i4731c443"
   ]
  },
  {
   "id": "EN-7",
   "area": "engine",
   "p": 3,
   "status": "done",
   "server": "Elkiya",
   "title": "Code: project tools reject the chat as outside a run",
   "detail": "By design: Code project tools work only inside a Code run.",
   "refs": [
    "i0895fcb3"
   ]
  },
  {
   "id": "EN-8",
   "area": "engine",
   "p": 3,
   "status": "todo",
   "server": "Elkiya",
   "title": "Browser choice prompt expires before the owner answers",
   "detail": "Not fixed in main: the browser-choice prompt still waits 270 s. The Fixer's patch (answer at once when nobody has the web chat open) is on the box; to reapply outside server.mjs.",
   "refs": [
    "i26680424"
   ]
  },
  {
   "id": "EN-9",
   "area": "engine",
   "p": 3,
   "status": "done",
   "server": "Elkiya",
   "title": "Schedule wake-up card only offers Keep as it is",
   "detail": "Fixed 13 Nov (77a30d3).",
   "refs": [
    "i3ca9594f"
   ]
  },
  {
   "id": "EN-10",
   "area": "engine",
   "p": 3,
   "status": "check",
   "server": "Elkiya",
   "title": "Night page check: switching pages quickly",
   "detail": "Fixed 19 Nov (05795e1): the night check could not sign in to the test copy since owners have email sign-in, so it never saw a page. Tonight's run is the proof.",
   "refs": [
    "ib15104b3"
   ]
  },
  {
   "id": "EN-11",
   "area": "engine",
   "p": 3,
   "status": "todo",
   "server": "Elkiya",
   "title": "Overnight AdmissionSight build",
   "detail": "Not fixed: a restart does not wait for background delegations. The Fixer's engine patch (i90830fb0) is on the box; to add as an engine patch.",
   "refs": [
    "i90830fb0"
   ]
  },
  {
   "id": "RO-1",
   "area": "roles",
   "p": 1,
   "status": "done",
   "server": "Both",
   "title": "Review the roles design and answer 4 questions",
   "detail": "Approved 19 Nov with the owner's four answers: Kirimdev stays admin-only; only outside-facing channels need his OK to open to anyone; 5 agents per Builder; only the owner approves a guard.",
   "refs": []
  },
  {
   "id": "RO-2",
   "area": "roles",
   "p": 2,
   "status": "done",
   "server": "Both",
   "title": "Agent-scope rule, guards and the role checks",
   "detail": "Built 19 Nov (2d1ec2b): app/role-scope.mjs; the gate lets an agent's owner or editor use its channel and webhook routes, never the main agent; the open-door guard asks the owner; rights matrix updated (one intended change).",
   "refs": []
  },
  {
   "id": "RO-3",
   "area": "roles",
   "p": 2,
   "status": "check",
   "server": "Both",
   "title": "Channels for Builders",
   "detail": "Built 19 Nov (2d1ec2b, 24ed2bb): Channels in the menu for anyone who owns or edits an agent, their agents only, restart that one agent from the page. Deploying; to see as Aldillah.",
   "refs": []
  },
  {
   "id": "RO-4",
   "area": "roles",
   "p": 2,
   "status": "check",
   "server": "Both",
   "title": "Keys and Health tabs on each agent",
   "detail": "Keys (888e093) and Health (e01768b) built. Checked 19 Nov on P&P's test copy: a Can edit person sees the agent on Health, its keys (never a value in full, no engine settings), Activity and channels; the main agent is refused (58/58). Deploying to both; then to see as Aldillah.",
   "refs": []
  },
  {
   "id": "RO-5",
   "area": "roles",
   "p": 3,
   "status": "check",
   "server": "Both",
   "title": "Webhooks, Memory, agent Files, Activity for Builders",
   "detail": "Built 19 Nov: Memory and Webhooks (69b0154), agent workspace Files and Activity (888e093) for an agent's owner or editor. Live on Elkiya; deploying to P&P. To see as Aldillah.",
   "refs": []
  },
  {
   "id": "RO-6",
   "area": "roles",
   "p": 3,
   "status": "check",
   "server": "Both",
   "title": "Menu from scopes; Creator becomes Builder; move people",
   "detail": "19 Nov (69b0154): Creator is Builder; new installs give Builders terminal and file tools; existing rights unchanged. People keep their role.",
   "refs": []
  },
  {
   "id": "OW-1",
   "area": "owner",
   "p": 1,
   "status": "done",
   "server": "Elkiya",
   "title": "Paste Donna's issues from this morning",
   "detail": "Read 19 Nov from Donna's Telegram (the engine keeps every chat): your Notion backlog feedback (only tasks you own, mark finished ones done; saved as her rules) and the Master To Do views she broke and restored (PP-9). Engine problems seen there: EN-13.",
   "refs": []
  },
  {
   "id": "OW-2",
   "area": "owner",
   "p": 1,
   "status": "you",
   "server": "Both",
   "title": "GitHub settings for the Fixer (AUD-7)",
   "detail": "Branch rule with code-owner review and no admin bypass, remove the write deploy key, a fixer token on a non-owner account. Unblocks \"Fixer can't push finished fixes\" and the cloud fixer on P&P.",
   "refs": [
    "i34f52c6e",
    "ic3e9e6e2"
   ]
  },
  {
   "id": "OW-3",
   "area": "owner",
   "p": 2,
   "status": "you",
   "server": "Elkiya",
   "title": "Higgsfield sign-in for Threads and Continue Support",
   "detail": "",
   "refs": [
    "ibfcada63",
    "i2ef45d64"
   ]
  },
  {
   "id": "OW-4",
   "area": "owner",
   "p": 2,
   "status": "you",
   "server": "Both",
   "title": "Telegram group topics: one group = one session?",
   "detail": "Your decision: 1 group = 1 session, 1 topic = sub-session, for all agents.",
   "refs": [
    "i7b21f234"
   ]
  },
  {
   "id": "OW-5",
   "area": "owner",
   "p": 1,
   "status": "you",
   "server": "Both",
   "title": "Security rotations (AUD-9)",
   "detail": "GitHub password, two-step seed and token from Elkiya's engine env; member-app admin password; continue-threads Telegram bot token; old repo history and Cloudflare-only origins.",
   "refs": []
  },
  {
   "id": "OW-6",
   "area": "owner",
   "p": 2,
   "status": "you",
   "server": "Elkiya",
   "title": "Swap on the Elkiya host (OPS-17)",
   "detail": "16 GB swap; 154 GB free.",
   "refs": []
  },
  {
   "id": "OW-7",
   "area": "owner",
   "p": 2,
   "status": "you",
   "server": "Both",
   "title": "Review aqeelOS v2 on the live servers",
   "detail": "v2 is the UI everywhere since 14 Nov, v1 at /v1.",
   "refs": []
  },
  {
   "id": "OW-8",
   "area": "owner",
   "p": 3,
   "status": "you",
   "server": "P&P",
   "title": "Sheets API in P&P's Google Cloud project",
   "detail": "The Sheets API is off in P&P's Google Cloud project 175768419761: open https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=175768419761 signed in as the project owner and click Enable. Before: One link from the Needs-you item when it shows.",
   "refs": []
  },
  {
   "id": "DN-1",
   "area": "pnp",
   "p": 1,
   "status": "done",
   "server": "P&P",
   "title": "P&P team list filled",
   "detail": "Owner Aqeel + Aisar, Faisal, Firdha, Rifqi, Fakhri, Aldillah by Slack id; guests left out; checked by the rule.",
   "refs": []
  },
  {
   "id": "DN-2",
   "area": "roles",
   "p": 1,
   "status": "done",
   "server": "Both",
   "title": "Roles design written",
   "detail": "docs/roles-design.md.",
   "refs": []
  },
  {
   "id": "DN-3",
   "area": "owner",
   "p": 3,
   "status": "done",
   "server": "Both",
   "title": "Backlog brought up to 18 Nov",
   "detail": "16-18 Nov work recorded; both servers on 7e6e757.",
   "refs": []
  },
  {
   "id": "OW-9",
   "area": "owner",
   "p": 1,
   "status": "you",
   "server": "P&P",
   "title": "Fakhri signs in to Airtable again",
   "detail": "His agent's Airtable sign-in expired and Airtable refused the renewal. Fakhri: aqeelOS › Abilities › Connections › Airtable › Sign in (on Fakhri Agent). Then the Wood Origins sync runs again.",
   "refs": [
    "i0772eb6f",
    "i20f9b25b"
   ]
  },
  {
   "id": "OW-10",
   "area": "owner",
   "p": 1,
   "status": "you",
   "server": "Elkiya",
   "title": "Restart the AI box container in quiet hours",
   "detail": "Dokploy › AI VPS › ai-box › Redeploy, between 01:00 and 05:00 WIB (every agent drops for a few minutes). Installs the current root scripts, among them the 18 Nov route that keeps Telegram off the VPN. Or say yes and I do it at night.",
   "refs": [
    "i02fd3fa8",
    "i9bee39e2",
    "i70899556"
   ]
  },
  {
   "id": "OW-11",
   "area": "owner",
   "p": 2,
   "status": "you",
   "server": "Elkiya",
   "title": "Sign in to Meta Ads for Donna",
   "detail": "aqeelOS › Abilities › Connections › Meta Ads (Donna) › Sign in with your Facebook account.",
   "refs": [
    "i76088b47"
   ]
  },
  {
   "id": "OW-12",
   "area": "owner",
   "p": 1,
   "status": "you",
   "server": "P&P",
   "title": "Edit access to the Wood Origins sheet for Fakhri Agent",
   "detail": "His agent only has read access through your P&P Google account. Either share that Google account with Fakhri Agent with read + write in Connections, or Fakhri connects his own Google account that can edit the sheet.",
   "refs": [
    "i04f68157"
   ]
  },
  {
   "id": "EN-12",
   "area": "engine",
   "p": 2,
   "status": "todo",
   "server": "Both",
   "title": "Daily review of every agent's chats",
   "detail": "Owner's idea, 19 Nov: the engine keeps every chat (Telegram, Slack, WhatsApp, schedules) and I can read them on both servers. Once a day, read what each agent was asked and how it went, and file what went wrong (dropped or doubled messages, mistakes, unhappy people) on this board or for the Fixer. Customer chats stay private: only the problem goes on the board.",
   "refs": []
  },
  {
   "id": "EN-13",
   "area": "engine",
   "p": 2,
   "status": "todo",
   "server": "Elkiya",
   "title": "Telegram messages stored twice; one dropped when two arrive at once",
   "detail": "Seen 19 Nov in Donna's Telegram chats: every message from the owner is saved twice in the engine, and at 11:02 WIB a second message got \"Your request was not processed\" because it arrived while the first was being answered. Find out why and fix.",
   "refs": []
  },
  {
   "id": "PP-9",
   "area": "owner",
   "p": 3,
   "status": "check",
   "server": "Elkiya",
   "title": "Donna: Master To Do views restored after her Context change",
   "detail": "19 Nov morning: adding the Context column made Donna hide every other column in your 5 Notion views (no data lost). She put the columns back but did not look at the result. Open Master To Do and say if a view still looks wrong. Your two rules (only tasks you own; close finished ones) are saved in her task rules.",
   "refs": []
  },
  {
   "id": "WA-1",
   "area": "sales",
   "p": 2,
   "status": "todo",
   "server": "Both",
   "title": "WhatsApp chats show where the person came from (first and last touch, UTM)",
   "detail": "Owner's idea, 19 Nov: when someone taps a WhatsApp button on a site, the chat opens with where they came from (\"Halo, saya dari ...\" plus a short code), and the team and agent see the source. Keep layers: first touch, last touch, and the last paid touch (ad campaign UTM, fbclid/gclid), kept for days in the browser, so an ad still gets the credit when the person converts later on a direct visit. Show it on the chat (Kirimdev labels, Meta Ads/WhatsApp lead), and report which source turned into a sale. Wood Origins already has a short hash-code version on 3 landing pages (lookup table of ad rows); this generalises it. To decide first: which sites, and whether the code is visible in the message or hidden.",
   "refs": []
  }
 ]
};
