# Obst Terminal

Obst Terminal is an Obsidian Desktop plugin that opens a vault-rooted **Agent Console + raw terminal** in the right sidebar. This branch currently reports version `0.6.18`.

[한국어 README](README.ko.md)

> Desktop only. Claude Code, Codex CLI, Node.js, Git, npm, and other external tools are not bundled. Install them on your machine and make sure they work from a normal terminal.

![Obst Terminal agent console in Obsidian's right sidebar](docs/images/obst-terminal-agent-console.png)

## Current Behavior

The default pane is **Agent Console**. The toolbar lets you choose `Claude` or `Codex`, and the active provider is shown as `현재 Claude Code` or `현재 Codex`. Claude and Codex keep separate transcripts when you switch providers.

You can split work across multiple AI sessions in the same vault. `Open terminal` keeps the existing single-view behavior, while `Open new AI session` or the Agent Console `+` button adds an AI session tab inside the plugin instead of opening a new Obsidian workspace tab. Each tab keeps its own Claude sessionId, Codex threadId, selected provider, editable title, visible transcript, and running backend/PTY state. Switching tabs does not stop the running agent; background sessions keep writing to their own transcripts. This is intended for project-management roles such as PM, Writer, Analyst, and Reviewer working beside the same vault documents.

### Codex

The Codex Agent Console uses `codex app-server` by default instead of embedding the fullscreen Codex TUI.

- Talks to `codex app-server` over JSON-RPC.
- Checks ChatGPT login state and can start browser or device-code login.
- Shows model, reasoning effort, and access-level controls inside the composer.
- Renders user turns, reasoning, command execution, file changes, and approval requests as structured transcript cards.
- Turns the `Send` button into `Stop` while a turn is active.
- Queues additional messages while Codex is still answering.
- Shows a statusline with cwd, git branch, selected model, context usage, and 5h/7d rate-limit meters.
- Buffers streaming deltas before rendering so Obsidian stays responsive during long answers.

If the Agent Console falls back to the PTY path, or if you run `codex` manually in the raw terminal, the Codex scrollback settings such as `--no-alt-screen`, `tui.terminal_resize_reflow=false`, and scrollback preservation may apply.

### Claude Code

The Claude Code Agent Console separates normal chat turns from login/control prompts.

- Checks login with `claude auth status --json`.
- Sends normal prompts through a session-specific `claude --session-id <uuid> --strict-mcp-config --permission-mode bypassPermissions --output-format text -p`.
- Passes the prompt through stdin and waits up to 10 minutes for the response.
- Uses the background PTY host for `/login`, MCP connection prompts, permission prompts, and command-style control input.
- Uses Claude session logs to track control flow and keep transcript offsets aligned.

### Raw Terminal

The raw terminal is a real xterm.js + node-pty terminal.

- Windows: PowerShell 7 when available, otherwise Windows PowerShell.
- macOS: `$SHELL`, then `zsh`, then `bash`.
- Linux: `$SHELL`, then `bash`, then `sh`.
- Runs normal CLI commands such as `git`, `npm`, `python`, `claude`, and `codex`.
- Best used for login fallback, troubleshooting, and long shell commands.

## Requirements

- Obsidian Desktop.
- Node.js installed system-wide.
- Any CLI you want to use, such as `claude`, `codex`, `git`, `npm`, or `python`.

CLI runtimes bundled inside editor extensions are not enough. Obsidian starts this plugin from the normal desktop environment, so these commands should work from PowerShell, Terminal, zsh, or bash:

```text
node --version
claude --version
codex --version
```

## Installation

### GitHub Release ZIP

Download the full ZIP for your OS and CPU architecture:

[https://github.com/obst2580/obsidian-powershell/releases](https://github.com/obst2580/obsidian-powershell/releases)

| File | Target |
| --- | --- |
| `ObstTerminal-<version>-windows-x64.zip` | Windows x64 |
| `ObstTerminal-<version>-macos-x64.zip` | macOS Intel |
| `ObstTerminal-<version>-macos-arm64.zip` | macOS Apple Silicon |

Extract it into your vault:

```text
<vault>/.obsidian/plugins/vault-terminal/
```

The display name is `Obst Terminal`, but the plugin ID and folder remain `vault-terminal` for compatibility.

A full ZIP install should contain:

```text
manifest.json
main.js
styles.css
pty-host.js
node_modules/
runtime.json
```

Restart Obsidian and enable the plugin:

```text
Settings > Community plugins > Obst Terminal > Enable
```

### BRAT / Community Plugin Style

BRAT and Community Plugin style installs may initially install only the standard plugin files:

```text
manifest.json
main.js
styles.css
```

Obst Terminal also needs a native `node-pty` runtime. If the runtime is missing or out of date, the plugin reads `runtime-manifest.json` from the matching GitHub Release, downloads the OS-specific runtime ZIP, verifies size and SHA-256, and extracts it into the plugin folder.

Runtime commands and settings:

```text
Command palette > Update runtime files
Settings > Obst Terminal > Runtime files > Install runtime
Settings > Obst Terminal > Install runtime automatically
```

For BRAT testing, add this repository:

```text
https://github.com/obst2580/obsidian-powershell
```

## Using Agent Console

1. Open the project vault in Obsidian.
2. Run `Open terminal` from the command palette or open the Obst Terminal right-sidebar tab.
3. Choose `Claude` or `Codex`.
4. Press `Start`.
5. Use `Login` if the selected provider needs authentication.
6. Type a message and press `Send`.

When Codex is answering, `Send` acts as `Stop`. Additional messages are queued until the active turn finishes.

For multiple AI collaborators, run `Open new AI session` from the command palette or press the Agent Console `+` button. Each session appears as an internal Agent Console tab, gets an editable title, and shows short Claude/Codex session identifiers in the subtitle.

## Attachments

Use the composer `Attach` button to attach files.

- The button changes to `Attach (N)` after files are selected.
- An attachment strip appears under the input.
- The strip shows `첨부됨 N개`.
- Each attachment is shown as an `IMG` or `FILE` chip.
- Use the chip `x` button to remove one attachment.
- You can send attachments without text.

On the Codex app-server path, images are sent as `localImage` inputs and other files as `mention` inputs. On the Claude path, attachments are appended to the prompt as an `첨부 파일:` list.

Pasting an image in Agent Console adds it as an attachment chip. Pasting an image in the raw terminal saves it into the vault attachment folder and inserts an `@path` reference.

Default attachment folder:

```text
Obst Terminal Attachments/
```

Setting:

```text
Settings > Obst Terminal > Attachment folder
```

The current note can be inserted from the command palette:

```text
Command palette > Insert current note reference
```

## Settings

| Setting | Behavior |
| --- | --- |
| `Shell executable` | Override the shell used by the raw terminal. |
| `Node executable` | Point to Node.js when it is not on PATH. |
| `Windows PTY backend` | Choose `ConPTY` or `winpty` on Windows. |
| `Terminal color scheme` | Follow Obsidian or force light/dark terminal colors. |
| `Shift+Enter behavior` | Choose multiline behavior, including Claude backslash newline. |
| `Run Codex without alternate screen` | Adds `--no-alt-screen` on the Codex PTY path. |
| `Stabilize Codex resize rendering` | Adds `tui.terminal_resize_reflow=false` on the Codex PTY path. |
| `Preserve Codex scrollback` | Removes Codex redraw escapes that clear scrollback. |
| `Install runtime automatically` | Allows automatic native runtime installation. |
| `Use system certificate store` | Injects Node system CA behavior for Node-based CLIs. |
| `Extra CA certificate` | Provides a custom PEM certificate path. |

## TLS / Custom CA

By default, Obst Terminal does not change Node TLS behavior. If a corporate proxy or private CA causes certificate errors in Node-based CLIs such as Claude Code, use:

```text
Settings > Obst Terminal > Use system certificate store
Settings > Obst Terminal > Extra CA certificate
```

When `Extra CA certificate` is empty, the plugin checks these shared locations:

```text
OBST_TERMINAL_EXTRA_CA_CERT
VAULT_TERMINAL_EXTRA_CA_CERT
C:\certs\extra-ca.pem
C:\ProgramData\Obst Terminal\extra-ca.pem
%USERPROFILE%\.obst-terminal\extra-ca.pem
%USERPROFILE%\.vault-terminal\extra-ca.pem
certs/extra-ca.pem
```

Windows release packages include helper scripts:

```powershell
.\configure-corporate-ca.ps1 -VaultPath "C:\path\to\vault" -Thumbprint "<root-ca-thumbprint>"
.\configure-corporate-ca.ps1 -VaultPath "C:\path\to\vault" -PemPath "C:\path\to\custom-ca.pem"
```

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

## Release

Release tags must match `manifest.json` exactly. Do not prefix tags with `v`.

```powershell
git tag 0.6.18
git push origin 0.6.18
```

The release workflow runs `npm ci`, `npm run build`, full ZIP packaging, runtime-only ZIP packaging, `runtime-manifest.json` generation, and standard plugin file upload.

## Security

Obst Terminal starts a real local shell and a separate Node.js PTY host process.

- Commands run with your local OS user permissions.
- Commands can access local files, network resources, and credentials according to the CLI and OS permissions.
- Claude Code, Codex CLI, git, npm, and other external tools are not bundled.
- Native runtime files are included in full ZIPs or downloaded from the matching GitHub Release and verified with SHA-256.
- TLS / CA environment variables are injected only when enabled in settings.
- The plugin does not include telemetry, analytics, or advertising code.

Only install release assets from sources you trust.

## License

MIT
