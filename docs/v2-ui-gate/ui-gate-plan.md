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

## Added in v2

- Toasts stack, pause on hover and swipe away on a phone.
- Menus open as a bottom sheet on phones.
- Side panels can keep a button row at the bottom while they scroll (kit 0.27.0; used on later pages).

## Removed

Nothing.
