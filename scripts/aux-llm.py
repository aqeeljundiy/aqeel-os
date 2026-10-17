# One short, tool-free answer from the engine's helper model (the one that writes agent descriptions).
# stdin: {"system": "...", "user": "...", "max_tokens": 400}  stdout: the answer text.
import json, sys
sys.path.insert(0, sys.argv[1] if len(sys.argv) > 1 else '.')
req = json.load(sys.stdin)
from agent.auxiliary_client import call_llm
r = call_llm(task="profile_describer", messages=[{"role": "system", "content": req["system"]}, {"role": "user", "content": req["user"]}], max_tokens=int(req.get("max_tokens", 400)), timeout=90)
print((r.choices[0].message.content or "").strip())
