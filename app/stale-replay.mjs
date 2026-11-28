// Old pinned requests in chat sessions (29 Nov 2026).
// When the engine compacts a chat, it copies the unfinished request after the summary as
// "[STILL IN PROGRESS ... Continue it; do not start over.]" and that copy stays in the summary
// for good. In a long-lived Telegram topic the agent then keeps "continuing" a days-old order:
// continue-threads answered "pause" and "delete our comments" with the 21 Nov "push 10 comments/h"
// order for 8 days. This check removes only that pinned block, only when the person has written
// newer messages since and the pin is 6+ hours old. The removed text is kept in a backup file.
import {execFile} from 'node:child_process';
import path from 'node:path';

export const STALE_REPLAY_PY = String.raw`
import sqlite3, glob, os, sys, json, time
HDR = "[STILL IN PROGRESS — this is the active request, restated after the compaction boundary because it was not finished yet. Continue it; do not start over.]"
root, backup, fix, min_age_h = sys.argv[1], sys.argv[2], sys.argv[3] == "fix", float(sys.argv[4])
now = time.time(); out = []
for db in sorted(glob.glob(os.path.join(root, "profiles", "*", "state.db"))):
    prof = db.split(os.sep)[-2]
    try:
        c = sqlite3.connect(db, timeout=30)
        rows = c.execute("select m.id, m.session_id, m.timestamp, m.content from messages m join sessions s on s.id=m.session_id "
                         "where m.active=1 and s.ended_at is null and coalesce(s.source,'') not in ('cron','cli','local') and m.content like ?",
                         ("%" + HDR + "%",)).fetchall()
    except Exception as e:
        continue
    for mid, sid, ts, content in rows:
        newer = c.execute("select count(*) from messages where session_id=? and active=1 and role='user' and id>? "
                          "and content not like '[Posted in this topic by aqeelOS%' and content not like '[CONTEXT COMPACTION%'", (sid, mid)).fetchone()[0]
        age_h = (now - (ts or now)) / 3600
        if newer == 0 or age_h < min_age_h:
            continue
        task = content.rsplit(HDR, 1)[1].strip()[:160].replace("\n", " ")
        item = {"profile": prof, "session": sid, "id": mid, "ageH": round(age_h), "newer": newer, "pinned": task, "fixed": False}
        if fix:
            os.makedirs(os.path.dirname(backup), exist_ok=True)
            with open(backup, "a") as f:
                f.write(json.dumps({"at": now, "profile": prof, "session": sid, "id": mid, "content": content}) + "\n")
            with c:
                c.execute("update messages set content=? where id=?", (content.rsplit(HDR, 1)[0].rstrip(), mid))
            item["fixed"] = True
        out.append(item)
print(json.dumps(out))
`;

export function staleReplays({hermesHome, backup, fix = true, minAgeH = 6, timeout = 60000}) {
  return new Promise(res => execFile('python3', ['-I', '-c', STALE_REPLAY_PY, hermesHome, backup, fix ? 'fix' : 'look', String(minAgeH)], {timeout},
    (e, so) => { if (e) return res({error: String(e.message || e).slice(0, 200), items: []}); try { res({items: JSON.parse(String(so).trim() || '[]')}) } catch { res({error: 'bad output', items: []}) } }));
}

export function createStaleReplayCheck({hermesHome, logsDir, log = console.log}) {
  const backup = path.join(logsDir, 'stale-replay-backups.jsonl');
  return async function tick() {
    const r = await staleReplays({hermesHome, backup});
    if (r.error) return log('stale-replay: check failed: ' + r.error);
    for (const i of r.items) log('stale-replay: ' + i.profile + ' chat ' + i.session + ' kept an old pinned request for ' + i.ageH + ' h after ' + i.newer + ' newer messages, removed it: ' + JSON.stringify(i.pinned));
  };
}
