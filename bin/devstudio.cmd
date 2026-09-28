@echo off
rem Vikrant's Dev Studio launcher.
rem   devstudio          start the office (if not running) and open it in the browser
rem   devstudio stop     stop the office server
rem   devstudio status   show whether it's running
setlocal
set "STUDIO=%~dp0.."
set "PORT=4400"
set "URL=http://localhost:%PORT%"

set "PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:"127\.0\.0\.1:%PORT% .*LISTENING"') do set "PID=%%p"

if /i "%~1"=="stop" (
  if defined PID (
    taskkill /PID %PID% /T /F >nul && echo Dev Studio stopped.
  ) else (
    echo Dev Studio is not running.
  )
  exit /b 0
)

if /i "%~1"=="status" (
  if defined PID (echo Dev Studio is running at %URL% ^(pid %PID%^)) else (echo Dev Studio is not running.)
  exit /b 0
)

where node >nul 2>&1 || (echo Node.js is required but wasn't found on PATH. & exit /b 1)

if defined PID (
  echo Dev Studio is already running.
) else (
  echo Starting Vikrant's Dev Studio at %URL% ...
  rem runs in its own minimized window; close that window or run "devstudio stop" to shut it down
  start "Dev Studio server" /min /d "%STUDIO%" node tools\team-office\server.mjs %PORT%
  rem ~2s pause for the server to come up (ping works in any console, unlike timeout.exe)
  ping -n 3 127.0.0.1 >nul
)
start "" %URL%
