@echo off
cd /d "%~dp0"
if exist "Koda.exe" (
    start "" "Koda.exe"
    exit /b
)
if exist "Koda.vbs" (
    start "" wscript.exe "Koda.vbs"
    exit /b
)
start /b "" node server.js
timeout /t 1 /nobreak >nul 2>&1
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="http://localhost:3000" --app-id="koda-frontier-ai" --window-size=1360,860
exit /b
