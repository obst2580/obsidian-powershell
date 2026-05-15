param(
  [string]$VaultPath = "",

  [string]$Thumbprint = "",

  [string]$SubjectMatch = "",

  [string]$PemPath = "",

  [string]$PluginId = "vault-terminal",

  [string]$ExtraCaRelativePath = "certs/extra-ca.pem",

  [switch]$UseSystemCaOnly
)

$ErrorActionPreference = "Stop"

function ConvertTo-PemCertificate {
  param(
    [Parameter(Mandatory = $true)]
    [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate
  )

  $base64 = [Convert]::ToBase64String(
    $Certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert),
    [Base64FormattingOptions]::InsertLineBreaks
  )

  return "-----BEGIN CERTIFICATE-----`r`n$base64`r`n-----END CERTIFICATE-----`r`n"
}

function Get-CertificateFromStore {
  param(
    [string]$Thumbprint,
    [string]$SubjectMatch
  )

  $stores = @("Cert:\CurrentUser\Root", "Cert:\LocalMachine\Root")
  $certificates = Get-ChildItem -Path $stores -ErrorAction SilentlyContinue

  if ($Thumbprint) {
    $normalizedThumbprint = $Thumbprint -replace "[^0-9A-Fa-f]", ""
    return $certificates |
      Where-Object { ($_.Thumbprint -replace "[^0-9A-Fa-f]", "") -ieq $normalizedThumbprint } |
      Select-Object -First 1
  }

  if ($SubjectMatch) {
    return $certificates |
      Where-Object { $_.Subject -match $SubjectMatch -or $_.Issuer -match $SubjectMatch } |
      Select-Object -First 1
  }

  return $null
}

function Read-PluginData {
  param([string]$DataPath)

  if (Test-Path -LiteralPath $DataPath) {
    return Get-Content -LiteralPath $DataPath -Raw | ConvertFrom-Json
  }

  return [pscustomobject]@{
    executable = ""
    args = ""
    nodeExecutable = ""
    terminalColorScheme = "obsidian"
    useSystemCa = $false
    extraCaCertPath = ""
  }
}

if (-not $VaultPath.Trim()) {
  $VaultPath = Read-Host "Obsidian vault path"
}

$VaultPath = $VaultPath.Trim().Trim('"')
$Thumbprint = $Thumbprint.Trim().Trim('"')
$SubjectMatch = $SubjectMatch.Trim()
$PemPath = $PemPath.Trim().Trim('"')

if (-not $VaultPath) {
  throw "Vault path is required."
}

if (-not ($Thumbprint -or $SubjectMatch -or $PemPath -or $UseSystemCaOnly)) {
  $Thumbprint = Read-Host "CA thumbprint (blank if using PEM)"
  $Thumbprint = $Thumbprint.Trim().Trim('"')

  if (-not $Thumbprint) {
    $PemPath = Read-Host "PEM path (blank for system CA only)"
    $PemPath = $PemPath.Trim().Trim('"')

    if (-not $PemPath) {
      $UseSystemCaOnly = $true
    }
  }
}

$resolvedVault = Resolve-Path -LiteralPath $VaultPath
$obsidianDir = Join-Path $resolvedVault ".obsidian"
$pluginDir = Join-Path $obsidianDir "plugins\$PluginId"
$dataPath = Join-Path $pluginDir "data.json"
$extraCaPath = Join-Path $pluginDir $ExtraCaRelativePath

if (-not (Test-Path -LiteralPath $obsidianDir)) {
  throw "The target path does not look like an Obsidian vault: $resolvedVault"
}

if (-not (Test-Path -LiteralPath $pluginDir)) {
  throw "Obst Terminal is not installed in this vault: $pluginDir"
}

$data = Read-PluginData -DataPath $dataPath
$data.useSystemCa = $true

if ($UseSystemCaOnly) {
  $data.extraCaCertPath = ""
} elseif ($PemPath) {
  $resolvedPem = Resolve-Path -LiteralPath $PemPath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $extraCaPath) | Out-Null
  Copy-Item -LiteralPath $resolvedPem -Destination $extraCaPath -Force
  $data.extraCaCertPath = $ExtraCaRelativePath
} else {
  $certificate = Get-CertificateFromStore -Thumbprint $Thumbprint -SubjectMatch $SubjectMatch

  if (-not $certificate) {
    throw "Could not find a certificate. Pass -Thumbprint, -SubjectMatch, -PemPath, or -UseSystemCaOnly."
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $extraCaPath) | Out-Null
  Set-Content -LiteralPath $extraCaPath -Value (ConvertTo-PemCertificate -Certificate $certificate) -Encoding ascii
  $data.extraCaCertPath = $ExtraCaRelativePath
}

$data | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $dataPath -Encoding UTF8

Write-Host "Configured Obst Terminal corporate CA settings:"
Write-Host "  Vault: $resolvedVault"
Write-Host "  Plugin: $pluginDir"
Write-Host "  Use system CA: true"
Write-Host "  Extra CA: $($data.extraCaCertPath)"
