# code by aqeel product requirements

Version 0.1 · 13 October 2026 · Local working prototype

## Product purpose

code by aqeel is a local browser workspace for building websites with the AI subscriptions you already use. Projects, files, conversations and saved changes live on your own computer. You can choose GPT/Codex or Claude for each message and carry the same project context between providers. Gemini is planned next.

## Product decisions

- Product name: code by aqeel.
- Visual system: the app's own neutral token set (DESIGN.md); an install's name and logo come from its aqeelOS.
- Layout: projects sidebar, conversation on the left, editable files and website preview on the right.
- Interaction: resizable panels, clear navigation, restrained animations, theme controls and keyboard access.
- Authentication: run each installed official tool's login from the app. No external PowerShell copy/paste and no automatic API-key fallback.
- Persistence: keep separate project folders, multiple chats, prompt drafts, generated files and previous file contents.
- Development tracker: this Kanban tracks building code by aqeel. It does not represent background agents, website publishing, or a marketing content workflow.

## Current verified scope

The working prototype builds static HTML, CSS and JavaScript websites. GPT generated a real three-file demo and Claude refined it in the same saved conversation. The editor created and saved a README. Project/chats and file history survived a service restart. The preview ran the site's theme toggle. The PowerShell console listed the actual project files. Keyboard resizing and app theme controls were checked.

Nine parser, login, filesystem and planning tests pass. HTTP checks cover local request tokens, origin checks, project path validation, local font delivery and isolated preview headers. Additional model aliases are offered by the CLI; live verification has covered the providers' default models.

## User workflow

1. Create or select a local project.
2. Open a saved chat or start a new conversation.
3. Choose a connected provider/model and describe the website or change.
4. Read the response and inspect the generated files in Preview or Files.
5. Refine with either provider, manually save edits, or restore earlier file contents.
6. Run a project command in the console when needed.

## Requirements and acceptance criteria

Implemented labels describe a verified narrow capability. Partial capabilities remain Backlog until their remaining acceptance criteria are met. Done requires evidence; moving a card does not launch work.

| ID | Capability | Current status | Acceptance criterion |
|---|---|---|---|
| PLAN-01 | PRD and development Kanban | Implemented | code by aqeel has its own readable PRD, Kanban/list views, searchable cards, priority filters, editable status/notes, activity history and persistent updates. Verify saving and reloading a card. |
| BRAND-01 | Own design system | Implemented | Use the app's own palette, Plus Jakarta Sans and the aqeelOS mark; show code by aqeel as product name. |
| AUTH-01 | One-click Claude and Codex login | Implemented | App launches official subscription sign-in, displays progress, supports code replies and refreshes connection status. Claude login and both provider responses verified. |
| AUTH-02 | Multiple account profiles | Implemented | Keep separate authenticated profiles without copying credentials into the browser; verify account selection and supported billing behavior. See the feature parity section (AUTH-02). |
| MODEL-01 | Switch providers in a conversation | Implemented | GPT and Claude can work on the same saved project and conversation. Verify a GPT build followed by a Claude revision. |
| MODEL-02 | Model discovery and effort controls | Implemented | Discover supported model choices and account availability; expose reasoning/effort controls and verify each offered model. Current UI offers defaults and Claude aliases. See the feature parity section (MODEL-02). |
| GEM-01 | Gemini subscription connection | Planned | Discover/install official Gemini CLI, support Google subscription login, verify a real coding response and model switching without API fallback. |
| PROJECT-01 | Saved project folders | Implemented | Create separate project folders, select them in a sidebar, and preserve their files and conversations on restart. |
| PROJECT-02 | Open existing folders and Git repositories | Planned | Select an existing local folder or clone a repository into a managed project; preserve existing files and show the actual path. |
| CHAT-01 | Saved chats and draft messages | Implemented | Multiple chats per project, saved message history, current-project context across providers, and browser-held prompt drafts. |
| CHAT-02 | Conversation management | Planned | Rename, search, archive and restore projects/chats; retain attachments and add useful keyboard shortcuts. |
| BUILD-01 | Generate editable static websites | Implemented | Write validated relative HTML/CSS/JS/SVG files from model responses and show real responses/errors. Verify rendered website behavior. |
| BUILD-02 | Native agent streaming and sessions | Implemented | Stream real agent events and tool execution; resume native provider sessions and expose granular file changes without fabricated progress. See the feature parity section (AGENT-01, AGENT-02, AGENT-08). |
| FILE-01 | File creation and source editing | Implemented | Create supported files, including nested paths; edit, save and protect unsaved contents. Verify manual saves and reject paths outside the project. |
| FILE-02 | File tree, rename and diff review | Planned | Browse a nested file tree, rename/move files, inspect diffs and approve/reject individual changes with recovery. |
| PREVIEW-01 | Isolated website preview | Implemented | Render local static sites in an isolated frame; desktop/mobile widths and refresh work; project scripts cannot access the parent app. |
| PREVIEW-02 | Framework preview servers | Planned | Support React/Vite and other framework projects, dependencies, build logs, dev-server lifecycle and preview URLs. |
| HISTORY-01 | Previous file snapshots | Implemented | Save previous contents for AI changes/manual saves and restore them as a new recoverable change. Verify restoration and persistence. |
| SHELL-01 | Project command console | Implemented | Run individual noninteractive PowerShell commands in the selected project, show output/exit status and support stopping. Actual file listing verified. |
| SHELL-02 | Full interactive terminal | Planned | Provide a persistent PTY with shell state, interactive CLI programs, terminal resizing, keyboard input and reliable process cleanup. |
| LAYOUT-01 | Resizable panels and navigation | Implemented | Resize project/chat panes by pointer/keyboard, retain widths/sidebar preference, offer tabs and light/dark themes, and honor reduced motion. |
| GIT-01 | Git workflows | Planned | Show status and diffs, create branches/commits, fetch/push and create reviewable pull requests through explicit user actions. |
| MEDIA-01 | Images, videos and attachments | Planned | Attach reference files and connect available media tools; verify which subscription features are actually accessible and their billing. |
| ACCESS-01 | Broader accessibility verification | Partial | Audit keyboard focus, dialog semantics, contrast, touch targets, resizing and common screen-reader workflows across all states. Core focus/reflow controls exist. |

## Claude Code and Codex feature parity

Every capability Claude Code and Codex offer that fits code by aqeel, plus features requested directly. Implemented means verified in the running app. Order of work: P0 first, then P1, then P2.

### Projects, chats and sidebar

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| PROJ-03 | Project tree with expandable chats | Implemented | Each project in the sidebar expands into its chats (newest first) with status dots; collapsed state is remembered; selecting a chat opens it. | Both | P0 |
| PROJ-04 | Project context menu | Implemented | Right-click or ⋯ on a project offers Rename, New chat, Archive, Delete (with confirmation), Reveal in Explorer, Open in editor, Copy path. Works by keyboard (Shift+F10 / menu key). | Both | P0 |
| PROJ-05 | Chat context menu | Implemented | Right-click or ⋯ on a chat offers Rename, Pin, Mark unread, Fork, Archive, Delete, Export transcript. Actions persist after reload. | Both | P0 |
| PROJ-06 | Archive view and restore | Implemented | Archived projects and chats are hidden from the main list, shown in an Archived view, and can be restored or permanently deleted. | Both | P1 |
| PROJ-07 | Pinned chats, sections and drag ordering | Implemented | Pinned chats stay on top; user-created sections group chats; drag and drop reorders and moves chats between projects and sections. | Both | P1 |
| PROJ-08 | Search chats and transcripts | Implemented | A search box finds projects, chat titles and message text across all projects and jumps to the match. | Both | P1 |
| PROJ-09 | Run status badges and filters | Implemented | Each chat shows running, needs approval, unread, failed or done; the sidebar can filter to Running or Needs approval. | Both | P0 |
| PROJ-11 | Per-project settings | Implemented | A project can set default provider/model/effort, approval mode and custom instructions; new chats use them. | Both | P1 |
| PROJ-12 | Chat title generation and rename | Implemented | Chats get a short AI or prompt-based title automatically and can be renamed inline. Today titles are the first 42 characters of the prompt. | Both | P1 |
| PROJ-13 | Temporary chats | Implemented | A temporary chat is not kept: it is deleted when you leave it or restart the app, and is never used as context elsewhere. | Request | P1 |

### Agent runs and conversation

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| AGENT-01 | Agent mode in the project folder | Implemented | Codex and Claude edit files and run commands directly in the project; changes are recorded as restorable versions. Verified live with both providers. | Both | P0 |
| AGENT-02 | Live activity timeline | Implemented | Messages, commands with output, file edits and tool calls stream into the chat while the AI works. Verified live. | Both | P0 |
| AGENT-03 | Approval cards | Implemented | Commands, file changes and tools that need permission show Approve / Allow similar this run / Deny; read-only Codex commands are auto-approved. Verified live. | Both | P0 |
| AGENT-04 | Permission modes | Implemented | Per chat: Ask (default), Auto-edit (file edits allowed, commands asked), Plan only (read-only), Full access (explicit warning). Mapped to Codex approval/sandbox policy and Claude permission modes. | Both | P0 |
| AGENT-05 | Plan mode | Implemented | The AI produces a step plan without changing files; the user approves, edits or rejects it, then execution starts in the same chat. | Both | P0 |
| AGENT-06 | Steer or queue messages mid-run | Implemented | While a run is active the user can send a follow-up that steers the current turn (Codex turn/steer, Claude streamed input) or queue it for after. | Both | P0 |
| AGENT-07 | Stop a run | Implemented | Stop interrupts the active turn, denies pending approvals and keeps changes made so far as a restorable version. | Both | P0 |
| AGENT-08 | Native session resume | Implemented | Each provider resumes its own thread/session in a chat (Codex thread/resume, Claude --resume) instead of resending history. | Both | P0 |
| AGENT-09 | Cross-model handoff | Implemented | Switching provider mid-chat passes what was said since that model last spoke. Verified: GPT correctly described Claude’s previous change. | Request | P0 |
| AGENT-10 | Fork a conversation | Implemented | Fork from any message into a new chat that keeps history up to that point (Codex thread/fork; Claude --fork-session). | Both | P1 |
| AGENT-11 | Rewind and checkpoints | Implemented | Hover a user message to restore code, conversation or both to before it (Claude rewind, Codex thread/revert, app versions). | Both | P0 |
| AGENT-12 | Context meter and compact | Implemented | Shows context window usage per chat and offers Compact, which summarises older turns (Codex thread/compact, Claude /compact). | Both | P1 |
| AGENT-13 | Run cost, tokens and limits | Implemented | Each run shows tokens/cost estimate and the account’s remaining 5-hour and weekly limits. Claude cost estimate shown today. | Both | P1 |
| AGENT-14 | Live to-do / plan checklist | Implemented | The AI’s task list (Claude TodoWrite, Codex turn/plan/updated) renders as a checklist that updates during the run. | Both | P1 |
| AGENT-15 | Reasoning summaries | Implemented | Collapsible “thinking” summaries per turn where the provider exposes them. | Both | P2 |
| AGENT-16 | Turn diff review | Implemented | After each run, a diff view lists changed files with line diffs; each file can be kept or reverted individually. | Both | P0 |
| AGENT-17 | Questions from the AI | Implemented | When the AI asks the user a question (AskUserQuestion, Codex request user input) it renders as option buttons plus free text, and the answer resumes the run. | Both | P1 |
| AGENT-18 | Parallel background runs | Implemented | Several chats/projects can run at once; switching chats never stops a run; finished runs notify. Runs continue in the background today; notifications missing. | Both | P1 |
| AGENT-19 | Long-running goals | Implemented | Set a goal for a chat that the agent keeps working toward across turns, with progress shown (Codex thread goals). | Codex | P2 |
| AGENT-20 | Subagent activity | Implemented | Delegated subagents (Claude Task, Codex collab agents) appear nested in the timeline with their own status. | Both | P2 |
| AGENT-22 | @-mention files and fuzzy search | Implemented | Typing @ in the composer searches project files and attaches them as context chips. | Both | P0 |
| AGENT-23 | Slash commands with autocomplete | Implemented | / opens a command menu: /compact, /review, /model, /clear, /plan, /init and custom commands. | Both | P1 |
| AGENT-24 | Prompt history and drafts | Implemented | Drafts are kept per chat (done); Up/Down recalls previous prompts; multi-line editing with Shift+Enter. | Both | P1 |
| AGENT-25 | Markdown messages with code blocks | Implemented | Assistant messages render Markdown (headings, lists, tables, links) and code blocks with syntax colour and Copy. | Both | P0 |
| AGENT-26 | Edit and resend a message | Implemented | A previous user message can be edited and resent, branching the conversation from that point. | Both | P1 |
| AGENT-27 | Copy, retry and retry with another model | Implemented | Each reply has Copy and Retry; Retry can pick a different provider/model. | Request | P1 |
| AGENT-28 | Web search and fetch controls | Implemented | Toggle whether the AI may search the web or fetch URLs; results show as tool rows with sources. | Both | P2 |
| AGENT-29 | Fast mode / priority tier | Implemented | Optional faster service tier where the provider offers it (Codex priority tier, Claude fast mode), with a usage warning. | Both | P2 |
| AGENT-30 | Project and global instructions | Implemented | Edit AGENTS.md / CLAUDE.md for the project and global instructions from the app; both providers read them. | Both | P1 |
| AGENT-31 | Output styles | Implemented | Choose a response style (concise, explanatory, learning) per chat. | Claude Code | P2 |
| AGENT-32 | Code review mode | Implemented | Review the current changes or branch (Codex review/start, Claude /code-review); findings list with file/line links and Fix buttons. | Both | P1 |

