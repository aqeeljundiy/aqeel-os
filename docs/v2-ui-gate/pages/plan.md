# /v2 on the admin kit: every other page

Owner, 14 Nov 2026: "Do all first, and i'll review". Chat and Schedules are in `../ui-gate-plan.md`; this covers the other 25 pages. Refine, not a rebuild: every page keeps its layout, controls and features. What the kit draws on every page of /v2 (app/v2.js, app/v2.css):

- menus and dropdowns (every `menu()` and every `<select>`, which the app turns into a menu button),
- the search box (Ctrl+K), toasts, "are you sure" boxes,
- the day picker of date fields,
- side panels and pop-ups (the app's own panel inside the kit's sheet; a bottom sheet on phones),
- tabs in the kit's underline look (the app's behaviour).

How to run (from this folder, local test copy on port 4471, no engine: pages that need the engine show their error or empty state on both / and /v2): `node <ui-gate>/gate/cli.mjs check --route <the v2-… routes>`. Widths 375, 768 and 1440 in light (Chat and Schedules are also checked in dark).

## Feature parity

| v1 feature (on /) | v2 screen and control | How verified |
|---|---|---|
| Every control on the 25 pages (Agents, Memory, Files, Code, Webhooks, Runs itself, n8n, Task board, Channels, Kirimdev, Skills, Connected apps, Connected accounts, Plugins, Achievements, Models, People, Usage, Health, Activity, Teams, Logs, Keys and secrets, Settings, Help) | The same page on /v2, same route | ui-gate check: every baseline control found on the mapped v2 route |
| Menus, dropdowns, search, toasts, confirm boxes, day picker | Kit parts from the same items | Chat and Schedules browser checks (try-parts, try-sched) |
| Side panels: typing guard, questions on top, Escape order, focus, side panels from the right | The app's panel in the kit's sheet | try-drawers: 19 checks, desktop and phone |
| Tabs: click, arrow keys, the sliding marker | Same tabs, underline look | ui-gate check (tabs found on every page that has them) |

## Added in v2

- Phones: side panels and menus are bottom sheets you can drag down.
- Tabs: an underline instead of a pill in a grey track.

## Removed

Nothing.
