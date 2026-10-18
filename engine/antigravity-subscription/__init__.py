"""Google AI Pro / Ultra through Antigravity, Google's official ``agy`` command-line tool.

agy only does the thinking. aqeelOS (the engine) keeps the tools, approvals, memory and chats, like the Claude
subscription. The engine's prompt bridge (agent/copilot_acp_client.py) turns the conversation and the tool list into one
prompt and reads tool calls back from the reply; this plugin only swaps how that prompt reaches the model:

- every request runs ``agy`` in a fresh empty folder with a text-only custom agent (``excludeDefaultComponents``:
  agy's built-in tools are dropped, ``inheritMcp: false``: no MCP servers), and agy's own permission list denies every
  action (written by aqeelOS to ~/.gemini/antigravity-cli/settings.json);
- it fails closed: a tool step in agy's stream, or agy falling back to its default agent, ends the request with an error;
- the conversation record agy keeps on disk is removed after each request (aqeelOS keeps the chat itself).

Sign in once on Models › Accounts (Google link, paste the code). Text only: agy offers no image or video generation.
"""

import contextlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Any

from providers import register_provider
from providers.base import ProviderProfile

AGENT_NAME = "aqeelos-relay"
AGENT_MD = """---
name: aqeelos-relay
description: Text-only relay for aqeelOS. Writes the reply as text and never uses tools of its own.
mainAgent: true
subagent: false
excludeDefaultComponents: true
inheritMcp: false
commandExecutionPolicy: "off"
tools: []
---
You are the language model behind aqeelOS. You have no tools of your own in this session: never call, request or
mention tools such as files, terminal or browsing. Everything you need is in the prompt. When the prompt describes
tools and how to call them, reply exactly in that format; aqeelOS runs them and gives you the results.
"""
_HOME = Path(os.path.expanduser("~"))
_AGY_HOME = _HOME / ".gemini" / "antigravity-cli"
_FALLBACK_MARK = re.compile(r"not found, falling back to default", re.I)


def _agy_bin(command: str | None) -> str:
    return command or os.getenv("ANTIGRAVITY_SUBSCRIPTION_COMMAND") or shutil.which("agy") or str(_HOME / ".local" / "bin" / "agy")


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env["AGY_CLI_DISABLE_AUTO_UPDATE"] = "true"
    env["PATH"] = str(_HOME / ".local" / "bin") + os.pathsep + env.get("PATH", "")
    return env


def _split_model(model: str | None) -> tuple[str | None, str | None]:
    """'gemini-4-argon-high' is a listed slug and goes as is; an effort suffix is only split off when agy asks for it."""
    m = str(model or "").strip()
    return (m or None), None


