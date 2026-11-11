@echo off
setlocal
title Push Koda to GitHub (Koda-Free)
cd /d "%~dp0"
cls
echo ================================================================
echo             PUSH KODA FREE TO GITHUB REPOSITORY
echo       Target: https://github.com/gitofr8-source/Koda-Free.git
echo ================================================================
echo.
echo All files (Website, Workspace, Vercel Serverless, Android app)
echo are committed locally on the 'main' branch!
echo.
echo Choose authentication method:
echo.
echo   [1] Interactive Login (Git Credential Manager - Browser Popup)
echo   [2] Paste a GitHub Personal Access Token (PAT)
echo   [3] Exit
echo.
set /p choice="Enter choice (1, 2, or 3): "

if "%choice%"=="1" goto do_browser
if "%choice%"=="2" goto do_pat
echo.
echo Operation cancelled.
goto exit

:do_browser
echo.
echo Opening GitHub authentication...
git push -u origin main
goto done

:do_pat
echo.
set /p pat="Paste your GitHub Personal Access Token: "
echo.
echo Pushing to GitHub...
git push "https://oauth2:%pat%@github.com/gitofr8-source/Koda-Free.git" main
goto done

:done
if %errorlevel% equ 0 (
    echo.
    echo ================================================================
    echo  SUCCESS! All code has been pushed to:
    echo  https://github.com/gitofr8-source/Koda-Free
    echo.
    echo  To make your GitHub Pages domain live:
    echo   1. Open https://github.com/gitofr8-source/Koda-Free/settings/pages
    echo   2. Set Branch to "main" and folder "/ (root)", then click Save
    echo   3. Your live site will deploy at:
    echo      https://gitofr8-source.github.io/Koda-Free/
    echo ================================================================
) else (
    echo.
    echo Push encountered an issue. Check the error above and try again.
)
echo.
pause
:exit
