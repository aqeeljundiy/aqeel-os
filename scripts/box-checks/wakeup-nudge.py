#!/usr/bin/env python3
"""4AM wake-up as a script-only schedule (12 Nov 2026), no model.
The schedule fires at 04:00, 04:02, 04:04, 04:06 and 04:08 (cron "0,2,4,6,8 4 * * *"). Each run prints ONE line, which the engine delivers to the
schedule's `deliver` target (the owner's WhatsApp): the next of five escalating nudges. If a message that is just "hello" came in on WhatsApp since 04:00
today, it prints "Morning! Stopping now." once and nothing after that. Nothing printed = nothing sent. Read-only on the engine's state.db.
State: ~/.hermes/cron/wakeup-state.json {date, n, stopped}.  Test without sending: python3 wakeup-nudge.py --dry  (does not write state)."""
import datetime as dt, json, os, re, sqlite3, sys

HOME = os.path.expanduser("~")
STATE = os.path.join(HOME, ".hermes", "cron", "wakeup-state.json")
DB = os.path.join(HOME, ".hermes", "state.db")
TZ = dt.timezone(dt.timedelta(hours=7))
NUDGES = ["Wake up! It's 4AM.", "Hey, it's 4AM. Time to get up!", "Aqeel! Wake up! It's 4AM already!!", "4AM. GET UP NOW. Reply Hello and I stop.", "Last call: 4AM. Reply Hello or I keep going tomorrow."]
DRY = "--dry" in sys.argv


def said_hello(since):
    try:
        c = sqlite3.connect("file:" + DB + "?mode=ro", uri=True, timeout=5)
        rows = c.execute("select m.content from messages m join sessions s on s.id = m.session_id where s.source = 'whatsapp' and m.role = 'user' and m.timestamp >= ? order by m.timestamp desc limit 50", (since,)).fetchall()
    except Exception:
        return False
    return any(re.fullmatch(r"\W*hello\W*", (r[0] or "").strip(), re.I) for r in rows)


def main():
    now = dt.datetime.now(TZ)
    today = now.strftime("%Y-%m-%d")
    start = now.replace(hour=4, minute=0, second=0, microsecond=0).timestamp() - 60
    try:
        st = json.load(open(STATE))
    except Exception:
        st = {}
    if st.get("date") != today:
        st = {"date": today, "n": 0, "stopped": False}
    if st["stopped"] or st["n"] >= len(NUDGES):
        return
    if said_hello(start):
        st["stopped"] = True
        out = "Morning! Stopping now."
    else:
        out = NUDGES[st["n"]]
        st["n"] += 1
    if not DRY:
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        tmp = STATE + ".tmp"
        json.dump(st, open(tmp, "w"))
        os.replace(tmp, STATE)
    print(out)


main()
