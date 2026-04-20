@echo off
cd /d "%~dp0"
echo ==============================================
echo       DanGol-Biseo B2B System Launcher
echo ==============================================
echo.
echo [1] Starting local server for secure SMS...
echo (Do not close the new black window!)
start "DanGol Server" cmd /k "title DanGol Server & node server.js"

echo [2] Opening dashboard...
timeout /t 3 >nul
start "" "http://localhost:3060"

exit