### Models, accounts and usage

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| MODEL-02 | Model discovery and effort controls | Implemented | Provider → model → effort pickers; Codex models come live from model/list with per-model effort levels; Claude uses its aliases with low–max effort. Verified both CLIs accept the flags. | Both | P1 |
| MODEL-03 | Remembered model per provider | Implemented | The last model and effort per provider are remembered and restored. | Request | P1 |
| MODEL-04 | Combined model and effort picker | Implemented | Two pickers only: provider, then one list of “Model · Effort” options grouped by model, e.g. GPT-6-Luna · Low. | Request | P0 |
| AUTH-02 | Multiple Codex accounts with automatic switching | Implemented | Add Codex profiles with separate sign-in; choose the active one; optionally switch automatically when one hits its limit. Agent runs use the selected account. | Request | P1 |
| AUTH-03 | Multiple Claude accounts | Implemented | Claude profiles via separate config directories with their own sign-in and usage, mirroring the Codex accounts panel. | Request | P1 |
| AUTH-04 | Usage dashboard | Implemented | One page shows every account’s plan, 5-hour and weekly usage, reset times and credits. | Both | P1 |

### Terminal and processes

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| SHELL-03 | Agent commands stream into the terminal | Implemented | When the AI runs a command the terminal opens automatically and shows the command and live output. Verified live. | Request | P0 |
| SHELL-04 | Resizable terminal | Implemented | Drag the terminal’s top edge or use arrow keys; height is remembered. | Request | P1 |
| SHELL-02 | Full interactive terminal | Implemented | Persistent shell sessions per project (cd, variables and history survive between commands) with tabs; Stop restarts the shell in place. With node-pty installed (now in this folder) each terminal is a real PTY with a built-in xterm-compatible screen: colours, vim and other full-screen programs, prompts, resizing and a real Ctrl+C; phones type through a line box. Without node-pty it falls back to the line-based shell. | Both | P0 |
| SHELL-05 | Terminal tabs | Implemented | Multiple terminal tabs per project with rename, close and kill; an “AI” tab mirrors agent commands. | Both | P1 |
| SHELL-06 | Run buttons on code blocks | Implemented | Shell code blocks in replies have Run, which sends the command to the project terminal. | Claude Code | P2 |
| SHELL-07 | Dev server manager | Implemented | Detect and start npm/pnpm/astro/vite dev servers, show ports and logs, stop/restart them, and point the preview at them. | Both | P0 |

### Files, editor and changes

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| FILE-03 | Code editor with syntax highlighting and tabs | Implemented | Syntax-coloured editor with multiple open files, find/replace and go-to-line; unsaved markers. | Both | P1 |
| FILE-05 | Open in external editor and reveal in Explorer | Implemented | Buttons open the project or file in VS Code (or default editor) and show it in Explorer/Finder. | Both | P1 |
| FILE-06 | Images and binary assets | Implemented | Image files appear in the file tree with thumbnails; can be uploaded, previewed and referenced by the AI. | Both | P2 |

### Preview and side browser

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| BROWSER-01 | Side browser tab | Implemented | A Browser tab next to Preview/Files/Changes shows any URL (not just the project) with address bar, back/forward/reload. | Request | P0 |
| BROWSER-02 | AI-controlled browser | Implemented | Claude and Codex can navigate, click, type, read text and take screenshots in the side browser through one shared MCP server; every action appears in the timeline; logins/payments are left to the user. | Request | P0 |
| BROWSER-03 | Preview console and network errors to the AI | Implemented | Console errors and failed requests from the preview are shown and can be sent to the AI with one click. | Both | P1 |
| BROWSER-04 | Device presets and screenshots | Implemented | Desktop/mobile preview exists; add tablet and custom sizes plus capture a screenshot into the chat. | Both | P2 |
| BROWSER-05 | Element picker | Implemented | Click an element in the preview to reference it in the prompt (selector + screenshot). | Request | P2 |
| BROWSER-06 | Previews served from their own origin | Implemented | Website previews load from the app port + 1, so styles, images and scripts load and the preview stays isolated from the app. | Request | P0 |

### Git and GitHub

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| GIT-02 | Import a GitHub repository as a project | Implemented | Pick from your GitHub repositories or paste a link; the app clones it into a new project. Backend helpers written; UI in progress. | Request | P0 |
| GIT-03 | Branch status, fetch and pull | Implemented | The workspace header shows branch, ahead/behind and changed files; Pull fast-forwards and records a restorable version. | Both | P0 |
| GIT-04 | Commit and push with approval | Implemented | Commit with an AI-written message; push only after explicit approval. | Both | P0 |
| GIT-05 | Pull requests and CI | Implemented | Open a PR from the app (title, description, base, draft; pushes the branch after confirming), see checks and review state, read reviews and inline comments and hand them to the AI, let the AI fix failing CI, and merge when the user asks. PR creation was checked up to the confirmation and server validation, not against a real repository. | Both | P1 |
| GIT-06 | Worktrees per chat | Implemented | A chat can run in its own git worktree/branch so parallel chats never collide; merge back when done. | Both | P1 |
| GIT-07 | Compare branches | Implemented | Diff the current branch against its remote or another branch. | Codex | P2 |
| GIT-08 | AI merge-conflict resolution | Implemented | When a pull or merge conflicts, the AI proposes resolutions for approval. | Request | P2 |

### Multiple AIs on one request

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| MULTI-01 | Compare mode | Implemented | Send one request to Claude and GPT; each works in a separate draft copy; previews side by side; keep one with a click. | Request | P0 |
| MULTI-02 | Team mode | Implemented | Planner → builder → reviewer across chosen models in one request, with each stage visible and approvals still required. | Request | P0 |
| MULTI-03 | Split view of two chats | Implemented | Show two chats side by side and work in both. | Both | P1 |

### Integrations and extensibility

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| EXT-01 | MCP connectors manager | Implemented | Add, enable and remove MCP servers once; both providers receive them; OAuth sign-in where needed. | Both | P1 |
| EXT-02 | Plugins and skills | Implemented | Browse, install and enable plugins/skills; show which are active in a chat. | Both | P2 |
| EXT-03 | Hooks | Implemented | Run user scripts on events (before/after tool, run finished) with a settings UI. | Both | P2 |
| EXT-04 | Custom prompts and commands library | Implemented | Save reusable prompts as slash commands per project or globally. | Both | P2 |
| EXT-05 | Computer use with permission | Implemented | Claude, GPT and Gemini can list app windows, take a screenshot of one window, click, type, press keys and scroll, through the built-in desktop tools (Settings › Computer use, off by default). The first time a run asks for an app, an approval card offers Allow this run, Always allow or Deny; always-allowed apps can be revoked in Settings. Screenshots capture only that window; clicks and keys are refused unless that window is in front. The app itself and password managers are blocked, and phones cannot drive the desktop. Every action appears in the run timeline and Stop ends the run. Verified on Windows: listing, per-app approval and window capture through a live Claude run; clicking and typing were not run against a real window during testing. macOS needs Accessibility and Screen Recording permission. | Request | P1 |
| EXT-06 | Scheduled and recurring tasks | Implemented | Run a prompt on a schedule (daily, hourly) in a project and notify with results. | Both | P2 |
| EXT-07 | Remote control from phone | Implemented | Pair a phone to watch runs, answer approvals and send prompts to this computer (see PLAT-02). | Both | P1 |
| EXT-08 | Publish a site preview link | Implemented | Publish the current static site to a shareable URL. | Request | P2 |

### Settings and app-wide

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| APP-01 | Settings page | Implemented | Theme, default models, approval defaults, notifications, keyboard shortcuts, editor font size, data folder location. | Both | P1 |
| APP-02 | Command palette and shortcuts | Implemented | Ctrl/Cmd+K palette for every action; a shortcuts sheet; New chat, Stop, toggle panels and terminal by keyboard. | Both | P1 |
| APP-03 | Notifications | Implemented | Desktop notification and optional sound when a run finishes, fails or needs approval; per-chat unread dots. | Both | P1 |
| APP-04 | Export transcripts | Implemented | Export a chat as Markdown or JSON including commands and file changes. | Both | P2 |
| APP-05 | Diagnostics | Implemented | A doctor page shows CLI versions and paths, sign-in state, sandbox readiness and recent errors. | Both | P2 |
| APP-06 | Multi-window sync | Implemented | Several windows of the app stay consistent: the workspace re-reads its state when a window regains focus. | Request | P1 |

### Apple, iPhone and platforms

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| PLAT-01 | Mac host support | Partial | Runs on macOS: zsh terminal, executable discovery without .exe, Finder reveal, Keychain-friendly logins. | Request | P0 |
| PLAT-02 | iPhone remote client | Implemented | Home-screen web app that pairs securely with the host computer to view chats, approve actions and send prompts; push notifications for approvals. | Request | P0 |
| PLAT-03 | Native Mac and iPhone apps | Implemented | Installs as an app with its own window and icon: Install app button (Chrome/Edge on Windows and Mac), Add to Home Screen on iPhone; scripts build a Mac .app for the Dock and a Windows Start-menu shortcut. No App Store or Xcode build. | Request | P2 |
| PLAT-04 | Responsive layout without overflow | Implemented | Every screen works from 375px wide to desktop with no sideways scrolling; long commands wrap. Chat overflow fixed; full pass pending. | Request | P0 |

### Audit 1 backlog

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| AUD1-01 | Keyboard control of runs | Implemented | Esc stops the running AI when focus is in the conversation; Shift+Tab cycles Ask, Auto-edit and Plan in the composer (Full access is never reached by accident). | Both | P1 |
| AUD1-02 | Keyboard shortcuts sheet | Implemented | Ctrl/Cmd+/ (and the palette) opens a list of every shortcut, grouped and searchable. | Both | P2 |
| AUD1-03 | Attach documents and code files | Implemented | Attach PDFs, text, Markdown, CSV, JSON and code files (not only images) by picking, pasting or dropping. Text files go into the prompt; Claude reads PDFs directly; GPT gets PDF text when it can be extracted (PDFs with custom font encodings are passed as a file path). | Both | P1 |
| AUD1-04 | Voice dictation | Implemented | A microphone button dictates into the message box using the browser speech service on the computer. Browsers allow the microphone only on secure pages, so on the iPhone (LAN address) the button is hidden and the keyboard dictation key is used instead. | Both | P2 |
| AUD1-05 | Quick memory with # | Implemented | A message starting with # is saved as a line in the project AGENTS.md (after confirming) instead of being sent. | Claude Code | P2 |
| AUD1-06 | Import past CLI sessions | Implemented | Lists earlier Claude Code and Codex CLI sessions for the project folder and opens one as a chat that resumes the same native session. | Both | P1 |
| AUD1-07 | Revert a single change block | Implemented | Each changed block in Changes has its own revert, saved as a new version. | Codex | P2 |
| AUD1-08 | Comment on changed lines | Implemented | Click a changed line in Changes to write a comment; comments go to the message box with file and line references. | Codex | P2 |
| AUD1-09 | Search across project files | Implemented | Search text in every project file from the Files view; results open the file at the matching line. | Both | P2 |
| AUD1-10 | Send-key preference | Implemented | Settings choose Enter to send (Shift+Enter for a new line) or Ctrl/Cmd+Enter to send. | Both | P2 |
| AUD1-11 | Up-to-date README and help | Implemented | README and in-app help describe the current features, Mac and iPhone setup, launchers and data locations. | Request | P1 |

### Audit 2 backlog

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| AUD2-01 | Automatic compact near the context limit | Implemented | When a chat has used 85% of the model context window, the native session is compacted first and then the message is sent; the run timeline says why. | Claude Code | P1 |
| AUD2-02 | Automatic Claude account switching | Implemented | With switching on, a Claude account whose recorded 5-hour or weekly window is at 100% is skipped for the next available signed-in account, like Codex. | Request | P1 |
| AUD2-03 | Connection-lost banner and silent reconnect | Implemented | If the computer stops answering, a banner says so and the app retries every 2 seconds; after a server restart the new token is picked up without reloading and running AIs are followed again. | Both | P1 |
| AUD2-04 | Long pastes become attachments | Implemented | Pasting more than 80 lines or 6,000 characters adds it as a text attachment chip instead of flooding the message box. | Claude Code | P2 |
| AUD2-05 | Usage limit warnings | Implemented | When an account passes 80% or 95% of a 5-hour or weekly window, a notice appears once per window with the reset time. | Both | P2 |
| AUD2-06 | Command-running settings only from the computer | Implemented | Hooks, tool servers (MCP) and computer use can only be changed from the computer itself, not from a paired phone, because they run commands on the computer. | Request | P1 |
| AUD2-07 | Quality pass on everything added in the audits | Implemented | New dialogs and controls are keyboard reachable with labels, readable in dark mode, and fit a 375px screen with no sideways scrolling. | Both | P0 |

### Interface system

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| UI-01 | Collapsible project and chat panels | Implemented | Each panel folds to a rail from its own header button; state is remembered. | Request | P0 |
| UI-02 | Own dropdowns everywhere | Implemented | All selects use the app's own dropdown component with keyboard support. | Request | P0 |
| UI-03 | Aligned header grid | Implemented | All panels share a 56px header row and 16px gutters so icons, titles and controls line up. | Request | P0 |
| UI-04 | Context menu component | Implemented | One reusable right-click and ⋯ menu with keyboard navigation, used by projects, chats, files and messages. | Both | P0 |
| UI-05 | Consistent empty, loading and error states | Implemented | Every panel has designed empty, loading and error states that explain the next step. | Both | P1 |

