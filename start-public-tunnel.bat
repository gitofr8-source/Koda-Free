@echo off
title Koda - Public Internet Tunnel (Access from any Wi-Fi)
echo ===================================================================
echo   Starting Cloudflare Tunnel for Koda (Port 3000)...
echo   This creates a secure HTTPS link to access Koda from ANY device.
echo ===================================================================
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000
pause
