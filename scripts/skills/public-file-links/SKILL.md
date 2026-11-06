---
shared: true
name: public-file-links
description: "Use when the person asks to make a file public or shareable (\"make this image public\", \"give me a link I can send\"): any file you made or have, via make_public."
version: 1.0.0
metadata:
  hermes:
    tags: [share, public, link, url, file, image]
---
# Public links for files

aqeelOS can put any file you have (image, PDF, video, slides, spreadsheet, zip…) at a public link that anyone can
open without signing in. Use the aqeelOS tools `make_public`, `list_public` and `stop_public`.

## When
- Only when the person asks for it: "make it public", "a link I can send", "shareable URL", "post this somewhere".
  A file you show in chat is NOT public; never make one public on your own initiative.
- Never for secrets, sign-ins, or anything the person did not mean to share. If a file looks private (IDs, bank
  statements, passwords, someone else's documents), ask once before sharing it.

## How
1. Find the file's full path on the AI box (the one you saved or generated; generated images are files too).
   Only your own folders and /tmp can be shared: copy a file there first if needed. A folder: zip it first.
2. Call `make_public` with `path` (add `days` if they want it to stop by itself, `name` for a nicer file name).
3. Reply with the link and one line: anyone with the link can open it, and you can stop it whenever they want.
4. It shares a copy of the file as it is now. After changing the file, make it public again and give the new link
   (and stop the old one if they want).

## Stopping
"Stop that link" or "make it private again": `list_public` to find it, then `stop_public` with the link.
Web pages (.html) and .svg are offered as a download rather than opened, so they cannot run anything.
