@echo off
title Koda Local Server
cd /d "%~dp0"
echo Starting Koda local server...
echo.
start http://localhost:3000
node server.js
if %errorlevel% neq 0 (
    echo.
    echo Server stopped with an error. Check if Node.js is installed.
    pause
)
