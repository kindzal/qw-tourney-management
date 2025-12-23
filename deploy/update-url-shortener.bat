@echo off
SETLOCAL

where pwsh >nul 2>&1
IF %ERRORLEVEL%==0 (
    SET PS=pwsh
) ELSE (
    SET PS=powershell
)

%PS% -NoProfile -ExecutionPolicy Bypass -Command ^
  ". '%~dp0Load-Env.ps1'; . '%~dp0Update-UrlShortener.ps1' -NewTargetUrl '%~1'"

ENDLOCAL