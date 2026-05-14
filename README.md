# Vault Terminal

Open a real terminal in Obsidian's right sidebar, rooted at the current vault path.

[한국어 README](README.ko.md)

> Status: early desktop beta. Windows and macOS release packages are available. Linux can be built from source.

> Obsidian Community Plugin Directory registration is currently under review. Until it is approved, install from the GitHub Release ZIP or use BRAT.

## What It Does

Vault Terminal is designed for workflows where Obsidian holds project notes, indexes, plans, and handoff documents while local CLI tools work against the same folder.

You can keep project notes open in the main Obsidian workspace and run tools such as Claude Code, Codex CLI, git, npm, Python, PowerShell, zsh, or bash from the right sidebar. The terminal starts in the vault path, so agent CLIs can read the same `AGENTS.md`, `CLAUDE.md`, notes, and project files that you are looking at in Obsidian.

![Vault Terminal running Claude Code in Obsidian's right sidebar](docs/images/vault-terminal-claude-code.png)

## Features

- Opens automatically in Obsidian's right sidebar.
- Uses the current vault path as the terminal working directory.
- Runs a real local shell: PowerShell, zsh, bash, or your configured executable.
- Works with local CLI tools such as Claude Code, Codex CLI, Git, Python, and npm.
- Supports terminal text selection and copy.
- Inserts file references when files are dropped onto the terminal.
- Saves clipboard images into the vault and inserts an `@path` reference for agent CLIs.
- Uses Obsidian-aware light/dark terminal colors while keeping ANSI output readable.
- Keeps a long scrollback buffer and supports forced scrolling with `Shift + mouse wheel`.
- Supports `Shift + Enter` multiline input modes, including Claude Code's backslash newline flow.
- Provides optional TLS / custom CA settings for networks that require a custom certificate.
- Supports Community Plugin style installs by downloading a verified OS-specific native runtime package on first launch.

## Requirements

- Obsidian Desktop.
- Node.js installed system-wide and visible from a normal terminal.
- Any CLI tool you want to run, such as `claude`, `codex`, `git`, or `npm`, must be installed separately.

VS Code extensions that bundle their own Node.js or CLI runtime are not enough. Obsidian starts Vault Terminal from the normal desktop environment, so `node --version`, `claude`, or `codex` must work from PowerShell, Terminal, zsh, or bash.

## Installation

### GitHub Release ZIP

Download the OS-specific package from the latest release:

[https://github.com/obst2580/obsidian-powershell/releases](https://github.com/obst2580/obsidian-powershell/releases)

Use the package that matches your machine:

| File | Target |
| --- | --- |
| `VaultTerminal-<version>-windows-x64.zip` | Windows x64 |
| `VaultTerminal-<version>-macos-x64.zip` | macOS Intel |
| `VaultTerminal-<version>-macos-arm64.zip` | macOS Apple Silicon |

Extract the ZIP into this folder inside your vault:

```text
<vault>/.obsidian/plugins/vault-terminal/
```

After extraction, the plugin folder should contain:

```text
manifest.json
main.js
styles.css
pty-host.js
node_modules/
runtime.json
```

Restart Obsidian, then enable the plugin:

```text
Settings > Community plugins > Vault Terminal > Enable
```

### Community Plugin / BRAT

After Community Plugin Directory approval, Vault Terminal can be installed from Obsidian's plugin browser. Before approval, BRAT can install the standard plugin files from this repository.

Community Plugin style installs only install these standard files first:

```text
manifest.json
main.js
styles.css
```

Vault Terminal also needs a native `node-pty` runtime. If the runtime is missing, the Vault Terminal tab shows a **Runtime installation required** prompt. Click **Install runtime** to download the OS-specific runtime ZIP from the matching GitHub Release.

The runtime installer:

- Downloads `runtime-manifest.json` from the matching release version.
- Selects the runtime ZIP for your OS and CPU architecture.
- Verifies file size and SHA-256 before extraction.
- Extracts only inside the plugin folder.
- Writes `runtime.json` so stale runtime versions can be detected later.

You can also run the installer from:

```text
Settings > Vault Terminal > Runtime files > Install runtime
```

## Release Assets

Each release includes both manual install packages and Community Plugin runtime assets:

| File | Purpose |
| --- | --- |
| `manifest.json`, `main.js`, `styles.css` | Standard Obsidian plugin files |
| `runtime-manifest.json` | Runtime ZIP metadata and SHA-256 checksums |
| `VaultTerminal-<version>-<platform>-<arch>.zip` | Full manual install package |
| `VaultTerminal-runtime-<version>-<platform>-<arch>.zip` | Native runtime package used by the in-app installer |
| `configure-corporate-ca.ps1`, `configure-corporate-ca.cmd` | Optional Windows helper scripts for custom CA setup |

## Shell Behavior

Default shell selection:

- Windows: PowerShell 7 if available, otherwise Windows PowerShell.
- macOS: Homebrew `pwsh` if available, otherwise `$SHELL`, then `zsh` or `bash`.
- Linux: `pwsh` if available, otherwise `$SHELL`, then `bash` or `sh`.

You can override the shell in:

```text
Settings > Vault Terminal > Shell executable
```

If Node.js is installed in a non-standard location, set:

```text
Settings > Vault Terminal > Node executable
```

## File and image references

Vault Terminal can bridge Obsidian and agent CLI attachment workflows:

- Drop files onto the terminal to insert references.
- Files inside the current vault are inserted as `@relative/path`.
- Files outside the vault are inserted as quoted absolute paths.
- Copy an image or screenshot, then press `Ctrl+V` in the terminal. Vault Terminal saves it into the vault and inserts an `@path` reference.
- Use the command palette action **Insert current note reference** to insert the active note as `@note.md`.

Clipboard images are saved to:

```text
Vault Terminal Attachments/
```

You can change that folder here:

```text
Settings > Vault Terminal > Attachment folder
```

## Windows PTY backend

The default Windows PTY backend is `winpty`.

ConPTY can filter some raw keyboard and paste escape sequences before Node-based CLIs receive them. `winpty` is the default because it has been more stable for agent CLIs such as Claude Code and Codex CLI.

You can switch the backend here:

```text
Settings > Vault Terminal > Windows PTY backend
```

Open a new Vault Terminal tab after changing this setting.

## Shift + Enter

The default `Shift + Enter` behavior is **Claude backslash newline**.

Claude Code treats a trailing `\` followed by Return as a multiline newline. Vault Terminal sends that sequence after a short delay so IME composition can finish before the newline is sent.

Other modes are also available:

- `Claude backslash newline`
- `Bracketed newline paste`
- `xterm paste newline`
- `Modified Enter`
- `CSI-u Shift Enter`
- `Line feed`

Setting:

```text
Settings > Vault Terminal > Shift+Enter behavior
```

## Colors and scrolling

The default color mode is **Follow Obsidian**. It follows the current Obsidian light/dark theme while using a readable ANSI palette for terminal tools.

Scrolling behavior:

- Normal terminal output keeps a 50,000-line scrollback buffer.
- Use `Shift + mouse wheel` when an interactive CLI captures mouse input.
- Use `Ctrl + Shift + PageUp/PageDown` for forced page scrolling.
- Fullscreen TUI tools may use the alternate screen buffer. In that mode, older output belongs to the CLI's own screen state rather than normal terminal scrollback.

## TLS / custom certificates

By default, Vault Terminal does not change Node TLS behavior and does not include certificate files.

If a Node-based CLI such as Claude Code shows an error like this:

```text
Self-signed certificate detected
Unable to connect to API
```

try the settings below:

- **Use system certificate store**: enables Node's system CA store.
- **Extra CA certificate**: path to a PEM certificate file. Leave empty to auto-detect a shared PEM file.

When the setting is empty, Vault Terminal checks these shared locations first:

```text
VAULT_TERMINAL_EXTRA_CA_CERT
C:\certs\extra-ca.pem
C:\ProgramData\Vault Terminal\extra-ca.pem
%USERPROFILE%\.vault-terminal\extra-ca.pem
```

If no shared file exists, it checks the current plugin folder:

```text
certs/extra-ca.pem
```

Windows helper scripts are included in each release:

```powershell
.\configure-corporate-ca.ps1 -VaultPath "C:\path\to\vault" -Thumbprint "<root-ca-thumbprint>"
```

If you already have a PEM file:

```powershell
.\configure-corporate-ca.ps1 -VaultPath "C:\path\to\vault" -PemPath "C:\path\to\custom-ca.pem"
```

Browsers do not run `.ps1` files automatically. Run the script from PowerShell, or run `configure-corporate-ca.cmd` from the same folder.

## Development

```powershell
npm install
npm run build
```

Install into a Windows vault:

```powershell
.\install.ps1 -VaultPath "C:\path\to\vault"
```

Install into a macOS or Linux vault:

```bash
npm install
npm run build
./install.sh /path/to/vault
```

Create a local Windows release package:

```powershell
pwsh -NoProfile -File .\scripts\package-release.ps1 -Platform windows -Arch x64 -OutputDir dist
```

## Release process

Release tags must match `manifest.json` exactly. Do not prefix tags with `v`.

For example, if `manifest.json` says `0.3.7`, use:

```powershell
git tag 0.3.7
git push origin 0.3.7
```

The release workflow:

- Runs `npm ci`.
- Runs `npm run build`.
- Builds Windows and macOS full ZIP packages.
- Builds Windows and macOS runtime-only ZIP packages.
- Builds `runtime-manifest.json`.
- Publishes standard plugin files and ZIP assets to GitHub Releases.

## Security

Vault Terminal is a desktop-only plugin that starts a real local shell and a separate Node.js PTY host process.

- Commands run with your local user permissions.
- Commands can access local files, network resources, and credentials according to your OS permissions and the CLI you run.
- Claude Code, Codex CLI, git, npm, and other external tools are not bundled.
- Native `node-pty` runtime files are either included in the full ZIP or downloaded from the matching GitHub Release and verified with SHA-256.
- TLS / CA environment variables are only injected when explicitly enabled in settings.
- Vault Terminal does not include telemetry, analytics, or advertising code.

Only install releases from a source you trust.

## License

MIT
