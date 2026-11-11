// Terminal tabs: persistent shell sessions per project. Commands are written to the shell's stdin,
// output is streamed back with a sequence number so several windows can follow the same session.
import {spawn} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {persistentShell,killTree,isWindows,isMac} from './platform.mjs';

// With node-pty installed, terminals are real PTYs (vim, top, prompts and Ctrl+C work); otherwise a line-based shell.
let pty=null;try{pty=createRequire(import.meta.url)('node-pty')}catch{}
const ptyShell=()=>isWindows?{exe:'powershell.exe',args:['-NoLogo'],label:'PowerShell'}:{exe:process.env.SHELL||(isMac?'/bin/zsh':'/bin/bash'),args:['-l'],label:(process.env.SHELL||(isMac?'zsh':'bash')).split('/').pop()};
const RAW_MAX=400000;

const MAX=200000,strip=s=>s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,'');

export class Terminals{
 constructor(env){this.env=env;this.sessions=new Map();process.on('exit',()=>{for(const s of this.sessions.values())try{s.pty?s.child.kill():killTree(s.child)}catch{}})}
 list(projectId){return [...this.sessions.values()].filter(s=>s.projectId===projectId).map(s=>({id:s.id,name:s.name,alive:s.alive,label:s.label,pty:Boolean(s.pty)}))}
 open(projectId,cwd){const count=this.list(projectId).length;if(count>=6)throw Error('Up to 6 terminals per project.');if(pty)return this.openPty(projectId,cwd,count);
  const sh=persistentShell(),id=randomUUID();const s={id,projectId,name:sh.label+' '+(count+1),label:sh.label,prompt:sh.prompt,output:'',seq:0,alive:true,cwd};
  s.child=spawn(sh.exe,sh.args,{cwd,env:{...this.env,TERM:'dumb',NO_COLOR:'1'},windowsHide:true});
  const add=d=>{s.output=(s.output+strip(String(d))).slice(-MAX);s.seq++;s.active=Date.now()};s.child.stdout.on('data',add);s.child.stderr.on('data',add);
  s.child.on('close',code=>{s.alive=false;add('\n[Shell exited with code '+code+'. Open a new terminal to continue.]\n')});s.child.on('error',e=>{s.alive=false;add('\n'+e.message+'\n')});
  add('Shell started in '+cwd+'\n');this.sessions.set(id,s);return {id,name:s.name}}
 // PTY session: raw output kept with absolute offsets so readers can ask for everything after a position
 openPty(projectId,cwd,count,cols=100,rows=30){const sh=ptyShell(),id=randomUUID();const s={id,projectId,name:sh.label+' '+(count+1),label:sh.label,pty:true,raw:'',base:0,alive:true,cwd,cols,rows,waiters:[]};
  s.child=pty.spawn(sh.exe,sh.args,{name:'xterm-256color',cols,rows,cwd,env:{...this.env,TERM:'xterm-256color',COLORTERM:'truecolor'}});
  const add=d=>{s.active=Date.now();s.raw+=d;if(s.raw.length>RAW_MAX){const cut=s.raw.length-RAW_MAX;s.raw=s.raw.slice(cut);s.base+=cut}for(const w of s.waiters.splice(0))w()};
  s.child.onData(add);s.child.onExit(({exitCode})=>{s.alive=false;add('\r\n[Shell exited with code '+exitCode+'. Open a new terminal to continue.]\r\n')});this.sessions.set(id,s);return {id,name:s.name,pty:true}}
 // wait (up to `wait` ms) for output past `after`; returns {end, data, reset}
 async readPty(id,after=0,wait=0){const s=this.get(id);const end=()=>s.base+s.raw.length;if(wait&&after>=end()&&s.alive)await new Promise(r=>{const t=setTimeout(r,wait);s.waiters.push(()=>{clearTimeout(t);r()})});
  const e=end();if(after<s.base||after>e)return {pty:true,alive:s.alive,end:e,reset:true,data:s.raw};return {pty:true,alive:s.alive,end:e,data:s.raw.slice(after-s.base)}}
 keys(id,data){const s=this.get(id);if(!s.pty)throw Error('This terminal takes whole commands.');if(!s.alive)throw Error('This terminal has exited. Open a new one.');if(typeof data!=='string'||data.length>65536)throw Error('Too much input at once.');s.active=Date.now();s.child.write(data)}
 resize(id,cols,rows){const s=this.get(id);if(!s.pty)return;cols=Math.max(10,Math.min(400,cols|0));rows=Math.max(4,Math.min(200,rows|0));if(cols===s.cols&&rows===s.rows)return;s.cols=cols;s.rows=rows;try{s.child.resize(cols,rows)}catch{}}
 // a command at work in a terminal (AUDIT-41, 11 Nov 2026: the self-update could restart Code under a long command typed into
 // a terminal): input or output in the last 2 minutes anywhere, or, on Linux, a shell that has a child process
 busy(now=Date.now()){for(const s of this.sessions.values()){if(!s.alive)continue;if(now-(s.active||0)<120000)return true;const pid=s.child?.pid;
   if(pid&&process.platform==='linux'){try{for(const t of readdirSync('/proc/'+pid+'/task'))if(readFileSync('/proc/'+pid+'/task/'+t+'/children','utf8').trim())return true}catch{}}}
  return false}
 get(id){const s=this.sessions.get(id);if(!s)throw Error('Terminal not found.');return s}
 input(id,text){const s=this.get(id);if(!s.alive)throw Error('This terminal has exited. Open a new one.');const line=String(text).replace(/\r?\n/g,' ');if(line.length>4000)throw Error('Command too long.');
  s.output+=s.prompt+' '+line+'\n';s.seq++;s.active=Date.now();s.child.stdin.write(line+'\n')}
 read(id,after=0){const s=this.get(id);return {seq:s.seq,alive:s.alive,output:s.seq>after?s.output:null}}
 rename(id,name){const s=this.get(id);if(!String(name).trim())throw Error('Name the terminal.');s.name=String(name).trim().slice(0,40)}
 close(id){const s=this.get(id);if(s.pty){try{s.child.kill()}catch{}}else killTree(s.child);this.sessions.delete(id)}
 interrupt(id){const s=this.get(id);if(s.pty){this.keys(id,'\x03');return {id,name:s.name,pty:true}}// no TTY to send Ctrl+C: restart the session in the same folder
  killTree(s.child);this.sessions.delete(id);const fresh=this.open(s.projectId,s.cwd);const n=this.sessions.get(fresh.id);n.name=s.name;n.output=s.output+'\n[Stopped. A fresh shell was started in the same folder.]\n';n.seq++;return fresh}
}
