# Vault Terminal

An Obsidian desktop plugin that turns a right-sidebar tab into a real terminal rooted at the current vault path.

> Status: early desktop beta. Windows is the primary tested path; macOS and Linux support is included through platform-specific shell and install handling.

## What It Does

- Starts a terminal automatically when the tab opens.
- Uses the current Obsidian vault as the shell working directory.
- Runs normal interactive shell commands directly in the tab.
- Lets tools such as Claude Code, Codex, Git, Python, and npm run inside that shell.
- Supports terminal text selection and copy.
- Follows the current Obsidian theme by default while keeping terminal ANSI colors readable.
- Keeps a larger terminal scrollback and supports forced scrollback with Shift+Wheel or Ctrl+Shift+PageUp/PageDown.
- Supports configurable Node TLS/CA settings for corporate SSL inspection.

## Development

For employee-facing installation steps, see [INSTALL.md](INSTALL.md).

```powershell
npm install
npm run build
```

Install into a Windows vault:

```powershell
.\install.ps1 -VaultPath "C:\path\to\vault"
```

Install into a macOS/Linux vault:

```bash
npm install
npm run build
./install.sh /path/to/vault
```

Then enable **Vault Terminal** in Obsidian community plugins.

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

Default shell selection:

- Windows: PowerShell 7 when available, otherwise Windows PowerShell.
- macOS: `pwsh` from Homebrew when available, otherwise the user's `$SHELL`, then `zsh`/`bash`.
- Linux: `pwsh` when available, otherwise the user's `$SHELL`, then `bash`/`sh`.

Because the PTY runtime is native, install dependencies on the same OS that will run the plugin before copying it into a vault.

On macOS, Obsidian may not inherit the same `PATH` as a login shell. The plugin adds common Homebrew and system paths automatically, but users with `node` installed only through `nvm` may need to set **Node executable** to an absolute path in plugin settings.

## Terminal Appearance

The default terminal color scheme is **Follow Obsidian**. It uses the current Obsidian background and text colors while keeping a terminal-safe ANSI palette for tools such as Codex and Claude Code. You can change it in **Settings > Vault Terminal**:

- **Follow Obsidian**: uses the current Obsidian background and text colors while keeping a terminal-safe ANSI palette.
- **Light terminal**: high-contrast light palette.
- **Dark terminal**: high-contrast dark palette.

Scrolling notes:

- The terminal keeps 50,000 lines of scrollback for normal shell output.
- Use **Shift + mouse wheel** to force terminal scrollback when a CLI captures mouse input.
- Use **Ctrl + Shift + PageUp/PageDown** to move by page.
- Fullscreen TUI tools may use an alternate screen buffer; in that mode, older output belongs to the CLI's own UI rather than normal terminal scrollback.

## SSL / Corporate Proxy

By default, the plugin does not change Node TLS or certificate behavior and does not ship any corporate certificates.

For users behind a corporate TLS inspection proxy, the plugin can optionally inject TLS-related environment variables into the terminal:

- `NODE_OPTIONS=--use-system-ca`
- `NODE_EXTRA_CA_CERTS=<path>`
- `SSL_CERT_FILE=<path>`
- `REQUESTS_CA_BUNDLE=<path>`

Configure these in **Settings > Vault Terminal**:

- **Use system certificate store**: off by default; enables Node's system CA store when explicitly turned on.
- **Extra CA certificate**: optional PEM file path for corporate proxy root certificates. Relative paths are resolved from this plugin folder, for example `certs/extra-ca.pem`.

Do not disable TLS verification globally unless you fully understand the security impact.

For internal company deployment, keep the public release certificate-free and apply corporate CA settings after installation:

```powershell
.\configure-corporate-ca.ps1 -VaultPath "C:\path\to\vault" -Thumbprint "<company-root-ca-thumbprint>"
```

`.ps1` files are PowerShell scripts. Browsers do not execute them automatically; run them from PowerShell, or download `configure-corporate-ca.cmd` next to the `.ps1` file and double-click the `.cmd` wrapper for an interactive prompt.

If your security team provides a PEM file instead of relying on the Windows certificate store:

```powershell
.\configure-corporate-ca.ps1 -VaultPath "C:\path\to\vault" -PemPath "C:\path\to\company-ca.pem"
```

The script writes the PEM to `certs/extra-ca.pem` inside the installed plugin folder and updates `data.json` so new terminal sessions inherit the required TLS environment variables.

## Distribution Notes

This plugin uses a native PTY runtime and a helper process. Standard Obsidian Community Plugin installation downloads `manifest.json`, `main.js`, and `styles.css`; this plugin also needs `pty-host.js` and the `node-pty` runtime folder. For public use, package it as a GitHub release/BRAT beta first, or replace the native runtime with a distribution model accepted by the Obsidian review process.

## License

MIT
