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

New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

function Copy-RequiredFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [Parameter(Mandatory = $true)]
    [string]$TargetDir
  )

  $source = Join-Path $repoRoot $Name
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Missing build artifact: $source"
  }

  Copy-Item -LiteralPath $source -Destination (Join-Path $TargetDir $Name) -Force
}

function Copy-RuntimeFiles {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetDir
  )

  Copy-RequiredFile -Name "pty-host.js" -TargetDir $TargetDir

  $runtimeSource = Join-Path (Join-Path (Join-Path $repoRoot "node_modules") "@homebridge") "node-pty-prebuilt-multiarch"
  if (-not (Test-Path -LiteralPath $runtimeSource)) {
    throw "Missing runtime dependency. Run npm ci first: $runtimeSource"
  }

  $runtimeTargetParent = Join-Path (Join-Path $TargetDir "node_modules") "@homebridge"
  $runtimeTarget = Join-Path $runtimeTargetParent "node-pty-prebuilt-multiarch"

  if (Test-Path -LiteralPath $runtimeTarget) {
    Remove-Item -LiteralPath $runtimeTarget -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $runtimeTargetParent | Out-Null
  Copy-Item -LiteralPath $runtimeSource -Destination $runtimeTargetParent -Recurse -Force
}

function Write-RuntimeInfo {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetDir
  )

  [ordered]@{
    version = $version
    platform = $resolvedPlatform
    arch = $resolvedArch
    installedBy = "release-package"
  } |
    ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $TargetDir "runtime.json") -Encoding utf8
}

function Repair-UnixRuntimePermissions {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetDir
  )

  if (-not ($resolvedPlatform -eq "macos" -or $resolvedPlatform -eq "linux")) {
    return
  }

  $spawnHelper = Join-Path $TargetDir "node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release/spawn-helper"
  if (Test-Path -LiteralPath $spawnHelper) {
    & chmod 755 $spawnHelper
  }
}

function New-ZipFromDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDir,

    [Parameter(Mandatory = $true)]
    [string]$ZipPath
  )

  if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }

  if ($IsWindows) {
    Compress-Archive -Path (Join-Path $SourceDir "*") -DestinationPath $ZipPath -Force
    return
  }

  $zipCommand = Get-Command zip -ErrorAction SilentlyContinue
  if ($zipCommand) {
    Push-Location -LiteralPath $SourceDir
    try {
      & $zipCommand.Path -r -q $ZipPath .
    } finally {
      Pop-Location
    }
    return
  }

  Compress-Archive -Path (Join-Path $SourceDir "*") -DestinationPath $ZipPath -Force
}

$packageName = "ObstTerminal-$version-$resolvedPlatform-$resolvedArch"
$packageDir = Join-Path $resolvedOutputDir $packageName
$zipPath = Join-Path $resolvedOutputDir "$packageName.zip"
$runtimePackageName = "ObstTerminal-runtime-$version-$resolvedPlatform-$resolvedArch"
$runtimePackageDir = Join-Path $resolvedOutputDir $runtimePackageName
$runtimeZipPath = Join-Path $resolvedOutputDir "$runtimePackageName.zip"
$runtimeManifestFragmentPath = Join-Path $resolvedOutputDir "runtime-manifest-$resolvedPlatform-$resolvedArch.json"

if (Test-Path -LiteralPath $packageDir) {
  Remove-Item -LiteralPath $packageDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

foreach ($file in @("manifest.json", "main.js", "styles.css")) {
  Copy-RequiredFile -Name $file -TargetDir $packageDir
}

Copy-RuntimeFiles -TargetDir $packageDir
Repair-UnixRuntimePermissions -TargetDir $packageDir
Write-RuntimeInfo -TargetDir $packageDir
New-ZipFromDirectory -SourceDir $packageDir -ZipPath $zipPath

if (Test-Path -LiteralPath $runtimePackageDir) {
  Remove-Item -LiteralPath $runtimePackageDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $runtimePackageDir | Out-Null
Copy-RuntimeFiles -TargetDir $runtimePackageDir
Repair-UnixRuntimePermissions -TargetDir $runtimePackageDir
Write-RuntimeInfo -TargetDir $runtimePackageDir
New-ZipFromDirectory -SourceDir $runtimePackageDir -ZipPath $runtimeZipPath

$runtimeHash = (Get-FileHash -LiteralPath $runtimeZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$runtimeSize = (Get-Item -LiteralPath $runtimeZipPath).Length
$runtimeManifestFragment = [ordered]@{
  platform = $resolvedPlatform
  arch = $resolvedArch
  asset = Split-Path -Leaf $runtimeZipPath
  sha256 = $runtimeHash
  size = $runtimeSize
}

$runtimeManifestFragment |
  ConvertTo-Json -Depth 4 |
  Set-Content -LiteralPath $runtimeManifestFragmentPath -Encoding utf8

Write-Host "Created package: $zipPath"
Write-Host "Created runtime package: $runtimeZipPath"
Write-Host "Created runtime manifest fragment: $runtimeManifestFragmentPath"
