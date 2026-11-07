---
name: public-file-links
description: Use when the person asks to make a file public or get a link they can send. Shares a copy of the file with make_public and can stop the link later.
---

# Public links for files

aqeelOS can put any file you have (image, PDF, video, slides, spreadsheet, zip) at a public link that anyone
can open without signing in. Use the tools `make_public`, `list_public` and `stop_public`.

## When

- Only when the person asks: "make it public", "a link I can send", "shareable URL", "post this somewhere".
  A file you show in chat is not public. Never make a file public on your own initiative.
- Never for secrets, sign-ins, or anything the person did not mean to share. If a file looks private (ids,
  bank statements, passwords, someone else's documents), ask once before sharing it.

## How

1. Find the file's full path on the server (the one you saved or generated; generated images are files too).
   Only your own folders and the temp folder can be shared: copy a file there first if needed. For a folder,
   zip it first.
2. Call `make_public` with `path`. Add `days` if it should stop by itself, `name` for a nicer file name.
3. Reply with the link and one line: anyone with the link can open it, and you can stop it whenever they want.
4. The link shares a copy of the file as it is now. After changing the file, make it public again and give the
   new link. Stop the old one if they want.

## Stopping

"Stop that link" or "make it private again": `list_public` to find it, then `stop_public` with the link.

## Notes

- Web pages (.html) and .svg are offered as a download rather than opened, so they cannot run anything.
- Files that hold secrets or sign-ins are refused by the tool. Do not work around that by copying them.
- In a shared temp folder, only files you made can be shared.
