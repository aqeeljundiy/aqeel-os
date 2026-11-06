// Engine fixes from the 5 Nov 2026 audit, applied by apply-skill-patches.mjs on every deploy and engine update. Each
// fix has its own tag, is made all or nothing, and leaves the engine's file alone (with a warning) when the engine
// changed upstream. To test on copies: node scripts/engine-fixes-patch.mjs <engine folder> <out folder>
//
// 1) aqeelos:gateway-real-home. A chat run started inside a tool command (Donna's background loops run
//    `aqeelos -p <agent> chat` from her terminal) that finds no engine running, as during a restart, starts one
//    itself. It handed that engine the tool commands' home (~/.hermes/home), where Claude Code has no login, so
//    every agent lost Claude until the next restart (11:56 to 12:08 on 5 Nov). The engine it starts always gets
//    the account's real home, like the one aqeelOS starts.
// 2) aqeelos:backup-note-owner. "(Answered with GPT, Claude was down.)" went out on every channel, also to customers
//    through the WhatsApp support agents. It is now only added in chats with people who run the agents: the
//    aqeelOS chat, Telegram, Slack and Discord. Never on WhatsApp (customers write there), webhooks, schedules or
//    command-line runs.
// 3) aqeelos:quiet-usage-sync. Every agent with its own user wrote "sync_back: conflict on .../skills/.usage.json" to the
//    error log every minute (1,215 times on 5 Nov), burying real errors. That file only counts skill use, so the
//    last write winning is fine; its conflicts are now logged at debug level. Other files still warn.
// 4) aqeelos:turn-retry-once (brief item 7, 5 Nov 2026). A chat turn that failed before anything ran (the plain "Your
//    request was not processed" case: no tool was called) is tried once more by itself after a short wait, when the
//    cause can pass (a model or network error, not a chat that is too long, not the person sending a new message).
//    A turn where something already ran ("This turn did not complete") is never repeated. When it still fails, the
//    person gets the cause in plain words instead of the stock line. Every failed chat turn adds one line to
//    ~/.hermes/logs/aqeelos-dropped.jsonl (agent, channel, cause, retried, recovered), which System > Health counts.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

