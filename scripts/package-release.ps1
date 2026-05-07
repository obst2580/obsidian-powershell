param(
  [string]$Platform = "",
  [string]$Arch = "",
  [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot

function Resolve-Platform {
  if ($Platform) {
    return $Platform
  }

  if ($IsMacOS) {
    return "macos"
  }

  if ($IsLinux) {
    return "linux"
  }

  return "windows"
}

function Resolve-Arch {
  if ($Arch) {
    return $Arch
  }

  switch ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString().ToLowerInvariant()) {
    "x64" { return "x64" }
    "arm64" { return "arm64" }
    "arm" { return "arm" }
    default { return [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString().ToLowerInvariant() }
  }
}

$resolvedPlatform = Resolve-Platform
$resolvedArch = Resolve-Arch
$manifest = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "manifest.json") | ConvertFrom-Json
$version = $manifest.version

if ([System.IO.Path]::IsPathRooted($OutputDir)) {
  $resolvedOutputDir = $OutputDir
} else {
  $resolvedOutputDir = Join-Path $repoRoot $OutputDir
}

$packageName = "VaultTerminal-$version-$resolvedPlatform-$resolvedArch"
$packageDir = Join-Path $resolvedOutputDir $packageName
$zipPath = Join-Path $resolvedOutputDir "$packageName.zip"

if (Test-Path -LiteralPath $packageDir) {
  Remove-Item -LiteralPath $packageDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

foreach ($file in @("manifest.json", "main.js", "styles.css", "pty-host.js")) {
  $source = Join-Path $repoRoot $file
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Missing build artifact: $source"
  }

  Copy-Item -LiteralPath $source -Destination (Join-Path $packageDir $file) -Force
}

$runtimeSource = Join-Path (Join-Path (Join-Path $repoRoot "node_modules") "@homebridge") "node-pty-prebuilt-multiarch"
if (-not (Test-Path -LiteralPath $runtimeSource)) {
  throw "Missing runtime dependency. Run npm ci first: $runtimeSource"
}

$runtimeTargetParent = Join-Path (Join-Path $packageDir "node_modules") "@homebridge"
New-Item -ItemType Directory -Force -Path $runtimeTargetParent | Out-Null
Copy-Item -LiteralPath $runtimeSource -Destination $runtimeTargetParent -Recurse -Force

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -Force

Write-Host "Created package: $zipPath"
