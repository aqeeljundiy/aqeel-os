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
            (logger.debug if remote_path.endswith("/.usage.json") else logger.warning)(\n`}]}];

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
