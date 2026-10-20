# Desktop control helper for Windows, used by code by aqeel's computer-use tools.
# Reads one JSON request per line on stdin and answers one JSON line on stdout. Started and stopped by desktop.mjs.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class CbaWin {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int d, UIntPtr e);
 [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
 public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[void][CbaWin]::SetProcessDPIAware()

function Get-Win($id) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if (-not $p -or $p.MainWindowHandle -eq 0) { throw 'That app is not open (or has no window). List apps again.' }
  $p
}
function Focus-Win($p) {
  $h = $p.MainWindowHandle
  if ([CbaWin]::IsIconic($h)) { [void][CbaWin]::ShowWindow($h, 9) }
  # a tap of Alt lets this background process bring another window to the front
  [CbaWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [CbaWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [void][CbaWin]::SetForegroundWindow($h); Start-Sleep -Milliseconds 200
  # never click or type into whatever else happens to be in front
  if ([CbaWin]::GetForegroundWindow() -ne $h) { throw "Could not bring $($p.ProcessName) to the front. Ask the user to click its window once, then try again." }
}
function Get-Rect($p) { $r = New-Object CbaWin+RECT; [void][CbaWin]::GetWindowRect($p.MainWindowHandle, [ref]$r); $r }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $m = $line | ConvertFrom-Json; $res = @{ ok = $true }
    switch ($m.op) {
      'list' {
        $res.apps = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { @{ pid = $_.Id; name = $_.ProcessName; title = $_.MainWindowTitle } })
      }
      'shot' {
        # PrintWindow renders only this window, even when other windows cover it
        $p = Get-Win $m.pid; if ([CbaWin]::IsIconic($p.MainWindowHandle)) { [void][CbaWin]::ShowWindow($p.MainWindowHandle, 9); Start-Sleep -Milliseconds 300 }; $r = Get-Rect $p
        $w = [Math]::Max(1, $r.Right - $r.Left); $h = [Math]::Max(1, $r.Bottom - $r.Top)
        $bmp = New-Object Drawing.Bitmap $w, $h; $g = [Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc(); $ok = [CbaWin]::PrintWindow($p.MainWindowHandle, $hdc, 2); $g.ReleaseHdc($hdc); $g.Dispose()
        if (-not $ok) { throw 'This window cannot be captured.' }
        $scale = [Math]::Min(1.0, [double]$m.max / [Math]::Max($w, $h))
        $ow = [int][Math]::Round($w * $scale); $oh = [int][Math]::Round($h * $scale)
        $out = New-Object Drawing.Bitmap $bmp, $ow, $oh; $ms = New-Object IO.MemoryStream; $out.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
        $res.png = [Convert]::ToBase64String($ms.ToArray()); $res.width = $ow; $res.height = $oh; $res.scale = $scale
        $bmp.Dispose(); $out.Dispose()
      }
      'click' {
        $p = Get-Win $m.pid; Focus-Win $p; $r = Get-Rect $p
        [void][CbaWin]::SetCursorPos($r.Left + [int]$m.x, $r.Top + [int]$m.y); Start-Sleep -Milliseconds 60
        $down = 2; $up = 4; if ($m.button -eq 'right') { $down = 8; $up = 16 }
        $times = 1; if ($m.double) { $times = 2 }
        for ($i = 0; $i -lt $times; $i++) { [CbaWin]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero); [CbaWin]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60 }
      }
      'keys' { $p = Get-Win $m.pid; Focus-Win $p; [Windows.Forms.SendKeys]::SendWait([string]$m.keys) }
      'scroll' {
        $p = Get-Win $m.pid; Focus-Win $p; $r = Get-Rect $p
        [void][CbaWin]::SetCursorPos($r.Left + [int]$m.x, $r.Top + [int]$m.y)
        [CbaWin]::mouse_event(0x0800, 0, 0, [int](-120 * [int]$m.clicks), [UIntPtr]::Zero)
      }
      default { throw "Unknown request $($m.op)" }
    }
  } catch { $res = @{ ok = $false; error = $_.Exception.Message } }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 4))
}
