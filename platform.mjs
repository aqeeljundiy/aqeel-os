// Everything that differs between Windows and macOS (and Linux) lives here, so the rest of the app
// is platform-neutral. Mac support = these functions returning the right commands; nothing else changes.
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const isWindows=process.platform==='win32',isMac=process.platform==='darwin';
const exists=async p=>{try{await access(p);return true}catch{return false}};

// Executable names: Windows needs .exe; macOS/Linux use the bare name.
export const exeName=name=>isWindows?name+'.exe':name;

// Extra install locations searched after PATH.
export function knownLocations(name){const home=os.homedir();
 if(isWindows)return ({
  codex:[],claude:[path.join(home,'.local/bin/claude.exe')],
  gh:['C:/Program Files/GitHub CLI/gh.exe'],git:['C:/Program Files/Git/cmd/git.exe','C:/Program Files/Git/bin/git.exe'],
  code:[path.join(process.env.LOCALAPPDATA||'','Programs/Microsoft VS Code/Code.exe')],
 })[name]||[];
 return ({
  codex:['/opt/homebrew/bin/codex','/usr/local/bin/codex',path.join(home,'.local/bin/codex')],
  claude:[path.join(home,'.local/bin/claude'),path.join(home,'.claude/local/claude'),'/opt/homebrew/bin/claude','/usr/local/bin/claude'],
  gh:['/opt/homebrew/bin/gh','/usr/local/bin/gh'],git:['/usr/bin/git','/opt/homebrew/bin/git'],
  code:['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code','/usr/local/bin/code','/opt/homebrew/bin/code'],
 })[name]||[];
}
export async function findOnPath(name){for(const dir of (process.env.PATH||'').split(path.delimiter)){if(!dir)continue;const p=path.join(dir,exeName(name));if(await exists(p))return p}
 for(const p of knownLocations(name))if(await exists(p))return p;return null}

// The user's command shell for the project terminal: PowerShell on Windows, the login shell elsewhere.
export function shell(command){
 if(isWindows)return {exe:path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),args:['-NoLogo','-NoProfile','-NonInteractive','-Command',command],label:'PowerShell',prompt:'PS>'};
 const sh=process.env.SHELL||(isMac?'/bin/zsh':'/bin/bash');return {exe:sh,args:['-lc',command],label:path.basename(sh),prompt:'%'};
}

