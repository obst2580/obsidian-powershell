param(
  [Parameter(Mandatory = $true)]
  [string]$VaultPath
)

$ErrorActionPreference = "Stop"

function Get-QuarantineRoot {
  $base = $env:LOCALAPPDATA
  if (-not $base) {
    $base = Join-Path $HOME ".obst-terminal"
  }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  return Join-Path $base "Obst Terminal\shared-state-quarantine\$stamp"
}

function Backup-Path {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [Parameter(Mandatory = $true)]
    [string]$RelativeName
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $destination = Join-Path $Root $RelativeName
  $destinationParent = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
  Copy-Item -LiteralPath $Path -Destination $destination -Recurse -Force
}

function Remove-JsonProperties {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string[]]$Names
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $json = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  $changed = $false
  foreach ($name in $Names) {
    if ($json.PSObject.Properties.Name -contains $name) {
      $json.PSObject.Properties.Remove($name)
      $changed = $true
    }
  }

  if ($json.PSObject.Properties.Name -contains "persistAgentTranscriptSnapshots") {
    $json.persistAgentTranscriptSnapshots = $false
    $changed = $true
  }
  if (($json.PSObject.Properties.Name -contains "claudePermissionMode") -and $json.claudePermissionMode -eq "bypassPermissions") {
    $json.claudePermissionMode = "default"
    $changed = $true
  }
  if (($json.PSObject.Properties.Name -contains "geminiApprovalMode") -and $json.geminiApprovalMode -eq "yolo") {
    $json.geminiApprovalMode = "default"
    $changed = $true
  }

  if ($changed) {
    $json | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $Path -Encoding utf8
  }
  return $changed
}

$resolvedVault = Resolve-Path -LiteralPath $VaultPath
$obsidianDir = Join-Path $resolvedVault ".obsidian"
if (-not (Test-Path -LiteralPath $obsidianDir)) {
  throw "The target path does not look like an Obsidian vault: $resolvedVault"
}

$quarantineRoot = Get-QuarantineRoot
New-Item -ItemType Directory -Force -Path $quarantineRoot | Out-Null

$sensitiveJsonKeys = @(
  "agentViewState",
  "savedSessions",
  "sessions",
  "activeSessionId",
  "currentSessionId",
  "selectedSessionId",
  "sessionId",
  "threadId",
  "conversationId",
  "messages",
  "transcript",
  "transcripts",
  "webviewState",
  "claudeTranscriptHtml",
  "codexTranscriptHtml",
  "geminiTranscriptHtml"
)

$vaultTerminalDir = Join-Path $obsidianDir "plugins\vault-terminal"
if (Test-Path -LiteralPath $vaultTerminalDir) {
  Get-ChildItem -LiteralPath $vaultTerminalDir -Filter "data*.json" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Backup-Path -Path $_.FullName -Root $quarantineRoot -RelativeName "vault-terminal\$($_.Name)"
    if (Remove-JsonProperties -Path $_.FullName -Names $sensitiveJsonKeys) {
      Write-Host "Sanitized $($_.FullName)"
    }
  }

  foreach ($name in @("agent-processes.json")) {
    $path = Join-Path $vaultTerminalDir $name
    if (Test-Path -LiteralPath $path) {
      Backup-Path -Path $path -Root $quarantineRoot -RelativeName "vault-terminal\$name"
      Remove-Item -LiteralPath $path -Force
      Write-Host "Removed $path"
    }
  }
}

$agentClientDir = Join-Path $obsidianDir "plugins\agent-client"
if (Test-Path -LiteralPath $agentClientDir) {
  $agentClientData = Join-Path $agentClientDir "data.json"
  if (Test-Path -LiteralPath $agentClientData) {
    Backup-Path -Path $agentClientData -Root $quarantineRoot -RelativeName "agent-client\data.json"
    if (Remove-JsonProperties -Path $agentClientData -Names $sensitiveJsonKeys) {
      Write-Host "Sanitized $agentClientData"
    }
  }

  foreach ($name in @("sessions", "agent-processes.json")) {
    $path = Join-Path $agentClientDir $name
    if (Test-Path -LiteralPath $path) {
      Backup-Path -Path $path -Root $quarantineRoot -RelativeName "agent-client\$name"
      Remove-Item -LiteralPath $path -Recurse -Force
      Write-Host "Removed $path"
    }
  }
}

Write-Host "Shared AI state cleanup complete."
Write-Host "Quarantine backup: $quarantineRoot"
