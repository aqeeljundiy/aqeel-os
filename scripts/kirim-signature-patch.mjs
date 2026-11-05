// Kirimdev webhook signatures in the engine's webhook receiver (gateway/platforms/webhook.py), 5 Nov 2026.
// Kirimdev sends X-Kirim-Signature: t=<unix>,v1=<hex>[,v1=<hex>...]; each v1 is the hex HMAC-SHA256 of "<t>.<raw body>"
// with the route's secret. A request is accepted when any v1 matches and t is at most 5 minutes off (either way).
// When that header is there it is the only check used: a bad Kirimdev signature never falls through to an older,
// weaker check. The delivery id comes from what was signed (t and the body), so the same request sent again (with
// any unsigned header changed) is the same delivery and the engine's own replay guard turns it away.
// Also (same file, own tag): webhook routes bound to an agent (--route-profile) never reached it. While handing an
// event to that agent the engine read the route list from the agent's own folder, which has none, so the route
// seemed gone and every delivery got 503 "Admission unavailable". The list belongs to the gateway (the main agent's
// folder, where `hermes -p default webhook subscribe --route-profile` writes it), so it is read from there.
// apply-skill-patches.mjs applies these on every deploy and engine update. To test on a copy:
//   node scripts/kirim-signature-patch.mjs <webhook.py> <patched copy>
import {readFile,writeFile} from 'node:fs/promises';

export const TAG='aqeelos:kirim-signature',ROUTES_TAG='aqeelos:webhook-routes-home';

const FUNCS=`# ${TAG}: Kirimdev signs "<t>.<raw body>" (hex HMAC-SHA256) in X-Kirim-Signature: t=<unix>,v1=<hex>[,v1=<hex>...]
_KIRIM_MAX_HEADER = 2048
_KIRIM_MAX_SIGNATURES = 8


def _kirim_signature_parts(header: str):
    """(t, [v1, ...]) from an X-Kirim-Signature header, or None when it is malformed."""
    if not isinstance(header, str) or not header or len(header) > _KIRIM_MAX_HEADER or not header.isascii():
        return None
    t, sigs = None, []
    for part in header.split(","):
        part = part.strip()
        if not part:
            continue
        key, sep, value = part.partition("=")
        key, value = key.strip(), value.strip()
        if not sep or not value:
            return None
        if key == "t":
            if t is not None or not value.isdigit() or len(value) > 12:
                return None
            t = value
        elif key == "v1":
            sigs.append(value.lower())
    if t is None or not sigs or len(sigs) > _KIRIM_MAX_SIGNATURES:
        return None
    return t, sigs


def _validate_kirim_signature(body: bytes, secret: str, header: str) -> bool:
    """Accept when any v1 matches and t is within the replay window (5 minutes, earlier or later)."""
    parts = _kirim_signature_parts(header)
    if not parts or not _is_usable_secret(secret):
        return False
    t, sigs = parts
    if not _timestamp_fresh(t, "[webhook] Kirimdev signature timestamp outside replay window"):
        return False
    expected = _hex_hmac(secret, t.encode() + b"." + body)
    matched = False
    for sig in sigs:  # every one is compared, so the time taken does not say which one matched
        matched = _hmac_str_equal(sig, expected) or matched
    return matched


def _kirim_delivery_id(headers, body: bytes) -> str:
    """A Kirimdev delivery's id from what it signed, so a replayed request is the same delivery; "" otherwise."""
    try:
        header = headers.get("X-Kirim-Signature", "") or headers.get("x-kirim-signature", "") or ""
    except Exception:
        return ""
    parts = _kirim_signature_parts(header) if header else None
    if not parts:
        return ""
    return "kirim-" + hashlib.sha256(parts[0].encode() + b"." + body).hexdigest()[:40]


`;

const EDITS=[
 {why:'the Kirimdev functions',
  from:'def _validate_svix_signature(body: bytes, secret: str, msg_id: str, timestamp: str, signature_header: str) -> bool:\n',
  to:FUNCS+'def _validate_svix_signature(body: bytes, secret: str, msg_id: str, timestamp: str, signature_header: str) -> bool:\n'},
 {why:'the signature check',
  from:'        svix = [_header(name) for name in ("svix-id", "svix-timestamp", "svix-signature")]\n',
  to:`        # ${TAG}: a Kirimdev signature header commits to Kirimdev's check (no fall-through to older schemes)
        kirim = _header("X-Kirim-Signature")
        if kirim:
            return _validate_kirim_signature(body, secret, kirim)
        svix = [_header(name) for name in ("svix-id", "svix-timestamp", "svix-signature")]\n`},
 {why:'the delivery id',
  from:'        headers = request.headers\n        delivery_id = _header_delivery_id(headers)\n',
  to:`        headers = request.headers
        delivery_id = _kirim_delivery_id(headers, raw_body) or _header_delivery_id(headers)  # ${TAG}\n`}];

const ROUTES=[{why:'the route list home',
  from:'        from hermes_constants import get_hermes_home\n        subs_path = get_hermes_home() / _DYNAMIC_ROUTES_FILENAME\n',
  to:`        # ${ROUTES_TAG}: the gateway's own list, also while an event is handed to a routed agent (its home has none)
        from hermes_constants import get_routing_process_hermes_home
        subs_path = get_routing_process_hermes_home() / _DYNAMIC_ROUTES_FILENAME\n`}];
export const PATCHES=[{tag:TAG,name:'Kirimdev signatures',edits:EDITS},{tag:ROUTES_TAG,name:'webhook routes for agents',edits:ROUTES}];

// each patch all or nothing: {out, applied:[names], errors:[text]}; out is null when nothing changed
export function kirimPatch(src){let out=src;const applied=[],errors=[];
 for(const p of PATCHES){if(out.includes(p.tag))continue;let next=out,bad=null;
  for(const e of p.edits){if(next.split(e.from).length!==2){bad=p.name+': the place for '+e.why+' changed upstream';break}next=next.replace(e.from,()=>e.to)}
  if(bad)errors.push(bad);else{out=next;applied.push(p.name)}}
 return {out:applied.length?out:null,applied,errors}}

if(import.meta.url===`file://${process.argv[1]}`){const [,,inp,outp]=process.argv;
 const src=await readFile(inp,'utf8'),r=kirimPatch(src);for(const e of r.errors)console.error('✗ '+e);
 await writeFile(outp,r.out??src);console.log(r.applied.length?'patched copy written: '+r.applied.join(', '):'nothing to change, copied');if(r.errors.length)process.exit(1)}