### Phase 0 requests (Oct 16)

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| P0X-01 | PRD board hidden at /backlog | Implemented | The board is not linked anywhere in the app; it opens at /backlog and the old /development.html redirects there. | Request | P0 |
| P0X-02 | Side browser screen sizes | Implemented | Desktop, Laptop, Tablet and Mobile presets plus rotate; mobile turns on touch and a phone user agent. The AI has the same control (browser_viewport). | Request | P0 |
| P0X-03 | Side browser tabs | Implemented | A tab strip with new tab, switch and close; pages opened in a new window appear as tabs. The AI can list, open, switch and close tabs (browser_tabs). | Request | P0 |
| P0X-04 | Preview keeps its own colour scheme | Implemented | Switching the app between dark and light no longer changes the preview or the side browser. Each has a Light / Dark / System page setting. | Request | P0 |
| P0X-05 | English and Bahasa Indonesia | Implemented | Settings › Language and the command palette switch menus, labels and messages between English and Bahasa Indonesia. Chats, code and files are never translated. | Request | P0 |
| P0X-06 | Several AIs at once in one project | Implemented | Each chat runs one task; up to four chats in a project can run at the same time (for example Claude builds while GPT makes images). Each run records only its own file changes. | Request | P0 |
| P0X-07 | Windows app launcher | Implemented | code by aqeel.exe in the app folder (10 KB, built from launcher/launcher.cs by scripts/build-exe.ps1) starts the server when needed and opens the app in its own Chrome or Edge window with the app icon. Verified: server started and a separate code by aqeel window opened. | Request | P0 |

### Round 1 audit · Claude Code parity

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| R1-01 | Calmer top bar | Implemented | The top bar shows icon buttons with tooltips; Usage, Connections and Phone sit in one menu; nothing wraps at 1280px. | Claude Code | P0 |
| R1-02 | Shortcut hints match the computer | Implemented | Windows shows Ctrl K, Mac shows ⌘K, in the top bar and tooltips. | Claude Code | P1 |
| R1-03 | One-row composer toolbar | Implemented | Provider, model, permission and AI-count controls fit one row at the default panel width and shrink before wrapping. | Claude Code | P0 |
| R1-04 | Send button reads as Send | Implemented | The composer button is an arrow Send button (Stop while running) with its shortcut in the tooltip, instead of the word Build. | Claude Code | P0 |
| R1-05 | New chat and search at the top of the sidebar | Implemented | The sidebar starts with a New chat button and a search box that filters projects and chats as you type. | Claude Code | P0 |
| R1-06 | No pile of empty New chat entries | Implemented | Starting a new chat while the current one is empty reuses it. | Claude Code | P1 |
| R1-07 | Helpful empty state | Implemented | A new chat offers four example prompts and puts the cursor in the message box. | Claude Code | P1 |
| R1-08 | Correct counts | Implemented | 1 file / 2 files, and the same for other counts in the header. | Both | P2 |
| R1-09 | Simpler Files toolbar | Implemented | Files tools are compact buttons with labels on hover; Save stays primary; the duplicate file dropdown hides while the tree is shown. | Claude Code | P1 |
| R1-10 | Line numbers in the editor | Implemented | The editor shows a line-number gutter that scrolls with the text. | Both | P1 |
| R1-11 | Keyboard shortcuts for panels | Implemented | Ctrl+1 to Ctrl+4 open Preview, Files, Changes and Browser; Ctrl+` toggles the terminal; listed in Keyboard shortcuts. | Claude Code | P1 |
| R1-12 | Preview sizes match the side browser | Implemented | The preview offers Desktop, Laptop, Tablet and Mobile with the pixel size shown. | Request | P1 |
| R1-13 | Connection status you can click | Implemented | The sidebar footer shows a dot per provider and opens Connections when clicked. | Both | P2 |
| R1-14 | Readable change history | Implemented | Each saved change shows a relative time (5 min ago) and its files as chips. | Claude Code | P1 |
| R1-15 | Chat title you can rename in place | Implemented | The conversation header shows the chat title; clicking it renames the chat. | Claude Code | P1 |
| R1-16 | Toasts that stay out of the way | Implemented | Notifications appear at the bottom centre, stack, and fade after a few seconds. | Both | P2 |
| R1-17 | Visible keyboard focus everywhere | Implemented | Every button, tab and link shows a clear focus ring in light and dark mode. | Both | P1 |
| R1-18 | Theme button shows the theme | Implemented | The theme control is a sun/moon icon that reflects the current theme, including Match my computer. | Claude Code | P2 |
| R1-19 | Clear terminal header | Implemented | Terminal tabs read AI commands and the shell name; Close is an icon with a label. | Claude Code | P2 |
| R1-20 | Loading placeholders | Implemented | While projects load, the sidebar shows placeholder rows instead of a line of text. | Both | P2 |

### Round 2 audit · every page and menu

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| R2-01 | Settings in sections | Implemented | Settings groups its options under General, Chats, AI access, Notifications and Tool servers, each with a heading. | Claude Code | P0 |
| R2-02 | Real switches in Settings | Implemented | On/off options in Settings use the same switch control as the Connections page, with the label clickable. | Both | P1 |
| R2-03 | Save is always in reach | Implemented | Settings keeps Cancel and Save visible at the bottom while its content scrolls. | Both | P1 |
| R2-04 | Command palette groups | Implemented | The palette shows a group heading once (Actions, Chats, Messages) instead of a tag on every row. | Claude Code | P1 |
| R2-05 | Shortcuts in the palette | Implemented | Palette actions that have a shortcut show it on the right (Ctrl+1, Ctrl+`, Ctrl+/ and so on). | Claude Code | P1 |
| R2-06 | Menus that do not wrap | Implemented | Context menus are wide enough that a label never wraps under its hint. | Both | P2 |
| R2-07 | One New chat button | Implemented | The labelled New chat lives in the sidebar; the conversation header keeps a compact icon for when the sidebar is collapsed. | Claude Code | P1 |
| R2-08 | Complete diagnostics | Implemented | Diagnostics lists Gemini (installed or not) and uses correct plurals such as 1 project. | Both | P2 |
| R2-09 | Usage filters read as labels | Implemented | Provider, Account and Project labels are small and muted next to their filters, not larger than the values. | Both | P1 |
| R2-10 | Chart dates never overlap | Implemented | The tokens-per-day chart thins its date labels so none overlap, at any width. | Both | P1 |
| R2-11 | Tables fit their cards | Implemented | Usage tables scroll inside their card instead of being cut off; numbers stay right-aligned. | Both | P1 |
| R2-12 | Consistent usage text | Implemented | Credits balance and other account notes use the same small text style as the rest of the limits card. | Both | P2 |
| R2-13 | Connections is a settings page | Implemented | The Connections page opens with the title Connections and one line of explanation, not a marketing headline. | Both | P1 |
| R2-14 | Selected account shown once | Implemented | The selected account shows a single Selected badge; the name line no longer repeats it. | Both | P2 |
| R2-15 | One header across pages | Implemented | Workspace, Usage and Connections share the same header with Workspace, Usage and Connections links and the current page highlighted. | Claude Code | P0 |
| R2-16 | Same close button in every dialog | Implemented | Customize, Diagnostics and other dialogs close with the same × icon button at the top right. | Both | P2 |
| R2-17 | Board shows the latest status | Implemented | The /backlog board re-reads its data when it changes on disk, so status updates appear without restarting the app. | Request | P1 |
| R2-18 | Clear terminal input | Implemented | The terminal command box says Type a command and shows the shell, instead of only an example command. | Both | P2 |
| R2-19 | Backlog page fits the app | Implemented | The /backlog page uses the app header and the plain title Backlog. | Request | P2 |
| R2-20 | Plain restore wording | Implemented | Each saved change offers Restore to before this, and the result message says the restore can itself be undone. | Claude Code | P2 |

### Round 3 audit · responsive and themes

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| R3-01 | Phone top bar keeps its tools | Implemented | On phones the top bar shows search, terminal, theme, settings and more as icons instead of a menu of blank items. | Both | P0 |
| R3-02 | Composer controls packed together | Implemented | Composer controls sit side by side with even gaps at every width; Send stays at the end of the last row. | Claude Code | P1 |
| R3-03 | Compact phone composer | Implemented | On phones the message box starts shorter and the hint line is hidden, leaving room for the conversation. | Claude Code | P1 |
| R3-04 | Phone welcome fits one screen | Implemented | On phones the empty chat shows two example prompts so the heading, prompts and composer fit together. | Both | P2 |
| R3-05 | Logo never wraps | Implemented | The code by aqeel wordmark stays on one line at every width. | Both | P2 |
| R3-06 | Centred composer icons | Implemented | The attach and dictate icons are centred in their round buttons. | Both | P2 |
| R3-07 | Phone Files toolbar | Implemented | On phones Files shows no empty dropdown and hides Open in VS Code, which needs the computer. | Both | P1 |
| R3-08 | Aligned editor label | Implemented | The file name above the editor lines up with the editor's edge. | Both | P2 |
| R3-09 | Phone side browser address bar | Implemented | On phones the side browser address bar gets the width (Go is hidden; Enter opens the page) and the size buttons fit. | Request | P1 |
| R3-10 | Usable workspace on small laptops | Implemented | Between 851 and 1200px the projects and chat panels cap their width so the workspace keeps at least 360px. | Both | P1 |
| R3-11 | Theme switches without a flash | Implemented | Switching light and dark repaints at once instead of briefly showing white boxes with light text. | Both | P1 |
| R3-12 | Bahasa for new settings and the browser | Implemented | Settings sections, browser help, model descriptions and restore wording appear in Bahasa Indonesia. | Request | P1 |
| R3-13 | Correct Bahasa endings | Implemented | Longer endings are matched first, so Gemini · not connected reads Gemini · tidak terhubung. | Request | P1 |
| R3-14 | Dark mode on Usage, Connections and Backlog | Implemented | These pages follow the workspace theme instead of always staying light. | Both | P0 |
| R3-15 | Theme follows across open pages | Implemented | Changing the theme in the workspace updates Usage, Connections and Backlog pages that are already open. | Both | P2 |
| R3-16 | Readable status in dark mode | Implemented | Signed-in status text on Connections is bright enough to read in dark mode. | Both | P2 |
| R3-17 | Active range visible in dark mode | Implemented | The selected time range on Usage stands out in dark mode. | Both | P2 |
| R3-18 | Settings footer flush on phones | Implemented | Settings content no longer peeks out below the Cancel and Save bar. | Both | P2 |
| R3-19 | Page headers fit phones | Implemented | On phones Usage, Connections and Backlog headers keep one row: the logo mark and all three links, with no sideways page scroll. | Both | P1 |
| R3-20 | Calm toasts with reduced motion | Implemented | With Reduce motion on, notifications appear without sliding. | Both | P2 |
| R3-21 | Backlog page in Bahasa and dark mode | Implemented | The /backlog page follows the language and theme settings. | Request | P2 |
| R3-22 | Logo readable on dark pages | Implemented | The logo mark is inverted on dark Usage, Connections and Backlog pages. | Both | P2 |
| R3-23 | Phones held sideways | Implemented | In landscape on a phone the top bar, message box and bottom tabs slim down so messages stay visible. | Both | P1 |
| R3-24 | Filters stay on one line | Implemented | Sidebar filters (All, Active, Unread) never wrap, including Belum dibaca in Bahasa. | Request | P2 |
| R3-25 | No desktop shortcuts on touch | Implemented | On touch screens the palette and search button hide Ctrl key hints. | Both | P2 |
| R3-26 | Palette fully translated | Implemented | Palette actions such as Show Preview and Toggle terminal are fully translated, not half English. | Request | P2 |
| R3-27 | Terminal opens where you can see it | Implemented | On phones the terminal button switches to the Workspace screen so the terminal is visible. | Both | P1 |
| R3-28 | Terminal tabs readable on phones | Implemented | Terminal tab names (AI commands, PowerShell) show on phones instead of empty pills. | Both | P1 |
| R3-29 | Terminal header translated | Implemented | Terminal tabs and buttons follow the language setting; command output is never translated. | Request | P2 |
| R3-30 | Model table has room | Implemented | The By model table spans the full width of the Usage page so all columns are visible. | Both | P2 |

