#!/usr/bin/env node
// A compact rules digest for the Continue Threads runners, made without a model (12 Nov 2026).
// Why: every Threads run starts with "STEP 0 READ" of THREADS_KNOWLEDGE.md, AQEEL_DECISIONS.md and CONTENT_PLAYBOOK.md. On 12 Nov the decisions
// file was 317 KB (about 80,000 tokens) of which about 80% were one-line RUN LOGS ("... comment run: ~300 results; 0 comments"), only about 180
// lines were decisions; the whole file stays in the model's context for every later step of the run, which is why a run costs 440-680k tokens.
// This script writes ONE file the runs read instead: <workspace>/RULES_DIGEST.md =
//   1. the rule sections of THREADS_KNOWLEDGE.md (its "## ..." sections; its per-run log lines are left out),
//   2. CONTENT_PLAYBOOK.md and FORUM_FACTS.md as they are (small, stable),
//   3. the decisions of AQEEL_DECISIONS.md, newest last: run-log lines left out; if a distilled base file is given (--base, written once by a person or a
//      reviewed model run), the decisions up to the base's date are replaced by it and only the lines after it follow.
// Nothing is ever deleted or edited in the source files. It rewrites the digest only when a source changed (a content hash is kept in the digest's
// first line), so running it before every run is free.
// Usage: node threads-digest.mjs --dir /home/claude/workspaces/continue-threads [--base BASE_DECISIONS.md --base-until 2026-11-12] [--out RULES_DIGEST.md]
//        node threads-digest.mjs --dir ... --check   exit 0 when the digest is up to date, 1 when it would change (writes nothing)
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
// the date a log or decision line starts with: "2026-11-05 07:40 WIB | ..." or "10 Nov 2026 ~05:20 WIB ..." -> "2026-11-05", else null
export function dateOf(line){const s=String(line||'');let m=/^(\d{4})-(\d\d)-(\d\d)\b/.exec(s);if(m)return m[1]+'-'+m[2]+'-'+m[3];
 m=/^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})\b/.exec(s);if(m&&MONTHS[m[2].toLowerCase()])return m[3]+'-'+String(MONTHS[m[2].toLowerCase()]).padStart(2,'0')+'-'+m[1].padStart(2,'0');return null}
