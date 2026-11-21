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
# 19 Nov 2026 (i40535581): a safety stop for an agy tool step is tried once more with a note; other stops stand
note = rf.retry_note("Stopped for safety: agy tried to use its own tool tool_call.")
check("a stop for an own tool step gets one more try with a note naming the tool", bool(note) and "tool_call" in note and "<tool_call>" in note)
check("a fall-back to agy's default agent is not retried", rf.retry_note("Stopped for safety: agy could not load its text-only setup and fell back to its default agent.") is None)
check("a different agent is not retried", rf.retry_note("Stopped for safety: agy started a different agent (x).") is None)
check("other errors are not retried", rf.retry_note("Antigravity gave no answer.") is None and rf.retry_note(None) is None)

# 20 Nov 2026 (i40535581): one more try was not enough, so a repeated own-tool stop gets up to two more tries; other stops stand at once
STOP = "Stopped for safety: agy tried to use its own tool tool_call."
def runner(fails, err=STOP):
    seen = []
    def run(text):
        seen.append(text)
        if len(seen) <= fails:
            raise RuntimeError(err)
        return ("ok", "")
    return run, seen
run, seen = runner(2)
check("two own-tool stops in a row: the third run answers", rf.with_retries(run, "q") == ("ok", "") and len(seen) == 3 and seen[0] == "q" and seen[2].startswith("q") and len(seen[2]) > 1)
run, seen = runner(3)
try:
    rf.with_retries(run, "q")
    raised = False
except RuntimeError:
    raised = True
check("three stops in a row: the last one is raised after three runs", raised and len(seen) == 3)
run, seen = runner(1, "Antigravity gave no answer.")
try:
    rf.with_retries(run, "q")
    raised = False
except RuntimeError:
    raised = True
check("any other error is raised at once, not retried", raised and len(seen) == 1)
# 21 Nov 2026: Gemini called the engine's terminal tool natively; agy has no such tool, so it is the engine's call, handed on as text
AGY = {"run_command", "view_file", "manage_task"}
check("an engine tool called natively becomes the engine's call", rf.engine_call({"step_type": "tool", "tool_name": "terminal", "tool_info": {"arguments": {"command": "echo hi"}}}, AGY) == {"name": "terminal", "arguments": {"command": "echo hi"}})
check("arguments given as JSON text are read too", rf.engine_call({"step_type": "tool", "tool_info": {"name": "read_file", "args": "{\"path\": \"a.md\"}"}}, AGY) == {"name": "read_file", "arguments": {"path": "a.md"}})
check("one of agy's own tools is never handed on (the safety stop stands)", rf.engine_call({"step_type": "tool", "tool_name": "run_command", "tool_info": {"arguments": {"CommandLine": "rm -rf /"}}}, AGY) is None)
check("no readable arguments: no call", rf.engine_call({"step_type": "tool", "tool_name": "terminal"}, AGY) is None)
print(n, "passed")

# 21 Nov 2026: Gemini never saw its own earlier calls (the bridge writes message text only) and sent tool_call with {} 25 times
hist = [
    {"role": "user", "content": "list my schedules"},
    {"role": "assistant", "content": "", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "tool_call",
        "arguments": json.dumps({"calls": [{"name": "mcp__aqeelos_notify__my_schedules", "arguments": {"action": "list"}}]})}}]},
    {"role": "tool", "tool_call_id": "c1", "content": "3 schedules"},
    {"role": "assistant", "content": "Writing it.", "tool_calls": [{"id": "c2", "function": {"name": "write_file",
        "arguments": json.dumps({"path": "/x", "content": "y" * 5000})}}]},
    {"role": "tool", "tool_call_id": "c2", "content": "ok"},
]
out = rf.with_calls(hist)
check("a past call shows in the assistant turn with its arguments", '"action": "list"' in out[1]["content"] and out[1]["content"].startswith("<tool_call>"))
check("the call block is the form Gemini answers in, and valid JSON", json.loads(out[1]["content"][len("<tool_call>"):-len("</tool_call>")])["name"] == "tool_call")
check("a result carries no label Gemini could copy", out[2]["content"] == "3 schedules")
check("the turn's own text stays first", out[3]["content"].startswith("Writing it.\n<tool_call>"))
check("long values are cut and the JSON stays valid", len(out[3]["content"]) < 700 and "5000 chars" in out[3]["content"]
      and json.loads(out[3]["content"].split("<tool_call>")[1][:-len("</tool_call>")])["arguments"]["path"] == "/x")
check("the messages given are not changed", hist[1]["content"] == "" and hist[2]["content"] == "3 schedules")
check("messages without calls pass as they are", rf.with_calls([{"role": "user", "content": "hi"}]) == [{"role": "user", "content": "hi"}])

# 22 Nov 2026: Gemini wrote made-up "Tool:" turns with made-up results after (or instead of) its call
fake = '<tool_call>{"name": "terminal", "arguments": {"command": "ls"}}</tool_call>\nTool:\n[result of terminal]\nOutput:\nmade up\n\nAssistant:\nmore'
kept, dropped = rf.own_turn(fake)
check("a reply ends where Gemini starts another turn", kept == '<tool_call>{"name": "terminal", "arguments": {"command": "ls"}}</tool_call>' and dropped.lstrip().startswith("Tool:"))
check("made up from the start: nothing kept", rf.own_turn("Tool:\n[result of terminal]\nOutput:\nx")[0] == "")
check("a bare result label is a new turn too", rf.own_turn("ok\n[result of terminal]\nx")[0] == "ok")
check("words like 'Tool:' inside a sentence stay", rf.own_turn("The Tool: terminal is fine.\nUser: name")[0] == "The Tool: terminal is fine.\nUser: name")
check("a normal answer is kept whole", rf.own_turn("halo kak, makasih ya") == ("halo kak, makasih ya", ""))