### Round 4 audit · UX flows

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| R4-01 | One quiet line of reply details | Implemented | Each reply shows one muted line (model, tokens, estimated cost); the cache share, billing note and account are in its tooltip. | Claude Code | P1 |
| R4-02 | Change names end on a whole word | Implemented | Saved changes are labelled with the prompt cut at a word boundary and an ellipsis, not mid-word. | Both | P2 |
| R4-03 | The composer follows the chat | Implemented | Opening a chat selects the provider, model and effort it last used, so switching chats does not silently switch AI. | Claude Code | P0 |
| R4-04 | Claude retries a busy sign-in | Implemented | When Claude reports that another Claude Code process is refreshing its sign-in, the run waits 15 seconds and retries once, with a note in the chat. | Both | P1 |
| R4-05 | Two AIs at once, verified | Implemented | Claude and GPT answered in two chats of one project at the same time. | Request | P0 |
| R4-06 | Each run keeps its own changes | Implemented | With Claude and GPT editing at the same time, each saved change lists only the file that AI wrote (a.txt and b.txt). | Request | P0 |
| R4-07 | Plan buttons only under a plan | Implemented | Build this plan and Revise the plan appear only when a Plan-mode reply contains a list or headings. | Claude Code | P2 |
| R4-08 | Help when no AI is connected | Implemented | If no provider is signed in, the composer says so and links to Connections. | Both | P1 |
| R4-09 | General message box wording | Implemented | The message box invites any request: Ask anything, or describe what to build or change. | Claude Code | P2 |
| R4-10 | General welcome | Implemented | A new chat asks What should we work on? and explains you can ask about code, change it or start a site. | Claude Code | P2 |
| R4-11 | Jump to the latest message | Implemented | Scrolling up in a long chat shows a Latest button that scrolls back to the end. | Claude Code | P1 |
| R4-12 | Failed replies look like errors | Implemented | A failed run is shown in red with an accent bar instead of looking like a normal answer. | Both | P1 |
| R4-13 | Stop next to Send | Implemented | While the open chat runs, a Stop button sits next to Send. | Claude Code | P0 |
| R4-14 | Enter opens the first search match | Implemented | Pressing Enter in the sidebar search opens the first matching chat. | Claude Code | P2 |
| R4-15 | Ctrl+Shift+F searches files | Implemented | Ctrl+Shift+F opens search across project files. | Both | P2 |
| R4-16 | New changes counted on the tab | Implemented | When an AI saves changes while you are elsewhere, the Changes tab shows how many are new until you open it. | Claude Code | P1 |
| R4-17 | Ctrl+L goes to the message box | Implemented | Ctrl+L puts the cursor in the message box (and opens the chat screen on phones). | Claude Code | P2 |
| R4-18 | Alt+N starts a new chat | Implemented | Alt+N starts a new chat in the current project, reusing an empty one. | Claude Code | P2 |
| R4-19 | Retry stands out after a failure | Implemented | Under a failed reply, Retry is the primary button. | Both | P2 |
| R4-20 | Changed files open with a click | Implemented | File names in Updated … under a reply open that file in Files. | Claude Code | P1 |
| R4-21 | Running hint in the composer | Implemented | While the chat runs, the hint says Esc stops the AI and Send adds to the run. | Claude Code | P2 |
| R4-22 | Times on hover | Implemented | Hovering a message shows when it was sent. | Both | P2 |
| R4-23 | Mode shows its risk | Implemented | The permission pill is blue in Plan and red in Full access. | Claude Code | P1 |
| R4-24 | Window title marks finished work | Implemented | If a run finishes while the window is in the background, the title starts with ✓ until you come back. | Claude Code | P2 |
| R4-25 | Chat rows show last activity | Implemented | Hovering a chat in the sidebar shows its title and when it was last active. | Both | P2 |
| R4-26 | Message box grows with the text | Implemented | The message box grows as you type, up to 40% of the window, and shrinks after sending. | Claude Code | P1 |
| R4-27 | Cursor stays in the message box | Implemented | After sending, the cursor stays in the message box ready for the next message. | Claude Code | P2 |
| R4-28 | New shortcuts listed | Implemented | Keyboard shortcuts lists Ctrl+L, Alt+N and Ctrl+Shift+F under Chats. | Both | P2 |
| R4-29 | Clear running status per chat | Implemented | The bar above the composer says when another chat in the project is working at the same time, without blocking this chat. | Request | P1 |
| R4-30 | Round 4 in Bahasa | Implemented | All new round 4 text has Bahasa Indonesia translations. | Request | P2 |

### Round 5 audit · design hierarchy and polish

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| R5-01 | Brand balanced with the tools | Implemented | The wordmark is 19px so it no longer outweighs the top bar icons. | Claude Code | P2 |
| R5-02 | Chat title on one line | Implemented | Long chat titles in the conversation header end with an ellipsis instead of wrapping. | Claude Code | P2 |
| R5-03 | Quieter sidebar heading | Implemented | PROJECTS is a small uppercase label so the chats themselves lead. | Claude Code | P2 |
| R5-04 | Steady numbers | Implemented | Counts, sizes and token figures use tabular digits so they do not jitter as they change. | Both | P2 |
| R5-05 | Who answered, at a glance | Implemented | Each reply starts with a colour dot: orange Claude, blue GPT, green Gemini (the Usage chart colours). | Request | P1 |
| R5-06 | Comfortable line length | Implemented | Message text stops at about 72 characters per line for easier reading. | Both | P2 |
| R5-07 | Consistent corners | Implemented | Message bubbles, code blocks and images use the shared radius tokens. | Both | P2 |
| R5-08 | Wide tables scroll | Implemented | Tables in replies scroll sideways inside the message instead of stretching the chat. | Both | P2 |
| R5-09 | Images fit replies | Implemented | Images in replies scale down to the message width. | Both | P2 |
| R5-10 | Links in brand blue | Implemented | Links in replies use the brand blue in both themes. | Both | P2 |
| R5-11 | Composer adapts to its width | Implemented | Wide composer: one row. Narrow: pickers on top, attach and dictate with Send below, so no control sits alone on a row. | Claude Code | P0 |
| R5-12 | Stop and Send together | Implemented | Stop and Send always sit together at the right end of the composer. | Claude Code | P2 |
| R5-13 | Composer focus glow | Implemented | The composer shows a soft blue ring while you type. | Both | P2 |
| R5-14 | Current chat accent | Implemented | The open chat in the sidebar has a blue accent bar. | Claude Code | P2 |
| R5-15 | Matched sidebar icons | Implemented | Sidebar header buttons share one icon size. | Both | P2 |
| R5-16 | Resize handles you can find | Implemented | Panel resize handles tint on hover. | Both | P2 |
| R5-17 | Quiet scrollbars | Implemented | Scrollbars are thin and use the border colour in both themes. | Both | P2 |
| R5-18 | Clear disabled buttons | Implemented | Disabled buttons are dimmed and show a not-allowed cursor. | Both | P2 |
| R5-19 | Primary hover feedback | Implemented | Primary buttons brighten slightly on hover. | Both | P2 |
| R5-20 | Brand selection colour | Implemented | Selected text uses a soft brand blue. | Both | P2 |
| R5-21 | Readable placeholders | Implemented | Placeholder text uses the muted colour with enough contrast. | Both | P2 |
| R5-22 | Menus open smoothly | Implemented | Context menus scale in over 120ms (none with Reduce motion). | Claude Code | P2 |
| R5-23 | Dialogs open gently | Implemented | Dialogs fade and scale in over a softly blurred, dimmed backdrop. | Claude Code | P2 |
| R5-24 | Comfortable menu rows | Implemented | Menu items are at least 32px tall with even separators. | Both | P2 |
| R5-25 | Views fade in | Implemented | Switching Preview, Files, Changes and Browser fades the new view in. | Claude Code | P2 |
| R5-26 | Wider Settings | Implemented | Settings is 540px wide so hints are not cramped. | Both | P2 |
| R5-27 | Long toasts wrap neatly | Implemented | Long notifications wrap, centred, up to 460px wide. | Both | P2 |
| R5-28 | File path reads as a path | Implemented | The preview file path uses the code font in muted grey. | Both | P2 |
| R5-29 | Even change cards | Implemented | Saved changes are spaced evenly in a grid. | Both | P2 |
| R5-30 | Dark mode structure | Implemented | Panel borders are a touch brighter in dark mode so the layout stays clear. | Both | P2 |
| R5-31 | Consistent icon strokes | Implemented | Header and sidebar icons share the same stroke width. | Both | P2 |
| R5-32 | Font arrives with the page | Implemented | Plus Jakarta Sans is preloaded, so text does not swap fonts after loading. | Both | P1 |
| R5-33 | Smooth sidebar search | Implemented | Sidebar search redraws after a short pause in typing instead of on every key. | Both | P2 |
| R5-34 | Dead styles removed | Implemented | Styles for the removed palette tags and the old phone menu are gone. | Request | P2 |
| R5-35 | Clear empty Files state | Implemented | An empty project says No files yet and how to add some. | Both | P2 |
| R5-36 | New project button explains itself | Implemented | The new project button is a folder-plus icon whose tooltip lists empty, open a folder or clone. | Both | P2 |
| R5-37 | No zero-cost noise | Implemented | Cost estimates under half a cent are not shown under replies. | Both | P2 |
| R5-38 | Chats open at the latest message | Implemented | Opening a long chat lands on the newest message (checked after the performance pass). | Claude Code | P1 |
| R5-39 | Reply actions on hover | Implemented | Copy and Retry appear when you point at or focus a reply, and always under failed replies and on touch screens. | Claude Code | P1 |
| R5-40 | Context meter warms up | Implemented | The context pill turns amber from 60% and red from 80%. | Claude Code | P2 |
| R5-41 | Commands as a quiet chip | Implemented | Ran 2 commands is a small chip with a turning arrow when opened. | Claude Code | P2 |
| R5-42 | One key style | Implemented | Keyboard keys look the same in the search button, palette and shortcuts list. | Both | P2 |
| R5-43 | Dark user bubbles | Implemented | Your messages have a distinct, readable bubble in dark mode. | Both | P2 |
| R5-44 | Dark code blocks | Implemented | Code in replies sits on a darker panel in dark mode. | Both | P2 |
| R5-45 | Dark top bar edge | Implemented | The top bar border is subtle in dark mode. | Both | P2 |
| R5-46 | Hovers confirm what is clickable | Implemented | Tabs, project rows and chat rows highlight on hover. | Both | P2 |
| R5-47 | Change titles stay tidy | Implemented | Saved change titles wrap to at most two lines. | Both | P2 |
| R5-48 | Browser welcome with an icon | Implemented | The empty side browser shows a globe icon above its explanation. | Both | P2 |
| R5-49 | Replies name the model that ran | Implemented | Reply details name the model you chose when it ran, otherwise the one that used the most tokens (Claude Code also calls helper models). | Both | P1 |
| R5-50 | Duplicate styles removed | Implemented | Rules that appeared twice in the stylesheet now appear once. | Request | P2 |

### Round 6 · screen-by-screen balance pass

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| R6-01 | Title bar that matches the app | Implemented | The window's title bar takes the app colour (white or dark). After Install app, the app draws its top bar into the title bar like Claude's desktop app, and code by aqeel.exe opens that installed app. | Request | P0 |
| R6-02 | Centred composer icons | Implemented | Attach and dictate are line icons centred in their buttons instead of text characters. | Request | P1 |
| R6-03 | Settings in two columns | Implemented | Each setting has its label and hint on the left and its control on the right, with one divider per section instead of one per row. | Request | P0 |
| R6-04 | No duplicate Tool servers title | Implemented | The Tool servers section shows its heading once, with no extra line, and inputs that match other controls. | Request | P1 |
| R6-05 | One icon set | Implemented | Browser and preview toolbars use the same line icons (back, forward, reload, pick, screenshot, rotate, light, dark, system) instead of mixed glyphs and emoji. | Request | P1 |
| R6-06 | Model and effort chosen separately | Implemented | The composer has a Model list (one row per model, with descriptions) and a separate Effort picker, instead of one 40-row list. | Claude Code | P0 |
| R6-07 | Sizes glide when you switch | Implemented | Switching Desktop, Laptop, Tablet and Mobile animates the preview and side browser to the new size. | Request | P1 |
| R6-08 | Transitions never stuck off | Implemented | A theme switch that started while the window was hidden no longer leaves every animation disabled. | Both | P1 |
| R6-09 | Sidebar edges line up | Implemented | New chat, search, filters and the project list share one left and right edge. | Request | P2 |
| R6-10 | Preview toolbar on one row | Implemented | Refresh is an icon and the file path gives way first, so the preview toolbar never wraps. | Request | P1 |
| R6-11 | Quieter Files toolbar | Implemented | Files tools are text buttons; Save is the only primary; the duplicate file-name heading above the editor is gone. | Request | P2 |
| R6-12 | Browser toolbar matches Preview | Implemented | Size buttons, address bar and Go share the Preview's sizes; a blank tab shows the side browser welcome. | Request | P2 |
| R6-13 | Rewind stays out of the way | Implemented | Rewind to here sits quietly at the right of your message and appears on hover. | Request | P2 |
| R6-14 | Settings links on one row | Implemented | Customize, Diagnostics and Guide fit on one row. | Request | P2 |
| R6-15 | Same close button in Keyboard shortcuts | Implemented | Keyboard shortcuts closes with the × used by every other dialog. | Request | P2 |
| R6-16 | Skills as tidy rows | Implemented | Each skill shows its name and description, a source badge and a switch on one row; switches look the same everywhere. | Request | P1 |
| R6-17 | Steady Customize dialog | Implemented | Customize keeps one height when you switch between Prompts, Skills, Hooks and Schedules; hook and schedule inputs match in size and Remove sits at the right. | Request | P2 |
| R6-18 | Schedules hide unused fields | Implemented | The Day field (label included) only appears for weekly schedules. | Request | P2 |
| R6-19 | Phone dialog spacing | Implemented | The phone access switch has space before its label and the steps align. | Request | P2 |
| R6-20 | Connections without noise | Implemented | No Accounts chips above account headings, no identity line before you sign in, and the footer no longer says Connection tester. | Request | P2 |
| R6-21 | Backlog toolbar grouped | Implemented | Search, priority and count sit together; the Kanban/List switch matches the app's segmented controls. | Request | P2 |
| R6-22 | Five pickers fit a phone | Implemented | On phones the provider, model, effort, mode and AI pickers fit one row. | Request | P1 |
| R6-23 | Bahasa for the new controls | Implemented | Effort, Model, (default), hooks and schedules help, install and context tooltips are translated. | Request | P2 |
| R6-24 | Title bar coloured by the launcher | Partial | code by aqeel.exe keeps the app window's title bar in the app colour (white, or dark in dark mode) through Windows 11, and the Install button now shows in the app window. Needs a visual check on the user's screen. | Request | P0 |
| R6-25 | Measured UI check | Implemented | scripts/ui-check.js measures every visible button for off-centre icons, cut-off text and clipping. Run across every screen, dialog and menu at 375, 1024 and 1440px in English and Bahasa: zero findings. | Request | P0 |
| R6-26 | Icons centred in every icon button | Implemented | Icon-only buttons no longer inherit text padding, which had pushed the attach and dictate icons 8px sideways and the new chat, collapse and refresh icons 2 to 4px. | Request | P0 |
| R6-27 | Balanced new chat icon | Implemented | New chat uses a square-and-pencil compose icon centred in its button. | Request | P2 |
| R6-28 | Menus fit their longest item | Implemented | Context menus size to their content, so items such as Open a past CLI session are never cut. | Request | P2 |
| R6-29 | Toolbars follow the panel width | Implemented | Preview and browser toolbars adapt to the workspace panel's own width, so narrow panels never push Refresh or the page scheme out of view. | Request | P1 |
| R6-30 | Message buttons translated | Implemented | Copy, Retry, Rewind, plan and command buttons inside chat messages follow the language setting; the message text itself is never translated. | Request | P1 |
| R6-31 | Deleting a project always works | Implemented | Delete stops the project's dev server, terminals and any program an AI left running in its folder, retries while Windows releases files, and only then removes the project from the list. Leftover folders from earlier failures are cleaned at start-up. | Request | P0 |
| R6-32 | Select an element in Preview | Implemented | A Select element button in the Preview toolbar outlines whatever you point at (with its tag and size); clicking adds its selector, text and HTML to your message with the cursor ready. Esc cancels. | Request | P0 |
| R6-33 | Outline while picking in the side browser | Implemented | Pick element in the side browser now outlines the element under the pointer before you click. | Request | P1 |
| R6-34 | Folder icon for projects | Implemented | Projects show a folder icon (open while expanded) instead of a box that looked like a checkbox. | Request | P2 |
| R6-35 | Usage tables use the full width | Implemented | By model and By account span the page; long account emails shorten instead of scrolling sideways. | Request | P2 |
| R6-36 | Device frame in Preview and side browser | Implemented | Pages sit on a soft backdrop with a border, rounded corners and a shadow so their edges are clear at Mobile, Tablet and Laptop sizes. | Request | P1 |
| R6-37 | Sharp app icon at every size | Implemented | assets/icon.ico holds 16 to 256 px images (scripts/make-ico.ps1), so the exe, taskbar and Explorer icons are crisp. | Request | P2 |
| R6-38 | New project as a centred pop-up | Implemented | The folder + button (and New project in the sidebar and palette) opens a centred pop-up with three cards: Empty project, Open a folder, Clone from GitHub, each with an icon and one line of explanation. Cards stack on phones; Esc or × closes. | Request | P1 |
| R6-39 | Modern Windows folder picker | Implemented | Open a folder uses the Explorer-style Select Folder window (IFileOpenDialog) with an Open in code by aqeel button, not the old Browse For Folder tree. | Request | P1 |
| R6-40 | Chat without a project | Implemented | New chat or Send with no project makes one (named after the first words of the message) instead of failing with Project not found; the empty sidebar explains this. | Request | P0 |
| R6-41 | Panels fold smoothly | Implemented | Folding the sidebar or chat slides the columns (0.28 s); dragging a divider stays instant. | Request | P2 |
| R6-42 | Browser tabs animate and reorder | Implemented | New side-browser tabs grow in, closed ones shrink away, and tabs can be dragged into any order (remembered). | Request | P1 |
| R6-43 | Composer after the Hermes one | Implemented | Attach, dictate, dictation language (EN/ID), permission and AI count on the left; one model picker grouped by AI, effort and a round Send on the right. Labels turn into icons, then the pickers take a second row, as the panel narrows. | Request | P1 |
| R6-44 | Quiet sidebar selection | Implemented | The open chat is one soft grey row (no blue fill, accent bar or tree guide line); the open project name stays dark. | Request | P1 |
| R6-45 | Folded sidebar rail | Implemented | Folded, the sidebar shows only icons: fold, new project, a round + for New chat and project tiles; search hides. Content keeps its width while unfolding instead of wrapping. | Request | P1 |
| R6-46 | Menus fade both ways | Implemented | Dropdowns and the more menus always animate open and now fade out on close instead of vanishing. | Request | P1 |
| R6-47 | Dropdowns work inside pop-ups | Implemented | A dropdown opened inside a dialog (for example Your repositories in Clone from GitHub) shows above the dialog and can be scrolled and clicked. | Request | P0 |
| R6-48 | Air between highlighted rows | Implemented | The project row and its chats have a small gap, so hover and selection highlights never touch. | Request | P2 |

