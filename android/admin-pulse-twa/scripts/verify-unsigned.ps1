$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$apkPath = Join-Path $projectRoot 'app-release-unsigned-aligned.apk'
$aabPath = Join-Path $projectRoot 'app/build/outputs/bundle/release/app-release.aab'

foreach ($artifact in @($apkPath, $aabPath)) {
  if (-not (Test-Path -LiteralPath $artifact)) {
    throw "Expected unsigned build artifact is missing: $artifact"
  }
}

$bubblewrapConfig = Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.bubblewrap/config.json') -Raw | ConvertFrom-Json
$env:JAVA_HOME = $bubblewrapConfig.jdkPath
$buildToolsRoot = Join-Path $bubblewrapConfig.androidSdkPath 'build-tools'
$buildTools = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
  Sort-Object { [version]$_.Name } -Descending |
  Select-Object -First 1
if (-not $buildTools) {
  throw 'Android Build Tools were not found.'
}

$zipalign = Join-Path $buildTools.FullName 'zipalign.exe'
$aapt = Join-Path $buildTools.FullName 'aapt.exe'
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
$jarsigner = Join-Path $bubblewrapConfig.jdkPath 'bin/jarsigner.exe'

& $zipalign -c 4 $apkPath | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw 'APK alignment verification failed.'
}

$badging = (& $aapt dump badging $apkPath 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) {
  throw 'APK metadata inspection failed.'
}
foreach ($required in @(
  "package: name='ph.duediligence.admin'",
  "versionName='1.0.0'",
  "compileSdkVersion='36'",
  "targetSdkVersion:'36'",
  "application-label:'Due Diligence Pulse'"
)) {
  if ($badging -notmatch [regex]::Escape($required)) {
    throw "APK metadata is missing expected value: $required"
  }
}

$previousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$apkSignature = (& $apksigner verify --verbose --print-certs $apkPath 2>&1) -join "`n"
$apkSignatureExit = $LASTEXITCODE
$ErrorActionPreference = $previousErrorPreference
if ($apkSignatureExit -eq 0 -or $apkSignature -notmatch 'DOES NOT VERIFY') {
  throw 'The pilot APK was expected to be explicitly unsigned.'
}

$bundleSignature = (& $jarsigner -verify $aabPath 2>&1) -join "`n"
if ($bundleSignature -notmatch 'jar is unsigned') {
  throw 'The pilot App Bundle was expected to be explicitly unsigned.'
}

foreach ($artifact in @($apkPath, $aabPath)) {
  $item = Get-Item -LiteralPath $artifact
  $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash
  Write-Host "PASS unsigned artifact: $($item.FullName)"
  Write-Host "     bytes=$($item.Length) sha256=$hash"
}

Write-Host 'PASS APK package, version, API levels, alignment, and unsigned status verified.'
