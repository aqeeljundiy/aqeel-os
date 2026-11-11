#!/usr/bin/env python3
"""posting-guard-install: put the posting guard into an agent's workspace scripts (the install files that post: comment_send.py, dm_send.py,
dm_outbound.py, thread_full.py ...). A DRY RUN unless --apply. Every file it changes is copied first to <file>.bak-<date>-guard.

  python3 posting-guard-install.py --workspace ~/workspaces/continue-threads --profile ~/.hermes/profiles/continue-threads           # shows the diff
  python3 posting-guard-install.py --workspace ... --profile ... --apply
  python3 posting-guard-install.py --workspace ... --profile ... --undo --apply    # puts the backups back, removes the guard files

What it does, per agent:
  1. .tools/posting_guard.py     the helper (a copy of scripts/posting-guard.py), and .tools/posting-guard (a shell wrapper for it)
  2. .tools/posting-guard.json   where aqeelOS is: read from the agent's own posting gate script (scripts/aqeelos-posting-gate.sh), so the same signature
  3. the posting scripts, two or three lines each (see PATCHES): ask before the browser is touched, say "sending" right before the click, record right after.
A script it cannot patch (a line it does not recognise) is left alone and listed; the exit code is 2. A file that already mentions posting_guard is skipped.
Nothing here posts, comments or DMs, and nothing here starts a run.
"""
import argparse, difflib, os, re, shutil, stat, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
STAMP = time.strftime("%Y%m%d")

# (file, kind, [(what, anchor regex, replacement with \g<0>-style groups)])  Every anchor must match exactly once.
PY_ASK = "import posting_guard as pg; pg.begin(%r)   # aqeelOS posting limits: asks first, refuses over the limit (posting-guard)\n"
PATCHES = {
    "comment_send.py": [
        ("ask before the browser is touched (only with --send)", r"(?m)^asyncio\.run\(main\(\)\)\s*$", PY_ASK % "comment" + "asyncio.run(main())"),
        ("say 'sending' right before the Post click", r"(?m)^( +)for t in \(\"mousePressed\", \"mouseReleased\"\):\n( +)await call\(\"Input\.dispatchMouseEvent\", type=t, x=pos2\[0\]",
         r"\1pg.sending()\n\g<0>"),
        ("record right after it", r"(?m)^( +)await asyncio\.sleep\(7\)\n( +)try:\n( +)import re as _r",
         r'\1pg.record("comment", url, text)\n\g<0>'),
    ],
    "dm_send.py": [
        ("ask before the browser is touched (only with --send)", r"(?m)^asyncio\.run\(main\(\)\)\s*$", PY_ASK % "reply" + "asyncio.run(main())"),
        ("sending + record around the Enter that sends", r"(?m)^( +)await key\(\"Enter\", \"Enter\", 13\); await asyncio\.sleep\(5\)$",
         r'\1pg.sending()\n\1await key("Enter", "Enter", 13); pg.record("reply", url); await asyncio.sleep(5)'),
    ],
    "dm_outbound.py": [
        ("ask first: a DM we start (the dm_send it runs sends under this ticket)", r"(?m)^(HERE = os\.path\.dirname\(os\.path\.abspath\(__file__\)\))$",
         r'\1\nimport posting_guard as pg; pg.check("dm")   # aqeelOS posting limits: refuses over the limit; dm_send below sends under this ticket'),
    ],
    "thread_full.py": [
        ("ask before the browser is touched (only with --send)", r"(?m)^asyncio\.run\(main\(\)\)\s*$", PY_ASK % "thread" + "asyncio.run(main())"),
        ("sending + record around the Post click", r"(?m)^( +)if p: await click\(\*p\); await asyncio\.sleep\(9\)$",
         r'\1if p: pg.sending(); await click(*p); pg.record("thread", "own thread", spec["parts"][0]); await asyncio.sleep(9)'),
    ],
    "thread_post.py": [
        ("ask before the browser is touched (only with --send)", r"(?m)^asyncio\.run\(main\(\)\)\s*$", PY_ASK % "thread" + "asyncio.run(main())"),
        ("sending + record around the Post click", r"(?m)^( +)ok = await click_text\(\"Post\"\); print\(\"POST_CLICKED\", ok\); await asyncio\.sleep\(8\)$",
         r'\1pg.sending(); ok = await click_text("Post"); pg.record("thread", "own thread"); print("POST_CLICKED", ok); await asyncio.sleep(8)'),
    ],
}
# older node helpers that post (not used by the runners' prompts): one step, counted as an action when they start (posting-guard act)
JS_ACT = ("// aqeelOS posting limits: asks first and counts this run as an action (posting-guard act). Refused = stops here.\n"
          "{const r=require('child_process').spawnSync('python3',[require('path').join(__dirname,'posting_guard.py'),'act',%r,%s],{stdio:['ignore','inherit','inherit']});if(r.status!==0)process.exit(r.status||8)}\n")
JS_PATCHES = {"post_reply.js": ("comment", "process.argv[2]||''"), "post_reply_nonav.js": ("comment", "process.argv[2]||''"),
              "send_parts.js": ("thread", "'parts'"), "own_post_step.js": ("thread", "'own post step'")}

WRAPPER = '#!/bin/sh\n# posting-guard: the helper for shell scripts and by hand (posting_guard.py --help). Written by posting-guard-install.py.\nD=$(cd "$(dirname "$0")" && pwd)\nP=python3; command -v python3 >/dev/null 2>&1 || P=python\nexec "$P" "$D/posting_guard.py" "$@"\n'


def read(p):
    with open(p, encoding="utf-8", newline="") as f:
        return f.read()