### V2 · Make anything: start by intent

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| MAKE-01 | Start by what you want to make | Implemented | A new chat opens “What do you want to make?” with App or website, Slides, Document, Design, Research report, Data and charts, Image or video. Each choice sets the AI instructions, the output folder and which side panel opens. | Request | P0 |
| MAKE-02 | Templates for each kind | Implemented | Each kind offers 4 to 8 templates with thumbnails (pitch deck, monthly report, landing page, one-pager, PRD, social post). Picking one fills the prompt and the design system. | Claude Design | P1 |
| MAKE-03 | Projects remember their kind | Implemented | A project keeps its main kind; its sidebar icon and the panel it opens with follow it. | Request | P1 |
| MAKE-04 | Several outputs in one project | Implemented | One project can hold a site, its deck and its docs, listed under Outputs in the sidebar; each opens in the right panel. | Request | P1 |
| MAKE-05 | Offer the right kind from the prompt | Implemented | Typing “make a 10-slide deck about…” in a plain chat shows a one-click “Make it as Slides” chip. | Claude | P2 |

### V2 · Artifacts panel

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| ART-01 | Artifacts tab in the work panel | Implemented | The work panel gets an Artifacts tab that renders whatever the AI makes (HTML, Markdown, SVG, Mermaid, images, PDF, single-file React) and opens by itself when one is created. | Claude | P0 |
| ART-02 | Versions per turn | Implemented | Every artifact keeps a version per AI turn: a version menu, side-by-side compare, and Restore. | Claude | P0 |
| ART-03 | Live updates while the AI writes | Implemented | The panel refreshes as the file changes, with no flash and the scroll position kept. | Claude | P0 |
| ART-04 | Point at something to change it | Implemented | Pick an element in an artifact (like the Preview picker) and ask for a change; the request names that element. | Claude Design | P1 |
| ART-05 | Comments pinned to a spot | Implemented | Leave comments on parts of an artifact, send them to the AI as one request, and resolved comments fold away. | Claude Design | P1 |
| ART-06 | Private share link | Implemented | Publish an artifact to a private view-only link (on this network or the Dokploy box) and unpublish it any time. | Claude | P1 |
| ART-07 | Download in the right format | Implemented | Download as HTML, PDF or PNG, or in the kind’s own format (PPTX, DOCX, XLSX). | Claude | P0 |
| ART-08 | Full screen and own window | Implemented | Open an artifact full screen or pop it out into its own window. | Claude | P2 |
| ART-09 | Inline charts and diagrams in replies | Implemented | Small charts, diagrams and tables render inside the reply, with “Open in panel”. | Claude | P1 |
| ART-10 | Sandboxed artifacts | Implemented | Artifacts run sandboxed with no access to the app token, other projects or files; outside scripts only load from allowed CDNs. | Claude | P0 |
| ART-11 | Artifacts that keep data | Implemented | An artifact (a tracker, a sign-up form) can keep its own small database, which the AI can read and update. | Claude | P2 |

### V2 · Slides and decks

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| DECK-01 | Slides as a kind | Implemented | Asking for a deck makes real slides: the panel shows a slide strip and the current slide large. | Claude Design | P0 |
| DECK-02 | Slide layouts | Implemented | Title, section, bullets, two-column, image and text, quote, big number, chart, table, timeline, team and closing layouts; the AI picks one per slide. | Claude Design | P0 |
| DECK-03 | Decks follow a design system | Implemented | A deck uses the chosen design system (fonts, colours, logo, spacing); switching it restyles every slide. | Claude Design | P0 |
| DECK-04 | Edit text on the slide | Implemented | Click any text on a slide to edit it; the change saves as a version. | Claude Design | P0 |
| DECK-05 | AI actions per slide | Implemented | Each slide offers Rewrite, Shorten, Make visual, Add chart, Split in two and New image. | Claude Design | P1 |
| DECK-06 | Reorder, duplicate and delete slides | Implemented | Drag slides in the strip (keyboard works too), duplicate or delete them, all animated. | Claude Design | P0 |
| DECK-07 | Speaker notes | Implemented | Every slide has notes the AI can write; sources for facts go in the notes. | Claude Design | P1 |
| DECK-08 | Present mode | Implemented | Full-screen presenting with arrow keys, a timer, the next slide and notes in a second window. | Claude Design | P1 |
| DECK-09 | Export PPTX and PDF | Implemented | PPTX with real editable text boxes, not pictures; PDF with one page per slide; fonts mapped correctly. | Claude Design | P0 |
| DECK-10 | Import a PPTX or PDF | Implemented | Bring an existing deck in to restyle it or carry on. | Claude Design | P2 |
| DECK-11 | Images in slides | Implemented | Generate images (through a connected image tool) or use uploads, then crop and place them. | Claude Design | P1 |
| DECK-12 | Charts from data | Implemented | Paste numbers or attach a CSV; chart slides stay editable as data. | Claude Design | P1 |
| DECK-13 | Review the deck | Implemented | “Review deck” gives a verdict per slide (clarity, density, hierarchy) and one-click fixes. | Request | P2 |

### V2 · Documents

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| DOC-01 | Documents as a kind | Implemented | A rich document opens in the panel: headings, lists, tables, images, callouts and code. | Claude | P0 |
| DOC-02 | Write together with the AI | Implemented | You can type while the AI edits other sections; its edits show highlighted to accept or reject. | Claude | P0 |
| DOC-03 | Comments and suggestions | Implemented | Select text, comment, and ask the AI to address it; suggested edits are tracked. | Claude | P1 |
| DOC-04 | Outline that fills itself | Implemented | An outline sidebar; the AI fills placeholder sections one by one while you watch. | Claude | P1 |
| DOC-05 | Export DOCX, PDF and Markdown | Implemented | Headings, tables and images survive export. | Claude | P0 |
| DOC-06 | Import DOCX, PDF and Markdown | Implemented | Open an existing document and continue it. | Claude | P2 |
| DOC-07 | Citations | Implemented | Research-backed documents carry numbered footnotes with links. | Claude | P1 |
| DOC-08 | Document templates | Implemented | PRD, proposal, report, SOP, meeting notes and case study templates. | Request | P2 |

### V2 · Design canvas

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| DSGN-01 | Design canvas | Implemented | A zoomable canvas of frames (desktop, tablet, phone, social sizes) that the AI draws into. | Claude Design | P0 |
| DSGN-02 | Variations side by side | Implemented | Ask for three variations, pick one, or mix parts of several. | Claude Design | P0 |
| DSGN-03 | Click-through prototype | Implemented | Link buttons to frames and click through the flow. | Claude Design | P1 |
| DSGN-04 | Select and tweak | Implemented | Select something in a frame and change its text, colour or spacing in a small inspector, or ask the AI. | Claude Design | P1 |
| DSGN-05 | Export and hand off | Implemented | Export frames as PNG, SVG or PDF; “Build this” turns the design into an app project with the same look. | Claude Design | P0 |
| DSGN-06 | Social and ad sizes | Implemented | Presets for Instagram post and story, Facebook ad, LinkedIn post and YouTube thumbnail. | Request | P1 |
| DSGN-07 | Design and build compared | Implemented | After building, the design and the running app show side by side so differences are easy to spot. | Request | P2 |

### V2 · Design systems

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| DS-01 | Design system library | Implemented | Create and keep design systems: colours, fonts (Google Fonts), radius, spacing, logo and tone of voice. | Claude Design | P0 |
| DS-02 | Make one from a site, code or brand guide | Implemented | Build a design system from a URL (read through the side browser), a codebase, a brand PDF or images. | Claude Design | P0 |
| DS-03 | Used everywhere by default | Implemented | Decks, documents, designs and new apps use the project’s design system unless you pick another. | Claude Design | P0 |
| DS-04 | Design system page | Implemented | Each design system has a page with swatches, type scale and sample components. | Claude Design | P1 |
| DS-05 | Export tokens | Implemented | Export as CSS variables, Tailwind config or JSON tokens. | Claude Design | P2 |

### V2 · Data and charts

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| DATA-01 | Spreadsheet attachments | Implemented | CSV and XLSX attachments are read; the AI sees the columns and sample rows. | Claude | P0 |
| DATA-02 | Analysis with code | Implemented | The AI analyses data by running code in the project and shows the result with its charts. | Claude | P0 |
| DATA-03 | Editable charts | Implemented | Bar, line, pie and scatter charts in the panel; change type, labels and colours; export PNG. | Claude | P1 |
| DATA-04 | Dashboards | Implemented | A dashboard artifact with several charts and filters that refreshes from its source. | Claude | P1 |
| DATA-05 | Export XLSX | Implemented | Tables export as formatted spreadsheets. | Claude | P2 |

### V2 · Research

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| RES-01 | Web search in chat | Implemented | A Search toggle lets the AI search the web; the sources it used are listed under the reply. | Claude | P0 |
| RES-02 | Deep research | Implemented | A research run plans, reads many sources, shows progress as steps and writes a cited report document. | Claude | P1 |
| RES-03 | Read links and PDFs | Implemented | Paste a URL or attach a PDF and the AI reads it (through the side browser or the attachment). | Claude | P0 |
| RES-04 | Reports become documents | Implemented | A research report opens as a document you can edit, export or turn into a deck. | Claude | P1 |

### V2 · Images and video

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| GEN-01 | Image generation | Partial | Generate images through a connected tool (Higgsfield and others) from the chat; results land in a gallery in the panel. | Request | P1 |
| GEN-02 | Video generation | Partial | The same for video, with job progress and credits used per job. | Request | P1 |
| GEN-03 | Project media library | Implemented | Every generated or uploaded image and video is kept in the project and can be used in decks, documents and sites. | Request | P1 |
| GEN-04 | Quick image edits | Implemented | Crop, remove background and upscale from the library. | Request | P2 |

### V2 · Knowledge, memory and styles

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| KNOW-01 | Project knowledge | Implemented | Add files and links as project knowledge that every chat in the project uses. | Claude | P0 |
| KNOW-02 | About you and global instructions | Implemented | Global instructions (who you are, how you like answers) apply to every project, alongside project instructions. | Claude | P1 |
| KNOW-03 | Memory across chats | Implemented | The AI saves lasting facts to memory you can view, edit and delete, per project and global. | Claude Code | P0 |
| KNOW-04 | Bring in an earlier chat | Implemented | “Use earlier chat” adds a past chat as context. | Claude | P2 |
| KNOW-05 | Reply styles | Implemented | Concise, explanatory or formal styles, plus a custom style learned from examples. | Claude | P2 |

