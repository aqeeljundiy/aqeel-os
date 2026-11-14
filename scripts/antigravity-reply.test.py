# Tests for engine/antigravity-subscription/reply_fix.py: Gemini's tool calls in the form the engine's prompt bridge reads.
# Run: python3 -I scripts/antigravity-reply.test.py
import importlib.util
import json
import pathlib
import re

here = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("rf", here.parent / "engine" / "antigravity-subscription" / "reply_fix.py")
rf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rf)
BLOCK = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)   # what agent/acp_openai_bridge.py reads
# as the bridge reads a block: {"function": {"name", "arguments": "<json string>"}} -> {"name", "arguments": dict}
def calls(t):
    out = []
    for m in BLOCK.findall(t):
        f = json.loads(m)["function"]
        a = f["arguments"]
        out.append({"name": f["name"], "arguments": json.loads(a) if isinstance(a, str) else a})
    return out
n = 0


def check(name, cond):
    global n
    assert cond, name
    n += 1
    print("ok", name)


# what Gemini sent on 15 Nov 2026 (Code, "create a website"): one call named tool_call wrapping the real one, and its own end marker
seen = '!<tool_call>{"type": "function", "function": {"name": "tool_call", "arguments": "{\\"calls\\": [{\\"name\\": \\"mcp__aqeelos_code__project_list\\", \\"arguments\\": {\\"path\\": \\".\\", \\"depth\\": 2}}]}"}}</tool_call><|tool_call_end|>'
out = rf.normalize(seen)
check("the wrapper becomes the real call", calls(out) == [{"name": "mcp__aqeelos_code__project_list", "arguments": {"path": ".", "depth": 2}}])
check("its markers are not left in the text", "<|" not in out)

two = '<tool_call>{"name":"multi_tool_use.parallel","arguments":{"tool_uses":[{"recipient_name":"functions.project_read","parameters":{"path":"index.html"}},{"name":"project_list","arguments":"{\\"path\\": \\"src\\"}"}]}}</tool_call>'
check("a parallel wrapper becomes one block per call", [c["name"] for c in calls(rf.normalize(two))] == ["project_read", "project_list"])

native = 'Writing the page.<|tool_call_start|>{"name": "project_write", "arguments": {"path": "index.html", "content": "<h1>Hi</h1>"}}<|tool_call_end|>'
out = rf.normalize(native)
check("Gemini's own start and end markers are read as a block", calls(out) == [{"name": "project_write", "arguments": {"path": "index.html", "content": "<h1>Hi</h1>"}}] and out.startswith("Writing the page."))

plain = '<tool_call>{"type": "function", "function": {"name": "project_read", "arguments": "{\\"path\\": \\"a.txt\\"}"}}</tool_call>'
check("a call already in the right form is kept", calls(rf.normalize(plain)) == [{"name": "project_read", "arguments": {"path": "a.txt"}}])
check("text with no calls keeps its words, without stray markers", rf.normalize("Done, the site is ready.<|im_end|>") == "Done, the site is ready.")
broken = "<tool_call>{not json}</tool_call>"
check("a block it cannot read is left as it was (never lost)", rf.normalize(broken) == broken)
check("an empty reply stays empty", rf.normalize("") == "")
print(n, "passed")
