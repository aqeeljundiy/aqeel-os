// One list for BACKLOG.md and the board. status: todo | doing | you | check | done. p: 1 first, 3 later.
// server: Elkiya | P&P | Both. refs: Fixer issue ids.
window.BOARD = {
updated: "19 Nov 2026",
areas: {
 fixer: "Fixer",
 sales: "Customer lines (Kirimdev)",
 pnp: "P&P agents",
 threads: "Continue Threads",
 engine: "Engine and agents",
 roles: "Roles",
 owner: "Owner items"
},
items: [
// ---------- Fixer ----------
{id:"FX-1",area:"fixer",p:1,status:"todo",server:"Both",title:"Unblock the Fixer: its isolation check fails",detail:"Held on both servers since its last check did not see the engine run tools as aq-fixer (the check's session was cut: \"Execution outcome is unknown\"). Nothing below gets fixed by itself until this clears. Find why the check session is cut, make the check survive it, see a code fix run as aq-fixer.",refs:["i4739f042","i58e99224","i32f78955","i9acabc70"]},
{id:"FX-2",area:"fixer",p:2,status:"check",server:"Elkiya",title:"Quick fixes made live could be lost on the next update",detail:"Fixed by the Fixer, waiting to be checked (reported 277 times). Check no live-only change is left on the box that main lacks.",refs:["i9530ba20"]},
{id:"FX-3",area:"fixer",p:3,status:"check",server:"Elkiya",title:"New issues wrongly marked urgent for two agents",detail:"Waiting to be checked.",refs:["i5b45a23c"]},
{id:"FX-4",area:"fixer",p:3,status:"todo",server:"Elkiya",title:"Health check flags separate background helpers as duplicate work",detail:"False alarm on Continue Threads.",refs:["i7768eb6f"]},
{id:"FX-5",area:"fixer",p:3,status:"todo",server:"Both",title:"Clean out Fixer items with no title",detail:"\"Health check (schedule / update / report / fixer_full_rights)\", \"Parallel research delegation\": read each, close or give it a real title.",refs:["i73d2e707","i427ff007","ib69acf62","i04f68157"]},
{id:"FX-6",area:"fixer",p:3,status:"todo",server:"Both",title:"Give unnamed keys a plain name and purpose",detail:"The design app's key, a Slack bot key on P&P, elkiya-creative's unnamed items.",refs:["i3783c4a3","i54c9d693","i160b59d0"]},

// ---------- Customer lines (Kirimdev) ----------
{id:"KD-1",area:"sales",p:1,status:"todo",server:"Elkiya",title:"One answer per burst of customer messages",detail:"Amri #1: replies come per bubble, 3-5 min late, and miss the last question. The quiet wait already exists (90 s default, resets on each message): check Randy's and Gilang's quietSec, set 2-4 min, and make sure a new message replaces a reply already being written so one reply answers everything. Biomarkers also 4-6 min slow.",refs:["i0003b8dc"]},
{id:"KD-2",area:"sales",p:1,status:"todo",server:"Elkiya",title:"Fewer false handoffs to the team",detail:"Amri #2: chats the AI could handle go to human CS and replies are held. Go through the false alarms Donna logged, tighten kirim-review and the handoff rules so only real cases go to people. Includes a chat that stopped after a hold message and kit photos re-sent until the customer is stuck on hold.",refs:["ic17c5666","i5026fc4a"]},
{id:"KD-3",area:"sales",p:1,status:"todo",server:"Elkiya",title:"Gilang can't take any payment",detail:"Amri #7. Check Gilang's line: payment tool, price list and limits. Biomarkers also hands off payments it should create itself, and can't create them from the team topic.",refs:["i03cf9999"]},
{id:"KD-4",area:"sales",p:1,status:"check",server:"Elkiya",title:"Payment QR made but not delivered to the customer",detail:"QR never reached the customer, or the text after the QR image was dropped, or the reply went out without the QR. Round 17: Gilang's QRIS never reached tester 3124. Fixes waiting to be checked; the needs-human one includes the expiry shown 1 hour late (KD-5).",refs:["i10e323ba","i2043b125","i5784e2f1","i4717e236","id1b17621"]},
{id:"KD-5",area:"sales",p:1,status:"todo",server:"Elkiya",title:"QRIS expiry time shown 1 hour later than real",detail:"Time zone in the expiry text (WIB vs the provider's time).",refs:["i10e323ba"]},
{id:"KD-6",area:"sales",p:1,status:"check",server:"Elkiya",title:"Card payment links, not only QRIS",detail:"Waiting to be checked.",refs:["i512d2725"]},
{id:"KD-7",area:"sales",p:1,status:"check",server:"Elkiya",title:"Payment status: paid orders confirmed, no false \"no payment\"",detail:"Biomarkers can't confirm a payment the provider marked paid; Continue Support says no payment was made when listing options. Waiting to be checked.",refs:["i5db7aedb","i1b25ec10"]},
{id:"KD-8",area:"sales",p:1,status:"check",server:"Elkiya",title:"Paid orders reach the team with the buyer's order details",detail:"Two reports, waiting to be checked.",refs:["i52af1a58","icb4dab9c"]},
{id:"KD-9",area:"sales",p:2,status:"check",server:"Elkiya",title:"Test bank transfer charged the wrong amount",detail:"Waiting to be checked.",refs:["i28f521e1"]},
{id:"KD-10",area:"sales",p:1,status:"todo",server:"Elkiya",title:"Bundle price: approved Rp3.900.000 and a custom price link",detail:"The quote still uses the old bundle price; a bundle payment link can't be made without a custom price option. Update the price list (no prices from the model).",refs:["i4168befc","if04e2b00"]},
{id:"KD-11",area:"sales",p:1,status:"todo",server:"Elkiya",title:"Free pen or 5% code: one or the other, said up front",detail:"Amri #6: Randy offered the free pen at 5.2 jt, then after the 5% code (4.94 jt) didn't, and the customer felt lied to. price-catalog checks the free item before the discount; the rule is one or the other. Fix the check, and Randy explains the choice before the code is used.",refs:[]},
{id:"KD-12",area:"sales",p:1,status:"check",server:"Elkiya",title:"A customer reply leaked internal planning notes again",detail:"Second time. Waiting to be checked; add the case to the exit guard's leak tests.",refs:["i5e349bf6"]},
{id:"KD-13",area:"sales",p:2,status:"todo",server:"Elkiya",title:"Gilang's combination = main recommendation + add-on",detail:"Amri #3: the combination option gives only the added product.",refs:[]},
{id:"KD-14",area:"sales",p:2,status:"todo",server:"Elkiya",title:"Gilang labels interested customers (I-<pep>)",detail:"Amri #4: labels still often missed. Also: labels can't all be cleared from a test contact after a reset.",refs:["i98eb0fad"]},
{id:"KD-15",area:"sales",p:2,status:"todo",server:"Elkiya",title:"\"Not a doctor's service\" wording",detail:"Amri #5: Randy and Gilang say it badly. Say: compound research; we can't name a doctor, but customers are guided by an experienced team in research peptides.",refs:[]},
{id:"KD-16",area:"sales",p:2,status:"todo",server:"Elkiya",title:"Don't let a lost lead go",detail:"Amri #8: Randy apologised and let Kak Helen go. Apologise, then offer the best deal.",refs:[]},
{id:"KD-17",area:"sales",p:1,status:"todo",server:"Elkiya",title:"After payment: confirmation, pen tutorial, cartridge, calibration",detail:"Amri #9: Randy skips what the SOP says to send after a payment. Make it a fixed step after a paid status. Also: protocol PDFs couldn't be sent after setting protocols.",refs:["i19b649d9"]},
{id:"KD-18",area:"sales",p:2,status:"check",server:"Elkiya",title:"Randy reads his full instructions and the website quiz answers",detail:"Waiting to be checked.",refs:["id051b007","i77296280"]},
{id:"KD-19",area:"sales",p:2,status:"check",server:"Elkiya",title:"Biomarkers Support lost seven instruction lines",detail:"Waiting to be checked: compare with its last good version.",refs:["ibd8a5021"]},
{id:"KD-20",area:"sales",p:2,status:"check",server:"Elkiya",title:"Tester safety on deploys",detail:"Deploy check no longer writes into a real tester's chat (done 17 Nov, 7f8a6e7); keep the tester pause after a restart; test chats got an engine error instead of a reply (08baebe). Check live and close.",refs:["i877d1a2d","i87c8beb0","ic88fca57"]},
{id:"KD-21",area:"sales",p:1,status:"todo",server:"Elkiya",title:"Donna can't sign back in to KirimDev",detail:"type_secret says the agent's screen is not running while her browser is open on the KirimDev sign-in page. Stuck.",refs:["ia9525300"]},

// ---------- P&P agents ----------
{id:"PP-1",area:"pnp",p:1,status:"todo",server:"P&P",title:"Stop the rollback loop on every agent",detail:"Each agent shows \"Automatic rollback\" up to 221 times: the graphify SKILL.md copied in counts as the agent changing itself, it doesn't answer within 120 s on the busy box, aqeelOS undoes it, and it repeats. Copies made by aqeelOS must not count as self changes.",refs:["i6e684c36","i7ee9c6c6","i0fd55239","if2adf215","i14fb4524","ic21ba295","i91b9b9be","iac0f63e7","i2516b3d8","i601b92f2"]},
{id:"PP-2",area:"pnp",p:1,status:"todo",server:"P&P",title:"Fakhri's Wood Origins Airtable to Sheet sync",detail:"Tool bridge signature still rejected after the 17 Nov fix, so the sheet sync stopped and the daily 06:00 WIB lead sync keeps failing. Fix the signature, run the sync once, watch the next morning's run.",refs:["i6c13dcf5","i0772eb6f","i20f9b25b","i9cda9d1a","i1c6ea691"]},
{id:"PP-3",area:"pnp",p:2,status:"you",server:"P&P",title:"Fakhri signs in to Google Sheets in n8n",detail:"Open n8n on Fakhri Agent's screen so Fakhri signs in. Possibly not needed once PP-2 works through the tool bridge; close it then.",refs:["ibad82e9f"]},
{id:"PP-4",area:"pnp",p:3,status:"you",server:"P&P",title:"Read-only Airtable key for Wood Origins",detail:"Not needed if the tool bridge works (it uses the agent's own Airtable sign-in). Close after PP-2.",refs:["i9c3f0be5"]},
{id:"PP-5",area:"pnp",p:2,status:"todo",server:"P&P",title:"SDR and Content assistant read uploaded files",detail:"Fixes made (state: deploy). Ship and check both open their uploaded PDF and company profiles.",refs:["i3a7a4cb6","i03f117e5"]},
{id:"PP-6",area:"pnp",p:2,status:"check",server:"P&P",title:"Automatic update failed its final check",detail:"The old version was kept. Find which check failed; both servers now run 7e6e757.",refs:["i46105c3e"]},
{id:"PP-7",area:"pnp",p:1,status:"check",server:"P&P",title:"Pixel answers team members in Slack",detail:"Done 19 Nov: P&P's team list was empty, so every Slack sender was unverified. Filled from the Slack member list (owner Aqeel + 6 members, guests out). Still to see: Pixel answering Aldillah.",refs:["i9b077056"]},
{id:"PP-8",area:"pnp",p:2,status:"todo",server:"Both",title:"Alert when an install's team list is empty",detail:"Slack or another team channel connected and nobody on the team list = one Needs-you item.",refs:[]},

// ---------- Continue Threads ----------
{id:"TH-1",area:"threads",p:1,status:"todo",server:"Elkiya",title:"Restore the Threads runners",detail:"Own-post runner 738e7a2cea4f, comment + DM runner 198bc372ee48, outbound DM runner 2ea603717676. Without messaging the owner or customers.",refs:["i042a5d9d","i2264ae15","i72e2e9f9","i00664cc8"]},
{id:"TH-2",area:"threads",p:2,status:"todo",server:"Elkiya",title:"Threads Manager's Telegram connection",detail:"Unstable; check after the 18 Nov VPN change first.",refs:["i9bee39e2","i70899556"]},
{id:"TH-3",area:"threads",p:2,status:"todo",server:"Elkiya",title:"n8n tool server won't start (Threads, SEO specialist)",detail:"",refs:["i76f30eaf","i4682773e"]},
{id:"TH-4",area:"threads",p:2,status:"todo",server:"Elkiya",title:"A post may have gone live without being recorded",detail:"Posting limits count recorded posts; find it and record it.",refs:["i0200628e"]},
{id:"TH-5",area:"threads",p:2,status:"check",server:"Elkiya",title:"Schedules still run old instructions",detail:"Waiting to be checked.",refs:["i29f8ce5c"]},
{id:"TH-6",area:"threads",p:2,status:"todo",server:"Elkiya",title:"Posting gate script can't be checked",detail:"Stuck: unknown posting-gate script on the comment runner.",refs:["i2b72c1c4"]},
{id:"TH-7",area:"threads",p:2,status:"todo",server:"Elkiya",title:"Label and video tool folders unreachable",detail:"Stuck: continue-vial-labels skill's generator files.",refs:["i7a41d501"]},
{id:"TH-8",area:"threads",p:3,status:"todo",server:"Elkiya",title:"Threads reply schedule reports a missing tool",detail:"",refs:["iea5a7e6a"]},

// ---------- Engine and agents ----------
{id:"EN-1",area:"engine",p:1,status:"check",server:"Elkiya",title:"Telegram replies and Donna's voice notes",detail:"Proxy errors; 18 Nov sends Telegram outside the VPN and keeps messages during restarts. Check a voice note downloads, then close.",refs:["i02fd3fa8"]},
{id:"EN-2",area:"engine",p:2,status:"todo",server:"Elkiya",title:"Donna's Meta Ads tools don't start",detail:"",refs:["i76088b47"]},
{id:"EN-3",area:"engine",p:2,status:"todo",server:"Elkiya",title:"Agent stuck loading the same skill, no reply",detail:"",refs:["icf43ba65"]},
{id:"EN-4",area:"engine",p:3,status:"todo",server:"Elkiya",title:"Maps skill points to a missing script",detail:"",refs:["i13138cea"]},
{id:"EN-5",area:"engine",p:2,status:"todo",server:"Elkiya",title:"AI account moves: spare quota failing, daily cap hit",detail:"Accounts with quota keep failing; Sesa made eight automatic moves.",refs:["ibf0203b5","i2cf129b0"]},
{id:"EN-6",area:"engine",p:3,status:"check",server:"Elkiya",title:"Pep Club chat uses a different model than selected",detail:"Waiting to be checked.",refs:["i4731c443"]},
{id:"EN-7",area:"engine",p:3,status:"todo",server:"Elkiya",title:"Code: project tools reject the chat as outside a run",detail:"",refs:["i0895fcb3"]},
{id:"EN-8",area:"engine",p:3,status:"check",server:"Elkiya",title:"Browser choice prompt expires before the owner answers",detail:"Waiting to be checked.",refs:["i26680424"]},
{id:"EN-9",area:"engine",p:3,status:"todo",server:"Elkiya",title:"Schedule wake-up card only offers Keep as it is",detail:"",refs:["i3ca9594f"]},
{id:"EN-10",area:"engine",p:3,status:"todo",server:"Elkiya",title:"Night page check: switching pages quickly",detail:"",refs:["ib15104b3"]},
{id:"EN-11",area:"engine",p:3,status:"check",server:"Elkiya",title:"Overnight AdmissionSight build",detail:"Waiting to be checked.",refs:["i90830fb0"]},

// ---------- Roles ----------
{id:"RO-1",area:"roles",p:1,status:"you",server:"Both",title:"Review the roles design and answer 4 questions",detail:"docs/roles-design.md: what you own decides what you can do. Questions: Kirimdev for agent owners; is \"anyone may message\" inside the P&P Slack a guard; Builder agent limit; can admins approve guards.",refs:[]},
{id:"RO-2",area:"roles",p:2,status:"todo",server:"Both",title:"Agent-scope rule, guards and the role checks",detail:"agentScope(u, agent) in users.mjs, one guard() for open doors / spending / owner's accounts, people-check matrix for Member, Builder, Admin. On the test copy.",refs:[]},
{id:"RO-3",area:"roles",p:2,status:"todo",server:"Both",title:"Channels for Builders",detail:"Their agents only; admin-only rows hidden; a change restarts one agent, never everyone.",refs:[]},
{id:"RO-4",area:"roles",p:2,status:"todo",server:"Both",title:"Keys and Health tabs on each agent",detail:"Its own keys (never shown in full); its status, held errors, Fixer items, restarts. Needs-you about the agent goes to its owner.",refs:[]},
{id:"RO-5",area:"roles",p:3,status:"todo",server:"Both",title:"Webhooks, Memory, agent Files, Activity for Builders",detail:"",refs:[]},
{id:"RO-6",area:"roles",p:3,status:"todo",server:"Both",title:"Menu from scopes; Creator becomes Builder; move people",detail:"Nothing taken away. P&P first, checked with a test account, then Elkiya.",refs:[]},

// ---------- Owner items ----------
{id:"OW-1",area:"owner",p:1,status:"you",server:"Elkiya",title:"Paste Donna's issues from this morning",detail:"Sent on Telegram, which I can't read. Most are probably already in the Fixer lists above.",refs:[]},
{id:"OW-2",area:"owner",p:1,status:"you",server:"Both",title:"GitHub settings for the Fixer (AUD-7)",detail:"Branch rule with code-owner review and no admin bypass, remove the write deploy key, a fixer token on a non-owner account. Unblocks \"Fixer can't push finished fixes\" and the cloud fixer on P&P.",refs:["i34f52c6e","ic3e9e6e2"]},
{id:"OW-3",area:"owner",p:2,status:"you",server:"Elkiya",title:"Higgsfield sign-in for Threads and Continue Support",detail:"",refs:["ibfcada63","i2ef45d64"]},
{id:"OW-4",area:"owner",p:2,status:"you",server:"Both",title:"Telegram group topics: one group = one session?",detail:"Your decision: 1 group = 1 session, 1 topic = sub-session, for all agents.",refs:["i7b21f234"]},
{id:"OW-5",area:"owner",p:1,status:"you",server:"Both",title:"Security rotations (AUD-9)",detail:"GitHub password, two-step seed and token from Elkiya's engine env; member-app admin password; continue-threads Telegram bot token; old repo history and Cloudflare-only origins.",refs:[]},
{id:"OW-6",area:"owner",p:2,status:"you",server:"Elkiya",title:"Swap on the Elkiya host (OPS-17)",detail:"16 GB swap; 154 GB free.",refs:[]},
{id:"OW-7",area:"owner",p:2,status:"you",server:"Both",title:"Review aqeelOS v2 on the live servers",detail:"v2 is the UI everywhere since 14 Nov, v1 at /v1.",refs:[]},
{id:"OW-8",area:"owner",p:3,status:"you",server:"P&P",title:"Sheets API in P&P's Google Cloud project",detail:"One link from the Needs-you item when it shows.",refs:[]},

// ---------- Done today ----------
{id:"DN-1",area:"pnp",p:1,status:"done",server:"P&P",title:"P&P team list filled",detail:"Owner Aqeel + Aisar, Faisal, Firdha, Rifqi, Fakhri, Aldillah by Slack id; guests left out; checked by the rule.",refs:[]},
{id:"DN-2",area:"roles",p:1,status:"done",server:"Both",title:"Roles design written",detail:"docs/roles-design.md.",refs:[]},
{id:"DN-3",area:"owner",p:3,status:"done",server:"Both",title:"Backlog brought up to 18 Nov",detail:"16-18 Nov work recorded; both servers on 7e6e757.",refs:[]}
]};
