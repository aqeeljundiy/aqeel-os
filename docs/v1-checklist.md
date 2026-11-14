# aqeelOS v1 checklist (for /v2)

Made 13 Nov 2026 for **/v2** (BACKLOG.md, V2-0). Owner: "Make a /v2 for aqeelOS now." His rule for every rework (13 Nov): v1 has his vibe and identity; the new version is **the same app, cleaner, more consistent, deeper, with smooth motion**, never a different layout.

Every line below is a thing today's aqeelOS has. **/v2 must keep every one** unless the owner removes it in his own words (`[~] … | removed: <date, his words>`). A line is ticked `[x]` only when /v2 has it and it was checked on the test copy.

How it was made: the admin kit's `v1-inventory.mjs` crawled every page of the private test copy (port 4402, signed in as the owner) at 1440 and 375 wide, then each screenshot was read by hand. **Screenshots are not in this repo** (they show real chats, people and accounts): they are on the owner's PC in `Documents\Claude\admin-kit-reviews\aqeelos\kit-v1\v1\` (`<page>-desktop.png`, `<page>-phone.png`, named after the address, e.g. `_chat-desktop.png`, `_system_people-phone.png`). Chat's own list, ticked for /v2, is `admin-kit-reviews\aqeelos\v1-first\kit-chat\identity.md`.

## Before numbers (style survey of app/app.css, accounts-brand.css, pwa.css)

| Kind | v1 uses | Tidy target |
|---|---|---|
| Text sizes | 28 (12.5px ×191, 13px ×167, 12px ×136, 13.5px ×100, 14px ×74 …) | 6: 11, 12, 13.5, 15, 19, 30 |
| Corner sizes | 20 (tokens r-sm 8, r-md 12, r-card 24, pill, plus 4px, 3px, 2px, 50% …) | the 4 tokens + round |
| Spacings | 40 (8px ×421, 6px ×367, 12px ×347, 10px ×331 …) | multiples of 4 |
| Control heights | 18 (32, 34, 30, 28, 36, 26, 40, 44 …) | 36 and 30 (44 on phones) |
| Page widths | 8 (780, 620, 640, 1080, 720, 1040, 812, 760) | 1 per kind of page |
| Animation lengths | 37 (200ms ×71, 150ms ×36, 250ms ×26 …) | 3: 160, 240, 360 ms |
| Animation curves | 9 | 1 (`--ease`) |
| Colours | 104 | the brand tokens (`assets/brand.css`) |

Measured on the rendered pages (kit `consistency.json`): 19 text sizes, 27 text colours, 6 corner sizes, 32 spacings across the 26 pages.

## Identity (every page)

- [ ] aqeelOS mark + wordmark top left of the sidebar (`span.wordmark`), the white-label brand name on other installs (`Brand.name`)
- [ ] Blue as the one accent: active section (blue-soft fill, blue text), blue gradient primary buttons, blue focus rings, blue switches (also in dark)
- [ ] Sky-blue glow behind welcome and empty heroes (`.empty-hero`, chat welcome)
- [ ] Section menu with an icon on every item: Chat, Agents, Code, Automations, Channels, Abilities, Models, System, Help; Ctrl+number shown on hover
- [ ] Sub-menu under the section (the pages of that section, each with its icon), or the chat list on Chat
- [ ] Agent switcher at the bottom of the sidebar: agent avatar (picture or emoji), name, online dot, model
- [ ] Collapsible sidebar (Ctrl+B) down to an icon rail; resizable by dragging its edge, double-click resets
- [ ] Glass top bar: page title, then screen, My browser, alerts and notifications with red/orange count badges, "Search or run a command Ctrl K", light/dark switch
- [ ] Command palette (Ctrl K) with pages, agents, chats and actions
- [ ] Live screen panel: the agent's screen as a side panel or a floating window (drag, resize, Take over, pop out)
- [ ] Agent avatars everywhere (emoji avatars like the whale, initials, pictures)
- [ ] Urgency colours on numbers: amber/red on Health (e.g. efficiency %), blue priority numbers on Models
- [ ] Toasts at the bottom; banners for updates and alerts; amber alert rows
- [ ] Plus Jakarta Sans text, digits in Google Sans Flex
- [ ] Light and dark (moon/sun switch, remembered per person)
- [ ] Phone: the sidebar is a drawer behind the menu button; top bar keeps screen, alerts, bell and search
- [ ] Mood: calm, airy, blue-and-white; plain friendly words ("What should … work on?")

## Screens (desktop and phone screenshot each)

- [ ] **Chat, new** `#/chat`: agent avatar in a halo, "Welcome to aqeelOS", one-line explainer, composer card (attach, send a secret, use a tool, dictate, folder, Ask me, model, context ring, Effort, send), hint line | `_chat-*`
- [ ] **Chat, open** `#/chat/<id>`: person's bubbles right, agent's replies as reading text with avatar, folded tool steps ("Ran 7 steps · 1 failed"), thinking, approvals, secret cards, reply tools on hover (copy, retry, fork), read-only note for someone else's chat | `_chat_<id>-*`
- [ ] **Chat list** (sidebar): New chat, refresh, Search chats, Chats / Scheduled runs / All, groups by day, source icon, owner, ⋯ menu, unread and working marks, Manage chats with count
- [ ] **Manage chats** `#/chat/manage`
- [ ] **Agents** `#/agents/profiles`: one card per agent (avatar, name, role, Chat, Settings), New agent, Grid/List, deleted agents with Restore and Delete forever | `_agents_profiles-*`
- [ ] **Memory** `#/agents/memory`: a card per agent with Open, the memory kind (Built-in), Set up; agent filter | `_agents_memory-*`
- [ ] **Files** `#/agents/files`: each agent's own folder (count), New folder, Upload, Open; agent filter | `_agents_files-*`
- [ ] **Code** `#/code/code`: Build / Live tabs; "Code works in the aqeelOS app" card, Open the app, Download for Windows, See what's live | `_code_code-*`
- [ ] **Schedules** `#/automations/schedules`: New schedule, Your order, New folder, Run rules, folders with counts, schedule rows with More menu, 7 fields | `_automations_schedules-*`
- [ ] **Webhooks** `#/automations/webhooks`: empty hero "No webhooks on any agent.", New webhook, agent filter | `_automations_webhooks-*`
- [ ] **Runs itself** `#/automations/selfruns`: Agents, Trusted people, Runs, Refused lately; Add a trusted person, Limits, Details | `_automations_selfruns-*`
- [ ] **n8n** `#/automations/n8n`: All workflows, each agent's n8n with Open | `_automations_n8n-*`
- [ ] **Task board** `#/automations/kanban`: empty hero "Hand work to your agents", board columns (To do, Ready …), New task, Start ready tasks, Refresh, agent filter, idea splitting | `_automations_kanban-*`
- [ ] **Channels** `#/channels/channels`: each agent's channels with their state, notes and reconnect | `_channels_channels-*`
- [ ] **Kirimdev** `#/channels/kirimdev`: Connection, Numbers, Approvals, prices and held chats; Check now, Add key | `_channels_kirimdev-*`
- [ ] **Skills** `#/abilities/skills`: Installed / Tool groups / Find more skills; Added on this OS (count), Built in (count); Update all, Learn a skill, New skill; groups with on/off | `_abilities_skills-*`
- [ ] **Connections** `#/abilities/connections`: All / Apps / Logins / Skills / Plugins / Keys; Added by people; Check now, Add, Browse all apps | `_abilities_connections-*`
- [ ] **Apps** `#/abilities/apps`: app tiles with logos by category (Messages and meetings, Sales and customers …), Connected count, Add by address, Manage, Connect, Show more | `_abilities_apps-*`
- [ ] **Plugins** `#/abilities/plugins`: Installed / Browse, Added on this OS, Built in, Rescan, Check now | `_abilities_plugins-*`
- [ ] **Achievements** `#/abilities/achievements`: Recently unlocked, categories, Earned / In progress / Secret, Share, Rescan history | `_abilities_achievements-*`
- [ ] **Models and accounts** `#/models/models`: AI accounts / Agents' models / Pictures / Team of models; Priority list with numbers and move up/down; If an account fails; Recent switches; Your AI accounts tiles; Cloud fixer; Add account, Refresh | `_models_models-*`
- [ ] **People** `#/system/people`: person tiles with initials avatar, email, role, last seen; Invite someone; Roles; Waiting to join; How sharing works | `_system_people-*`
- [ ] **Usage** `#/system/usage`: 7 / 30 / 90 days, currency, chart and totals per agent, Refresh | `_system_usage-*`
- [ ] **Health** `#/system/health`: headline ("1 thing needs you. The fixer handles the rest."), Needs you, Fixer, Agents, Cost this week, By agent / By person, Efficiency, Where model use goes, Biggest chats; Now / History; Report an issue, Engine console | `_system_health-*`
- [ ] **Activity** `#/system/activity`: timeline of what agents did; Bottlenecks | `_system_activity-*`
- [ ] **Teams** `#/system/teams`: Teams, Alerts for the owner, The fixer, Agents; Add a team, Send test, Pause until… (15 fields) | `_system_teams-*`
- [ ] **Logs** `#/system/logs`: Agent / Channels / Errors, Refresh, agent filter | `_system_logs-*`
- [ ] **Keys and secrets** `#/system/keys`: keys per agent with Check now, Add a key, Secret links | `_system_keys-*`
- [ ] **Settings** `#/system/settings`: Cloud fixer, This install, Each agent's settings, Agent settings, Anonymous usage stats (12 fields) | `_system_settings-*`
- [ ] **Help** `#/help`
- [ ] **Sign-in**: aqeelOS mark, sky gradient, name/email and password, sign-in with a code, forgot password | `signin-*` (signed out)
- [ ] **Invite** `#/invite/<code>`: accept an invite, set a password

