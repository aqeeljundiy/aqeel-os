@echo off
rem Double-click to start code by aqeel and open it in its own app window (Chrome or Edge).
setlocal
cd /d "%~dp0"
set "HUB_PORT=4321"
set "URL=http://127.0.0.1:%HUB_PORT%/"

rem Start the server only if it is not already running.
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%manifest.webmanifest' | Out-Null; exit 0}catch{exit 1}"
if errorlevel 1 (
  where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and try again. & pause & exit /b 1)
  if not exist data mkdir data
  start "code by aqeel server" /min cmd /c "node server.mjs > data\server.log 2>&1"
  powershell -NoProfile -Command "for($i=0;$i -lt 40;$i++){try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%URL%manifest.webmanifest' | Out-Null; exit 0}catch{Start-Sleep -Milliseconds 250}}; exit 1"
  if errorlevel 1 (echo The server did not start. See data\server.log & pause & exit /b 1)
)

rem Open as an app window: Chrome, then Edge, then the default browser.
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%CHROME%" (start "" "%CHROME%" --app=%URL%) else if exist "%EDGE%" (start "" "%EDGE%" --app=%URL%) else (start "" %URL%)
endlocal
