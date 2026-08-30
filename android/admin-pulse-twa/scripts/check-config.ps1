param(
  [switch]$Live,
  [switch]$ReleasePrerequisites
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'twa-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

$expected = [ordered]@{
  packageId = 'ph.duediligence.admin'
  host = 'duediligence.ph'
  name = 'Due Diligence Pulse'
  startUrl = '/admin-pulse/'
}

foreach ($entry in $expected.GetEnumerator()) {
  if ($manifest.($entry.Key) -ne $entry.Value) {
    throw "Unexpected $($entry.Key): '$($manifest.($entry.Key))'. Expected '$($entry.Value)'."
  }
}

if ($manifest.enableNotifications -ne $true) {
  throw 'Notification delegation must remain enabled.'
}

if ($manifest.signingKey.path -notmatch '\.(jks|keystore)$') {
  throw 'The signing-key placeholder must use a recognized keystore extension.'
}

$appGradlePath = Join-Path $projectRoot 'app/build.gradle'
if (Test-Path -LiteralPath $appGradlePath) {
  $appGradle = Get-Content -LiteralPath $appGradlePath -Raw
  if ($appGradle -notmatch 'compileSdkVersion\s+36') {
    throw 'Generated Android project does not compile against API 36.'
  }
  if ($appGradle -notmatch 'targetSdkVersion\s+36') {
    throw 'Generated Android project does not target API 36.'
  }
}

$trackedSecrets = @(
  git -C $projectRoot ls-files -- '*.jks' '*.keystore' '*.p12' '.env' '.env.*' 2>$null
) | Where-Object { $_ -and $_ -notmatch '\.env\.signing\.example$' }
if ($trackedSecrets.Count -gt 0) {
  throw "Potential signing secret is tracked: $($trackedSecrets -join ', ')"
}

if ($Live -or $ReleasePrerequisites) {
  $checks = @(
    [pscustomobject]@{ Name = 'start URL'; Uri = 'https://duediligence.ph/admin-pulse/' },
    [pscustomobject]@{ Name = 'web manifest'; Uri = 'https://duediligence.ph/admin-pulse/manifest.webmanifest' }
  )

  if ($Live) {
    $checks += [pscustomobject]@{ Name = 'Digital Asset Links'; Uri = 'https://duediligence.ph/.well-known/assetlinks.json' }
  }

  foreach ($check in $checks) {
    try {
      $response = Invoke-WebRequest -Uri $check.Uri -UseBasicParsing -MaximumRedirection 5
      if ($response.StatusCode -ne 200) {
        throw "HTTP $($response.StatusCode)"
      }
      Write-Host "PASS $($check.Name): HTTP 200"
    } catch {
      throw "Live $($check.Name) check failed for $($check.Uri): $($_.Exception.Message)"
    }
  }
}

Write-Host 'PASS Bubblewrap configuration and secret-safety checks.'
