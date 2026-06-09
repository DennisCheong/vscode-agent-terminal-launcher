@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

if not defined OUT_DIR set "OUT_DIR=dist"
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set "VERSION=%%v"
if not defined OUT_FILE set "OUT_FILE=%OUT_DIR%\agent-terminal-launcher-%VERSION%.vsix"

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

call npm i --no-package-lock --no-audit --no-fund
if errorlevel 1 exit /b %errorlevel%

call npm run package -- --out "%OUT_FILE%"

if errorlevel 1 exit /b %errorlevel%

echo Built VSIX: %OUT_FILE%