## Components (shared)

- [ ] Cards (`.card`, r-card 24px) with soft shadow; tiles with icon or logo; rows with a round icon box
- [ ] Tabs: one row, the active one with a sliding highlight (`.tabs .pill`); long rows scroll with a faded edge
- [ ] Chips (`.chip`, blue / ok / warn / bad), dots, eyebrow labels
- [ ] Switches (blue when on, also in dark)
- [ ] Designed menus and pickers (no browser `<select>` lists), anchored to their button
- [ ] Drawers and confirm boxes over a blurred scrim; Escape closes every layer
  - /v2 (14 Nov 2026): confirm boxes are the admin kit's (same title, words, Cancel and the named button, Escape, the blurred scrim); the kit's box has no X in its corner, Cancel and Escape close it. Toasts are the kit's (white, stack, swipe away), at the bottom centre; on a phone full width.
- [ ] Loading: skeleton rows (shimmer) and the ring; a page is drawn out of sight and swapped in whole (no flicker)
- [ ] Empty heroes with a sky gradient and one clear next step
- [ ] Code blocks with a copy button; markdown tables with rounded outline
- [ ] Toasts (dark pill), banners, alert rows

## Motion (all of it stays)

- [ ] View entrance on every page change (`viewIn`), tabs and cards `reveal` in turn
- [ ] Messages and tool steps `rise`; typing dots `bounce`; spinners
- [ ] Sidebar collapse glides (grid columns), screen panel `slideIn`, palette `pop`, menus `menuIn`, toasts `toastIn`
- [ ] Tab highlight slides; step bodies open with the grid 0fr→1fr technique; chevrons turn
- [ ] Buttons lift on hover; avatars `avaIn`
- [ ] Everything still under prefers-reduced-motion (assets/brand.css)

## Words and tone

- [ ] Plain words in the owner's voice ("What should … work on? It runs on your AI box, so it keeps going when you close this tab.")
- [ ] Button words as they are (New chat, Search chats, Manage chats, Ask me, Effort, Invite someone …); Indonesian where the person chose it (`lang.js`)
- [ ] "the agent" / "the model", never one provider's name; never the engine's name

## /v2 progress

- Chat (with the sidebar and top bar): built on /v2, waiting for the owner's yes (BACKLOG.md V2-2). Its own list, all ticked: `admin-kit-reviews\aqeelos\v1-first\kit-chat\identity.md`.
- Every other page: shows on /v2 exactly as on / until Chat is approved (V2-3).
