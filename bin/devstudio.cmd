@echo off
rem 9to5 launcher for Windows. Double-click it, or run: devstudio start, update, stop or status
rem   devstudio          start the office and open it in the browser (an older version still running is replaced)
rem   devstudio update   get the latest version and restart the office
rem   devstudio stop     stop the office (and any run it is doing)
rem   devstudio status   show whether it is running
rem The work is done by tools\team-office\launch.mjs, shared with the macOS/Linux launcher.
setlocal
where node >nul 2>&1 || (echo Node.js is needed but wasn't found. Install it from https://nodejs.org ^(version 20 or newer^), then run devstudio again. & pause & exit /b 1)
node "%~dp0..\tools\team-office\launch.mjs" %*
rem keep the window open when something went wrong, so the message can be read
if errorlevel 1 pause
