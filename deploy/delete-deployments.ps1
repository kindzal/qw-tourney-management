param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# --------------------------------------------------
# Resolve paths
# --------------------------------------------------
$deployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir    = Resolve-Path (Join-Path $deployDir "..")

if (-not (Test-Path $appDir)) {
    throw "ERROR: App directory not found: $appDir"
}

if (-not (Test-Path (Join-Path $appDir ".clasp.json"))) {
    throw "ERROR: .clasp.json not found in $appDir"
}

Write-Host "====================================="
Write-Host " Deleting deployments for current app"
Write-Host "====================================="

Push-Location $appDir

try {
    # --------------------------------------------------
    # Fetch deployments
    # --------------------------------------------------
    Write-Host "Fetching deployments..."

    $deploymentsJsonRaw = clasp deployments --json

    if (-not $deploymentsJsonRaw) {
        throw "ERROR: clasp deployments returned no output."
    }

    # IMPORTANT: top-level JSON array
    $deployments = $deploymentsJsonRaw | ConvertFrom-Json

    if (-not $deployments -or $deployments.Count -eq 0) {
        Write-Host " No deployments found."
        return
    }

    # --------------------------------------------------
    # Extract deployment IDs
    # --------------------------------------------------
    $deploymentIds = $deployments |
        Where-Object { $_.deploymentId } |
        Select-Object -ExpandProperty deploymentId

    if (-not $deploymentIds -or $deploymentIds.Count -eq 0) {
        throw "ERROR: Failed to parse deploymentIds from clasp output."
    }

    Write-Host "Found $($deploymentIds.Count) deployment(s):"
    $deploymentIds | ForEach-Object { Write-Host " - $_" }

    # --------------------------------------------------
    # Dry run support
    # --------------------------------------------------
    if ($DryRun) {
        Write-Host ""
        Write-Host " Dry-run enabled. No deployments will be deleted."
        return
    }

    # --------------------------------------------------
    # Confirmation prompt
    # --------------------------------------------------
    Write-Host ""
    $confirmation = Read-Host "Type DELETE to confirm deletion"

    if ($confirmation -ne "DELETE") {
        Write-Host " Aborted by user."
        return
    }

    # --------------------------------------------------
    # Delete deployments
    # --------------------------------------------------
    foreach ($deploymentId in $deploymentIds) {
        Write-Host "Deleting deployment: $deploymentId"
        clasp delete-deployment $deploymentId
    }

    Write-Host " All deployments deleted successfully."
}
finally {
    Pop-Location
}
