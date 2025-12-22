@echo off
SETLOCAL

REM Directory where shared scripts live
SET DEPLOY_ROOT=%~dp0

echo =====================================
echo   Starting Apps Script deployment
echo =====================================

REM Prefer PowerShell Core if available
where pwsh >nul 2>&1
IF %ERRORLEVEL%==0 (
    SET PS=pwsh
) ELSE (
    SET PS=powershell
)

%PS% -NoProfile -ExecutionPolicy Bypass -Command ^
  ". '%DEPLOY_ROOT%Load-Env.ps1'; . '%DEPLOY_ROOT%Deploy-AndUpdateLinkly.ps1'"

IF %ERRORLEVEL% NEQ 0 (
    echo Deployment failed
    exit /b 1
)

echo =====================================
echo   Deployment finished successfully
echo =====================================

ENDLOCAL