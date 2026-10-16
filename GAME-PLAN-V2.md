# code by aqeel V2: make anything, not only apps

Today code by aqeel is a very good app builder. V2 makes it a deliberate place to make anything Claude can make: apps and sites, slide decks, documents, designs, research reports, data and charts, images and video. Each output gets the right editor in the side panel, the way Claude shows artifacts and Claude Design shows decks and designs.

The full feature list is on the board at **/backlog**: 91 new cards in 14 V2 areas, each with one acceptance line you can test. This document is the order of work, how it will be built, and how it gets audited.

---

## 1. What we are bringing over

| Area | Cards | Where it comes from | In one line |
|---|---|---|---|
| Make anything (MAKE) | 5 | Claude, Claude Design | New chat starts with “What do you want to make?”, with templates for each kind |
| Artifacts panel (ART) | 11 | Claude | Every output renders on the side, with versions, comments, share links and downloads |
| Slides and decks (DECK) | 13 | Claude Design | Real slides with layouts, design systems, notes, present mode, editable PPTX export |
| Documents (DOC) | 8 | Claude Docs | Rich documents you write together with the AI, with comments, citations and DOCX/PDF export |
| Design canvas (DSGN) | 7 | Claude Design | Frames on a canvas, variations side by side, a click-through prototype, “Build this” |
| Design systems (DS) | 5 | Claude Design | Brand kits made from a site, code or brand PDF, used by everything by default |
| Data and charts (DATA) | 5 | Claude | Spreadsheet analysis with code, editable charts, dashboards |
| Research (RES) | 4 | Claude | Web search with sources, and deep research that writes a cited report |
| Images and video (GEN) | 4 | Request | Generation through Higgsfield and other tools, plus a project media library |
| Knowledge and memory (KNOW) | 5 | Claude, Claude Code | Project knowledge, global instructions, memory you can edit, reply styles |
| Skills and agents (SKILL) | 5 | Claude Code | Skills both AIs use, saved from chats, shown as /commands; custom agents |
| Connectors (CONN) | 5 | Claude, Request | A connector catalog, **several accounts per server (3× Higgsfield)**, choice per project |
| Working with the AI (FLOW) | 10 | Claude Code app | Live task list, next-step box, question cards, plan approval, side sessions, schedules |
| Ship (SHIP) | 4 | Claude Code, Request | PR panel with “Fix with AI”, auto-fix, deploy to your Dokploy server |

Already done and kept: projects and chats, Claude + GPT side by side (Compare and Team), terminal, files, changes and versions, git push and PRs, Preview and the side browser with the element picker, English and Bahasa, light and dark mode, the native window.

---

## 2. How it will be built (the key decisions)

1. **One output model for every kind.** Each output lives in the project under `outputs/<name>/` with an `output.json` holding its kind, title and version list. The panel picks the renderer by kind: app, deck, doc, design, report, data or media. Versions reuse the existing Changes and version history, so restore and compare work the same for everything.
2. **The app gives both AIs its own tools.** code by aqeel runs a small local tool server (MCP) that Claude and GPT both connect to. Through it the AI can:
   - update the task list
   - ask a question as choice cards
   - end its turn with the next-step box
   - open an output in the panel
   - read the design system

   This is how the Claude Code app does it, and it keeps the two AIs behaving the same.
3. **Kinds are instructions plus a renderer, not separate apps.** “Slides” means a slide format the AI writes into, a slide renderer, the slide editor, and slide-specific instructions. Adding a kind later (a newsletter, a résumé) means adding those four pieces.
4. **A deck is data, not a picture.** Slides are stored as structured content (layout, text, images, chart data, notes) and drawn with the design system. That is what makes text editable in place, restyling one click, and PPTX export real text boxes.
5. **Exports use what we already have.** PDF and PNG come from the headless Chromium the side browser already runs (print to PDF, screenshots). PPTX, DOCX and XLSX need a small library each (see section 5).
6. **Artifacts are sandboxed.** Outputs render in a sandboxed frame with no app token, no file access and no other projects. Outside scripts can only come from allowed CDNs.
7. **Same rules as now:** lean code, quick and light, Plus Jakarta Sans, smooth animation everywhere, English and Bahasa, light and dark. Every screen is checked in the real app before a card is marked done.

---

## 3. Phases

Each phase starts with a **mockup you approve**, then the build, then a short check of that phase's cards in the real app.

