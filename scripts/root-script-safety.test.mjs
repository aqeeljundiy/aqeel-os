// C1 (audit of 12 Nov 2026): an agent's user could become root, because the root script (scripts/agent-users.sh) touched,
// wrote, chowned and deleted by path inside folders the agent owns, and root follows links. Two guards:
//  - a reading of the script's text that fails when a line does such a thing again outside the few approved functions;
//  - the link rig (scripts/root-script-links.sh), which plants the links and runs the real functions (Linux, not root).
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SRC=readFileSync(path.join(HERE,'agent-users.sh'),'utf8');

// Functions that may name a path in an agent's folder next to a write:
//  - run as the agent, never as root: chrome_loop, lean_wm_files (passed to the agent's shell with declare -f);
//  - the helpers that hand a step to another user: as_user, ag_*, own_*, wake_*, trim_*;
//  - root, on the folder's own name only (it sits in the owner's folder, which no agent can write): ws_top, ws_back, lock_home;
//  - root's one walk, refused while the agent has a process: hand_tree.
const APPROVED=new Set(['chrome_loop','lean_wm_files','as_user','ag_mark','ag_put','ag_rm','ag_dir','ag_read','own_put','own_add','own_clear','wake_put','wake_touch','trim_lines','trim_bytes','ws_top','ws_back','lock_home','hand_tree']);
const HELPER=/^(as_user|ag_mark|ag_put|ag_rm|ag_dir|ag_read|own_put|own_add|own_clear|wake_put|wake_touch|trim_lines|trim_bytes|screen_mode|launcher_alive)\b/;
// a path inside an agent's folder, a file in the owner's home, a file in the proxy's folder
const WS=/\$sd\b|\$ws\b|\$\{?HOMEC\}?"?\/workspaces|\.screen\b|\.browser\b|\$prof\b/;
const HOME=/\$(ISSUES|JAN|DONE|PORTS|UIDS|ALIVE|RESET|REQ|LIMITS|BUSY)\b|\$\{?HOMEC\}?\/\.aqeelos/;
const WAKE=/\$WAKE\/|\$SCREEN_EVENTS\b/;
const WRITE=/(^|[\s;&|(!])(touch|chown|chgrp|chmod|mkdir|rmdir|rm|mv|cp|ln|install|tee|truncate|setfacl|dd|sed\s+-i)\s/;
const READ=/(^|[\s;&|(!])(cat|head|tail|source|\.|tr|read|awk|sed|grep)\s/;

// the script as {fn, text} statements: comments gone, the text handed to another user's shell gone, messages gone
function statements(src){
 let s=src.split('\n').filter(l=>!/^\s*#/.test(l)).join('\n');
 s=s.replace(/((?:ba)?sh -c )"(?:[^"\\]|\\[\s\S])*"/g,'$1SCRIPT').replace(/((?:ba)?sh -c )'[^']*'/g,'$1SCRIPT');
 s=s.replace(/desk="[^"]*"/g,'desk=LAUNCH').replace(/\breport ("|default )[^\n]*/g,'report MESSAGE').replace(/\becho "[^"\n]*"/g,'echo MESSAGE').replace(/-v [a-z]+="[^"\n]*"/g,'-v VAR');
 const out=[];let fn='(top level)';
 for(const line of s.split('\n')){
  const m=/^([A-Za-z_][A-Za-z0-9_]*)\(\)\{/.exec(line);
  if(m)fn=m[1];
  for(const st of line.split(/;|&&|\|\||\||\bthen\b|\bdo\b|\belse\b|\{|\}|\$\(|\)/)){const t=st.trim();if(t)out.push({fn,text:t})}
  if(line==='}'||(m&&/\}\s*$/.test(line)))fn='(top level)'}
 return out}