// Show a folder in the file manager.
export function reveal(folder){if(isWindows){const dir=path.resolve(folder).replace(/'/g,"''");
  const ps=WINDOWS_FRONT+"$sh=New-Object -ComObject Shell.Application;$sh.Open('"+dir+"');$w=$null;for($i=0;$i -lt 30 -and -not $w;$i++){Start-Sleep -Milliseconds 150;$w=@($sh.Windows()|Where-Object{try{$_.Document.Folder.Self.Path -eq '"+dir+"'}catch{$false}})[0]}if($w){[Front]::Go([IntPtr]$w.HWND)}";
  spawn(path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-STA','-Command',ps],{detached:true,stdio:'ignore',windowsHide:true}).on('error',()=>{}).unref();return}
 const [exe,args]=isMac?['/usr/bin/open',[folder]]:['xdg-open',[folder]];
 spawn(exe,args,{detached:true,stdio:'ignore'}).on('error',()=>{}).unref()}
export const fileManagerName=isWindows?'Explorer':isMac?'Finder':'file manager';

// Open a folder in VS Code if installed.
export async function openInEditor(folder,file){const code=await findOnPath('code');if(!code)throw Error('VS Code was not found on this computer.');
 const [exe,args]=isMac&&code.endsWith('.app')?['/usr/bin/open',['-a',code,folder,...(file?[file]:[])]]:[code,[folder,...(file?['-g',file]:[])]];spawn(exe,args,{detached:true,stdio:'ignore',shell:isWindows&&/\.cmd$/i.test(code)}).on('error',()=>{}).unref()}

// Native folder picker on the host computer. Resolves to a path or null when cancelled.
// The modern Windows "Select Folder" window (the Explorer-style dialog apps use for File › Open), through its COM interface.
// Only the methods called here have real signatures; the others hold their places in the interface.
const WINDOWS_FRONT=`Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class Front{[DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,IntPtr p);
 [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();[DllImport("user32.dll")]static extern bool AttachThreadInput(uint a,uint b,bool on);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]static extern bool BringWindowToTop(IntPtr h);[DllImport("user32.dll")]static extern bool ShowWindow(IntPtr h,int c);
 public static void Go(IntPtr h){uint fg=GetWindowThreadProcessId(GetForegroundWindow(),IntPtr.Zero),me=GetCurrentThreadId();AttachThreadInput(me,fg,true);ShowWindow(h,9);BringWindowToTop(h);SetForegroundWindow(h);AttachThreadInput(me,fg,false);}}
'@
`;
const WINDOWS_FOLDER_DIALOG=WINDOWS_FRONT+`Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
[ComImport,Guid("42f85136-db7e-439c-85f1-e4075d135fc8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IFileDialog{[PreserveSig]int Show(IntPtr owner);void SetFileTypes();void SetFileTypeIndex();void GetFileTypeIndex();void Advise();void Unadvise();
 void SetOptions(uint options);void GetOptions(out uint options);void SetDefaultFolder();void SetFolder();void GetFolder();void GetCurrentSelection();void SetFileName();void GetFileName();
 void SetTitle([MarshalAs(UnmanagedType.LPWStr)]string title);void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)]string label);void SetFileNameLabel();void GetResult(out IShellItem item);}
[ComImport,Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItem{void BindToHandler();void GetParent();void GetDisplayName(uint form,[MarshalAs(UnmanagedType.LPWStr)]out string name);}
[ComImport,Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] public class FileOpenDialog{}
public static class FolderPicker{public static string Pick(string title,IntPtr owner){var d=(IFileDialog)new FileOpenDialog();uint o;d.GetOptions(out o);d.SetOptions(o|0x20|0x40);d.SetTitle(title);d.SetOkButtonLabel("Open in code by aqeel");
 if(d.Show(owner)!=0)return null;IShellItem item;d.GetResult(out item);string path;item.GetDisplayName(0x80058000,out path);return path;}}
'@
$owner=New-Object System.Windows.Forms.Form;$owner.TopMost=$true;$owner.ShowInTaskbar=$false;$owner.FormBorderStyle='None';$owner.Opacity=0;$owner.StartPosition='CenterScreen';$owner.Width=1;$owner.Height=1;$owner.Show();[Front]::Go($owner.Handle);$p=[FolderPicker]::Pick('__TITLE__',$owner.Handle);if($p){[Console]::Out.Write($p)}`;

export function pickFolder(prompt='Choose a project folder'){return new Promise(resolve=>{
 let exe,args;
 if(isWindows){exe=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  args=['-NoProfile','-STA','-Command',WINDOWS_FOLDER_DIALOG.replace('__TITLE__',prompt.replace(/'/g,"''"))]}
 else if(isMac){exe='/usr/bin/osascript';args=['-e',`POSIX path of (choose folder with prompt "${prompt.replace(/"/g,'\\"')}")`]}
 else{exe='zenity';args=['--file-selection','--directory','--title='+prompt]}
 let out='';const child=spawn(exe,args,{windowsHide:false});child.stdout.on('data',d=>out+=d);child.on('error',()=>resolve(null));child.on('close',()=>{const p=out.trim().replace(/\/$/,'');resolve(p||null)});
})}

// Native file picker (one file), for a page in the side browser that asks for a file: the person chooses, never the AI.
export function pickFile(prompt='Choose a file'){return new Promise(resolve=>{
 let exe,args;
 if(isWindows){exe=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  args=['-NoProfile','-STA','-Command',WINDOWS_FOLDER_DIALOG.replace('o|0x20|0x40','o|0x40').replace('"Open in code by aqeel"','"Choose"').replace('__TITLE__',prompt.replace(/'/g,"''"))]}
 else if(isMac){exe='/usr/bin/osascript';args=['-e',`POSIX path of (choose file with prompt "${prompt.replace(/"/g,'\\"')}")`]}
 else{exe='zenity';args=['--file-selection','--title='+prompt]}
 let out='';const child=spawn(exe,args,{windowsHide:false});child.stdout.on('data',d=>out+=d);child.on('error',()=>resolve(null));child.on('close',()=>resolve(out.trim()||null));
})}

// Default place for repositories cloned from GitHub.
export const reposHome=()=>path.join(os.homedir(),'Documents','code by aqeel');

// Stop a process and everything it started (dev servers spawn child processes).
export function killTree(child){if(!child?.pid)return;try{
 if(isWindows)spawn(path.join(process.env.SystemRoot||'C:/Windows','System32/taskkill.exe'),['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});
 else process.kill(-child.pid,'SIGTERM')}catch{try{child.kill()}catch{}}}

// Stop programs an AI left running for a project (for example a preview server it started in the background),
// found by the project folder's unique name in their command line. Used before deleting the folder.
export function killProcessesIn(folder){const id=path.basename(folder);if(!/^[\w-]{8,}$/.test(id))return Promise.resolve();
 return new Promise(resolve=>{
  const done=()=>resolve();
  if(isWindows){const ps=`Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -like '*${id}*' } | ForEach-Object { & "$env:SystemRoot\\System32\\taskkill.exe" /PID $_.ProcessId /T /F *> $null }`;
   spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true,stdio:'ignore'}).on('exit',done).on('error',done)}
  else spawn('pkill',['-f',id],{stdio:'ignore'}).on('exit',done).on('error',done)})}

// Run a package-manager command (npm/pnpm/yarn/bun). On Windows these are .cmd shims that need a shell;
// arguments are fixed strings and port numbers chosen by the app, never user text.
export function packageCommand(manager,args){return isWindows?{exe:manager,args,options:{shell:true,windowsHide:true}}:{exe:manager,args,options:{detached:true}}}

// A Chromium browser for the side browser (Chrome preferred, then Edge).
export async function findBrowser(){const home=os.homedir();
 const candidates=isWindows?[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),path.join(process.env.ProgramFiles||'C:/Program Files','Microsoft/Edge/Application/msedge.exe')]
  :isMac?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Chromium.app/Contents/MacOS/Chromium',path.join(home,'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')]
  :['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge'];
 // a server (the online copy on the AI box) has no Chrome installed system-wide: use CBA_BROWSER, or a bundled Chromium
 if(process.env.CBA_BROWSER&&await exists(process.env.CBA_BROWSER))return process.env.CBA_BROWSER;
 for(const p of candidates)if(await exists(p))return p;
 if(!isWindows&&!isMac){const {readdir}=await import('node:fs/promises');for(const [dir,sub] of [[path.join(home,'.hermes','tools'),'chrome-linux64/chrome'],[path.join(home,'.cache','ms-playwright'),'chrome-linux/chrome']]){for(const d of (await readdir(dir).catch(()=>[])).filter(x=>/^chromium-/.test(x)).sort().reverse()){const p=path.join(dir,d,sub);if(await exists(p))return p}}}
 return null}

// A long-lived shell that reads commands line by line from stdin (keeps cd, variables and history).
export function persistentShell(){
 if(isWindows)return {exe:path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),args:['-NoLogo','-NoProfile','-NoExit','-Command','-'],label:'PowerShell',prompt:'PS>',pwd:'(Get-Location).Path'};
 const sh=process.env.SHELL||(isMac?'/bin/zsh':'/bin/bash');return {exe:sh,args:['-s'],label:path.basename(sh),prompt:'%',pwd:'pwd'};
}