def write_inplace(p, text, mode=None):
    new = not os.path.exists(p)
    with open(p, "w", encoding="utf-8", newline="") as f:   # in place: keeps the owner and ACLs of the agent's file
        f.write(text)
    if new and mode is not None:
        os.chmod(p, mode)


def gate_address(profile):
    g = os.path.join(profile, "scripts", "aqeelos-posting-gate.sh")
    m = re.search(r"(https?://[\w.:\[\]-]+)/posting-gate/([\w-]+)/([\w-]+)", read(g)) if os.path.exists(g) else None
    if not m:
        raise SystemExit("cannot read aqeelOS's address from %s (turn the posting limits on for the agent first: Schedules > Run rules)" % g)
    return {"base": m.group(1), "agent": m.group(2), "sig": m.group(3)}


def patch_py(name, text):
    out, notes = text, []
    for what, rx, rep in PATCHES[name]:
        n = len(re.findall(rx, out))
        if n != 1:
            return None, "%s: %r matched %d times (expected 1): left alone" % (name, what, n)
        out = re.sub(rx, rep, out, count=1)
        notes.append(what)
    return out, notes


def py_ok(text, name):
    d = tempfile.mkdtemp()
    try:
        f = os.path.join(d, name)
        with open(f, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        r = subprocess.run([sys.executable, "-m", "py_compile", f], capture_output=True, text=True)
        return r.returncode == 0, r.stderr.strip()
    finally:
        shutil.rmtree(d, ignore_errors=True)


def show(name, old, new):
    d = "".join(difflib.unified_diff(old.splitlines(True), new.splitlines(True), "a/" + name, "b/" + name, n=1))
    sys.stdout.write(d if d.endswith("\n") else d + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workspace", required=True)
    ap.add_argument("--profile", required=True)
    ap.add_argument("--apply", action="store_true", help="change files (default: only show what would change)")
    ap.add_argument("--undo", action="store_true", help="put the .bak-*-guard files back and remove the guard files")
    ap.add_argument("--guard", default=os.path.join(HERE, "posting-guard.py"))
    a = ap.parse_args()
    tools = os.path.join(os.path.expanduser(a.workspace), ".tools")
    profile = os.path.expanduser(a.profile)
    if not os.path.isdir(tools):
        raise SystemExit("no .tools folder in " + a.workspace)
    mode = "APPLY" if a.apply else "DRY RUN (nothing is changed; add --apply)"
    print("posting-guard-install: %s%s\n  workspace tools: %s" % (mode, " (undo)" if a.undo else "", tools))

    if a.undo:
        names = list(PATCHES) + list(JS_PATCHES)
        for n in names:
            baks = sorted(f for f in os.listdir(tools) if f.startswith(n + ".bak-") and f.endswith("-guard"))
            if not baks:
                continue
            print("  restore %s from %s" % (n, baks[0]))
            if a.apply:
                shutil.copyfile(os.path.join(tools, baks[0]), os.path.join(tools, n))
        for n in ("posting_guard.py", "posting-guard", "posting-guard.json"):
            if os.path.exists(os.path.join(tools, n)):
                print("  remove " + n)
                if a.apply:
                    os.remove(os.path.join(tools, n))
        return 0

    addr = gate_address(profile)
    print("  aqeelOS: %s  agent: %s  (signature read from the posting gate script)" % (addr["base"], addr["agent"]))
    guard_src = read(a.guard)
    problems = 0
    plan = []   # (path, old text or None, new text, mode, label)
    for fname, new, mode_ in (("posting_guard.py", guard_src, 0o660), ("posting-guard", WRAPPER, 0o770),
                              ("posting-guard.json", '{"base": "%s", "agent": "%s", "sig": "%s"}\n' % (addr["base"], addr["agent"], addr["sig"]), 0o660)):
        p = os.path.join(tools, fname)
        old = read(p) if os.path.exists(p) else None
        if old != new:
            plan.append((p, old, new, mode_, fname))
    for fname in PATCHES:
        p = os.path.join(tools, fname)
        if not os.path.exists(p):
            print("  - %s: not there, skipped" % fname)
            continue
        old = read(p)
        if "posting_guard" in old:
            print("  = %s: already patched" % fname)
            continue
        new, notes = patch_py(fname, old)
        if new is None:
            print("  ! " + notes)
            problems += 1
            continue
        ok, err = py_ok(new, fname)
        if not ok:
            print("  ! %s: the patched file does not compile (%s): left alone" % (fname, err))
            problems += 1
            continue
        plan.append((p, old, new, None, fname + " (" + "; ".join(notes) + ")"))
    for fname, (kind, arg) in JS_PATCHES.items():
        p = os.path.join(tools, fname)
        if not os.path.exists(p):
            continue
        old = read(p)
        if "posting_guard" in old:
            print("  = %s: already patched" % fname)
            continue
        new = JS_ACT % (kind, arg) + old
        plan.append((p, old, new, None, fname + " (counted as a %s when it starts)" % kind))
    for p, old, new, mode_, label in plan:
        print("\n== %s %s" % ("new" if old is None else "change", label))
        show(os.path.basename(p), old or "", new)
        if a.apply:
            if old is not None:
                b = "%s.bak-%s-guard" % (p, STAMP)
                if not os.path.exists(b):
                    shutil.copy2(p, b)
            write_inplace(p, new, mode_)
    print("\n%d file(s) %s, %d left alone." % (len(plan), "changed" if a.apply else "would change", problems))
    if not a.apply:
        print("Nothing was changed. Run again with --apply. Undo: the same command with --undo --apply (or copy the .bak-%s-guard files back)." % STAMP)
    return 2 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