def _make_client_class():
    from agent.copilot_acp_client import CopilotACPClient  # the engine's prompt bridge (tool calls in text)

    class AntigravityClient(CopilotACPClient):
        """Same facade as the engine's ACP bridge; the prompt goes to `agy` in print mode instead of an ACP session."""

        def _run_prompt(self, prompt_text: str, *, timeout_seconds: float, model: str | None = None) -> tuple[str, str]:
            work = Path(tempfile.mkdtemp(prefix="aqeelos-agy-"))
            log = work / "agy.log"
            agent_dir = work / ".agents" / "agents"
            agent_dir.mkdir(parents=True)
            (agent_dir / f"{AGENT_NAME}.md").write_text(AGENT_MD, encoding="utf-8")
            slug, effort = _split_model(model)
            args = [_agy_bin(self._acp_command if self._acp_command and "agy" in self._acp_command else None),
                    "--agent", AGENT_NAME, "--input-format", "stream-json", "--output-format", "stream-json",
                    "--disable-slash-commands", "--log-file", str(log),
                    "--print-timeout", f"{max(60, int(timeout_seconds or 900))}s"]
            if slug and slug not in ("antigravity", "antigravity-subscription"):
                args += ["--model", slug]
            if effort:
                args += ["--effort", effort]
            proc = subprocess.Popen(args, cwd=str(work), env=_env(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True, encoding="utf-8")
            with self._active_process_lock:
                self._active_processes.add(proc)
            conv_id, text, final, error, tool_seen = "", [], None, "", ""
            timer = threading.Timer(max(60.0, float(timeout_seconds or 900)) + 30, proc.kill)
            timer.start()
            try:
                proc.stdin.write(json.dumps({"event": "user", "message": {"content": prompt_text}}) + "\n")
                proc.stdin.close()
                for line in proc.stdout:
                    try:
                        ev = json.loads(line)
                    except ValueError:
                        continue
                    kind = ev.get("event")
                    if kind == "init":
                        # agy 1.4 lists its whole tool registry here even for the text-only agent, so the list
                        # proves nothing; what counts is a tool step (below), which ends the request at once
                        conv_id = str(ev.get("conversation_id") or "")
                        if (ev.get("init") or {}).get("agent") not in (None, AGENT_NAME):
                            tool_seen = "agy started a different agent (" + str((ev.get("init") or {}).get("agent")) + ")"
                            proc.kill()
                            break
                    elif kind == "step_update":
                        st = ev.get("step_update") or {}
                        if st.get("step_type") == "tool":
                            tool_seen = "agy tried to use its own tool " + str(st.get("tool_name") or "")
                            proc.kill()
                            break
                    elif kind == "result":
                        final = ev.get("result") or {}
                proc.wait(timeout=30)
            finally:
                timer.cancel()
                with self._active_process_lock:
                    self._active_processes.discard(proc)
                fell_back = log.exists() and bool(_FALLBACK_MARK.search(log.read_text(encoding="utf-8", errors="replace")))
                stderr = (proc.stderr.read() if proc.stderr else "")[-600:]
                shutil.rmtree(work, ignore_errors=True)
                if conv_id:   # agy's own copy of the conversation: aqeelOS keeps the chat, agy keeps nothing
                    for p in (_AGY_HOME / "conversations").glob(f"{conv_id}*"):
                        with contextlib.suppress(Exception):
                            shutil.rmtree(p) if p.is_dir() else p.unlink()
            if tool_seen:
                raise RuntimeError("Stopped for safety: " + tool_seen + ".")
            if fell_back:
                raise RuntimeError("Stopped for safety: agy could not load its text-only setup and fell back to its default agent.")
            if not final:
                raise RuntimeError("Antigravity gave no answer" + (f": {stderr.strip()}" if stderr.strip() else "."))
            if str(final.get("status")) != "SUCCESS":
                msg = str(final.get("error") or final.get("status") or "unknown error")
                if re.search(r"auth|sign.?in", msg, re.I):
                    msg += " (sign in again on Models › Accounts)"
                raise RuntimeError("Antigravity: " + msg)
            return str(final.get("response") or "").strip(), ""

        def list_models(self, *, timeout_seconds: float = 30.0) -> list[str]:
            r = subprocess.run([_agy_bin(None), "models"], capture_output=True, text=True, timeout=timeout_seconds,
                               env=_env(), cwd=str(_HOME))
            if r.returncode != 0:
                return []
            out = []
            for line in r.stdout.splitlines():
                m = re.match(r"^\s*[-*•]?\s*([a-z0-9][a-z0-9.\-]+[a-z0-9])\b", line.strip())
                if m and re.search(r"gemini|claude|gpt", m.group(1)):
                    out.append(m.group(1))
            return list(dict.fromkeys(out))

    return AntigravityClient


class AntigravitySubscriptionProfile(ProviderProfile):
    """agy in print mode: an external process with its own Google sign-in, no REST models endpoint."""

    def create_client(self, **client_kwargs: Any) -> Any:
        client_kwargs.setdefault("command", _agy_bin(None))
        client_kwargs.setdefault("args", [])
        return _make_client_class()(**client_kwargs)

    def fetch_models(self, *, api_key: str | None = None, base_url: str | None = None, timeout: float = 30.0) -> list[str] | None:
        try:
            return self.create_client().list_models(timeout_seconds=timeout) or None
        except Exception:
            return None


profile = AntigravitySubscriptionProfile(
    name="antigravity-subscription",
    aliases=("antigravity", "google-ai-pro"),
    display_name="Google AI Pro (Antigravity)",
    description="Gemini and Claude through your Google AI Pro or Ultra plan, via Google's official agy tool",
    signup_url="https://antigravity.google",
    api_mode="chat_completions",
    env_vars=(),
    base_url="acp://antigravity",
    auth_type="external_process",
    supports_health_check=False,
    process_command="agy",
    process_args=(),
    process_command_env_vars=("ANTIGRAVITY_SUBSCRIPTION_COMMAND",),
    fallback_models=("gemini-3.8-flash-high", "gemini-3.8-flash-medium"),
)

register_provider(profile)
