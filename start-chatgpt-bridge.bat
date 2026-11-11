@echo off
title Koda ChatGPT Local Mirror Bridge
cd /d "%~dp0"
echo Starting Koda ChatGPT Local Mirror Bridge on port 3001...
node chatgpt-bridge.js
pause
