@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "ROOT=%~dp0"
set "PS1=%ROOT%build_and_run_frontend.ps1"

if not exist "%PS1%" (
    echo ERROR: build_and_run_frontend.ps1 was not found.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "RUN_EXIT=%ERRORLEVEL%"

if not "%RUN_EXIT%"=="0" (
    echo.
    echo frontend build/run failed with exit code %RUN_EXIT%.
    pause
)

exit /b %RUN_EXIT%
