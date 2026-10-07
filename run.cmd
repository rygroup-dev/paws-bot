@echo off
rem Runs the bot. Uses the bundled portable Node in .runtime\node when present, else the
rem system Node. --use-system-ca makes Node trust the Windows certificate store (needed on
rem networks that re-sign HTTPS, e.g. office proxies).
cd /d "%~dp0"
chcp 65001 >nul
if exist "%~dp0.runtime\node\node.exe" set "PATH=%~dp0.runtime\node;%PATH%"
set "NODE_OPTIONS=--use-system-ca"
if "%~1"=="" (node src\index.js) else (node src\%~1.js %2 %3)
