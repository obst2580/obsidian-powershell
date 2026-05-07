#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: ./install.sh /path/to/obsidian-vault" >&2
  exit 1
fi

PLUGIN_ID="obsidian-powershell-agent"
VAULT_PATH="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$VAULT_PATH/.obsidian/plugins/$PLUGIN_ID"

if [[ ! -d "$VAULT_PATH/.obsidian" ]]; then
  echo "The target path does not look like an Obsidian vault: $VAULT_PATH" >&2
  exit 1
fi

mkdir -p "$TARGET"

for file in manifest.json main.js styles.css pty-host.js; do
  source="$SCRIPT_DIR/$file"
  if [[ ! -f "$source" ]]; then
    echo "Missing build artifact: $source" >&2
    exit 1
  fi

  cp "$source" "$TARGET/$file"
done

runtime_source="$SCRIPT_DIR/node_modules/@homebridge/node-pty-prebuilt-multiarch"
runtime_root="$TARGET/node_modules/@homebridge"
runtime_target="$runtime_root/node-pty-prebuilt-multiarch"

if [[ ! -d "$runtime_source" ]]; then
  echo "Missing runtime dependency. Run npm install first: $runtime_source" >&2
  exit 1
fi

mkdir -p "$runtime_root"

if [[ -d "$runtime_target" ]]; then
  rm -rf "$runtime_target"
fi

cp -R "$runtime_source" "$runtime_root/"

echo "Installed $PLUGIN_ID to $TARGET"