// what a statement does wrong, or ''
function fault({fn,text}){
 if(/\bchown\b/.test(text)&&!/\bchown -h\b/.test(text))return 'chown without -h (it follows a link)';
 if(/\bchown\b[^\n]*\s(-R|--recursive|-[a-zA-Z]*R[a-zA-Z]*)\s/.test(text))return 'recursive chown';
 if(/\bchmod\b[^\n]*\s-R\b/.test(text)&&!/\/opt\/aqeelos\b/.test(text))return 'recursive chmod outside /opt/aqeelos';
 if(/\bsetfacl\b[^\n]*\s-R\b/.test(text)&&(fn!=='hand_tree'||!/\s-P\b/.test(text)))return 'recursive setfacl outside hand_tree, or without -P';
 if(/\brunuser\b/.test(text)&&fn!=='as_user'&&fn!=='proxy_up')return 'runuser outside as_user';
 if(/(^|setsid |exec |timeout \S+ )(ba)?sh -c\b/.test(text)&&!HELPER.test(text)&&!APPROVED.has(fn)&&fn!=='proxy_up')return 'a shell started by root itself';
 if(/\bkill\b[^\n]*(\bcat\b|<)/.test(text)&&fn!=='chrome_loop')return 'kill of a process number read from a file';
 if(APPROVED.has(fn)||HELPER.test(text))return '';
 for(const [re,where] of [[WS,"an agent's folder"],[HOME,"the owner's home"],[WAKE,"the proxy's folder"]]){
  const redirect=new RegExp('(^|[^0-9&])>{1,2}\\s*"?[^\\s"]*('+re.source+')').test(text);
  if(redirect)return 'root writes (>) into '+where;
  if(WRITE.test(text)&&re.test(text)){
   // root may remove a name in the proxy's folder (rm never follows a link) and make that folder
   if(re===WAKE&&/^(rm -f --|mkdir -p) /.test(text))continue;
   return 'root changes a path in '+where}
  if(re===WS&&READ.test(text)&&re.test(text))return "root reads a file's contents in "+where}
 return ''}
const faults=src=>statements(src).map(st=>({...st,why:fault(st)})).filter(x=>x.why);

test('the checker catches each kind of line that made C1 (and the lines as they were on 11 Nov)',()=>{
 const wrap=body=>'screen_up(){\n'+body+'\n}\n';
 const bad=[
  'touch "$sd/asleep"; chown "$u:$OWNER" "$sd/asleep" 2>/dev/null',
  'mkdir -p "$sd"; chown -h "$u:$OWNER" "$sd"',
  'echo "$mode" > "$sd/mode"',
  'rm -f -- "$RST/$n" "$sd/waking"',
  'chown -R "$u:$OWNER" "$ws"',
  'chown -hR "$u:$OWNER" /srv/x',
  'setfacl -R -m "u:$u:rwX" "$ws"',
  'mode=$(cat "$sd/mode" 2>/dev/null || echo desktop)',
  '[ -f "$sd/launcher.pid" ] && kill -0 "$(cat "$sd/launcher.pid" 2>/dev/null)" 2>/dev/null && run=1',
  'tail -c 2097152 "$f" > "$f.tmp" && cat "$f.tmp" > "$HOMEC/workspaces/$n/.screen/chrome.log"',
  'printf \'%s\' "$out" > "$DONE.tmp"',
  'date +%s > "$ALIVE"',
  'echo "$line" >> "$PORTS"',
  'printf \'{}\' >> "$SCREEN_EVENTS"',
  'touch "$WAKE/$n.active"',
  'runuser -u "$u" -- bash -c "cd \'$ws\'"',
  'touch "$HOMEC/workspaces/$n/.screen/asleep"',
  'ln -s "$sd" "$prof/bot-desktop"',
  'chown "$OWNER:$OWNER" "$ISSUES"'];
 for(const b of bad)assert.ok(faults(wrap(b)).length>0,'not caught: '+b);
 // and the same steps the approved way pass
 const good=['ag_mark "$u" "$sd/asleep"','ag_put "$u" "$sd/mode" "$mode"','rm -f -- "$RST/$n"; ag_rm "$u" "$sd/waking"','printf \'%s\' "$out" | own_put "$DONE"',
  '[ -f "$sd/asleep" ] && return 0','[ "$(stat -c %Y "$sd/waking")" -gt 0 ] && x=1','as_user "$u" bash -c "cd \'$ws\'; : > \'$sd/env\'" </dev/null','mode=$(screen_mode "$u" "$sd")'];
 for(const g of good)assert.deepEqual(faults(wrap(g)),[],'wrongly caught: '+g)});

