// Engine patch steps that upstream made redundant are retired, so a deploy prints no MISFIT for them (12 Nov 2026: every deploy printed
// "MISFIT 2026-11-06-tonight.patch" and "MISFIT port-reuse .../bridge_ownership.py", and on P&P "skill patches: exit 3" because of the latter).
// Runs the real scripts/apply-skill-patches.mjs against a fake engine (a git repo) in a throwaway HOME. Linux and macOS only (it runs on the box).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT=path.join(path.dirname(fileURLToPath(import.meta.url)),'apply-skill-patches.mjs');
const skip=process.platform==='win32'?'the patch steps run on the box (Linux paths, git)':false;

// the engine's own port_is_free since 155588754a / 1848982075 (bf0203a, both live engines): SO_REUSEADDR, POSIX only
const UPSTREAM=`import os
import socket


def port_is_free(port: int) -> bool:
    with socket.socket() as sock:
        if os.name != "nt":
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True
`;

// a fake engine in a throwaway HOME, the real patch steps run on it once
function runSteps(){const H=mkdtempSync(path.join(tmpdir(),'aq-retired-')),E=path.join(H,'.hermes','hermes-agent'),B=path.join(E,'plugins','platforms','whatsapp','bridge_ownership.py');
 mkdirSync(path.dirname(B),{recursive:true});mkdirSync(path.join(E,'hermes_cli'));writeFileSync(path.join(E,'hermes_cli','__init__.py'),'');writeFileSync(B,UPSTREAM);
 // prompt_builder.py as the earlier steps leave it on a real engine: renamed, so the 6 Nov patch (cut before the rename) cannot apply
 mkdirSync(path.join(E,'agent'));writeFileSync(path.join(E,'agent','prompt_builder.py'),'DEFAULT_AGENT_IDENTITY = ("You are aqeelOS, an intelligent AI assistant.")\n');
 const git=(...a)=>execFileSync('git',['-C',E,'-c','user.email=t@t','-c','user.name=t',...a],{stdio:'pipe'});git('init','-q');git('add','-A');git('commit','-qm','engine');
 const r=spawnSync(process.execPath,[SCRIPT],{env:{...process.env,HOME:H,PUBLIC_URL:'http://aq.example.test'},encoding:'utf8',timeout:280000});
 const res={out:r.stdout+r.stderr,bridge:readFileSync(B,'utf8'),branding:existsSync(path.join(E,'hermes_cli','branding.py'))};rmSync(H,{recursive:true,force:true});return res}
let ran=null;const steps=()=>ran||=runSteps();

test('step 16: the 6 Nov patch (its content is in the 11 Nov hand-edits patch) is no longer applied, so no MISFIT; branding.py is still copied',{skip,timeout:300000},()=>{
 const r=steps();assert.doesNotMatch(r.out,/MISFIT 2026-11-06-tonight\.patch|6 Nov patch does not fit/,r.out);assert.ok(r.branding,'persona branding (step 16) is still put in place')});

test('the retired 6 Nov patch is kept for the record, outside the folder the steps read',()=>{
 const D=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','engine','patches');
 assert.ok(!existsSync(path.join(D,'2026-11-06-tonight.patch')));assert.ok(existsSync(path.join(D,'retired','2026-11-06-tonight.patch')));
 assert.match(readFileSync(path.join(D,'README.md'),'utf8'),/retired/i)});
