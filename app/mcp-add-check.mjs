// What is wrong with an app someone adds by its address, before it reaches the engine (11 Nov 2026). On P&P,
// "WO Dashboard - Google Sheet" was saved as an app with a spreadsheet's link: it showed a Sign in button but never had
// tools, and its name with spaces broke the sign-in ("Bad name"). A Google file is reached through a connected Google
// account, never as an app. Returns a plain sentence for the person, or null when it is fine.
// The links that are never MCP tools (Google, Slack, Microsoft 365, GitHub pages…) live in addons.mjs (notMcpReason);
// whether the address really answers like an MCP tool is asked over the network there too (probeMcp).
import {notMcpReason} from './addons.mjs';

export function mcpAddProblem(b){
  const name=String(b?.name??'').trim();
  if(!name)return 'Give it a name.';
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name))return 'Name it with letters, digits, - or _ only, with no spaces (for example wo-dashboard).';
  if(b?.url)return notMcpReason(b.url);
  return null}