test('the root script: nothing root does by path in an agent\'s folder, the owner\'s home or the proxy\'s folder',()=>{
 const f=faults(SRC);
 assert.deepEqual(f.map(x=>x.fn+': '+x.why+': '+x.text),[])});

test('chown: every use carries -h, none is recursive; the one walk refuses while the agent runs anything',()=>{
 const code=SRC.split('\n').filter(l=>!/^\s*#/.test(l));
 const uses=code.filter(l=>/(^|[\s;&|])chown\s/.test(l));
 assert.ok(uses.length>=3);
 for(const l of uses)for(const m of l.matchAll(/(^|[\s;&|])chown\s+(\S+)/g))assert.equal(m[2],'-h',l.trim());
 assert.equal(/chown[^\n]*(\s-R\b|--recursive)/.test(code.join('\n')),false);
 const body=SRC.slice(SRC.indexOf('\nhand_tree(){'),SRC.indexOf('\n}\n',SRC.indexOf('\nhand_tree(){')));
 assert.ok(body.indexOf('pgrep -u "$u"')>0&&body.indexOf('pgrep -u "$u"')<body.indexOf('chown -h'),'the walk must check for the agent\'s processes first');
 assert.match(body,/-type f -links \+1/);assert.match(body,/setfacl -R -P -b/)});

test('agent names are checked wherever one arrives from a file or the command line',()=>{
 for(const fn of ['make_user','uid_of','port_of','screen_up','put_to_sleep','wake_verify']){
  const i=SRC.indexOf('\n'+fn+'(){');assert.ok(i>=0,fn);
  assert.match(SRC.slice(i,SRC.indexOf('\n}\n',i)),/ok_name "\$n"/,fn+' does not check the name')}
 assert.match(SRC,/reset\) ok_name "\$\{2:-\}" &&/);assert.match(SRC,/stop\) ok_name "\$\{2:-\}" &&/);
 // every loop over a list of names checks each one
 const loops=[...SRC.matchAll(/while read -r n[^\n]*\n?[^\n]*/g)].map(m=>m[0]);
 assert.ok(loops.length>=8);
 for(const l of loops)assert.match(l,/ok_name "\$n"|\[\[ "\$n" =~ \^\[a-z0-9\]\[a-z0-9_-\]\{0,28\}\$ \]\]/,l)});

test('the watcher never installs a copy of itself that does not parse, and honours root\'s list of allowed copies',()=>{
 const i=SRC.indexOf('\nself_update(){');const body=SRC.slice(i,SRC.indexOf('\n}\n',i));
 assert.match(body,/mktemp \/var\/lib\/aqeelos\//);assert.match(body,/bash -n "\$t"/);assert.match(body,/grep -qx -- "\$sum" "\$PIN"/);
 assert.match(body,/install -m 755 -o root -g root "\$t" "\$0"/);
 assert.equal(/install [^\n]*"\$SRC" "\$0"/.test(SRC),false,'the app folder\'s copy must not be installed directly')});

test('the link rig: with every name a link into root\'s files, no step of the root script changes them',{skip:process.platform!=='linux'||process.getuid()===0?'needs Linux and an ordinary user':false,timeout:300000},()=>{
 const r=spawnSync('bash',[path.join(HERE,'root-script-links.sh')],{encoding:'utf8'});
 assert.equal(r.status,0,(r.stdout||'')+(r.stderr||''));
 assert.match(r.stdout,/root script links: \d+ checks, 0 failed/)});
