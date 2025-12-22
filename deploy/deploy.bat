@echo off
SETLOCAL

REM Directory where deploy scripts live (…/app/deploy/)
SET DEPLOY_DIR=%~dp0

REM App root is parent of deploy/
SET APP_ROOT=%DEPLOY_DIR%..

REM Normalize path
FOR %%I IN ("%APP_ROOT%") DO SET APP_ROOT=%%~fI

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

REM Change to app root so clasp & .env work correctly
PUSHD "%APP_ROOT%" || (
    echo Failed to change directory to app root
    exit /b 1
)

REM Run shared PowerShell scripts by absolute path
%PS% -NoProfile -ExecutionPolicy Bypass -Command ^
  ". '%DEPLOY_DIR%Load-Env.ps1'; . '%DEPLOY_DIR%Deploy-AndUpdateLinkly.ps1'"

SET EXIT_CODE=%ERRORLEVEL%

POPD

IF %EXIT_CODE% NEQ 0 (
    echo Deployment failed
    exit /b %EXIT_CODE%
)

echo =====================================
echo   Deployment finished successfully
echo =====================================

ENDLOCAL