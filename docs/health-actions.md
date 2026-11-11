# Needs you: what the person does, and the one button that does it

Owner, 12 Nov 2026: "It asked me to sign into Higgsfield. Why not just give me a button to sign in rather than a random button that doesn't make sense?"
Rule: every item says in one plain line what to do and has ONE primary button that does exactly that, or opens the exact place where it is done.
No pure-acknowledge buttons. Labels are verb + object, at most about four words.

Where it lives: `app/bottlenecks.mjs` (`personNeed`, the sentence), `app/bottlenecks.js` (`actions(x)`, the buttons, shared by the Bottlenecks popup, the bell and Health),
`app/need-action.mjs` (works out the button for free-text needs the fixer and agents write), `app/questions.mjs` (kind `question`), `app/health-page.js` (the Health cards).
`scripts/health-actions.test.mjs` fails when a kind a person is asked about has no sample, no primary button, or a vague label.

## What was wrong (found 12 Nov 2026)

| Where | Item | What the person must do | Old primary | Does it? | Now |
|---|---|---|---|---|---|
| Health, every fixer card | Higgsfield won't connect (3 issues on ai-vps, 5 agents) | Sign in to Higgsfield once | "Done, check again" | No: it asks you to say it is done before it is | **Sign in to Higgsfield** starts the sign-in for the right agent (`/ui/mcp/start-signin`, tab opens on the click); Check again after |
| Health | Notion CRM not visible (2 issues) | Sign in to Notion and pick the AdmissionSight workspace | "Done, check again" | No | **Sign in to Notion** |
| Health | Pixel Agent: ChatGPT/Codex and Antigravity sign-ins dead (pnp-box) | Sign in to both | "Done, check again" | No | **Sign in to Proton ChatGPT**, **Sign in to Antigravity** (the Reconnect dialog of that account) |
| Health | Fakhri: Google Sheets tools not loaded | Connect Google | "Done, check again" | No | **Connect Google** (Connect Google dialog) |
| Health | Donna cannot log in to KirimDev | Sign in on the agent's own screen | "Done, check again" | No | **Sign in on screen** (that agent's screen, Take over on) |
| Health | "pay a test QRIS", "Amri to confirm the picture" | Something only a person on another system can do | "Done, check again" | Yes, honestly: re-check is the action | **Check again** is the primary; the sentence says what to do |
| Popup | Notion / Slack / Figma sign-ins merged across agents | Sign in to each | "Sign in to Notion and Slack" went to the Connected apps page | No | one **Sign in to X** button per app |
| Popup | Report from an agent that needs a sign-in, Google, screen | as above | "I did it, ask Sesa to try again" | No | the direct button first, **Ask Sesa to retry** second |
| Popup | `account` out of credit / every account used up | Add another account (or wait) | "Reconnect" (opened the key step of the wrong thing) | No | **Add an account** |
| Popup | `account` rejected key / signed out | Paste a key / sign in | "Reconnect" | Partly | **Paste a new key** / **Sign in again** |
| Popup | `github_token` | Paste a token | no button at all (a sentence about an env var on the server) | No | **Paste the token**: inline field, saved on the server, item leaves |
| Popup | `channel` other than WhatsApp | Reconnect it | "Open Channels" | No | **Reconnect it** (one call) |
| Popup | `alerts` with no issue id | Do what the message says | only "Not now" | No primary | the direct button if the words say one, else **Open Health** |
| Popup | `alerts` / `instructions` / `ticket` | Retry the fix / read the changes / answer tickets | "I did it, try the fix again" / "Review" / "Open Help tickets" | Yes but vague | **Try the fix again** / **Read the changes** / **Answer the tickets** |
| Popup | `access` for a member | nothing (admin's call) | "Waiting for an admin", a button that did nothing | No | no button; members never see it |

Items that were already right: `signin` (Sign in to X, Signins.open), `schedule` (Run again), `invite` (Make a new link), `access` (Allow / Decline), `accounts` (Keep it / Disconnect), `group` (Add the bot to X: exact steps), WhatsApp `channel` (Link again), `conflict` (one button per side; no side is preferred, so no primary by design).

Kinds that are never in the person list (the fixer has them, `personNeed` is null): `system`, `down`, `skill`, `stopped`, `twice`, `dropped`, `backup`, `update`, `automations`, `models`, `selfruns`, `kirimdev`, `schedule` on Health.

## How a need becomes buttons (`need-action.mjs`, rewritten 12 Nov 2026)

Owner, the same day: "What's the point of clicking sign in if it doesn't lead me anywhere?" The first version guessed an app from loose
words: "Pixel Agent needs a person…" matched a tool called `pixel` (a command on the box, no sign-in page), so two unrelated needs
got "Sign in to pixel", which ended in the toast "Only tools with an address sign in this way". The rule now: **a button is offered
only when the action is real and will start.**

1. **Facts, not words.** The fixer (`RESULT`) and the sorter (`SORT`) write `steps:[{what,id,agent,alt}]` next to the sentence;
   `issues.mjs` keeps them on the issue. `what`: `ai-account` (id: the account's name or provider), `google` (agent), `app` (id, agent),
   `remove-app` (id, agent), `key` (id), `screen` (agent). `alt:true` marks an alternative.
2. **Checked every time it is shown** (`resolveStep`, against `needCtx()` in server.mjs): the AI account exists (→ its Reconnect
   dialog, plus "Take it out of the priority list" while it is in the list, `/ui/accounts/unlist`); the app is on that agent and a
   sign-in page can start for it (`mcpCanSignIn`: an address, no key of its own; `access.mjs` reports it per agent); the agent exists
   (Connect Google for that agent); the entry to remove is still there (gone = that step is ticked as done).
3. **Several steps are a short numbered list**, each with its own line and its own button (`Bottlenecks.paint`).
4. **A need filed before steps existed** is read only for things named in full: an account's own name, its provider's name or id; an
   app's exact name in quotes or right after "sign in to / re-authorize / reconnect"; "connect … Google"; "remove the '…' entry".
   Never a part of a word, never an agent's name. The result goes through the same check.
5. **Nothing known, or the check fails: no sign-in.** The button opens the exact page (`PLACES`: AI accounts, Connections, Keys and
   secrets, or the issue on Health), then Check again. A `command` in backticks is still Copy the command.
6. Always last: `recheck` ("Check again").

`scripts/health-actions.test.mjs` holds this with the two real items from the P&P install as fixtures: every `do` the resolver can
produce has a handler in `Bottlenecks.act`, the handlers start the real thing against stubs, a tool without a sign-in page never
gets a sign-in button, and an unknown need is a deep link.

## Questions

`question` (app/questions.mjs): `{question, options:[{label, effect, recommended}], allowOther}`. Filed by the fixer (RESULT `question`), an agent (`ask_owner`) or the app.
Shows in Needs you with each option's effect, one button per option (recommended first and primary), "Something else" with a text field.
Answer: `/ui/questions/answer`, once. The fixer's issue continues with it in the next try; an agent gets it in its next turn until `question_done`.
Telegram: owner alerts are sent as plain text (no inline buttons exist in the relay), so questions are answered in aqeelOS only.

## Not one click

- A key for something other than the fixer's GitHub token or an AI account (for example "a new Xendit key"): there is no general place to paste it, so the item says what is needed and the primary is Check again.
- Host root commands: Copy the command, then Check again (the app cannot run them; the box is never changed from the UI).
- Payments and "confirm it works on the phone": only a person can; Check again.
