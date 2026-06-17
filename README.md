# Obst Terminal

Obst Terminal is an Obsidian Desktop plugin that opens a vault-rooted **multi-session AI Agent Console** in the right sidebar. This branch currently reports version `0.6.46`.

[한국어 README](README.ko.md)

> Desktop only. Claude Code, Codex CLI, Gemini CLI, Node.js, Git, npm, and other external tools are not bundled. Install them on your machine and make sure they work from a normal terminal.

![Obst Terminal agent console in Obsidian's right sidebar](docs/images/obst-terminal-agent-console.png)

## Multi-Session AI Workspace

Obst Terminal is not just a single chat console. It is designed as a **multi-session AI workspace inside one Obsidian vault**, where several Claude Code, Codex, and Gemini CLI sessions can stay open side by side as plugin tabs.

- Add AI session tabs with the plugin `+` button or the `Open new AI session` command.
- Each tab keeps its own Claude sessionId, Codex threadId, Gemini local sessionId, provider, editable title, transcript, and running state.
- Switching tabs does not stop the running agent; background sessions continue writing to their own transcripts.
- Claude, Codex, and Gemini transcripts preserve their scroll positions per session/provider, so background updates and tab switches do not pull the view back to the top.
- By default, transcript HTML is not persisted to `.obsidian/plugins/vault-terminal/data.json`; only session metadata such as titles and provider IDs are kept. Enable `Persist Agent transcript snapshots` if you want exact UI transcript restoration after restart.
- Use role-based sessions such as PM, Writer, Reviewer, and Researcher next to the same project documents.
- Delegate prompts to other running AI sessions with `@all`, `@codex`, `@claude`, `@gemini`, or `@"session title"`.
- Attach files with the Attach button or paste images into the composer. Pasted images are saved in the configured attachment folder and sent to Claude, Codex, or Gemini as local file paths.

## Current Behavior

The default pane is **Agent Console**. The toolbar lets you choose `Claude`, `Codex`, or `Gemini`, and the active provider is shown as `현재 Claude Code`, `현재 Codex`, or `현재 Gemini CLI`. Claude, Codex, and Gemini keep separate transcripts when you switch providers.

You can split work across multiple AI sessions in the same vault. `Open AI workspace` reuses the first Obst Terminal view, while `Open new AI session` or the Agent Console `+` button adds an AI session tab inside the plugin instead of opening a new Obsidian workspace tab. Each tab keeps its own Claude sessionId, Codex threadId, Gemini local sessionId, selected provider, editable title, visible transcript, and running backend/process state. Switching tabs does not stop the running agent; background sessions keep writing to their own transcripts. This is intended for project-management roles such as PM, Writer, Analyst, and Reviewer working beside the same vault documents. A session can delegate a prompt to other running tabs with `@all`, `@codex`, `@claude`, `@gemini`, or `@"session title"`.

### Codex

The Codex Agent Console uses `codex app-server` by default instead of embedding the fullscreen Codex TUI.

- Talks to `codex app-server` over JSON-RPC.
- Checks ChatGPT login state and can start browser or device-code login.
- Shows model, reasoning effort, and access-level controls inside the composer.
- Keeps each user turn in one transcript card, including reasoning, command execution, tool calls, and the final answer.
- Turns the `Send` button into `Stop` while a turn is active.
- Queues additional messages while Codex is still answering.
- Shows a statusline with cwd, git branch, selected model, context usage, and 5h/7d rate-limit meters.
- Buffers streaming deltas before rendering so Obsidian stays responsive during long answers.

### Claude Code

The Claude Code Agent Console separates normal chat turns from login/control prompts.

- Checks login with `claude auth status --json`.
- Sends normal prompts through a session-specific `claude --session-id <uuid> --strict-mcp-config --permission-mode bypassPermissions --output-format json -p`.
- Reads Claude's JSON `session_id` after each print turn and keeps the plugin tab bound to the actual Claude Code session.
- Passes the prompt through stdin and waits for the `claude` process to finish, allowing long-running skills such as audio transcription or large document analysis.
- If Claude reports that the session ID is already in use, the console retries once with `--resume <sessionId> --fork-session` so the fallback keeps the previous Claude context instead of starting from an empty UUID.
- Claude/Gemini normal-response processes are tracked by pid. `Stop`, tab close, and plugin reload clean them up, and startup checks `agent-processes.json` for stale pids left by a previous crash.
- Uses the background PTY host for `/login`, MCP connection prompts, permission prompts, and command-style control input.
- Uses Claude session logs to track control flow and keep transcript offsets aligned.

### Gemini CLI

Gemini CLI uses the same print-command shape as Claude normal chat turns.

- Checks CLI availability with `gemini --version` and checks the Gemini CLI auth method before accepting prompts.
- Sends normal prompts with `gemini --skip-trust --approval-mode yolo --output-format text --prompt=.` to enable headless mode, then passes the real prompt through stdin.
- Allows long-running work instead of enforcing a 10-minute response cutoff; press `Stop` to terminate the current process tree.
- Does not use native Gemini `--resume` by default, because several plugin tabs can otherwise attach to the same latest Gemini session. The plugin keeps tabs separated with transcript context and a local Gemini session id.
- Gemini subscription login is started from the Agent Console `Login` button. The plugin opens interactive `gemini --skip-trust --screen-reader` inside its control PTY with `NO_BROWSER=true`, then lets the Gemini CLI handle Sign in with Google through the manual URL/code flow and write its own auth settings.
- `Login` restarts any existing Gemini login PTY before opening `/auth`, so a stale browser-based auth prompt is replaced with manual authentication.
- When Gemini asks for a manual authorization code, paste only that code into the Agent Console message box and press `Send`.
- For `oauth-personal`, Start requires an active account in Gemini CLI's `google_accounts.json`; `selectedType` alone is treated as login-required.
- For API or Vertex modes, configure `GEMINI_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`, or `GOOGLE_GENAI_USE_GCA` in the OS environment or a Gemini-readable `.env`, then fully restart Obsidian.
- If Gemini CLI is missing or auth is not configured, Start shows a clear install/PATH/auth hint before a prompt is sent.

## Requirements

- Obsidian Desktop.
- Node.js installed system-wide.
- Any CLI you want to use from Agent Console, such as `claude`, `codex`, or `gemini`.

CLI runtimes bundled inside editor extensions are not enough. Obsidian starts this plugin from the normal desktop environment, so these commands should work from PowerShell, Terminal, zsh, or bash:

```text
node --version
claude --version
codex --version
gemini --version
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

Obst Terminal also needs a native `node-pty` runtime for interactive Claude Code and Gemini CLI login/control flows. If the runtime is missing or out of date, the plugin reads `runtime-manifest.json` from the matching GitHub Release, downloads the OS-specific runtime ZIP, verifies size and SHA-256, and extracts it into the plugin folder.

Runtime commands and settings:

```text
Command palette > Update runtime files
Settings > Obst Terminal > Runtime files > Install runtime
Settings > Obst Terminal > Install runtime automatically
Settings > Obst Terminal > Advanced runtime and network settings
```

For BRAT testing, add this repository:

```text
https://github.com/obst2580/obsidian-powershell
```

## Using Agent Console

1. Open the project vault in Obsidian.
2. Run `Open AI workspace` from the command palette or open the Obst Terminal right-sidebar tab.
3. Choose `Claude`, `Codex`, or `Gemini`.
4. Press `Start`.
5. Use `Login` if the selected provider needs authentication.
6. Type a message and press `Send`.

When Codex, Claude, or Gemini is answering, `Send` acts as `Stop`. Additional messages are queued until the active turn finishes.

For multiple AI collaborators, run `Open new AI session` from the command palette or press the Agent Console `+` button. Each session appears as an internal Agent Console tab, gets an editable title, and shows short Claude/Codex/Gemini session identifiers in the subtitle.

Delegation commands are typed in the same composer:

```text
@all Review the current project plan and list risks.
@codex Check whether the implementation looks consistent.
@claude Draft the handoff note.
@gemini Find missing decisions in the meeting-note draft.
@"Reviewer" Summarize open questions from this vault.
/send @"PM" Turn this into a task list.
```

Delegation sends text and selected attachments to matching tabs that are already running. If a target is stopped, waiting for login, or blocked on an interactive prompt, both the sender and target transcripts record the failed delivery instead of starting or approving anything automatically.

## Attachments

Use the composer `Attach` button to attach files.

- The button changes to `Attach (N)` after files are selected.
- An attachment strip appears under the input.
- The strip shows `첨부됨 N개`.
- Each attachment is shown as an `IMG` or `FILE` chip.
- Use the chip `x` button to remove one attachment.
- You can send attachments without text.

On the Codex app-server path, images are sent as `localImage` inputs and other files as `mention` inputs. On the Claude and Gemini paths, attachments are appended to the prompt as an `첨부 파일:` list.

Pasting an image in Agent Console adds it as an attachment chip.

Default attachment folder:

```text
Obst Terminal Attachments/
```

Setting:

```text
Settings > Obst Terminal > Attachment folder
```

The current note can be inserted with the Agent Console `Add current note` button.

## Settings

The default settings screen shows only day-to-day Agent Console options. Runtime, PTY, Node.js, and custom CA controls are kept under `Advanced runtime and network settings`.

| Setting | Behavior |
| --- | --- |
| `Attachment folder` | Stores pasted or dropped attachment files before they are sent to Agent Console. |
| `Persist Agent transcript snapshots` | Saves visible transcript HTML to plugin `data.json` only when explicitly enabled. |

Advanced settings:

| Setting | Behavior |
| --- | --- |
| `Node executable` | Point to Node.js when it is not on PATH. |
| `Runtime files` | Install or reinstall the native runtime used for interactive Claude Code and Gemini CLI login/control flows. |
| `Windows PTY backend` | Choose the interactive agent control PTY backend on Windows. |
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
git tag 0.6.46
git push origin 0.6.46
```

The release workflow runs `npm ci`, `npm run build`, full ZIP packaging, runtime-only ZIP packaging, `runtime-manifest.json` generation, and standard plugin file upload.

## Security

Obst Terminal no longer starts a raw local shell by default. It may use a separate Node.js PTY host process only for interactive Claude Code and Gemini CLI login/control flows.

- Claude Code, Codex CLI, or Gemini CLI processes started from Agent Console run with your local OS user permissions.
- Those CLI processes can access local files, network resources, and credentials according to the CLI and OS permissions.
- Claude Code, Codex CLI, Gemini CLI, git, npm, and other external tools are not bundled.
- Native runtime files are included in full ZIPs or downloaded from the matching GitHub Release and verified with SHA-256.
- TLS / CA environment variables are injected only when enabled in settings.
- Agent transcript snapshots are not saved to plugin `data.json` unless `Persist Agent transcript snapshots` is explicitly enabled.
- The plugin does not include telemetry, analytics, or advertising code.

Only install release assets from sources you trust.

## License

MIT
