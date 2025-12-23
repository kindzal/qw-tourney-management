$ErrorActionPreference = "Stop"

Write-Host "====================================="
Write-Host " Pushing local code to Apps Script"
Write-Host "====================================="

$pushOutput = clasp push --force 2>&1
$pushOutput | ForEach-Object { Write-Host $_ }

if ($LASTEXITCODE -ne 0) {
    throw "ERROR: clasp push failed."
}

Write-Host ""
Write-Host "====================================="
Write-Host " Deploying Google Apps Script"
Write-Host "====================================="

$claspArgs = @("deploy", "--json")

if ($env:DEPLOYMENT_ID) {
    Write-Host "Reusing deployment ID: $($env:DEPLOYMENT_ID)"
    $claspArgs += @("--deploymentId", $env:DEPLOYMENT_ID)
}

$deployOutput = & clasp @claspArgs 2>&1
$deployOutput | ForEach-Object { Write-Host $_ }

if ($LASTEXITCODE -ne 0) {
    throw "ERROR: clasp deploy failed."
}

$deployJson = $deployOutput | ConvertFrom-Json

if (-not $deployJson.deploymentId) {
    throw "ERROR: deploymentId missing from clasp output."
}

$deploymentId = $deployJson.deploymentId
$webAppUrl = "https://script.google.com/macros/s/$deploymentId/exec"

Write-Host ""
Write-Host "====================================="
Write-Host " Deployment URL"
Write-Host "====================================="
Write-Host $webAppUrl

# --------------------------------------------------
# Update URL shortener (Short.io by default)
# --------------------------------------------------
$shortenerScript = Join-Path $PSScriptRoot "Update-UrlShortener.ps1"

if (-not (Test-Path $shortenerScript)) {
    throw "ERROR: Update-UrlShortener.ps1 not found."
}

& $shortenerScript -NewTargetUrl $webAppUrl