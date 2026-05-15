#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: ./install.sh /path/to/obsidian-vault" >&2
  exit 1
fi

VAULT_PATH="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ID="$(SCRIPT_DIR="$SCRIPT_DIR" node -e 'const path = require("path"); process.stdout.write(require(path.join(process.env.SCRIPT_DIR, "manifest.json")).id)')"
PLUGIN_VERSION="$(SCRIPT_DIR="$SCRIPT_DIR" node -e 'const path = require("path"); process.stdout.write(require(path.join(process.env.SCRIPT_DIR, "manifest.json")).version)')"
LEGACY_PLUGIN_IDS=("obsidian-powershell-agent")
TARGET="$VAULT_PATH/.obsidian/plugins/$PLUGIN_ID"

if [[ ! -d "$VAULT_PATH/.obsidian" ]]; then
  echo "The target path does not look like an Obsidian vault: $VAULT_PATH" >&2
  exit 1
fi

mkdir -p "$TARGET"

for legacy_plugin_id in "${LEGACY_PLUGIN_IDS[@]}"; do
  legacy_target="$VAULT_PATH/.obsidian/plugins/$legacy_plugin_id"
  if [[ ! -d "$legacy_target" ]]; then
    continue
  fi

  for name in data.json certs; do
    legacy_item="$legacy_target/$name"
    target_item="$TARGET/$name"
    if [[ -e "$legacy_item" && ! -e "$target_item" ]]; then
      cp -R "$legacy_item" "$target_item"
    fi
  done

  echo "Migrated settings from legacy plugin folder: $legacy_target"
  echo "You can remove the legacy plugin folder after confirming Obst Terminal works: $legacy_target"
done

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

runtime_merged=false
if [[ -d "$runtime_target" ]]; then
  if ! rm -rf "$runtime_target"; then
    echo "Could not replace the existing runtime folder, probably because a terminal is still open. Merging runtime files instead." >&2
    mkdir -p "$runtime_target"
    cp -R "$runtime_source"/. "$runtime_target"/
    runtime_merged=true
  fi
fi

if [[ "$runtime_merged" != true ]]; then
  cp -R "$runtime_source" "$runtime_root/"
fi

spawn_helper="$runtime_target/build/Release/spawn-helper"
if [[ -f "$spawn_helper" ]]; then
  chmod 755 "$spawn_helper"
fi

case "$(uname -s)" in
  Darwin) runtime_platform="macos" ;;
  Linux) runtime_platform="linux" ;;
  *) runtime_platform="unknown" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) runtime_arch="x64" ;;
  arm64|aarch64) runtime_arch="arm64" ;;
  armv7l|armv6l) runtime_arch="arm" ;;
  i386|i686) runtime_arch="ia32" ;;
  *) runtime_arch="$(uname -m)" ;;
esac

cat > "$TARGET/runtime.json" <<EOF
{
  "version": "$PLUGIN_VERSION",
  "platform": "$runtime_platform",
  "arch": "$runtime_arch",
  "installedBy": "install.sh"
}
EOF

echo "Installed $PLUGIN_ID to $TARGET"
