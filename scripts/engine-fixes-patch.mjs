// Engine fixes from the 5 Nov 2026 audit, applied by apply-skill-patches.mjs on every deploy and engine update. Each
// fix has its own tag, is made all or nothing, and leaves the engine's file alone (with a warning) when the engine
// changed upstream. To test on copies: node scripts/engine-fixes-patch.mjs <engine folder> <out folder>
//
// 1) aqeelos:gateway-real-home. A chat run started inside a tool command (Dora's background loops run
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
// 5) aqeelos:clone-no-bot-tokens (6 Nov 2026). A cloned agent dropped the channel keys the engine knows by prefix
//    (TELEGRAM_..., SLACK_...), but kept bot tokens saved under another name (COVE_SUPPORT_BOT_TOKEN), so two agents
//    polled one Telegram bot and kicked each other off. Every ..._BOT_TOKEN / ..._APP_TOKEN key now counts as a channel
//    key when an agent is cloned: one bot token belongs to one agent.
// 6) aqeelos:phone-redaction-setting (6 Nov 2026). The engine masked every +E.164 phone number in tool output and
//    messages (+628****3124) as part of secret redaction, so support agents could not see their own customers' numbers
//    (Kirimdev itself returns them in full) and asked the team or guessed. Phone masking is now its own per-agent
//    setting, security.redact_phone_numbers (default true, so a fresh install stays safe); keys and tokens are still
//    always redacted. aqeelOS turns it off for agents that work with customers' numbers.
// 7) aqeelos:replaced-db-log-once (7 Nov 2026). "FATAL: state.db was replaced underneath the gateway" was written on
//    every write attempt, not once as the engine means it: 4,400 lines on 6 Nov from 15:00 to 23:32 WIB, every
//    2.5 to 5 s, burying real errors. Each burst began the moment a deploy check deleted its throwaway agent while the
//    engine still held that agent's database (leadtestp54va 08:14, pc-r* 09:06-09:11, dp-mw5* 14:11-14:13 UTC); no
//    live agent's database was replaced and no transcript was diverted. It is now logged once per database, with its
//    path, and as a warning when the file is simply gone (a deleted agent). Writes are still refused.
// 8) aqeelos:oauth-keep-tokens-same-client (7 Nov 2026). Dora's three Slack apps lost their sign-ins at 01:41 UTC and
//    again at 05:24 UTC ("configured OAuth client changed (client_id 'X' -> 'X'); discarded tokens"). The client id was
//    the same; only the saved secret differed, because one engine path saved the secret unexpanded
//    ("\${SLACK_AS2_CLIENT_SECRET}") and the next saw the real value. Tokens belong to the client id, so only a different
//    client id discards them now, and an unexpanded \${...} secret is filled from the environment or keeps the saved one.
// 9) aqeelos:no-review-pings (7 Nov 2026). "💾 Self-improvement review: ..." summaries went to the chat (Telegram,
//    WhatsApp, Slack) after turns. The owner's rule of 7 Nov: nobody is messaged about fixes. The review still runs; its
//    summary still shows to a local viewer (review.summary frame) and is logged, but is never sent to a chat platform.
// 10) aqeelos:hold-inbound-during-restart (7 Nov 2026). When the engine stops it removes each channel's message handler
//    at once, but Telegram keeps polling for ~17 s more; a message that arrived then was thrown away ("Dropping inbound
//    message: no gateway message handler": the owner's message to cove-threads at 06:12:49 UTC). Telegram counts it
//    as delivered, so it never came back. Now such a message is saved in ~/.hermes/aqeelos-held-inbound/ and handled
//    by the next engine (on its first message, or 45 s after its handler is set).
// 11) aqeelos:telegram-media-retry (7 Nov 2026). Voice notes and photos often failed to download ("Failed to cache
//    voice: Timed out", httpx ReadTimeout at the 20 s default, over the box's VPN), and the agent got "could not be
//    downloaded". Every Telegram file lookup and download now waits 60 s or more (by file size) and tries 3 times.
// 12) aqeelos:audio-stt + aqeelos:audio-stt-route (7 Nov 2026). A replied-to or forwarded voice note arrives as an
//    audio file, which the engine never transcribed: the agent got only a path, and an agent with its own Linux user
//    cannot run speech-to-text ("I can't hear the voice note"). Audio messages are now transcribed like voice notes,
//    and the agent still gets the file. Documents stay files.
// 13) aqeelos:mcp-auth-park-fast (7 Nov 2026). Higgsfield was on 9 agents with no sign-in. At every engine start each
//    copy answered 401, but wrapped in "both transports failed", so the engine tried it 3 times (~11 s) per agent, one
//    after another, before it started Telegram: channels came back 2.5 minutes late. A wrapped 401/403 now parks at once.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

