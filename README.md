# Vault PowerShell

An Obsidian desktop plugin that turns a right-sidebar tab into a PowerShell terminal rooted at the current vault path.

> Status: early Windows-focused beta. The plugin works by combining an Obsidian view, xterm.js, and a separate Node PTY helper process.

## What It Does

- Starts PowerShell automatically when the tab opens.
- Uses the current Obsidian vault as the shell working directory.
- Runs normal interactive shell commands directly in the tab.
- Lets tools such as Claude Code, Codex, Git, Python, and npm run inside that shell.
- Supports terminal text selection and copy.
- Supports configurable Node TLS/CA settings for corporate SSL inspection.

## Development

```powershell
npm install
npm run build
```

Install into a vault:

```powershell
.\install.ps1 -VaultPath "C:\path\to\vault"
```

Then enable **Vault PowerShell** in Obsidian community plugins.

## Runtime Files

The plugin uses `xterm` for the terminal UI and `node-pty` for a real pseudo-terminal. The install script copies:

```text
manifest.json
main.js
styles.css
pty-host.js
node_modules/@homebridge/node-pty-prebuilt-multiarch/
```

`pty-host.js` runs as a separate Node process so the native PTY does not run inside Obsidian's renderer process.

The default shell is PowerShell 7 when available, otherwise Windows PowerShell.

## SSL / Corporate Proxy

For Node-based CLIs such as Claude Code, the plugin can inject TLS-related environment variables into the terminal:

- `NODE_OPTIONS=--use-system-ca`
- `NODE_EXTRA_CA_CERTS=<path>`
- `SSL_CERT_FILE=<path>`
- `REQUESTS_CA_BUNDLE=<path>`

Configure these in **Settings > Vault PowerShell**:

- **Use system certificate store**: enables Node's system CA store.
- **Extra CA certificate**: optional PEM file path. Relative paths are resolved from this plugin folder, for example `certs/extra-ca.pem`.

Do not disable TLS verification globally unless you fully understand the security impact.

## Distribution Notes

This plugin uses a native PTY runtime and a helper process. Standard Obsidian Community Plugin installation downloads `manifest.json`, `main.js`, and `styles.css`; this plugin also needs `pty-host.js` and the `node-pty` runtime folder. For public use, package it as a GitHub release/BRAT beta first, or replace the native runtime with a distribution model accepted by the Obsidian review process.

## License

MIT
