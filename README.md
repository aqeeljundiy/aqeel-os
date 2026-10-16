# code by aqeel

One local workspace for **Claude Code**, **Codex (GPT)** and **Gemini CLI**. Pick a model per message, watch every command in the terminal, approve changes, preview the site, and drive a shared side browser. All of this runs on your own computer, using the subscriptions you already sign in to. It is styled with the Elkiya Group design system.

## Start it

| Computer | How |
|---|---|
| Windows | Double-click **code by aqeel.exe**. It starts the server if it isn't running and opens the app in its own Chrome or Edge window. Rebuild it with `powershell -ExecutionPolicy Bypass -File scripts\build-exe.ps1`; add Start menu and desktop shortcuts with `scripts\add-windows-shortcut.ps1 -Desktop`. **Start code by aqeel.cmd** does the same without the build. |
| Mac | First time only, in Terminal: `chmod +x "Start code by aqeel.command"`. Then double-click it. |
| Any | `npm start`, then open http://127.0.0.1:4321 |

You need **Node.js 22 or newer**, plus the **Claude Code** and **Codex** CLIs (the Claude desktop app's built-in Claude Code is found automatically). Optional: the **Gemini CLI** (`npm install -g @google/gemini-cli`) and, for a full interactive terminal, `npm install` in this folder (installs node-pty). Set `HUB_PORT` to use another port; previews always use the next port up. If a CLI is somewhere unusual, set `CLAUDE_CLI_PATH` or `CODEX_CLI_PATH`.

### Sign in and add accounts
Open **Connections** (palette › "Connections and accounts"). Use **Sign in to Claude**, **Sign in to Codex** and **Sign in to Gemini** (Google sign-in opens in your browser). You can add several accounts for each. When one Codex account reaches its limit, the next one is used.

### iPhone
On the computer, click **Phone** and turn on phone access. Then open the address it shows in Safari on the same Wi-Fi and enter the 6-digit code. Use Share › **Add to Home Screen** to get an app icon. The computer still does all the work; the phone shows chats, approvals, previews and the terminal.
- Wi-Fi traffic is not encrypted. For use away from home, install Tailscale on both devices.
- Windows may ask to allow Node.js on private networks. Allow it.
- Dictation on the phone uses the keyboard's microphone key.

## What it does

**Projects and chats.** Projects expand into their chats. Right-click or use ⋯ to rename, pin, archive, fork, move, export or delete. There are also temporary chats, search across every transcript, sections with drag-ordering, and per-project settings. You can open existing folders, clone from GitHub, or import earlier Claude Code / Codex CLI sessions for a folder (project menu › *Open a past CLI session*). An imported session resumes natively.

**Agent runs.**
- Two dropdowns: provider, then model · effort.
- Permission modes: Ask, Auto-edit, Plan only and Full access. Shift+Tab cycles the first three.
- Approval cards for commands and file changes, and questions from the AI.
- A live checklist and reasoning summaries.
- Steer or queue messages while the AI works. Esc stops a run.
- Rewind to any message, see a diff per turn, and hand a chat from one model to the other.
- Context meter, compact, and long-running goals.

**Messages.**
- @-mention files and attach images, PDFs or code files.
- Slash commands, including your own saved prompts and `.claude/commands` / `.codex/prompts` files.
- Start a message with `#` to save it to AGENTS.md.
- Dictate on the computer. Ctrl/Cmd+/ lists every shortcut.

**Multiple AIs per request.** Compare mode runs Claude and GPT in separate draft copies so you can keep one. Team mode chains them. Split view shows two chats side by side.

**Files and changes.** A file tree where you can rename, move and delete files (text files can be undone from Changes), plus an editor with syntax highlighting, tabs, find and go-to-line, and search across every project file. Images and assets are supported. Every AI change is saved as a version: revert a file or a single change block, comment on a line for the AI, or restore everything before a change.

**Terminal and preview.**
- Resizable terminal with tabs for AI commands, dev servers and your own shell.
- A dev server manager for Vite, Astro and Next.js.
- Previews served from their own origin, with mobile and tablet sizes. Preview errors can be sent to the AI.

**Side browser.** A real Chrome/Edge that you and both AIs share. The AIs can open pages, click, type, read and screenshot. Pick an element (⌖) or attach a screenshot (📷) to your message.

**Git and GitHub.**
- Branch status, fetch, pull, commit and push. Pushing asks first.
- Compare with a branch, merge a branch, and have the AI resolve merge conflicts.
- Open pull requests from the app, see CI and review status, read review comments and hand them to the AI.
- Worktrees, and publishing to GitHub Pages (done by the AI in Ask mode).

**Customize** (Settings › *Saved prompts, skills, hooks and schedules*):
- **Saved prompts** become slash commands.
- **Skills**: folders with a SKILL.md in a project or `~/.claude/skills` / `~/.codex/skills`, shared by both AIs.
- **Hooks**: commands run before a run, after files change, or after a run finishes.
- **Schedules**: run a prompt hourly, daily, on weekdays or weekly, in Plan only or Auto-edit.

**Usage.** Token use per run, model, account and time frame, with a USD estimate from synced token prices and live subscription limits.

**Also:** MCP tool servers for both AIs, web access, fast mode (GPT priority tier and Claude fast mode on supported models), response styles, computer use for all three AIs (off by default; each app needs your permission the first time, and only that app's window is seen), notifications, a command palette (Ctrl/Cmd+K), Diagnostics (`/doctor`), light and dark themes, and a layout that works from phone width up.

## Where things are kept

Everything stays in `data/` next to the app:
- `workspace.json` and `projects/`: projects and chats
- `versions/`: change history
- `uploads/`: attachments
- `settings.json`
- `usage.jsonl` and `prices.json`
- `accounts/` and `accounts-claude/`: extra sign-ins
- `browser-profile/`: the side browser
- `remote.json`: paired phones

Folders you open or clone stay where they are; cloned repositories go to `Documents/code by aqeel`.

## Security

- The server listens on 127.0.0.1. Every change request needs a token that is created fresh each launch, and must come from the app's own address.
- Phone access is off until you turn it on. Devices pair with a short-lived code and can be revoked.
- Previews run on a separate origin, isolated from the app.
- Hooks and MCP servers run with your permissions, so only add commands you trust.

## Known limits

- Without node-pty installed, the terminal runs one command at a time (no vim or other full-screen programs).
- Gemini runs through the Gemini CLI agent protocol; compact, account switching and limit warnings are Claude and GPT only.
- Mac support is written but not yet tested on a Mac.
- Use **Install app** (Chrome or Edge) for an app window and icon, `scripts/make-mac-app.sh` for a Mac Dock app, or `scripts/add-windows-shortcut.ps1` for a Start-menu shortcut. There is no App Store build.
- On a Mac, computer use needs Accessibility and Screen Recording permission for the app in System Settings.

## Development

- Run `npm test` for the test suite.
- The PRD and development board live in `PRODUCT-REQUIREMENTS.md` and `/backlog` (not linked in the UI; type the address), generated by `node scripts/parity-features.mjs`. Run it with the server stopped.
