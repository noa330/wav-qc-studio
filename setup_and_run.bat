@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "ROOT=%~dp0"
set "PS1=%ROOT%setup_and_run.ps1"

if not exist "%PS1%" (
    echo ERROR: setup_and_run.ps1 was not found.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "SETUP_EXIT=%ERRORLEVEL%"

if not "%SETUP_EXIT%"=="0" (
    echo.
    echo setup_and_run failed with exit code %SETUP_EXIT%.
    pause
)

exit /b %SETUP_EXIT%
