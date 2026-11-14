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
