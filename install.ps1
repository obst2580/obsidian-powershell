param(
  [Parameter(Mandatory = $true)]
  [string]$VaultPath
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "manifest.json") | ConvertFrom-Json
$pluginId = $manifest.id
$legacyPluginIds = @("obsidian-powershell-agent")
$resolvedVault = Resolve-Path -LiteralPath $VaultPath
$target = Join-Path $resolvedVault ".obsidian\plugins\$pluginId"

function Resolve-InstallPlatform {
  if ($IsMacOS) {
    return "macos"
  }

  if ($IsLinux) {
    return "linux"
  }

  return "windows"
}

function Resolve-InstallArch {
  switch ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString().ToLowerInvariant()) {
    "x64" { return "x64" }
    "arm64" { return "arm64" }
    "arm" { return "arm" }
    default { return [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString().ToLowerInvariant() }
  }
}

function Repair-UnixRuntimePermissions {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RuntimeDir
  )

  if (-not ($IsMacOS -or $IsLinux)) {
    return
  }

  $spawnHelper = Join-Path $RuntimeDir "build/Release/spawn-helper"
  if (Test-Path -LiteralPath $spawnHelper) {
    & chmod 755 $spawnHelper
  }
}

function Copy-RuntimeMerge {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDir,

    [Parameter(Mandatory = $true)]
    [string]$TargetDir
  )

  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

  Get-ChildItem -LiteralPath $SourceDir -Recurse -Force | ForEach-Object {
    $relativePath = $_.FullName.Substring($SourceDir.Length).TrimStart("\", "/")
    $targetPath = Join-Path $TargetDir $relativePath

    if ($_.PSIsContainer) {
      New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
      return
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetPath) | Out-Null
    try {
      Copy-Item -LiteralPath $_.FullName -Destination $targetPath -Force -ErrorAction Stop
    } catch {
      Write-Warning "Could not update locked runtime file: $targetPath"
    }
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $resolvedVault ".obsidian"))) {
  throw "The target path does not look like an Obsidian vault: $resolvedVault"
}

New-Item -ItemType Directory -Force -Path $target | Out-Null

foreach ($legacyPluginId in $legacyPluginIds) {
  $legacyTarget = Join-Path $resolvedVault ".obsidian\plugins\$legacyPluginId"
  if (-not (Test-Path -LiteralPath $legacyTarget)) {
    continue
  }

  foreach ($name in @("data.json", "certs")) {
    $legacyItem = Join-Path $legacyTarget $name
    $targetItem = Join-Path $target $name
    if ((Test-Path -LiteralPath $legacyItem) -and -not (Test-Path -LiteralPath $targetItem)) {
      Copy-Item -LiteralPath $legacyItem -Destination $targetItem -Recurse -Force
    }
  }

  Write-Host "Migrated settings from legacy plugin folder: $legacyTarget"
  Write-Host "You can remove the legacy plugin folder after confirming Obst Terminal works: $legacyTarget"
}

foreach ($file in @("manifest.json", "main.js", "styles.css", "pty-host.js")) {
  $source = Join-Path $repoRoot $file
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Missing build artifact: $source"
  }

  Copy-Item -LiteralPath $source -Destination (Join-Path $target $file) -Force
}

$runtimeRoot = Join-Path $target "node_modules"
$homebridgeTarget = Join-Path $runtimeRoot "@homebridge"
$ptySource = Join-Path $repoRoot "node_modules\@homebridge\node-pty-prebuilt-multiarch"
$ptyTarget = Join-Path $homebridgeTarget "node-pty-prebuilt-multiarch"

if (-not (Test-Path -LiteralPath $ptySource)) {
  throw "Missing runtime dependency. Run npm install first: $ptySource"
}

New-Item -ItemType Directory -Force -Path $homebridgeTarget | Out-Null

$runtimeMerged = $false
if (Test-Path -LiteralPath $ptyTarget) {
  try {
    Remove-Item -LiteralPath $ptyTarget -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Warning "Could not replace the existing runtime folder, probably because a terminal is still open. Merging runtime files instead."
    Copy-RuntimeMerge -SourceDir $ptySource -TargetDir $ptyTarget
    $runtimeMerged = $true
  }
}

if (-not $runtimeMerged) {
  Copy-Item -LiteralPath $ptySource -Destination $homebridgeTarget -Recurse -Force
}

Repair-UnixRuntimePermissions -RuntimeDir $ptyTarget

[ordered]@{
  version = $manifest.version
  platform = Resolve-InstallPlatform
  arch = Resolve-InstallArch
  installedBy = "install.ps1"
} |
  ConvertTo-Json -Depth 4 |
  Set-Content -LiteralPath (Join-Path $target "runtime.json") -Encoding utf8

Write-Host "Installed $pluginId to $target"
