@echo off
setlocal
cd /d "%~dp0"

echo [INFO] Checking dependencies...
if not exist "node_modules" (
    echo [INFO] Installing required dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

echo [INFO] Starting Minecraft Keep-Alive Bot...
node bot.js

endlocal
