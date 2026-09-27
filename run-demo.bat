@echo off
title StreetVision Demo Runner
echo ===================================================
echo           StreetVision - Windows Launcher
echo ===================================================
echo.

:: Detect Python
where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    set PY_CMD=python
) else (
    where py >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        set PY_CMD=py
    ) else (
        echo [ERROR] Python is not installed or not in your PATH.
        echo Please install Python from https://www.python.org/
        pause
        exit /b 1
    )
)

:: Detect Node / npm
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js / npm is not installed or not in your PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Starting StreetVision Mock Backend on port 8001...
start "StreetVision Backend" %PY_CMD% backend\api_server.py

echo Installing frontend dependencies if needed...
cd frontend\front
if not exist node_modules (
    call npm install
)

echo Starting frontend dev server...
echo.
echo Once started, open your browser to the URL shown below (usually http://localhost:5173 or :5175)
echo.
call npm run dev

pause
