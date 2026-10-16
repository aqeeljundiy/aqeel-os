# Builds assets\icon.ico with every size Windows uses (16-256 px) from assets\icon-512.png, each resized with
# high-quality scaling, so the app icon is sharp in Explorer, the taskbar, Alt+Tab and Start.
# Sizes below 256 are classic 32-bit bitmaps (read by every part of Windows); 256 is PNG, as Windows expects.
# Run:  powershell -ExecutionPolicy Bypass -File scripts\make-ico.ps1   (then scripts\build-exe.ps1)
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$src = [System.Drawing.Image]::FromFile((Join-Path $root 'assets\icon-512.png'))
function Scaled($s) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
  $g.DrawImage($src, 0, 0, $s, $s); $g.Dispose(); return $bmp
}
function Dib($bmp) {   # BITMAPINFOHEADER + bottom-up BGRA pixels + 1-bit AND mask (all zero: alpha decides)
  $s = $bmp.Width; $ms = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $ms
  $w.Write([UInt32]40); $w.Write([Int32]$s); $w.Write([Int32]($s * 2)); $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]0); $w.Write([UInt32]0); $w.Write([Int32]0); $w.Write([Int32]0); $w.Write([UInt32]0); $w.Write([UInt32]0)
  for ($y = $s - 1; $y -ge 0; $y--) { for ($x = 0; $x -lt $s; $x++) { $c = $bmp.GetPixel($x, $y); $w.Write([Byte]$c.B); $w.Write([Byte]$c.G); $w.Write([Byte]$c.R); $w.Write([Byte]$c.A) } }
  $row = [Math]::Ceiling($s / 32) * 4; $w.Write((New-Object Byte[] ($row * $s)))
  $w.Flush(); return ,$ms.ToArray()
}
$sizes = 16, 20, 24, 32, 40, 48, 64, 96, 128, 256
$images = foreach ($s in $sizes) {
  $bmp = Scaled $s
  if ($s -eq 256) { $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $data = $ms.ToArray() } else { $data = Dib $bmp }
  $bmp.Dispose(); ,@($s, $data)
}
$src.Dispose()
$out = [System.IO.File]::Create((Join-Path $root 'assets\icon.ico')); $w = New-Object System.IO.BinaryWriter $out
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$images.Count)   # ICONDIR
$offset = 6 + 16 * $images.Count
foreach ($i in $images) {                                                     # ICONDIRENTRY per size
  $s = $i[0]; $data = $i[1]
  $w.Write([Byte]($s % 256)); $w.Write([Byte]($s % 256)); $w.Write([Byte]0); $w.Write([Byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$data.Length); $w.Write([UInt32]$offset); $offset += $data.Length
}
foreach ($i in $images) { $w.Write([Byte[]]$i[1]) }
$w.Close()
Write-Output "assets\icon.ico: $($sizes -join ', ') px"
