# Obst Terminal

Open a real terminal in Obsidian's right sidebar, rooted at the current vault path.

[한국어 README](README.ko.md)

> Status: early desktop beta. Windows and macOS release packages are available. Linux can be built from source.

> Obsidian Community Plugin Directory registration is currently under review. Until it is approved, install from the GitHub Release ZIP or use BRAT.

## What It Does

Obst Terminal is designed for workflows where Obsidian holds project notes, indexes, plans, and handoff documents while local CLI tools work against the same folder.

You can keep project notes open in the main Obsidian workspace and run tools such as Claude Code, Codex CLI, git, npm, Python, PowerShell, zsh, or bash from the right sidebar. The terminal starts in the vault path, so agent CLIs can read the same `AGENTS.md`, `CLAUDE.md`, notes, and project files that you are looking at in Obsidian.

![Obst Terminal running Claude Code in Obsidian's right sidebar](docs/images/vault-terminal-claude-code.png)

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
- Accepts Claude Code `Try "..."` suggestions with Enter when they are shown in the terminal input area.
- Runs `codex` as `codex --no-alt-screen` by default so Codex CLI output stays in normal terminal scrollback.
- Provides optional TLS / custom CA settings for networks that require a custom certificate.
- Supports Community Plugin style installs by downloading a verified OS-specific native runtime package on first launch.

## Requirements

- Obsidian Desktop.
- Node.js installed system-wide and visible from a normal terminal.
- Any CLI tool you want to run, such as `claude`, `codex`, `git`, or `npm`, must be installed separately.

VS Code extensions that bundle their own Node.js or CLI runtime are not enough. Obsidian starts Obst Terminal from the normal desktop environment, so `node --version`, `claude`, or `codex` must work from PowerShell, Terminal, zsh, or bash.

## Installation

### GitHub Release ZIP

Download the OS-specific package from the latest release:

[https://github.com/obst2580/obsidian-powershell/releases](https://github.com/obst2580/obsidian-powershell/releases)

Use the package that matches your machine:

| File | Target |
| --- | --- |
| `ObstTerminal-<version>-windows-x64.zip` | Windows x64 |
| `ObstTerminal-<version>-macos-x64.zip` | macOS Intel |
| `ObstTerminal-<version>-macos-arm64.zip` | macOS Apple Silicon |

Extract the ZIP into this folder inside your vault:

```text
<vault>/.obsidian/plugins/vault-terminal/
```

The display name is Obst Terminal, but the plugin ID and install folder remain `vault-terminal` for compatibility with existing releases and Obsidian Community Plugin registration.

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
Settings > Community plugins > Obst Terminal > Enable
```

### Community Plugin / BRAT

After Community Plugin Directory approval, Obst Terminal can be installed from Obsidian's plugin browser. Before approval, BRAT can install the standard plugin files from this repository.

For team beta distribution before Community Plugin approval:

1. Install the BRAT community plugin in Obsidian.
2. Open **Settings > BRAT > Beta plugin list**.
3. Add this repository:

```text
https://github.com/obst2580/obsidian-powershell
```

4. Enable BRAT's startup update check, or run **BRAT: Check for updates to all beta plugins and UPDATE** from the command palette.
5. Enable **Obst Terminal** in **Settings > Community plugins**.

When a new GitHub Release is published, BRAT updates the standard plugin files. Obst Terminal then installs or updates the matching native runtime from the same release. Runtime auto-install is enabled by default for new installs and can be changed here:

```text
Settings > Obst Terminal > Install runtime automatically
```

Community Plugin style installs only install these standard files first:

```text
manifest.json
main.js
styles.css
```

Obst Terminal also needs a native `node-pty` runtime. The plugin can download the verified OS-specific runtime ZIP from the matching GitHub Release when the runtime is missing or out of date. Use **Update runtime files** from Obsidian's command palette, or use the runtime button in settings. If the runtime is missing, the Obst Terminal tab shows a **Runtime installation required** prompt with a manual **Install runtime** button.

The runtime installer:

- Downloads `runtime-manifest.json` from the matching release version.
- Selects the runtime ZIP for your OS and CPU architecture.
- Verifies file size and SHA-256 before extraction.
- Extracts only inside the plugin folder.
- Repairs executable permissions for the macOS/Linux `spawn-helper` file after extraction.
- Writes `runtime.json` so stale runtime versions can be refreshed later without blocking an otherwise usable installed runtime.

Run the runtime installer or optionally enable automatic runtime installation from:

```text
Settings > Obst Terminal > Runtime files > Install runtime
Settings > Obst Terminal > Install runtime automatically
```

## Release Assets

Each release includes both manual install packages and Community Plugin runtime assets:

| File | Purpose |
| --- | --- |
| `manifest.json`, `main.js`, `styles.css` | Standard Obsidian plugin files |
| `runtime-manifest.json` | Runtime ZIP metadata and SHA-256 checksums |
| `ObstTerminal-<version>-<platform>-<arch>.zip` | Full manual install package |
| `ObstTerminal-runtime-<version>-<platform>-<arch>.zip` | Native runtime package used by the in-app installer |
| `configure-corporate-ca.ps1`, `configure-corporate-ca.cmd` | Optional Windows helper scripts for custom CA setup |

## Shell Behavior

Default shell selection:

- Windows: PowerShell 7 if available, otherwise Windows PowerShell.
- macOS: `$SHELL`, then `zsh` or `bash`; Homebrew `pwsh` is used only as a fallback.
- Linux: `$SHELL`, then `bash` or `sh`; `pwsh` is used only as a fallback.

You can override the shell in:

```text
Settings > Obst Terminal > Shell executable
```

If a synced vault carries a shell path from another OS, Obst Terminal ignores obvious incompatible paths and falls back to the local system shell. On macOS, set this to `/bin/zsh` if you need to force the native default shell.

If Node.js is installed in a non-standard location, set:

```text
Settings > Obst Terminal > Node executable
```

## File and image references

Obst Terminal can bridge Obsidian and agent CLI attachment workflows:

- Drop files onto the terminal to insert references.
- Files inside the current vault are inserted as `@relative/path`.
- Files outside the vault are inserted as quoted absolute paths.
- Copy an image or screenshot, then press `Ctrl+V` in the terminal. Obst Terminal saves it into the vault and inserts an `@path` reference.
- Use the command palette action **Insert current note reference** to insert the active note as `@note.md`.

Clipboard images are saved to:

```text
Obst Terminal Attachments/
```

You can change that folder here:

```text
Settings > Obst Terminal > Attachment folder
```

## Windows PTY backend

The default Windows PTY backend is `ConPTY`.

ConPTY generally handles fullscreen TUI rendering and resize behavior better on modern Windows. `winpty` remains available as a fallback if a CLI has input compatibility issues.

You can switch the backend here:

```text
Settings > Obst Terminal > Windows PTY backend
```

Open a new Obst Terminal tab after changing this setting.

## Shift + Enter

The default `Shift + Enter` behavior is **Claude backslash newline**.

Claude Code treats a trailing `\` followed by Return as a multiline newline. Obst Terminal sends that sequence after a short delay so IME composition can finish before the newline is sent.

Other modes are also available:

- `Claude backslash newline`
- `Bracketed newline paste`
- `xterm paste newline`
- `Modified Enter`
- `CSI-u Shift Enter`
- `Line feed`

Setting:

```text
Settings > Obst Terminal > Shift+Enter behavior
```

## Colors and scrolling

The default color mode is **Follow Obsidian**. It follows the current Obsidian light/dark theme while using a readable ANSI palette for terminal tools.

Scrolling behavior:

- Normal terminal output keeps a 50,000-line scrollback buffer.
- Use `Shift + mouse wheel` when an interactive CLI captures mouse input.
- Codex CLI is run with `--no-alt-screen` by default, preserving Codex output in normal terminal scrollback.
- In other fullscreen TUI tools, normal mouse wheel input is translated to `PageUp` / `PageDown` so the CLI can scroll its own transcript.
- Use `Ctrl + Shift + PageUp/PageDown` for forced page scrolling.
- Fullscreen TUI tools may use the alternate screen buffer. In that mode, older output belongs to the CLI's own screen state rather than normal terminal scrollback.

You can disable the Codex rewrite here:

```text
Settings > Obst Terminal > Run Codex without alternate screen
```

## TLS / custom certificates

By default, Obst Terminal does not change Node TLS behavior and does not include certificate files.

If a Node-based CLI such as Claude Code shows an error like this:

```text
Self-signed certificate detected
Unable to connect to API
```

try the settings below:

- **Use system certificate store**: enables Node's system CA store.
- **Extra CA certificate**: path to a PEM certificate file. Leave empty to auto-detect a shared PEM file.

When the setting is empty, Obst Terminal checks these shared locations first:

```text
OBST_TERMINAL_EXTRA_CA_CERT
VAULT_TERMINAL_EXTRA_CA_CERT
C:\certs\extra-ca.pem
C:\ProgramData\Obst Terminal\extra-ca.pem
%USERPROFILE%\.obst-terminal\extra-ca.pem
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

For example, if `manifest.json` says `0.4.1`, use:

```powershell
git tag 0.4.1
git push origin 0.4.1
```

The release workflow:

- Runs `npm ci`.
- Runs `npm run build`.
- Builds Windows and macOS full ZIP packages.
- Builds Windows and macOS runtime-only ZIP packages.
- Builds `runtime-manifest.json`.
- Publishes standard plugin files and ZIP assets to GitHub Releases.

## Security

Obst Terminal is a desktop-only plugin that starts a real local shell and a separate Node.js PTY host process.

- Commands run with your local user permissions.
- Commands can access local files, network resources, and credentials according to your OS permissions and the CLI you run.
- Claude Code, Codex CLI, git, npm, and other external tools are not bundled.
- Native `node-pty` runtime files are either included in the full ZIP or downloaded from the matching GitHub Release and verified with SHA-256.
- TLS / CA environment variables are only injected when explicitly enabled in settings.
- Obst Terminal does not include telemetry, analytics, or advertising code.

Only install releases from a source you trust.

## License

MIT
