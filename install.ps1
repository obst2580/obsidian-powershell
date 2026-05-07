param(
  [Parameter(Mandatory = $true)]
  [string]$VaultPath
)

$ErrorActionPreference = "Stop"

$pluginId = "obsidian-powershell-agent"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedVault = Resolve-Path -LiteralPath $VaultPath
$target = Join-Path $resolvedVault ".obsidian\plugins\$pluginId"

if (-not (Test-Path -LiteralPath (Join-Path $resolvedVault ".obsidian"))) {
  throw "The target path does not look like an Obsidian vault: $resolvedVault"
}

New-Item -ItemType Directory -Force -Path $target | Out-Null

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

if (Test-Path -LiteralPath $ptyTarget) {
  Remove-Item -LiteralPath $ptyTarget -Recurse -Force
}

Copy-Item -LiteralPath $ptySource -Destination $homebridgeTarget -Recurse -Force

Write-Host "Installed $pluginId to $target"
