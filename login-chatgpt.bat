@echo off
title Koda - Connect ChatGPT Account
cd /d "%~dp0"
echo ========================================================
echo   Koda ChatGPT Mirror - Account Sign-In
echo ========================================================
echo Opening browser window to https://chatgpt.com...
echo Please log in with your Google, Apple, or OpenAI account.
echo.
echo Once logged in, your session is saved permanently in:
echo   D:\KODA files\data\chatgpt-profile
echo.
echo You can then close the browser window.
echo ========================================================
node chatgpt-bridge.js --login
pause
