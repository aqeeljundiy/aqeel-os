# Tests for engine/antigravity-subscription/reply_fix.py: Gemini's reply through agy, whole and clean for the engine's prompt bridge.
# Run: python3 -I scripts/antigravity-reply.test.py
import importlib.util
import pathlib

here = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("rf", here.parent / "engine" / "antigravity-subscription" / "reply_fix.py")
rf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rf)
n = 0


def check(name, cond):
    global n
    assert cond, name
    n += 1
    print("ok", name)


# 15 Nov 2026: the answer came in two text steps with agy's to-do tool between them, and agy's result kept only the last scrap
steps = {1: "I'll build the Skintific store: a home page, products and checkout.\n<tool_call>{...}</tool_call>", 3: "現在用"}
check("the answer is put together from every text step when agy's result holds only the last", rf.whole(steps, "現在用").startswith("I'll build the Skintific store"))
check("the steps keep their order", rf.whole({3: "second", 1: "first"}, "") == "first\n\nsecond")
check("agy's result is kept when it is the whole answer", rf.whole({1: "The vast blue sea."}, "The vast blue sea.\nDONE\n") == "The vast blue sea.\nDONE\n")
check("no steps: agy's result", rf.whole({}, "only this") == "only this")

check("Gemini's markers are not left in the text", rf.clean("Done, the site is ready.<|im_end|>") == "Done, the site is ready.")
native = 'Writing the page.<|tool_call_start|>{"name": "x"}<|tool_call_end|>'
check("Gemini's own start and end markers become the bridge's block", rf.clean(native) == 'Writing the page.<tool_call>{"name": "x"}</tool_call>')
engine_meta = '<tool_call>{"type": "function", "function": {"name": "tool_call", "arguments": "{\\"calls\\": []}"}}</tool_call>'
check("the engine's own tool_call (its tool catalog) is left exactly as it is", rf.clean(engine_meta) == engine_meta)
write = '現在用<tool_call>{"type": "function", "function": {"name": "project_write", "arguments": {"path": "index.html", "content": "<html>\n<body>Skintific</body>\n</html>"}}}</tool_call>'
import json, re
fixed = rf.clean(write)
blk = re.search(r"<tool_call>(.*)</tool_call>", fixed, re.S).group(1)
check("a write with line breaks in the page becomes valid JSON, the page kept to the letter", json.loads(blk)["function"]["arguments"]["content"] == "<html>\n<body>Skintific</body>\n</html>")
check("a block that is not JSON at all is left as it was", rf.clean("<tool_call>{not json}</tool_call>") == "<tool_call>{not json}</tool_call>")
check("an empty reply stays empty", rf.clean("") == "")
print(n, "passed")