### V2 · Skills, commands and agents

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| SKILL-01 | Skills library | Implemented | Install skills (folders with SKILL.md) that Claude and GPT both use; turn them on per project. | Claude Code | P0 |
| SKILL-02 | Save a chat as a skill | Implemented | “Save as skill” turns a workflow from a chat into a reusable skill. | Claude Code | P1 |
| SKILL-03 | Skills as slash commands | Implemented | Each skill appears as a /command in the composer. | Claude Code | P0 |
| SKILL-04 | Custom agents | Implemented | Define helper agents (name, instructions, tools, model) that Team mode can call. | Claude Code | P1 |
| SKILL-05 | Plugin bundles | Implemented | Install skills, tool servers and commands together in one step. | Claude Code | P2 |

### V2 · Connectors and accounts

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| CONN-01 | Connector catalog | Implemented | One-click connectors (GitHub, Google Drive, Gmail, Calendar, Slack, Notion, Figma, Higgsfield) with sign-in where the service offers it. | Claude | P0 |
| CONN-02 | Several accounts per tool server | Implemented | The same server can be added as several named accounts (Higgsfield · Main, · Client A, · Client B), each with its own key. | Request | P0 |
| CONN-03 | Choose connectors per project | Implemented | A project picks which connectors and accounts its chats can use. | Request | P0 |
| CONN-04 | Connector health | Implemented | Each connector shows status, last error, Reconnect and Test. | Claude | P1 |
| CONN-05 | Tool permissions | Implemented | Per tool: always allow, ask first or never. | Claude Code | P1 |
| CONN-06 | Several GitHub accounts | Implemented | Sign in to more than one GitHub account (gh auth login for each) and switch the active one from the git bar or Settings; each project can remember which account it pushes with. | Request | P1 |

### V2 · Working with the AI (Claude Code app flow)

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| FLOW-01 | Live task list under the reply | Implemented | The AI keeps a step list (to do, in progress, done) pinned under its latest message. | Claude Code | P0 |
| FLOW-02 | Next-step box | Implemented | Each finished turn ends with a short recap and one-click next actions (Commit, Create PR, Verify). | Claude Code | P0 |
| FLOW-03 | Questions as choice cards | Implemented | When the AI needs a decision it shows choices as buttons with the recommended one first. | Claude Code | P0 |
| FLOW-04 | Plan approval | Implemented | Plan mode shows the plan as a document with Approve, Edit and Reject. | Claude Code | P1 |
| FLOW-05 | Chapters in long chats | Implemented | Long chats get chapter marks and a small table of contents to jump between them. | Claude Code | P2 |
| FLOW-06 | Side sessions | Implemented | Spin a task off into its own chat that runs in parallel and reports back; linked sessions are listed. | Claude Code | P1 |
| FLOW-07 | Worktrees for parallel coding | Implemented | Parallel coding tasks each get their own branch and folder, merged when done. | Claude Code | P1 |
| FLOW-08 | Scheduled tasks | Implemented | Run a prompt on a schedule (daily report, site check) and see each run’s result. | Claude Code | P1 |
| FLOW-09 | Notifications | Implemented | A desktop and phone notification when a run finishes or needs approval. | Claude Code | P1 |
| FLOW-10 | Continue from the phone | Implemented | Open the same sessions on the phone (this network or the Dokploy box) and carry on. | Claude Code | P2 |

### V2 · Ship: PRs, CI and deploy

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| SHIP-01 | Pull request panel | Implemented | After a PR, its checks, reviews and comments show in the app, with “Fix with AI”. | Claude Code | P1 |
| SHIP-02 | Auto-fix | Partial | Optionally the AI fixes failing checks and answers review comments by itself. | Claude Code | P2 |
| SHIP-03 | Deploy to Dokploy | Partial | Deploy a project to your Dokploy server (app, environment, domain) and watch the logs. | Request | P1 |
| SHIP-04 | Preview links per branch | Implemented | Each branch gets its own preview URL. | Request | P2 |

### Audit V1 · parity with Claude and Claude Design

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| V1-01 | Undo and redo on slides | Implemented | Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) undo and redo every change made in the slide editor, and the file follows. | Audit | P1 |
| V1-02 | Keyboard on the big slide | Implemented | With the slide focused, arrow keys and Page Up/Down move between slides; F5 or Ctrl+Enter starts presenting. | Audit | P1 |
| V1-03 | Add a slide from the strip | Implemented | A + under the thumbnails adds a slide after the current one and puts the cursor in its title. | Audit | P1 |
| V1-04 | New slides arrive visibly | Implemented | Slides the AI adds while it writes slide into the strip with a short highlight, so you see where it is. | Audit | P1 |
| V1-05 | Undo and redo in documents | Implemented | Ctrl+Z / Ctrl+Y undo and redo edits made in the document editor. | Audit | P1 |
| V1-06 | Bold and italic shortcuts | Implemented | While editing a block, Ctrl+B and Ctrl+I wrap the selection in Markdown bold or italic. | Audit | P1 |
| V1-07 | Add a paragraph and word count | Implemented | The end of every document has Add a paragraph and a word count with reading time. | Audit | P1 |
| V1-08 | Rename an output | Implemented | The output menu renames an output; the new name shows in the panel and the sidebar. | Audit | P1 |
| V1-09 | Delete an output | Implemented | Outputs can be deleted from the sidebar (⋯) or the output menu after a confirmation; text files stay recoverable in Changes. | Request | P1 |
| V1-10 | Copy content out | Implemented | Decks offer Copy the text (every slide with notes) and documents Copy as Markdown, next to the downloads. | Audit | P1 |
| V1-11 | Esc closes overlays | Implemented | Esc closes compare, charts, the media library and the inspector, newest first. | Audit | P1 |
| V1-12 | Empty panel starts a kind | Implemented | With nothing made yet, the Artifacts panel offers Make slides, Write a document, Design something and Research a topic. | Audit | P1 |
| V1-13 | Clear version menu | Implemented | Each version shows who made it (You, Claude, GPT) and when; Compare appears only when an older version exists. | Request | P1 |
| V1-14 | Artifacts bar never overlaps | Implemented | On narrow panels labels go first, then secondary tools fold into a More menu; nothing overlaps at any width. | Request | P0 |
| V1-15 | Saved designs stay clean | Implemented | Saving tweaks from the inspector never writes the canvas zoom or the app's own script into the design file. | Audit | P1 |
| V1-16 | Polished empty preview | Implemented | Before a project has a page, Preview shows a centred Plus Jakarta Sans empty state that follows light and dark. | Request | P1 |
| V1-17 | Bring existing work from the start | Implemented | The start screen offers Clone from GitHub (signing in first if needed), Open a folder and Pull latest. | Request | P1 |
| V1-18 | App tools never ask | Implemented | Both Claude and GPT use the app's own tools (open output, next steps, memory, chapters) without a permission prompt. | Audit | P1 |
| V1-19 | Tool server test handles spaces | Implemented | Testing a tool server works when its command or arguments contain spaces (Windows quoting). | Audit | P1 |
| V1-20 | Your content is never translated | Implemented | In Bahasa, the translator leaves slides, documents, recaps and output names exactly as written. | Audit | P1 |

### Audit V2 · every surface, menu and state

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| V2-01 | Chat list fits the sidebar | Implemented | Long chat titles end in … and their ⋯ buttons stay inside the sidebar (rows no longer stretch past its edge). | Audit | P0 |
| V2-02 | Slides lock while the AI writes | Implemented | While an AI run is writing, the slide shows a notice and text is not editable, so no edit is lost; it unlocks when the run ends. | Audit | P1 |
| V2-03 | Documents lock while the AI writes | Implemented | While an AI run is writing, clicking the document explains it is busy instead of starting an edit that cannot be saved. | Audit | P1 |
| V2-04 | Unlock when the run ends | Implemented | When the run finishes, the open deck or document re-renders and becomes editable without reopening it. | Audit | P1 |
| V2-05 | Kind survives the first message | Implemented | Choosing Slides (or any kind) with no project open, then sending, keeps the kind when the project is created. | Audit | P1 |
| V2-06 | Clear wording when going back | Implemented | Going back to a version while the AI works says to wait for the AI, not for a build. | Audit | P1 |
| V2-07 | Opening state | Implemented | Switching to another output shows Opening … until it renders, instead of a blank panel. | Audit | P1 |
| V2-08 | Download cannot double-fire | Implemented | While an export is being prepared the Download button shows it is busy and ignores more clicks. | Audit | P1 |
| V2-09 | Long output lists | Implemented | With more than 12 outputs the sidebar shows the first 12 and a Show all link. | Audit | P1 |
| V2-10 | Deck menus pass the UI check | Implemented | Slide actions, layout, thumbnail and download menus: no clipped, cut-off or unnamed items. | Audit | P1 |
| V2-11 | Version and output menus pass | Implemented | Version and output switcher menus open above the panel with every item readable. | Audit | P1 |
| V2-12 | Share dialog passes | Implemented | Share dialog with and without links: rows wrap cleanly, Copy and Remove are reachable. | Audit | P1 |
| V2-13 | Design system dialog passes | Implemented | The picker, cards and editor pass the UI check; the editor shows its sample page and export buttons. | Audit | P1 |
| V2-14 | Compare view passes | Implemented | The compare overlay fills the panel, both sides scroll on their own, Close and Esc work. | Audit | P1 |
| V2-15 | Document view passes | Implemented | Outline, paper, footer and comment bar pass the UI check. | Audit | P1 |
| V2-16 | Design canvas passes | Implemented | Zoom, Frames, Play, Pick, Compare and Build controls pass the UI check; the frames menu lists sizes. | Audit | P1 |
| V2-17 | Media library passes | Implemented | Library overlay with and without images: upload and the image menu are reachable. | Audit | P1 |
| V2-18 | Data view passes | Implemented | Dashboards render in the sandboxed frame; Edit charts explains when there is no charts.json yet. | Audit | P1 |
| V2-19 | Settings sections pass | Implemented | Tool servers (catalog, test, permissions), helper agents, deploy and bundle sections pass the UI check. | Audit | P1 |
| V2-20 | Deck still being written | Implemented | If the deck file is not valid JSON yet, the editor keeps the last good version (or says the AI is still writing). | Audit | P1 |
| V2-21 | Empty deck | Implemented | A deck with no slides says so and still offers + to add one. | Audit | P1 |
| V2-22 | Empty document | Implemented | An empty document invites you to start typing or ask the AI. | Audit | P1 |
| V2-23 | No outputs yet | Implemented | The empty Artifacts panel explains what appears there and offers to start a kind. | Audit | P1 |
| V2-24 | No share links yet | Implemented | The share dialog says No links yet and explains what a link shares. | Audit | P1 |
| V2-25 | No tool server keys | Implemented | Tool servers from a bundle stay off until their keys are added, and say so. | Audit | P1 |
| V2-26 | Chart block fallback | Implemented | A chart block that is not valid JSON shows as a normal code block instead of breaking the reply. | Audit | P1 |
| V2-27 | Data stays in its project | Implemented | A page can only read or write its own project's stored data; other projects' pages are refused. | Audit | P1 |
| V2-28 | Errors say what to do | Implemented | Exports, deploys, GitHub and tool server errors explain the next step (install, sign in, add a key, try again). | Audit | P1 |
| V2-29 | Secrets never saved to memory | Implemented | Asking the AI to remember a key or password is refused by the app, not just by the AI. | Audit | P1 |
| V2-30 | Missing preview page | Implemented | A missing page in Preview shows a friendly not-found state instead of raw text. | Audit | P1 |

