# aqeelOS Code for Windows: copies the app to your user folder, makes it start (hidden) when you sign in to Windows,
# starts it now and opens Code in aqeelOS. Run it again to update or repair. Nothing needs administrator rights,
# except installing Node.js the first time (Windows asks).
$ErrorActionPreference = 'Stop'
$src  = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'aqeelOS Code'
Write-Host "Installing aqeelOS Code..." -ForegroundColor Cyan

# 1. Node.js 22 or newer
function NodeMajor { try { [int]((node -v).TrimStart('v').Split('.')[0]) } catch { 0 } }
if ((NodeMajor) -lt 22) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "Installing Node.js (Windows may ask for permission)..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent | Out-Null
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  }
  if ((NodeMajor) -lt 22) { Write-Host "Please install Node.js 22 or newer from https://nodejs.org, then run this installer again." -ForegroundColor Yellow; Start-Process 'https://nodejs.org'; exit 1 }
}

# 2. Stop a running copy, then copy the app (your projects and settings in its data folder stay)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*aqeelOS Code*server.mjs*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
robocopy $src $dest /E /XF 'Install aqeelOS Code.cmd' 'install.ps1' /NFL /NDL /NJH /NJS /NP | Out-Null
Push-Location $dest
Write-Host "Getting its parts (a minute the first time)..."
npm install --no-audit --no-fund --loglevel=error | Out-Null
Pop-Location

# 3. Start hidden now and whenever you sign in to Windows
$vbs = Join-Path $dest 'start-hidden.vbs'
@"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$dest"
sh.Environment("Process")("HUB_PORT") = "4321"
sh.Run "node server.mjs", 0, False
"@ | Set-Content -Encoding ASCII $vbs
$startup = [Environment]::GetFolderPath('Startup')
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startup 'aqeelOS Code.lnk'))
$lnk.TargetPath = 'wscript.exe'; $lnk.Arguments = '"' + $vbs + '"'; $lnk.WorkingDirectory = $dest; $lnk.Save()
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"')

# 4. The coding tools it can use (each is optional; sign in to them once)
foreach ($t in @(@('claude','Claude Code','https://claude.com/claude-code'), @('codex','Codex','https://developers.openai.com/codex'))) {
  if (-not (Get-Command $t[0] -ErrorAction SilentlyContinue)) { Write-Host ("Optional: install " + $t[1] + " to code with it (" + $t[2] + ").") -ForegroundColor DarkGray }
}

# 5. Open Code in aqeelOS
$base = (Get-Content (Join-Path $dest 'aqeelos.json') -Raw | ConvertFrom-Json).aqeelos.base
Start-Sleep -Seconds 3
Start-Process ($base + '/#/code/code')
Write-Host "Done. aqeelOS Code runs in the background and opens inside aqeelOS." -ForegroundColor Green
