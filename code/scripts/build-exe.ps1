# Builds "code by aqeel.exe" in the app folder from launcher\launcher.cs with the C# compiler that ships with Windows.
# The native window uses Microsoft's WebView2 SDK assemblies in launcher\bin (from the Microsoft.Web.WebView2 NuGet package).
# Run:  powershell -ExecutionPolicy Bypass -File scripts\build-exe.ps1
$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'The .NET Framework C# compiler (csc.exe) was not found.' }
$bin = Join-Path $root 'launcher\bin'
$out = Join-Path $root 'code by aqeel.exe'
& $csc /nologo /target:winexe /optimize+ /platform:x64 "/win32icon:$(Join-Path $root 'assets\icon.ico')" "/out:$out" /r:System.Windows.Forms.dll /r:System.Drawing.dll "/r:$bin\Microsoft.Web.WebView2.Core.dll" "/r:$bin\Microsoft.Web.WebView2.WinForms.dll" (Join-Path $root 'launcher\launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
Write-Output "Built $out"
