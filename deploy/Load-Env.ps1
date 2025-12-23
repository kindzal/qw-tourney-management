param(
    [string]$EnvFilePath
)

$ErrorActionPreference = "Stop"

# --------------------------------------------------
# Resolve app root (parent of deploy/)
# --------------------------------------------------
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot   = Resolve-Path (Join-Path $scriptDir "..")

# Default .env path = app root
if (-not $EnvFilePath) {
    $EnvFilePath = Join-Path $appRoot ".env"
}

if (-not (Test-Path $EnvFilePath)) {
    throw "ERROR: .env file not found at path: $EnvFilePath"
}

Write-Host "Loading environment variables from $EnvFilePath"

Get-Content $EnvFilePath | ForEach-Object {

    $line = $_.Trim()

    if ($line -eq "" -or $line.StartsWith("#")) {
        return
    }

    $parts = $line -split "=", 2

    if ($parts.Count -ne 2) {
        Write-Warning "Skipping invalid line: $line"
        return
    }

    $key   = $parts[0].Trim()
    $value = $parts[1].Trim()

    if (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
        $value = $value.Substring(1, $value.Length - 2)
    }

    [System.Environment]::SetEnvironmentVariable(
        $key,
        $value,
        "Process"
    )

    Write-Host "Loaded $key"
}

Write-Host "Environment variables loaded successfully"