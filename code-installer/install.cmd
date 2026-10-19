@echo off
rem Installs aqeelOS Code on this Windows computer (double-click). It runs in the background and opens inside aqeelOS.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 pause
