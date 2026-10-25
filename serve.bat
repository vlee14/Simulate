@echo off
:: ============================================================
::  serve.bat  –  Start the Simulate dev server
:: ============================================================
setlocal

cd /d "%~dp0"

:: Guard: make sure dependencies are installed
if not exist "node_modules" (
    echo.
    echo  [Simulate] node_modules not found. Running install first...
    echo.
    call install.bat
    if %errorlevel% neq 0 exit /b 1
)

echo.
echo  ============================================================
echo   Starting Simulate dev server at http://localhost:5173
echo   Press Ctrl+C to stop.
echo  ============================================================
echo.

call npm run dev

endlocal
