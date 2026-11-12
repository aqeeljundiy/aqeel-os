#!/usr/bin/env python3
"""posting-guard: what a script that posts in public (a comment, a DM, an own thread) calls before and after it acts.
aqeelOS decides with the agent's Run rules (app/posting-limits.mjs); this file only asks and records. Standard library only.

  As a module, in a Python posting script (put it next to the script):
      import posting_guard as pg
      pg.begin("comment")                 # before the browser is touched: exits 7 with the reason when a limit says no. Only with --send.
      pg.sending()                        # right before the click or key press that posts
      pg.record("comment", url, text)     # right after it
  Kinds: comment, dm (a DM we start), thread (an own post), reply (an answer in a chat the other person started).

  As a command (shell scripts, or by hand):
      T=$(posting-guard check comment) || exit $?       # prints a ticket; on refusal prints the reason on stderr, exit 7
      posting-guard sending "$T"
      posting-guard record comment "$URL" --ticket "$T" [--text-file F]
      posting-guard cancel "$T"                           # nothing was posted (only before sending)
      posting-guard act comment "$URL"                    # check + sending + record in one step, for a script that cannot be patched in two places
      posting-guard peek comment                          # what the limits say now; reserves nothing

Rules of the road: a refused check is final for that run (exit 7, "REFUSED_POSTING_LIMIT: ..."). aqeelOS not answering is a refusal too (exit 8):
nothing is posted that cannot be counted. A ticket that says "sending" and never gets a record is an "unrecorded action": it keeps counting
against the limits and raises one Health item. A ticket checked but never sent is cancelled when the script ends.

Where it finds aqeelOS: $POSTING_GUARD_CONF, else posting-guard.json next to this file: {"base":"http://127.0.0.1:4400","agent":"continue-threads","sig":"..."}
(the migration script writes it from the agent's posting gate). $POSTING_GUARD_BASE / _AGENT / _SIG override single values.
aqeelOS owns that file: it makes it again with its current key at every start, after a key rotation and whenever it refuses a signature.
A refusal of the signature itself (HTTP 401/403, not "over the limit") is told apart: the file is read once more after a moment (aqeelOS may have just
made it again) and the call retried once; if it is still refused, ONE line is printed: "the posting guard's key is out of date; aqeelOS re-issues it at its
next start" (exit 8). The same line within the hour says "already reported at <time>; do not report again" (the marker is .stale-reported next to the file).
"""
import atexit, json, os, sys, time, urllib.error, urllib.request

EXIT_REFUSED, EXIT_ERROR = 7, 8
STALE_MSG = "the posting guard's key is out of date; aqeelOS re-issues it at its next start"
DID_NOT_ANSWER = "aqeelOS did not answer"
STALE_WAIT = float(os.environ.get("POSTING_GUARD_STALE_WAIT", "3"))   # seconds to wait before the file is read once more
KINDS = ("comment", "dm", "thread", "reply")
_S = {"ticket": None, "kind": None, "sent": False, "mine": False, "recorded": False}


class KeyStale(RuntimeError):
    """aqeelOS refused the signature (401/403), not the post."""


def _mask(x):
    """An error as text, with the signature taken out (a log never shows it)."""
    t = str(x)
    try:
        sig = _conf().get("sig")
    except RuntimeError:
        sig = None
    return t.replace(sig, "(hidden)") if sig else t


def _stale_note():
    """STALE_MSG; the second time within the hour it says it was already reported (so an agent does not tell the team every few minutes)."""
    f = os.path.join(os.path.dirname(os.environ.get("POSTING_GUARD_CONF") or os.path.abspath(__file__)), ".stale-reported")
    try:
        with open(f) as fh:
            at = float(fh.read().strip())
        if 0 <= time.time() - at < 3600:
            return "%s (already reported at %s; do not report again)" % (STALE_MSG, time.strftime("%H:%M", time.localtime(at)))
    except (OSError, ValueError):
        pass
    try:
        with open(f, "w") as fh:
            fh.write(str(time.time()))
    except OSError:
        pass
    return STALE_MSG


def _code(why):
    return EXIT_ERROR if why.startswith((DID_NOT_ANSWER, STALE_MSG)) else EXIT_REFUSED


def _conf():
    c = {}
    f = os.environ.get("POSTING_GUARD_CONF") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "posting-guard.json")
    try:
        with open(f) as fh:
            c = json.load(fh)
    except (OSError, ValueError):
        pass
    for k in ("base", "agent", "sig"):
        v = os.environ.get("POSTING_GUARD_" + k.upper())
        if v:
            c[k] = v
    if not (c.get("base") and c.get("agent") and c.get("sig")):
        raise RuntimeError("posting-guard has no address for aqeelOS (" + f + " is missing or incomplete)")
    return c


