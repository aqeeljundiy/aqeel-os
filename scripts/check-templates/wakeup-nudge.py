#!/usr/bin/env python3
"""Daily wake-up nudges as a script-only schedule, no model. A generic template: everything that belongs to one install lives in the
install's own data folder, in <data>/box-checks/wakeup-nudge.json (never in git):
  {"hour": 4, "tz_hours": 7, "stop_word": "hello", "stop_text": "Morning! Stopping now.", "nudges": ["...", "..."], "source": "whatsapp"}
Every key is optional. <data> is $AQEELOS_DATA, else $UI_DATA_DIR, else ~/apps/hermes-ui-data; WAKEUP_CONFIG names another file.
The schedule fires once per nudge (for 5 nudges: cron "0,2,4,6,8 <hour> * * *"). Each run prints ONE line, which the engine delivers to the schedule's
`deliver` target: the next nudge. If a message that is just the stop word arrived on the channel since <hour>:00 today, it prints the stop text once and nothing
after that. Nothing printed = nothing sent. Read-only on the engine's state.db.
State: ~/.hermes/cron/wakeup-state.json {date, n, stopped}.  Test without sending: python3 wakeup-nudge.py --dry  (does not write state)."""
import datetime as dt, json, os, re, sqlite3, sys

HOME = os.path.expanduser("~")
DATA = os.environ.get("AQEELOS_DATA") or os.environ.get("UI_DATA_DIR") or os.path.join(HOME, "apps", "hermes-ui-data")
CONFIG = os.environ.get("WAKEUP_CONFIG") or os.path.join(DATA, "box-checks", "wakeup-nudge.json")
STATE = os.path.join(HOME, ".hermes", "cron", "wakeup-state.json")
DB = os.path.join(HOME, ".hermes", "state.db")
DEFAULTS = {
    "hour": 4, "tz_hours": 7, "stop_word": "hello", "stop_text": "Morning! Stopping now.", "source": "whatsapp",
    "nudges": ["Wake up!", "Hey, time to get up!", "Wake up! It's getting late!", "GET UP NOW. Reply and I stop.", "Last call. Reply or I keep going tomorrow."],
}
DRY = "--dry" in sys.argv


def load_config():
    cfg = dict(DEFAULTS)
    try:
        cfg.update({k: v for k, v in json.load(open(CONFIG)).items() if k in DEFAULTS})
    except Exception:
        pass
    if not isinstance(cfg["nudges"], list) or not cfg["nudges"]:
        cfg["nudges"] = DEFAULTS["nudges"]
    return cfg


def said_stop_word(cfg, since):
    try:
        c = sqlite3.connect("file:" + DB + "?mode=ro", uri=True, timeout=5)
        rows = c.execute("select m.content from messages m join sessions s on s.id = m.session_id where s.source = ? and m.role = 'user' and m.timestamp >= ? order by m.timestamp desc limit 50", (cfg["source"], since)).fetchall()
    except Exception:
        return False
    pat = r"\W*" + re.escape(str(cfg["stop_word"])) + r"\W*"
    return any(re.fullmatch(pat, (r[0] or "").strip(), re.I) for r in rows)


def main():
    cfg = load_config()
    tz = dt.timezone(dt.timedelta(hours=float(cfg["tz_hours"])))
    now = dt.datetime.now(tz)
    today = now.strftime("%Y-%m-%d")
    start = now.replace(hour=int(cfg["hour"]), minute=0, second=0, microsecond=0).timestamp() - 60
    try:
        st = json.load(open(STATE))
    except Exception:
        st = {}
    if st.get("date") != today:
        st = {"date": today, "n": 0, "stopped": False}
    if st["stopped"] or st["n"] >= len(cfg["nudges"]):
        return
    if said_stop_word(cfg, start):
        st["stopped"] = True
        out = cfg["stop_text"]
    else:
        out = cfg["nudges"][st["n"]]
        st["n"] += 1
    if not DRY:
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        tmp = STATE + ".tmp"
        json.dump(st, open(tmp, "w"))
        os.replace(tmp, STATE)
    print(out)


main()
