param(
    [string]$EnvFilePath = ".env"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $EnvFilePath)) {
    throw "ERROR: .env file not found at path: $EnvFilePath"
}

Write-Host "Loading environment variables from $EnvFilePath"

Get-Content $EnvFilePath | ForEach-Object {

    $line = $_.Trim()

    # Skip empty lines and comments
    if ($line -eq "" -or $line.StartsWith("#")) {
        return
    }

    # Split only on the first '='
    $parts = $line -split "=", 2

    if ($parts.Count -ne 2) {
        Write-Warning "Skipping invalid line: $line"
        return
    }

    $key   = $parts[0].Trim()
    $value = $parts[1].Trim()

    # Remove surrounding quotes if present
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