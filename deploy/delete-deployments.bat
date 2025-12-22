@echo off
SETLOCAL

REM =====================================
REM Validate input
REM =====================================
IF "%~1"=="" (
    echo ERROR: App name not provided.
    echo Usage:
    echo   delete-deployments.bat ^<app-name^> [--dry-run]
    exit /b 1
)

SET APP_NAME=%~1
SET DRY_RUN_FLAG=

IF /I "%~2"=="--dry-run" (
    SET DRY_RUN_FLAG=-DryRun
)

REM Resolve deploy directory (this script's location)
SET DEPLOY_DIR=%~dp0

REM PowerShell script path
SET PS_SCRIPT=%DEPLOY_DIR%delete-deployments.ps1

IF NOT EXIST "%PS_SCRIPT%" (
    echo ERROR: delete-deployments.ps1 not found in %DEPLOY_DIR%
    exit /b 1
)

REM Prefer PowerShell Core if available
where pwsh >nul 2>&1
IF %ERRORLEVEL%==0 (
    SET PS=pwsh
) ELSE (
    SET PS=powershell
)

echo =====================================
echo   Deleting deployments for %APP_NAME%
echo =====================================

%PS% -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" ^
    -AppName "%APP_NAME%" %DRY_RUN_FLAG%

IF %ERRORLEVEL% NEQ 0 (
    echo Deployment cleanup failed
    exit /b %ERRORLEVEL%
)

echo =====================================
echo   Deployment cleanup completed
echo =====================================

ENDLOCAL