# One tool-free model completion for an agent's script (app/tool-bridge.mjs op "complete"), with the measured token usage.
# argv[1]: the engine's folder. stdin: {"system","user","max_tokens"}  stdout: {"text","usage":{"prompt_tokens","completion_tokens","total_tokens"},"model"}
import json, sys
sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else '.')
req = json.load(sys.stdin)
from agent.auxiliary_client import call_llm
msgs = ([{"role": "system", "content": req["system"]}] if req.get("system") else []) + [{"role": "user", "content": req["user"]}]
r = call_llm(task="script_completion", messages=msgs, max_tokens=int(req.get("max_tokens", 1000)), timeout=int(req.get("timeout", 120)))
u = getattr(r, "usage", None)
g = lambda k: int(getattr(u, k, 0) or 0) if u is not None else 0
print(json.dumps({"text": (r.choices[0].message.content or "").strip(), "model": getattr(r, "model", None),
                  "usage": {"prompt_tokens": g("prompt_tokens"), "completion_tokens": g("completion_tokens"), "total_tokens": g("total_tokens")}}))