### Audit V3 · responsive, themes and Bahasa

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| V3-01 | Columns fit between 851 and 1280 px | Implemented | Between tablet and large screens the sidebar, chat and work panel shrink together; the work panel keeps at least 300 px. | Audit | P0 |
| V3-02 | Work tabs never overflow | Implemented | With Artifacts added, the work panel tabs scroll sideways inside their bar on narrow panels instead of pushing past the edge. | Audit | P1 |
| V3-03 | File count steps aside | Implemented | On narrow work panels the file count hides so the tabs keep their room. | Audit | P1 |
| V3-04 | Composer keeps the model name | Implemented | The model pill never shrinks to an empty chevron; below 430 px the pickers move to their own row. | Audit | P0 |
| V3-05 | Output rows fit the sidebar | Implemented | Output names in the sidebar end in … and their ⋯ stays inside, at every sidebar width. | Audit | P1 |
| V3-06 | Slides size to the phone | Implemented | On phones the current slide fills the width with no empty bands above and below. | Audit | P1 |
| V3-07 | Documents breathe on phones | Implemented | On phones the document paper uses smaller padding so lines are not cramped. | Audit | P1 |
| V3-08 | Artifacts pass at 380, 520 and 760 px | Implemented | Deck, document, design and data views pass the UI check at three work-panel widths. | Audit | P1 |
| V3-09 | Artifacts pass on a phone | Implemented | On a 375 px phone, every kind of output passes the UI check; the bar shows the switcher, Download and More. | Audit | P1 |
| V3-10 | Start screen on a phone | Implemented | The kind cards and templates stack to the phone width without clipping. | Audit | P1 |
| V3-11 | Dashboards open at full size | Implemented | Auto-fit zoom applies only to designs with frames; dashboards and pages open at 100%. | Audit | P1 |
| V3-12 | Dark: start screen | Implemented | Kind cards, templates and the bring-existing-work row read clearly in dark mode. | Audit | P1 |
| V3-13 | Dark: slide editor | Implemented | Strip, stage, tools and notes use dark surfaces; the slides keep their own design system colours. | Audit | P1 |
| V3-14 | Dark: document editor | Implemented | Paper, outline, changes bar and comments use dark surfaces with readable text. | Audit | P1 |
| V3-15 | Dark: design canvas | Implemented | Canvas controls, inspector and compare labels read clearly in dark mode. | Audit | P1 |
| V3-16 | Dark: dialogs | Implemented | Design system, share, chart data and GitHub dialogs follow dark mode. | Audit | P1 |
| V3-17 | Dark: sidebar outputs | Implemented | Output dots keep their kind colours and names stay readable in dark mode. | Audit | P1 |
| V3-18 | Dark: next-step box and notes | Implemented | The end-of-turn box, side-chat notes and chapters follow dark mode. | Audit | P1 |
| V3-19 | Dark: empty preview | Implemented | The empty preview page switches to dark with the app. | Audit | P1 |
| V3-20 | Bahasa: Artifacts | Implemented | Every label, menu, hint and message in the Artifacts panel has Indonesian text. | Audit | P1 |
| V3-21 | Bahasa: slides | Implemented | Slide tools, menus, notes window, chart dialog and present bar have Indonesian text. | Audit | P1 |
| V3-22 | Bahasa: documents | Implemented | Outline, changes, comments, footer and placeholders have Indonesian text. | Audit | P1 |
| V3-23 | Bahasa: design | Implemented | Canvas, frames, inspector, media library and image actions have Indonesian text. | Audit | P1 |
| V3-24 | Bahasa: settings | Implemented | Tool server catalog, test, permissions, helper agents, deploy and bundles have Indonesian text. | Audit | P1 |
| V3-25 | Bahasa: project settings | Implemented | Memory, knowledge files, tool servers, GitHub account, deploy and auto-fix have Indonesian text. | Audit | P1 |
| V3-26 | Bahasa: chat | Implemented | Kind hint, Save as skill, Side chat, notes, chapters and sources have Indonesian text. | Audit | P1 |
| V3-27 | Bahasa: start screen | Implemented | Kinds, templates, placeholders and bring-existing-work have Indonesian text. | Audit | P1 |
| V3-28 | Your writing stays as written | Implemented | The translator skips documents, outlines, chat titles, output names, compare panes and chart titles. | Audit | P0 |
| V3-29 | Translated prefixes | Implemented | Messages built from parts (Opened …, Deleted …, Version …) translate their fixed words and keep the names. | Audit | P1 |
| V3-30 | Placeholders translated | Implemented | Field placeholders, including multi-line examples, have Indonesian text. | Audit | P1 |

### Audit V4 · real jobs end to end

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| V4-01 | Deck from a prompt | Implemented | Choosing Slides and asking for a deck produces deck.json, opens it live in Artifacts and ends with a next-step box (real GPT run). | Audit | P1 |
| V4-02 | Deck to PowerPoint | Implemented | A made deck downloads as .pptx with editable text, charts and tables. | Audit | P1 |
| V4-03 | Deck to PDF | Implemented | A made deck downloads as a PDF with one page per slide. | Audit | P1 |
| V4-04 | One slide as PNG | Implemented | The current slide downloads as a 1920 × 1080 PNG. | Audit | P1 |
| V4-05 | Document written outline-first | Implemented | A long document is written as an outline with placeholders, then filled section by section (real run). | Audit | P1 |
| V4-06 | AI edit highlighted | Implemented | When the AI edits a document, only the changed parts are highlighted with Keep and Undo (real run). | Audit | P1 |
| V4-07 | Document to Word and PDF | Implemented | A made document downloads as .docx and as an A4 PDF. | Audit | P1 |
| V4-08 | Research with sources | Implemented | A research run reads web pages, writes a cited report, and the reply lists the pages it read as sources (real run). | Audit | P1 |
| V4-09 | Spreadsheet to dashboard | Implemented | An attached Excel file is read as data; the AI builds a dashboard with correct totals and a cleaned CSV (real run). | Audit | P1 |
| V4-10 | Dashboard to Excel | Implemented | A data output downloads as .xlsx with one sheet per data table. | Audit | P1 |
| V4-11 | Social posts as frames | Implemented | A design run makes frames at the asked size; the canvas fits them to the panel (real run). | Audit | P1 |
| V4-12 | Three options side by side | Implemented | Asking for options gives Option A, B and C frames; the frames menu offers Keep only and Mix (real run). | Audit | P1 |
| V4-13 | Frame as PNG at its size | Implemented | Each frame downloads as a PNG at its own size (for example 1080 × 1080). | Audit | P1 |
| V4-14 | Exports use the right font | Implemented | Exported pages, frames and PDFs use Plus Jakarta Sans even offline; exports wait for fonts and images to load. | Audit | P0 |
| V4-15 | New kind, new folder | Implemented | Making slides from a document creates a new output folder and leaves the document untouched (real run). | Audit | P0 |
| V4-16 | Outputs keep their kind | Implemented | If a run tries to change an existing output's kind, the app puts its output.json back and says so in the timeline. | Audit | P0 |
| V4-17 | PowerPoint import | Implemented | An attached .pptx is read slide by slide with notes and restyled into a new deck in the design system (real run). | Audit | P1 |
| V4-18 | Save as skill | Implemented | Saving a workflow as a skill writes .claude/skills/<name>/SKILL.md and it appears as a /command (real run). | Audit | P1 |
| V4-19 | Chapters | Implemented | Asked to mark a chapter, the AI uses the chapter tool and the chat shows the divider and contents menu (real run). | Audit | P1 |
| V4-20 | Side chat reports back | Implemented | A side chat runs alongside and posts a Side chat finished note with Open into the chat it came from (real run). | Audit | P1 |
| V4-21 | Memory across chats | Implemented | A fact saved with remember is known in a brand-new chat of the same project (real run). | Audit | P1 |
| V4-22 | Chart in a reply | Implemented | A reply with a chart block shows a chart with Show data (real run). | Audit | P1 |
| V4-23 | Share a deck and a document | Implemented | Share links serve frozen copies as web pages, sandboxed, without pairing on this computer. | Audit | P1 |
| V4-24 | Page that keeps data | Implemented | A tracker page saves and reloads its own data through cbaData; store.json updates. | Audit | P1 |
| V4-25 | Media gallery | Implemented | A media output shows its images and videos as a gallery at full resolution. | Audit | P1 |
| V4-26 | Design system from a website | Implemented | Reading a website gives a named design system with its brand colours, ready to edit. | Audit | P1 |
| V4-27 | Switching design system | Implemented | Choosing another design system restyles the open deck, its exports and share pages. | Audit | P1 |
| V4-28 | Edits on the slide saved | Implemented | Text typed on a slide saves to deck.json, updates the thumbnail and adds a version; undo brings it back. | Audit | P1 |
| V4-29 | Comments kept with the output | Implemented | Comments on documents and slides are saved with the app (not in the project) and survive a reload. | Audit | P1 |
| V4-30 | Auto-fit leaves pages alone | Implemented | Dashboards and pages without frames open at 100%; designs with frames fit the panel. | Audit | P1 |

### Editing like Slides and Figma

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| EDIT-01 | Formatting bar on slides | Implemented | Click text on a slide, then change its font, size, bold, italic, colour and alignment from a bar above the slide; Reset clears it. | Request | P0 |
| EDIT-02 | Slide colour | Implemented | Each slide can get its own background colour, or go back to the design system colour. | Request | P1 |
| EDIT-03 | Charts edited on the slide | Implemented | Clicking a chart opens its data, type and series colours; changes show at once. | Request | P0 |
| EDIT-04 | Formatting in every export | Implemented | Fonts, sizes, colours, alignment, slide colours and chart colours carry into PowerPoint, PDF, PNG and share links. | Request | P0 |
| EDIT-05 | Design inspector: type | Implemented | The design inspector also changes font, weight and alignment, live, and saves into the design. | Request | P1 |
| EDIT-06 | Work tabs in your order | Implemented | Preview, Artifacts, Files, Changes and Browser can be dragged into any order; the order is remembered and Ctrl+1–5 follow it. | Request | P1 |
| EDIT-07 | Move things on a slide | Implemented | Click a text, chart, table or image and drag it by its grip; arrow keys nudge it (Shift for bigger steps). The position is saved and shows in PPTX, PDF and PNG exports. | Request | P0 |
| EDIT-08 | Snapping and pink guides | Implemented | While dragging, an element snaps to the slide's centre and margins and to the other elements' edges and centres, with pink guide lines so you can see it is aligned. Hold Alt to move freely. | Request | P0 |
| EDIT-09 | Centre and reset buttons | Implemented | Centre across, Centre down and Back to the layout position in the formatting bar; a width handle changes how wide a text box is. | Request | P1 |
| EDIT-10 | Edit tables on a slide | Implemented | Pick any cell to type in it, then + Row, − Row, + Col, − Col; the selection stays on the table after each change. The bar wraps so the buttons are always visible. | Request | P0 |
| EDIT-11 | Design canvas like Figma | Implemented | Ctrl/⌘ + scroll zooms around the pointer, the hand tool or holding Space pans by dragging, and the zoom buttons and Fit stay in sync. | Request | P0 |
| EDIT-12 | Move and centre in designs | Implemented | In the design inspector, Move lets you drag the picked element with snapping to its frame's centre and edges (pink guides); two centre buttons align it. Saving keeps only the change, never the app's helpers. | Request | P0 |
| EDIT-13 | Inspector out of the way | Implemented | The inspector opens on the side away from the element you picked and can be dragged by its header; a see-through background shows as a checker instead of black. | Audit | P1 |
| EDIT-14 | Preview shows the AI is building | Implemented | While an AI works and the page does not exist yet, the empty preview shows a calm building animation with who is working, then opens the page by itself when it is saved. In Bahasa too. | Request | P1 |
| EDIT-15 | Standalone preview stays quiet | Implemented | A preview opened in its own browser tab no longer messages itself in a loop (it used to spin the CPU). | Audit | P0 |

### Audit V5 · hierarchy, balance and motion

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| V5-01 | Slide formatting bar stays readable | Implemented | The formatting bar wraps onto a second line in narrow panels instead of hiding buttons off to the side, so table and centre buttons are always reachable. | Audit | P1 |
| V5-02 | AI chips fold on narrow slides | Implemented | Below 560 px the slide's AI suggestion chips fold into one menu so the stage keeps its room. | Audit | P1 |
| V5-03 | Present button at narrow widths | Implemented | Present shrinks to its icon in a narrow panel, keeping its label as a tooltip. | Audit | P1 |
| V5-04 | Documents adapt to the panel | Implemented | The document editor uses container queries: the outline folds away and margins shrink when the panel is narrow. | Audit | P1 |
| V5-05 | Short version label | Implemented | The version menu reads "v3" when the bar is tight, with the full "Version 3" as its tooltip. | Audit | P1 |
| V5-06 | Canvas fits by height too | Implemented | Fit to the panel uses both width and height, so a tall design is never cut off at the bottom. | Audit | P1 |
| V5-07 | Slide colour swatch is honest | Implemented | On gradient backgrounds the slide colour swatch shows the design accent instead of black. | Audit | P1 |
| V5-08 | Selection follows the layout | Implemented | The blue selection on a slide moves with the slide when the bar or panel changes size. | Audit | P1 |
| V5-09 | Start screen opens at the top | Implemented | A new chat shows "What do you want to make?" from its heading, not scrolled halfway down. | Audit | P1 |
| V5-10 | No lonely card | Implemented | An odd last card in the kinds grid spans the row instead of sitting alone. | Audit | P1 |
| V5-11 | Composer on short windows | Implemented | On windows under 860 px tall the empty composer is two lines high, giving the chat more room. | Audit | P1 |
| V5-12 | Dialogs close smoothly | Implemented | Every dialog fades and settles in, and now fades out on close too (backdrop included); reduced-motion turns it off. | Audit | P1 |
| V5-13 | Chat stays on the newest message | Implemented | The chat keeps its place at the bottom when the composer grows (kind chip, long draft), so the suggestions box is never half hidden. | Audit | P1 |
| V5-14 | A chat opens the work it made | Implemented | Switching to a chat shows the output that chat produced in Artifacts, not whatever was opened last. | Audit | P1 |
| V5-15 | Inspector never covers the pick | Implemented | The design inspector opens on the side away from the picked element and can be dragged by its header. | Audit | P1 |
| V5-16 | See-through shows as see-through | Implemented | A transparent background shows a checker swatch and the tooltip None (see-through), not a black square. | Audit | P1 |
| V5-17 | Compact centre buttons | Implemented | Centre across and Centre down are icon buttons with labels for screen readers, so the inspector row never wraps. | Audit | P1 |
| V5-18 | Settings reads in sections | Implemented | Settings keeps grouped sections with a fixed Cancel / Save footer while the list scrolls. | Audit | P1 |

### Audit V6 · speed, lean code and reliability

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| V6-01 | Fast first load | Implemented | The app is ready in well under a tenth of a second locally (DOM ready ~66 ms, ~660 KB over 53 files, no blocking requests). | Audit | P1 |
| V6-02 | Standalone previews stay idle | Implemented | A preview opened in its own tab no longer posts messages to itself in a loop. | Audit | P1 |
| V6-03 | Calmer empty-page polling | Implemented | The empty preview checks every 4 s when nothing is building and every 1.5 s while an AI works, instead of always 1.5 s. | Audit | P1 |
| V6-04 | Background window polls less | Implemented | The Artifacts list refreshes every 15 s while the window is in the background and catches up the moment you return. | Audit | P1 |
| V6-05 | No errors after closing the palette | Implemented | Fixed a null error when the command palette closed (found by the console sweep). | Audit | P1 |
| V6-06 | Clean messages for bad requests | Implemented | A malformed request now answers "The request was not valid JSON." instead of a raw parser error. | Audit | P1 |
| V6-07 | Bad input is refused, never followed | Implemented | Unknown projects, paths with ../, unknown outputs and run-only tools are all refused with a clear message; nothing is written outside the project. | Audit | P1 |
| V6-08 | Dead code removed | Implemented | Three unused exports and their unused import, plus about 1 KB of CSS for screens that no longer exist, are gone. | Audit | P1 |
| V6-09 | Slide files stay tidy | Implemented | Selecting a slide element no longer leaves empty style entries in deck.json; empty ones are pruned on every save. | Audit | P1 |
| V6-10 | Preview script is guarded by tests | Implemented | New tests check that the script injected into previews parses (its escaping broke twice before), that it never messages itself, and that the empty page speaks the app language. | Audit | P1 |
| V6-11 | All 68 tests pass | Implemented | npm test runs 68 tests across 20 files in about 4 seconds. | Audit | P1 |
| V6-12 | Server log is clean | Implemented | No errors or exceptions in the server output across restarts and the audit runs. | Audit | P1 |

