param(
  [Parameter(Mandatory = $true)]
  [string]$VaultPath,

  [string]$Thumbprint = "",

  [string]$SubjectMatch = "",

  [string]$PemPath = "",

  [string]$PluginId = "obsidian-powershell-agent",

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
    $normalizedThumbprint = $Thumbprint -replace "\s", ""
    return $certificates |
      Where-Object { ($_.Thumbprint -replace "\s", "") -ieq $normalizedThumbprint } |
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

function Set-PluginDataProperty {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Data,

    [Parameter(Mandatory = $true)]
    [string]$Name,

    [AllowNull()]
    $Value
  )

  if ($Data.PSObject.Properties.Name -contains $Name) {
    $Data.$Name = $Value
  } else {
    $Data | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
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
  throw "Vault Terminal is not installed in this vault: $pluginDir"
}

$data = Read-PluginData -DataPath $dataPath
Set-PluginDataProperty -Data $data -Name "useSystemCa" -Value $true

if ($UseSystemCaOnly) {
  Set-PluginDataProperty -Data $data -Name "extraCaCertPath" -Value ""
} elseif ($PemPath) {
  $resolvedPem = Resolve-Path -LiteralPath $PemPath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $extraCaPath) | Out-Null
  Copy-Item -LiteralPath $resolvedPem -Destination $extraCaPath -Force
  Set-PluginDataProperty -Data $data -Name "extraCaCertPath" -Value $ExtraCaRelativePath
} else {
  $certificate = Get-CertificateFromStore -Thumbprint $Thumbprint -SubjectMatch $SubjectMatch

  if (-not $certificate) {
    throw "Could not find a certificate. Pass -Thumbprint, -SubjectMatch, -PemPath, or -UseSystemCaOnly."
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $extraCaPath) | Out-Null
  Set-Content -LiteralPath $extraCaPath -Value (ConvertTo-PemCertificate -Certificate $certificate) -Encoding ascii
  Set-PluginDataProperty -Data $data -Name "extraCaCertPath" -Value $ExtraCaRelativePath
}

$data | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $dataPath -Encoding UTF8

Write-Host "Configured Vault Terminal corporate CA settings:"
Write-Host "  Vault: $resolvedVault"
Write-Host "  Plugin: $pluginDir"
Write-Host "  Use system CA: true"
Write-Host "  Extra CA: $($data.extraCaCertPath)"
