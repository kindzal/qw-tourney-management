param(
    [Parameter(Mandatory = $true)]
    [string]$NewTargetUrl
)

$ErrorActionPreference = "Stop"

# --------------------------------------------------
# Validate environment variables (Linkly-specific)
# --------------------------------------------------
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

Write-Host "====================================="
Write-Host " Updating URL shortener (Linkly)"
Write-Host "====================================="
Write-Host "Target URL:"
Write-Host $NewTargetUrl

$endpoint = "https://app.linklyhq.com/api/v1/link"

$headers = @{
    "Content-Type"  = "application/json"
    "cache-control" = "no-cache"
}

$body = @{
    api_key      = $env:LINKLY_API_KEY
    workspace_id = $env:LINKLY_WORKSPACE_ID
    id           = $env:LINKLY_LINK_ID
    url          = $NewTargetUrl
} | ConvertTo-Json

$response = Invoke-RestMethod `
    -Method Post `
    -Uri $endpoint `
    -Headers $headers `
    -Body $body `
    -ErrorAction Stop

Write-Host "Linkly updated successfully"