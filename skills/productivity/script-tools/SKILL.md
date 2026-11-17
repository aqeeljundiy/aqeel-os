---
name: script-tools
description: Use when a job moves more data than fits in a chat (bulk reads, syncs, diffs, scheduled Airtable to Sheets jobs). Your scripts can call every tool you have connected through aqeelOS, with no API key.
---

# Calling your connected tools from a script

Your terminal runs as your own user and holds no keys. That is on purpose. You do not need a key: aqeelOS calls your
connected tools for your scripts, with your own sign-ins and the same rules as in chat.

Do not ask the person for an API token for an app you already have connected. Use this instead.

## When to use it

- The data does not fit in the conversation (thousands of rows, many fields, a full id list for a deletion check).
- A schedule must read one app and write another every day (Airtable → Sheet, Sheet → n8n…).
- You need exact checks (counts, diffs, checksums) that a script does better than reading by eye.

Small one-off reads stay in the chat with the normal tools.

## How

Two helpers sit in your folder, in `.tools/` (written by aqeelOS):

```bash
.tools/aqtool list                                   # your servers and their tools
.tools/aqtool airtable list_bases                    # one call, prints the answer as JSON
.tools/aqtool google google_sheets '{"action":"read","spreadsheet":"<id>","range":"Leads!A1:E5"}'
```

In Python (use this for anything with paging or loops):

```python
import sys
sys.path.insert(0, "/path/to/your/workspace/.tools")   # your workspace: the folder your terminal starts in (pwd)
from aqtools import call, tools, ToolError

page = call("airtable", "list_records_for_table", {"baseId": "app...", "tableId": "tbl...", "pageSize": 100})
rows = call("google", "google_sheets", {"action": "read", "spreadsheet": "<id>", "range": "Leads!A:DV"})
```

- `server` is the name in your tool list (for example `airtable`, `n8n`); `google` is your Google tools
  (`google_sheets`, `google_drive`, `google_docs`, `google_gmail`, `google_calendar`).
- The arguments are exactly the tool's arguments in chat. Read a tool's description once in chat (or try a
  small call) before you loop.
- `call` returns the tool's structured answer when it has one, otherwise its text (parsed as JSON when it is JSON).
  A refusal or failure raises `ToolError` with the reason: stop and report it, do not retry blindly.
- Page through big tables (the tool's `offset`/cursor argument) instead of one huge call.

- Answers from a script are not cut short the way chat answers are (a chat read stops at 40,000 characters), so
  still read big sheets in chunks (for example 500 rows at a time).

## A schedule that moves a lot of data

Write the job once as a script in your workspace (for example `scripts/<job>.py`) that does every read, diff,
write and check itself and prints a short summary with the counts and the verdict. Give it a `--dry-run` flag that
does everything except write, and run that first with the person. The schedule then runs the script and reports its
summary; the model does not copy the data. Keep every rule the schedule's instructions set (read-only sources,
batch sizes, what counts as success), now enforced in code. Change a schedule's instructions only with the
person's OK.

## Rules

- Same rights as in chat, nothing more. A paused or unshared account is refused here too.
- Write in batches the tool accepts (Sheets: `write` a block of rows, or `batch_update`), never cell by cell.
- Verify after writing (read back counts or a checksum) before you report success, and never mark a sync as
  done when a check failed.
- Keep scripts in your workspace so the schedule can run them; print a short summary, not the data.
