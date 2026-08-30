$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

$requiredVariables = @(
  'TWA_SIGNING_KEY_PATH',
  'TWA_SIGNING_KEY_ALIAS',
  'BUBBLEWRAP_KEYSTORE_PASSWORD',
  'BUBBLEWRAP_KEY_PASSWORD'
)

foreach ($name in $requiredVariables) {
  $value = [Environment]::GetEnvironmentVariable($name, 'Process')
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Required process environment variable '$name' is not set."
  }
}

$keystorePath = (Resolve-Path -LiteralPath $env:TWA_SIGNING_KEY_PATH).Path
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot '../..')).Path
if ($keystorePath.StartsWith($repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The permanent release keystore must be stored outside the repository.'
}

& (Join-Path $PSScriptRoot 'check-config.ps1') -ReleasePrerequisites
if ($LASTEXITCODE -ne 0) {
  throw 'Preflight checks failed.'
}

Push-Location $projectRoot
try {
  & npm exec -- bubblewrap build `
    --signingKeyPath="$keystorePath" `
    --signingKeyAlias="$env:TWA_SIGNING_KEY_ALIAS"
  if ($LASTEXITCODE -ne 0) {
    throw "Bubblewrap release build failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

Write-Host 'Release artifacts created. Keep the permanent keystore and passwords outside this repository.'
