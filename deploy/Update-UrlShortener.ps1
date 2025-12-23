param(
    [Parameter(Mandatory = $true)]
    [string]$NewTargetUrl
)

$ErrorActionPreference = "Stop"

# --------------------------------------------------
# Validate environment variables
# --------------------------------------------------
$requiredVars = @(
    "URL_SHORTENER_API_KEY",
    "URL_SHORTENER_LINK_ID"
)

foreach ($var in $requiredVars) {
    if (-not (Get-Item "Env:$var" -ErrorAction SilentlyContinue)) {
        throw "ERROR: Required environment variable $var is missing."
    }
}

$apiKey = $env:URL_SHORTENER_API_KEY
$linkId = $env:URL_SHORTENER_LINK_ID

# --------------------------------------------------
# Build request
# --------------------------------------------------
$endpoint = "https://api.short.io/links/$linkId"

$headers = @{
    "accept"        = "application/json"
    "content-type"  = "application/json"
    "Authorization" = $apiKey
}

$body = @{
    skipQS       = $false
    archived     = $false
    redirectType = 307
    originalURL  = $NewTargetUrl
} | ConvertTo-Json -Depth 5

Write-Host "====================================="
Write-Host " Updating URL shortener (Short.io)"
Write-Host "====================================="
Write-Host "Target URL:"
Write-Host $NewTargetUrl

# --------------------------------------------------
# Execute request
# --------------------------------------------------
try {
    $response = Invoke-WebRequest `
        -Uri $endpoint `
        -Method Post `
        -Headers $headers `
        -Body $body `
        -ErrorAction Stop
}
catch {
    throw "ERROR: URL shortener request failed. $_"
}

# --------------------------------------------------
# Validate response
# --------------------------------------------------
if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
    throw "ERROR: URL shortener returned HTTP $($response.StatusCode)"
}

$responseJson = $response.Content | ConvertFrom-Json

if ($responseJson.originalURL -ne $NewTargetUrl) {
    throw @"
ERROR: URL shortener update verification failed.
Expected: $NewTargetUrl
Returned: $($responseJson.originalURL)
"@
}

Write-Host "URL shortener updated successfully"
Write-Host "Short URL:"
Write-Host $responseJson.shortURL