// a one-line record of what a run did, not a decision. The words after "<date> | <who> |" decide: a line whose opening carries a rule marker is a
// decision even when it goes on to mention a run; a line that names a run (comment run, DM run, run (...), 0 sent) without one is a log.
const RUNLOG=/\b(comment|DM|outbound DM|reply|replies|cron|thread|post|FAST DM|DM\+replies|DM and replies)[ -]*(run|loop)\b|^(\d\d:\d\d )?(DM run|run\b)|\b0 (sent|comments|DMs|follows)\b/i;
const RULE=/^(AJ\b|CORRECTION|PRIORITY|NEVER|ALWAYS|RULE|NEW RULE|OVERRIDE|PATCHED|DM FIX|Removal|Comment blocked|\dnd drug|STOP_COMMENTS|Full plan|Social proof|China|First-reply|DM intro|Every run|Every )|\bAJ ?[:(']/;
const bodyOf=s=>{const m=/^(?:\d{4}-\d\d-\d\d \d\d:\d\d WIB \| [^|]{1,30} \| )?([\s\S]*)$/.exec(String(s||'').trim());return m?m[1]:String(s||'')};
export const isRunLog=line=>{const s=String(line||'').trim();if(!s||/^#/.test(s)||s.length>1500)return false;const b=bodyOf(s);if(RULE.test(b.slice(0,90)))return false;return RUNLOG.test(b)};

// the knowledge file without its log lines: its "#"-headed sections and the lines under them; undated lines before the first heading are kept
export function rulesOf(text){const out=[];let inSection=false;for(const l of String(text||'').split('\n')){if(/^#{1,3} /.test(l)){inSection=true;out.push(l);continue}
 if(!l.trim()){if(inSection)out.push(l);continue}if(inSection){out.push(l);continue}if(dateOf(l)&&isRunLog(l))continue;if(dateOf(l))continue;out.push(l)}
 return out.join('\n').replace(/\n{3,}/g,'\n\n').trim()}

export function decisionsOf(text,{since=null}={}){const lines=String(text||'').split('\n');const keep=[];let dropped=0,old=0;
 for(const l of lines){if(!l.trim()||/^# /.test(l))continue;if(isRunLog(l)){dropped++;continue}const d=dateOf(l);if(since&&d&&d<=since){old++;continue}keep.push(l)}
 return {lines:keep,dropped,old}}

export function build({knowledge,playbook,facts,decisions,base=null,baseUntil=null,now=new Date()}){
 const d=decisionsOf(decisions,{since:base?baseUntil:null}),rules=rulesOf(knowledge);
 const body=['# RULES DIGEST for the Continue Threads runners (made by threads-digest.mjs, no model; edit the source files, not this one)',
  'Read this ONE file at the start of a run instead of THREADS_KNOWLEDGE.md, AQEEL_DECISIONS.md and CONTENT_PLAYBOOK.md. Newest decision wins.',
  'Do NOT write run summaries into AQEEL_DECISIONS.md or THREADS_KNOWLEDGE.md; append one line to RUNLOG.txt (not read).','',
  '## RULES (THREADS_KNOWLEDGE.md)',rules,'','## CONTENT PLAYBOOK',String(playbook||'').trim(),'','## FORUM FACTS',String(facts||'').trim(),'',
  '## DECISIONS'+(base?' (the base up to '+baseUntil+', then the lines after it; run logs left out)':' (run logs left out: '+d.dropped+' lines)'),
  ...(base?[String(base).trim(),'','### After '+baseUntil]:[]),...d.lines].join('\n');
 return {text:body,stats:{decisionLines:d.lines.length,runLogsDropped:d.dropped,baseLinesReplaced:d.old}}}

export const hashOf=parts=>createHash('sha1').update(parts.map(x=>String(x??'')).join('\u0000')).digest('hex').slice(0,16);

const here=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(here)){
 const args=process.argv.slice(2),opt=(n,d)=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:d};
 const dir=opt('dir');if(!dir){console.error('--dir (the agent workspace) is needed');process.exit(2)}
 const rd=f=>readFile(path.join(dir,f),'utf8').catch(()=>'');
 const [knowledge,playbook,facts,decisions]=await Promise.all(['THREADS_KNOWLEDGE.md','CONTENT_PLAYBOOK.md','FORUM_FACTS.md','AQEEL_DECISIONS.md'].map(rd));
 const baseFile=opt('base'),base=baseFile?await readFile(path.isAbsolute(baseFile)?baseFile:path.join(dir,baseFile),'utf8').catch(()=>null):null,baseUntil=opt('base-until',null);
 if(baseFile&&base==null){console.error('the base file '+baseFile+' cannot be read');process.exit(2)}
 if(base&&!/^\d{4}-\d\d-\d\d$/.test(String(baseUntil||''))){console.error('--base needs --base-until YYYY-MM-DD');process.exit(2)}
 const out=path.join(dir,opt('out','RULES_DIGEST.md')),h=hashOf([knowledge,playbook,facts,decisions,base,baseUntil]);
 const cur=await readFile(out,'utf8').catch(()=>'');const same=cur.startsWith('<!-- sources '+h+' -->');
 if(args.includes('--check'))process.exit(same?0:1);
 if(same){console.log('up to date');process.exit(0)}
 const {text,stats}=build({knowledge,playbook,facts,decisions,base,baseUntil});
 await mkdir(path.dirname(out),{recursive:true});await writeFile(out+'.tmp',('<!-- sources '+h+' -->\n'+text+'\n'),{mode:0o660});await rename(out+'.tmp',out);
 console.log('written '+out+': '+text.length+' bytes (decisions kept '+stats.decisionLines+', run logs left out '+stats.runLogsDropped+', replaced by the base '+stats.baseLinesReplaced+')')}
