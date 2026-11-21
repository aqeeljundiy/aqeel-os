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


# 21 Nov 2026: Gemini sometimes calls one of the engine's tools (terminal, read_file, session_search, skill_view) the native way
# instead of writing it as text. agy then reports a tool step for a tool it does not have, and the plugin used to stop the whole
# request for safety. engine_call(step, agy_tools) reads such a step as the engine's call: {"name", "arguments"}, or None when the
# tool is one of agy's own (that stop stands) or its arguments cannot be read.
_ARG_KEYS = ("arguments", "args", "input", "tool_input", "parameters", "tool_args", "argumentsJson", "arguments_json")


def engine_call(step, agy_tools):
    if not isinstance(step, dict):
        return None
    info = step.get("tool_info") if isinstance(step.get("tool_info"), dict) else {}
    name = str(step.get("tool_name") or info.get("name") or "").strip()
    if not name or name in (agy_tools or ()) or not re.fullmatch(r"[A-Za-z_][\w.-]{0,80}", name):
        return None
    for src in (info, step):
        for k in _ARG_KEYS:
            v = src.get(k)
            if isinstance(v, str):
                try:
                    v = json.loads(v)
                except ValueError:
                    continue
            if isinstance(v, dict):
                return {"name": name, "arguments": v}
    return None


# 21 Nov 2026 (Elkiya, Threads): the engine's prompt bridge (copilot_acp_client._format_messages_as_prompt) writes only each
# message's text, so an assistant turn that made tool calls showed as nothing and Gemini never saw its own earlier calls. After a
# compaction cut the results down to labels, it had no example of a right call left: it sent tool_call for my_schedules with
# "arguments": {} 25 times in 75 minutes and never answered. with_calls(messages) writes each past call into the assistant turn
# in the same <tool_call> form Gemini must answer in, and names the call a result belongs to. Long text values are cut, the JSON
# stays valid. The messages given are not changed.
_CUT = 400


def _short(v):
    if isinstance(v, str):
        return v if len(v) <= _CUT else v[:_CUT] + f"… ({len(v)} chars)"
    if isinstance(v, dict):
        return {k: _short(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_short(x) for x in v[:20]] + ([f"… ({len(v)} items)"] if len(v) > 20 else [])
    return v


def _call_parts(tc):
    fn = tc.get("function") if isinstance(tc, dict) else getattr(tc, "function", None)
    get = (lambda o, k: o.get(k)) if isinstance(fn, dict) else (lambda o, k: getattr(o, k, None))
    if fn is None:
        return None, None, None
    name, args = get(fn, "name"), get(fn, "arguments")
    if isinstance(args, str):
        try:
            args = json.loads(args) if args.strip() else {}
        except ValueError:
            args = _short(args)
    tid = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", None)
    return name, args, tid


def with_calls(messages):
    out, names = [], {}
    for m in messages or []:
        if not isinstance(m, dict):
            out.append(m)
            continue
        role = str(m.get("role") or "").lower()
        if role == "assistant" and m.get("tool_calls"):
            blocks = []
            for tc in m.get("tool_calls") or []:
                name, args, tid = _call_parts(tc)
                if not name:
                    continue
                if tid:
                    names[tid] = name
                blocks.append("<tool_call>" + json.dumps({"name": name, "arguments": _short(args if args is not None else {})},
                                                         ensure_ascii=False) + "</tool_call>")
            if blocks:
                text = m.get("content") if isinstance(m.get("content"), str) else ""
                m = {**m, "content": ((text.strip() + "\n") if text and text.strip() else "") + "\n".join(blocks)}
        elif role == "tool" and names.get(m.get("tool_call_id")) and isinstance(m.get("content"), str):
            m = {**m, "content": f"[result of {names[m['tool_call_id']]}]\n" + m["content"]}
        out.append(m)
    return out
