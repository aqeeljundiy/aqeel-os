#!/usr/bin/env python3
"""queue_post.py: the comment queue of Continue Threads. PROTOTYPE (12 Nov 2026), not run on the box. No model.
  --add URL TEXTFILE --lead hot|warm --author "..."   put a drafted comment in the queue (refuses: exit 3 banned phrase, exit 4 already commented or queued)
  --resume                                             after a pause (2 failures in a row) and a fix: start posting again
  --status                                             how many drafts wait, their post ids, and what aqeelOS allows now
  (no flag)                                            post the next draft if aqeelOS says posting is allowed now; run by a script-only schedule every 10 minutes
Lives in <workspace>/.tools next to comment_send.py, runs as the agent's own user. Needs a file .tools/.aqeelos-sig (mode 600) holding the agent's signature: the last part of the address in the agent's scripts/aqeelos-posting-gate.sh. Queue: .tools/comment_queue.json.
Posting is done by the existing comment_send.py (it already refuses banned phrases and a second comment on a thread), under the same browser.lock the model runs use.
After a post: aqeelOS's POST /posting-record (what the record_post tool does) checks signed out that the public sees the comment; the tracker row, ledger_sync.py and
the topic-3 line are done here too. Any failure leaves the draft in the queue; two failures in a row pause the queue and tell General (nothing is retried blindly)."""
import json, os, re, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
Q = os.path.join(HERE, "comment_queue.json")
AGENT = "continue-threads"
BASE = "http://127.0.0.1:4400"
TTL = 90 * 60
STOP = os.path.join(HERE, "STOP_COMMENTS")


def load():
    try:
        return json.load(open(Q))
    except Exception:
        return {"items": [], "fails": 0}


def save(d):
    tmp = Q + ".tmp"
    json.dump(d, open(tmp, "w"), ensure_ascii=False)
    os.replace(tmp, Q)


def sig():
    return open(os.path.join(HERE, ".aqeelos-sig")).read().strip()


def aq(path, body=None, timeout=90):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers={"content-type": "application/json"}, method="POST" if body is not None else "GET")
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def post_id(url):
    m = re.search(r"/post/([\w-]+)", url)
    return m.group(1) if m else url


def tg(text):
    subprocess.run([os.path.join(HERE, "tg_topic.sh"), "3", text], capture_output=True, timeout=60)


def general(text):
    subprocess.run([os.path.join(HERE, "tg_topic.sh"), "general", text], capture_output=True, timeout=60)


def send(url, textfile):
    # the same command the model used, under the same lock; comment_send.py exits 3 (banned phrase) or 4 (already commented) before it touches the browser
    r = subprocess.run(["flock", "-w", "600", os.path.join(HERE, "browser.lock"), "timeout", "250", sys.executable, os.path.join(HERE, "comment_send.py"), url, textfile, "--send"],
                       capture_output=True, text=True, cwd=HERE, env=dict(os.environ, PYTHONPATH=os.path.join(HERE, "pylib")))
    return r.returncode, r.stdout + r.stderr


def main():
    a = sys.argv[1:]
    d = load()
    now = time.time()
    d["items"] = [i for i in d["items"] if now - i["at"] < TTL * 4]  # forget very old ones
    if "--status" in a:
        st, al = aq("/posting-gate/%s/%s?json=1" % (AGENT, sig()))
        print(json.dumps({"waiting": len([i for i in d["items"] if not i.get("done")]), "ids": [post_id(i["url"]) for i in d["items"] if not i.get("done")], "allowed_now": al, "paused": d.get("fails", 0) >= 2}))
        return
    if "--resume" in a:
        d["fails"] = 0
        save(d)
        print("resumed")
        return
    if "--add" in a:
        url, tf = a[a.index("--add") + 1], a[a.index("--add") + 2]
        lead = a[a.index("--lead") + 1] if "--lead" in a else "hot"
        author = a[a.index("--author") + 1] if "--author" in a else ""
        text = open(tf).read().strip("\n")
        r, out = send_check(url, tf)
        if r:
            print(out)
            sys.exit(r)
        if any(post_id(i["url"]) == post_id(url) for i in d["items"]):
            print("REFUSED_ALREADY_QUEUED", post_id(url))
            sys.exit(4)
        d["items"].append({"url": url, "text": text, "lead": lead, "author": author, "at": now})
        save(d)
        print("queued", post_id(url))
        return
    # post the next one
    if os.path.exists(STOP) or d.get("fails", 0) >= 2:
        return
    items = [i for i in d["items"] if not i.get("done") and now - i["at"] < TTL]
    if not items:
        return
    st, al = aq("/posting-gate/%s/%s?json=1" % (AGENT, sig()))
    if st != 200 or not al.get("allow"):
        return
    it = items[0]
    if "--dry" in a:
        print("would post", it["url"], it["text"][:60].replace("\n", " "))
        return
    tf = os.path.join(HERE, "current_comment.txt")
    open(tf, "w").write(it["text"])
    rc, out = send(it["url"], tf)
    if rc in (3, 4):
        it["done"] = "refused %d" % rc
        save(d)
        return
    st, rec = aq("/posting-record/%s/%s" % (AGENT, sig()), {"post_url": it["url"], "text": it["text"], "lead": it["lead"]})
    if rc != 0 or "BOX_AFTER: [0" not in out or not rec.get("ok"):
        d["fails"] = d.get("fails", 0) + 1
        save(d)
        if d["fails"] >= 2:
            general("Comment queue paused: 2 failures in a row (%s). The hourly drafting run will look at it." % (rec.get("text") or out[-200:]).replace("\n", " ")[:300])
        return
    d["fails"] = 0
    it["done"] = "posted"
    it["posted_at"] = time.time()
    save(d)
    subprocess.run([sys.executable, os.path.join(HERE, "ledger_sync.py")], capture_output=True, cwd=HERE, timeout=300)
    tg("✅ Comment posted (queue) %s: %s" % (it["url"], it["text"][:80].replace("\n", " ")))


def send_check(url, tf):
    # without --send comment_send.py would type into the browser: only the two refusals are wanted, so run its lint and ledger guard on their own
    r = subprocess.run([sys.executable, "-c", "import sys; sys.argv=['x',%r,%r,'--send']; src=open('comment_send.py').read(); i=src.index('import re as _re'); exec(src[i:src.index('asyncio.run(main())')])" % (url, tf)], capture_output=True, text=True, cwd=HERE)
    return r.returncode, r.stdout + r.stderr


main()
