param(
  [string]$ApkPath = './app-release-signed.apk'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedApk = (Resolve-Path -LiteralPath (Join-Path $projectRoot $ApkPath)).Path

$sdkRoot = Join-Path $env:USERPROFILE '.bubblewrap/android_sdk'
$signer = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Filter 'apksigner.bat' -Recurse -ErrorAction Stop |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (-not $signer) {
  throw 'apksigner.bat was not found in the Bubblewrap Android SDK.'
}

$certificateOutput = & $signer.FullName verify --print-certs $resolvedApk 2>&1
if ($LASTEXITCODE -ne 0) {
  throw 'APK signature verification failed.'
}

$digestLine = $certificateOutput | Where-Object { $_ -match 'Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]+)' } | Select-Object -First 1
if (-not $digestLine) {
  throw 'The APK signer SHA-256 digest was not found.'
}

$hex = ([regex]::Match($digestLine, '([0-9a-fA-F]{64})')).Groups[1].Value.ToUpperInvariant()
$fingerprint = (($hex -split '(.{2})' | Where-Object { $_ }) -join ':')

$assetLinks = @(
  [ordered]@{
    relation = @('delegate_permission/common.handle_all_urls')
    target = [ordered]@{
      namespace = 'android_app'
      package_name = 'ph.duediligence.admin'
      sha256_cert_fingerprints = @($fingerprint)
    }
  }
)

$outputPath = Join-Path $projectRoot 'assetlinks.generated.json'
$assetLinks | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $outputPath -Encoding utf8
Write-Host "Release certificate SHA-256: $fingerprint"
Write-Host "Generated: $outputPath"
