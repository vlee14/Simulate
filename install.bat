@echo off
:: ============================================================
::  install.bat  –  Install all dependencies for Simulate
:: ============================================================
setlocal

echo.
echo  [Simulate] Checking prerequisites...
echo.

:: ---------- Node.js ----------
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed or not on PATH.
    echo         Download it from https://nodejs.org/  (LTS recommended)
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% found.

:: ---------- npm ----------
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] npm is not available. Re-install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('npm --version') do set NPM_VER=%%v
echo  [OK] npm %NPM_VER% found.

:: ---------- Install ----------
echo.
echo  [Simulate] Installing dependencies (this may take a minute)...
echo.

cd /d "%~dp0"
call npm install

if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] npm install failed. Check the output above for details.
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo   Installation complete!
echo   Run  serve.bat  to start the development server.
echo  ============================================================
echo.
pause
endlocal