| # | Phase | Cards | Why this order |
|---|---|---|---|
| 0 | **Foundations**: the output model, the Artifacts tab, versions, live refresh, downloads, sandbox, the app's own tool server, task list, next-step box, question cards, the “What do you want to make?” start | ART-01/02/03/07/10, FLOW-01/02/03, MAKE-01 | Everything else plugs into this |
| 1 | **Design systems**: library, make one from a site, code or PDF, a page per system, used by default | DS-01 to DS-04 | Decks, docs and designs all need a look to follow |
| 2 | **Slides**: layouts, editing on the slide, per-slide AI actions, reordering, notes, present mode, PPTX/PDF export, images, charts, deck review | DECK-01 to DECK-13 | The clearest proof that this is more than an app builder |
| 3 | **Documents**: rich doc, writing together, comments and suggestions, outline, citations, export and import, templates | DOC-01 to DOC-08 | Reuses the comment and versioning pieces from Slides |
| 4 | **Research and data**: web search with sources, deep research into a document, links and PDFs, spreadsheets, analysis, charts, dashboards, charts inside replies | RES-01 to RES-04, DATA-01 to DATA-05, ART-09 | Feeds decks and docs with real content |
| 5 | **Design canvas**: frames, variations, prototype, select and tweak, export, social sizes, “Build this” | DSGN-01 to DSGN-07 | Builds on design systems and the element picker |
| 6 | **Connectors and media**: catalog, several accounts per server, choice per project, health, tool permissions, image and video generation, media library | CONN-01 to CONN-05, GEN-01 to GEN-04 | Unlocks 3× Higgsfield and images in decks |
| 7 | **Knowledge, memory and skills**: project knowledge, global instructions, memory, styles, skills library, slash commands, custom agents, plugins | KNOW-01 to KNOW-05, SKILL-01 to SKILL-05 | Makes every kind better over time |
| 8 | **Workflow and ship**: plan approval, chapters, side sessions, worktrees, schedules, notifications, phone, PR panel, auto-fix, Dokploy deploy | FLOW-04 to FLOW-10, SHIP-01 to SHIP-04 | Power features once the core is solid |
| 9 | **Finishing**: templates, project kinds, several outputs per project, prompt-to-kind chip, point-to-change, comments, share links, full screen, artifacts with data, the remaining P2 cards | MAKE-02 to MAKE-05, ART-04/05/06/08/11, the rest | Polish across all kinds |

---

## 4. The audits (the multi-round method again)

After phase 9, six themed audit rounds. Each round writes its findings as numbered cards with one testable line (V1-01, V1-02, and so on), fixes every one, and checks each fix in the real app: a screenshot plus the measured UI check, in both themes and both languages. Only then is a card marked done.

| Round | Theme | Cards | What gets checked |
|---|---|---|---|
| **V1** | Parity with Claude and Claude Design | 20 | Each kind side by side with the Claude feature it copies; nothing missing or weaker |
| **V2** | Every surface, menu and state | 30 | Every new panel, menu, dialog, empty state, loading state and error state, one by one |
| **V3** | Responsive, themes and Bahasa | 30 | Desktop, laptop, tablet and phone; light and dark; every new string in Bahasa |
| **V4** | Real jobs from start to finish | 30 | Make a pitch deck and export PPTX; write a report with citations; design a landing page and build it; analyse a CSV into a dashboard; generate images across 3 Higgsfield accounts; ship to Dokploy |
| **V5** | Hierarchy, balance and motion | 50 | Screen-by-screen balance, spacing, icon centring, and smooth opening, closing, folding and reordering everywhere |
| **V6** | Speed, lean code and reliability | 20 | Start time, panel switch time, memory use, no dead code, the sandbox holds, failures recover, tests cover each kind |

That's 180 audit cards on top of the 91 feature cards.

---

## 5. Decisions for you before Phase 0 starts

1. **Libraries to download** (each from npm, and each needs your OK): **pptxgenjs** for PPTX, **docx** for DOCX, **SheetJS** for XLSX. PDF and PNG need nothing new.
2. **Share links:** on this network only, or also published through your Dokploy box (ai.elkiya.com style)?
3. **Order:** Slides as Phase 2 (my recommendation), or Documents or Design first?
4. **Mockups:** I make the Phase 0 mockups first (the “What do you want to make?” start and the Artifacts panel) for your sign-off before building.
