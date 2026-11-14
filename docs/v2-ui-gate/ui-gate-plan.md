# /v2 Chat on the admin kit: plan

Owner, 14 Nov 2026: "make aqeelOS with the adminkit ui and do a /v2, but it's more about improving the UI, not a redesign." Refine, not a rebuild: the same Chat page, the same controls, with the app's hand-built menus, search box, toasts and confirm boxes drawn by aqeel-admin-kit 0.27.0 on /v2 only. `/` is unchanged.

How to run (from this folder, local test copy on port 4471): `node <ui-gate>/gate/cli.mjs check --route v2-chat,v2-chat-search,v2-chat-permission`. Needs ui-gate with list choices (role=option) counted as controls (branch count-listbox-options, 14 Nov 2026). Result 14 Nov: PASS, 0 critical, 0 major, 40 minor (spacing values aqeelOS uses everywhere, such as 10px, that are not on the gate's default scale; / has the same).

Baseline: `ui-gate baseline` on `/` (routes chat, chat-search, chat-permission), 14 Nov 2026, local test copy (no engine: the chat list shows its error state; the model picker and the agent menu need an engine and were checked by hand where possible).

## Feature parity

| v1 feature (on /) | v2 screen and control | How verified |
|---|---|---|
| Sidebar, top bar, composer, every button on Chat | Same elements, unchanged (only the parts below are drawn by the kit) | ui-gate check, route v2-chat, every baseline control found |
| Search box (Ctrl+K, top bar button): actions, pages, models, chats | Kit command menu, same lists from `paletteAll()` | ui-gate check v2-chat-search; try-parts: opens once, groups, icons |
| Search: skills and words inside chats while typing | `AdminKit.command.onQuery` with `paletteFind()` | try-parts (desktop); live results need an engine: not exercised locally |
| Search: "contains" matching, key hints, Esc closes | `match: 'contains'`, hint row, Escape | try-parts |
| Permission menu: heading, icons, second lines, tick | `AdminKit.menu` from the same items | ui-gate check v2-chat-permission; try-parts desktop and phone |
| Menus: arrows and Enter, Escape, focus back to the button | Kit menu keys | try-parts |
| Long menus with a search box (times, selects) | `search: true`, contains matching, Enter picks the first | try-parts |
| Menus with content of their own (date grid, connected accounts) | Stay the app's own menu | code: `opt.html` goes to the app's `menu()` |
| Phone menus with 44px rows | Kit bottom sheet, rows 47px | try-parts phone |
| Toasts, errors kept in "What went wrong" | Kit toasts, `Oops.add` kept | v2-page test, browser |
| Confirm box: title, words, Cancel, named button, X, Escape | Kit confirm with `closeButton` | try-parts: X shown, Escape answers no, the drawer under it stays |
| The look of menus and the search: current choice and highlighted row in blue, 600 headings, search rows 42px at 14px, 16px field with a magnifier, search 620px wide at 14% from the top, menus as wide as their words | v2.css, kit parts styled with the app's values (owner: "Adjust Chat first") | measured on / and /v2 (same sizes and colours), side-by-side screenshots light and dark |

## Schedules (14 Nov 2026, owner: "Yes, Schedules next")

Routes: schedules, schedules-sort, schedules-row-menu, schedules-new on / and /v2, with made-up schedules from `schedules-mock.json` (the local copy has no engine).

| v1 feature (on /) | v2 screen and control | How verified |
|---|---|---|
| The list: folders, rows, descriptions, costs, switches, search, sort, New folder, Run rules | Same page, unchanged | ui-gate check v2-schedules, every baseline control found |
| Row menu (Copy, Details, Run now, Edit, Move, Edit description, Delete in red) | Kit menu from the same items | ui-gate v2-schedules-row-menu; try-sched desktop and phone |
| Sort and folder menus, agent filter | Kit menus | try-sched: 4 orders with a tick, A to Z re-orders; folder menu |
| Editor dropdowns (where it sends, which model) | Kit menus (the app's select buttons call menu()) | try-sched: opens, Escape closes it and the editor stays |
| "Once": the day picker | Kit calendar `AdminKit.datePick` from the same button | try-sched: arrow + Enter picks a day |
| Time list with search ("1430" finds 14:30) | Kit menu with search | try-sched |
| Editor and details side panels | Stay the app's own (shared by every page; their own step) | try-sched: Details opens on a phone |
| Phone tap targets | 44px on every control (switches keep their look) | ui-gate: 0 major (/ has 24) |

## Added in v2

- Toasts stack, pause on hover and swipe away on a phone.
- Menus open as a bottom sheet on phones.
- Side panels can keep a button row at the bottom while they scroll (kit 0.27.0; used on later pages).

## Differences kept on purpose

- Menu headings in sentence case instead of small spaced capitals (ui-gate: tracked capitals read as a template).

## Removed

Nothing.
