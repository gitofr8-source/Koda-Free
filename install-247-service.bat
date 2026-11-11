@echo off
title Install Koda 24/7 Background Service
cd /d "%~dp0"

echo ================================================================
echo             Installing Koda 24/7 Background Service
echo ================================================================
echo.

:: 1. Prevent Windows from sleeping when plugged in
echo [1/3] Configuring Windows power settings (Never sleep on AC power)...
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change monitor-timeout-ac 15 >nul 2>&1
echo       Done.

:: 2. Register startup task in Windows Task Scheduler
echo [2/3] Registering task in Windows Task Scheduler (Starts on boot/login)...
schtasks /create /tn "Koda247Service" /tr "wscript.exe \"%~dp0start-247.vbs\"" /sc onlogon /rl highest /f >nul 2>&1
if %errorlevel% equ 0 (
    echo       Task 'Koda247Service' registered successfully.
) else (
    echo       Note: If prompted, run this script as Administrator.
)

:: 3. Start the service now
echo [3/3] Starting Koda 24/7 Service now...
wscript.exe "%~dp0start-247.vbs"
echo.
echo ================================================================
echo   SUCCESS! Koda is now configured to run 24/7 in the background.
echo ================================================================
echo.
echo - Starts automatically whenever Windows starts or restarts.
echo - Runs silently in the background with auto-crash recovery.
echo - Your PC won't go to sleep while plugged into power.
echo.
echo To access Koda from any device:
echo   - Local PC:             http://localhost:3000
echo   - Phones/Tablets:       http://10.91.68.151:3000
echo.
echo To stop or uninstall 24/7 mode, run 'stop-247-service.bat'.
echo ================================================================
echo.
pause