export const FIXES=[
 {tag:'aqeelos:mcp-auth-park-fast',name:'a tool server that answers 401/403 at start is parked at once, not tried 3 times',file:'tools/mcp_tool_errors.py',edits:[
  {why:'the failure classifier',
   from:'                 or getattr(getattr(root, "response", None), "status_code", None) in (401, 403))\n    return "permanent" if permanent else "transient"\n',
   to:`                 or getattr(getattr(root, "response", None), "status_code", None) in (401, 403))
    # aqeelos:mcp-auth-park-fast: a 401/403 wrapped in "both Streamable HTTP and SSE transports failed" was retried 3
    # times per agent (~11 s each) before the engine started its channels (7 Nov 2026: Higgsfield on 9 agents
    # without a sign-in, Telegram 2.5 minutes late). Look through the chain and the message too.
    if not permanent:
        _aq_node, _aq_n = root, 0
        while _aq_node is not None and _aq_n < 8 and not permanent:
            permanent = getattr(getattr(_aq_node, "response", None), "status_code", None) in (401, 403)
            _aq_node = getattr(_aq_node, "__cause__", None) or getattr(_aq_node, "__context__", None)
            _aq_n += 1
        if not permanent and re.search(r"\\bHTTP (401|403) from (POST|GET) ", str(root)):
            permanent = True
    return "permanent" if permanent else "transient"
`}]},
 {tag:'aqeelos:telegram-media-retry',name:'Telegram voice notes and photos download with a longer wait and retries',file:'plugins/platforms/telegram/adapter.py',edits:[
  {why:'the media download calls',
   from:'    from telegram.request import HTTPXRequest\n    TELEGRAM_AVAILABLE = True\n',
   to:`    from telegram.request import HTTPXRequest
    TELEGRAM_AVAILABLE = True

    # aqeelos:telegram-media-retry: every get_file() / download_as_bytearray() in this adapter used the 20 s default
    # read timeout once; on the box's VPN a voice note or photo often needs longer ("Failed to cache voice: Timed out")
    def _aq_patch_media_downloads():
        import telegram as _tg
        from telegram.error import BadRequest as _BR, NetworkError as _NE
        try:
            from telegram._files._basemedium import _BaseMedium as _BM
        except Exception:
            _BM = None
        if getattr(_tg.File, "_aq_media_retry", False):
            return

        def _timeout_for(size):  # 60 s, plus a second per 50 KB beyond ~1.5 MB, at most 5 minutes
            return max(60.0, min(300.0, 30.0 + float(size or 0) / 50_000.0))

        def _wrap(orig, size_of, what):
            async def wrapped(self, *args, **kwargs):
                kwargs.setdefault("read_timeout", _timeout_for(size_of(self)))
                kwargs.setdefault("connect_timeout", 20.0)
                delay = 2.0
                for attempt in range(3):
                    try:
                        return await orig(self, *args, **kwargs)
                    except _BR:
                        raise
                    except _NE as exc:
                        if attempt == 2:
                            raise
                        logger.warning("[Telegram] %s try %d failed (%s); trying again in %.0f s", what, attempt + 1, exc, delay)
                        await asyncio.sleep(delay)
                        delay *= 2.5
            wrapped._aq_orig = orig
            return wrapped
        _tg.File.download_as_bytearray = _wrap(_tg.File.download_as_bytearray, lambda s: getattr(s, "file_size", 0), "media download")
        if _BM is not None:
            _BM.get_file = _wrap(_BM.get_file, lambda s: 0, "media lookup")
        _tg.File._aq_media_retry = True
    _aq_patch_media_downloads()
`}]},
 {tag:'aqeelos:audio-stt',name:'replied-to and forwarded voice and audio are transcribed like voice notes',file:'gateway/run.py',edits:[
  {why:'which audio goes to speech-to-text',
   from:'    if message_type in {MessageType.AUDIO, MessageType.DOCUMENT}:\n        return False\n    return message_type == MessageType.VOICE or _event_media_type_at(event, index).startswith("audio/")\n',
   to:`    # aqeelos:audio-stt: an audio message (a replied-to or forwarded voice note, an .ogg) is transcribed too; the
    # agent still gets the file. Agents with their own Linux user cannot run speech-to-text themselves.
    if message_type == MessageType.DOCUMENT:
        return False
    if message_type == MessageType.AUDIO:
        _aq_mt = _event_media_type_at(event, index)
        return not _aq_mt or _aq_mt.startswith("audio/")
    return message_type == MessageType.VOICE or _event_media_type_at(event, index).startswith("audio/")
`}]},
 {tag:'aqeelos:audio-stt-route',name:'an audio file is both transcribed and handed over as a file',file:'gateway/run_inbound.py',edits:[
  {why:'the inbound media split',
   from:'                if event.message_type in {MessageType.AUDIO, MessageType.DOCUMENT}:\n                    audio_file_paths.append(path)\n                elif not pending_stt_prepared and _event_media_is_stt_input(event, i):\n                    audio_paths.append(path)\n',
   to:`                if event.message_type in {MessageType.AUDIO, MessageType.DOCUMENT}:
                    audio_file_paths.append(path)
                # aqeelos:audio-stt-route: an audio message is transcribed as well (documents are not, see run.py)
                if not pending_stt_prepared and _event_media_is_stt_input(event, i):
                    audio_paths.append(path)
`}]},
 {tag:'aqeelos:hold-inbound-during-restart',name:'a message that arrives while the engine stops is kept and handled after the restart',file:'gateway/platforms/base.py',edits:[
  {why:'the no-handler drop',
   from:'            if not getattr(self, "_no_message_handler_logged", False):\n                self._no_message_handler_logged = True\n                logger.error(\n                    "[%s] Dropping inbound message: no gateway message handler "\n                    "is installed on this adapter. The adapter is connected and "\n                    "can send, but every inbound message is discarded.",\n                    self.name,\n                )\n            return\n',
   to:`            # aqeelos:hold-inbound-during-restart: kept on disk and handled by the next engine, never dropped
            if _aq_hold_inbound(self, event):
                return
            if not getattr(self, "_no_message_handler_logged", False):
                self._no_message_handler_logged = True
                logger.error(
                    "[%s] Dropping inbound message: no gateway message handler "
                    "is installed on this adapter. The adapter is connected and "
                    "can send, but every inbound message is discarded.",
                    self.name,
                )
            return
        _aq_replay_soon(self)
`},
  {why:'the handler setter',
   from:'        """Set the incoming-message handler (MessageEvent -> optional response str)."""\n        self._message_handler = handler\n',
   to:`        """Set the incoming-message handler (MessageEvent -> optional response str)."""
        self._message_handler = handler
        if handler is not None:  # aqeelos:hold-inbound-during-restart
            try:
                asyncio.get_running_loop().call_later(45, _aq_replay_soon, self)
            except RuntimeError:
                pass
`},
  {why:'the hold and replay helpers',
   from:'from gateway.platforms.base_log_safety import safe_url_for_log\n',
   to:`from gateway.platforms.base_log_safety import safe_url_for_log


# aqeelos:hold-inbound-during-restart: messages that reach an adapter with no handler (the engine is stopping)
_AQ_HELD_DIR = os.path.join(os.path.expanduser("~"), ".hermes", "aqeelos-held-inbound")
_AQ_HELD_MAX_AGE = 6 * 3600


def _aq_held_file(adapter):
    cfg = getattr(adapter, "config", None)
    tok = (getattr(cfg, "token", None) or getattr(cfg, "api_key", None) or "") if cfg is not None else ""
    if not tok:
        return None  # only adapters with their own bot identity: the next engine replays into the same bot
    import hashlib
    plat = getattr(getattr(adapter, "platform", None), "value", None) or str(getattr(adapter, "platform", ""))
    key = hashlib.sha256(("%s:%s" % (plat, tok)).encode()).hexdigest()[:16]
    return os.path.join(_AQ_HELD_DIR, "%s-%s.pickle-lines" % (plat, key))


def _aq_hold_inbound(adapter, event):
    try:
        f = _aq_held_file(adapter)
        if not f or getattr(event, "internal", False):
            return False
        import base64, dataclasses, pickle
        try:
            blob = pickle.dumps(event)
        except Exception:
            blob = pickle.dumps(dataclasses.replace(event, raw_message=None))
        os.makedirs(_AQ_HELD_DIR, mode=0o700, exist_ok=True)
        with open(f, "a", encoding="ascii") as fh:
            fh.write("%d %s\\n" % (int(time.time()), base64.b64encode(blob).decode("ascii")))
        logger.warning("[%s] Engine stopping: inbound message kept for the next engine (%s)", adapter.name, os.path.basename(f))
        return True
    except Exception:
        logger.warning("[%s] Could not keep an inbound message for the next engine", getattr(adapter, "name", "?"), exc_info=True)
        return False


def _aq_replay_soon(adapter):
    f = _aq_held_file(adapter)
    if not f or not os.path.exists(f) or not getattr(adapter, "_message_handler", None) or getattr(adapter, "_aq_replaying", False):
        return
    try:
        asyncio.get_running_loop().create_task(_aq_replay_held(adapter, f))
    except RuntimeError:
        pass


async def _aq_replay_held(adapter, f):
    adapter._aq_replaying = True
    try:
        work = f + ".replaying-%d" % os.getpid()
        try:
            os.rename(f, work)
        except OSError:
            return
        import base64, pickle
        n = 0
        with open(work, encoding="ascii") as fh:
            lines = fh.read().splitlines()
        for line in lines:
            try:
                ts, blob = line.split(" ", 1)
                if time.time() - int(ts) > _AQ_HELD_MAX_AGE:
                    continue
                event = pickle.loads(base64.b64decode(blob))
                await adapter.handle_message(event)
                n += 1
            except Exception:
                logger.warning("[%s] A kept inbound message could not be handled", adapter.name, exc_info=True)
        os.unlink(work)
        logger.warning("[%s] Handled %d inbound message(s) kept while the engine was stopping", adapter.name, n)
    finally:
        adapter._aq_replaying = False
`}]},
 {tag:'aqeelos:no-review-pings',name:'self-improvement review summaries stay out of chats',file:'gateway/run_turn_runner.py',edits:[
  {why:'the review summary delivery',
   from:'                return\n            if self._status_live():\n                self._send_status_text(\n                    message,\n                    _interim_metadata(_non_conversational_metadata(ctx._status_thread_metadata, platform=ctx.source.platform)),\n                    "background_review_callback scheduling error",\n                )\n',
   to:`                return
            # aqeelos:no-review-pings: never sent to a chat platform (owner's rule, 7 Nov 2026); logged instead
            import logging as _aq_logging
            _aq_logging.getLogger(__name__).info("background review summary kept out of the chat: %s", str(message)[:200])
            return
`}]},
 {tag:'aqeelos:oauth-keep-tokens-same-client',name:'OAuth sign-ins survive a re-saved client secret',file:'tools/mcp_oauth.py',edits:[
  {why:'the client-change check',
   from:'    if not old_client_id or (old_client_id == new_client_id and (existing.get("client_secret") or None) == (new_client_secret or None)):\n        return\n',
   to:`    # aqeelos:oauth-keep-tokens-same-client: tokens are minted for a client id; a re-saved or unexpanded secret for the
    # same id is not a new client (7 Nov 2026: Slack sign-ins were discarded for 'X' -> 'X')
    if not old_client_id or old_client_id == new_client_id:
        return
`},
  {why:'the saved client secret',
   from:'    info_cls = _sdk_class("OAuthClientInformationFull")\n    _invalidate_tokens_on_client_change(storage, client_id, cfg.get("client_secret"))\n',
   to:`    info_cls = _sdk_class("OAuthClientInformationFull")
    # aqeelos:oauth-keep-tokens-same-client: never save a \${VAR} placeholder as the secret
    _aq_secret = cfg.get("client_secret")
    if isinstance(_aq_secret, str) and "\${" in _aq_secret:
        import os as _aq_os, re as _aq_re
        _aq_secret = _aq_re.sub(r"\\$\\{(\\w+)\\}", lambda m: _aq_os.environ.get(m.group(1), m.group(0)), _aq_secret)
        if "\${" in _aq_secret:
            _aq_old = _read_json(storage._client_info_path())
            _aq_secret = (_aq_old.get("client_secret") if isinstance(_aq_old, dict) else None) or None
        cfg = {**cfg, "client_secret": _aq_secret}
    _invalidate_tokens_on_client_change(storage, client_id, cfg.get("client_secret"))
`}]},
 {tag:'aqeelos:replaced-db-log-once',name:'a replaced or deleted state.db is logged once, with its path',file:'hermes_state.py',edits:[
  {why:'the replaced-file halt',
   from:'        if self._db_replaced or self._db_file_was_replaced():\n            self._db_replaced = True\n            self._disable_close_time_checkpoint()\n            logger.error(_STATE_DB_REPLACED_MSG)\n            raise StateDbReplacedError(_STATE_DB_REPLACED_MSG)\n',
   to:`        if self._db_replaced or self._db_file_was_replaced():
            # aqeelos:replaced-db-log-once: once per database (it was every write, 4,400 lines on 6 Nov), with the path
            _aq_first = not self._db_replaced
            self._db_replaced = True
            self._disable_close_time_checkpoint()
            if _aq_first:
                if not os.path.exists(self.db_path):
                    logger.warning("state.db %s is gone (its agent was deleted) while this process still held it; "
                                   "writes to it are refused (logged once)", self.db_path)
                else:
                    logger.error("%s (%s)", _STATE_DB_REPLACED_MSG, self.db_path)
            raise StateDbReplacedError(_STATE_DB_REPLACED_MSG)
`}]},
 {tag:'aqeelos:platform-toolset-excludes',name:'per-channel exclusions keep customer webhooks free of admin tools',file:'hermes_cli/tools_config.py',edits:[
  {why:'subtract channel exclusions after resolving the full default set',
   from:'    if explicitly_configured and toolset_names:\n        _warn_all_invalid_platform_toolsets(platform, toolset_names)\n    return enabled_toolsets\n',
   to:`    # aqeelos:platform-toolset-excludes: exclusions never turn the default MCP set into an allowlist.
    _aq_excludes = (config.get("platform_toolset_excludes") or {}).get(platform, [])
    if _aq_excludes:
        from agent.skill_utils import parse_config_string_list
        _aq_names = [str(n).strip() for n in parse_config_string_list(_aq_excludes) if str(n).strip()]
        enabled_toolsets = _prune_toolsets_stripped_by_disabled(enabled_toolsets, _aq_names)
        enabled_toolsets -= {n[4:] if n.startswith("mcp-") else n for n in _aq_names}
    if explicitly_configured and toolset_names:
        _warn_all_invalid_platform_toolsets(platform, toolset_names)
    return enabled_toolsets
`}]},

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
   to:'                response = _aq_failed_reply(response, agent_result, self._hmwa_failed_turn_notice(agent_result), self._hmwa_add_failed_turn_notice)\n'}]},
 {tag:'aqeelos:phone-redaction-setting',name:'phone-number masking is its own per-agent setting',file:'agent/redact.py',edits:[
  {why:'the per-agent switch',
   from:'    with _REDACT_ENABLED_LOCK:\n        _REDACT_ENABLED_BY_HOME[home_key] = enabled\n    return enabled\n',
   to:`    with _REDACT_ENABLED_LOCK:
        _REDACT_ENABLED_BY_HOME[home_key] = enabled
    return enabled


# aqeelos:phone-redaction-setting: masking phone numbers is its own per-agent choice (security.redact_phone_numbers,
# default on), separate from secret redaction, so support agents can read their customers' numbers in full.
_REDACT_PHONES_BY_HOME: dict = {}


def _redact_phones_enabled() -> bool:
    try:
        from hermes_constants import hermes_home_key
        home_key = hermes_home_key()
    except Exception:
        home_key = ""
    cached = _REDACT_PHONES_BY_HOME.get(home_key)
    if cached is not None:
        return cached
    enabled = True
    try:
        from agent.secret_scope import current_secret_scope
        scope = current_secret_scope()
        raw = scope.get("HERMES_REDACT_PHONE_NUMBERS") if scope else None
        if raw is None:
            from hermes_cli.config import load_config_readonly
            cfg_val = (load_config_readonly().get("security") or {}).get("redact_phone_numbers")
            raw = None if cfg_val is None else str(cfg_val)
        if raw is not None:
            enabled = str(raw).strip().lower() in {"1", "true", "yes", "on"}
    except Exception:
        enabled = True  # unreadable setting: keep the safe default
    with _REDACT_ENABLED_LOCK:
        _REDACT_PHONES_BY_HOME[home_key] = enabled
    return enabled
`},
  {why:'the phone pass',
   from:'    if "+" in text:\n        text = _SIGNAL_PHONE_RE.sub(_redact_phone, text)\n\n    return text\n',
   to:'    if "+" in text and _redact_phones_enabled():  # aqeelos:phone-redaction-setting\n        text = _SIGNAL_PHONE_RE.sub(_redact_phone, text)\n\n    return text\n'}]},
 {tag:'aqeelos:clone-no-bot-tokens',name:'a cloned agent never gets another agent\'s bot token',file:'hermes_cli/profile_channels.py',edits:[
  {why:'the clone\'s .env filter',
   from:'        platform = index.platform_for(key) if key else None\n        if key is None or platform is None:\n            kept.append(line)\n',
   to:`        platform = index.platform_for(key) if key else None
        # aqeelos:clone-no-bot-tokens: a bot token saved under any name (CONTINUE_SUPPORT_BOT_TOKEN) is a channel identity too
        if platform is None and key and re.search(r"(^|_)(BOT|APP)_TOKEN(_|$)", key):
            platform = "bot_token"
        if key is None or platform is None:
            kept.append(line)
`}]},
 {tag:'aqeelos:hold-cron-for-restart',name:'no new scheduled runs while aqeelOS waits to restart the engine',file:'cron/scheduler_tick.py',edits:[
  {why:'the tick admission',
   from:'        if can_dispatch is not None and not can_dispatch():\n            _sched.logger.debug("Cron dispatch paused while gateway drains existing work")\n            return 0\n',
   to:`        if can_dispatch is not None and not can_dispatch():
            _sched.logger.debug("Cron dispatch paused while gateway drains existing work")
            return 0
        # aqeelos:hold-cron-for-restart (7 Nov 2026): aqeelOS restarts the engine only when no agent is at work, and
        # schedules every 5-10 minutes kept it from ever being idle (a restart waited 20+ minutes). While the file
        # <root>/aqeelos-hold-cron exists (at most 15 minutes old), no new run starts; due jobs fire on the next tick
        # after the restart, as when the gateway is starting. Runs in progress are never touched.
        try:
            import time as _aq_t
            from agent.file_safety import _hermes_root_path as _aq_root
            _aq_hold = _aq_root() / "aqeelos-hold-cron"
            if _aq_hold.exists() and _aq_t.time() - _aq_hold.stat().st_mtime < 900:
                _sched.logger.debug("Cron dispatch held: aqeelOS is waiting to restart the engine")
                return 0
        except Exception:
            pass
`}]},
 {tag:'aqeelos:script-failure-held',name:'a failed script-only schedule reports to aqeelOS and alerts once, never a raw traceback',file:'cron/scheduler.py',edits:[
  {why:'the script-failed alert',
   from:'        # Deliver the error: a silently broken watchdog is the worst-case outcome.\n        alert = (\n            f"⚠ Cron watchdog \'{job_name}\' script failed\\n\\n"\n            f"{output}\\n\\n"\n            f"Time: {now_iso}"\n        )\n',
   to:`        # Deliver the error: a silently broken watchdog is the worst-case outcome.
        # aqeelos:script-failure-held (7 Nov 2026): the raw output (often a traceback) went to the chat on every run, every
        # 5 minutes. The error goes to aqeelOS (the agent's my_health and its next message); the chat gets one short line
        # per kind of error per 6 hours, and silence in between. aqeelOS down = the old alert, so a failure is never lost.
        alert = None
        try:
            import hashlib as _aq_h, urllib.request as _aq_u
            from pathlib import Path as _aq_P
            _aq_home = _aq_P(str(_get_hermes_home())).resolve()
            _aq_agent, _aq_root = (_aq_home.name, _aq_home.parent.parent) if _aq_home.parent.name == "profiles" else ("default", _aq_home)
            _aq_key = (_aq_root / "secrets" / "agent-live.key").read_text().strip()
            _aq_body = json.dumps({"key": _aq_key, "agent": _aq_agent, "platform": "cron", "session": str(job_id),
                                   "error": "Schedule " + str(job_name) + " (" + str(job_id) + ") failed:\\n" + str(output)[-4000:]}).encode()
            with _aq_u.urlopen(_aq_u.Request("http://127.0.0.1:4400/agent-live/held", data=_aq_body,
                                             headers={"content-type": "application/json"}, method="POST"), timeout=10) as _aq_r:
                _aq_res = json.loads(_aq_r.read() or b"{}")
            _aq_last = (str(output).strip().splitlines() or [""])[-1][:200]
            alert = SILENT_MARKER if int(_aq_res.get("count") or 1) > 1 and not _aq_res.get("tell") else (
                f"⚠ Schedule '{job_name}' failed: {_aq_last}\\nThe details are in my health list (my_health); I will fix the script.")
        except Exception:
            alert = None
        if alert is None:
          alert = (
            f"⚠ Cron watchdog '{job_name}' script failed\\n\\n"
            f"{output}\\n\\n"
            f"Time: {now_iso}"
          )
`}]}];

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
