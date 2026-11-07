# code by aqeel scope

The first version is a local static website builder using installed subscription-backed official CLIs. It is not yet a full Codex replacement.

## Implemented in this iteration

- Saved local project folders and multiple conversations per project.
- GPT/Codex and Claude provider selection; Claude default, Sonnet, Opus and Haiku aliases.
- Conversations carry context across provider switches. Context is assembled from saved messages and project files, rather than native provider session IDs.
- Structured website generation into editable HTML/CSS/JS/SVG files.
- File editor, new files including nested paths, save shortcut, unsaved edit protection.
- Preview in an isolated iframe with desktop/mobile width controls.
- Previous file snapshots and recoverable restores.
- Project/chat panel resizing by pointer or keyboard; persisted widths and sidebar visibility.
- Own palette, local Plus Jakarta Sans, light/dark theme and reduced motion.
- PowerShell command console scoped to the selected project. Commands are noninteractive, each launches a new shell; it is not a persistent PTY.
- Existing one-click provider login retained at `/connections`.

## Next capabilities

Gemini subscription installation, login and adapter; full interactive terminal; import arbitrary existing project folders and Git repositories; framework dependency/build/preview servers; streaming agent events; provider-native sessions, reasoning/effort controls and model catalog discovery; granular diffs and approval controls; project/chat rename, archive and search; attachments; multiple account profiles; Git commits/branches and pull requests; broader keyboard shortcuts and task scheduling.

Local workspace data is in `data/workspace.json`, generated files in `data/projects/<id>/`, and snapshots in `data/versions/`. Reference repositories are cloned into `reference/`, separately from editable user projects. Chat/file context sent to a selected model is limited to the current project, most recent 12 messages, and 110,000 characters of files. Preview network requests and forms are blocked; external runtime APIs require a future integration.
