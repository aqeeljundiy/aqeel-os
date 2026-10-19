# Removes aqeelOS Code from this Windows user: stops it, removes it from start-up and deletes its folder.
# Your projects (its data folder) are kept in Documents\aqeelOS Code data, unless you pass -DeleteData.
param([switch]$DeleteData)
$dest = Join-Path $env:LOCALAPPDATA 'aqeelOS Code'
Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'wscript.exe' -and $_.CommandLine -like "*aqeelOS Code*start-hidden.vbs*") -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like "*aqeelOS Code*server.mjs*") } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path ([Environment]::GetFolderPath('Startup')) 'aqeelOS Code.lnk')
if (-not $DeleteData -and (Test-Path (Join-Path $dest 'data'))) { $keep = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'aqeelOS Code data'; Move-Item -Force (Join-Path $dest 'data') $keep; Write-Host "Your data is kept in $keep" }
Set-Location $env:TEMP
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $dest
Write-Host "aqeelOS Code is removed. You can unpair this computer in aqeelOS (Code)." -ForegroundColor Green
