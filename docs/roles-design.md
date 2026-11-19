# Roles: what you own decides what you can do

Status: design for the owner's review (19 Nov 2026). Nothing here is built yet. Backlog item ROLES-2 (replaces CH-MEMBER).

## Why

On 19 Nov Aldillah (P&P, role Creator) wanted to connect her own agent to WhatsApp and found no Channels page. She is not the only one: every employee who owns an agent hits the same wall, and each one ends up asking an admin, or the agent tells them to "find an admin". The owner's rule (12 Nov): "most of my team should be able to do their work without limitations".

Today the question aqeelOS asks is **"is this person an admin?"**. It should ask **"what does this action touch?"**:

- **Your agent**: its owner runs it fully, whatever their role.
- **The whole install**: things every agent and person share. Admins.
- **Guards**: a few actions that reach outside the team or spend the business's money need the owner's yes, whoever asks.

The model is GitHub's: a repository's admin manages that repository completely (settings, webhooks, keys, collaborators, integrations) without being an organisation owner; the organisation owner keeps billing, members and org-wide policy. An aqeelOS agent is the repository; the install is the organisation.

## Why it was admin-only (and what changed)

| Reason in October | Now |
|---|---|
| One engine: changing a channel restarted every agent for minutes | One agent reloads or restarts alone (16 Nov, ae3b086). Non-main channel changes are mostly applied live already |
| One Linux user: an agent opened to outsiders could reach everyone's files | Every agent runs as its own Linux user `ag-<agent>` (20 Oct, hardened 12 Nov). This is the safety boundary |
| Keys lived in one shared settings file | Each agent keeps its keys in its own `.env` and `.secrets/` |
| A channel is a door to outsiders, so the owner decides | Still true for **open** doors (anyone may message, customer numbers). Kept as a guard, not a role |

So most of the rule outlived its reasons. The server already lets an agent's editor or owner do much of this (approve people on its channels, memory, n8n, restart, Google/Slack sign-ins on that agent); the menu hides it.

## Roles

