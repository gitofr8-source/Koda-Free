@echo off
title Deploy Koda to Vercel
cd /d "%~dp0"
cls
echo ================================================================
echo             KODA AI - VERCEL CLOUD DEPLOYMENT
echo ================================================================
echo  This script will deploy your Koda application to Vercel so you
echo  can access your workspace on ANY web browser and device globally.
echo ================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in your PATH.
    echo Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo Select deployment target:
echo.
echo   [1] Deploy to PRODUCTION (Live Public URL)
echo   [2] Deploy to PREVIEW (Staging URL)
echo   [3] Cancel
echo.
set /p choice="Enter your choice (1, 2, or 3): "

if "%choice%"=="1" (
    echo.
    echo Deploying to Vercel Production...
    echo (If this is your first time, Vercel will ask you to log in via browser)
    echo.
    call npx vercel --prod
    goto done
)

if "%choice%"=="2" (
    echo.
    echo Deploying to Vercel Preview...
    echo (If this is your first time, Vercel will ask you to log in via browser)
    echo.
    call npx vercel
    goto done
)

echo.
echo Deployment cancelled.
goto exit

:done
echo.
echo ================================================================
echo  Deployment completed!
echo  Your Koda workspace is now live on the web!
echo ================================================================
echo.
pause
:exit
