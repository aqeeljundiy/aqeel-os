// What must never be in a tracked file of this public repo (12 Nov 2026, secrets audit). Used by scripts/repo-privacy.test.mjs, which runs in CI and in the
// pre-push hook. A value is allowed only when it is plainly made up; the documented fakes are below. Real data of an install (phone numbers, chat ids,
// addresses, sheet ids, names) lives in that install's data folder, never in git: see CONTRIBUTING.md.
export const BINARY=/\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|dll|exe|zip|pdf|dmg|svg|mp[34]|gz|tgz|enc|bin)$/i;
// files that are not read: licence text, generated or vendored code, lock files, the engine patches (they must match the box byte for byte)
export const SKIPPED=f=>f==='LICENSE'||/^engine\/patches\//.test(f)||/(^|\/)vendor\//.test(f)||/(^|\/)package-lock\.json$/.test(f)||BINARY.test(f)||f.startsWith('data/');

// the plainly made-up digits: runs of one digit, zeros, counting up or down
const fakeDigits=d=>/(\d)\1{5,}/.test(d)||/0{4,}/.test(d)||/1234567|7654321|9876543|3456789/.test(d);
const ipOk=ip=>ip.split('.').some(n=>+n>255)||/^(127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|255\.|169\.254\.)/.test(ip);
const mailOk=m=>/@([\w-]+\.)*(example\.(com|org|net)|localhost)$|\.example$|\.test$|\.invalid$|^git@github\.com$|^noreply@|@(s\.whatsapp\.net|g\.us|lid)$/i.test(m)||/@(users\.noreply\.github\.com)$/i.test(m);
const rules=[
 // [name, regex, is-this-match-fine]
 ['a public IP address (use 192.0.2.x, 198.51.100.x or 203.0.113.x)',/(?<![\d.\/-])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g,ipOk],
 ['an e-mail address that is not @example.com',/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b|\b\d+(?::\d+)?@(?:s\.whatsapp\.net|g\.us)\b/gi,m=>mailOk(m)||/^\d/.test(m)&&(fakeDigits(m)||m.length<9)],
 ['an Indonesian mobile number (use 62800000000x)',/(?<![\d.\w-])(?:\+?62[ -]?|0)8\d[\d -]{7,12}\d(?![\d-])/g,m=>{const d=m.replace(/\D/g,'');return fakeDigits(d)||d.length<10||d.length>14}],
 ['a WhatsApp LID',/\b\d{12,16}@lid\b/g,m=>fakeDigits(m)||/^1{1}0{6,}/.test(m)],
 ['a Telegram chat id (use -1001234567890)',/(?<![\d\w.-])-100\d{9,12}\b|(?<![\d\w.-])-\d{9,10}\b(?=['"\]\s,)}]|$)/g,m=>fakeDigits(m)],
 ['a Telegram user id (use 1000000001)',/(?:telegram|tg|chat_?id|user_?id|sender|owner_?id|from_?id)\w*['"\s:=,\[(-]{1,8}(\d{9,10})\b/gi,m=>{const d=/(\d{9,10})$/.exec(m)[1];return fakeDigits(d)||/^1000000\d{3}$/.test(d)||/^(1[6-9]\d{8}|2\d{9})$/.test(d)&&false}],
 ['a Google file or sheet id',/\b1[A-Za-z0-9_-]{43}\b/g,m=>!(/[a-z]/.test(m)&&/[A-Z]/.test(m)&&/\d/.test(m))],
 ['a Slack id',/\b[UCBTW]0[A-Z0-9]{8,10}\b/g,m=>!/\d/.test(m)||/0{5,}/.test(m)],
 ['someone\u2019s home folder',/\/home\/(?!<|[a-z]\b|user\b|USER\b|\$|claude\b|node\b|agent\b|workflows\b|you\b|name\b|me\b|example\b|ag-|\.)[a-z][\w-]*/g,()=>false],
 ['a key or token',/\b(?:ghp|gho|ghs|github_pat|xox[abpr]|sk-(?:ant|proj)|AKIA|ASIA|AIza|ya29|GOCSPX|xnd_(?:production|development)|shpat|shpss)[\w-]{10,}/g,m=>/abcdefgh|ABCDEFGH|EXAMPLE|example|x{8}|0123456789|1234567|test|fixture|not-real|zzzz|secret|wrong/i.test(m)],
 ['a private key block',/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----(?!["'`\s]*\)?)[\s\S]{40,}?-----END/g,()=>false],
];
export function findPrivate(file,text){const hits=[];
 for(const [what,re,fine] of rules){re.lastIndex=0;for(const m of text.matchAll(re)){const v=m[0];if(fine(v))continue;const line=text.slice(0,m.index).split('\n').length;hits.push(file+':'+line+': '+what+': '+(v.length>40?v.slice(0,37)+'...':v))}}
 return hits}

// files and folders that must not be tracked at all
export const NEVER_TRACKED=[
 [/\.(enc|pem|key|p12|pfx|db|sqlite3?|jsonl|tgz|tar|tar\.gz|zip)$/i,'a key, database, archive or log file'],
 [/(^|\/)(id_rsa|id_ed25519)/,'an SSH key'],
 [/(^|\/)\.secrets\//,'a secrets folder'],
 [/(^|\/)(client_secret|service-account)[^/]*\.json$/i,'a Google credential file'],
 [/(^|\/)docs\/(.*\/)?prompts\//,'an agent prompt (install-specific; keep it in the install\u2019s data folder)'],
 [/(^|\/)docs\/installs\//,'an install\u2019s own notes (they belong in its data folder)'],
 [/\.local\.md$/,'an install-specific note (*.local.md)'],
 [/^scripts\/box-checks\//,'an install-specific check script (they live in <data>/box-checks/)'],
 [/^[^/]*Users[^/]*\.enc$/,'a stray test output file'],
];
// the files allowed at the top of the repo
export const ROOT_FILES=new Set(['.env.example','.gitignore','.gitleaks.toml','.github','BACKLOG.md','CONTRIBUTING.md','LICENSE','OPERATIONS.md','PUBLIC_EXCLUDE','README.md','RESTORE.md','VERSION','server.mjs','.gitattributes','.mailmap','SECURITY.md']);
