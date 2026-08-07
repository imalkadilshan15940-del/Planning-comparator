@echo off
REM Option A — Python local server
REM Double-click this file to start the app.

cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel% neq 0 (
    where python3 >nul 2>nul
    if %errorlevel% neq 0 (
        echo Python was not found on this computer.
        echo Install Python from https://www.python.org/downloads/ ^(check "Add to PATH" during install^), then run this file again.
        pause
        exit /b 1
    )
    set PYCMD=python3
) else (
    set PYCMD=python
)

echo Starting server at http://localhost:8080 ...
start "" http://localhost:8080
%PYCMD% no_cache_server.py 8080
