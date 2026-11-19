// The engine keeps every generation of a chat in state.db: a context compression (or rewind) rewrites the transcript
// and leaves the older rows behind with active=0, so one message can sit there two or three times under the same
// message_uid (EN-13, 19 Nov 2026). The engine's own views show a message once: rows with active=1 or compacted=1,
// grouped by identity. Our read-only queries do the same with this condition: the first row of each message_uid,
// and only for a message that is still shown (not one a rewind dropped). `where` narrows the inner scan (keep it on
// the same session/time as the outer query); `col` is the outer id column (`m.id` in a join).
export function oneCopy(where, col = 'id') {
 return `${col} in (select min(id) from messages where ${where} group by session_id,coalesce(message_uid,'#'||id) having max(coalesce(active,1)=1 or coalesce(compacted,0)=1))`;
}
