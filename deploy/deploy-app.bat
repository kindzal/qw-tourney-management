@echo off
SETLOCAL

REM =====================================
REM Validate input parameter
REM =====================================
IF "%~1"=="" (
    echo ERROR: App name not provided.
    echo Usage: deploy-app.bat ^<app-folder^>
    exit /b 1
)

SET APP_NAME=%~1

REM Directory where this script lives (deploy/)
SET DEPLOY_DIR=%~dp0

REM Repo root is one level up from deploy/
SET REPO_ROOT=%DEPLOY_DIR%..

REM Normalize path
FOR %%I IN ("%REPO_ROOT%") DO SET REPO_ROOT=%%~fI

REM Target app directory (sibling of deploy)
SET APP_DIR=%REPO_ROOT%\%APP_NAME%

IF NOT EXIST "%APP_DIR%\.clasp.json" (
    echo ERROR: .clasp.json not found in %APP_DIR%
    exit /b 1
)

REM Shared deploy script
SET SHARED_DEPLOY=%DEPLOY_DIR%deploy.bat

IF NOT EXIST "%SHARED_DEPLOY%" (
    echo ERROR: shared deploy.bat not found in %DEPLOY_DIR%
    exit /b 1
)

echo =====================================
echo   Deploying %APP_NAME%
echo =====================================

REM Change to app directory so clasp sees .clasp.json
PUSHD "%APP_DIR%" || (
    echo Failed to change directory to %APP_DIR%
    exit /b 1
)

CALL "%SHARED_DEPLOY%"
SET EXIT_CODE=%ERRORLEVEL%

POPD

IF %EXIT_CODE% NEQ 0 (
    echo %APP_NAME% deployment failed
    exit /b %EXIT_CODE%
)

echo =====================================
echo   %APP_NAME% deployment completed
echo =====================================

ENDLOCAL