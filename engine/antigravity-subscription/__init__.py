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
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

try:
    from .reply_fix import clean as _clean, whole as _whole, retry_note as _retry_note, with_retries as _with_retries
except ImportError:  # loaded as a plain module (the engine's plugin loader or a test)
    from reply_fix import clean as _clean, whole as _whole, retry_note as _retry_note, with_retries as _with_retries
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
mention tools such as files, terminal or browsing. Names like tool_search, tool_describe and tool_call in the prompt are
not tools you can run: they only exist as text you write in the <tool_call> format. Everything you need is in the prompt. When the prompt describes
tools and how to call them, reply exactly in that format; aqeelOS runs them and gives you the results.
"""
_HOME = Path(os.path.expanduser("~"))
_AGY_HOME = _HOME / ".gemini" / "antigravity-cli"
_FALLBACK_MARK = re.compile(r"not found, falling back to default", re.I)


def _agy_bin(command: str | None) -> str:
    return command or os.getenv("ANTIGRAVITY_SUBSCRIPTION_COMMAND") or shutil.which("agy") or str(_HOME / ".local" / "bin" / "agy")


# More than one Google account (aqeelOS, 20 Nov 2026): agy keeps one sign-in per home folder. aqeelOS lists the extra ones in
# ~/.gemini/aqeelos-accounts.json ({"accounts": [{"id", "label", "home"}]}); a request goes to the signed-in account used least,
# and an account that says it is out of quota rests for an hour while the request moves on to the next one.
_ACCTS = _HOME / ".gemini" / "aqeelos-accounts.json"
_STATE = _HOME / ".gemini" / "aqeelos-agy-state.json"
# agy refuses a model this account's plan does not have (21 Nov 2026: a second Google sign-in on the free Starter quota had no
# gemini-4-neon-high; agy quit before reading the prompt, every request broke with "Broken pipe" and Gemini looked down for all)
_MODEL_MISSING = re.compile(r"invalid model selection|not recognized as a known model", re.I)
_QUOTA = re.compile(r"quota|rate.?limit|resource.?exhausted|\b429\b|too many requests|usage limit|limit (reached|exceeded)|exhausted", re.I)
_state_lock = threading.Lock()
# the account each thread's last call went to, read by aqeelos-live's usage ledger
AQEELOS_LAST_ACCOUNT: dict = {}


def _chosen() -> str:
    """the Google account aqeelOS chose for this agent (Models › Accounts, like Claude accounts): <agent home>/aqeelos-model-accounts.json"""
    try:
        from hermes_constants import get_hermes_home
        home = Path(get_hermes_home())
    except Exception:
        home = Path(os.environ.get("HERMES_HOME") or _HOME / ".hermes")
    try:
        return str(json.loads((home / "aqeelos-model-accounts.json").read_text()).get("antigravity-subscription") or "")
    except Exception:
        return ""


def _agy_dir(home: Path) -> Path:
    return home / ".gemini" / "antigravity-cli"


def _accounts() -> list[dict]:
    """main first, then every extra account that is signed in (its folder holds a sign-in) and not still being set up."""
    out = [{"id": "main", "home": _HOME}]
    try:
        for a in json.loads(_ACCTS.read_text()).get("accounts") or []:
            home = Path(str(a.get("home") or ""))
            if re.fullmatch(r"g[0-9a-f]{6}", str(a.get("id") or "")) and not a.get("pending") and (_agy_dir(home) / "antigravity-oauth-token").exists():
                out.append({"id": a["id"], "home": home})
    except Exception:
        pass
    return out


def _read_state() -> dict:
    try:
        return json.loads(_STATE.read_text())
    except Exception:
        return {}


def _write_state(change) -> None:
    with _state_lock:
        st = _read_state()
        change(st)
        with contextlib.suppress(Exception):
            _STATE.write_text(json.dumps(st))


def order_accounts(accounts: list[dict], state: dict, now: float) -> list[dict]:
    """resting accounts last (soonest back first); the rest least used first, by today's count."""
    cool, used = state.get("cool") or {}, (state.get("used") or {}).get(time.strftime("%Y-%m-%d", time.gmtime(now))) or {}
    fresh = [a for a in accounts if float(cool.get(a["id"], 0)) <= now]
    rest = sorted([a for a in accounts if float(cool.get(a["id"], 0)) > now], key=lambda a: float(cool.get(a["id"], 0)))
    return sorted(fresh, key=lambda a: int(used.get(a["id"], 0))) + rest


