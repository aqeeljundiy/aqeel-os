"""Gemini's tool calls in the form the engine's prompt bridge reads (standard library only, so it is tested without the engine).

The bridge (agent/acp_openai_bridge.py) reads ``<tool_call>{"type": "function", "function": {"name": ..., "arguments": "..."}}</tool_call>``. Gemini through agy
(15 Nov 2026, aqeelOS Code: "why can't Gemini create a website?") answered with its own habits instead:
- one call named ``tool_call`` whose arguments hold ``{"calls": [{"name": ..., "arguments": ...}, ...]}``: the engine looked for a tool
  called "tool_call", found none, and the turn went off course;
- its model markers (``<|tool_call_start|>``, ``<|tool_call_end|>`` ...) left in the text, which became the answer the person saw.
normalize() turns a wrapper into one block per real call, reads ``<|tool_call_start|>{...}<|tool_call_end|>`` as a block, and drops
every other ``<|...|>`` marker. Anything it cannot read is left as it was, so a reply is never lost.
"""
import json
import re

_BLOCK = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)
_NATIVE = re.compile(r"<\|tool_call_start\|>\s*(\{.*?\})\s*<\|tool_call_end\|>", re.DOTALL)
_MARK = re.compile(r"<\|[a-z][a-z0-9_]{0,40}\|>", re.I)
# names Gemini gives the wrapper, and the keys it keeps the real calls under
_WRAPPERS = {"tool_call", "tool_calls", "multi_tool_use.parallel", "parallel", "call_tools"}
_LISTS = ("calls", "tool_calls", "tool_uses", "tools")


def _calls(obj):
    """The real calls in one parsed block: [obj] for a plain call, the inner list for a wrapper, [] when it is not a call."""
    if not isinstance(obj, dict):
        return []
    fn = obj.get("function") if isinstance(obj.get("function"), dict) else obj
    name, args = fn.get("name"), fn.get("arguments", fn.get("parameters", {}))
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            pass
    if isinstance(name, str) and name in _WRAPPERS and isinstance(args, dict):
        inner = next((args[k] for k in _LISTS if isinstance(args.get(k), list)), None)
        if inner is not None:
            out = []
            for c in inner:
                if isinstance(c, dict):
                    c = c.get("function") if isinstance(c.get("function"), dict) else c
                    n = c.get("name") or c.get("recipient_name")
                    if isinstance(n, str) and n:
                        a = c.get("arguments", c.get("parameters", {}))
                        out.append({"name": n.removeprefix("functions."), "arguments": a})
            return out
    if isinstance(name, str) and name:
        return [{"name": name, "arguments": args}]
    return []


def _block(call):
    """One call in the OpenAI function-call shape the bridge reads ({"type": "function", "function": {"name", "arguments": "<json>"}})."""
    args = call["arguments"]
    if not isinstance(args, str):
        args = json.dumps(args if args is not None else {}, ensure_ascii=False)
    return "<tool_call>" + json.dumps({"type": "function", "function": {"name": call["name"], "arguments": args}}, ensure_ascii=False) + "</tool_call>"


def normalize(text):
    if not isinstance(text, str) or not text:
        return text
    text = _NATIVE.sub(lambda m: "<tool_call>" + m.group(1) + "</tool_call>", text)

    def fix(m):
        try:
            obj = json.loads(m.group(1))
        except ValueError:
            return m.group(0)
        calls = _calls(obj)
        return "\n".join(_block(c) for c in calls) if calls else m.group(0)

    text = _BLOCK.sub(fix, text)
    return _MARK.sub("", text).strip()
