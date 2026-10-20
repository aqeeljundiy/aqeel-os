# Adds "code by aqeel" to the Start menu (and optionally the desktop), pointing at the double-click launcher.
# Run once:  powershell -ExecutionPolicy Bypass -File scripts\add-windows-shortcut.ps1 [-Desktop]
param([switch]$Desktop)
$root = Split-Path -Parent $PSScriptRoot
# prefer the app launcher (built by scripts/build-exe.ps1); fall back to the .cmd
$launcher = Join-Path $root 'code by aqeel.exe'
if (-not (Test-Path $launcher)) { $launcher = Join-Path $root 'Start code by aqeel.cmd' }
$icon = Join-Path $root 'assets\icon.ico'

# an .ico made from the 512px PNG (Windows shortcuts need .ico)
if (-not (Test-Path $icon)) {
  Add-Type -AssemblyName System.Drawing
  $png = [System.Drawing.Bitmap]::FromFile((Join-Path $root 'assets\icon-512.png'))
  $small = New-Object System.Drawing.Bitmap $png, 256, 256
  $stream = [System.IO.File]::Create($icon)
  $ms = New-Object System.IO.MemoryStream; $small.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bytes = $ms.ToArray()
  $w = New-Object System.IO.BinaryWriter $stream
  $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)            # ICONDIR: reserved, type icon, 1 image
  $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0); $w.Write([Byte]0) # 256x256, no palette
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$bytes.Length); $w.Write([UInt32]22)
  $w.Write($bytes); $w.Close(); $png.Dispose(); $small.Dispose()
}

$shell = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Programs'))
if ($Desktop) { $targets += [Environment]::GetFolderPath('Desktop') }
foreach ($folder in $targets) {
  $link = $shell.CreateShortcut((Join-Path $folder 'code by aqeel.lnk'))
  $link.TargetPath = $launcher
  $link.WorkingDirectory = $root
  $link.IconLocation = $icon
  $link.WindowStyle = 7   # minimized: the launcher window closes once the app opens
  $link.Description = 'Claude, GPT and Gemini in one local workspace'
  $link.Save()
  Write-Output "Shortcut created in $folder"
}
