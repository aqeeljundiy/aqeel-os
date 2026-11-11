// What is wrong with an app someone adds by its address, before it reaches the engine (11 Nov 2026). On P&P,
// "WO Dashboard - Google Sheet" was saved as an app with a spreadsheet's link: it showed a Sign in button but never had
// tools, and its name with spaces broke the sign-in ("Bad name"). A Google file is reached through a connected Google
// account, never as an app. Returns a plain sentence for the person, or null when it is fine.
const GOOGLE_FILE=/^(docs|sheets|drive|slides|forms)\.google\.com$/i;

export function mcpAddProblem(b){
  const name=String(b?.name??'').trim();
  if(!name)return 'Give it a name.';
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name))return 'Name it with letters, digits, - or _ only, with no spaces (for example wo-dashboard).';
  if(b?.url){let u;try{u=new URL(String(b.url))}catch{return 'Type the address, starting with https://'}
    if(GOOGLE_FILE.test(u.hostname))return 'That is a link to a Google file, not an app. Connect a Google account instead (Connections › Add › A Google account); your agent then opens this file with its Google tools. Keep the link in the agent\'s notes.'}
  return null}