def _post(route, body, tries=3, timeout=20, urlopen=None):
    """POST json to /posting-<route>/<agent>/<sig>. Returns (http status, parsed json). Raises RuntimeError when aqeelOS cannot be reached."""
    c = _conf()
    last, reread = None, False
    for i in range(tries):
        url = "%s/posting-%s/%s/%s" % (c["base"].rstrip("/"), route, c["agent"], c["sig"])
        req = urllib.request.Request(url, json.dumps(body).encode(), {"content-type": "application/json"})
        try:
            with (urlopen or urllib.request.urlopen)(req, timeout=timeout) as r:
                return r.status, json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:     # 409 = a refusal, with its reason in the body; 401/403 = the signature was refused; anything else is an error
            if e.code in (401, 403):
                if reread:
                    raise KeyStale(STALE_MSG)
                reread = True
                time.sleep(STALE_WAIT)          # aqeelOS makes the file again as soon as it refuses a signature: read it once more
                c2 = _conf()
                if c2["sig"] == c["sig"]:
                    raise KeyStale(STALE_MSG)
                c = c2
                continue
            try:
                return e.code, json.loads(e.read().decode() or "{}")
            except ValueError:
                last = e
        except (urllib.error.URLError, OSError, ValueError) as e:
            last = e
        time.sleep(1 + i)
    raise RuntimeError("%s (%s)" % (DID_NOT_ANSWER, _mask(last)))


def _get(path, timeout=20):
    c = _conf()
    with urllib.request.urlopen("%s/posting-%s/%s/%s" % (c["base"].rstrip("/"), path.split("?")[0], c["agent"], c["sig"]) + ("?" + path.split("?", 1)[1] if "?" in path else ""), timeout=timeout) as r:
        return json.loads(r.read().decode())


# ---- the calls ----
def check_raw(kind):
    """-> (ticket or None, reason). ticket None = refused or could not ask."""
    if kind not in KINDS:
        return None, "unknown kind %r (use %s)" % (kind, ", ".join(KINDS))
    try:
        st, j = _post("check", {"kind": kind})
    except KeyStale:
        return None, _stale_note()
    except (RuntimeError, ValueError) as e:
        return None, "aqeelOS did not answer, so nothing may be posted (%s)" % _mask(e)
    if st == 200 and j.get("allow") and j.get("ticket"):
        return j["ticket"], ""
    return None, j.get("reason") or "refused (HTTP %s)" % st


def sending_raw(ticket):
    st, j = _post("sending", {"ticket": ticket})
    return st == 200 and j.get("ok"), j.get("text", "")


def record_raw(kind, ref="", text=None, ticket=None, lead=None):
    body = {"kind": kind, "ref": ref or ""}
    if ticket:
        body["ticket"] = ticket
    if text:
        body["text"] = text
    if lead:
        body["lead"] = lead
    st, j = _post("record", body, tries=4)
    return st == 200 and j.get("ok"), j.get("text", "")


def cancel_raw(ticket):
    try:
        st, j = _post("cancel", {"ticket": ticket}, tries=2)
        return st == 200 and j.get("ok")
    except RuntimeError:
        return False


# ---- for a Python posting script ----
def _refuse(msg, code):
    sys.stdout.write("REFUSED_POSTING_LIMIT: %s\n" % msg)
    sys.stdout.flush()
    sys.exit(code)


def _cancel_at_exit():
    if _S["ticket"] and _S["mine"] and not _S["sent"] and not _S["recorded"]:
        cancel_raw(_S["ticket"])


def check(kind):
    """Ask now. Exits 7 with the reason when refused, 8 when aqeelOS cannot be asked. A parent script's ticket (env POSTING_GUARD_TICKET) is used as it is."""
    t = os.environ.get("POSTING_GUARD_TICKET")
    if t:
        _S.update(ticket=t, kind=os.environ.get("POSTING_GUARD_KIND") or kind, mine=False)
        return t
    t, why = check_raw(kind)
    if not t:
        _refuse(why, _code(why))
    _S.update(ticket=t, kind=kind, sent=False, mine=True, recorded=False)
    os.environ["POSTING_GUARD_TICKET"], os.environ["POSTING_GUARD_KIND"] = t, kind   # a script this one starts (dm_outbound -> dm_send) posts under the same ticket
    atexit.register(_cancel_at_exit)
    return t


