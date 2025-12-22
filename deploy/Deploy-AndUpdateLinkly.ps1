$ErrorActionPreference = "Stop"

# Validate required environment variables
$requiredVars = @(
    "LINKLY_API_KEY",
    "LINKLY_WORKSPACE_ID",
    "LINKLY_LINK_ID"
)

foreach ($var in $requiredVars) {
    if (-not (Get-Item "Env:$var" -ErrorAction SilentlyContinue)) {
        throw "ERROR: Required environment variable $var is missing."
    }
}

Write-Host "Deploying Google Apps Script..."

# Build clasp arguments
$claspArgs = @("deploy", "--json")

if ($env:DEPLOYMENT_ID) {
    Write-Host "Reusing deployment ID: $($env:DEPLOYMENT_ID)"
    $claspArgs += @("--deploymentId", $env:DEPLOYMENT_ID)
}

# Run clasp deploy
$deployOutput = & clasp @claspArgs

if (-not $deployOutput) {
    throw "ERROR: clasp deploy returned no output."
}

$deployJson = $deployOutput | ConvertFrom-Json

if (-not $deployJson.deploymentId) {
    throw "ERROR: deploymentId not found in clasp output."
}

$deploymentId = $deployJson.deploymentId

# Construct Web App URL
$webAppUrl = "https://script.google.com/macros/s/$deploymentId/exec"

Write-Host "Web App URL:"
Write-Host $webAppUrl

# Linkly endpoint
$linklyEndpoint = "https://app.linklyhq.com/api/v1/link"

# Headers (including cache-control)
$headers = @{
    "Content-Type"  = "application/json"
    "cache-control" = "no-cache"
}

# Request body (exactly as Linkly requires)
$body = @{
    api_key      = $env:LINKLY_API_KEY
    workspace_id = $env:LINKLY_WORKSPACE_ID
    id           = $env:LINKLY_LINK_ID
    url          = $webAppUrl
} | ConvertTo-Json

Write-Host "Updating Linkly link..."

Invoke-RestMethod `
    -Method Post `
    -Uri $linklyEndpoint `
    -Headers $headers `
    -Body $body

Write-Host "Deployment complete and Linkly updated successfully"