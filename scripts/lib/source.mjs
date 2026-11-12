// The one way a test reads the text of the app's own source: src('app/server.mjs').
// Tests that check what the code says (a route keeps its rights check, a timer is cleared, a start-up order) used to read app/server.mjs
// directly. When server.mjs is split (docs/ARCHITECTURE.md, "Splitting server.mjs"), the text moves to other files; src('app/server.mjs')
// then returns the text of all the files that came out of it, so those tests keep asserting the same thing and need no edit in the same
// pull request as the move (the fixer gate judges a pull request by main's version of every existing test, so they must not need one).
// Today nothing has been split out and src('app/server.mjs') is exactly the file. Any other path returns that file's text.
import {readFileSync,readdirSync,existsSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
export const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','..');
// files that hold what used to be in a bigger file, in the order they are appended (only the ones that exist are read)
const SPLIT={'app/server.mjs':()=>['app/agent-context-text.mjs','app/hapi-proxy.mjs','app/self-tools.mjs','app/loops.mjs','app/notify-tools-routes.mjs','app/code-device-routes.mjs','app/channels-routes.mjs','app/health-routes.mjs','app/connected-routes.mjs','app/system-routes.mjs','app/abilities-routes.mjs','app/instructions-routes.mjs','app/access-routes.mjs',...dir('app/routes')]};
function dir(d){const p=path.join(ROOT,d);return existsSync(p)?readdirSync(p).filter(f=>/\.mjs$/.test(f)).sort().map(f=>d+'/'+f):[]}
export const parts=rel=>[rel,...(SPLIT[rel]?SPLIT[rel]().filter(f=>existsSync(path.join(ROOT,f))):[])];
export const src=rel=>parts(rel).map(f=>readFileSync(path.join(ROOT,f),'utf8')).join('\n');