def begin(kind, argv=None):
    """check(kind), but only for a run that really posts (--send on the command line); a dry run asks for nothing."""
    if "--send" in (sys.argv if argv is None else argv):
        return check(kind)
    return None


def sending():
    """Right before the click that posts. After this, a missing record is an unrecorded action."""
    if not _S["ticket"] or _S["sent"]:
        return
    try:
        ok, text = sending_raw(_S["ticket"])
    except KeyStale:
        _refuse(_stale_note(), EXIT_ERROR)
    except RuntimeError as e:
        _refuse("aqeelOS did not answer when the post was about to go (%s)" % _mask(e), EXIT_ERROR)
    if not ok:
        _refuse(text or "the ticket is no longer valid; check again", EXIT_REFUSED)
    _S["sent"] = True


def record(kind=None, ref="", text=None, lead=None):
    """Right after the click. Prints aqeelOS's answer; never stops the script (the post is made)."""
    if not _S["ticket"]:
        return None
    try:
        ok, msg = record_raw(kind or _S["kind"], ref, text, _S["ticket"], lead)
    except RuntimeError as e:
        sys.stderr.write("POSTING_GUARD_RECORD_FAILED: %s (aqeelOS will flag it as an unrecorded action)\n" % _mask(e))
        return False
    _S["recorded"] = True
    sys.stdout.write("POSTING_GUARD: %s\n" % msg)
    sys.stdout.flush()
    return ok


def cancel():
    if _S["ticket"] and _S["mine"] and not _S["sent"]:
        cancel_raw(_S["ticket"])
        _S["ticket"] = None


# ---- the command ----
def _opt(argv, name):
    if name in argv:
        i = argv.index(name)
        v = argv[i + 1] if i + 1 < len(argv) else ""
        del argv[i:i + 2]
        return v
    return None


def main(argv):
    a = list(argv)
    if not a or a[0] in ("-h", "--help", "help"):
        sys.stdout.write(__doc__)
        return 0
    cmd, a = a[0], a[1:]
    try:
        if cmd == "check" and a:
            t, why = check_raw(a[0])
            if t:
                print(t)
                return 0
            sys.stderr.write("REFUSED_POSTING_LIMIT: %s\n" % why)
            return _code(why)
        if cmd == "sending" and a:
            ok, text = sending_raw(a[0])
            if not ok:
                sys.stderr.write("REFUSED_POSTING_LIMIT: %s\n" % (text or "the ticket is no longer valid"))
            return 0 if ok else EXIT_REFUSED
        if cmd == "record" and len(a) >= 1:
            ticket, tf, tx = _opt(a, "--ticket"), _opt(a, "--text-file"), _opt(a, "--text")
            if tf:
                with open(tf) as fh:
                    tx = fh.read().strip()
            ok, text = record_raw(a[0], a[1] if len(a) > 1 else "", tx, ticket)
            print(("POSTING_GUARD: " if ok else "POSTING_GUARD_STOP: ") + text)
            return 0 if ok else EXIT_REFUSED   # a record that says STOP: the post stands, the run must not post more
        if cmd == "cancel" and a:
            ok = cancel_raw(a[0])
            return 0 if ok else EXIT_REFUSED
        if cmd == "act" and a:
            t, why = check_raw(a[0])
            if not t:
                sys.stderr.write("REFUSED_POSTING_LIMIT: %s\n" % why)
                return _code(why)
            ok, text = sending_raw(t)
            if not ok:
                sys.stderr.write("REFUSED_POSTING_LIMIT: %s\n" % text)
                return EXIT_REFUSED
            ok, text = record_raw(a[0], a[1] if len(a) > 1 else "", None, t)
            print(("POSTING_GUARD: " if ok else "POSTING_GUARD_STOP: ") + text)
            return 0
        if cmd == "peek" and a:
            print(json.dumps(_get("gate?json=1&kind=" + a[0])))
            return 0
    except urllib.error.HTTPError as e:   # peek reads without the retry
        if e.code not in (401, 403):
            raise
        sys.stderr.write("REFUSED_POSTING_LIMIT: %s\n" % _stale_note())
        return EXIT_ERROR
    except KeyStale:
        sys.stderr.write("REFUSED_POSTING_LIMIT: %s\n" % _stale_note())
        return EXIT_ERROR
    except RuntimeError as e:
        sys.stderr.write("REFUSED_POSTING_LIMIT: aqeelOS did not answer, so nothing may be posted (%s)\n" % _mask(e))
        return EXIT_ERROR
    sys.stderr.write("usage: posting-guard check|sending|record|cancel|act|peek ...  (posting-guard --help)\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