| Role | For | What they get |
|---|---|---|
| **Member** | people who only use agents others made | Chat with the agents shared with them, their own Files, Help |
| **Builder** (replaces Creator) | staff: Aldillah, Fakhri, Faisal, Firdha, Rifqi, Aisar | Everything in "Your agent" below on agents they own (up to 5 by default) or that are shared with them as Can edit. Terminal, files and code tools on (owner's rule, 12 Nov) |
| **Admin** | people who run the install | Everything except the guards |
| **Owner** | Aqeel | Everything |

Custom stays for one-off people. The flat permission list (create, skills, mcp, schedules, models, tools, usage, unsafe) stays underneath as the knobs a role sets, but **owning an agent now grants the whole agent scope**; the knobs only matter for agents shared as Can edit, and for limits (how many agents, which models, daily tokens).

Shared levels on one agent stay: **Chat** (use it), **Can edit** (run it like an owner, except delete, share and transfer), **Owner**.

## The three scopes, page by page

`Today` is what a non-admin owner of an agent gets now. `New` is a Builder on their own agent.

### Your agent (owner or Can edit, any role)

| Page | Job | Today | New |
|---|---|---|---|
| Agents › Agents | Name, picture, instructions, model, versions, restart | Mostly yes (model needs the models right) | Yes, all of it, incl. Restart (one agent) |
| Agents › Memory | See and fix what the agent remembers | Server allows owners; page hidden | Shown, filtered to their agents |
| Agents › Files | The agent's workspace and their own folder | Own folder only | Own folder **and** the workspaces of their agents (`~/workspaces/<agent>`, read and write) |
| Automations › Schedules | Timed runs | Yes | Yes |
| Automations › Webhooks | Let another service trigger the agent | Admin only | Yes, for their agents (signed URLs, as today) |
| Automations › n8n | The agent's own n8n space | Server allows editors; page hidden | Shown, their agents' spaces |
| **Channels** | Put the agent on Slack, Telegram, WhatsApp, Discord, email; choose who may message it | Server allows most of it; page hidden | Shown, their agents only. Connect, reconnect, pause, remove, approve and remove people. Opening a channel to **anyone** is a guard (below) |
| Abilities › Skills | Know-how | Yes | Yes |
| Abilities › Connections | Outside apps (MCP) and the agent's own Google / Slack / Microsoft sign-ins | Yes | Yes |
| Abilities › Plugins | Turn installed add-ons on for the agent | Yes | Yes (installing new engine code stays admin) |
| Keys (new tab in the agent's settings) | The agent's own API keys and secrets | Admin only (except "give a secret") | Add, replace, remove keys of their agents. Values never shown in full, as for admins. Copy a key only between agents they own |
| Health (new tab in the agent's settings) | Is my agent working, and what is wrong | Hidden | Its status, held script errors, Fixer items for this agent with their state, its last restarts. Needs-you items about their agent go to them, not to admins |
| Models › Usage | What I and my agents used | With the usage right | Always for Builders: their own and their agents' |
| Activity | What happened by itself | Server allows, filtered; hidden | Shown, filtered to them and their agents |

### The whole install (admins)

These are shared by every agent and person, or they are the owner's own: Models and accounts (the subscriptions), fallbacks; engine settings, logs, updates, backups, restarting every agent; the **main agent** (Donna/Pixel's engine home: its channels restart everyone); installing plugins and skills from the hub; OAuth app clients; Connected accounts (the owner's own logins); Kirimdev account and lines; Teams, team groups, alerts, Fixer, Health of the box; Runs itself rules; People and roles; Branding, SSH keys, Settings; Task board and Achievements (engine-wide today).

### Guards (the owner's yes, one click, whoever asks, admins too)

1. **An open door.** Setting an agent's channel to "anyone may message" (DM policy open, a public Telegram bot, a WhatsApp business number, a Kirimdev line). Approving **named** people needs no one.
2. **Spending.** Which models a person may use and their daily limit stay per role. A paid model or a paid connected app the role doesn't allow is a request.
3. **The owner's own accounts** (his Slack, Notion, Google, the Claude and GPT sign-ins) are never handed to someone else's agent. Agents sign in with their person's own accounts.

A guard is never a dead end: the button reads "Ask Aqeel" and sends one Needs-you item with what, which agent, who asked and why; Approve applies it, and the person sees the result in their agent's Health. Reference: Slack's "Request to install" for apps that need admin approval.

## The Channels page for a Builder (the first screen to build)

Job: get my agent onto the apps my team or clients use, and control who reaches it.

- Same page and look as the admin's, scoped: the agent picker lists only their agents; rows for admin-only actions (move a channel to another agent, share, team groups, Slack quiet channels, WhatsApp Cloud) are **not shown**, not greyed out.
- Connect: the same per-platform steps as admins (bot token, QR for WhatsApp). The change applies to that agent only; if the engine can't apply it live, that one agent restarts, never everyone. If a change would restart every agent (only the main agent), it isn't offered.
- Who can message: the approved list with Add person and Remove. "Anyone" shows the guard button.
- Empty state when they own no agent: "Channels connect your agents to Slack, WhatsApp and more. Create an agent first."

## What has to change in code

1. **One rule for agent scope** in users.mjs: `agentScope(u, agent)` = owner or Can edit level (any role). Every route on the "Your agent" list checks it instead of `isAdmin`. Install routes keep `isAdmin`. Guards go through one `guard(kind, agent, u)` that returns allowed, or makes the request.
2. **Menu** (people.js applyRole): built from the scopes above, not from the caps list, so a new agent-scoped page shows up for Builders without touching the menu code.
3. **Routes now admin-only that become agent scope**: `/hapi/messaging/platforms` and WhatsApp onboarding (filtered to the agent), `/hapi/webhooks`, the agent's `/hapi/env` keys (through `/ui/access?kind=key` filtered), agent workspace paths in `/hapi/files`, Activity and per-agent health/fixer reads.
4. **No restart of everyone from agent scope**: channel changes that aren't hot-applied use the one-agent restart (agent-reload.mjs) instead of `restartGateway`.
5. **Roles data**: rename Creator to Builder (id kept), give it `unsafe` (already true on P&P since 12 Nov), default maxAgents 5.
6. **Checks**: extend scripts/people-check.mjs and the roles checks with a matrix: Member, Builder, Builder on someone else's agent, Builder with Can edit, Admin, each against every page and route above, both allowed and refused; plus "a Builder never restarts every agent" and "a guard makes exactly one request".

## Moving today's people

- Creator → Builder on both installs. Member stays Member. Custom keeps its knobs and gains the agent scope on agents it owns.
- P&P today: Aldillah, Fakhri, Faisal, Firdha, Aisar, Rifqi (check each one's current role in People before the switch).
- Elkiya: same rule; Amri and the Continue team per their current roles.
- Nothing is taken away from anyone; only added (owner's rule: additive changes for risky features).

## Order of work

1. Owner approves this design (and answers the open questions).
2. `agentScope` + guard rule + checks, on the test copy (:4402).
3. Channels for Builders (Aldillah's case), then Keys and Health tabs, then Webhooks, Memory, Files, Activity.
4. Menu from scopes, Creator → Builder, people moved.
5. Deploy to P&P first, check as Aldillah's role with a test account, then Elkiya.

## Open questions for the owner

1. **Kirimdev lines**: should the owner of a support agent see their line's chats and hold/release customers, or does Kirimdev stay admin-only?
2. **Open doors**: is "anyone may message" on a Slack bot inside the P&P workspace also a guard, or only outside-facing ones (WhatsApp, Telegram, email, public bots)?
3. **Builder's agent limit**: 5 by default, or no limit?
4. **Admins and guards**: should admins (not only you) be able to approve guard requests?
