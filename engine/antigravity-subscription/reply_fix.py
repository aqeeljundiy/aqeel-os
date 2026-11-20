"""Gemini's reply through agy, made whole and clean for the engine's prompt bridge (standard library only, so it is tested without the engine).

15 Nov 2026, aqeelOS Code ("why can't Gemini create a website?"): every Gemini turn ended in a scrap ("Into", "現在用",
"!<|tool_call_end|>"), with the work done before it lost. agy streams the answer as text steps; between them the model may use agy's
own to-do tool (manage_task, the one agy tool the plugin lets through), and agy's final result then holds only the text after the last
of those. whole() puts the answer together from every text step instead, and keeps agy's result when that is the longer one.
The cause of the scraps (confirmed on the box with the engine's own reader): a tool call whose JSON has raw line breaks inside a string
(a whole HTML page in project_write) is not valid JSON, and the bridge drops such a block without a word, so every file write vanished
and only the text around it was left. clean() writes each such block again as valid JSON (json strict=False reads it).
clean() also drops Gemini's model markers (<|tool_call_end|> and the like) and reads <|tool_call_start|>{...}<|tool_call_end|> as the
bridge's <tool_call> block. Tool calls are never renamed: "tool_call" is the engine's own tool for its tool catalog (tools/tool_search_catalog.py).
"""
import json
import re

_NATIVE = re.compile(r"<\|tool_call_start\|>\s*(\{.*?\})\s*<\|tool_call_end\|>", re.DOTALL)
_BLOCK = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)
_MARK = re.compile(r"<\|[a-z][a-z0-9_]{0,40}\|>", re.I)


def whole(steps, result):
    """steps: {step index: text} of agy's agent_response steps, in order; result: agy's final response. The fuller of the two."""
    joined = "\n\n".join(t.strip() for _, t in sorted(steps.items()) if t and t.strip())
    result = result or ""
    return joined if len(joined.strip()) > len(result.strip()) else result


def clean(text):
    if not isinstance(text, str) or not text:
        return text
    text = _NATIVE.sub(lambda m: "<tool_call>" + m.group(1) + "</tool_call>", text)

    def valid(m):
        try:
            json.loads(m.group(1))
            return m.group(0)   # already valid: exactly as it was
        except ValueError:
            pass
        try:
            return "<tool_call>" + json.dumps(json.loads(m.group(1), strict=False), ensure_ascii=False) + "</tool_call>"
        except ValueError:
            return m.group(0)

    text = _BLOCK.sub(valid, text)
    return _MARK.sub("", text).strip()


# 19 Nov 2026 (i40535581): the main agent's reply-check schedule fell back to Gemini, which called the engine's catalog tool
# "tool_call" as an agy tool of its own instead of writing it as text; the plugin stops such a request for safety, and the whole
# schedule failed. A stop for an agy tool step is now tried once more with this note added; any other stop still fails at once.
_OWN_TOOL = re.compile(r"^Stopped for safety: agy tried to use its own tool (.*)\.$")


def retry_note(error):
    """The note to add for one more try after a safety stop, or None when the stop must stand."""
    m = _OWN_TOOL.match(str(error or ""))
    if not m:
        return None
    return ("\n\n[aqeelOS] Your last answer tried to run a tool of your own (" + (m.group(1).strip() or "a tool") + "). You have no "
            "tools in this session. To use a tool described above (tool_search, tool_call or any other), write the call as text "
            "in the <tool_call>{...}</tool_call> format exactly as described; aqeelOS runs it and gives you the result.")


RETRY_TRIES = 3  # the first run and two more (20 Nov 2026, i40535581: one more try was not enough, the schedule still failed)


def with_retries(run, prompt_text, tries=RETRY_TRIES):
    """run(text) once, and again with retry_note's note while a stop for an own agy tool step repeats, up to `tries` runs in all.
    Any other error, or the last try's, is raised as it came."""
    text = prompt_text
    for attempt in range(tries):
        try:
            return run(text)
        except RuntimeError as e:
            note = retry_note(str(e))
            if not note or attempt == tries - 1:
                raise
            text = prompt_text + note