### Design editing like Figma

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| FIG-01 | Grab and drag | Implemented | Pick an element and drag it straight away; no Move button needed first. | Request | P0 |
| FIG-02 | Snap to other elements | Implemented | While moving, snap to the edges and centres of nearby elements, not only the frame. | Request | P0 |
| FIG-03 | Gap labels | Implemented | While moving, show the distance in pixels to the neighbours, like Figma's red numbers. | Request | P1 |
| FIG-04 | Resize handles | Implemented | Corner and side handles change width and height; Shift keeps the proportions. | Request | P0 |
| FIG-05 | Undo and redo your own edits | Implemented | Ctrl+Z / Ctrl+Shift+Z undo every manual change on the canvas (text, colour, move, resize), not only the AI's. | Request | P0 |
| FIG-06 | Layers panel | Implemented | A list of the frame's elements: click to select, hover to highlight, drag to reorder. | Request | P1 |
| FIG-07 | Select several elements | Implemented | Shift+click adds to the selection; move them together. | Request | P1 |
| FIG-08 | Align and distribute | Implemented | Align the selection left, centre, right, top, middle or bottom, and space it evenly. | Request | P1 |
| FIG-09 | Add from a toolbar | Implemented | Add text, a rectangle or an image to a frame. | Request | P1 |
| FIG-10 | Duplicate and delete | Implemented | Ctrl+D duplicates the picked element; Delete removes it. | Request | P1 |
| FIG-11 | Exact position and size | Implemented | X, Y, W and H boxes in the inspector. | Request | P1 |
| FIG-12 | Border, shadow and opacity | Implemented | Inspector controls for border, shadow and opacity. | Request | P2 |
| FIG-13 | Replace an image | Implemented | Swap a picked image for an upload or a media-library file. | Request | P2 |
| FIG-14 | Spacing for rows and columns | Implemented | For flex and grid containers: direction, gap and padding controls (Figma auto layout). | Request | P2 |
| FIG-15 | SVG and PDF per frame | Implemented | Download any frame as SVG or PDF, as well as PNG. | Request | P2 |

### Slides editing like Google Slides

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| GSL-01 | Resize with corner handles | Implemented | Corner handles change width and height; images and charts keep their proportions. | Request | P0 |
| GSL-02 | Add text boxes | Implemented | Insert a free text box anywhere on a slide. | Request | P0 |
| GSL-03 | Add shapes, lines and icons | Implemented | Insert rectangles, circles, lines and arrows with fill and stroke colours. | Request | P1 |
| GSL-04 | Select several and group | Implemented | Shift+click selects several; move them together. | Request | P1 |
| GSL-05 | Align and distribute | Implemented | Align several items to each other or to the slide, and space them evenly. | Request | P1 |
| GSL-06 | Bring to front, send to back | Implemented | Change which item sits on top. | Request | P1 |
| GSL-07 | Exact position and size | Implemented | X, Y, W and H boxes for the selected item. | Request | P1 |
| GSL-08 | Rotate | Implemented | Rotate an item with a handle; Shift snaps to 15 degree steps. | Request | P2 |
| GSL-09 | Crop an image on the slide | Implemented | Crop and reposition an image inside its box. | Request | P2 |
| GSL-10 | Duplicate a slide | Implemented | Duplicate the current slide (also Ctrl+D in the strip). | Request | P1 |
| GSL-11 | Slide sizes | Implemented | 16:9, 4:3, square and 9:16 story decks, also in exports. | Request | P2 |
| GSL-12 | Transitions and builds | Implemented | Fade or slide between slides and reveal bullets one by one when presenting. | Request | P2 |

### Documents like Google Docs

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| GDOC-01 | Formatting toolbar | Implemented | Headings, bold, italic, bullet and numbered lists, links and quotes from a bar. | Request | P0 |
| GDOC-02 | Tables in documents | Implemented | Insert a table and edit its cells, rows and columns. | Request | P1 |
| GDOC-03 | Images in documents | Implemented | Insert an image from a file or the media library. | Request | P1 |
| GDOC-04 | Find and replace | Implemented | Ctrl+F finds in the document; replace one or all. | Request | P1 |
| GDOC-05 | Suggest mode | Implemented | Your own edits can show as tracked suggestions to accept or reject. | Request | P2 |
| GDOC-06 | Page view | Implemented | A page layout with margins and page breaks, as it will print and export. | Request | P2 |
| GDOC-07 | Table of contents | Implemented | Insert a table of contents built from the headings. | Request | P2 |

### Research reports

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| REP-01 | Sources panel | Implemented | A panel beside the report lists every source with its site and date; clicking a citation shows its source. | Request | P0 |
| REP-02 | Add your own sources | Implemented | Attach a link or PDF for the AI to use and cite. | Request | P1 |
| REP-03 | Re-check a claim | Implemented | Select a sentence and ask the AI to verify it against its source. | Request | P2 |
| REP-04 | Citation style | Implemented | Numbered, APA or MLA references. | Request | P2 |

### Data and charts like Sheets

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| SHEET-01 | Data grid | Implemented | See and edit the data behind a dashboard in a spreadsheet-style grid. | Request | P0 |
| SHEET-02 | Sort and filter | Implemented | Sort by any column and filter rows in the grid. | Request | P1 |
| SHEET-03 | Group by and formulas | Implemented | Group rows with totals, and simple formulas (SUM, AVERAGE, COUNT). | Request | P2 |
| SHEET-04 | Change a chart by clicking it | Implemented | Click a chart to switch its type or colours. | Request | P1 |
| SHEET-05 | Refresh from a new file | Implemented | Drop in an updated CSV or XLSX to refresh the data. | Request | P2 |
| SHEET-06 | CSV and chart PNG | Implemented | Export the data as CSV and any chart as PNG. | Request | P2 |

### Images and video tools

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| IMG-01 | Remove a background | Implemented | Remove the background of an image. | Request | P2 |
| IMG-02 | Variations | Implemented | Ask for variations of an image (needs an image tool connected). | Request | P2 |
| IMG-03 | Trim a video | Implemented | Set start and end points of a video and save the cut. | Request | P2 |

### Every kind of work

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| EVERY-01 | Make a copy | Implemented | Duplicate any piece of work into a new folder. | Request | P1 |
| EVERY-02 | Templates for every kind | Implemented | Start slides, documents and reports from templates, not only websites. | Request | P1 |
| EVERY-03 | Search your work | Implemented | Search across the titles and text of all your work. | Request | P2 |

### Audit W1 · every new tool, every state

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| W1-01 | Arrange panel reads cleanly | Implemented | The size heading was a long line in capitals; it is now “Position and size” with the unit as a quiet note. | Audit | P1 |
| W1-02 | Pickers open under their button | Implemented | The icon picker and Arrange panel were measured from the wrong box and opened over the slide strip; the stage is now their anchor. | Audit | P1 |
| W1-03 | Videos play in the app | Implemented | The app’s security policy had no media rule, so videos from outputs never played; media from the preview server is now allowed. | Audit | P1 |
| W1-04 | Video and PDF files are served | Implemented | The preview server only served images and text; videos and PDFs are now served with byte ranges, so seeking works. | Audit | P1 |
| W1-05 | Trimmed clips and sources can be saved | Implemented | The file-path check only allowed text and images, so trimmed clips and added PDF sources were refused; they are allowed in their own folders. | Audit | P1 |
| W1-06 | Trim knows the clip length | Implemented | Browser-recorded clips report an unknown length; the trim dialog now finds the real length before showing the sliders. | Audit | P1 |
| W1-07 | Trim never hangs | Implemented | Recording followed the screen refresh, which stops in a background window; it now uses a timer and stops with a clear message if playback stalls. | Audit | P1 |
| W1-08 | Background removal keeps the subject | Implemented | The first threshold also removed light grey parts; it now only clears colours very close to the edge colour. | Audit | P1 |
| W1-09 | Edits wait for the full image | Implemented | Crop, upscale and background removal waited for nothing when the picture had not loaded yet; they now load it first. | Audit | P1 |
| W1-10 | Prompt dialogs show their label | Implemented | Dialogs that passed their label and length limit as input options lost both (comments capped at 180 characters); fixed for every caller. | Audit | P1 |
| W1-11 | Slide edits are never undone by a reload | Implemented | A refresh from disk while a slide save was pending put the older file back; the editor now ignores reloads while it saves. | Audit | P1 |
| W1-12 | Align buttons on slides work | Implemented | The Arrange panel’s align buttons had their arguments in the wrong order; fixed. | Audit | P1 |
| W1-13 | Shape line and corner menus show | Implemented | A rule that hides text controls for boxes also hid the line width and corner menus; they show again. | Audit | P1 |
| W1-14 | Documents never get stuck mid-edit | Implemented | Inserting while a block was open left the editor thinking it was still editing; every change now finishes the open block first. | Audit | P1 |
| W1-15 | Fit to the panel fits | Implemented | Page size was reported already zoomed, and a hidden panel measured as 0; fit now uses the real size and runs when the panel appears. | Audit | P1 |
| W1-16 | SVG export keeps every drawing | Implemented | Frames that use shared symbols (<use>) exported without them; the symbols travel with the SVG now. | Audit | P1 |
| W1-17 | Standalone previews stay quiet | Implemented | A preview opened alone posted messages to itself in a loop; fixed (found in round W1 of the editor checks). | Audit | P1 |

### Audit W2 · real jobs, exports and Bahasa

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| W2-01 | A real AI job uses the new tools | Implemented | A GPT run made a dashboard that keeps data.csv, writes charts.json and marks each chart with data-chart, so clicking a chart opens its editor and the grid shows the data. | Audit | P1 |
| W2-02 | Click a chart, edit that chart | Implemented | Edit charts picks a chart on the page; its card opens highlighted with type, data and colour per series (two slice colours for pies). | Audit | P1 |
| W2-03 | Exports carry the new content | Implemented | PPTX has text boxes, shapes, arrows, icons, rotation and 4:3 pages; DOCX embeds images and the contents list; frame PDFs are the frame’s size; SVGs render. | Audit | P1 |
| W2-04 | Bahasa for every new tool | Implemented | About 230 new labels, tooltips and messages are translated; your own data (grid cells, column names, layers, sources, search results) is never translated. | Audit | P1 |
| W2-05 | Trim label works in any language | Implemented | The trim range reads 0:01.0 – 0:02.5 · 1.5 s instead of an English sentence. | Audit | P1 |

### Audit W3 · balance, motion and lean code

| ID | Capability | Current status | Acceptance criterion | Source | Priority |
|---|---|---|---|---|---|
| W3-01 | Parser can never stall | Implemented | A line starting like an image but not one (“![x](a) caption”) froze the document parser; paragraphs now always move forward, with a test. | Audit | P1 |
| W3-02 | Tests for the new editors | Implemented | New tests cover document blocks, CSV and formulas, slide items, crops, sizes and icons, version grouping and which files can be saved; 72 tests pass. | Audit | P1 |
| W3-03 | Lean code check | Implemented | No unused functions or CSS rules after the build; design editing lives in its own files (preview-edit.js, canvas-ui.js, data-ui.js) instead of growing one file. | Audit | P1 |
| W3-04 | Motion on every new panel | Implemented | The tool dock rises in, inspector, layers, sources and Arrange fade in, find and table bars arrive gently; reduced motion turns it all off. | Audit | P1 |
| W3-05 | One version per editing session | Implemented | Autosaving designs and slides no longer floods the version list: edits to one file in a row become one version. | Audit | P1 |

## Architecture and local data

The browser talks to a loopback Node service on port 4320. Installed official CLIs perform model requests using their existing account logins. Coding responses contain structured file proposals that the service validates and writes into the selected managed project. Provider requests use reconstructed recent chat and project-file context rather than native provider session IDs.

Workspace state: data/workspace.json. Project files: data/projects. Previous contents: data/versions. Development board: data/development.json through /api/development.

Mutating requests require a per-launch local token and matching origin. File paths are validated; linked files, hidden paths, parent traversal and Windows reserved aliases are rejected. Project previews run with an isolated origin and blocked network requests/forms. The command console runs commands entered by the user; it is not a filesystem sandbox.

## Billing and access

No automatic API-key fallback is configured. Subscription limits and provider policies still apply. Claude's displayed CLI cost estimate does not prove how the account was billed; third-party use can be charged against usage credits. A Gemini CLI login would not by itself establish access to subscription image/video generation. Multiple accounts and media tools require separate verification.

## Milestones

- Foundation: verified GPT/Claude connections, the app's own styling, local projects/chats, static generation, editor/preview/history and command console.
- Development visibility: readable PRD and editable Kanban with evidence for completed features.
- Coding depth: existing-folder import, full terminal, native session streaming, file tree/diffs, frameworks and Git.
- More providers: Gemini first, then supported account profiles and media integrations.

## Completion rules

Only mark Done when the card's acceptance criteria are met and verified. Partial features stay in Backlog, or In progress only while actual implementation is underway. Verification notes must identify what was checked and any remaining limitation. The board never implies agents are running merely because a status was changed.
