@echo off
REM Option B — Node local server
REM Double-click this file to start the app.

cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js was not found on this computer.
    echo Install it from https://nodejs.org/ ^(LTS version^), then run this file again.
    pause
    exit /b 1
)

echo Starting server at http://localhost:3000 ...
start "" http://localhost:3000
node no_cache_server.js 3000
