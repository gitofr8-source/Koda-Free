@echo off
title Stop Koda 24/7 Background Service
cd /d "%~dp0"

echo ================================================================
echo             Stopping Koda 24/7 Background Service
echo ================================================================
echo.

echo [1/2] Removing startup task from Task Scheduler...
schtasks /delete /tn "Koda247Service" /f >nul 2>&1
echo       Done.

echo [2/2] Terminating background server processes...
taskkill /f /im node.exe >nul 2>&1
echo       Done.

echo.
echo Koda 24/7 background service has been stopped and uninstalled.
echo You can run 'start-server.bat' to run it manually whenever needed.
echo ================================================================
pause
