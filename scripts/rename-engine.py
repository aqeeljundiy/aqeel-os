# The engine's own sentences say aqeelOS instead of Hermes. Only real string literals change (Python's tokenizer
# decides what is a string, so names in code are never touched); a string compared against something (==, !=, in)
# is left alone, since code may rely on its exact value. Each file is written atomically and must still compile.
# Usage: python rename-engine.py <engine folder> <dir> [<dir> …]   prints the changed files.
import io, os, re, sys, tokenize, py_compile, tempfile

WORD = re.compile(r'(?<![\w.-])Hermes(?![\w-])')
SKIP_OPS = {'==', '!=', 'in', 'not', 'is'}

MODEL_NAME = re.compile(r'Hermes[- ]?\d')   # Nous's own models (Hermes 3, Hermes-4-405B) keep their names
# files whose wording is a contract with someone else, kept exactly as the engine ships them: the Anthropic
# sign-in rewrites the engine's name into "Claude Code" on the way out, and must keep doing so
KEEP = {'agent/anthropic_adapter.py'}

def rename_text(t):
    if MODEL_NAME.search(t): return t
    t = t.replace('Hermes Agent', 'aqeelOS').replace('built by Nous Research', 'built by Elkiya').replace('(by Nous Research)', '(by Elkiya)')
    # the one command people see in Telegram's menu with the engine's folder name in it
    t = t.replace('Write a markdown implementation plan to .hermes/plans/ without executing anything', 'Write a step-by-step plan as a markdown file, without doing anything yet')
    return WORD.sub('aqeelOS', t)

def patch(src):
    toks = list(tokenize.generate_tokens(io.StringIO(src).readline))
    lines = io.StringIO(src).readlines()          # the same line split the tokenizer uses (only \n), so offsets match
    starts = [0]
    for l in lines: starts.append(starts[-1] + len(l))
    edits = []
    sig = [t for t in toks if t.type not in (tokenize.NL, tokenize.NEWLINE, tokenize.COMMENT, tokenize.INDENT, tokenize.DEDENT)]
    fmid = getattr(tokenize, 'FSTRING_MIDDLE', None)
    kinds = {tokenize.STRING} | ({fmid} if fmid is not None else set())
    # a text that the code compares anywhere (== "…", "…" in x) keeps its exact value everywhere in the file,
    # so a writer and its checker never disagree
    compared = set()
    for i, t in enumerate(sig):
        if t.type in kinds:
            prev = sig[i - 1].string if i else ''
            nxt = sig[i + 1].string if i + 1 < len(sig) else ''
            if prev in SKIP_OPS or nxt in SKIP_OPS or (nxt == ':' and prev in ('{', ',')):
                compared.add(t.string.strip('rRbBuUfF').strip('"\''))
    for i, t in enumerate(sig):
        if t.type not in kinds or ('Hermes' not in t.string and '.hermes/plans/ without' not in t.string) or not re.search(r'\s', t.string):
            continue
        # f-strings: their {…} parts are code (and {{ }} are escapes) — leave any f-string piece with braces alone
        if (fmid is not None and t.type == fmid) or re.match(r'(?i)^[rbu]*f', t.string):
            if '{' in t.string or '}' in t.string: continue
        if t.string.strip('rRbBuUfF').strip('"\'') in compared:
            continue
        new = rename_text(t.string)
        if new != t.string:
            a = starts[t.start[0] - 1] + t.start[1]; b = starts[t.end[0] - 1] + t.end[1]
            edits.append((a, b, new))
    for a, b, new in sorted(edits, reverse=True):
        src = src[:a] + new + src[b:]
    return src, len(edits)


def main():
    root = sys.argv[1]; changed = 0
    for d in sys.argv[2:]:
        for dp, dns, fns in os.walk(os.path.join(root, d)):
            dns[:] = [x for x in dns if x not in ('tests', 'test', '__pycache__', 'node_modules', '.git')]
            for fn in fns:
                if not fn.endswith('.py'): continue
                p = os.path.join(dp, fn)
                if os.path.relpath(p, root).replace(os.sep, '/') in KEEP: continue
                try:
                    with open(p, encoding='utf-8') as f: old = f.read()
                except Exception: continue
                if 'Hermes' not in old and '.hermes/plans/ without' not in old: continue
                try: new, n = patch(old)
                except Exception: continue
                if not n or new == old: continue
                try: compile(new, p, 'exec')
                except Exception:
                    print('! left as it was (would not compile):', os.path.relpath(p, root)); continue
                fd, tmp = tempfile.mkstemp(dir=dp, prefix='.aq-', suffix='.tmp')
                with os.fdopen(fd, 'w', encoding='utf-8') as f: f.write(new)
                os.chmod(tmp, os.stat(p).st_mode); os.replace(tmp, p); changed += 1
                print('renamed engine words in', os.path.relpath(p, root))
    print(changed, 'file(s) renamed')

main()
