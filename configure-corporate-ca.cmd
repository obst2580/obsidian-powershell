@echo off
setlocal

set "VAULT_TERMINAL_SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%VAULT_TERMINAL_SCRIPT_DIR%configure-corporate-ca.ps1"

if not exist "%PS_SCRIPT%" (
  echo Missing configure-corporate-ca.ps1 next to this file.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*

echo.
if errorlevel 1 (
  pause
) else (
  echo Done. You can close this window.
  pause
)

exit /b %ERRORLEVEL%
