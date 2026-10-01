@echo off
rem Double-click to get the latest version of the Dev Studio and restart it.
setlocal
where node >nul 2>&1 || (echo Node.js is needed but wasn't found. Install it from https://nodejs.org ^(version 20 or newer^). & pause & exit /b 1)
node "%~dp0..\tools\team-office\launch.mjs" update
pause