def prefer(accounts: list[dict], pick: str, state: dict, now: float) -> list[dict]:
    """the account aqeelOS chose goes first, unless it is resting (out of quota): then the order stays as it is"""
    if not pick or float((state.get("cool") or {}).get(pick, 0)) > now:
        return accounts
    return sorted(accounts, key=lambda a: 0 if a["id"] == pick else 1)


def _env(home: Path | None = None) -> dict[str, str]:
    env = dict(os.environ)
    if home is not None and home != _HOME:
        env["HOME"] = str(home)
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
            # a stop because Gemini reached for an agy tool of its own is tried once more, told to write the call as text
            # (reply_fix.retry_note, 19 Nov 2026); every other stop, and a second one, still ends the request
            # up to two more tries: one was not enough on 19 Nov 2026 (the schedule still failed after it); reply_fix.with_retries
            accts = order_accounts(_accounts(), _read_state(), time.time())
            accts = prefer(accts, _chosen(), _read_state(), time.time())   # aqeelOS decides; the order above is the safety net
            for n, acct in enumerate(accts):
                try:
                    out = _with_retries(lambda t: self._run_once(t, timeout_seconds=timeout_seconds, model=model, home=acct["home"]), prompt_text)
                except RuntimeError as e:
                    # which account failed and why, always (21 Nov 2026: only the last account's error reached the log,
                    # so a quota message from one account hid what the other said)
                    logging.getLogger("aqeelos.antigravity").warning("aqeelos-agy-account-failed account=%s model=%s error=%s", acct["id"], model, str(e)[:300])
                    # out of quota: rests an hour; an extra account whose sign-in stopped working: rests 6 hours (Models › Accounts says so)
                    # a model this account's plan does not offer: rests 6 hours and the request goes on to the next account
                    rest = 3600 if _QUOTA.search(str(e)) else 6 * 3600 if _MODEL_MISSING.search(str(e)) or acct["id"] != "main" and re.search(r"auth|sign.?in|unauthori[sz]ed|\b401\b", str(e), re.I) else 0
                    if n + 1 < len(accts) and rest:
                        _write_state(lambda st: st.setdefault("cool", {}).__setitem__(acct["id"], time.time() + rest))
                        continue
                    raise
                day = time.strftime("%Y-%m-%d", time.gmtime())
                _write_state(lambda st: st.__setitem__("used", {day: {**((st.get("used") or {}).get(day) or {}), acct["id"]: int(((st.get("used") or {}).get(day) or {}).get(acct["id"], 0)) + 1}}))
                AQEELOS_LAST_ACCOUNT[threading.get_ident()] = acct["id"]
                if len(AQEELOS_LAST_ACCOUNT) > 256:
                    AQEELOS_LAST_ACCOUNT.clear()
                return out
            raise RuntimeError("Antigravity: no Google account is signed in.")

        def _run_once(self, prompt_text: str, *, timeout_seconds: float, model: str | None = None, home: Path | None = None) -> tuple[str, str]:
            home = home or _HOME
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
            proc = subprocess.Popen(args, cwd=str(work), env=_env(home), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True, encoding="utf-8")
            with self._active_process_lock:
                self._active_processes.add(proc)
            conv_id, steps, final, error, tool_seen = "", {}, None, "", ""
            timer = threading.Timer(max(60.0, float(timeout_seconds or 900)) + 30, proc.kill)
            timer.start()
            try:
                try:
                    proc.stdin.write(json.dumps({"event": "user", "message": {"content": prompt_text}}) + "\n")
                    proc.stdin.close()
                except BrokenPipeError:
                    # agy quit before reading the prompt; its own reason is in its output, read below (21 Nov 2026)
                    with contextlib.suppress(Exception):
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
                        if st.get("step_type") == "agent_response" and st.get("text_delta"):
                            steps[st.get("step_index", 0)] = steps.get(st.get("step_index", 0), "") + str(st["text_delta"])
                        # manage_task is agy's own to-do list for the turn (no files, commands or web): Claude models
                        # use it to plan. It is one of the four tools agy cannot drop, and it is the only one let through.
                        name = str(st.get("tool_name") or (st.get("tool_info") or {}).get("name") or "")
                        if st.get("step_type") == "tool" and name not in ("manage_task",):
                            tool_seen = "agy tried to use its own tool " + name
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
                    agy_home = _agy_dir(home)
                    for p in [*(agy_home / "conversations").glob(f"{conv_id}*"), *(agy_home / "brain").glob(f"{conv_id}*"), *(agy_home / "annotations").glob(f"{conv_id}*")]:
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
            # the whole answer from every text step (agy's result can hold only the last one), without Gemini's markers (reply_fix.py)
            return _clean(_whole(steps, str(final.get("response") or "")).strip()), ""

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
