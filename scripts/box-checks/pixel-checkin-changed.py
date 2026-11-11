#!/usr/bin/env python3
"""P&P 4-hour check-in: "did anything change since the last run" without a model (12 Nov 2026). PROTOTYPE: not yet run to the end on the box.
Prints ONE line, a fingerprint: the newest non-bot message time across the Slack channels the Pixel bot reads, plus a short hash of the Master Backlog rows.
It is meant for run-check.mjs --cmd "<venv python> -I <this file>" --cmd-once --max-idle 480 --cmd-timeout 25: the model starts only when the line differs from the
one at the last run (a new message from a person, or a backlog edit), and anyway once every 8 hours. Read-only: Slack history and one sheet read through the
Pixel tool's own helpers (the ones fakhri_away_reply.py uses).
Two modes:
  --build   (once, by hand, then daily by a tiny script-only schedule if wanted) lists the workspace channels the bot is a member of and keeps their ids in
            ~/.hermes/pixel-tools/checkin_channels.json. This is slow: pixel_mcp checks the bot's identity before every Slack call, and listing every channel
            of the workspace took more than two minutes on 12 Nov. The normal run never does it.
  (default) reads that file, asks each channel for its newest messages (about 0.5 s per channel), reads the backlog rows, prints the fingerprint.
Exits 1 with nothing on stdout when anything cannot be read (the check then says "could not tell" and the run goes ahead, as before)."""
import hashlib, json, os, sys, time
sys.path.insert(0, "/home/claude/.hermes/pixel-tools")
import pixel_mcp as p

BOT = "U0C9K5Y0HTP"
BACKLOG = "1hhjDTh7wc_IQoRyjuKMNO6_fHFCj_b0YEGsBqwQrooA"
CACHE = "/home/claude/.hermes/pixel-tools/checkin_channels.json"


def build():
    ids = []
    for cid, c in p._channels().items():
        if not c.get("is_member"):
            continue
        name, kind = p._kind(cid)
        if kind in ("internal", "external"):
            ids.append(cid)
    tmp = CACHE + ".tmp"
    json.dump({"at": time.time(), "ids": sorted(ids)}, open(tmp, "w"))
    os.replace(tmp, CACHE)
    print("channels kept: %d" % len(ids))


def newest_human(cid):
    d = p._slack("conversations.history", {"channel": cid, "limit": 15})
    for m in d.get("messages", []):
        if m.get("user") and m.get("user") != BOT and not m.get("bot_id") and m.get("subtype") not in ("channel_join", "channel_leave"):
            return float(m["ts"])
    return 0.0


def main():
    if "--build" in sys.argv:
        return build()
    ids = json.load(open(CACHE))["ids"]
    newest = max([newest_human(cid) for cid in ids] or [0.0])
    v = p._sheets().spreadsheets().values().batchGet(spreadsheetId=BACKLOG, ranges=["'Master Backlog'!A2:I400"], valueRenderOption="FORMATTED_VALUE").execute()
    h = hashlib.sha1(json.dumps(v.get("valueRanges", []), sort_keys=True).encode()).hexdigest()[:10]
    print("slack=%.0f backlog=%s" % (newest, h))


try:
    main()
except Exception as e:
    sys.stderr.write("pixel-checkin-changed: %s\n" % str(e)[:200])
    sys.exit(1)
