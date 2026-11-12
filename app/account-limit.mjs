// Constant-time compare for secrets. The per-account sign-in limit lives in signin-guard.mjs (13 Nov 2026).
import {timingSafeEqual,createHash} from 'node:crypto';

// compare two secrets in constant time (hashing first, so different lengths take the same time)
export function safeEq(a,b){const h=s=>createHash('sha256').update(String(s??'')).digest();return timingSafeEqual(h(a),h(b))&&String(a??'').length===String(b??'').length}