export const FIXES=[
 {tag:'aqeelos:gateway-real-home',name:'engine copies get the real home',file:'hermes_cli/gateway_runtime_start.py',edits:[
  {why:'the started engine\'s environment',
   from:'    env.update(HERMES_HOME=str(home), HERMES_GATEWAY_DETACHED="1", PYTHONIOENCODING="utf-8")\n',
   to:`    env.update(HERMES_HOME=str(home), HERMES_GATEWAY_DETACHED="1", PYTHONIOENCODING="utf-8")
    # aqeelos:gateway-real-home: a client started inside a tool command has the tools' HOME; the engine it starts
    # needs the account's own (Claude Code's login, git and ssh settings live there)
    try:
        import pwd as _aq_pwd
        _aq_real = env.get("HERMES_REAL_HOME") or _aq_pwd.getpwuid(os.getuid()).pw_dir
        if _aq_real and os.path.isdir(_aq_real):
            env["HOME"] = _aq_real
    except Exception:
        pass
`}]},
 {tag:'aqeelos:backup-note-owner',name:'backup-model note only in owner chats',file:'agent/turn_finalizer.py',edits:[
  {why:'the backup-model note',
   from:'        if isinstance(_aq_fb, (list, tuple)) and len(_aq_fb) == 2 and isinstance(final_response, str) and final_response.strip():\n',
   to:`        # aqeelos:backup-note-owner: only where the people running the agents read it, never to customers
        _aq_where = str(platform or getattr(agent, "platform", "") or "").lower()
        if _aq_where in ("api_server", "telegram", "slack", "discord") and isinstance(_aq_fb, (list, tuple)) and len(_aq_fb) == 2 and isinstance(final_response, str) and final_response.strip():\n`}]},
 {tag:'aqeelos:quiet-usage-sync',name:'skill counter sync stays out of the error log',file:'tools/environments/file_sync.py',edits:[
  {why:'the sync conflict warning',
   from:'        if pushed_hash is not None and os.path.exists(host_path) and _sha256_file(host_path) != pushed_hash:\n            logger.warning(\n',
   to:`        if pushed_hash is not None and os.path.exists(host_path) and _sha256_file(host_path) != pushed_hash:
            # aqeelos:quiet-usage-sync: skills/.usage.json only counts skill use; last write wins without a warning
            (logger.debug if remote_path.endswith("/.usage.json") else logger.warning)(\n`}]},
 {tag:'aqeelos:turn-retry-once',name:'a failed chat turn is tried once more, with a plain reason',file:'gateway/run_turn.py',edits:[
  {why:'the helpers',
   from:'    return any(p in err for p in _CONTEXT_OVERFLOW_ERROR_PHRASES) or ("400" in err and history_len > 50)\n',
   to:`    return any(p in err for p in _CONTEXT_OVERFLOW_ERROR_PHRASES) or ("400" in err and history_len > 50)


# aqeelos:turn-retry-once: one more try for a chat turn that failed before anything ran, a plain reason when it still
# fails, and one log line per failed turn (aqeelOS counts them on System > Health)
_AQ_RETRY_WAIT = 8.0
_AQ_LOG_DIR = None  # ~/.hermes/logs (tests point it elsewhere)
_AQ_NO_RETRY = frozenset({"context_overflow", "payload_too_large", "truncated", "session_busy", "billing",
                          "auth_permanent", "content_policy_blocked", "model_entitlement", "provider_policy_blocked",
                          "data_policy_denied", "ssl_cert_verification", "model_not_found", "format_error",
                          "interpreter_shutdown"})
_AQ_PLAIN = (
    (("rate_limit", "upstream_rate_limit", "overloaded", "server_error", "timeout", "gateway_connection",
      "empty_response", "invalid_response", "incomplete_response", "upstream_blocked"), "My AI model did not answer in time"),
    (("auth", "auth_permanent", "billing", "model_entitlement"), "My AI account needs attention from the owner"),
    (("context_overflow", "payload_too_large"), "This chat has grown too long for me to read in one go"),
    (("interpreter_shutdown", "host_error"), "The system restarted while I was working on it"),
    (("session_busy",), "I was still busy with your previous message"),
)


def _aq_reason(agent_result):
    return str((agent_result or {}).get("failure_reason") or "unknown")


def _aq_plain_reason(agent_result):
    r = _aq_reason(agent_result)
    for codes, text in _AQ_PLAIN:
        if r in codes:
            return text
    return "Something went wrong on my side while I was answering"


def _aq_should_retry(agent_result, partial, history_len):
    """Only a turn that failed before any tool ran, for a cause that can pass by itself."""
    if not isinstance(agent_result, dict) or not agent_result.get("failed") or partial:
        return False
    if agent_result.get("interrupted") or agent_result.get("already_sent") or agent_result.get("_aq_retried"):
        return False
    if agent_result.get("failure_retryable") is False or _aq_reason(agent_result) in _AQ_NO_RETRY:
        return False
    return not is_context_overflow_failure_result(agent_result, history_len)


def _aq_note_dropped(session_key, platform, agent_result, *, partial, retried, recovered):
    """One line per failed chat turn, for aqeelOS (never fails the turn)."""
    try:
        parts = str(session_key or "").split(":")
        agent = parts[1] if len(parts) > 2 and parts[0] == "agent" else "default"
        logs = _AQ_LOG_DIR or os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "logs")
        os.makedirs(logs, exist_ok=True)
        line = json.dumps({"t": time.time(), "agent": agent, "platform": str(platform or ""), "reason": _aq_reason(agent_result),
                           "partial": bool(partial), "retried": bool(retried), "recovered": bool(recovered)})
        with open(os.path.join(logs, "aqeelos-dropped.jsonl"), "a", encoding="utf-8") as f:
            f.write(line + "\\n")
    except Exception:
        logger.debug("aqeelos: could not note a failed turn", exc_info=True)


async def _aq_retry_once(agent_result, run, *, history_len, partial_of, is_current, session_key, platform, wait=None):
    """Run the turn once more when it failed before anything ran; note every failed turn."""
    if not isinstance(agent_result, dict) or not agent_result.get("failed") or agent_result.get("interrupted"):
        return agent_result
    partial = partial_of(agent_result)
    if not _aq_should_retry(agent_result, partial, history_len) or not is_current():
        _aq_note_dropped(session_key, platform, agent_result, partial=partial, retried=False, recovered=False)
        return agent_result
    logger.info("aqeelos: turn failed before anything ran (%s); trying it once more", _aq_reason(agent_result))
    await asyncio.sleep(_AQ_RETRY_WAIT if wait is None else wait)
    if not is_current():
        _aq_note_dropped(session_key, platform, agent_result, partial=partial, retried=False, recovered=False)
        return agent_result
    second = await run()
    ok = isinstance(second, dict) and not second.get("failed")
    if isinstance(second, dict) and not second.get("interrupted"):
        if not ok:
            second["_aq_retried"] = True
        _aq_note_dropped(session_key, platform, agent_result if ok else second, partial=partial_of(second) if not ok else False,
                         retried=True, recovered=ok)
    return second


def _aq_failed_reply(response, agent_result, notice, add_notice):
    """The person's reply for a failed turn: the cause in plain words, and whether sending it again is safe."""
    if notice == PARTIAL_FAILED_TURN_NOTICE:
        plain = _aq_plain_reason(agent_result) + ". Part of it may already be done, so check that before sending it again."
    elif (agent_result or {}).get("_aq_retried"):
        plain = _aq_plain_reason(agent_result) + ". I tried once more by myself and it failed again. Nothing was done yet, so please send it again in a few minutes."
    else:
        plain = _aq_plain_reason(agent_result) + ". Nothing was done yet, so you can send it again."
    out = add_notice(response, plain)
    if (agent_result or {}).get("_aq_retried") and "I tried once more" not in out:
        out = out + "\\n\\n(I tried once more by myself and it failed again.)"
    return out
`},
  {why:'the turn run',
   from:'            agent_result = await self._run_agent(\n',
   to:'            async def _aq_run_once():  # aqeelos:turn-retry-once (the same turn, run again when it failed before anything ran)\n              return await self._run_agent(\n'},
  {why:'the retry after the turn',
   from:'            _turn_seconds = time.monotonic() - _turn_started_monotonic\n',
   to:`            agent_result = await _aq_run_once()
            agent_result = await _aq_retry_once(
                agent_result, _aq_run_once, history_len=len(history),
                partial_of=lambda r: self._hmwa_failed_turn_notice(r) == PARTIAL_FAILED_TURN_NOTICE,
                is_current=lambda: self._is_session_run_current(_quick_key, run_generation),
                session_key=session_key, platform=_platform_name)
            _turn_seconds = time.monotonic() - _turn_started_monotonic
`},
  {why:'the failed-turn reply',
   from:'                response = self._hmwa_add_failed_turn_notice(response, self._hmwa_failed_turn_notice(agent_result))\n',
   to:'                response = _aq_failed_reply(response, agent_result, self._hmwa_failed_turn_notice(agent_result), self._hmwa_add_failed_turn_notice)\n'}]}];

// one engine file's text → {out (null when nothing changed), applied:[names], errors:[text]}
export function fixFile(file,src){let out=src;const applied=[],errors=[];
 for(const f of FIXES.filter(x=>x.file===file)){if(out.includes(f.tag))continue;let next=out,bad=null;
  for(const e of f.edits){if(next.split(e.from).length!==2){bad=f.name+': the place for '+e.why+' changed upstream';break}next=next.replace(e.from,()=>e.to)}
  if(bad)errors.push(bad);else{out=next;applied.push(f.name)}}
 return {out:applied.length?out:null,applied,errors}}
export const FILES=[...new Set(FIXES.map(f=>f.file))];

if(import.meta.url===`file://${process.argv[1]}`){const [,,engine,outDir]=process.argv;let bad=0;
 for(const f of FILES){const src=await readFile(path.join(engine,f),'utf8'),r=fixFile(f,src);for(const e of r.errors){console.error('✗ '+e);bad++}
  const o=path.join(outDir,f);await mkdir(path.dirname(o),{recursive:true});await writeFile(o,r.out??src);console.log(f+': '+(r.applied.join(', ')||'nothing to change'))}
 process.exit(bad?1:0)}
