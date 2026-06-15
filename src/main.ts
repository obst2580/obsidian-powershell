import {
  addIcon,
  App,
  FileSystemAdapter,
  ItemView,
  MarkdownRenderer,
  Menu,
  Notice,
  normalizePath,
  Plugin,
  PluginSettingTab,
  requestUrl,
  setIcon,
  Setting,
  TFolder,
  WorkspaceLeaf
} from "obsidian";
import { clipboard } from "electron";
import { unzipSync } from "fflate";
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { tmpdir } from "os";
import { CodexAppServerBackend } from "./agent/codex/backend";
import type { AgentAccessLevel, AgentAttachment, AgentBackend, AgentModelInfo, AgentStatus, AgentUiEvent, AgentUsageWindow, ApprovalRequest, TranscriptItem, TranscriptItemKind } from "./agent/types";

type Terminal = any;
type ITheme = Record<string, string>;
type FitAddonLike = {
  proposeDimensions(): { cols: number; rows: number } | undefined;
};

const VIEW_TYPE_POWERSHELL = "vault-powershell";
const GITHUB_REPOSITORY = "obst2580/obsidian-powershell";
const RUNTIME_INFO_FILE = "runtime.json";
const RUNTIME_MANIFEST_FILE = "runtime-manifest.json";
const MIN_PTY_COLS = 80;
const MIN_PTY_ROWS = 5;
const OBST_TERMINAL_ICON = "obst-terminal";
const OBST_TERMINAL_ICON_SVG = `
<rect x="10" y="18" width="80" height="64" rx="12" fill="none" stroke="currentColor" stroke-width="8"/>
<path d="M25 43l14 9-14 9" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M48 64h20" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
<circle cx="68" cy="39" r="8" fill="none" stroke="currentColor" stroke-width="6"/>
<circle cx="52" cy="30" r="4" fill="currentColor"/>
<circle cx="84" cy="30" r="4" fill="currentColor"/>
<circle cx="84" cy="50" r="4" fill="currentColor"/>
<path d="M60 34l-5-3M76 34l5-3M76 44l5 4" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
`;
// Official brand-mark paths (24x24 viewBox) so each provider is recognizable.
const CLAUDE_ICON_PATH = "M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5527h3.7442L10.5363 3.541Zm-.3712 10.2232 2.2932-5.9456 2.2932 5.9456Z";
const CODEX_ICON_PATH = "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.1419.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";
const DEFAULT_ATTACHMENT_FOLDER = "Obst Terminal Attachments";
const EXTRA_CA_ENV_VARS = ["OBST_TERMINAL_EXTRA_CA_CERT", "VAULT_TERMINAL_EXTRA_CA_CERT"];
const RUNTIME_BASE_REQUIRED_RELATIVE_FILES = [
  "pty-host.js",
  "node_modules/@homebridge/node-pty-prebuilt-multiarch/package.json",
  "node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/index.js"
];
const RUNTIME_UNIX_REQUIRED_RELATIVE_FILES = [
  "node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release/pty.node",
  "node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release/spawn-helper"
];
const RUNTIME_UNIX_EXECUTABLE_RELATIVE_FILES = [
  "node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release/spawn-helper"
];
const DEFAULT_PWSH_PATH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const WINDOWS_POWERSHELL_PATH = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const DEFAULT_NODE_PATH = "C:\\Program Files\\nodejs\\node.exe";
const WINDOWS_CMD_PATH = "C:\\Windows\\System32\\cmd.exe";
const WINDOWS_WSL_PATH = "C:\\Windows\\System32\\wsl.exe";
const WINDOWS_GIT_BASH_PATHS = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"];
const MACOS_PWSH_PATHS = ["/opt/homebrew/bin/pwsh", "/usr/local/bin/pwsh", "/opt/local/bin/pwsh"];
const MACOS_NODE_PATHS = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/opt/local/bin/node", "/usr/bin/node"];
const LINUX_PWSH_PATHS = ["/usr/local/bin/pwsh", "/usr/bin/pwsh", "/snap/bin/pwsh"];
const LINUX_NODE_PATHS = ["/usr/local/bin/node", "/usr/bin/node", "/bin/node"];
const SHIFT_ENTER_SEQUENCES: Record<Exclude<ShiftEnterMode, "xterm-paste">, string> = {
  "claude-backslash": "\\\r",
  "modified-enter": "\x1b[27;2;13~",
  "csi-u": "\x1b[13;2u",
  "bracketed-paste": "\x1b[200~\n\x1b[201~",
  "line-feed": "\n"
};
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const CLAUDE_BACKSLASH_NEWLINE_DELAY_MS = 60;
const CLAUDE_SUGGESTION_SCAN_LINES = 8;
const CLAUDE_SUGGESTION_CACHE_TTL_MS = 60000;
const CLAUDE_SUGGESTION_OUTPUT_TAIL_MAX = 4000;
const WHEEL_PIXELS_PER_LINE = 18;
const ALTERNATE_WHEEL_LINES_PER_PAGE_KEY = 4;
const PAGE_UP_SEQUENCE = "\x1b[5~";
const PAGE_DOWN_SEQUENCE = "\x1b[6~";
const ARROW_UP_SEQUENCE = "\x1b[A";
const ARROW_DOWN_SEQUENCE = "\x1b[B";
const ESCAPE_SEQUENCE = "\x1b";
const KILL_LINE_SEQUENCE = "\x15";
const CODEX_RESIZE_REFLOW_CONFIG = "tui.terminal_resize_reflow=false";
const TERMINAL_FIT_STABILIZATION_DELAYS_MS = [0, 16, 50, 150, 400, 1000];
const SETTINGS_SCHEMA_VERSION = 2;
const AGENT_CONSOLE_COLS = 300;
const AGENT_CONSOLE_ROWS = 30;
const WSL_CHECK_TIMEOUT_MS = 3000;
const AGENT_READY_DELAY_MS = 2500;
const AGENT_SESSION_POLL_MS = 1200;
const AGENT_SESSION_LOOKBACK_MS = 30000;
const AGENT_SESSION_MATCH_BYTES = 262144;
const AGENT_SESSION_MAX_READ_BYTES = 1024 * 1024;
const AGENT_SESSION_TURN_CUTOFF_SLOP_MS = 2000;
const CLAUDE_PRINT_TIMEOUT_MS: number | null = null;
const AGENT_TRANSCRIPT_BOTTOM_EPSILON_PX = 96;
const AGENT_TRANSCRIPT_CONTEXT_MAX_CHARS = 12000;
const CODEX_TURN_COMPLETION_FALLBACK_MS = 15000;

interface PowerShellSettings {
  settingsSchemaVersion: number;
  shellProfile: ShellProfile;
  wslDistro: string;
  executable: string;
  args: string;
  nodeExecutable: string;
  terminalColorScheme: TerminalColorScheme;
  shiftEnterMode: ShiftEnterMode;
  codexDisableResizeReflow: boolean;
  codexNoAltScreen: boolean;
  codexPreserveScrollback: boolean;
  codexUseAppServer: boolean;
  codexExecutable: string;
  codexApprovalPolicy: CodexApprovalPolicy;
  codexLoginMethod: CodexLoginMethod;
  codexModel: string;
  windowsPtyBackend: WindowsPtyBackend;
  autoInstallRuntime: boolean;
  useSystemCa: boolean;
  extraCaCertPath: string;
  attachmentFolder: string;
  agentViewState?: AgentViewSessionState;
}

type TerminalColorScheme = "dark" | "light" | "obsidian";
type ShiftEnterMode = "bracketed-paste" | "claude-backslash" | "xterm-paste" | "modified-enter" | "csi-u" | "line-feed";
type WindowsPtyBackend = "winpty" | "conpty";
type CodexApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
type CodexLoginMethod = "browser" | "device-code";
type ShellProfile = "auto" | "pwsh" | "windows-powershell" | "cmd" | "wsl" | "git-bash" | "zsh" | "bash" | "custom";
type ViewPane = "agent" | "terminal";
type AgentProvider = "claude" | "codex";
type AgentSessionMode = "legacy-latest" | "isolated";
type AgentTranscriptRole = "user" | "assistant" | "tool" | "system";
type AgentPromptMode = "auth" | "auth-code" | "mcp" | "menu" | "confirmation" | "permission" | "continue" | "command" | "text";
type AgentAuthState = "idle" | "checking" | "authenticated" | "ready" | "login-required" | "login-in-progress";

interface AgentViewSessionState extends Record<string, unknown> {
  agentSessions?: AgentWorkspaceSessionState[];
  activeAgentSessionKey?: string;
  agentSessionKey?: string;
  agentSessionLabel?: string;
  agentSessionMode?: AgentSessionMode;
  agentProvider?: AgentProvider;
  activePane?: ViewPane;
  claudeSessionId?: string;
  claudeControlSessionId?: string;
  codexThreadId?: string | null;
}

interface AgentWorkspaceSessionState extends Record<string, unknown> {
  agentSessionKey: string;
  agentSessionLabel: string;
  agentSessionMode: AgentSessionMode;
  agentProvider: AgentProvider;
  claudeSessionId: string | null;
  claudeControlSessionId?: string | null;
  codexThreadId: string | null;
  claudeTranscriptHtml?: string;
  codexTranscriptHtml?: string;
  claudeScrollTop?: number;
  codexScrollTop?: number;
  inputText?: string;
  statusText?: string;
  createdAt: number;
  updatedAt: number;
  claudeTranscriptEl?: HTMLElement | null;
  codexTranscriptEl?: HTMLElement | null;
  agentBackend?: AgentBackend | null;
  agentBackendUnsubscribe?: (() => void) | null;
  codexItemEls?: Map<string, HTMLElement>;
  codexDeltaBuffers?: Map<string, string>;
  codexDeltaFlushTimer?: number | null;
  codexScrollFrame?: number | null;
  codexApprovalEls?: Map<string, HTMLElement>;
  codexCurrentTurnEl?: HTMLElement | null;
  codexCurrentAnswerEl?: HTMLElement | null;
  codexTurnLoadingEl?: HTMLElement | null;
  codexTurnActive?: boolean;
  codexTurnCompletionFallbackTimer?: number | null;
  codexQueuedInputs?: { text: string; attachments: AgentAttachment[] }[];
  codexContextPercent?: number | null;
  codexRateLimitWindows?: AgentUsageWindow[];
  codexGitBranch?: string | null | undefined;
  codexModels?: AgentModelInfo[];
  codexPendingAttachments?: AgentAttachment[];
  agentHost?: ChildProcessWithoutNullStreams | null;
  agentHostReady?: boolean;
  agentReadyForInput?: boolean;
  agentStdoutBuffer?: string;
  agentSessionPollTimer?: number | null;
  agentReadyTimer?: number | null;
  agentOutputIdleTimer?: number | null;
  agentStartedAt?: number;
  agentSessionPath?: string | null;
  agentSessionOffset?: number;
  agentCurrentTurnStartedAt?: number;
  agentSessionBaselineOffsets?: Map<string, number>;
  agentClaudePrintTurnActive?: boolean;
  agentClaudeControlSessionId?: string | null;
  lastAgentLaunchCommand?: string;
  agentSeenEntries?: Set<string>;
  agentLocalMessageCounter?: number;
  agentLastRawNotice?: string;
  agentAuthState?: AgentAuthState;
  agentConversationReady?: boolean;
  agentReadyNoticeShown?: boolean;
  agentAutoLoginAttempted?: boolean;
  agentAutoLoginPending?: boolean;
  agentAutoMcpAttempted?: boolean;
  agentMcpAuthInProgress?: boolean;
  agentNeedsAuth?: boolean;
  agentPromptState?: AgentPromptState | null;
  agentOpenedExternalUrls?: Set<string>;
}

interface AgentDelegationCommand {
  targetText: string;
  message: string;
  targets: AgentWorkspaceSessionState[];
}

interface AgentDelegationDeliveryResult {
  sessionLabel: string;
  provider: AgentProvider;
  status: "sent" | "queued" | "failed";
  reason?: string;
}

interface PtyHostConfig {
  shell: string;
  args: string[];
  fallbackShells: ShellLaunchConfig[];
  cols: number;
  rows: number;
  cwd: string;
  env: { [key: string]: string | undefined };
  windowsPtyBackend: WindowsPtyBackend;
}

interface ShellLaunchConfig {
  shell: string;
  args: string[];
}

type HostInputMessage =
  | { type: "data"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "kill" };

type HostOutputMessage =
  | { type: "data"; data: string }
  | { type: "ready" }
  | { type: "exit"; exitCode?: number | null; signal?: number }
  | { type: "error"; message: string };

interface RuntimeManifest {
  version: string;
  runtimes: RuntimeAsset[];
}

interface RuntimeAsset {
  platform: RuntimePlatform;
  arch: RuntimeArch;
  asset: string;
  sha256: string;
  size: number;
}

type RuntimePlatform = "windows" | "macos" | "linux";
type RuntimeArch = "x64" | "arm64" | "arm" | "ia32";

interface RuntimeInfo {
  version?: string;
  platform?: string;
  arch?: string;
}

interface AgentTranscriptEntry {
  id: string;
  role: AgentTranscriptRole;
  text: string;
  timestampMs?: number;
}

type AgentPromptAction =
  | {
    kind?: "input";
    label: string;
    data: string;
    description?: string;
    keepPrompt?: boolean;
  }
  | {
    kind: "open-url";
    label: string;
    url: string;
    description?: string;
    keepPrompt?: boolean;
  }
  | {
    kind: "copy-text";
    label: string;
    text: string;
    description?: string;
    keepPrompt?: boolean;
  }
  | {
    kind: "submit-clipboard";
    label: string;
    description?: string;
    keepPrompt?: boolean;
  };

interface AgentPromptState {
  text: string;
  requiresAuth: boolean;
  mode: AgentPromptMode;
  allowEmptySubmit: boolean;
  urls: string[];
  actions: AgentPromptAction[];
}

interface AgentAuthCheck {
  checked: boolean;
  loggedIn: boolean | null;
  summary: string;
  detail?: string;
}

interface CapturedCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  error?: string;
}

interface ClipboardNativeImage {
  isEmpty(): boolean;
  toPNG(): Buffer;
}

interface TerminalBufferLineLike {
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

interface TerminalBufferLike {
  readonly length: number;
  getLine(y: number): TerminalBufferLineLike | undefined;
}

type ClipboardWithImage = typeof clipboard & {
  readImage?: () => ClipboardNativeImage;
};

const DEFAULT_SETTINGS: PowerShellSettings = {
  settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
  shellProfile: "auto",
  wslDistro: "",
  executable: "",
  args: "",
  nodeExecutable: "",
  terminalColorScheme: "obsidian",
  shiftEnterMode: "claude-backslash",
  codexDisableResizeReflow: true,
  codexNoAltScreen: true,
  codexPreserveScrollback: true,
  codexUseAppServer: true,
  codexExecutable: "",
  codexApprovalPolicy: "on-request",
  codexLoginMethod: "browser",
  codexModel: "",
  windowsPtyBackend: "conpty",
  autoInstallRuntime: true,
  useSystemCa: false,
  extraCaCertPath: "",
  attachmentFolder: DEFAULT_ATTACHMENT_FOLDER
};

const DARK_TERMINAL_THEME: ITheme = {
  background: "#0c1016",
  foreground: "#d8dee9",
  cursor: "#ffffff",
  cursorAccent: "#0c1016",
  selectionBackground: "#2f5d7c",
  selectionForeground: "#ffffff",
  selectionInactiveBackground: "#243447",
  scrollbarSliderBackground: "rgba(216, 222, 233, 0.22)",
  scrollbarSliderHoverBackground: "rgba(216, 222, 233, 0.36)",
  scrollbarSliderActiveBackground: "rgba(216, 222, 233, 0.5)",
  black: "#1f2430",
  red: "#ff6b6b",
  green: "#8bd17c",
  yellow: "#f4d35e",
  blue: "#6ea8fe",
  magenta: "#c792ea",
  cyan: "#56d4dd",
  white: "#d8dee9",
  brightBlack: "#6b7280",
  brightRed: "#ff8787",
  brightGreen: "#a6e3a1",
  brightYellow: "#ffe082",
  brightBlue: "#8ab4ff",
  brightMagenta: "#d0a9ff",
  brightCyan: "#8be9fd",
  brightWhite: "#ffffff"
};

const LIGHT_TERMINAL_THEME: ITheme = {
  background: "#fbfaf7",
  foreground: "#1f2937",
  cursor: "#111827",
  cursorAccent: "#fbfaf7",
  selectionBackground: "#bfd7ff",
  selectionForeground: "#111827",
  selectionInactiveBackground: "#dbeafe",
  scrollbarSliderBackground: "rgba(31, 41, 55, 0.2)",
  scrollbarSliderHoverBackground: "rgba(31, 41, 55, 0.34)",
  scrollbarSliderActiveBackground: "rgba(31, 41, 55, 0.48)",
  black: "#24292f",
  red: "#b91c1c",
  green: "#166534",
  yellow: "#854d0e",
  blue: "#1d4ed8",
  magenta: "#7e22ce",
  cyan: "#0f766e",
  white: "#e5e7eb",
  brightBlack: "#6b7280",
  brightRed: "#dc2626",
  brightGreen: "#15803d",
  brightYellow: "#a16207",
  brightBlue: "#2563eb",
  brightMagenta: "#9333ea",
  brightCyan: "#0891b2",
  brightWhite: "#ffffff"
};

export default class VaultPowerShellPlugin extends Plugin {
  settings: PowerShellSettings;
  private runtimeInstallPromise: Promise<void> | null = null;

  async onload() {
    await this.loadSettings();
    addIcon(OBST_TERMINAL_ICON, OBST_TERMINAL_ICON_SVG);

    this.registerView(
      VIEW_TYPE_POWERSHELL,
      (leaf) => new VaultPowerShellView(leaf, this)
    );

    this.addRibbonIcon(OBST_TERMINAL_ICON, "Open AI workspace", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-vault-powershell-view",
      name: "Open AI workspace",
      callback: () => {
        void this.activateView();
      }
    });
    this.addCommand({
      id: "open-new-agent-session",
      name: "Open new AI session",
      callback: () => {
        void this.activateNewSessionView();
      }
    });
    this.addCommand({
      id: "update-runtime-files",
      name: "Update runtime files",
      callback: () => {
        void this.updateRuntimeFromUserAction();
      }
    });

    this.addSettingTab(new VaultPowerShellSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.startAutomaticRuntimeInstall();
    });
  }

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<PowerShellSettings> | null;
    const needsCodexScrollbackMigration = (saved?.settingsSchemaVersion ?? 0) < 2;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
    this.settings.settingsSchemaVersion = SETTINGS_SCHEMA_VERSION;
    this.settings.shellProfile = normalizeShellProfile(this.settings.shellProfile);
    this.settings.wslDistro = this.settings.wslDistro?.trim() ?? "";
    this.settings.terminalColorScheme = normalizeTerminalColorScheme(this.settings.terminalColorScheme);
    this.settings.shiftEnterMode = normalizeShiftEnterMode(this.settings.shiftEnterMode);
    this.settings.codexDisableResizeReflow = this.settings.codexDisableResizeReflow !== false;
    this.settings.codexNoAltScreen = needsCodexScrollbackMigration
      ? true
      : this.settings.codexNoAltScreen !== false;
    this.settings.codexPreserveScrollback = this.settings.codexPreserveScrollback !== false;
    this.settings.codexUseAppServer = this.settings.codexUseAppServer !== false;
    this.settings.codexExecutable = this.settings.codexExecutable?.trim() ?? "";
    this.settings.codexApprovalPolicy = normalizeCodexApprovalPolicy(this.settings.codexApprovalPolicy);
    this.settings.codexLoginMethod = normalizeCodexLoginMethod(this.settings.codexLoginMethod);
    this.settings.codexModel = this.settings.codexModel?.trim() ?? "";
    this.settings.windowsPtyBackend = normalizeWindowsPtyBackend(this.settings.windowsPtyBackend);
    this.settings.autoInstallRuntime = this.settings.autoInstallRuntime === true;
    if (needsCodexScrollbackMigration) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getSavedAgentViewState(): AgentViewSessionState | null {
    const state = normalizeAgentViewSessionState(this.settings.agentViewState);
    return state ?? null;
  }

  async saveAgentViewStateSnapshot(state: AgentViewSessionState) {
    const normalized = normalizeAgentViewSessionState(state);
    if (!normalized) {
      return;
    }
    this.settings.agentViewState = normalized;
    await this.saveSettings();
  }

  getVaultPath(): string | null {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }

    return null;
  }

  getShellExecutable(): string {
    const launchConfig = this.getShellLaunchConfig(this.getVaultPath() ?? "");
    return launchConfig.shell;
  }

  getShellLaunchConfig(vaultPath: string): ShellLaunchConfig {
    const profile = normalizeShellProfile(this.settings.shellProfile);
    const customShell = this.settings.executable.trim();

    if (profile === "custom" && !isAutoShellSetting(customShell) && !isPlatformIncompatiblePath(customShell)) {
      return {
        shell: customShell,
        args: this.getConfiguredShellArgs(customShell)
      };
    }

    const builtIn = this.getBuiltInShellLaunchConfig(profile, vaultPath);
    if (builtIn) {
      return builtIn;
    }

    const configured = this.settings.executable.trim();
    if (profile === "auto" && !isAutoShellSetting(configured) && !isPlatformIncompatiblePath(configured)) {
      return {
        shell: configured,
        args: this.getConfiguredShellArgs(configured)
      };
    }

    const shell = this.getAutoShellExecutable();
    return {
      shell,
      args: this.getAutoShellArgs(shell)
    };
  }

  getShellFallbacks(primaryShell: string): ShellLaunchConfig[] {
    if (this.settings.shellProfile !== "auto" && this.settings.shellProfile !== "custom") {
      return [];
    }

    return uniqueStrings(getAutoShellCandidates())
      .filter((shell) => shell !== primaryShell)
      .map((shell) => ({
        shell,
        args: this.getAutoShellArgs(shell)
      }));
  }

  private getBuiltInShellLaunchConfig(profile: ShellProfile, vaultPath: string): ShellLaunchConfig | null {
    if (profile === "pwsh") {
      const shell = firstExistingPath(process.platform === "win32" ? [DEFAULT_PWSH_PATH] : [...MACOS_PWSH_PATHS, ...LINUX_PWSH_PATHS]) ?? "pwsh";
      return { shell, args: ["-NoLogo"] };
    }

    if (profile === "windows-powershell" && process.platform === "win32") {
      return { shell: WINDOWS_POWERSHELL_PATH, args: ["-NoLogo"] };
    }

    if (profile === "cmd" && process.platform === "win32") {
      return { shell: WINDOWS_CMD_PATH, args: [] };
    }

    if (profile === "wsl" && process.platform === "win32") {
      return getWslLaunchConfig(vaultPath, this.settings.wslDistro.trim());
    }

    if (profile === "git-bash" && process.platform === "win32") {
      const shell = firstExistingPath(WINDOWS_GIT_BASH_PATHS) ?? "bash.exe";
      return { shell, args: ["--login"] };
    }

    if (profile === "zsh" && process.platform !== "win32") {
      return { shell: firstExistingPath(["/bin/zsh", "/usr/bin/zsh"]) ?? "zsh", args: [] };
    }

    if (profile === "bash") {
      const shell = process.platform === "win32"
        ? firstExistingPath(WINDOWS_GIT_BASH_PATHS) ?? "bash.exe"
        : firstExistingPath(["/bin/bash", "/usr/bin/bash"]) ?? "bash";
      return { shell, args: process.platform === "win32" ? ["--login"] : [] };
    }

    return null;
  }

  private getAutoShellExecutable(): string {
    if (process.platform === "win32" && existsSync(DEFAULT_PWSH_PATH)) {
      return DEFAULT_PWSH_PATH;
    }

    if (process.platform === "win32" && existsSync(WINDOWS_POWERSHELL_PATH)) {
      return WINDOWS_POWERSHELL_PATH;
    }

    if (process.platform === "darwin") {
      return getUserShell() ?? firstExistingPath(["/bin/zsh", "/bin/bash", "/bin/sh"]) ?? firstExistingPath(MACOS_PWSH_PATHS) ?? "/bin/zsh";
    }

    if (process.platform === "linux") {
      return getUserShell() ?? firstExistingPath(["/bin/bash", "/bin/sh"]) ?? firstExistingPath(LINUX_PWSH_PATHS) ?? "/bin/sh";
    }

    return getUserShell() ?? "pwsh";
  }

  getShellArgs(shell: string): string[] {
    const launchConfig = this.getShellLaunchConfig(this.getVaultPath() ?? "");
    if (launchConfig.shell === shell) {
      return launchConfig.args;
    }

    return this.getAutoShellArgs(shell);
  }

  private getConfiguredShellArgs(shell: string): string[] {
    const configured = this.settings.args.trim();
    if (!isAutoShellArgsSetting(configured)) {
      return tokenizeArgs(configured);
    }

    return this.getAutoShellArgs(shell);
  }

  private getAutoShellArgs(shell: string): string[] {
    return isPowerShellExecutable(shell) ? ["-NoLogo"] : [];
  }

  getPluginBasePath(): string {
    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      throw new Error("This vault does not expose a local file-system path.");
    }

    const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    return join(vaultPath, pluginDir);
  }

  getPtyHostPath(): string {
    return join(this.getPluginBasePath(), "pty-host.js");
  }

  getRuntimeManifestUrl(): string {
    return `https://github.com/${GITHUB_REPOSITORY}/releases/download/${this.manifest.version}/${RUNTIME_MANIFEST_FILE}`;
  }

  getRuntimeMissingFiles(): string[] {
    const pluginBasePath = this.getPluginBasePath();
    const permissionIssues = repairRuntimeFilePermissions(pluginBasePath);
    const missingFiles = getRuntimeRequiredRelativeFiles()
      .map((relativePath) => join(pluginBasePath, ...relativePath.split("/")))
      .filter((file) => !existsSync(file));

    const runtimeInfoPath = join(pluginBasePath, RUNTIME_INFO_FILE);
    if (!existsSync(runtimeInfoPath)) {
      return [...missingFiles, ...permissionIssues];
    }

    const platform = getRuntimePlatform();
    const arch = getRuntimeArch();
    try {
      const runtimeInfo = JSON.parse(readFileSync(runtimeInfoPath, "utf8")) as RuntimeInfo;
      if (runtimeInfo.platform && platform && runtimeInfo.platform !== platform) {
        missingFiles.push(`${runtimeInfoPath} (platform ${runtimeInfo.platform} does not match ${platform})`);
      }
      if (runtimeInfo.arch && arch && runtimeInfo.arch !== arch) {
        missingFiles.push(`${runtimeInfoPath} (architecture ${runtimeInfo.arch} does not match ${arch})`);
      }
    } catch {
      return [...missingFiles, ...permissionIssues];
    }

    return [...missingFiles, ...permissionIssues];
  }

  getRuntimeUpdateReasons(): string[] {
    const missingFiles = this.getRuntimeMissingFiles();
    if (missingFiles.length > 0) {
      return missingFiles;
    }

    const runtimeInfoPath = join(this.getPluginBasePath(), RUNTIME_INFO_FILE);
    if (!existsSync(runtimeInfoPath)) {
      return ["Runtime metadata is missing."];
    }

    try {
      const runtimeInfo = JSON.parse(readFileSync(runtimeInfoPath, "utf8")) as RuntimeInfo;
      if (runtimeInfo.version !== this.manifest.version) {
        return [`Runtime version ${runtimeInfo.version ?? "unknown"} does not match plugin ${this.manifest.version}.`];
      }
    } catch {
      return ["Runtime metadata is invalid."];
    }

    return [];
  }

  hasRuntime(): boolean {
    return this.getRuntimeMissingFiles().length === 0;
  }

  async installRuntimeIfNeeded(onProgress: (message: string) => void = () => undefined): Promise<boolean> {
    const reasons = this.getRuntimeUpdateReasons();
    if (reasons.length === 0) {
      return false;
    }

    if (!this.runtimeInstallPromise) {
      this.runtimeInstallPromise = this.installRuntime(onProgress)
        .finally(() => {
          this.runtimeInstallPromise = null;
        });
    }

    await this.runtimeInstallPromise;
    return true;
  }

  async updateRuntimeFromUserAction(): Promise<void> {
    try {
      await this.installRuntime();
      new Notice("Obst Terminal runtime updated. Reopen the terminal to use the updated runtime.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Obst Terminal runtime update failed: ${message}`);
    }
  }

  private startAutomaticRuntimeInstall() {
    if (!this.settings.autoInstallRuntime) {
      return;
    }

    const reasons = this.getRuntimeUpdateReasons();
    if (reasons.length === 0) {
      return;
    }

    void this.installRuntimeIfNeeded()
      .then((installed) => {
        if (installed) {
          new Notice("Obst Terminal runtime was installed.");
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`Obst Terminal runtime auto-install failed: ${message}`);
      });
  }

  async installRuntime(onProgress: (message: string) => void = () => undefined): Promise<void> {
    const platform = getRuntimePlatform();
    const arch = getRuntimeArch();
    if (!platform || !arch) {
      throw new Error(`Unsupported runtime platform: ${process.platform} ${process.arch}`);
    }

    onProgress("Fetching runtime manifest...");
    const runtimeManifest = await fetchJson<RuntimeManifest>(this.getRuntimeManifestUrl());
    if (runtimeManifest.version !== this.manifest.version) {
      throw new Error(`Runtime manifest version ${runtimeManifest.version} does not match plugin version ${this.manifest.version}.`);
    }

    const runtimeAsset = runtimeManifest.runtimes.find((candidate) => candidate.platform === platform && candidate.arch === arch);
    if (!runtimeAsset) {
      throw new Error(`No runtime package is available for ${platform}-${arch}.`);
    }

    const assetUrl = getReleaseAssetUrl(runtimeManifest.version, runtimeAsset.asset);
    onProgress(`Downloading ${runtimeAsset.asset}...`);
    const archiveBytes = await fetchBytes(assetUrl);
    if (archiveBytes.byteLength !== runtimeAsset.size) {
      throw new Error(`Runtime size mismatch. Expected ${runtimeAsset.size} bytes, received ${archiveBytes.byteLength} bytes.`);
    }

    const actualHash = sha256Hex(archiveBytes);
    if (actualHash !== runtimeAsset.sha256.toLowerCase()) {
      throw new Error(`Runtime SHA-256 mismatch. Expected ${runtimeAsset.sha256}, received ${actualHash}.`);
    }

    onProgress("Installing runtime files...");
    const pluginBasePath = this.getPluginBasePath();
    removeRuntimeFiles(pluginBasePath);
    extractRuntimeArchive(archiveBytes, pluginBasePath);
    const permissionIssues = repairRuntimeFilePermissions(pluginBasePath);
    if (permissionIssues.length > 0) {
      throw new Error(`Runtime permission repair failed: ${permissionIssues.join(", ")}`);
    }
    writeFileSync(join(pluginBasePath, RUNTIME_INFO_FILE), JSON.stringify({
      version: runtimeManifest.version,
      platform,
      arch,
      asset: runtimeAsset.asset,
      sha256: runtimeAsset.sha256,
      installedAt: new Date().toISOString()
    }, null, 2));

    const missing = this.getRuntimeMissingFiles();
    if (missing.length > 0) {
      throw new Error(`Runtime installation finished but required files are still missing: ${missing.join(", ")}`);
    }

    onProgress("Runtime installed.");
  }

  getNodeExecutable(): string {
    const configured = this.settings.nodeExecutable.trim();
    if (!isAutoNodeSetting(configured)) {
      return configured;
    }

    if (process.platform === "win32" && existsSync(DEFAULT_NODE_PATH)) {
      return DEFAULT_NODE_PATH;
    }

    if (process.platform === "darwin") {
      return firstExistingPath(MACOS_NODE_PATHS) ?? "node";
    }

    if (process.platform === "linux") {
      return firstExistingPath(LINUX_NODE_PATHS) ?? "node";
    }

    return "node";
  }

  getExtraCaCertPath(): string | null {
    const configured = this.settings.extraCaCertPath.trim();
    const candidates = configured
      ? [isAbsolute(configured) ? configured : join(this.getPluginBasePath(), configured)]
      : getDefaultExtraCaCertCandidates(this.getPluginBasePath());

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  getAttachmentFolder(): string {
    return normalizeAttachmentFolder(this.settings.attachmentFolder);
  }

  getVaultRelativePath(localPath: string): string | null {
    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      return null;
    }

    const resolvedVault = resolve(vaultPath);
    const resolvedLocal = resolve(localPath);
    if (!isPathInside(resolvedVault, resolvedLocal)) {
      return null;
    }

    return normalizePath(relative(resolvedVault, resolvedLocal).replace(/\\/g, "/"));
  }

  async saveAttachmentBytes(bytes: Uint8Array, extension = "png", label = "attachment"): Promise<string> {
    const folder = this.getAttachmentFolder();
    await ensureVaultFolder(this.app, folder);

    const safeExtension = sanitizeExtension(extension);
    const safeLabel = sanitizeFileStem(label);
    const timestamp = formatAttachmentTimestamp(new Date());
    let candidate = normalizePath(`${folder}/${timestamp}-${safeLabel}.${safeExtension}`);
    let suffix = 2;

    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(`${folder}/${timestamp}-${safeLabel}-${suffix}.${safeExtension}`);
      suffix += 1;
    }

    const file = await this.app.vault.createBinary(candidate, toArrayBuffer(bytes));
    return file.path;
  }

  async insertVaultReferences(paths: string[]) {
    if (paths.length > 0) {
      new Notice("Use Agent Console > Add current note or Attach to send vault references.");
    }
  }

  async insertCurrentNoteReference() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active note to reference.");
      return;
    }

    await this.insertVaultReferences([file.path]);
  }

  async getOrCreateTerminalView(): Promise<VaultPowerShellView> {
    await this.activateView();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_POWERSHELL)[0]?.view;
    if (!(view instanceof VaultPowerShellView)) {
      throw new Error("Obst Terminal view is not available.");
    }

    return view;
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_POWERSHELL)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: VIEW_TYPE_POWERSHELL,
      state: this.getSavedAgentViewState() ?? createAgentViewSessionState("legacy-latest"),
      active: true
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  async activateNewSessionView() {
    const view = await this.getOrCreateTerminalView();
    view.createInternalAgentSession();
  }
}

class VaultPowerShellView extends ItemView {
  private plugin: VaultPowerShellPlugin;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddonLike | null = null;
  private host: ChildProcessWithoutNullStreams | null = null;
  private hostReady = false;
  private hostStdoutBuffer = "";
  private terminalContainer: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private pendingFitFrame: number | null = null;
  private pendingFitTimers = new Set<number>();
  private pendingRefreshFrame: number | null = null;
  private windowKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private handledShiftEnterEvents = new WeakSet<KeyboardEvent>();
  private handledClaudeSuggestionEnterEvents = new WeakSet<KeyboardEvent>();
  private pendingShiftEnterTimers = new Set<number>();
  private lastShiftEnterAt = 0;
  private cachedClaudeSuggestion: string | null = null;
  private cachedClaudeSuggestionAt = 0;
  private claudeSuggestionOutputTail = "";
  private lastSentResize: { cols: number; rows: number } | null = null;
  private wheelLineAccumulator = 0;
  private alternateWheelAccumulator = 0;
  private inputLineBuffer = "";
  private inputLineReliable = true;
  private runtimePromptEl: HTMLElement | null = null;
  private pendingInsertTexts: string[] = [];
  private activePane: ViewPane = "agent";
  private paneTabEls: Record<ViewPane, HTMLElement | null> = { agent: null, terminal: null };
  private agentPaneEl: HTMLElement | null = null;
  private terminalPaneEl: HTMLElement | null = null;
  private terminalHostEl: HTMLElement | null = null;
  private terminalStarted = false;
  private agentSessions: AgentWorkspaceSessionState[] = [];
  private activeAgentSessionKey: string | null = null;
  private visibleAgentSessionKey: string | null = null;
  private agentSessionTabsEl: HTMLElement | null = null;
  private agentSessionTabEls = new Map<string, HTMLElement>();
  private agentTranscriptMountEl: HTMLElement | null = null;
  private agentSessionKey = createAgentSessionKey();
  private agentSessionLabel = createAgentSessionLabel(this.agentSessionKey);
  private agentSessionMode: AgentSessionMode = "legacy-latest";
  private agentCodexThreadId: string | null = null;
  private agentSessionTitleInputEl: HTMLInputElement | null = null;
  private agentSessionSubtitleEl: HTMLElement | null = null;
  private agentProvider: AgentProvider = "claude";
  private agentBackend: AgentBackend | null = null;
  private agentBackendUnsubscribe: (() => void) | null = null;
  private codexItemEls = new Map<string, HTMLElement>();
  private codexDeltaBuffers = new Map<string, string>();
  private codexDeltaFlushTimer: number | null = null;
  private codexScrollFrame: number | null = null;
  private codexApprovalEls = new Map<string, HTMLElement>();
  private codexCurrentTurnEl: HTMLElement | null = null;
  private codexCurrentAnswerEl: HTMLElement | null = null;
  private codexTurnLoadingEl: HTMLElement | null = null;
  private codexTurnActive = false;
  private codexTurnCompletionFallbackTimer: number | null = null;
  private codexQueuedInputs: { text: string; attachments: AgentAttachment[] }[] = [];
  private agentSendButton: HTMLButtonElement | null = null;
  private codexStatusLineEl: HTMLElement | null = null;
  private codexStatusLineFrame: number | null = null;
  private codexContextPercent: number | null = null;
  private codexRateLimitWindows: AgentUsageWindow[] = [];
  private codexGitBranch: string | null | undefined = undefined;
  private codexOptionsRow: HTMLElement | null = null;
  private codexModelSelect: HTMLSelectElement | null = null;
  private codexEffortSelect: HTMLSelectElement | null = null;
  private codexAccessSelect: HTMLSelectElement | null = null;
  private codexModels: AgentModelInfo[] = [];
  private codexPendingAttachments: AgentAttachment[] = [];
  private codexAttachmentsEl: HTMLElement | null = null;
  private agentAttachButton: HTMLButtonElement | null = null;
  private agentHost: ChildProcessWithoutNullStreams | null = null;
  private agentHostReady = false;
  private agentReadyForInput = false;
  private agentStdoutBuffer = "";
  private agentStatusEl: HTMLElement | null = null;
  private agentStatusText = "Idle";
  private agentTranscriptEl: HTMLElement | null = null;
  private claudeTranscriptEl: HTMLElement | null = null;
  private codexTranscriptEl: HTMLElement | null = null;
  private suppressAgentTranscriptScrollMemory = false;
  private agentLoadingEl: HTMLElement | null = null;
  private agentLoadingTextEl: HTMLElement | null = null;
  private agentPromptActionsEl: HTMLElement | null = null;
  private agentLoginButton: HTMLButtonElement | null = null;
  private agentInputEl: HTMLTextAreaElement | null = null;
  private agentProviderButtons: Record<AgentProvider, HTMLElement | null> = { claude: null, codex: null };
  private agentProviderIndicatorEl: HTMLElement | null = null;
  private agentSessionPollTimer: number | null = null;
  private agentReadyTimer: number | null = null;
  private agentOutputIdleTimer: number | null = null;
  private agentStartedAt = 0;
  private agentSessionPath: string | null = null;
  private agentSessionOffset = 0;
  private agentCurrentTurnStartedAt = 0;
  private agentSessionBaselineOffsets = new Map<string, number>();
  private agentClaudePrintTurnActive = false;
  private agentClaudeSessionId: string | null = randomUUID();
  private agentClaudeControlSessionId: string | null = null;
  private lastAgentLaunchCommand = "";
  private agentSeenEntries = new Set<string>();
  private agentLocalMessageCounter = 0;
  private agentLastRawNotice = "";
  private agentAuthState: AgentAuthState = "idle";
  private agentConversationReady = false;
  private agentReadyNoticeShown = false;
  private agentAutoLoginAttempted = false;
  private agentAutoLoginPending = false;
  private agentAutoMcpAttempted = false;
  private agentMcpAuthInProgress = false;
  private agentNeedsAuth = false;
  private agentPromptState: AgentPromptState | null = null;
  private agentOpenedExternalUrls = new Set<string>();

  constructor(leaf: WorkspaceLeaf, plugin: VaultPowerShellPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_POWERSHELL;
  }

  getDisplayText(): string {
    return this.agentSessionLabel ? `Obst ${this.agentSessionLabel}` : "Obst Terminal";
  }

  getIcon(): string {
    return OBST_TERMINAL_ICON;
  }

  getState(): Record<string, unknown> {
    this.captureActiveAgentSessionState();
    return {
      agentSessions: this.cloneAgentSessionsForState(),
      activeAgentSessionKey: this.activeAgentSessionKey,
      agentSessionKey: this.agentSessionKey,
      agentSessionLabel: this.agentSessionLabel,
      agentSessionMode: this.agentSessionMode,
      agentProvider: this.agentProvider,
      activePane: this.activePane,
      claudeSessionId: this.agentClaudeSessionId,
      claudeControlSessionId: this.agentClaudeControlSessionId,
      codexThreadId: this.agentCodexThreadId
    };
  }

  setState(state: unknown): Promise<void> {
    this.applyAgentViewState(state);
    this.renderAgentSessionTabs();
    this.restoreActiveAgentSessionDom();
    this.refreshAgentSessionChrome();
    return Promise.resolve();
  }

  onOpen(): Promise<void> {
    this.ensureInternalAgentSessions();
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("vault-powershell-view");

    this.paneTabEls = { agent: null, terminal: null };

    this.agentPaneEl = container.createDiv("vault-agent-pane");
    this.createAgentConsole(this.agentPaneEl);

    this.showPane(this.activePane, false);
    return Promise.resolve();
  }

  async onClose(): Promise<void> {
    this.captureActiveAgentSessionState();
    await this.plugin.saveAgentViewStateSnapshot(this.getState() as AgentViewSessionState);
    for (const session of [...this.agentSessions]) {
      this.withAgentSession(session.agentSessionKey, () => {
        this.disposeAgent();
      });
    }
    this.disposeShell();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.clearRuntimePrompt();
    if (this.windowKeydownHandler) {
      window.removeEventListener("keydown", this.windowKeydownHandler, { capture: true });
      this.windowKeydownHandler = null;
    }
    if (this.pendingFitFrame !== null) {
      cancelAnimationFrame(this.pendingFitFrame);
      this.pendingFitFrame = null;
    }
    this.pendingFitTimers.forEach((timer) => window.clearTimeout(timer));
    this.pendingFitTimers.clear();
    if (this.pendingRefreshFrame !== null) {
      cancelAnimationFrame(this.pendingRefreshFrame);
      this.pendingRefreshFrame = null;
    }
    this.pendingShiftEnterTimers.forEach((timer) => window.clearTimeout(timer));
    this.pendingShiftEnterTimers.clear();
    this.pendingInsertTexts = [];
    this.terminal?.dispose();
    this.terminal = null;
    this.terminalContainer = null;
    this.fitAddon = null;
    this.terminalStarted = false;
    this.agentPaneEl = null;
    this.terminalPaneEl = null;
    this.terminalHostEl = null;
    this.agentStatusEl = null;
    this.agentSessionTabsEl = null;
    this.agentSessionTabEls.clear();
    this.agentTranscriptMountEl = null;
    this.agentSessionTitleInputEl = null;
    this.agentSessionSubtitleEl = null;
    this.agentTranscriptEl = null;
    this.agentLoadingEl = null;
    this.agentLoadingTextEl = null;
    this.agentPromptActionsEl = null;
    this.agentLoginButton = null;
    this.agentInputEl = null;
    this.agentAttachButton = null;
    this.codexStatusLineEl = null;
    this.paneTabEls = { agent: null, terminal: null };
    this.agentProviderButtons = { claude: null, codex: null };
    this.agentProviderIndicatorEl = null;
  }

  private applyAgentViewState(state: unknown) {
    if (!state || typeof state !== "object") {
      this.ensureInternalAgentSessions();
      return;
    }
    const value = state as AgentViewSessionState;

    const storedSessions = Array.isArray(value.agentSessions)
      ? value.agentSessions
        .map((session) => normalizeAgentWorkspaceSessionState(session))
        .filter((session): session is AgentWorkspaceSessionState => session !== null)
      : [];

    if (storedSessions.length > 0) {
      this.agentSessions = storedSessions;
      this.activeAgentSessionKey = typeof value.activeAgentSessionKey === "string" &&
        storedSessions.some((session) => session.agentSessionKey === value.activeAgentSessionKey)
        ? value.activeAgentSessionKey
        : storedSessions[0].agentSessionKey;
      this.visibleAgentSessionKey = this.activeAgentSessionKey;
      this.applyAgentSessionFields(this.getActiveAgentSessionState());
    } else {
      if (typeof value.agentSessionKey === "string" && value.agentSessionKey.trim()) {
        this.agentSessionKey = value.agentSessionKey.trim();
      }
      if (typeof value.agentSessionLabel === "string" && value.agentSessionLabel.trim()) {
        this.agentSessionLabel = value.agentSessionLabel.trim();
      } else if (!this.agentSessionLabel) {
        this.agentSessionLabel = createAgentSessionLabel(this.agentSessionKey);
      }
      if (value.agentSessionMode === "isolated" || value.agentSessionMode === "legacy-latest") {
        this.agentSessionMode = value.agentSessionMode;
      }
      if (value.agentProvider === "claude" || value.agentProvider === "codex") {
        this.agentProvider = value.agentProvider;
      }
      if (typeof value.claudeSessionId === "string" && value.claudeSessionId.trim()) {
        this.agentClaudeSessionId = value.claudeSessionId.trim();
      }
      if (typeof value.claudeControlSessionId === "string" && value.claudeControlSessionId.trim()) {
        this.agentClaudeControlSessionId = value.claudeControlSessionId.trim();
      }
      if (typeof value.codexThreadId === "string" && value.codexThreadId.trim()) {
        this.agentCodexThreadId = value.codexThreadId.trim();
      } else if (value.codexThreadId === null) {
        this.agentCodexThreadId = null;
      }
      this.agentSessions = [this.createSessionStateFromActiveFields()];
      this.activeAgentSessionKey = this.agentSessionKey;
      this.visibleAgentSessionKey = this.agentSessionKey;
    }

    this.activePane = "agent";

    this.ensureInternalAgentSessions();
  }

  private saveAgentViewState() {
    void this.plugin.saveAgentViewStateSnapshot(this.getState() as AgentViewSessionState);
    this.app.workspace.requestSaveLayout();
  }

  private refreshAgentSessionChrome() {
    if (!this.isVisibleAgentSessionContext()) {
      return;
    }
    if (this.agentSessionTitleInputEl && this.agentSessionTitleInputEl.value !== this.agentSessionLabel) {
      this.agentSessionTitleInputEl.value = this.agentSessionLabel;
    }
    const path = this.plugin.getVaultPath() ?? "No local vault path";
    const mode = this.agentSessionMode === "isolated" ? "isolated" : "latest fallback";
    const codex = this.agentCodexThreadId ? ` · codex:${shortSessionId(this.agentCodexThreadId)}` : "";
    const claude = this.agentClaudeSessionId ? ` · claude:${shortSessionId(this.agentClaudeSessionId)}` : "";
    this.agentSessionSubtitleEl?.setText(`${path} · ${mode}${claude}${codex}`);
  }

  private commitAgentSessionLabel(value: string) {
    const next = value.trim() || createAgentSessionLabel(this.agentSessionKey);
    if (next === this.agentSessionLabel) {
      this.refreshAgentSessionChrome();
      return;
    }
    this.agentSessionLabel = next;
    this.captureActiveAgentSessionState();
    this.renderAgentSessionTabs();
    this.saveAgentViewState();
    this.refreshAgentSessionChrome();
  }

  private ensureClaudeSessionId(): string {
    if (!this.agentClaudeSessionId) {
      this.agentClaudeSessionId = randomUUID();
      this.saveAgentViewState();
      this.refreshAgentSessionChrome();
    }
    return this.agentClaudeSessionId;
  }

  private ensureClaudeControlSessionId(): string {
    if (!this.agentClaudeControlSessionId) {
      this.agentClaudeControlSessionId = randomUUID();
      this.saveAgentViewState();
    }
    return this.agentClaudeControlSessionId;
  }

  createInternalAgentSession() {
    this.ensureInternalAgentSessions();
    this.captureActiveAgentSessionState();

    const session = createAgentWorkspaceSessionState("isolated");
    this.ensureAgentSessionRuntime(session);
    this.agentSessions.push(session);
    this.activeAgentSessionKey = session.agentSessionKey;
    this.visibleAgentSessionKey = session.agentSessionKey;
    this.applyAgentSessionRuntime(session);
    this.restoreActiveAgentSessionDom();
    this.renderAgentSessionTabs();
    this.showPane("agent");
    this.saveAgentViewState();
  }

  private ensureInternalAgentSessions() {
    if (this.agentSessions.length === 0) {
      const session = this.createSessionStateFromActiveFields();
      this.ensureAgentSessionRuntime(session);
      this.agentSessions = [session];
      this.activeAgentSessionKey = session.agentSessionKey;
      this.visibleAgentSessionKey = session.agentSessionKey;
      return;
    }

    if (!this.activeAgentSessionKey || !this.agentSessions.some((session) => session.agentSessionKey === this.activeAgentSessionKey)) {
      this.activeAgentSessionKey = this.agentSessions[0].agentSessionKey;
    }
    if (!this.visibleAgentSessionKey || !this.agentSessions.some((session) => session.agentSessionKey === this.visibleAgentSessionKey)) {
      this.visibleAgentSessionKey = this.activeAgentSessionKey;
    }
    this.agentSessions.forEach((session) => this.ensureAgentSessionRuntime(session));
  }

  private getActiveAgentSessionState(): AgentWorkspaceSessionState {
    this.ensureInternalAgentSessions();
    const session = this.agentSessions.find((candidate) => candidate.agentSessionKey === this.activeAgentSessionKey);
    if (session) {
      return session;
    }

    const fallback = this.agentSessions[0] ?? this.createSessionStateFromActiveFields();
    if (this.agentSessions.length === 0) {
      this.agentSessions.push(fallback);
    }
    this.activeAgentSessionKey = fallback.agentSessionKey;
    return fallback;
  }

  private createSessionStateFromActiveFields(): AgentWorkspaceSessionState {
    const now = Date.now();
    return {
      agentSessionKey: this.agentSessionKey,
      agentSessionLabel: this.agentSessionLabel || createAgentSessionLabel(this.agentSessionKey),
      agentSessionMode: this.agentSessionMode,
      agentProvider: this.agentProvider,
      claudeSessionId: this.agentClaudeSessionId,
      claudeControlSessionId: this.agentClaudeControlSessionId,
      codexThreadId: this.agentCodexThreadId,
      claudeTranscriptHtml: sanitizeAgentTranscriptHtml(this.claudeTranscriptEl?.innerHTML ?? ""),
      codexTranscriptHtml: sanitizeAgentTranscriptHtml(this.codexTranscriptEl?.innerHTML ?? ""),
      claudeScrollTop: this.getReadableAgentTranscriptScrollTop(this.claudeTranscriptEl, 0),
      codexScrollTop: this.getReadableAgentTranscriptScrollTop(this.codexTranscriptEl, 0),
      inputText: this.agentInputEl?.value ?? "",
      statusText: this.agentStatusText,
      createdAt: now,
      updatedAt: now
    };
  }

  private applyAgentSessionFields(session: AgentWorkspaceSessionState) {
    this.agentSessionKey = session.agentSessionKey;
    this.agentSessionLabel = session.agentSessionLabel || createAgentSessionLabel(session.agentSessionKey);
    this.agentSessionMode = session.agentSessionMode;
    this.agentProvider = session.agentProvider;
    this.agentClaudeSessionId = session.claudeSessionId;
    this.agentClaudeControlSessionId = session.claudeControlSessionId ?? null;
    this.agentCodexThreadId = session.codexThreadId;
  }

  private getReadableAgentTranscriptScrollTop(el: HTMLElement | null | undefined, fallback: number): number {
    return this.isAgentTranscriptScrollReadable(el) ? el.scrollTop : fallback;
  }

  private isAgentTranscriptScrollReadable(el: HTMLElement | null | undefined): el is HTMLElement {
    return !!el &&
      el.isConnected &&
      el.parentElement === this.agentTranscriptMountEl &&
      !el.hasClass("is-hidden") &&
      el.clientHeight > 0;
  }

  private ensureAgentSessionRuntime(session: AgentWorkspaceSessionState) {
    session.claudeTranscriptEl ??= this.createDetachedAgentTranscriptEl();
    session.codexTranscriptEl ??= this.createDetachedAgentTranscriptEl();
    if (session.claudeTranscriptHtml && !session.claudeTranscriptEl.innerHTML.trim()) {
      session.claudeTranscriptEl.innerHTML = session.claudeTranscriptHtml;
    }
    if (session.codexTranscriptHtml && !session.codexTranscriptEl.innerHTML.trim()) {
      session.codexTranscriptEl.innerHTML = session.codexTranscriptHtml;
    }
    session.claudeScrollTop ??= 0;
    session.codexScrollTop ??= 0;
    session.agentBackend ??= null;
    session.agentBackendUnsubscribe ??= null;
    session.codexItemEls ??= new Map<string, HTMLElement>();
    session.codexDeltaBuffers ??= new Map<string, string>();
    session.codexDeltaFlushTimer ??= null;
    session.codexScrollFrame ??= null;
    session.codexApprovalEls ??= new Map<string, HTMLElement>();
    session.codexCurrentTurnEl ??= null;
    session.codexCurrentAnswerEl ??= null;
    session.codexTurnLoadingEl ??= null;
    session.codexTurnActive ??= false;
    session.codexTurnCompletionFallbackTimer ??= null;
    session.codexQueuedInputs ??= [];
    session.codexContextPercent ??= null;
    session.codexRateLimitWindows ??= [];
    session.codexGitBranch ??= undefined;
    session.codexModels ??= [];
    session.codexPendingAttachments ??= [];
    session.agentHost ??= null;
    session.agentHostReady ??= false;
    session.agentReadyForInput ??= false;
    session.agentStdoutBuffer ??= "";
    session.agentSessionPollTimer ??= null;
    session.agentReadyTimer ??= null;
    session.agentOutputIdleTimer ??= null;
    session.agentStartedAt ??= 0;
    session.agentSessionPath ??= null;
    session.agentSessionOffset ??= 0;
    session.agentCurrentTurnStartedAt ??= 0;
    session.agentSessionBaselineOffsets ??= new Map<string, number>();
    session.agentClaudePrintTurnActive ??= false;
    session.agentClaudeControlSessionId ??= session.claudeControlSessionId ?? null;
    session.lastAgentLaunchCommand ??= "";
    session.agentSeenEntries ??= new Set<string>();
    session.agentLocalMessageCounter ??= 0;
    session.agentLastRawNotice ??= "";
    session.agentAuthState ??= "idle";
    session.agentConversationReady ??= false;
    session.agentReadyNoticeShown ??= false;
    session.agentAutoLoginAttempted ??= false;
    session.agentAutoLoginPending ??= false;
    session.agentAutoMcpAttempted ??= false;
    session.agentMcpAuthInProgress ??= false;
    session.agentNeedsAuth ??= false;
    session.agentPromptState ??= null;
    session.agentOpenedExternalUrls ??= new Set<string>();
  }

  private createDetachedAgentTranscriptEl(): HTMLElement {
    const el = document.createElement("div");
    el.addClass("vault-agent-transcript");
    el.addEventListener("scroll", () => {
      this.rememberAgentTranscriptScrollPosition(el);
    }, { passive: true });
    return el;
  }

  private applyAgentSessionRuntime(session: AgentWorkspaceSessionState) {
    this.ensureAgentSessionRuntime(session);
    this.applyAgentSessionFields(session);
    this.claudeTranscriptEl = session.claudeTranscriptEl ?? null;
    this.codexTranscriptEl = session.codexTranscriptEl ?? null;
    this.agentBackend = session.agentBackend ?? null;
    this.agentBackendUnsubscribe = session.agentBackendUnsubscribe ?? null;
    this.codexItemEls = session.codexItemEls ?? new Map<string, HTMLElement>();
    this.codexDeltaBuffers = session.codexDeltaBuffers ?? new Map<string, string>();
    this.codexDeltaFlushTimer = session.codexDeltaFlushTimer ?? null;
    this.codexScrollFrame = session.codexScrollFrame ?? null;
    this.codexApprovalEls = session.codexApprovalEls ?? new Map<string, HTMLElement>();
    this.codexCurrentTurnEl = session.codexCurrentTurnEl ?? null;
    this.codexCurrentAnswerEl = session.codexCurrentAnswerEl ?? null;
    this.codexTurnLoadingEl = session.codexTurnLoadingEl ?? null;
    this.codexTurnActive = session.codexTurnActive ?? false;
    this.codexTurnCompletionFallbackTimer = session.codexTurnCompletionFallbackTimer ?? null;
    this.codexQueuedInputs = session.codexQueuedInputs ?? [];
    this.codexContextPercent = session.codexContextPercent ?? null;
    this.codexRateLimitWindows = session.codexRateLimitWindows ?? [];
    this.codexGitBranch = session.codexGitBranch;
    this.codexModels = session.codexModels ?? [];
    this.codexPendingAttachments = session.codexPendingAttachments ?? [];
    this.agentHost = session.agentHost ?? null;
    this.agentHostReady = session.agentHostReady ?? false;
    this.agentReadyForInput = session.agentReadyForInput ?? false;
    this.agentStdoutBuffer = session.agentStdoutBuffer ?? "";
    this.agentSessionPollTimer = session.agentSessionPollTimer ?? null;
    this.agentReadyTimer = session.agentReadyTimer ?? null;
    this.agentOutputIdleTimer = session.agentOutputIdleTimer ?? null;
    this.agentStartedAt = session.agentStartedAt ?? 0;
    this.agentSessionPath = session.agentSessionPath ?? null;
    this.agentSessionOffset = session.agentSessionOffset ?? 0;
    this.agentCurrentTurnStartedAt = session.agentCurrentTurnStartedAt ?? 0;
    this.agentSessionBaselineOffsets = session.agentSessionBaselineOffsets ?? new Map<string, number>();
    this.agentClaudePrintTurnActive = session.agentClaudePrintTurnActive ?? false;
    this.agentClaudeControlSessionId = session.agentClaudeControlSessionId ?? session.claudeControlSessionId ?? null;
    this.lastAgentLaunchCommand = session.lastAgentLaunchCommand ?? "";
    this.agentSeenEntries = session.agentSeenEntries ?? new Set<string>();
    this.agentLocalMessageCounter = session.agentLocalMessageCounter ?? 0;
    this.agentLastRawNotice = session.agentLastRawNotice ?? "";
    this.agentAuthState = session.agentAuthState ?? "idle";
    this.agentConversationReady = session.agentConversationReady ?? false;
    this.agentReadyNoticeShown = session.agentReadyNoticeShown ?? false;
    this.agentAutoLoginAttempted = session.agentAutoLoginAttempted ?? false;
    this.agentAutoLoginPending = session.agentAutoLoginPending ?? false;
    this.agentAutoMcpAttempted = session.agentAutoMcpAttempted ?? false;
    this.agentMcpAuthInProgress = session.agentMcpAuthInProgress ?? false;
    this.agentNeedsAuth = session.agentNeedsAuth ?? false;
    this.agentPromptState = session.agentPromptState ?? null;
    this.agentOpenedExternalUrls = session.agentOpenedExternalUrls ?? new Set<string>();
    this.agentStatusText = session.statusText ?? "Idle";
    this.agentTranscriptEl = this.agentProvider === "codex" ? this.codexTranscriptEl : this.claudeTranscriptEl;
    if (!this.codexTurnActive) {
      this.clearCodexTurnLoadingIndicators(this.codexTranscriptEl);
    }
  }

  private captureActiveAgentSessionState() {
    this.ensureInternalAgentSessions();
    const session = this.getActiveAgentSessionState();
    session.agentSessionKey = this.agentSessionKey;
    session.agentSessionLabel = this.agentSessionLabel || createAgentSessionLabel(this.agentSessionKey);
    session.agentSessionMode = this.agentSessionMode;
    session.agentProvider = this.agentProvider;
    session.claudeSessionId = this.agentClaudeSessionId;
    session.claudeControlSessionId = this.agentClaudeControlSessionId;
    session.codexThreadId = this.agentCodexThreadId;
    if (this.claudeTranscriptEl) {
      session.claudeTranscriptHtml = sanitizeAgentTranscriptHtml(this.claudeTranscriptEl.innerHTML);
      if (this.isVisibleAgentSessionContext() && this.isAgentTranscriptScrollReadable(this.claudeTranscriptEl)) {
        session.claudeScrollTop = this.claudeTranscriptEl.scrollTop;
      }
    }
    if (this.codexTranscriptEl) {
      session.codexTranscriptHtml = sanitizeAgentTranscriptHtml(this.codexTranscriptEl.innerHTML);
      if (this.isVisibleAgentSessionContext() && this.isAgentTranscriptScrollReadable(this.codexTranscriptEl)) {
        session.codexScrollTop = this.codexTranscriptEl.scrollTop;
      }
    }
    if (this.agentInputEl) {
      session.inputText = this.agentInputEl.value;
    }
    session.statusText = this.agentStatusText;
    session.claudeTranscriptEl = this.claudeTranscriptEl;
    session.codexTranscriptEl = this.codexTranscriptEl;
    session.agentBackend = this.agentBackend;
    session.agentBackendUnsubscribe = this.agentBackendUnsubscribe;
    session.codexItemEls = this.codexItemEls;
    session.codexDeltaBuffers = this.codexDeltaBuffers;
    session.codexDeltaFlushTimer = this.codexDeltaFlushTimer;
    session.codexScrollFrame = this.codexScrollFrame;
    session.codexApprovalEls = this.codexApprovalEls;
    session.codexCurrentTurnEl = this.codexCurrentTurnEl;
    session.codexCurrentAnswerEl = this.codexCurrentAnswerEl;
    session.codexTurnLoadingEl = this.codexTurnLoadingEl;
    session.codexTurnActive = this.codexTurnActive;
    session.codexTurnCompletionFallbackTimer = this.codexTurnCompletionFallbackTimer;
    session.codexQueuedInputs = this.codexQueuedInputs;
    session.codexContextPercent = this.codexContextPercent;
    session.codexRateLimitWindows = this.codexRateLimitWindows;
    session.codexGitBranch = this.codexGitBranch;
    session.codexModels = this.codexModels;
    session.codexPendingAttachments = this.codexPendingAttachments;
    session.agentHost = this.agentHost;
    session.agentHostReady = this.agentHostReady;
    session.agentReadyForInput = this.agentReadyForInput;
    session.agentStdoutBuffer = this.agentStdoutBuffer;
    session.agentSessionPollTimer = this.agentSessionPollTimer;
    session.agentReadyTimer = this.agentReadyTimer;
    session.agentOutputIdleTimer = this.agentOutputIdleTimer;
    session.agentStartedAt = this.agentStartedAt;
    session.agentSessionPath = this.agentSessionPath;
    session.agentSessionOffset = this.agentSessionOffset;
    session.agentCurrentTurnStartedAt = this.agentCurrentTurnStartedAt;
    session.agentSessionBaselineOffsets = this.agentSessionBaselineOffsets;
    session.agentClaudePrintTurnActive = this.agentClaudePrintTurnActive;
    session.agentClaudeControlSessionId = this.agentClaudeControlSessionId;
    session.lastAgentLaunchCommand = this.lastAgentLaunchCommand;
    session.agentSeenEntries = this.agentSeenEntries;
    session.agentLocalMessageCounter = this.agentLocalMessageCounter;
    session.agentLastRawNotice = this.agentLastRawNotice;
    session.agentAuthState = this.agentAuthState;
    session.agentConversationReady = this.agentConversationReady;
    session.agentReadyNoticeShown = this.agentReadyNoticeShown;
    session.agentAutoLoginAttempted = this.agentAutoLoginAttempted;
    session.agentAutoLoginPending = this.agentAutoLoginPending;
    session.agentAutoMcpAttempted = this.agentAutoMcpAttempted;
    session.agentMcpAuthInProgress = this.agentMcpAuthInProgress;
    session.agentNeedsAuth = this.agentNeedsAuth;
    session.agentPromptState = this.agentPromptState;
    session.agentOpenedExternalUrls = this.agentOpenedExternalUrls;
    session.updatedAt = Date.now();
  }

  private cloneAgentSessionsForState(): AgentWorkspaceSessionState[] {
    this.ensureInternalAgentSessions();
    return this.agentSessions.map((session) => ({
      agentSessionKey: session.agentSessionKey,
      agentSessionLabel: session.agentSessionLabel,
      agentSessionMode: session.agentSessionMode,
      agentProvider: session.agentProvider,
      claudeSessionId: session.claudeSessionId,
      claudeControlSessionId: session.claudeControlSessionId ?? null,
      codexThreadId: session.codexThreadId,
      claudeTranscriptHtml: sanitizeAgentTranscriptHtml(session.claudeTranscriptHtml ?? ""),
      codexTranscriptHtml: sanitizeAgentTranscriptHtml(session.codexTranscriptHtml ?? ""),
      claudeScrollTop: session.claudeScrollTop ?? 0,
      codexScrollTop: session.codexScrollTop ?? 0,
      inputText: session.inputText ?? "",
      statusText: session.statusText ?? "Idle",
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    }));
  }

  private restoreActiveAgentSessionDom() {
    if (!this.agentPaneEl) {
      return;
    }

    const session = this.getActiveAgentSessionState();
    this.applyAgentSessionRuntime(session);
    this.mountVisibleAgentSessionTranscript();
    this.agentInputEl && (this.agentInputEl.value = session.inputText ?? "");

    this.refreshAgentSessionChrome();
    this.refreshAgentProviderButtons();
    this.switchAgentTranscript(this.agentProvider);
    this.setAgentStatus(session.statusText ?? "Idle");
    this.updateSendButtonMode();
    this.renderAttachmentChips();
    this.refreshAgentPromptActions();

    if (!this.claudeTranscriptEl?.innerHTML.trim() && !this.codexTranscriptEl?.innerHTML.trim()) {
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: `${this.agentSessionLabel} 세션입니다. Claude 또는 Codex를 시작하세요. 이 플러그인 안의 각 탭은 고유 Claude sessionId / Codex threadId를 유지합니다.`
      });
      this.captureActiveAgentSessionState();
    }
  }

  private mountVisibleAgentSessionTranscript() {
    if (!this.agentTranscriptMountEl || !this.claudeTranscriptEl || !this.codexTranscriptEl) {
      return;
    }

    const session = this.getActiveAgentSessionState();
    const claudeScrollTop = this.getReadableAgentTranscriptScrollTop(this.claudeTranscriptEl, session.claudeScrollTop ?? 0);
    const codexScrollTop = this.getReadableAgentTranscriptScrollTop(this.codexTranscriptEl, session.codexScrollTop ?? 0);

    this.suppressAgentTranscriptScrollMemory = true;
    try {
      this.agentTranscriptMountEl.empty();
      this.agentTranscriptMountEl.appendChild(this.claudeTranscriptEl);
      this.agentTranscriptMountEl.appendChild(this.codexTranscriptEl);
      this.switchAgentTranscript(this.agentProvider);
      this.restoreAgentTranscriptScrollPositions(claudeScrollTop, codexScrollTop);
    } finally {
      this.suppressAgentTranscriptScrollMemory = false;
    }
  }

  private rememberAgentTranscriptScrollPosition(el: HTMLElement) {
    if (this.suppressAgentTranscriptScrollMemory) {
      return;
    }

    if (!this.isVisibleAgentSessionContext()) {
      return;
    }

    const session = this.getActiveAgentSessionState();
    if (el === this.claudeTranscriptEl) {
      if (this.isAgentTranscriptScrollReadable(el)) {
        session.claudeScrollTop = el.scrollTop;
      }
    } else if (el === this.codexTranscriptEl) {
      if (this.isAgentTranscriptScrollReadable(el)) {
        session.codexScrollTop = el.scrollTop;
      }
    }
  }

  private restoreAgentTranscriptScrollPositions(claudeScrollTop: number, codexScrollTop: number) {
    this.withSuppressedAgentTranscriptScrollMemory(() => {
      this.setTranscriptScrollTop(this.claudeTranscriptEl, claudeScrollTop);
      this.setTranscriptScrollTop(this.codexTranscriptEl, codexScrollTop);
    });
    window.requestAnimationFrame(() => {
      this.withSuppressedAgentTranscriptScrollMemory(() => {
        this.setTranscriptScrollTop(this.claudeTranscriptEl, claudeScrollTop);
        this.setTranscriptScrollTop(this.codexTranscriptEl, codexScrollTop);
      });
    });
  }

  private setTranscriptScrollTop(el: HTMLElement | null, value: number) {
    if (!el || !Number.isFinite(value)) {
      return;
    }
    el.scrollTop = Math.max(0, value);
  }

  private withSuppressedAgentTranscriptScrollMemory(action: () => void) {
    const previous = this.suppressAgentTranscriptScrollMemory;
    this.suppressAgentTranscriptScrollMemory = true;
    try {
      action();
    } finally {
      this.suppressAgentTranscriptScrollMemory = previous;
    }
  }

  private restoreVisibleAgentTranscriptScrollPosition(provider: AgentProvider) {
    const session = this.getActiveAgentSessionState();
    const el = provider === "codex" ? this.codexTranscriptEl : this.claudeTranscriptEl;
    const scrollTop = provider === "codex"
      ? session.codexScrollTop ?? el?.scrollTop ?? 0
      : session.claudeScrollTop ?? el?.scrollTop ?? 0;
    this.withSuppressedAgentTranscriptScrollMemory(() => {
      this.setTranscriptScrollTop(el, scrollTop);
    });
    window.requestAnimationFrame(() => {
      this.withSuppressedAgentTranscriptScrollMemory(() => {
        this.setTranscriptScrollTop(el, scrollTop);
      });
    });
  }

  private isVisibleAgentSessionContext(): boolean {
    return !this.visibleAgentSessionKey || this.activeAgentSessionKey === this.visibleAgentSessionKey;
  }

  private withAgentSession<T>(sessionKey: string | null, action: () => T): T {
    if (!sessionKey || sessionKey === this.activeAgentSessionKey) {
      const result = action();
      this.captureActiveAgentSessionState();
      return result;
    }

    const previousKey = this.activeAgentSessionKey;
    this.captureActiveAgentSessionState();
    const session = this.agentSessions.find((candidate) => candidate.agentSessionKey === sessionKey);
    if (!session) {
      return action();
    }

    this.activeAgentSessionKey = sessionKey;
    this.applyAgentSessionRuntime(session);
    try {
      const result = action();
      this.captureActiveAgentSessionState();
      return result;
    } finally {
      const previous = this.agentSessions.find((candidate) => candidate.agentSessionKey === previousKey);
      if (previous) {
        this.activeAgentSessionKey = previous.agentSessionKey;
        this.applyAgentSessionRuntime(previous);
        this.mountVisibleAgentSessionTranscript();
      }
    }
  }

  private async withAgentSessionAsync<T>(sessionKey: string | null, action: () => Promise<T>): Promise<T> {
    if (!sessionKey || sessionKey === this.activeAgentSessionKey) {
      const result = await action();
      this.captureActiveAgentSessionState();
      return result;
    }

    const previousKey = this.activeAgentSessionKey;
    this.captureActiveAgentSessionState();
    const session = this.agentSessions.find((candidate) => candidate.agentSessionKey === sessionKey);
    if (!session) {
      return action();
    }

    this.activeAgentSessionKey = sessionKey;
    this.applyAgentSessionRuntime(session);
    try {
      const result = await action();
      this.captureActiveAgentSessionState();
      return result;
    } finally {
      const previous = this.agentSessions.find((candidate) => candidate.agentSessionKey === previousKey);
      if (previous) {
        this.activeAgentSessionKey = previous.agentSessionKey;
        this.applyAgentSessionRuntime(previous);
        this.mountVisibleAgentSessionTranscript();
      }
    }
  }

  private switchInternalAgentSession(sessionKey: string) {
    this.ensureInternalAgentSessions();
    if (sessionKey === this.activeAgentSessionKey) {
      this.agentInputEl?.focus();
      return;
    }

    if (!this.agentSessions.some((session) => session.agentSessionKey === sessionKey)) {
      return;
    }

    this.captureActiveAgentSessionState();
    this.activeAgentSessionKey = sessionKey;
    this.visibleAgentSessionKey = sessionKey;
    this.applyAgentSessionRuntime(this.getActiveAgentSessionState());
    this.restoreActiveAgentSessionDom();
    this.renderAgentSessionTabs();
    this.showPane("agent");
    this.saveAgentViewState();
  }

  private closeInternalAgentSession(sessionKey: string) {
    this.ensureInternalAgentSessions();
    if (this.agentSessions.length <= 1) {
      return;
    }

    const closingActive = sessionKey === this.activeAgentSessionKey;
    if (closingActive) {
      this.disposeAgent();
    } else {
      this.withAgentSession(sessionKey, () => {
        this.disposeAgent();
      });
    }

    const closingIndex = this.agentSessions.findIndex((session) => session.agentSessionKey === sessionKey);
    if (closingIndex === -1) {
      return;
    }

    this.agentSessions.splice(closingIndex, 1);
    if (closingActive) {
      const next = this.agentSessions[Math.max(0, closingIndex - 1)] ?? this.agentSessions[0];
      this.activeAgentSessionKey = next.agentSessionKey;
      this.visibleAgentSessionKey = next.agentSessionKey;
      this.applyAgentSessionRuntime(next);
      this.restoreActiveAgentSessionDom();
    }

    this.renderAgentSessionTabs();
    this.saveAgentViewState();
  }

  private renderAgentSessionTabs() {
    if (!this.agentSessionTabsEl) {
      return;
    }

    this.ensureInternalAgentSessions();
    this.agentSessionTabsEl.empty();
    this.agentSessionTabEls.clear();

    const list = this.agentSessionTabsEl.createDiv("vault-agent-session-tab-list");
    for (const session of this.agentSessions) {
      const item = list.createDiv("vault-agent-session-tab-item");
      const tab = item.createEl("button", {
        cls: "vault-agent-session-tab",
        attr: {
          "aria-label": `AI session: ${session.agentSessionLabel}`,
          title: session.agentSessionLabel
        }
      });
      tab.toggleClass("is-active", session.agentSessionKey === this.activeAgentSessionKey);
      tab.createSpan({
        cls: "vault-agent-session-tab-title",
        text: session.agentSessionLabel
      });
      tab.addEventListener("click", () => {
        this.switchInternalAgentSession(session.agentSessionKey);
      });
      this.agentSessionTabEls.set(session.agentSessionKey, tab);

      if (this.agentSessions.length > 1) {
        const close = item.createEl("button", {
          cls: "vault-agent-session-tab-close",
          attr: {
            "aria-label": `Close ${session.agentSessionLabel}`,
            title: "Close session"
          }
        });
        setIcon(close, "x");
        close.addEventListener("click", (event) => {
          event.stopPropagation();
          this.closeInternalAgentSession(session.agentSessionKey);
        });
      }
    }

    const add = this.agentSessionTabsEl.createEl("button", {
      cls: "vault-agent-session-add",
      attr: {
        "aria-label": "New AI session",
        title: "New AI session"
      }
    });
    setIcon(add, "plus");
    add.addEventListener("click", () => {
      this.createInternalAgentSession();
    });
  }

  private createPaneTab(container: Element, label: string, pane: ViewPane, icon: string): HTMLElement {
    const button = container.createEl("button", {
      cls: "vault-terminal-tab",
      attr: { "aria-label": label, title: label }
    });
    setIcon(button, icon);
    button.createSpan({ cls: "vault-terminal-tab-label", text: label });
    button.addEventListener("click", () => {
      this.showPane(pane);
    });
    return button;
  }

  private showPane(pane: ViewPane, persist = true) {
    this.activePane = "agent";
    this.agentPaneEl?.toggleClass("vault-terminal-pane-hidden", false);
    this.terminalPaneEl?.addClass("vault-terminal-pane-hidden");
    this.paneTabEls.agent?.toggleClass("is-active", true);
    this.paneTabEls.terminal?.toggleClass("is-active", false);

    this.agentInputEl?.focus();
    if (persist) {
      this.saveAgentViewState();
    }
  }

  private ensureRawTerminal() {
    new Notice("Raw terminal has been removed. Use Agent Console instead.");
  }

  private restartShell() {
    new Notice("Raw terminal has been removed. Use Agent Console instead.");
  }

  private createAgentConsole(container: HTMLElement) {
    container.empty();
    this.ensureInternalAgentSessions();

    this.agentSessionTabsEl = container.createDiv("vault-agent-session-tabs");
    this.renderAgentSessionTabs();

    const header = container.createDiv("vault-agent-header");
    const titleWrap = header.createDiv("vault-agent-title-wrap");
    this.agentSessionTitleInputEl = titleWrap.createEl("input", {
      cls: "vault-agent-title vault-agent-title-input",
      attr: {
        type: "text",
        "aria-label": "AI session title",
        title: "AI session title"
      }
    });
    this.agentSessionTitleInputEl.value = this.agentSessionLabel;
    this.agentSessionTitleInputEl.addEventListener("change", () => {
      this.commitAgentSessionLabel(this.agentSessionTitleInputEl?.value ?? "");
    });
    this.agentSessionTitleInputEl.addEventListener("blur", () => {
      this.commitAgentSessionLabel(this.agentSessionTitleInputEl?.value ?? "");
    });
    this.agentSessionTitleInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.commitAgentSessionLabel(this.agentSessionTitleInputEl?.value ?? "");
        this.agentSessionTitleInputEl?.blur();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.refreshAgentSessionChrome();
        this.agentSessionTitleInputEl?.blur();
      }
    });
    this.agentSessionSubtitleEl = titleWrap.createEl("div", {
      cls: "vault-agent-subtitle",
    });
    this.refreshAgentSessionChrome();

    this.agentStatusEl = header.createDiv("vault-agent-status");
    this.setAgentStatus("Idle");

    const toolbar = container.createDiv("vault-agent-toolbar");
    const providerGroup = toolbar.createDiv("vault-agent-provider-group");
    this.agentProviderButtons.claude = this.createAgentProviderButton(providerGroup, "Claude", "claude", CLAUDE_ICON_PATH);
    this.agentProviderButtons.codex = this.createAgentProviderButton(providerGroup, "Codex", "codex", CODEX_ICON_PATH);
    this.agentProviderIndicatorEl = toolbar.createDiv({
      cls: "vault-agent-current-provider",
      attr: { "aria-live": "polite" }
    });
    this.refreshAgentProviderButtons();

    const actions = toolbar.createDiv("vault-agent-actions");
    const newSessionButton = actions.createEl("button", {
      cls: "vault-agent-action vault-agent-action-new-session",
      attr: { "aria-label": "Open new AI session", title: "Open new AI session" }
    });
    setIcon(newSessionButton, "plus");
    newSessionButton.addEventListener("click", () => {
      void this.plugin.activateNewSessionView();
    });
    const startButton = actions.createEl("button", {
      cls: "vault-agent-action vault-agent-action-start",
      attr: { "aria-label": "Start", title: "Start" }
    });
    setIcon(startButton, "play");
    startButton.addEventListener("click", () => {
      void this.startAgent(this.agentProvider);
    });
    const stopButton = actions.createEl("button", {
      cls: "vault-agent-action vault-agent-action-stop",
      attr: { "aria-label": "Stop", title: "Stop" }
    });
    setIcon(stopButton, "square");
    stopButton.addEventListener("click", () => {
      this.disposeAgent();
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: "에이전트를 정지했습니다."
      });
    });
    this.agentLoginButton = actions.createEl("button", { text: "Login" });
    this.agentLoginButton.addEventListener("click", () => {
      if (this.agentBackend) {
        const method = this.plugin.settings.codexLoginMethod === "device-code"
          ? "chatgpt-device-code"
          : "chatgpt";
        void this.agentBackend.beginLogin(method);
        return;
      }

      if (this.agentPromptState?.mode === "mcp") {
        new Notice("MCP connection is separate from Claude login. Use the MCP actions or press Esc.");
        return;
      }

      this.sendAgentControlInput("/login");
    });
    this.refreshAgentLoginButton();

    // Separate transcript DOM per AI session/provider so internal tabs can keep
    // running while hidden and re-mount without losing output.
    this.agentTranscriptMountEl = container.createDiv("vault-agent-transcript-mount");
    this.applyAgentSessionRuntime(this.getActiveAgentSessionState());
    this.mountVisibleAgentSessionTranscript();

    this.agentLoadingEl = container.createDiv("vault-agent-loading is-hidden");
    const loadingDots = this.agentLoadingEl.createSpan("vault-agent-loading-dots");
    loadingDots.createSpan();
    loadingDots.createSpan();
    loadingDots.createSpan();
    this.agentLoadingTextEl = this.agentLoadingEl.createSpan({
      cls: "vault-agent-loading-text",
      text: "Preparing agent..."
    });

    const composer = container.createDiv("vault-agent-composer");
    this.codexStatusLineEl = composer.createDiv("vault-agent-statusline is-hidden");
    this.refreshCodexStatusLine();
    this.agentPromptActionsEl = composer.createDiv("vault-agent-prompt-actions");
    this.refreshAgentPromptActions();
    this.agentInputEl = composer.createEl("textarea", {
      cls: "vault-agent-input",
      attr: {
        rows: "2",
        placeholder: "Message to the selected agent. Shift+Enter inserts a new line."
      }
    });
    this.agentInputEl.addEventListener("keydown", (event) => {
      // event.isComposing guards Korean/IME input: the Enter that confirms a
      // Hangul block must not also submit, otherwise the message double-sends.
      if (isEnterKey(event) && !event.isComposing && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        void this.sendAgentInput();
      }
    });
    this.agentInputEl.addEventListener("paste", (event) => this.handleAgentPaste(event));
    this.refreshAgentProviderButtons();

    this.codexAttachmentsEl = composer.createDiv("vault-agent-attachments is-hidden");

    // Codex turn-options row (model / effort / access), Codex-app style: directly
    // under the input box. Hidden until Codex starts and listModels populates it.
    const optionsRow = composer.createDiv("vault-agent-options is-hidden");
    this.codexOptionsRow = optionsRow;
    this.codexModelSelect = optionsRow.createEl("select", { cls: "vault-agent-option-select", attr: { "aria-label": "Model" } });
    this.codexEffortSelect = optionsRow.createEl("select", { cls: "vault-agent-option-select", attr: { "aria-label": "Reasoning effort" } });
    this.codexAccessSelect = optionsRow.createEl("select", { cls: "vault-agent-option-select", attr: { "aria-label": "Access level" } });
    for (const opt of [{ v: "read-only", t: "Read-only" }, { v: "auto", t: "Auto (write)" }, { v: "full", t: "Full access" }]) {
      this.codexAccessSelect.createEl("option", { value: opt.v, text: opt.t });
    }
    this.codexAccessSelect.value = "full";
    this.codexModelSelect.addEventListener("change", () => this.onCodexModelChange());
    this.codexEffortSelect.addEventListener("change", () => this.applyCodexTurnOptions());
    this.codexAccessSelect.addEventListener("change", () => this.applyCodexTurnOptions());

    const composerActions = composer.createDiv("vault-agent-composer-actions");
    const fileInput = composerActions.createEl("input", { cls: "vault-agent-file-input", attr: { type: "file", multiple: "true" } });
    const attachButton = composerActions.createEl("button", { cls: "vault-agent-attach-button", text: "Attach" });
    this.agentAttachButton = attachButton;
    attachButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const files = Array.from(fileInput.files ?? []);
      fileInput.value = "";
      void this.addAgentAttachments(files);
    });
    const noteButton = composerActions.createEl("button", { text: "Add current note" });
    noteButton.addEventListener("click", () => {
      void this.insertCurrentNoteReferenceIntoAgent();
    });
    const sendButton = composerActions.createEl("button", {
      cls: "mod-cta",
      text: "Send"
    });
    this.agentSendButton = sendButton;
    sendButton.addEventListener("click", () => {
      // While Codex is answering, Send acts as Stop (interrupt the current turn).
      if (this.agentBackend && this.codexTurnActive) {
        void this.agentBackend.interrupt();
      } else {
        void this.sendAgentInput();
      }
    });

    this.restoreActiveAgentSessionDom();
    this.renderAgentSessionTabs();
  }

  private createAgentProviderButton(container: HTMLElement, label: string, provider: AgentProvider, iconPath: string): HTMLElement {
    const button = container.createEl("button", {
      cls: `vault-agent-provider vault-agent-provider-${provider}`,
      attr: { "aria-label": label, title: label }
    });
    const svg = button.createSvg("svg", { cls: "svg-icon", attr: { viewBox: "0 0 24 24" } });
    svg.createSvg("path", { attr: { d: iconPath, fill: "currentColor" } });
    button.addEventListener("click", () => {
      if (this.agentHost || this.agentBackend) {
        new Notice("Stop the current agent before switching providers.");
        return;
      }

      this.agentProvider = provider;
      this.captureActiveAgentSessionState();
      this.saveAgentViewState();
      this.refreshAgentProviderButtons();
      this.switchAgentTranscript(provider);
      this.agentInputEl?.focus();
    });
    return button;
  }

  private refreshAgentProviderButtons() {
    if (!this.isVisibleAgentSessionContext()) {
      return;
    }
    this.agentProviderButtons.claude?.toggleClass("is-active", this.agentProvider === "claude");
    this.agentProviderButtons.codex?.toggleClass("is-active", this.agentProvider === "codex");
    this.renderAgentProviderIndicator();
    this.agentInputEl?.setAttr("placeholder", `Message to ${getAgentProviderLabel(this.agentProvider)}. @all, @codex, @claude, or @"session title" delegates to other tabs.`);
  }

  private renderAgentProviderIndicator() {
    if (!this.agentProviderIndicatorEl || !this.isVisibleAgentSessionContext()) {
      return;
    }
    const label = getAgentProviderLabel(this.agentProvider);
    const iconPath = this.agentProvider === "claude" ? CLAUDE_ICON_PATH : CODEX_ICON_PATH;
    this.agentProviderIndicatorEl.empty();
    this.agentProviderIndicatorEl.toggleClass("is-claude", this.agentProvider === "claude");
    this.agentProviderIndicatorEl.toggleClass("is-codex", this.agentProvider === "codex");
    this.agentProviderIndicatorEl.setAttr("title", `현재 사용 중: ${label}`);
    const svg = this.agentProviderIndicatorEl.createSvg("svg", {
      cls: "svg-icon",
      attr: { viewBox: "0 0 24 24", "aria-hidden": "true" }
    });
    svg.createSvg("path", { attr: { d: iconPath, fill: "currentColor" } });
    this.agentProviderIndicatorEl.createSpan({
      cls: "vault-agent-current-provider-label",
      text: `현재 ${label}`
    });
  }

  // Show only the active provider's transcript; each keeps its own conversation.
  private switchAgentTranscript(provider: AgentProvider) {
    const previousProvider = this.agentTranscriptEl === this.codexTranscriptEl
      ? "codex"
      : this.agentTranscriptEl === this.claudeTranscriptEl
        ? "claude"
        : null;
    if (this.agentTranscriptEl) {
      this.rememberAgentTranscriptScrollPosition(this.agentTranscriptEl);
    }
    this.claudeTranscriptEl?.toggleClass("is-hidden", provider !== "claude");
    this.codexTranscriptEl?.toggleClass("is-hidden", provider !== "codex");
    this.agentTranscriptEl = provider === "codex" ? this.codexTranscriptEl : this.claudeTranscriptEl;
    this.restoreVisibleAgentTranscriptScrollPosition(provider);
    // Restore/render paths can call this with the same provider while a Codex
    // turn is still streaming. Preserve the current turn in that case; otherwise
    // later system/tool events lose their parent card and render as top-level
    // boxes.
    if (previousProvider !== provider) {
      this.codexCurrentTurnEl = null;
      this.codexCurrentAnswerEl = null;
      this.codexTurnLoadingEl = null;
    }
    this.refreshCodexStatusLine();
  }

  private async startCodexBackend(cwd: string) {
    const sessionKey = this.activeAgentSessionKey;
    this.codexContextPercent = null;
    this.codexRateLimitWindows = [];
    this.codexGitBranch = null;
    this.refreshCodexStatusLine();
    void this.refreshCodexGitBranch(cwd, sessionKey);

    const env = buildProcessEnv({
      useSystemCa: this.plugin.settings.useSystemCa,
      extraCaCertPath: this.plugin.getExtraCaCertPath()
    });
    // codex is a Rust/rustls binary; it ignores NODE_EXTRA_CA_CERTS / SSL_CERT_FILE
    // on its WebSocket path. CODEX_CA_CERTIFICATE is its own CA channel (login +
    // HTTPS + WebSocket). Without it, turns wait ~19s on WebSocket retries before
    // the HTTPS fallback succeeds via SSL_CERT_FILE.
    const codexCaCert = this.plugin.getExtraCaCertPath();
    if (codexCaCert) {
      env.CODEX_CA_CERTIFICATE = codexCaCert;
    }
    const backend = new CodexAppServerBackend({
      configuredExecutable: this.plugin.settings.codexExecutable,
      env,
      clientVersion: this.plugin.manifest.version,
      approvalPolicy: this.plugin.settings.codexApprovalPolicy
    });
    this.agentBackend = backend;
    this.agentBackendUnsubscribe = backend.on((event) => {
      this.withAgentSession(sessionKey, () => this.handleBackendEvent(event));
    });
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("system"),
      role: "system",
      text: this.agentCodexThreadId
        ? `Starting Codex (app-server) in ${cwd} · thread ${shortSessionId(this.agentCodexThreadId)}`
        : `Starting Codex (app-server) in ${cwd} · new isolated thread`
    });

    try {
      await backend.start({
        cwd,
        resumeThreadId: this.agentCodexThreadId ?? undefined,
        resumeLatestThread: !this.agentCodexThreadId && this.agentSessionMode === "legacy-latest",
        sessionName: this.agentSessionLabel,
        model: this.plugin.settings.codexModel || undefined
      });
      await this.withAgentSessionAsync(sessionKey, () => this.populateCodexModels());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.withAgentSession(sessionKey, () => {
        this.setAgentStatus("Failed");
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `Failed to start Codex app-server: ${message}`
        });
      });
    }
  }

  private handleBackendEvent(event: AgentUiEvent) {
    switch (event.type) {
      case "status":
        this.setAgentStatus(formatBackendStatus(event.state, event.detail));
        if (event.state === "ready") {
          this.agentReadyForInput = true;
          if (this.codexTurnActive) {
            this.finishCodexTurn("Codex ready", true);
          }
        } else if (event.state === "stopped" || event.state === "error" || event.state === "idle") {
          if (this.codexTurnActive || this.codexTurnLoadingEl) {
            this.finishCodexTurn(formatBackendStatus(event.state, event.detail), false);
          }
        }
        break;
      case "auth-required":
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: "Codex is not signed in. Click Login to sign in with ChatGPT."
        });
        break;
      case "auth-url":
        openExternalUrlWithSystemBrowser(event.url);
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: event.userCode
            ? `Open ${event.url} and enter code: ${event.userCode}`
            : `Opening browser to sign in: ${event.url}`
        });
        break;
      case "system-message":
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: event.text
        });
        break;
      case "fatal":
        this.setAgentStatus("Failed");
        this.finishCodexTurn("Failed", false);
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: event.message
        });
        break;
      case "item-start":
        this.renderCodexItemStart(event.item);
        break;
      case "item-delta":
        this.renderCodexItemDelta(event.itemId, event.textDelta);
        break;
      case "item-complete":
        this.renderCodexItemComplete(event.item);
        break;
      case "turn-complete":
        this.finishCodexTurn("Codex ready", true);
        break;
      case "usage-update":
        if ("contextPercent" in event) {
          this.codexContextPercent = event.contextPercent ?? null;
        }
        if (event.rateLimits) {
          this.codexRateLimitWindows = event.rateLimits;
        }
        this.scheduleCodexStatusLineRefresh();
        break;
      case "thread-ready":
        this.agentCodexThreadId = event.threadId;
        this.agentSessionMode = "isolated";
        this.captureActiveAgentSessionState();
        this.saveAgentViewState();
        this.refreshAgentSessionChrome();
        break;
      case "approval-request":
        this.renderCodexApproval(event.request);
        break;
      case "approval-resolved":
        this.resolveCodexApproval(event.requestId);
        break;
      default:
        break;
    }
  }

  // Codex-app style: each user turn is one card (question on top, answer below).
  // Items (reasoning / command / message) flow inside the current answer rather
  // than each becoming its own top-level box.
  private startCodexTurn(question: string): HTMLElement | null {
    if (!this.agentTranscriptEl) {
      return null;
    }
    const shouldStickToBottom = this.shouldAutoScrollAgentTranscript();
    // Claude has no explicit turn-complete signal, so opening a new turn closes
    // the previous one: clear any leftover thinking indicator first.
    this.cancelCodexTurnCompletionFallback();
    this.clearCodexTurnLoadingIndicators(this.agentTranscriptEl);
    const turn = this.agentTranscriptEl.createDiv("vault-agent-turn");
    if (question.trim()) {
      const q = turn.createDiv("vault-agent-turn-question");
      this.renderAgentMessageBody(q.createDiv("vault-agent-turn-question-text"), question.trim());
    }
    const answer = turn.createDiv("vault-agent-turn-answer");
    this.codexCurrentTurnEl = turn;
    this.codexCurrentAnswerEl = answer;
    this.showTurnThinking(answer);
    if (shouldStickToBottom) {
      this.scrollAgentTranscriptToBottom(this.agentTranscriptEl);
    }
    return answer;
  }

  private ensureCodexAnswerEl(): HTMLElement | null {
    if (this.codexCurrentAnswerEl && this.agentTranscriptEl?.contains(this.codexCurrentAnswerEl)) {
      return this.codexCurrentAnswerEl;
    }
    const rebound = this.rebindLastCodexTurnAnswerEl();
    if (rebound) {
      return rebound;
    }
    return this.startCodexTurn("");
  }

  private rebindLastCodexTurnAnswerEl(): HTMLElement | null {
    if (!this.agentTranscriptEl) {
      return null;
    }

    const turns = Array.from(this.agentTranscriptEl.querySelectorAll<HTMLElement>(".vault-agent-turn"));
    const turn = turns[turns.length - 1] ?? null;
    const answer = Array.from(turn?.children ?? []).find((child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasClass("vault-agent-turn-answer")
    ) ?? null;
    if (!turn || !answer) {
      return null;
    }

    this.codexCurrentTurnEl = turn;
    this.codexCurrentAnswerEl = answer;
    this.codexTurnLoadingEl = Array.from(answer.children).find((child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasClass("vault-agent-thinking")
    ) ?? null;
    return answer;
  }

  private scrollCodexAnswer(shouldStickToBottom = this.shouldAutoScrollAgentTranscript()) {
    if (this.codexScrollFrame !== null) {
      return;
    }
    const sessionKey = this.activeAgentSessionKey;
    this.codexScrollFrame = window.requestAnimationFrame(() => {
      this.withAgentSession(sessionKey, () => {
        this.codexScrollFrame = null;
        this.scrollCodexAnswerNow(shouldStickToBottom);
      });
    });
  }

  private scrollCodexAnswerNow(shouldStickToBottom = true) {
    if (this.codexCurrentAnswerEl) {
      this.codexCurrentAnswerEl.scrollTop = this.codexCurrentAnswerEl.scrollHeight;
    }
    if (this.agentTranscriptEl && shouldStickToBottom) {
      this.scrollAgentTranscriptToBottom(this.agentTranscriptEl);
    }
  }

  private shouldAutoScrollAgentTranscript(): boolean {
    return this.agentTranscriptEl ? isElementScrolledNearBottom(this.agentTranscriptEl) : false;
  }

  private scrollAgentTranscriptToBottom(el: HTMLElement) {
    el.scrollTop = el.scrollHeight;
    this.rememberAgentTranscriptScrollPosition(el);
  }

  private buildContextualAgentPrompt(text: string): string {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith("/")) {
      return text;
    }

    const context = this.getAgentTranscriptContextText();
    if (!context) {
      return text;
    }

    return [
      "[이전 대화 컨텍스트]",
      "아래는 같은 Obst Terminal AI 세션의 이전 transcript입니다. 이 내용을 현재 대화의 맥락으로 간주하고 이어서 답하세요.",
      context,
      "",
      "[현재 사용자 요청]",
      text
    ].join("\n");
  }

  private getAgentTranscriptContextText(): string {
    if (!this.agentTranscriptEl) {
      return "";
    }

    const parts: string[] = [];
    for (const child of Array.from(this.agentTranscriptEl.children)) {
      if (!(child instanceof HTMLElement)) {
        continue;
      }

      if (child.hasClass("vault-agent-turn")) {
        const question = child.querySelector<HTMLElement>(".vault-agent-turn-question-text")?.textContent?.trim() ?? "";
        const answer = child.querySelector<HTMLElement>(".vault-agent-turn-answer")?.textContent?.replace(/\s*생각 중\s*$/g, "").trim() ?? "";
        if (question) {
          parts.push(`User: ${question}`);
        }
        if (answer) {
          parts.push(`${getAgentProviderLabel(this.agentProvider)}: ${answer}`);
        }
        continue;
      }

      if (child.hasClass("vault-agent-message")) {
        const role = child.querySelector<HTMLElement>(".vault-agent-message-role")?.textContent?.trim() ?? "";
        const body = child.querySelector<HTMLElement>(".vault-agent-message-body")?.textContent?.trim() ?? "";
        if (!body || /^system$/i.test(role)) {
          continue;
        }
        parts.push(`${role || "Message"}: ${body}`);
      }
    }

    const context = parts.join("\n\n").trim();
    return truncateStart(context, AGENT_TRANSCRIPT_CONTEXT_MAX_CHARS);
  }

  // Start one Codex turn and mark it active so further input queues instead of
  // opening a second concurrent turn.
  private beginCodexTurn(text: string, attachments: AgentAttachment[]) {
    if (!this.agentBackend) {
      return;
    }
    this.codexTurnActive = true;
    this.updateSendButtonMode();
    const noteSuffix = attachments.length ? `\n\n[${attachments.length} file(s) attached]` : "";
    const sendText = this.buildContextualAgentPrompt(text);
    this.startCodexTurn((text || "(attachments)") + noteSuffix);
    void this.agentBackend.sendUserMessage({ text: sendText, attachments });
  }

  private flushQueuedInput() {
    if (this.codexTurnActive || !this.agentBackend) {
      return;
    }
    const next = this.codexQueuedInputs.shift();
    if (next) {
      this.beginCodexTurn(next.text, next.attachments);
    }
  }

  private updateSendButtonMode() {
    if (!this.agentSendButton || !this.isVisibleAgentSessionContext()) {
      return;
    }
    const active = this.codexTurnActive;
    this.agentSendButton.setText(active ? "Stop" : "Send");
    this.agentSendButton.toggleClass("mod-warning", active);
    this.agentSendButton.toggleClass("mod-cta", !active);
  }

  private cancelCodexTurnCompletionFallback() {
    if (this.codexTurnCompletionFallbackTimer !== null) {
      window.clearTimeout(this.codexTurnCompletionFallbackTimer);
      this.codexTurnCompletionFallbackTimer = null;
    }
  }

  private scheduleCodexTurnCompletionFallback() {
    if (!this.codexTurnActive) {
      return;
    }

    this.cancelCodexTurnCompletionFallback();
    const sessionKey = this.activeAgentSessionKey;
    this.codexTurnCompletionFallbackTimer = window.setTimeout(() => {
      this.withAgentSession(sessionKey, () => {
        this.codexTurnCompletionFallbackTimer = null;
        if (!this.codexTurnActive) {
          return;
        }
        this.finishCodexTurn("Codex ready", true);
      });
    }, CODEX_TURN_COMPLETION_FALLBACK_MS);
  }

  private clearCodexTurnLoadingIndicators(root: ParentNode | null | undefined = this.agentTranscriptEl ?? this.codexTranscriptEl) {
    this.codexTurnLoadingEl?.remove();
    this.codexTurnLoadingEl = null;
    removeAgentThinkingIndicators(root);
  }

  private finishCodexTurn(statusText = "Codex ready", flushQueued = true) {
    this.cancelCodexTurnCompletionFallback();
    this.codexTurnActive = false;
    this.updateSendButtonMode();
    this.clearCodexTurnLoadingIndicators();
    this.setAgentStatus(statusText);
    if (flushQueued) {
      this.flushQueuedInput();
    }
    this.captureActiveAgentSessionState();
    this.saveAgentViewState();
  }

  // In-chat "thinking" indicator pinned to the bottom of the active answer.
  private showTurnThinking(answer: HTMLElement) {
    this.clearCodexTurnLoadingIndicators(answer);
    const thinking = answer.createDiv("vault-agent-thinking");
    thinking.dataset.startedAt = String(Date.now());
    const dots = thinking.createDiv("vault-agent-thinking-dots");
    dots.createSpan();
    dots.createSpan();
    dots.createSpan();
    thinking.createSpan({ cls: "vault-agent-thinking-text", text: "생각 중" });
    this.codexTurnLoadingEl = thinking;
  }

  private refreshCodexStatusLine() {
    if (!this.codexStatusLineEl || !this.isVisibleAgentSessionContext()) {
      return;
    }
    const visible = this.agentProvider === "codex";
    this.codexStatusLineEl.toggleClass("is-hidden", !visible);
    if (!visible) {
      return;
    }

    this.codexStatusLineEl.empty();
    const cwd = this.plugin.getVaultPath() ?? "";
    const pathText = this.getCodexStatusPath(cwd);
    this.renderStatusTextSegment(pathText, "vault-agent-statusline-path");
    this.renderStatusTextSegment(this.getSelectedCodexModelLabel(), "vault-agent-statusline-model");
    this.renderStatusMeterSegment("ctx", this.codexContextPercent, null);
    for (const window of this.codexRateLimitWindows) {
      this.renderStatusMeterSegment(window.label, window.usedPercent, window.resetsAt ?? null);
    }
  }

  private scheduleCodexStatusLineRefresh() {
    if (this.codexStatusLineFrame !== null) {
      return;
    }
    const sessionKey = this.activeAgentSessionKey;
    this.codexStatusLineFrame = window.requestAnimationFrame(() => {
      this.withAgentSession(sessionKey, () => {
        this.codexStatusLineFrame = null;
        this.refreshCodexStatusLine();
      });
    });
  }

  private renderStatusTextSegment(text: string, cls: string) {
    this.codexStatusLineEl?.createSpan({
      cls: `vault-agent-statusline-segment ${cls}`,
      text
    });
  }

  private renderStatusMeterSegment(label: string, percent: number | null, resetsAt: number | null) {
    if (!this.codexStatusLineEl) {
      return;
    }
    const segment = this.codexStatusLineEl.createDiv("vault-agent-statusline-segment vault-agent-statusline-meter");
    if (percent !== null) {
      segment.toggleClass("is-low", percent < 30);
      segment.toggleClass("is-mid", percent >= 50 && percent < 80);
      segment.toggleClass("is-high", percent >= 80);
    }
    segment.createSpan({ cls: "vault-agent-statusline-label", text: label });
    const bar = segment.createDiv("vault-agent-statusline-bar");
    const fill = bar.createDiv("vault-agent-statusline-fill");
    fill.style.width = `${percent === null ? 0 : Math.min(100, Math.max(0, percent))}%`;
    segment.createSpan({
      cls: "vault-agent-statusline-value",
      text: percent === null ? "--%" : `${Math.round(percent)}%`
    });
    const resetText = formatResetTime(resetsAt);
    if (resetText) {
      segment.createSpan({ cls: "vault-agent-statusline-reset", text: `(${resetText})` });
    }
  }

  private getCodexStatusPath(cwd: string): string {
    const path = cwd ? formatStatusPath(cwd) : "No vault path";
    return this.codexGitBranch ? `${path}  git:${this.codexGitBranch}` : path;
  }

  private async refreshCodexGitBranch(cwd: string, sessionKey: string | null = this.activeAgentSessionKey) {
    const branch = await readGitBranchAsync(cwd);
    this.withAgentSession(sessionKey, () => {
      if (this.agentProvider !== "codex" || this.plugin.getVaultPath() !== cwd) {
        return;
      }
      this.codexGitBranch = branch;
      this.refreshCodexStatusLine();
    });
  }

  private getSelectedCodexModelLabel(): string {
    const selected = this.codexModelSelect?.value || this.plugin.settings.codexModel;
    const model = this.codexModels.find((candidate) => candidate.id === selected);
    return model?.displayName || selected || "Codex";
  }

  private async renderCodexMarkdown(el: HTMLElement, markdown: string) {
    el.empty();
    // Render with Obsidian's own theme styling so answers match the user's notes.
    el.addClass("markdown-rendered");
    try {
      await MarkdownRenderer.render(this.app, markdown, el, "", this);
    } catch {
      el.removeClass("markdown-rendered");
      this.renderAgentMessageBody(el, markdown);
    }
  }

  private renderCodexItemStart(item: TranscriptItem) {
    const shouldStickToBottom = this.shouldAutoScrollAgentTranscript();
    const answer = this.ensureCodexAnswerEl();
    if (!answer) {
      return;
    }
    this.cancelCodexTurnCompletionFallback();
    const block = answer.createDiv(`vault-agent-block vault-agent-block-${item.kind} vault-agent-block-role-${backendKindRole(item.kind)}`);
    if (item.kind !== "agentMessage" && item.kind !== "plan") {
      block.createDiv("vault-agent-block-label").setText(backendKindLabel(item.kind));
    }
    const body = block.createDiv("vault-agent-block-body");
    if (item.text.trim()) {
      // Plain text during streaming; item-complete re-renders as markdown.
      body.textContent = item.text;
    }
    this.codexItemEls.set(item.id, body);
    // Keep the thinking indicator pinned below the latest content.
    if (this.codexTurnLoadingEl && this.codexTurnLoadingEl.parentElement === answer) {
      answer.appendChild(this.codexTurnLoadingEl);
    }
    this.scrollCodexAnswer(shouldStickToBottom);
  }

  private renderCodexItemDelta(itemId: string, delta: string) {
    const body = this.codexItemEls.get(itemId);
    if (!body || !this.agentTranscriptEl) {
      return;
    }
    this.codexDeltaBuffers.set(itemId, `${this.codexDeltaBuffers.get(itemId) ?? ""}${delta}`);
    this.scheduleCodexDeltaFlush();
  }

  private scheduleCodexDeltaFlush() {
    if (this.codexDeltaFlushTimer !== null) {
      return;
    }
    const sessionKey = this.activeAgentSessionKey;
    this.codexDeltaFlushTimer = window.setTimeout(() => {
      this.withAgentSession(sessionKey, () => {
        this.codexDeltaFlushTimer = null;
        this.flushCodexDeltaBuffers();
      });
    }, 50);
  }

  private flushCodexDeltaBuffers() {
    if (this.codexDeltaBuffers.size === 0) {
      return;
    }
    const shouldStickToBottom = this.shouldAutoScrollAgentTranscript();
    const pending = Array.from(this.codexDeltaBuffers.entries());
    this.codexDeltaBuffers.clear();
    for (const [itemId, text] of pending) {
      const body = this.codexItemEls.get(itemId);
      if (!body || !text) {
        continue;
      }
      body.appendChild(document.createTextNode(text));
    }
    this.scrollCodexAnswer(shouldStickToBottom);
  }

  private renderCodexApproval(req: ApprovalRequest) {
    const shouldStickToBottom = this.shouldAutoScrollAgentTranscript();
    const answer = this.ensureCodexAnswerEl();
    if (!answer) {
      return;
    }
    const card = answer.createDiv("vault-agent-approval");
    card.createDiv({
      cls: "vault-agent-approval-title",
      text: req.kind === "commandExecution" ? "Run this command?" : "Apply this file change?"
    });
    card.createEl("pre", { cls: "vault-agent-approval-detail", text: req.detail });
    const actions = card.createDiv("vault-agent-approval-actions");
    const accept = actions.createEl("button", { cls: "mod-cta", text: "Accept" });
    const acceptSession = actions.createEl("button", { text: "Accept for session" });
    const decline = actions.createEl("button", { text: "Decline" });
    accept.addEventListener("click", () => void this.agentBackend?.respondToApproval(req.id, "accept"));
    acceptSession.addEventListener("click", () => void this.agentBackend?.respondToApproval(req.id, "acceptForSession"));
    decline.addEventListener("click", () => void this.agentBackend?.respondToApproval(req.id, "decline"));
    this.codexApprovalEls.set(req.id, card);
    this.scrollCodexAnswer(shouldStickToBottom);
  }

  private resolveCodexApproval(requestId: string) {
    const card = this.codexApprovalEls.get(requestId);
    if (card) {
      card.addClass("is-resolved");
      card.querySelectorAll("button").forEach((button) => {
        (button as HTMLButtonElement).disabled = true;
      });
    }
    this.codexApprovalEls.delete(requestId);
  }

  private async populateCodexModels() {
    const sessionKey = this.activeAgentSessionKey;
    if (!this.agentBackend || !this.codexModelSelect) {
      return;
    }
    const models = await this.agentBackend.listModels();
    this.withAgentSession(sessionKey, () => {
      this.codexModels = models;
      if (models.length === 0) {
        return;
      }
      if (this.isVisibleAgentSessionContext()) {
        this.codexModelSelect?.empty();
        for (const model of models) {
          this.codexModelSelect?.createEl("option", { value: model.id, text: model.displayName });
        }
        if (this.codexModelSelect) {
          this.codexModelSelect.value = models[0].id;
        }
        this.codexOptionsRow?.removeClass("is-hidden");
      }
      this.onCodexModelChange();
      this.refreshCodexStatusLine();
    });
  }

  private onCodexModelChange() {
    if (!this.isVisibleAgentSessionContext()) {
      return;
    }
    if (!this.codexModelSelect || !this.codexEffortSelect) {
      return;
    }
    const model = this.codexModels.find((m) => m.id === this.codexModelSelect?.value);
    this.codexEffortSelect.empty();
    for (const effort of model?.efforts ?? []) {
      this.codexEffortSelect.createEl("option", { value: effort, text: effort });
    }
    if (model?.defaultEffort) {
      this.codexEffortSelect.value = model.defaultEffort;
    }
    this.applyCodexTurnOptions();
    this.refreshCodexStatusLine();
  }

  private applyCodexTurnOptions() {
    if (!this.isVisibleAgentSessionContext()) {
      return;
    }
    this.agentBackend?.setTurnOptions({
      model: this.codexModelSelect?.value || undefined,
      effort: this.codexEffortSelect?.value || undefined,
      accessLevel: (this.codexAccessSelect?.value as AgentAccessLevel) || undefined
    });
  }

  private async addAgentAttachments(files: File[]) {
    if (files.length === 0) {
      return;
    }
    let added = 0;
    for (const file of files) {
      try {
        const attachment = await this.createAgentAttachment(file);
        if (!attachment) {
          continue;
        }
        this.codexPendingAttachments.push(attachment);
        added += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`첨부 실패: ${file.name || "file"} — ${message}`);
      }
    }
    this.renderAttachmentChips();
    if (added === 0) {
      new Notice("첨부할 수 있는 파일 경로를 찾지 못했습니다.");
    }
  }

  private async createAgentAttachment(file: File): Promise<AgentAttachment | null> {
    const name = file.name || "attachment";
    const localPath = getDataTransferFilePath(file);
    if (localPath) {
      return {
        kind: isImageAttachmentFile(file) ? "localImage" : "mention",
        path: localPath,
        name
      };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const vaultPath = await this.plugin.saveAttachmentBytes(bytes, getGeneralFileExtension(file), sanitizeFileStem(name));
    const absolutePath = this.plugin.getVaultPath()
      ? join(this.plugin.getVaultPath()!, ...vaultPath.split("/"))
      : vaultPath;
    return {
      kind: isImageAttachmentFile(file) ? "localImage" : "mention",
      path: absolutePath,
      name
    };
  }

  private renderAttachmentChips() {
    if (!this.codexAttachmentsEl || !this.isVisibleAgentSessionContext()) {
      return;
    }
    this.codexAttachmentsEl.empty();
    const count = this.codexPendingAttachments.length;
    this.codexAttachmentsEl.toggleClass("is-hidden", count === 0);
    if (this.agentAttachButton) {
      this.agentAttachButton.setText(count > 0 ? `Attach (${count})` : "Attach");
      this.agentAttachButton.toggleClass("has-attachments", count > 0);
      this.agentAttachButton.setAttr("title", count > 0 ? `${count} file(s) attached` : "Attach files");
    }
    if (count === 0) {
      return;
    }
    this.codexAttachmentsEl.createDiv({
      cls: "vault-agent-attachments-label",
      text: `첨부됨 ${count}개`
    });
    this.codexPendingAttachments.forEach((attachment, index) => {
      const chip = this.codexAttachmentsEl!.createDiv("vault-agent-attachment-chip");
      chip.toggleClass("is-image", attachment.kind === "localImage");
      chip.createSpan({
        cls: "vault-agent-attachment-kind",
        text: attachment.kind === "localImage" ? "IMG" : "FILE"
      });
      chip.createSpan({ text: attachment.name ?? attachment.path });
      chip.setAttr("title", attachment.path);
      const remove = chip.createEl("button", { text: "×" });
      remove.addEventListener("click", () => {
        this.codexPendingAttachments.splice(index, 1);
        this.renderAttachmentChips();
      });
    });
  }

  // Paste an image from the clipboard (Ctrl/Cmd+V) as a Codex attachment.
  private handleAgentPaste(event: ClipboardEvent) {
    if (!this.agentBackend) {
      return;
    }
    // Obsidian's bundled clipboard typing only exposes readText; the Electron
    // runtime has readImage. Assert the real shape.
    const electronClipboard = clipboard as unknown as { readImage(): { isEmpty(): boolean; toPNG(): Buffer } };
    const image = electronClipboard.readImage();
    if (image.isEmpty()) {
      return; // not an image — let the textarea paste text normally
    }
    event.preventDefault();
    const path = this.writeClipboardImage(image.toPNG());
    if (!path) {
      new Notice("Could not save the pasted image.");
      return;
    }
    this.codexPendingAttachments.push({ kind: "localImage", path, name: "Pasted image" });
    this.renderAttachmentChips();
  }

  private writeClipboardImage(data: Buffer): string | null {
    try {
      const dir = join(tmpdir(), "obsidian-codex-paste");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `paste-${Date.now()}-${this.codexPendingAttachments.length}.png`);
      writeFileSync(file, data);
      return file;
    } catch {
      return null;
    }
  }

  private renderCodexItemComplete(item: TranscriptItem) {
    this.flushCodexDeltaBuffers();
    const shouldStickToBottom = this.shouldAutoScrollAgentTranscript();
    let body = this.codexItemEls.get(item.id);
    if (!body) {
      if (item.text.trim()) {
        this.renderCodexItemStart(item);
        body = this.codexItemEls.get(item.id);
      }
      if (!body) {
        return;
      }
    }
    // Codex-app style: command execution is transient progress. Once it
    // finishes, drop the whole block so only the final answer remains.
    if (item.kind === "commandExecution") {
      body.parentElement?.remove();
      this.codexItemEls.delete(item.id);
      this.scrollCodexAnswer(shouldStickToBottom);
      return;
    }
    const finalText = item.text.trim() || (body.textContent ?? "").trim();
    if (!finalText) {
      body.parentElement?.remove();
      this.codexItemEls.delete(item.id);
      return;
    }
    body.empty();
    if (item.kind === "agentMessage" || item.kind === "plan") {
      // The visible answer: render as markdown for blog-style typography.
      void this.renderCodexMarkdown(body, finalText)
        .finally(() => this.scrollCodexAnswer(shouldStickToBottom));
    } else {
      this.renderAgentMessageBody(body, finalText);
    }
    if (item.kind === "agentMessage") {
      const answer = body.closest<HTMLElement>(".vault-agent-turn-answer") ?? this.codexCurrentAnswerEl;
      this.clearCodexTurnLoadingIndicators(answer);
      this.scheduleCodexTurnCompletionFallback();
    }
    this.codexItemEls.delete(item.id);
    this.scrollCodexAnswer(shouldStickToBottom);
  }

  private async startAgent(provider: AgentProvider) {
    const sessionKey = this.activeAgentSessionKey;
    const cwd = this.plugin.getVaultPath();
    if (!cwd) {
      new Notice("This vault does not expose a local file-system path.");
      return;
    }

    this.disposeAgent();
    this.agentProvider = provider;
    this.saveAgentViewState();
    this.refreshAgentProviderButtons();

    if (provider === "codex" && this.plugin.settings.codexUseAppServer) {
      await this.startCodexBackend(cwd);
      return;
    }

    this.agentStartedAt = Date.now();
    this.agentSessionPath = null;
    this.agentSessionOffset = 0;
    this.agentCurrentTurnStartedAt = 0;
    this.agentSessionBaselineOffsets = snapshotAgentSessionOffsets(provider, cwd);
    this.agentSeenEntries.clear();
    this.agentAuthState = "checking";
    this.agentConversationReady = false;
    this.agentReadyNoticeShown = false;
    this.agentAutoLoginAttempted = false;
    this.agentAutoLoginPending = false;
    this.agentAutoMcpAttempted = false;
    this.agentMcpAuthInProgress = false;
    this.agentNeedsAuth = false;
    this.agentPromptState = null;
    this.agentOpenedExternalUrls.clear();
    if (provider === "claude") {
      this.ensureClaudeSessionId();
    }
    this.refreshAgentPromptActions();
    this.agentReadyForInput = false;
    this.setAgentStatus(`Checking ${getAgentProviderLabel(provider)} login...`);
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("system"),
      role: "system",
      text: `${getAgentProviderLabel(provider)} 세션을 시작합니다 · ${cwd}`
    });

    try {
      const missingRuntimeFiles = this.plugin.getRuntimeMissingFiles();
      if (missingRuntimeFiles.length > 0) {
        if (!this.plugin.settings.autoInstallRuntime) {
          throw new Error("Runtime files are missing. Use Settings > Obst Terminal > Runtime files first.");
        }

        await this.plugin.installRuntimeIfNeeded((message) => {
          this.withAgentSession(sessionKey, () => this.setAgentStatus(message));
        });
      }

      const env = buildProcessEnv({
        useSystemCa: this.plugin.settings.useSystemCa,
        extraCaCertPath: this.plugin.getExtraCaCertPath()
      });
      await this.checkAgentLoginStatus(provider, cwd, env);

      const shell = this.plugin.getShellExecutable();
      const host = spawn(this.plugin.getNodeExecutable(), [this.plugin.getPtyHostPath(), encodeConfig({
        shell,
        args: this.plugin.getShellArgs(shell),
        fallbackShells: this.plugin.getShellFallbacks(shell),
        cols: AGENT_CONSOLE_COLS,
        rows: AGENT_CONSOLE_ROWS,
        cwd,
        env,
        windowsPtyBackend: this.plugin.settings.windowsPtyBackend
      })], {
        cwd: this.plugin.getPluginBasePath(),
        env,
        windowsHide: true
      });

      this.withAgentSession(sessionKey, () => {
        this.agentHost = host;
        this.agentHostReady = false;
        this.startAgentSessionPolling();
      });

      host.stdout.on("data", (chunk: Buffer) => {
        this.withAgentSession(sessionKey, () => this.handleAgentHostStdout(chunk.toString()));
      });

      host.stderr.on("data", (chunk: Buffer) => {
        this.withAgentSession(sessionKey, () => {
          this.appendAgentTranscript({
            id: this.nextLocalAgentEntryId("system"),
            role: "system",
            text: stripTerminalControlSequences(chunk.toString()).trim() || chunk.toString()
          });
        });
      });

      host.on("error", (error: Error) => {
        this.withAgentSession(sessionKey, () => {
          const message = formatTerminalHostError(error, this.plugin);
          this.setAgentStatus("Failed");
          this.appendAgentTranscript({
            id: this.nextLocalAgentEntryId("system"),
            role: "system",
            text: `Failed to start agent host: ${message}`
          });
        });
      });

      host.on("close", (code: number | null) => {
        this.withAgentSession(sessionKey, () => {
          // Flush any answer already written to the session log before teardown,
          // so a response that landed right before the PTY died still appears.
          this.pollAgentSessionLog();
          // Host is gone — clear the "thinking" spinner so the turn isn't stuck.
          this.clearCodexTurnLoadingIndicators();
          this.setAgentStatus(`Exited ${code ?? "unknown"}`);
          this.appendAgentTranscript({
            id: this.nextLocalAgentEntryId("system"),
            role: "system",
            text: `에이전트 호스트가 종료되었습니다 (코드 ${code ?? "알 수 없음"}).`
          });
          this.agentHost = null;
          this.agentHostReady = false;
          this.agentReadyForInput = false;
          this.stopAgentSessionPolling();
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.withAgentSession(sessionKey, () => {
        this.setAgentStatus("Failed");
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `Failed to start ${getAgentProviderLabel(provider)}: ${message}`
        });
      });
      new Notice(`Failed to start ${getAgentProviderLabel(provider)}: ${message}`);
    }
  }

  private handleAgentHostStdout(chunk: string) {
    this.agentStdoutBuffer += chunk;

    while (true) {
      const newlineIndex = this.agentStdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = this.agentStdoutBuffer.slice(0, newlineIndex).trimEnd();
      this.agentStdoutBuffer = this.agentStdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      try {
        const message = JSON.parse(line) as HostOutputMessage;
        if (message.type === "ready") {
          this.agentHostReady = true;
          this.launchAgentCli();
        } else if (message.type === "data") {
          this.rememberAgentRawOutput(message.data);
        } else if (message.type === "exit") {
          this.appendAgentTranscript({
            id: this.nextLocalAgentEntryId("system"),
            role: "system",
            text: `${getAgentProviderLabel(this.agentProvider)} 세션이 종료되었습니다 (코드 ${message.exitCode ?? "알 수 없음"}).`
          });
        } else if (message.type === "error") {
          this.setAgentStatus("Failed");
          this.appendAgentTranscript({
            id: this.nextLocalAgentEntryId("system"),
            role: "system",
            text: `Agent error: ${message.message}`
          });
        }
      } catch {
        this.rememberAgentRawOutput(line);
      }
    }
  }

  private launchAgentCli() {
    const sessionKey = this.activeAgentSessionKey;
    // Keep Claude's background control PTY out of the normal conversation
    // session. Claude Code locks a sessionId per running process, so the
    // persistent PTY and one-shot `claude -p` turns must not share the same id.
    const claudeSessionId = this.agentProvider === "claude" ? this.ensureClaudeControlSessionId() : undefined;
    let command = getAgentLaunchCommand(this.agentProvider, this.plugin.settings, {
      claudeSessionId,
      sessionName: this.agentSessionLabel
    });
    this.saveAgentViewState();
    this.refreshAgentSessionChrome();
    this.lastAgentLaunchCommand = command;
    this.sendAgentHostMessage({ type: "data", data: `${command}\r` });
    this.setAgentStatus(`Launching ${getAgentProviderLabel(this.agentProvider)}...`);

    if (this.agentReadyTimer !== null) {
      window.clearTimeout(this.agentReadyTimer);
    }

    this.agentReadyTimer = window.setTimeout(() => {
      this.withAgentSession(sessionKey, () => {
        this.agentReadyTimer = null;
        if (!this.agentHost) {
          return;
        }

        this.agentReadyForInput = true;
        if (this.agentAutoLoginPending && this.agentAuthState === "login-required") {
          this.startAgentLoginFlow(`${getAgentProviderLabel(this.agentProvider)} login status reports not signed in.`);
          return;
        }

        if (this.agentAuthState === "authenticated" || this.agentAuthState === "ready") {
          this.markAgentConversationReady(`${getAgentProviderLabel(this.agentProvider)} 로그인이 확인되었습니다. 이제 대화를 시작할 수 있습니다.`);
          return;
        }

        if (this.agentAuthState === "checking") {
          this.setAgentStatus(`Checking ${getAgentProviderLabel(this.agentProvider)} login...`);
        } else {
          this.refreshAgentAuthStatus();
        }
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `${getAgentProviderLabel(this.agentProvider)} is running. This console will detect login prompts and start the login flow automatically when required. MCP connection screens are handled separately with /mcp when the CLI reports them.`
        });
      });
    }, AGENT_READY_DELAY_MS);
  }

  private parseAgentDelegationCommand(text: string): AgentDelegationCommand | null {
    const trimmed = text.trim();
    const explicitCommand = /^\/(?:send|to|delegate)\s+/i.test(trimmed);
    const body = trimmed.replace(/^\/(?:send|to|delegate)\s+/i, "");
    if (!body.startsWith("@")) {
      return null;
    }

    const quoted = body.match(/^@"([^"]+)"\s+([\s\S]+)$/);
    const bare = quoted ? null : body.match(/^@(\S+)\s+([\s\S]+)$/);
    const targetText = (quoted?.[1] ?? bare?.[1] ?? "").trim();
    const message = (quoted?.[2] ?? bare?.[2] ?? "").trim();
    if (!targetText || !message) {
      return null;
    }

    this.ensureInternalAgentSessions();
    const targets = this.findAgentDelegationTargets(targetText);
    if (!explicitCommand && !quoted && targets.length === 0 && !isKnownAgentDelegationTarget(targetText)) {
      return null;
    }

    return {
      targetText,
      message,
      targets
    };
  }

  private findAgentDelegationTargets(targetText: string): AgentWorkspaceSessionState[] {
    const target = normalizeAgentRouteToken(targetText);
    const otherSessions = this.agentSessions.filter((session) => session.agentSessionKey !== this.activeAgentSessionKey);

    if (target === "all" || target === "others" || target === "전체" || target === "나머지") {
      return otherSessions;
    }

    if (target === "codex" || target === "코덱스") {
      return otherSessions.filter((session) => session.agentProvider === "codex");
    }

    if (target === "claude" || target === "claudecode" || target === "클로드" || target === "클로드코드") {
      return otherSessions.filter((session) => session.agentProvider === "claude");
    }

    return otherSessions.filter((session) => agentSessionMatchesDelegationTarget(session, targetText));
  }

  private dispatchAgentDelegation(command: AgentDelegationCommand, attachments: AgentAttachment[]) {
    const sourceLabel = this.agentSessionLabel || createAgentSessionLabel(this.agentSessionKey);
    const targetLabels = command.targets.map((session) => this.formatAgentRouteLabel(session)).join(", ");
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("system"),
      role: "system",
      text: `다른 AI 세션으로 지시를 전달합니다: ${targetLabels}`
    });

    const results = command.targets.map((target) =>
      this.withAgentSession(target.agentSessionKey, () =>
        this.deliverAgentDelegation(command.message, attachments, sourceLabel)
      )
    );
    const delivered = results.filter((result) => result.status !== "failed").length;
    const summary = results
      .map((result) => `- ${result.sessionLabel}: ${formatDelegationDeliveryStatus(result)}`)
      .join("\n");
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("system"),
      role: "system",
      text: `전달 결과: ${delivered}/${results.length}\n${summary}`
    });
    this.saveAgentViewState();
    new Notice(`AI 세션 전달: ${delivered}/${results.length}`);
  }

  private deliverAgentDelegation(message: string, attachments: AgentAttachment[], sourceLabel: string): AgentDelegationDeliveryResult {
    const sessionLabel = this.agentSessionLabel || createAgentSessionLabel(this.agentSessionKey);
    const provider = this.agentProvider;
    const routedText = formatDelegatedAgentPrompt(sourceLabel, message);
    const visibleText = routedText + (attachments.length ? `\n\n[${attachments.length} file(s) attached]` : "");

    if (this.agentBackend) {
      if (this.codexTurnActive) {
        this.codexQueuedInputs.push({ text: routedText, attachments });
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `${sourceLabel}에서 전달된 지시를 Codex 대기열에 추가했습니다.`
        });
        return { sessionLabel, provider, status: "queued", reason: "Codex is answering" };
      }

      this.beginCodexTurn(routedText, attachments);
      return { sessionLabel, provider, status: "sent" };
    }

    if (!this.agentHost || !this.agentHostReady || !this.agentReadyForInput) {
      const reason = `${getAgentProviderLabel(provider)} is not running`;
      this.appendDelegationFailure(sourceLabel, reason, message);
      return { sessionLabel, provider, status: "failed", reason };
    }

    if (this.agentProvider === "claude" && this.agentClaudePrintTurnActive) {
      const reason = "Claude is answering";
      this.appendDelegationFailure(sourceLabel, reason, message);
      return { sessionLabel, provider, status: "failed", reason };
    }

    const promptMode = this.agentPromptState?.mode;
    if (this.agentPromptState && promptMode !== "text") {
      const reason = "Agent is waiting for an interactive prompt";
      this.appendDelegationFailure(sourceLabel, reason, message);
      return { sessionLabel, provider, status: "failed", reason };
    }

    if (this.agentNeedsAuth && !this.isAgentInteractiveReplyAllowed(routedText)) {
      const reason = `${getAgentProviderLabel(provider)} login is required`;
      this.appendDelegationFailure(sourceLabel, reason, message);
      return { sessionLabel, provider, status: "failed", reason };
    }

    const contextualRoutedText = this.buildContextualAgentPrompt(routedText);
    const textWithAttachments = appendAgentAttachmentPrompt(contextualRoutedText, attachments);
    this.agentCurrentTurnStartedAt = Date.now();
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("user"),
      role: "user",
      text: visibleText
    });

    const useClaudePrintMode = this.agentProvider === "claude" && !!textWithAttachments && (!this.agentPromptState || promptMode === "text");
    if (useClaudePrintMode) {
      void this.sendClaudePrintTurn(textWithAttachments);
      return { sessionLabel, provider, status: "sent" };
    }

    this.clearAgentPromptState();
    this.sendAgentHostMessage({ type: "data", data: `${formatTerminalPasteData(textWithAttachments)}\r` });
    this.setAgentStatus("Waiting for response...");
    return { sessionLabel, provider, status: "sent" };
  }

  private appendDelegationFailure(sourceLabel: string, reason: string, message: string) {
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("system"),
      role: "system",
      text: `${sourceLabel}에서 지시가 도착했지만 전달하지 못했습니다: ${reason}\n\n${message}`
    });
  }

  private formatAgentRouteLabel(session: AgentWorkspaceSessionState): string {
    return `${session.agentSessionLabel} (${getAgentProviderLabel(session.agentProvider)})`;
  }

  private async sendAgentInput() {
    const inputEl = this.agentInputEl;
    if (!inputEl) {
      return;
    }

    const text = inputEl.value.trim();
    const attachments = this.codexPendingAttachments.slice();
    if (!text && attachments.length === 0 && !this.agentPromptState?.allowEmptySubmit) {
      return;
    }

    const delegation = this.parseAgentDelegationCommand(text);
    if (delegation) {
      if (delegation.targets.length === 0) {
        new Notice(`No target matched: ${delegation.targetText}`);
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `대상 AI 세션을 찾지 못했습니다: ${delegation.targetText}`
        });
        return;
      }

      inputEl.value = "";
      this.codexPendingAttachments = [];
      this.renderAttachmentChips();
      this.dispatchAgentDelegation(delegation, attachments);
      return;
    }

    if (isAgentDelegationAttempt(text)) {
      new Notice("Use @all, @codex, @claude, or @\"session title\" followed by a message.");
      return;
    }

    if (this.agentBackend) {
      if (!text && attachments.length === 0) {
        return;
      }
      inputEl.value = "";
      this.codexPendingAttachments = [];
      this.renderAttachmentChips();
      if (this.codexTurnActive) {
        // Still answering — queue this message (Codex-app behavior), don't open
        // a second concurrent turn. It sends when the current turn ends/stops.
        this.codexQueuedInputs.push({ text, attachments });
        new Notice(`응답 중 — 메시지를 큐에 추가했습니다 (${this.codexQueuedInputs.length}개 대기). Stop을 누르면 즉시 넘어갑니다.`);
        return;
      }
      this.beginCodexTurn(text, attachments);
      return;
    }

    if (!this.agentHost || !this.agentHostReady || !this.agentReadyForInput) {
      new Notice("Start the selected agent first, then send after it is running.");
      return;
    }

    if (this.agentNeedsAuth && !this.isAgentInteractiveReplyAllowed(text)) {
      const loginStarted = this.startAgentLoginFlow(`${getAgentProviderLabel(this.agentProvider)} login is required before normal messages can be sent.`);
      new Notice(loginStarted ? "Starting Claude login." : "The agent is asking for login.");
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: loginStarted
          ? `${getAgentProviderLabel(this.agentProvider)} login is required before normal messages can be sent. Starting the login flow automatically.`
          : `${getAgentProviderLabel(this.agentProvider)} login is required before normal messages can be sent. Answer the active login prompt in this console.`
      });
      return;
    }

    const promptMode = this.agentPromptState?.mode;
    if (this.agentProvider === "claude" && this.agentClaudePrintTurnActive) {
      new Notice("Claude 응답을 기다리는 중입니다.");
      return;
    }

    if (promptMode === "auth-code" && !text.startsWith("/") && !looksLikeAgentAuthCode(text)) {
      new Notice("Claude is waiting for the login code. Open the login link, copy the code, then paste only the code here.");
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: "Claude is waiting for a browser login code. Use Open login link, then paste only the returned code into this box."
      });
      return;
    }

    const contextualText = this.buildContextualAgentPrompt(text);
    const textWithAttachments = appendAgentAttachmentPrompt(contextualText, attachments);
    const useClaudePrintMode = this.agentProvider === "claude" &&
      !!textWithAttachments &&
      !text.startsWith("/") &&
      (!this.agentPromptState || promptMode === "text");

    inputEl.value = "";
    this.codexPendingAttachments = [];
    this.renderAttachmentChips();
    const visibleText = text || (attachments.length ? "(attachments)" : "[Enter]");
    this.agentCurrentTurnStartedAt = Date.now();
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("user"),
      role: "user",
      text: visibleText + (attachments.length ? `\n\n[${attachments.length} file(s) attached]` : "")
    });
    if (useClaudePrintMode) {
      await this.sendClaudePrintTurn(textWithAttachments);
      return;
    }

    if (promptMode === "continue" && !text.startsWith("/")) {
      const sessionKey = this.activeAgentSessionKey;
      this.clearAgentPromptState();
      this.sendAgentHostMessage({ type: "data", data: ESCAPE_SEQUENCE });
      window.setTimeout(() => {
        this.withAgentSession(sessionKey, () => {
          this.sendAgentHostMessage({ type: "data", data: `${formatTerminalPasteData(textWithAttachments)}\r` });
        });
      }, 100);
      this.setAgentStatus("Waiting for response...");
      return;
    }

    const data = this.agentPromptState && !(promptMode === "mcp" && !text.startsWith("/"))
      ? formatAgentInteractiveInput(text)
      : `${formatTerminalPasteData(textWithAttachments)}\r`;
    this.clearAgentPromptState();
    this.sendAgentHostMessage({ type: "data", data });
    this.setAgentStatus("Waiting for response...");
  }

  private async sendClaudePrintTurn(text: string) {
    const sessionKey = this.activeAgentSessionKey;
    const cwd = this.plugin.getVaultPath();
    if (!cwd) {
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: "This vault does not expose a local file-system path."
      });
      return;
    }

    this.agentClaudePrintTurnActive = true;
    this.clearAgentPromptState();
    this.setAgentStatus("Waiting for Claude response...");
    try {
      const env = buildProcessEnv({
        useSystemCa: this.plugin.settings.useSystemCa,
        extraCaCertPath: this.plugin.getExtraCaCertPath()
      });
      const sessionId = this.ensureClaudeSessionId();
      const result = await runClaudePrintCommand(text, cwd, env, CLAUDE_PRINT_TIMEOUT_MS, {
        sessionId,
        sessionName: this.agentSessionLabel
      });
      this.withAgentSession(sessionKey, () => {
        const output = formatClaudePrintOutput(result);
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("assistant"),
          role: "assistant",
          text: output
        });
        if (isAgentSessionLimitText(output)) {
          this.setAgentStatus("Claude session limit");
        } else {
          this.markAgentConversationReady();
        }
        this.syncAgentSessionOffsetToLatestEnd();
      });
    } finally {
      this.withAgentSession(sessionKey, () => {
        this.agentClaudePrintTurnActive = false;
      });
    }
  }

  private syncAgentSessionOffsetToLatestEnd() {
    const cwd = this.plugin.getVaultPath();
    if (!cwd) {
      return;
    }

    const sessionPath = findLatestAgentSessionFile(this.agentProvider, cwd, this.agentStartedAt, this.agentClaudeSessionId);
    if (!sessionPath) {
      return;
    }

    this.agentSessionPath = sessionPath;
    this.agentSessionOffset = getFileSize(sessionPath) ?? this.agentSessionOffset;
  }

  private sendAgentControlInput(text: string) {
    if (!this.agentHost || !this.agentHostReady || !this.agentReadyForInput) {
      new Notice("Start the selected agent first.");
      return;
    }

    this.agentCurrentTurnStartedAt = Date.now();
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("user"),
      role: "user",
      text
    });
    this.sendAgentHostMessage({ type: "data", data: `${text}\r` });
    this.noteAgentControlFlow(text);
    this.clearAgentPromptState();
    this.refreshAgentAuthStatus(`${getAgentProviderLabel(this.agentProvider)} waiting`);
  }

  private sendAgentControlData(data: string, label: string, keepPrompt = false) {
    if (!this.agentHost || !this.agentHostReady || !this.agentReadyForInput) {
      new Notice("Start the selected agent first.");
      return;
    }

    this.agentCurrentTurnStartedAt = Date.now();
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("user"),
      role: "user",
      text: label
    });
    this.sendAgentHostMessage({ type: "data", data });
    this.noteAgentControlFlow(data);
    if (!keepPrompt) {
      this.clearAgentPromptState();
    }
    this.refreshAgentAuthStatus(`${getAgentProviderLabel(this.agentProvider)} waiting`);
  }

  private isAgentInteractiveReplyAllowed(text: string): boolean {
    if (text.startsWith("/")) {
      return true;
    }

    if (!this.agentPromptState) {
      return false;
    }

    if (this.agentPromptState.mode === "auth") {
      return /^\d+$/.test(text) || /^login$/i.test(text);
    }

    return true;
  }

  private async checkAgentLoginStatus(provider: AgentProvider, cwd: string, env: { [key: string]: string | undefined }) {
    const sessionKey = this.activeAgentSessionKey;
    this.setAgentStatus(`Checking ${getAgentProviderLabel(provider)} login...`);
    const status = await getAgentAuthCheck(provider, cwd, env);
    this.withAgentSession(sessionKey, () => {
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: status.summary
      });

      if (status.loggedIn === true) {
        this.agentAuthState = "authenticated";
        this.agentConversationReady = false;
        this.agentNeedsAuth = false;
        this.agentAutoLoginPending = false;
        this.setAgentStatus(`${getAgentProviderLabel(provider)} login confirmed`);
        return;
      }

      if (status.loggedIn === false) {
        this.agentAuthState = "login-required";
        this.agentConversationReady = false;
        this.agentNeedsAuth = provider === "claude";
        this.agentAutoLoginPending = provider === "claude";
        this.refreshAgentAuthStatus();
        return;
      }

      this.agentAuthState = "checking";
      this.agentConversationReady = false;
      this.agentAutoLoginPending = false;
      this.refreshAgentAuthStatus();
    });
  }

  private setAgentPromptState(prompt: AgentPromptState) {
    if (prompt.mode === "mcp") {
      this.markAgentConversationReady("Claude Code에 로그인되어 있습니다. MCP 도구 연결은 로그인과 별개로 처리됩니다.");
      this.agentMcpAuthInProgress = hasMcpNeedsAuthenticationText(prompt.text);
    } else if (prompt.requiresAuth || prompt.mode === "auth" || prompt.mode === "auth-code") {
      this.agentConversationReady = false;
      this.agentAuthState = prompt.mode === "auth-code" || prompt.urls.some((url) => isAgentLoginUrl(url))
        ? "login-in-progress"
        : "login-required";
      this.agentNeedsAuth = true;
    }

    this.agentPromptState = prompt;
    this.agentNeedsAuth = this.agentNeedsAuth || prompt.requiresAuth;
    this.refreshAgentPromptActions();
    if (this.isVisibleAgentSessionContext()) {
      this.agentInputEl?.focus();
    }

    if (prompt.mode === "auth" || prompt.mode === "auth-code") {
      const loginUrl = prompt.urls.find((url) => isAgentLoginUrl(url));
      if (loginUrl && !this.agentOpenedExternalUrls.has(loginUrl)) {
        this.agentOpenedExternalUrls.add(loginUrl);
        this.openAgentExternalUrl(loginUrl);
      }

      if (this.agentAuthState === "login-required") {
        this.startAgentLoginFlow("Claude Code에 로그인이 필요합니다.");
      } else {
        this.refreshAgentAuthStatus();
      }
      return;
    }

    if (prompt.mode === "mcp") {
      const authUrl = prompt.urls.find((url) => isAgentAuthUrl(url));
      if (authUrl && !this.agentOpenedExternalUrls.has(authUrl)) {
        this.agentOpenedExternalUrls.add(authUrl);
        this.openAgentExternalUrl(authUrl);
      }

      if (isMcpAuthPrompt(prompt.text)) {
        this.startAgentMcpFlow("Claude Code reports MCP tools that need connection.");
      }
      this.refreshAgentAuthStatus();
      return;
    }

    this.refreshAgentAuthStatus();
  }

  private clearAgentPromptState(clearAuth = false) {
    this.agentPromptState = null;
    if (clearAuth) {
      this.agentNeedsAuth = false;
      if (this.agentAuthState === "login-required" || this.agentAuthState === "login-in-progress") {
        this.agentAuthState = this.agentConversationReady ? "ready" : "checking";
      }
    }
    this.refreshAgentPromptActions();
  }

  private refreshAgentPromptActions() {
    const container = this.agentPromptActionsEl;
    if (!container || !this.isVisibleAgentSessionContext()) {
      return;
    }

    container.empty();
    const prompt = this.agentPromptState;
    container.toggleClass("is-hidden", !prompt);
    this.refreshAgentLoginButton();
    if (!prompt) {
      return;
    }

    const label = container.createDiv("vault-agent-prompt-actions-label");
    label.setText(getAgentPromptModeLabel(prompt.mode));
    for (const action of prompt.actions) {
      const button = container.createEl("button", {
        cls: "vault-agent-prompt-action",
        text: action.label
      });
      if (action.description) {
        button.setAttr("aria-label", action.description);
        button.setAttr("title", action.description);
      }
      button.addEventListener("click", () => {
        if (action.kind === "open-url") {
          this.openAgentExternalUrl(action.url);
          return;
        }

        if (action.kind === "copy-text") {
          void writeClipboardText(action.text).then(() => {
            new Notice(action.label.toLowerCase().includes("mcp") ? "Copied MCP link." : "Copied login link.");
          }).catch((error: Error) => {
            new Notice(`Could not copy link: ${error.message}`);
          });
          return;
        }

        if (action.kind === "submit-clipboard") {
          this.submitAgentAuthCodeFromClipboard();
          return;
        }

        this.sendAgentControlData(action.data, action.label, action.keepPrompt ?? false);
      });
    }
  }

  private refreshAgentLoginButton() {
    const button = this.agentLoginButton;
    if (!button || !this.isVisibleAgentSessionContext()) {
      return;
    }

    const mcpPromptActive = this.agentPromptState?.mode === "mcp";
    button.toggleAttribute("disabled", mcpPromptActive);
    button.setAttr("aria-disabled", mcpPromptActive ? "true" : "false");
    if (mcpPromptActive) {
      button.setAttr("title", "MCP connection screens are separate from Claude login.");
    } else {
      button.removeAttribute("title");
    }
  }

  private openAgentExternalUrl(url: string) {
    if (!openExternalUrlWithSystemBrowser(url)) {
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (popup) {
        return;
      }

      void writeClipboardText(url).then(() => {
        new Notice("Could not open the link, so it was copied instead.");
      }).catch((error: Error) => {
        new Notice(`Could not open or copy link: ${error.message}`);
      });
    }
  }

  private submitAgentAuthCodeFromClipboard() {
    const code = clipboard.readText().trim();
    if (!looksLikeAgentAuthCode(code)) {
      new Notice("Clipboard does not look like a login code.");
      return;
    }

    this.sendAgentControlData(formatAgentInteractiveInput(code), "Submit copied code");
  }

  private sendAgentHostMessage(message: HostInputMessage) {
    if (!this.agentHost || !this.agentHost.stdin.writable) {
      return;
    }

    if (message.type === "data" && !this.agentHostReady) {
      return;
    }

    this.agentHost.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private rememberAgentRawOutput(data: string) {
    const plainText = stripTerminalControlSequences(data).trim();
    if (!plainText) {
      return;
    }

    // Ignore the shell echo of our own launch command (truncated or full). Its
    // "--permission-mode" etc. would otherwise be misread as an interactive prompt.
    const launch = this.lastAgentLaunchCommand;
    if (launch && (launch.startsWith(plainText) || plainText.startsWith(launch.slice(0, 24)))) {
      return;
    }

    this.markAgentOutputActive();

    const authCompleted = hasAgentAuthSuccess(plainText);
    if (authCompleted) {
      this.markAgentConversationReady("로그인이 완료되었습니다. Claude Code가 준비되었습니다.");
    }

    if (hasAgentMcpAuthSuccess(plainText)) {
      this.agentMcpAuthInProgress = false;
      this.refreshAgentAuthStatus();
    }

    const promptSource = authCompleted
      ? getTextAfterLastAgentAuthSuccess(plainText)
      : plainText;
    if (!promptSource.trim()) {
      return;
    }

    const mcpStartupFailure = getMcpStartupFailureText(promptSource);
    if (mcpStartupFailure) {
      this.agentMcpAuthInProgress = false;
      this.clearAgentPromptState();
      this.markAgentConversationReady();
      this.setAgentStatus("MCP configuration issue");

      const notice = formatMcpStartupFailureNotice(mcpStartupFailure, getAgentProviderLabel(this.agentProvider));
      if (notice !== this.agentLastRawNotice) {
        this.agentLastRawNotice = notice;
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: notice
        });
      }
      return;
    }

    const mcpAuth = isMcpAuthPrompt(promptSource) || isMcpManagementPrompt(promptSource);
    const loginRequired = !mcpAuth && isAgentLoginRequiredText(promptSource);
    const loginFlow = !mcpAuth && isAgentLoginFlowText(promptSource);
    if (mcpAuth) {
      this.agentMcpAuthInProgress = hasMcpNeedsAuthenticationText(promptSource);
      this.markAgentConversationReady("Claude Code에 로그인되어 있습니다. MCP 도구 연결은 별도로 처리됩니다.");
    }

    if (!loginRequired && !loginFlow && isAgentConversationReadyText(promptSource)) {
      this.markAgentConversationReady();
    }

    // Once the conversation is live, claude's streamed answer (markdown such as
    // "Normalization", "select", "- item") must not be mistaken for an
    // interactive prompt — the session log drives the transcript instead.
    const actionablePrompt = this.agentConversationReady ? null : extractAgentActionablePrompt(promptSource);
    if (actionablePrompt) {
      this.setAgentPromptState(actionablePrompt);
    }

    if (!actionablePrompt && loginRequired) {
      this.agentConversationReady = false;
      this.agentAuthState = "login-required";
      this.agentNeedsAuth = true;
      this.startAgentLoginFlow("Claude Code에 로그인이 필요합니다.");
    } else if (!actionablePrompt && loginFlow) {
      this.agentConversationReady = false;
      this.agentAuthState = "login-in-progress";
      this.agentNeedsAuth = true;
      this.refreshAgentAuthStatus();
    }

    if (!actionablePrompt && mcpAuth && !loginRequired) {
      if (isMcpAuthPrompt(promptSource)) {
        this.startAgentMcpFlow("Claude Code reports MCP tools that need connection.");
      } else {
        this.refreshAgentAuthStatus();
      }
    }

    if (actionablePrompt || (!this.agentSessionPath && /login|auth|permission|trust|press|continue|select|choose|not recognized|not found|command not found/i.test(promptSource))) {
      this.refreshAgentAuthStatus(actionablePrompt?.mode === "mcp" ? "MCP connection in progress" : "Agent prompt needs input");
    }

    if (actionablePrompt || (!this.agentConversationReady && /\b(login|sign[- ]?in|authenticate|permission|trust|press enter|\(y\/n\)|not recognized|command not found)\b/i.test(promptSource))) {
      const notice = actionablePrompt?.text ?? promptSource.slice(-1200);
      if (notice !== this.agentLastRawNotice) {
        this.agentLastRawNotice = notice;
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `Agent prompt:\n${notice}\n\nReply in the message box or use the quick actions below. ${getAgentProviderLabel(this.agentProvider)} login prompts and MCP connection screens are handled separately inside this console.`
        });
      }
    }
  }

  private startAgentSessionPolling() {
    this.stopAgentSessionPolling();
    const sessionKey = this.activeAgentSessionKey;
    this.agentSessionPollTimer = window.setInterval(() => {
      this.withAgentSession(sessionKey, () => this.pollAgentSessionLog());
    }, AGENT_SESSION_POLL_MS);
  }

  private stopAgentSessionPolling() {
    if (this.agentSessionPollTimer !== null) {
      window.clearInterval(this.agentSessionPollTimer);
      this.agentSessionPollTimer = null;
    }
  }

  private pollAgentSessionLog() {
    const cwd = this.plugin.getVaultPath();
    if (!cwd) {
      return;
    }

    if (!this.agentSessionPath) {
      const sessionPath = findLatestAgentSessionFile(this.agentProvider, cwd, this.agentStartedAt, this.agentClaudeSessionId);
      if (!sessionPath) {
        return;
      }

      this.agentSessionPath = sessionPath;
      const baselineOffset = this.agentSessionBaselineOffsets.get(normalizeSessionFileKey(sessionPath));
      if (baselineOffset !== undefined) {
        this.agentSessionOffset = baselineOffset;
        const chunk = readFileTextFromOffset(sessionPath, baselineOffset);
        if (chunk) {
          this.agentSessionOffset = chunk.nextOffset;
          if (chunk.text) {
            this.ingestAgentSessionLog(chunk.text, false);
          }
        }
        return;
      }

      // A resumed session (claude --continue) holds the whole backlog. Seed old
      // entries so the backlog is hidden, but still render entries from the
      // current turn if Claude wrote the answer before our first poll.
      try {
        const existing = readFileSync(sessionPath, "utf8");
        this.ingestAgentSessionLog(existing, true);
        this.agentSessionOffset = Buffer.byteLength(existing, "utf8");
      } catch {
        this.agentSessionOffset = getFileSize(sessionPath) ?? 0;
      }
      return;
    }

    const chunk = readFileTextFromOffset(this.agentSessionPath, this.agentSessionOffset);
    if (!chunk || !chunk.text) {
      return;
    }

    this.agentSessionOffset = chunk.nextOffset;
    this.ingestAgentSessionLog(chunk.text, false);
  }

  private ingestAgentSessionLog(text: string, initialBacklog: boolean) {
    const cutoffMs = this.agentCurrentTurnStartedAt || this.agentStartedAt;
    for (const entry of parseAgentTranscriptEntries(this.agentProvider, text)) {
      if (this.agentSeenEntries.has(entry.id)) {
        continue;
      }

      this.agentSeenEntries.add(entry.id);
      if (entry.role === "user") {
        continue;
      }

      if (initialBacklog && !isAgentEntryAfterCutoff(entry, cutoffMs)) {
        continue;
      }

      if (this.agentProvider === "claude" && this.agentClaudePrintTurnActive && entry.role === "assistant") {
        continue;
      }

      this.appendAgentTranscript(entry);
      if (isAgentSessionLimitText(entry.text)) {
        this.setAgentStatus("Claude session limit");
      }
      this.clearAgentPromptState(true);
      this.markAgentConversationReady();
    }
  }

  private markAgentConversationReady(message?: string) {
    this.agentConversationReady = true;
    this.agentAuthState = "ready";
    this.agentNeedsAuth = false;
    if (this.agentPromptState?.requiresAuth || this.agentPromptState?.mode === "auth" || this.agentPromptState?.mode === "auth-code") {
      this.clearAgentPromptState(true);
    }

    this.refreshAgentAuthStatus();
    if (message && !this.agentReadyNoticeShown) {
      this.agentReadyNoticeShown = true;
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: message
      });
    }
  }

  private startAgentLoginFlow(reason: string): boolean {
    if (this.agentProvider !== "claude" || this.agentAutoLoginAttempted || !this.agentHost || !this.agentHostReady) {
      this.refreshAgentAuthStatus();
      return false;
    }

    this.agentAutoLoginAttempted = true;
    this.agentConversationReady = false;
    this.agentAuthState = "login-in-progress";
    this.agentAutoLoginPending = false;
    this.agentNeedsAuth = true;
    this.setAgentStatus("Claude Code login in progress");
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("system"),
      role: "system",
      text: `${reason} Starting /login automatically.`
    });
    this.sendAgentHostMessage({ type: "data", data: "/login\r" });
    return true;
  }

  private startAgentMcpFlow(reason: string): boolean {
    if (this.agentProvider !== "claude" || this.agentAutoMcpAttempted || !this.agentHost || !this.agentHostReady) {
      this.refreshAgentAuthStatus();
      return false;
    }

    this.agentAutoMcpAttempted = true;
    this.agentMcpAuthInProgress = true;
    this.setAgentStatus("MCP connection in progress");
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("system"),
      role: "system",
      text: `${reason} Opening the MCP connection screen automatically.`
    });
    this.sendAgentHostMessage({ type: "data", data: "/mcp\r" });
    return true;
  }

  private noteAgentControlFlow(text: string) {
    if (/\/login\b/i.test(text)) {
      if (this.agentPromptState?.mode === "mcp") {
        this.agentMcpAuthInProgress = false;
        this.refreshAgentAuthStatus();
        return;
      }

      this.agentAutoLoginAttempted = true;
      this.agentConversationReady = false;
      this.agentAuthState = "login-in-progress";
      this.agentNeedsAuth = true;
    }

    if (/\/mcp\b/i.test(text)) {
      this.agentAutoMcpAttempted = true;
      this.agentMcpAuthInProgress = true;
    }
  }

  private markAgentOutputActive() {
    const sessionKey = this.activeAgentSessionKey;
    if (this.agentOutputIdleTimer !== null) {
      window.clearTimeout(this.agentOutputIdleTimer);
      this.agentOutputIdleTimer = null;
    }

    if (this.agentAuthState === "ready" || this.agentAuthState === "authenticated") {
      this.setAgentStatus(this.agentMcpAuthInProgress ? "MCP connection receiving output..." : "Receiving output...");
    }

    this.agentOutputIdleTimer = window.setTimeout(() => {
      this.withAgentSession(sessionKey, () => {
        this.agentOutputIdleTimer = null;
        this.refreshAgentAuthStatus();
      });
    }, 1800);
  }

  private refreshAgentAuthStatus(fallback?: string) {
    if (this.agentPromptState?.mode === "mcp") {
      this.setAgentStatus(this.agentMcpAuthInProgress ? "Signed in; MCP connection waiting" : "Signed in; MCP menu waiting");
      return;
    }

    if (this.agentPromptState && this.agentAuthState === "ready") {
      this.setAgentStatus("Agent prompt waiting");
      return;
    }

    if (this.agentAuthState === "ready") {
      this.setAgentStatus(this.agentMcpAuthInProgress ? "Signed in; MCP connection running" : "Signed in; ready for message");
      return;
    }

    if (this.agentAuthState === "authenticated") {
      this.setAgentStatus(`${getAgentProviderLabel(this.agentProvider)} login confirmed`);
      return;
    }

    if (this.agentAuthState === "login-in-progress") {
      this.setAgentStatus(`${getAgentProviderLabel(this.agentProvider)} login in progress`);
      return;
    }

    if (this.agentAuthState === "login-required") {
      this.setAgentStatus(`${getAgentProviderLabel(this.agentProvider)} login required`);
      return;
    }

    if (this.agentAuthState === "checking") {
      this.setAgentStatus(`Checking ${getAgentProviderLabel(this.agentProvider)} login...`);
      return;
    }

    if (fallback) {
      this.setAgentStatus(fallback);
    }
  }

  private appendAgentTranscript(entry: AgentTranscriptEntry) {
    if (!entry.text.trim() || !this.agentTranscriptEl) {
      return;
    }

    const text = entry.text.trim();
    // Conversation entries (Claude session-log polling) flow into the same
    // turn-card UI as Codex. system/other entries stay as flat notices.
    if (entry.role === "user") {
      this.startCodexTurn(text);
      return;
    }
    if (entry.role === "assistant") {
      const shouldStickToBottom = this.shouldAutoScrollAgentTranscript();
      const answer = this.ensureCodexAnswerEl();
      if (!answer) {
        return;
      }
      // The visible answer arrived — drop the thinking indicator.
      this.codexTurnLoadingEl?.remove();
      this.codexTurnLoadingEl = null;
      // Same block class as Codex so the theme markdown + spacing apply identically.
      const block = answer.createDiv("vault-agent-block vault-agent-block-agentMessage");
      void this.renderCodexMarkdown(block.createDiv("vault-agent-block-body"), text)
        .finally(() => this.scrollCodexAnswer(shouldStickToBottom));
      this.scrollCodexAnswer(shouldStickToBottom);
      return;
    }

    if (this.agentProvider === "codex" && this.codexTurnActive && (entry.role === "system" || entry.role === "tool")) {
      const answer = this.ensureCodexAnswerEl();
      if (!answer) {
        return;
      }
      const shouldStickToBottom = this.shouldAutoScrollAgentTranscript();
      const block = answer.createDiv(`vault-agent-block vault-agent-block-${entry.role}`);
      block.createDiv("vault-agent-block-label").setText(getTranscriptRoleLabel(entry.role));
      this.renderAgentMessageBody(block.createDiv("vault-agent-block-body"), text);
      if (this.codexTurnLoadingEl && this.codexTurnLoadingEl.parentElement === answer) {
        answer.appendChild(this.codexTurnLoadingEl);
      }
      this.scrollCodexAnswer(shouldStickToBottom);
      return;
    }

    const shouldStickToBottom = this.shouldAutoScrollAgentTranscript();
    const item = this.agentTranscriptEl.createDiv(`vault-agent-message vault-agent-message-${entry.role}`);
    item.createDiv("vault-agent-message-role").setText(getTranscriptRoleLabel(entry.role));
    this.renderAgentMessageBody(item.createDiv("vault-agent-message-body"), text);
    if (shouldStickToBottom) {
      this.agentTranscriptEl.scrollTop = this.agentTranscriptEl.scrollHeight;
      this.rememberAgentTranscriptScrollPosition(this.agentTranscriptEl);
    }
  }

  private renderAgentMessageBody(container: HTMLElement, text: string) {
    appendTextWithLinks(container, text, (url) => {
      this.openAgentExternalUrl(url);
    });
  }

  private setAgentStatus(text: string) {
    this.agentStatusText = text;
    if (!this.isVisibleAgentSessionContext()) {
      return;
    }
    const loading = isAgentLoadingStatus(text);
    this.agentStatusEl?.setText(text);
    this.agentStatusEl?.toggleClass("is-loading", loading);
    this.agentLoadingEl?.toggleClass("is-hidden", !loading);
    if (this.agentLoadingTextEl) {
      this.agentLoadingTextEl.setText(text);
    }
  }

  private nextLocalAgentEntryId(role: AgentTranscriptRole): string {
    this.agentLocalMessageCounter += 1;
    return `local-${role}-${Date.now()}-${this.agentLocalMessageCounter}`;
  }

  private async insertCurrentNoteReferenceIntoAgent() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active note to reference.");
      return;
    }

    this.insertAgentInputText(`${formatVaultFileReference(file.path)} `);
  }

  private insertAgentInputText(text: string) {
    if (!this.agentInputEl) {
      return;
    }

    const start = this.agentInputEl.selectionStart ?? this.agentInputEl.value.length;
    const end = this.agentInputEl.selectionEnd ?? this.agentInputEl.value.length;
    this.agentInputEl.value = `${this.agentInputEl.value.slice(0, start)}${text}${this.agentInputEl.value.slice(end)}`;
    const cursor = start + text.length;
    this.agentInputEl.setSelectionRange(cursor, cursor);
    this.agentInputEl.focus();
  }

  private createTerminal(container: HTMLElement) {
    container.empty();
    container.createDiv({
      cls: "vault-terminal-removed",
      text: "Raw terminal has been removed. Use Agent Console instead."
    });
  }

  private handleShiftEnter(event: KeyboardEvent): boolean {
    if (!isEnterKey(event) || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }

    if (!this.markShiftEnterHandled(event)) {
      this.consumeKeyboardEvent(event);
      return true;
    }

    const mode = this.plugin.settings.shiftEnterMode;
    if (mode === "xterm-paste") {
      this.terminal?.paste("\n");
    } else if (mode === "claude-backslash") {
      this.sendDelayedShiftEnterSequence(mode);
    } else {
      this.sendHostMessage({ type: "data", data: SHIFT_ENTER_SEQUENCES[mode] });
    }
    this.consumeKeyboardEvent(event);
    return true;
  }

  private sendDelayedShiftEnterSequence(mode: Exclude<ShiftEnterMode, "xterm-paste">) {
    const timer = window.setTimeout(() => {
      this.pendingShiftEnterTimers.delete(timer);
      this.sendHostMessage({ type: "data", data: SHIFT_ENTER_SEQUENCES[mode] });
    }, CLAUDE_BACKSLASH_NEWLINE_DELAY_MS);
    this.pendingShiftEnterTimers.add(timer);
  }

  private markShiftEnterHandled(event: KeyboardEvent): boolean {
    if (this.handledShiftEnterEvents.has(event)) {
      return false;
    }

    this.handledShiftEnterEvents.add(event);
    const now = Date.now();
    if (now - this.lastShiftEnterAt < 80) {
      return false;
    }

    this.lastShiftEnterAt = now;
    return true;
  }

  private handleClaudeSuggestionEnter(event: KeyboardEvent): boolean {
    if (!isEnterKey(event) || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }

    if (this.handledClaudeSuggestionEnterEvents.has(event)) {
      this.consumeKeyboardEvent(event);
      return true;
    }

    const suggestion = this.getVisibleClaudeSuggestion() ?? this.getCachedClaudeSuggestion();
    if (!suggestion) {
      return false;
    }

    this.handledClaudeSuggestionEnterEvents.add(event);
    this.consumeKeyboardEvent(event);
    this.clearCachedClaudeSuggestion(true);
    this.sendHostMessage({ type: "data", data: `${suggestion}\r` });
    return true;
  }

  private getVisibleClaudeSuggestion(): string | null {
    const terminal = this.terminal;
    if (!terminal) {
      return null;
    }

    const buffer = terminal.buffer.active;
    const cursorLine = Math.min(buffer.baseY + buffer.cursorY, buffer.length - 1);
    const firstLine = Math.max(0, cursorLine - CLAUDE_SUGGESTION_SCAN_LINES);

    for (let lineIndex = cursorLine; lineIndex >= firstLine; lineIndex -= 1) {
      const logicalLine = getLogicalBufferLineText(buffer, lineIndex);
      const suggestion = extractClaudeTrySuggestion(logicalLine);
      if (suggestion) {
        return suggestion;
      }

      if (!isClaudeSuggestionNeutralLine(logicalLine)) {
        break;
      }
    }

    return null;
  }

  private rememberClaudeSuggestionFromOutput(data: string) {
    const plainText = stripTerminalControlSequences(data);
    if (!plainText) {
      return;
    }

    this.claudeSuggestionOutputTail = `${this.claudeSuggestionOutputTail}${plainText}`.slice(-CLAUDE_SUGGESTION_OUTPUT_TAIL_MAX);
    const suggestion = extractClaudeTrySuggestion(this.claudeSuggestionOutputTail);
    if (!suggestion) {
      return;
    }

    this.cachedClaudeSuggestion = suggestion;
    this.cachedClaudeSuggestionAt = Date.now();
  }

  private getCachedClaudeSuggestion(): string | null {
    if (!this.cachedClaudeSuggestion) {
      return null;
    }

    if (Date.now() - this.cachedClaudeSuggestionAt > CLAUDE_SUGGESTION_CACHE_TTL_MS) {
      this.clearCachedClaudeSuggestion(true);
      return null;
    }

    return this.cachedClaudeSuggestion;
  }

  private clearCachedClaudeSuggestion(clearOutputTail = false) {
    this.cachedClaudeSuggestion = null;
    this.cachedClaudeSuggestionAt = 0;
    if (clearOutputTail) {
      this.claudeSuggestionOutputTail = "";
    }
  }

  private consumeKeyboardEvent(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  private handleGlobalTerminalKeydown(event: KeyboardEvent) {
    // The Agent composer textarea has its own Enter / Shift+Enter handling.
    // Never let the terminal-global capture handler intercept its keys, or
    // Shift+Enter gets consumed instead of inserting a newline.
    if (this.agentInputEl && event.target === this.agentInputEl) {
      return;
    }
    if (this.isTerminalEventTarget(event)) {
      if (this.handleShiftEnter(event)) {
        return;
      }

      this.handleClaudeSuggestionEnter(event);
    }
  }

  private isTerminalEventTarget(event: KeyboardEvent): boolean {
    if (!this.terminalContainer) {
      return false;
    }

    const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (eventPath.includes(this.terminalContainer) || eventPath.includes(this.containerEl)) {
      return true;
    }

    const target = event.target;
    if (target instanceof Node && (this.terminalContainer.contains(target) || this.containerEl.contains(target))) {
      return true;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof Node && (this.terminalContainer.contains(activeElement) || this.containerEl.contains(activeElement))) {
      return true;
    }

    return this.app.workspace.getActiveViewOfType(VaultPowerShellView) === this;
  }

  private handleScrollKey(event: KeyboardEvent, terminal: Terminal): boolean {
    if (!event.shiftKey || !event.ctrlKey) {
      return false;
    }

    if (event.key === "PageUp") {
      terminal.scrollPages(-1);
      return true;
    }

    if (event.key === "PageDown") {
      terminal.scrollPages(1);
      return true;
    }

    if (event.key === "Home") {
      terminal.scrollToTop();
      return true;
    }

    if (event.key === "End") {
      terminal.scrollToBottom();
      return true;
    }

    if (event.key === "ArrowUp") {
      terminal.scrollLines(-3);
      return true;
    }

    if (event.key === "ArrowDown") {
      terminal.scrollLines(3);
      return true;
    }

    return false;
  }

  private handleTerminalWheel(event: WheelEvent, terminal: Terminal) {
    if (event.ctrlKey) {
      return;
    }

    const activeBuffer = terminal.buffer.active;
    if (activeBuffer.type === "alternate" && !event.shiftKey) {
      this.handleAlternateScreenWheel(event, terminal);
      return;
    }

    const lines = this.normalizeWheelLines(event, terminal);
    if (lines === 0) {
      return;
    }

    terminal.scrollLines(lines);
    terminal.focus();
    event.preventDefault();
    event.stopPropagation();
  }

  private normalizeWheelLines(event: WheelEvent, terminal: Terminal): number {
    const rawLines = getWheelRawLines(event, terminal);

    this.wheelLineAccumulator += rawLines;
    const lines = this.wheelLineAccumulator > 0
      ? Math.floor(this.wheelLineAccumulator)
      : Math.ceil(this.wheelLineAccumulator);

    this.wheelLineAccumulator -= lines;
    return lines;
  }

  private handleAlternateScreenWheel(event: WheelEvent, terminal: Terminal) {
    const steps = this.normalizeAlternateWheelSteps(event, terminal);
    if (steps === 0) {
      return;
    }

    const sequence = steps > 0 ? PAGE_DOWN_SEQUENCE : PAGE_UP_SEQUENCE;
    const count = Math.min(Math.abs(steps), 3);
    this.sendHostMessage({ type: "data", data: sequence.repeat(count) });
    terminal.focus();
    event.preventDefault();
    event.stopPropagation();
  }

  private normalizeAlternateWheelSteps(event: WheelEvent, terminal: Terminal): number {
    this.alternateWheelAccumulator += getWheelRawLines(event, terminal) / ALTERNATE_WHEEL_LINES_PER_PAGE_KEY;
    const steps = this.alternateWheelAccumulator > 0
      ? Math.floor(this.alternateWheelAccumulator)
      : Math.ceil(this.alternateWheelAccumulator);

    this.alternateWheelAccumulator -= steps;
    return steps;
  }

  private rewriteTerminalInput(data: string): string {
    if (!this.plugin.settings.codexDisableResizeReflow && !this.plugin.settings.codexNoAltScreen) {
      this.trackTerminalInput(data);
      return data;
    }

    let rewritten = "";
    for (const char of Array.from(data)) {
      if (char === "\r" || char === "\n") {
        rewritten += this.rewriteTerminalEnter(char);
        continue;
      }

      rewritten += char;
      this.trackTerminalInput(char);
    }

    return rewritten;
  }

  private rewriteTerminalEnter(newline: string): string {
    const line = this.inputLineReliable ? this.inputLineBuffer : "";
    const rewrittenLine = rewriteCodexCommand(line, {
      disableResizeReflow: this.plugin.settings.codexDisableResizeReflow,
      noAltScreen: this.plugin.settings.codexNoAltScreen
    });
    this.resetInputLineTracking();

    if (!rewrittenLine || rewrittenLine === line) {
      return newline;
    }

    return `${KILL_LINE_SEQUENCE}${rewrittenLine}${newline}`;
  }

  private trackTerminalInput(data: string) {
    for (const char of Array.from(data)) {
      if (char === "\r" || char === "\n") {
        this.resetInputLineTracking();
        continue;
      }

      if (char === "\x03") {
        this.resetInputLineTracking();
        continue;
      }

      if (char === "\x15") {
        this.inputLineBuffer = "";
        this.inputLineReliable = true;
        continue;
      }

      if (char === "\b" || char === "\x7f") {
        if (this.inputLineReliable) {
          this.inputLineBuffer = Array.from(this.inputLineBuffer).slice(0, -1).join("");
        }
        continue;
      }

      if (char === "\x1b" || char < " ") {
        this.inputLineReliable = false;
        continue;
      }

      if (this.inputLineReliable) {
        this.inputLineBuffer += char;
      }
    }
  }

  private resetInputLineTracking() {
    this.inputLineBuffer = "";
    this.inputLineReliable = true;
  }

  private refreshTerminalTheme() {
    if (!this.terminal || !this.terminalContainer) {
      return;
    }

    const terminalTheme = buildTerminalTheme(this.plugin.settings.terminalColorScheme);
    applyTerminalThemeVars(this.terminalContainer, terminalTheme);
    this.terminal.options.theme = { ...terminalTheme };
  }

  private startShell() {
    const cwd = this.plugin.getVaultPath();
    if (!cwd) {
      this.terminal?.writeln("This vault does not expose a local file-system path.");
      return;
    }

    const terminal = this.terminal;
    if (!terminal) {
      return;
    }

    this.fitTerminal();

    try {
      const missingRuntimeFiles = this.plugin.getRuntimeMissingFiles();
      if (missingRuntimeFiles.length > 0) {
        if (this.plugin.settings.autoInstallRuntime) {
          terminal.writeln("Obst Terminal runtime files are missing. Installing runtime...");
          void this.installRuntimeAndStartShell();
          return;
        }

        this.showRuntimePrompt(missingRuntimeFiles);
        terminal.writeln("Obst Terminal runtime files are missing.");
        terminal.writeln("Install the verified runtime package from this pane or from Settings > Obst Terminal.");
        return;
      }
      this.clearRuntimePrompt();

      const env = buildProcessEnv({
        useSystemCa: this.plugin.settings.useSystemCa,
        extraCaCertPath: this.plugin.getExtraCaCertPath()
      });
      const shellConfig = this.plugin.getShellLaunchConfig(cwd);
      const host = spawn(this.plugin.getNodeExecutable(), [this.plugin.getPtyHostPath(), encodeConfig({
        shell: shellConfig.shell,
        args: shellConfig.args,
        fallbackShells: this.plugin.getShellFallbacks(shellConfig.shell),
        cols: clampPtyCols(terminal.cols, 80),
        rows: clampPtyRows(terminal.rows, 24),
        cwd,
        env,
        windowsPtyBackend: this.plugin.settings.windowsPtyBackend
      })], {
        cwd: this.plugin.getPluginBasePath(),
        env,
        windowsHide: true
      });

      this.host = host;
      this.hostReady = false;
      this.lastSentResize = {
        cols: clampPtyCols(terminal.cols, 80),
        rows: clampPtyRows(terminal.rows, 24)
      };

      host.stdout.on("data", (chunk: Buffer) => {
        this.handleHostStdout(chunk.toString());
      });

      host.stderr.on("data", (chunk: Buffer) => {
        this.writeTerminalData(chunk.toString());
      });

      host.on("error", (error: Error) => {
        const message = formatTerminalHostError(error, this.plugin);
        terminal.writeln(`Failed to start terminal host: ${message}`);
        new Notice(`Failed to start terminal host: ${message}`);
        this.hostReady = false;
      });

      host.on("close", (code: number | null) => {
        terminal.writeln("");
        terminal.writeln(`[terminal host exited with code ${code ?? "unknown"}]`);
        this.host = null;
        this.hostReady = false;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      terminal.writeln(`Failed to start terminal: ${message}`);
      new Notice(`Failed to start terminal: ${message}`);
    }
  }

  private async installRuntimeAndStartShell() {
    try {
      await this.plugin.installRuntimeIfNeeded((message) => {
        this.terminal?.writeln(message);
      });
      this.clearRuntimePrompt();
      this.terminal?.clear();
      this.startShell();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.terminal?.writeln(`Runtime installation failed: ${message}`);
      this.showRuntimePrompt(this.plugin.getRuntimeMissingFiles());
    }
  }

  private showRuntimePrompt(missingFiles: string[]) {
    if (!this.terminalContainer || this.runtimePromptEl) {
      return;
    }

    const parent = this.terminalContainer.parentElement;
    if (!parent) {
      return;
    }

    const promptEl = parent.createDiv("vault-terminal-runtime-prompt");
    parent.insertBefore(promptEl, this.terminalContainer);

    promptEl.createEl("strong", { text: "Runtime installation required" });
    promptEl.createEl("p", {
      text: "Obst Terminal needs a native node-pty runtime package to start a local shell. The package is downloaded from this plugin's GitHub Release and verified with SHA-256 before installation."
    });

    const detailsEl = promptEl.createEl("details");
    detailsEl.createEl("summary", { text: "Missing files" });
    const listEl = detailsEl.createEl("ul");
    missingFiles.forEach((file) => {
      listEl.createEl("li", { text: file });
    });

    const actionsEl = promptEl.createDiv("vault-terminal-runtime-actions");
    const installButton = actionsEl.createEl("button", { text: "Install runtime" });
    const statusEl = actionsEl.createSpan("vault-terminal-runtime-status");

    installButton.addEventListener("click", () => {
      void this.installRuntimeFromPrompt(installButton, statusEl);
    });

    this.runtimePromptEl = promptEl;
  }

  private async installRuntimeFromPrompt(installButton: HTMLButtonElement, statusEl: HTMLElement) {
    installButton.disabled = true;
    try {
      await this.plugin.installRuntime((message) => {
        statusEl.setText(message);
      });
      statusEl.setText("Runtime installed. Starting terminal...");
      this.clearRuntimePrompt();
      this.terminal?.clear();
      this.startShell();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statusEl.setText(`Runtime installation failed: ${message}`);
      new Notice(`Runtime installation failed: ${message}`);
    } finally {
      installButton.disabled = false;
    }
  }

  private clearRuntimePrompt() {
    this.runtimePromptEl?.remove();
    this.runtimePromptEl = null;
  }

  private fitTerminal() {
    if (!this.terminal || !this.fitAddon) {
      return;
    }

    try {
      const dimensions = this.fitAddon.proposeDimensions();
      if (!dimensions) {
        return;
      }

      if (dimensions.cols < MIN_PTY_COLS || dimensions.rows < MIN_PTY_ROWS) {
        this.terminalContainer?.addClass("vault-terminal-too-narrow");
        this.terminal.refresh(0, Math.max(this.terminal.rows - 1, 0));
        return;
      }

      this.terminalContainer?.removeClass("vault-terminal-too-narrow");
      this.terminal.resize(dimensions.cols, dimensions.rows);
      this.sendResizeToHost(this.terminal.cols, this.terminal.rows);
      if (this.terminal.rows > 0) {
        this.terminal.refresh(0, this.terminal.rows - 1);
      }
    } catch {
      // xterm can throw while the Obsidian leaf is still measuring.
    }
  }

  private scheduleFitTerminal() {
    if (this.pendingFitFrame !== null) {
      return;
    }

    this.pendingFitFrame = requestAnimationFrame(() => {
      this.pendingFitFrame = null;
      this.fitTerminal();
    });
  }

  private scheduleTerminalFitStabilization() {
    if (!this.terminal) {
      return;
    }

    this.pendingFitTimers.forEach((timer) => window.clearTimeout(timer));
    this.pendingFitTimers.clear();

    TERMINAL_FIT_STABILIZATION_DELAYS_MS.forEach((delay) => {
      const timer = window.setTimeout(() => {
        this.pendingFitTimers.delete(timer);
        this.scheduleFitTerminal();
      }, delay);
      this.pendingFitTimers.add(timer);
    });
  }

  private scheduleTerminalRefresh() {
    if (!this.terminal || this.pendingRefreshFrame !== null) {
      return;
    }

    this.pendingRefreshFrame = requestAnimationFrame(() => {
      this.pendingRefreshFrame = null;
      if (!this.terminal || this.terminal.rows <= 0) {
        return;
      }

      this.terminal.refresh(0, this.terminal.rows - 1);
    });
  }

  private writeTerminalData(data: string) {
    const terminal = this.terminal;
    if (!terminal) {
      return;
    }

    const sanitized = this.plugin.settings.codexPreserveScrollback ? stripScrollbackClear(data) : data;
    const shouldFollowOutput = isTerminalScrolledToBottom(terminal);
    terminal.write(sanitized, () => {
      if (!this.terminal) {
        return;
      }

      this.scheduleFitTerminal();
      this.scheduleTerminalRefresh();
      if (shouldFollowOutput) {
        this.terminal.scrollToBottom();
      }
    });
  }

  private sendResizeToHost(cols: number, rows: number) {
    const resize = {
      cols: clampPtyCols(cols),
      rows: clampPtyRows(rows)
    };

    if (this.lastSentResize?.cols === resize.cols && this.lastSentResize.rows === resize.rows) {
      return;
    }

    this.lastSentResize = resize;
    this.sendHostMessage({
      type: "resize",
      cols: resize.cols,
      rows: resize.rows
    });
  }

  private handleCopyPasteShortcut(event: KeyboardEvent, terminal: Terminal): boolean {
    if (isTerminalCopyShortcut(event, terminal)) {
      this.consumeKeyboardEvent(event);
      this.copySelection();
      return true;
    }

    if (isTerminalPasteShortcut(event)) {
      if (this.pasteImageFromSystemClipboard()) {
        this.consumeKeyboardEvent(event);
        return true;
      }

      const text = clipboard.readText();
      if (!text) {
        return false;
      }

      this.consumeKeyboardEvent(event);
      this.pasteTerminalText(text);
      return true;
    }

    return false;
  }

  private copySelection(): boolean {
    const selection = this.terminal?.getSelection();
    if (!selection) {
      return false;
    }

    void writeClipboardText(selection);
    this.terminal?.clearSelection();
    return true;
  }

  private pasteFromSystemClipboard(): boolean {
    if (this.pasteImageFromSystemClipboard()) {
      return true;
    }

    const text = clipboard.readText();
    if (!text) {
      return false;
    }

    this.pasteTerminalText(text);
    return true;
  }

  private showTerminalContextMenu(event: MouseEvent, terminal: Terminal) {
    event.preventDefault();
    event.stopPropagation();

    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle("Copy")
        .setIcon("copy")
        .setDisabled(!terminal.hasSelection())
        .onClick(() => {
          this.copySelection();
        });
    });
    menu.addItem((item) => {
      item
        .setTitle("Paste")
        .setIcon("clipboard-paste")
        .setDisabled(!clipboard.readText() && !hasSystemClipboardImage())
        .onClick(() => {
          this.pasteFromSystemClipboard();
        });
    });
    menu.showAtMouseEvent(event);
  }

  private handleTerminalPaste(event: ClipboardEvent) {
    const imageFile = getClipboardImageFile(event.clipboardData);
    if (imageFile) {
      this.consumeClipboardEvent(event);
      void this.insertClipboardImage(imageFile);
      return;
    }

    if (this.pasteImageFromSystemClipboard()) {
      this.consumeClipboardEvent(event);
      return;
    }

    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text) {
      return;
    }

    this.consumeClipboardEvent(event);
    this.pasteTerminalText(text);
  }

  private consumeClipboardEvent(event: ClipboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  private pasteTerminalText(text: string) {
    const data = formatTerminalPasteData(text);
    this.sendTerminalInput(data);
  }

  private pasteImageFromSystemClipboard(): boolean {
    const imageBytes = readSystemClipboardImageBytes();
    if (!imageBytes) {
      return false;
    }

    void this.insertClipboardImageBytes(imageBytes, "png", "clipboard");
    return true;
  }

  private async insertClipboardImage(imageFile: File) {
    try {
      const imageBytes = new Uint8Array(await imageFile.arrayBuffer());
      const extension = getExtensionFromFile(imageFile);
      const label = sanitizeFileStem(imageFile.name || "clipboard");
      await this.insertClipboardImageBytes(imageBytes, extension, label);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to paste into Obst Terminal: ${message}`);
    }
  }

  private async insertClipboardImageBytes(imageBytes: Uint8Array, extension: string, label: string) {
    try {
      const path = await this.plugin.saveAttachmentBytes(imageBytes, extension, label);
      this.insertTerminalText(`${formatVaultFileReference(path)} `);
      new Notice(`Inserted clipboard image: ${path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to paste into Obst Terminal: ${message}`);
    }
  }

  private handleTerminalDragOver(event: DragEvent) {
    if (!event.dataTransfer) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    this.terminalContainer?.addClass("vault-terminal-drop-target");
  }

  private async handleTerminalDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.terminalContainer?.removeClass("vault-terminal-drop-target");

    try {
      const references = await this.getDropReferences(event.dataTransfer);
      if (references.length === 0) {
        new Notice("No file paths were found in the dropped item.");
        return;
      }

      this.insertTerminalText(`${references.join(" ")} `);
      new Notice(`Inserted ${references.length} file reference${references.length === 1 ? "" : "s"}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to insert dropped file: ${message}`);
    }
  }

  private async getDropReferences(dataTransfer: DataTransfer | null): Promise<string[]> {
    if (!dataTransfer) {
      return [];
    }

    const references: string[] = [];
    const seen = new Set<string>();

    for (const file of Array.from(dataTransfer.files)) {
      const localPath = getDataTransferFilePath(file);
      if (localPath) {
        const reference = this.formatLocalPathReference(localPath);
        if (!seen.has(reference)) {
          references.push(reference);
          seen.add(reference);
        }
        continue;
      }

      if (file.type.startsWith("image/")) {
        const extension = getExtensionFromFile(file);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const vaultPath = await this.plugin.saveAttachmentBytes(bytes, extension, sanitizeFileStem(file.name || "dropped-image"));
        const reference = formatVaultFileReference(vaultPath);
        if (!seen.has(reference)) {
          references.push(reference);
          seen.add(reference);
        }
      }
    }

    for (const textPath of getDroppedTextPaths(dataTransfer)) {
      const reference = this.formatLocalPathReference(textPath);
      if (!seen.has(reference)) {
        references.push(reference);
        seen.add(reference);
      }
    }

    return references;
  }

  private formatLocalPathReference(localPath: string): string {
    const vaultRelativePath = this.plugin.getVaultRelativePath(localPath);
    return vaultRelativePath
      ? formatVaultFileReference(vaultRelativePath)
      : quoteTerminalPath(localPath);
  }

  insertTerminalText(text: string) {
    new Notice("Raw terminal has been removed. Use Agent Console instead.");
  }

  private sendTerminalInput(text: string) {
    this.clearCachedClaudeSuggestion(true);
    if (!this.host || !this.host.stdin.writable) {
      this.pendingInsertTexts.push(text);
      new Notice("Obst Terminal is not running yet. The reference will be inserted when the terminal starts.");
      return;
    }

    this.sendHostMessage({ type: "data", data: text });
    this.terminal?.focus();
  }

  private flushPendingInsertTexts() {
    if (!this.host || !this.hostReady || !this.host.stdin.writable || this.pendingInsertTexts.length === 0) {
      return;
    }

    const text = this.pendingInsertTexts.join("");
    this.pendingInsertTexts = [];
    this.sendHostMessage({ type: "data", data: text });
    this.terminal?.focus();
  }

  private disposeShell(kill = true) {
    if (!this.host) {
      return;
    }

    if (kill) {
      this.sendHostMessage({ type: "kill" });
      this.host.kill();
    }

    this.host = null;
    this.hostReady = false;
    this.hostStdoutBuffer = "";
    this.clearCachedClaudeSuggestion(true);
    this.lastSentResize = null;
    this.wheelLineAccumulator = 0;
    this.alternateWheelAccumulator = 0;
    this.resetInputLineTracking();
  }

  private disposeAgent(kill = true) {
    if (this.agentReadyTimer !== null) {
      window.clearTimeout(this.agentReadyTimer);
      this.agentReadyTimer = null;
    }
    if (this.agentOutputIdleTimer !== null) {
      window.clearTimeout(this.agentOutputIdleTimer);
      this.agentOutputIdleTimer = null;
    }
    if (this.codexDeltaFlushTimer !== null) {
      window.clearTimeout(this.codexDeltaFlushTimer);
      this.codexDeltaFlushTimer = null;
    }
    this.cancelCodexTurnCompletionFallback();
    if (this.codexScrollFrame !== null) {
      window.cancelAnimationFrame(this.codexScrollFrame);
      this.codexScrollFrame = null;
    }
    if (this.codexStatusLineFrame !== null) {
      window.cancelAnimationFrame(this.codexStatusLineFrame);
      this.codexStatusLineFrame = null;
    }
    this.stopAgentSessionPolling();

    if (this.agentBackend) {
      this.agentBackendUnsubscribe?.();
      this.agentBackendUnsubscribe = null;
      void this.agentBackend.stop();
      this.agentBackend = null;
    }
    this.codexItemEls.clear();
    this.codexDeltaBuffers.clear();
    this.codexApprovalEls.clear();
    this.codexCurrentTurnEl = null;
    this.codexCurrentAnswerEl = null;
    this.clearCodexTurnLoadingIndicators(this.codexTranscriptEl);
    this.codexTurnActive = false;
    this.codexQueuedInputs = [];
    this.updateSendButtonMode();
    this.codexContextPercent = null;
    this.codexRateLimitWindows = [];
    this.codexGitBranch = undefined;
    this.refreshCodexStatusLine();
    this.codexOptionsRow?.addClass("is-hidden");
    this.codexModels = [];
    this.codexPendingAttachments = [];
    this.renderAttachmentChips();

    if (this.agentHost && kill) {
      const pid = this.agentHost.pid;
      this.sendAgentHostMessage({ type: "kill" });
      // The PTY children (shell + claude/codex CLI) survive a plain node kill on
      // Windows — that is why claude processes piled up across reloads. Kill the
      // whole process tree so nothing is left behind.
      if (pid !== undefined && process.platform === "win32") {
        try {
          spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
        } catch {
          // best-effort cleanup
        }
      }
      this.agentHost.kill();
    }

    this.agentHost = null;
    this.agentHostReady = false;
    this.agentReadyForInput = false;
    this.agentStdoutBuffer = "";
    this.agentSessionPath = null;
    this.agentSessionOffset = 0;
    this.agentCurrentTurnStartedAt = 0;
    this.agentSessionBaselineOffsets.clear();
    this.agentClaudePrintTurnActive = false;
    this.agentSeenEntries.clear();
    this.agentLastRawNotice = "";
    this.agentAuthState = "idle";
    this.agentConversationReady = false;
    this.agentReadyNoticeShown = false;
    this.agentAutoLoginAttempted = false;
    this.agentAutoLoginPending = false;
    this.agentAutoMcpAttempted = false;
    this.agentMcpAuthInProgress = false;
    this.agentNeedsAuth = false;
    this.agentPromptState = null;
    this.agentOpenedExternalUrls.clear();
    this.refreshAgentPromptActions();
    this.setAgentStatus("Idle");
  }

  private sendHostMessage(message: HostInputMessage) {
    if (!this.host || !this.host.stdin.writable) {
      return;
    }

    if (message.type === "data" && !this.hostReady) {
      this.pendingInsertTexts.push(message.data);
      return;
    }

    this.host.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleHostStdout(chunk: string) {
    this.hostStdoutBuffer += chunk;

    while (true) {
      const newlineIndex = this.hostStdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = this.hostStdoutBuffer.slice(0, newlineIndex).trimEnd();
      this.hostStdoutBuffer = this.hostStdoutBuffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      try {
        const message = JSON.parse(line) as HostOutputMessage;
        if (message.type === "data") {
          this.rememberClaudeSuggestionFromOutput(message.data);
          this.writeTerminalData(message.data);
        } else if (message.type === "ready") {
          this.hostReady = true;
          this.scheduleTerminalFitStabilization();
          this.flushPendingInsertTexts();
        } else if (message.type === "exit") {
          this.terminal?.writeln("");
          this.terminal?.writeln(`[terminal exited with code ${message.exitCode ?? "unknown"}]`);
        } else if (message.type === "error") {
          this.terminal?.writeln(`Failed to start terminal: ${message.message}`);
        }
      } catch {
        this.writeTerminalData(line);
      }
    }
  }
}

class VaultPowerShellSettingTab extends PluginSettingTab {
  plugin: VaultPowerShellPlugin;

  constructor(app: App, plugin: VaultPowerShellPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Obst Terminal")
      .setHeading();

    new Setting(containerEl)
      .setName("Node executable")
      .setDesc("Used to run the PTY host process. VS Code extension bundled Node is not visible to Obsidian; install Node.js system-wide or set an absolute node path here.")
      .addText((text) =>
        text
          .setPlaceholder("auto")
          .setValue(this.plugin.settings.nodeExecutable)
          .onChange((value) => {
            this.plugin.settings.nodeExecutable = value.trim();
            void this.plugin.saveSettings();
          })
      );

    const runtimeMissingFiles = this.plugin.getRuntimeMissingFiles();
    const runtimeUpdateReasons = this.plugin.getRuntimeUpdateReasons();
    new Setting(containerEl)
      .setName("Runtime files")
      .setDesc(runtimeMissingFiles.length === 0
        ? (runtimeUpdateReasons.length === 0 ? "Runtime files are installed." : "Runtime files are installed. A runtime update is available.")
        : "Runtime files are missing. Install the verified OS-specific runtime package from GitHub Releases.")
      .addButton((button) =>
        button
          .setButtonText(getRuntimeActionLabel(runtimeMissingFiles.length, runtimeUpdateReasons.length))
          .onClick(() => {
            button.setDisabled(true);
            button.setButtonText("Installing...");
            void this.plugin.updateRuntimeFromUserAction()
              .then(() => {
                this.display();
              })
              .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                new Notice(`Runtime installation failed: ${message}`);
                button.setButtonText(getRuntimeActionLabel(runtimeMissingFiles.length, runtimeUpdateReasons.length));
                button.setDisabled(false);
              });
          })
      );

    new Setting(containerEl)
      .setName("Install runtime automatically")
      .setDesc("Optional. Downloads the verified OS-specific runtime package when the Claude Code control runtime is missing or out of date.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoInstallRuntime)
          .onChange((value) => {
            this.plugin.settings.autoInstallRuntime = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Attachment folder")
      .setDesc("Agent Console clipboard images and dropped image data without a local path are saved here before they are attached.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_ATTACHMENT_FOLDER)
          .setValue(this.plugin.settings.attachmentFolder)
          .onChange((value) => {
            this.plugin.settings.attachmentFolder = normalizeAttachmentFolder(value);
            void this.plugin.saveSettings();
          })
      );

    if (process.platform === "win32") {
      new Setting(containerEl)
        .setName("Windows PTY backend")
        .setDesc("Used only for the background Claude Code control process. ConPTY is the default on modern Windows.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("conpty", "ConPTY")
            .addOption("winpty", "winpty")
            .setValue(this.plugin.settings.windowsPtyBackend)
            .onChange((value) => {
              this.plugin.settings.windowsPtyBackend = normalizeWindowsPtyBackend(value);
              void this.plugin.saveSettings();
              new Notice("Restart the Claude Code agent to apply the PTY backend.");
            })
        );
    }

    new Setting(containerEl)
      .setName("Use system certificate store")
      .setDesc("Off by default. Enable only when a corporate TLS proxy requires Node CLIs to trust the OS certificate store.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useSystemCa)
          .onChange((value) => {
            this.plugin.settings.useSystemCa = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Extra CA certificate")
      .setDesc("Optional PEM file path for TLS inspection. Leave empty to auto-detect a shared PEM file, or use a relative path such as certs/extra-ca.pem.")
      .addText((text) =>
        text
          .setPlaceholder("auto")
          .setValue(this.plugin.settings.extraCaCertPath)
          .onChange((value) => {
            this.plugin.settings.extraCaCertPath = value.trim();
            void this.plugin.saveSettings();
          })
      );
  }
}

function tokenizeArgs(template: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  for (let index = 0; index < template.length; index += 1) {
    const char = template[index];
    if (char === "\\") {
      const next = template[index + 1];
      if (next && (next === "\\" || next === "'" || next === "\"" || /\s/.test(next))) {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }

    if ((char === "'" || char === "\"") && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (!quote && /\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

function buildProcessEnv(options: { useSystemCa: boolean; extraCaCertPath?: string | null }): { [key: string]: string | undefined } {
  const env: { [key: string]: string | undefined } = { ...process.env };

  addDefaultPathEntries(env);

  if (options.useSystemCa) {
    addNodeSystemCaOption(env);
  }

  addExtraCaCert(env, options.extraCaCertPath);
  return env;
}

function addDefaultPathEntries(env: { [key: string]: string | undefined }) {
  const pathKey = getPathKey(env);
  const delimiter = process.platform === "win32" ? ";" : ":";
  const existingPath = env[pathKey] ?? "";
  const pathEntries = existingPath.split(delimiter).filter(Boolean);
  const knownEntries = new Set(pathEntries.map((entry) => normalizePathEntry(entry)));
  const candidates = getDefaultPathCandidates();

  for (const candidate of candidates) {
    const normalized = normalizePathEntry(candidate);
    if (!knownEntries.has(normalized)) {
      pathEntries.push(candidate);
      knownEntries.add(normalized);
    }
  }

  env[pathKey] = pathEntries.join(delimiter);
}

function encodeConfig(config: PtyHostConfig): string {
  return Buffer.from(JSON.stringify(config), "utf8").toString("base64");
}

function addNodeSystemCaOption(env: { [key: string]: string | undefined }) {
  const nodeOptionsKey = Object.keys(env).find((key) => key.toLowerCase() === "node_options") ?? "NODE_OPTIONS";
  const current = env[nodeOptionsKey] ?? "";

  if (!current.includes("--use-system-ca")) {
    env[nodeOptionsKey] = current ? `${current} --use-system-ca` : "--use-system-ca";
  }
}

function addExtraCaCert(env: { [key: string]: string | undefined }, extraCaCertPath?: string | null) {
  if (!extraCaCertPath) {
    return;
  }

  env.NODE_EXTRA_CA_CERTS = extraCaCertPath;
  env.SSL_CERT_FILE = extraCaCertPath;
  env.REQUESTS_CA_BUNDLE = extraCaCertPath;
}

function getDefaultExtraCaCertCandidates(pluginBasePath: string): string[] {
  return [
    ...EXTRA_CA_ENV_VARS.map((name) => process.env[name]),
    ...getSharedExtraCaCertCandidates(),
    join(pluginBasePath, "certs", "extra-ca.pem")
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));
}

function getSharedExtraCaCertCandidates(): string[] {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (process.platform === "win32") {
    return [
      "C:\\certs\\extra-ca.pem",
      process.env.ProgramData ? join(process.env.ProgramData, "Obst Terminal", "extra-ca.pem") : undefined,
      process.env.ProgramData ? join(process.env.ProgramData, "Vault Terminal", "extra-ca.pem") : undefined,
      home ? join(home, ".obst-terminal", "extra-ca.pem") : undefined,
      home ? join(home, ".vault-terminal", "extra-ca.pem") : undefined,
      home ? join(home, ".config", "obst-terminal", "extra-ca.pem") : undefined,
      home ? join(home, ".config", "vault-terminal", "extra-ca.pem") : undefined
    ].filter((candidate): candidate is string => Boolean(candidate));
  }

  return [
    home ? join(home, ".config", "obst-terminal", "extra-ca.pem") : undefined,
    home ? join(home, ".config", "vault-terminal", "extra-ca.pem") : undefined,
    home ? join(home, ".obst-terminal", "extra-ca.pem") : undefined,
    home ? join(home, ".vault-terminal", "extra-ca.pem") : undefined,
    "/etc/obst-terminal/extra-ca.pem",
    "/etc/vault-terminal/extra-ca.pem"
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function formatTerminalHostError(error: Error, plugin: VaultPowerShellPlugin): string {
  const errno = error as NodeJS.ErrnoException;
  if (errno.code === "ENOENT") {
    const configuredNode = plugin.settings.nodeExecutable.trim();
    if (isAutoNodeSetting(configuredNode)) {
      return "Node.js was not found in the system PATH. Install Node.js system-wide, restart Obsidian, or set Settings > Obst Terminal > Node executable to an absolute node path. VS Code extension bundled Node is not visible to Obsidian.";
    }

    return `Node executable was not found: ${configuredNode}. Check Settings > Obst Terminal > Node executable, or leave it empty to use auto-detection.`;
  }

  return error.message;
}

function getRuntimePlatform(): RuntimePlatform | null {
  if (process.platform === "win32") {
    return "windows";
  }

  if (process.platform === "darwin") {
    return "macos";
  }

  if (process.platform === "linux") {
    return "linux";
  }

  return null;
}

function getRuntimeArch(): RuntimeArch | null {
  if (process.arch === "x64" ||
    process.arch === "arm64" ||
    process.arch === "arm" ||
    process.arch === "ia32") {
    return process.arch;
  }

  return null;
}

async function fetchJson<T>(url: string): Promise<T> {
  return await requestUrl({
    url,
    method: "GET",
    throw: true
  }).json as T;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const arrayBuffer = await requestUrl({
    url,
    method: "GET",
    throw: true
  }).arrayBuffer;
  return new Uint8Array(arrayBuffer);
}

function getReleaseAssetUrl(version: string, asset: string): string {
  return `https://github.com/${GITHUB_REPOSITORY}/releases/download/${version}/${encodeURIComponent(asset)}`;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function removeRuntimeFiles(pluginBasePath: string) {
  for (const relativePath of [
    "pty-host.js",
    RUNTIME_INFO_FILE,
    "node_modules/@homebridge/node-pty-prebuilt-multiarch"
  ]) {
    rmSync(join(pluginBasePath, ...relativePath.split("/")), { recursive: true, force: true });
  }
}

function getRuntimeRequiredRelativeFiles(): string[] {
  if (process.platform === "darwin" || process.platform === "linux") {
    return [...RUNTIME_BASE_REQUIRED_RELATIVE_FILES, ...RUNTIME_UNIX_REQUIRED_RELATIVE_FILES];
  }

  return RUNTIME_BASE_REQUIRED_RELATIVE_FILES;
}

function repairRuntimeFilePermissions(pluginBasePath: string): string[] {
  if (process.platform === "win32") {
    return [];
  }

  const issues: string[] = [];
  for (const relativePath of RUNTIME_UNIX_EXECUTABLE_RELATIVE_FILES) {
    const filePath = join(pluginBasePath, ...relativePath.split("/"));
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      chmodSync(filePath, 0o755);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`${filePath} (could not set executable permission: ${message})`);
    }
  }

  return issues;
}

function extractRuntimeArchive(archiveBytes: Uint8Array, pluginBasePath: string) {
  const entries = unzipSync(archiveBytes);
  const basePath = resolve(pluginBasePath);

  for (const [entryName, data] of Object.entries(entries)) {
    const normalizedName = normalizeArchiveEntryName(entryName);
    if (!normalizedName) {
      continue;
    }

    const targetPath = resolve(basePath, normalizedName);
    if (!isPathInside(basePath, targetPath)) {
      throw new Error(`Unsafe runtime archive path: ${entryName}`);
    }

    if (entryName.endsWith("/") || data.byteLength === 0 && normalizedName.endsWith("/")) {
      mkdirSync(targetPath, { recursive: true });
      continue;
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, Buffer.from(data));
  }
}

function normalizeArchiveEntryName(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, "/");
  if (!normalized || normalized === "/") {
    return null;
  }

  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) {
    throw new Error(`Unsafe runtime archive path: ${entryName}`);
  }

  const trimmed = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe runtime archive path: ${entryName}`);
  }

  return parts.join("/");
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const comparableBasePath = getComparableFsPath(basePath);
  const comparableTargetPath = getComparableFsPath(targetPath);
  const normalizedBase = comparableBasePath.endsWith(sep) ? comparableBasePath : `${comparableBasePath}${sep}`;
  return comparableTargetPath === comparableBasePath || comparableTargetPath.startsWith(normalizedBase);
}

function getComparableFsPath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

async function ensureVaultFolder(app: App, folderPath: string) {
  const normalized = normalizeAttachmentFolder(folderPath);
  const parts = normalized.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) {
      continue;
    }

    if (existing) {
      throw new Error(`Attachment folder path conflicts with an existing file: ${current}`);
    }

    await app.vault.createFolder(current);
  }
}

function normalizeAttachmentFolder(value: string | undefined): string {
  const normalized = normalizePath((value ?? "").trim() || DEFAULT_ATTACHMENT_FOLDER).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return DEFAULT_ATTACHMENT_FOLDER;
  }

  return normalized;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function formatAttachmentTimestamp(date: Date): string {
  const pad = (value: number, width = 2) => value.toString().padStart(width, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    "-",
    pad(date.getMilliseconds(), 3)
  ].join("");
}

function sanitizeFileStem(value: string): string {
  const stem = value
    .replace(/\.[^.\\/]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return stem || "attachment";
}

function sanitizeExtension(value: string): string {
  const extension = value.replace(/^\./, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return extension || "png";
}

function getExtensionFromFile(file: File): string {
  const nameExtension = file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1];
  if (nameExtension) {
    return sanitizeExtension(nameExtension);
  }

  if (file.type === "image/jpeg") {
    return "jpg";
  }

  if (file.type === "image/webp") {
    return "webp";
  }

  if (file.type === "image/gif") {
    return "gif";
  }

  return "png";
}

function getGeneralFileExtension(file: File): string {
  const nameExtension = file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1];
  if (nameExtension) {
    return sanitizeExtension(nameExtension);
  }
  return file.type.startsWith("image/") ? getExtensionFromFile(file) : "bin";
}

function isImageAttachmentFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
}

function appendAgentAttachmentPrompt(text: string, attachments: AgentAttachment[]): string {
  if (attachments.length === 0) {
    return text;
  }
  const attachmentText = attachments
    .map((attachment) => `- ${attachment.name ?? "attachment"}: ${attachment.path}`)
    .join("\n");
  const prefix = text.trim() ? `${text.trim()}\n\n` : "";
  return `${prefix}첨부 파일:\n${attachmentText}`;
}

function formatVaultFileReference(path: string): string {
  return `@${normalizePath(path).replace(/\\/g, "/")}`;
}

function formatTerminalPasteData(text: string): string {
  const normalized = text.replace(/\r\n|\r|\n/g, "\r");
  return hasLineBreak(text)
    ? `${BRACKETED_PASTE_START}${normalized}${BRACKETED_PASTE_END}`
    : normalized;
}

function formatAgentInteractiveInput(text: string): string {
  const normalized = text.replace(/\r\n|\n|\r/g, "\r");
  return normalized.endsWith("\r") ? normalized : `${normalized}\r`;
}

function hasLineBreak(text: string): boolean {
  return /\r|\n/.test(text);
}

function isElementScrolledNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= AGENT_TRANSCRIPT_BOTTOM_EPSILON_PX;
}

function truncateStart(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `[앞부분 ${text.length - maxChars}자 생략]\n${text.slice(-maxChars)}`;
}

function removeAgentThinkingIndicators(root: ParentNode | null | undefined): void {
  root?.querySelectorAll?.(".vault-agent-thinking").forEach((el) => el.remove());
}

function sanitizeAgentTranscriptHtml(html: string): string {
  if (!html || !html.includes("vault-agent-thinking")) {
    return html;
  }
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  removeAgentThinkingIndicators(wrapper);
  return wrapper.innerHTML;
}

function isTerminalCopyShortcut(event: KeyboardEvent, terminal: Terminal): boolean {
  const key = event.key.toLowerCase();
  if (key !== "c" || event.altKey) {
    return false;
  }

  if (process.platform === "darwin") {
    return event.metaKey && !event.ctrlKey && (event.shiftKey || terminal.hasSelection());
  }

  return event.ctrlKey && !event.metaKey && (event.shiftKey || terminal.hasSelection());
}

function isTerminalPasteShortcut(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  if (event.altKey) {
    return false;
  }

  if (key === "insert") {
    return event.shiftKey && !event.ctrlKey && !event.metaKey;
  }

  if (key !== "v") {
    return false;
  }

  if (process.platform === "darwin") {
    return event.metaKey && !event.ctrlKey;
  }

  return event.ctrlKey && !event.metaKey;
}

function quoteTerminalPath(path: string): string {
  const normalized = path.replace(/"/g, '\\"');
  return `"${normalized}"`;
}

function getDataTransferFilePath(file: File): string | null {
  const path = (file as File & { path?: string }).path;
  return path && path.trim() ? path : null;
}

function getClipboardImageFile(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) {
    return null;
  }

  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) {
      continue;
    }

    const file = item.getAsFile();
    if (file) {
      return file;
    }
  }

  return Array.from(clipboardData.files).find((file) => file.type.startsWith("image/")) ?? null;
}

function hasSystemClipboardImage(): boolean {
  try {
    const image = readSystemClipboardImage();
    return Boolean(image && !image.isEmpty());
  } catch {
    return false;
  }
}

function readSystemClipboardImageBytes(): Uint8Array | null {
  try {
    const image = readSystemClipboardImage();
    if (!image || image.isEmpty()) {
      return null;
    }

    const png = image.toPNG();
    return png.byteLength > 0 ? new Uint8Array(png) : null;
  } catch {
    return null;
  }
}

function readSystemClipboardImage(): ClipboardNativeImage | null {
  const imageClipboard = clipboard as ClipboardWithImage;
  return typeof imageClipboard.readImage === "function"
    ? imageClipboard.readImage()
    : null;
}

function getDroppedTextPaths(dataTransfer: DataTransfer): string[] {
  const text = dataTransfer.getData("text/plain");
  if (!text) {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => isLikelyDroppedPath(line))
    .map((line) => normalizeDroppedTextPath(line));
}

function isLikelyDroppedPath(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    value.startsWith("file://");
}

function normalizeDroppedTextPath(value: string): string {
  if (!value.toLowerCase().startsWith("file://")) {
    return value;
  }

  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname).replace(/^\/([a-z]:)/i, "$1");
  } catch {
    return value.replace(/^file:\/\//i, "");
  }
}

function getDefaultPathCandidates(): string[] {
  if (process.platform === "win32") {
    return [
      "C:\\Program Files\\PowerShell\\7",
      process.env.APPDATA ? `${process.env.APPDATA}\\npm` : undefined,
      process.env.USERPROFILE ? `${process.env.USERPROFILE}\\AppData\\Roaming\\npm` : undefined,
      process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\OpenAI\\Codex\\bin` : undefined,
      process.env.ProgramFiles ? `${process.env.ProgramFiles}\\nodejs` : undefined,
      "C:\\Program Files\\nodejs"
    ].filter((entry): entry is string => Boolean(entry));
  }

  const home = process.env.HOME;
  const unixPaths = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    home ? `${home}/.npm-global/bin` : undefined,
    home ? `${home}/.local/bin` : undefined
  ];

  return unixPaths.filter((entry): entry is string => Boolean(entry));
}

function getPathKey(env: { [key: string]: string | undefined }): string {
  if (process.platform === "win32") {
    return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
  }

  return Object.keys(env).find((key) => key === "PATH") ?? "PATH";
}

function normalizePathEntry(entry: string): string {
  return process.platform === "win32" ? entry.toLowerCase() : entry;
}

function firstExistingPath(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function getAutoShellCandidates(): string[] {
  if (process.platform === "win32") {
    return [DEFAULT_PWSH_PATH, WINDOWS_POWERSHELL_PATH, WINDOWS_CMD_PATH, WINDOWS_WSL_PATH, ...WINDOWS_GIT_BASH_PATHS]
      .filter((candidate) => existsSync(candidate));
  }

  if (process.platform === "darwin") {
    return [
      getUserShell(),
      ...["/bin/zsh", "/bin/bash", "/bin/sh"].filter((candidate) => existsSync(candidate)),
      ...MACOS_PWSH_PATHS.filter((candidate) => existsSync(candidate))
    ].filter((candidate): candidate is string => Boolean(candidate));
  }

  if (process.platform === "linux") {
    return [
      getUserShell(),
      ...["/bin/bash", "/bin/sh"].filter((candidate) => existsSync(candidate)),
      ...LINUX_PWSH_PATHS.filter((candidate) => existsSync(candidate))
    ].filter((candidate): candidate is string => Boolean(candidate));
  }

  return [getUserShell(), "pwsh"].filter((candidate): candidate is string => Boolean(candidate));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function getUserShell(): string | null {
  const shell = process.env.SHELL?.trim();
  return shell && existsSync(shell) ? shell : null;
}

function isPlatformIncompatiblePath(value: string): boolean {
  if (process.platform !== "win32" && /^[a-z]:[\\/]/i.test(value)) {
    return true;
  }

  if (process.platform === "win32" && /^\/(?!\/)/.test(value)) {
    return true;
  }

  return false;
}

function getWslLaunchConfig(vaultPath: string, distro: string): ShellLaunchConfig {
  const shell = existsSync(WINDOWS_WSL_PATH) ? WINDOWS_WSL_PATH : "wsl.exe";
  const status = getWslStatus(shell);
  if (!status.canLaunch) {
    throw new Error(status.message);
  }

  const distroArgs = distro ? ["-d", distro] : [];
  if (status.supportsCd) {
    return {
      shell,
      args: [...distroArgs, "--cd", toWslPath(vaultPath)]
    };
  }

  return {
    shell,
    args: [
      ...distroArgs,
      "sh",
      "-lc",
      `cd ${quoteShellArg(toWslPath(vaultPath))} && exec "\${SHELL:-/bin/bash}" -l`
    ]
  };
}

function getWslStatus(shell: string): { canLaunch: boolean; supportsCd: boolean; message: string } {
  const listResult = spawnSync(shell, ["--list", "--quiet"], {
    encoding: "buffer",
    timeout: WSL_CHECK_TIMEOUT_MS,
    windowsHide: true
  });
  const listOutput = decodeCommandOutput(listResult.stdout) || decodeCommandOutput(listResult.stderr);

  if (listResult.error) {
    return {
      canLaunch: false,
      supportsCd: false,
      message: `WSL could not be checked: ${listResult.error.message}. Install WSL and a Linux distribution first.`
    };
  }

  if (listResult.status !== 0) {
    return {
      canLaunch: false,
      supportsCd: false,
      message: "WSL is not ready to launch a Linux shell. Run `wsl --install -d Ubuntu`, restart Windows if requested, finish the Linux distribution setup, then select WSL again."
    };
  }

  const distroLines = listOutput
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, "").trim())
    .filter((line) => line.length > 0);
  if (distroLines.length === 0) {
    return {
      canLaunch: false,
      supportsCd: false,
      message: "WSL is installed, but no Linux distribution is registered. Run `wsl --install -d Ubuntu`, finish the first-run setup, then select WSL again."
    };
  }

  const helpResult = spawnSync(shell, ["--help"], {
    encoding: "buffer",
    timeout: WSL_CHECK_TIMEOUT_MS,
    windowsHide: true
  });
  const helpOutput = `${decodeCommandOutput(helpResult.stdout)}\n${decodeCommandOutput(helpResult.stderr)}`;
  return {
    canLaunch: true,
    supportsCd: helpOutput.includes("--cd"),
    message: ""
  };
}

function decodeCommandOutput(output: Buffer | string | null | undefined): string {
  if (!output) {
    return "";
  }

  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
  const hasNullBytes = buffer.some((byte) => byte === 0);
  return (hasNullBytes ? buffer.toString("utf16le") : buffer.toString("utf8")).replace(/\0/g, "");
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toWslPath(windowsPath: string): string {
  const normalized = windowsPath.replace(/\\/g, "/");
  const driveMatch = normalized.match(/^([a-zA-Z]):\/?(.*)$/);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = driveMatch[2] ? `/${driveMatch[2].replace(/^\/+/, "")}` : "";
    return `/mnt/${drive}${rest}`;
  }

  if (normalized.startsWith("//")) {
    return normalized;
  }

  return normalized || ".";
}

function isAutoShellSetting(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === "" || normalized === "pwsh.exe";
}

function isAutoShellArgsSetting(value: string): boolean {
  return value === "" || value.toLowerCase() === "-nologo";
}

function isAutoNodeSetting(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === "" || normalized === "node.exe" || normalized === "node";
}

function isPowerShellExecutable(shell: string): boolean {
  const executableName = shell.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
  return executableName === "pwsh" || executableName === "pwsh.exe" || executableName === "powershell.exe";
}

function getLogicalBufferLineText(buffer: TerminalBufferLike, lineIndex: number): string {
  let startLine = Math.max(0, lineIndex);
  while (startLine > 0 && buffer.getLine(startLine)?.isWrapped) {
    startLine -= 1;
  }

  let endLine = Math.min(buffer.length - 1, lineIndex);
  while (endLine + 1 < buffer.length && buffer.getLine(endLine + 1)?.isWrapped) {
    endLine += 1;
  }

  const parts: string[] = [];
  for (let currentLine = startLine; currentLine <= endLine; currentLine += 1) {
    parts.push(buffer.getLine(currentLine)?.translateToString(true) ?? "");
  }

  return parts.join("").trim();
}

function extractClaudeTrySuggestion(line: string): string | null {
  const normalized = line.replace(/\s+/g, " ").trim();
  const doubleQuotedMatches = Array.from(normalized.matchAll(/(?:^|[\s>›❯»|│┃╰╭])Try\s+["“]([^"”]+)["”]/gi));
  const singleQuotedMatches = Array.from(normalized.matchAll(/(?:^|[\s>›❯»|│┃╰╭])Try\s+'([^']+)'/gi));
  const quoted = [...doubleQuotedMatches, ...singleQuotedMatches]
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .at(-1);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }

  const partialDoubleQuoted = normalized.match(/(?:^|[\s>›❯»|│┃╰╭])Try\s+["“]([^"”]+)$/i);
  if (partialDoubleQuoted?.[1]?.trim()) {
    return partialDoubleQuoted[1].trim();
  }

  const partialSingleQuoted = normalized.match(/(?:^|[\s>›❯»|│┃╰╭])Try\s+'([^']+)$/i);
  if (partialSingleQuoted?.[1]?.trim()) {
    return partialSingleQuoted[1].trim();
  }

  const unquoted = normalized.match(/^(?:[>›❯»]\s*)?Try\s+(.+)$/i);
  return unquoted?.[1]?.trim() || null;
}

function isClaudeSuggestionNeutralLine(line: string): boolean {
  return line.trim() === "" || /^[>›❯»]\s*$/.test(line.trim());
}

interface CodexRewriteOptions {
  disableResizeReflow: boolean;
  noAltScreen: boolean;
}

function rewriteCodexCommand(line: string, options: CodexRewriteOptions): string | null {
  const match = line.match(/^(\s*)(codex(?:\.(?:cmd|ps1|exe))?)(\s.*)?$/i);
  if (!match) {
    return null;
  }

  const rest = match[3] ?? "";
  const injectedArgs: string[] = [];

  if (options.disableResizeReflow && !/tui\.terminal_resize_reflow\s*=\s*false/i.test(rest)) {
    injectedArgs.push("-c", CODEX_RESIZE_REFLOW_CONFIG);
  }

  if (options.noAltScreen && !/(^|\s)--no-alt-screen(\s|$)/i.test(rest) && !/tui\.alternate_screen\s*=\s*false/i.test(rest)) {
    injectedArgs.push("--no-alt-screen");
  }

  if (injectedArgs.length === 0) {
    return line;
  }

  return `${match[1]}${match[2]} ${injectedArgs.join(" ")}${rest}`;
}

function getWheelRawLines(event: WheelEvent, terminal: Terminal): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
    return event.deltaY / WHEEL_PIXELS_PER_LINE;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * terminal.rows;
  }

  return event.deltaY;
}

function isTerminalScrolledToBottom(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active;
  return buffer.viewportY >= buffer.baseY;
}

function stripScrollbackClear(data: string): string {
  // CSI 3J (ED parameter 3) erases the scrollback buffer, not the visible screen.
  // Codex repaints its inline TUI with ...[2J[3J... on every frame, so xterm.js wipes
  // earlier conversation each redraw. Removing only 3J leaves the visible output
  // byte-for-byte identical while letting scrollOnEraseInDisplay keep what [2J pushes
  // into scrollback. See openai/codex#14277 and #10331.
  return data.replace(/\x1b\[3J/g, "");
}

function getAgentProviderLabel(provider: AgentProvider): string {
  return provider === "claude" ? "Claude Code" : "Codex";
}

function isAgentDelegationAttempt(text: string): boolean {
  const trimmed = text.trim();
  const explicit = /^\/(?:send|to|delegate)\s+@/i.test(trimmed);
  const body = trimmed.replace(/^\/(?:send|to|delegate)\s+/i, "");
  const selector = body.match(/^@("[^"]*"?|\S*)/);
  const target = selector?.[1]?.replace(/^"|"$/g, "") ?? "";
  return explicit || /^@"/.test(body) || isKnownAgentDelegationTarget(target);
}

function normalizeAgentRouteToken(text: string): string {
  return text.trim().toLowerCase().replace(/^@/, "").replace(/\s+/g, "");
}

function isKnownAgentDelegationTarget(text: string): boolean {
  const target = normalizeAgentRouteToken(text);
  return target === "all" ||
    target === "others" ||
    target === "전체" ||
    target === "나머지" ||
    target === "codex" ||
    target === "코덱스" ||
    target === "claude" ||
    target === "claudecode" ||
    target === "클로드" ||
    target === "클로드코드";
}

function agentSessionMatchesDelegationTarget(session: AgentWorkspaceSessionState, targetText: string): boolean {
  const target = normalizeAgentRouteToken(targetText);
  if (!target) {
    return false;
  }

  const candidates = [
    session.agentSessionLabel,
    shortSessionId(session.agentSessionKey),
    session.claudeSessionId ? shortSessionId(session.claudeSessionId) : "",
    session.codexThreadId ? shortSessionId(session.codexThreadId) : ""
  ]
    .filter(Boolean)
    .map(normalizeAgentRouteToken);

  return candidates.some((candidate) =>
    candidate === target || (target.length >= 3 && candidate.startsWith(target))
  );
}

function formatDelegatedAgentPrompt(sourceLabel: string, message: string): string {
  return `[${sourceLabel}에서 전달된 지시]\n${message.trim()}`;
}

function formatDelegationDeliveryStatus(result: AgentDelegationDeliveryResult): string {
  if (result.status === "sent") {
    return `${getAgentProviderLabel(result.provider)}로 전달됨`;
  }
  if (result.status === "queued") {
    return `${getAgentProviderLabel(result.provider)} 대기열에 추가됨`;
  }
  return `실패${result.reason ? ` (${result.reason})` : ""}`;
}

function createAgentSessionKey(): string {
  return randomUUID();
}

function shortSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "session";
}

function createAgentSessionLabel(sessionKey: string): string {
  return `Agent ${shortSessionId(sessionKey)}`;
}

function createAgentViewSessionState(mode: AgentSessionMode): AgentViewSessionState {
  const session = createAgentWorkspaceSessionState(mode);
  return {
    agentSessions: [session],
    activeAgentSessionKey: session.agentSessionKey,
    agentSessionKey: session.agentSessionKey,
    agentSessionLabel: session.agentSessionLabel,
    agentSessionMode: session.agentSessionMode,
    agentProvider: session.agentProvider,
    activePane: "agent",
    claudeSessionId: session.claudeSessionId ?? undefined,
    codexThreadId: session.codexThreadId
  };
}

function normalizeAgentViewSessionState(value: unknown): AgentViewSessionState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<AgentViewSessionState>;
  const sessions = Array.isArray(candidate.agentSessions)
    ? candidate.agentSessions
      .map((session) => normalizeAgentWorkspaceSessionState(session))
      .filter((session): session is AgentWorkspaceSessionState => session !== null)
    : [];
  if (sessions.length === 0) {
    return null;
  }

  const activeKey = typeof candidate.activeAgentSessionKey === "string" &&
    sessions.some((session) => session.agentSessionKey === candidate.activeAgentSessionKey)
    ? candidate.activeAgentSessionKey
    : sessions[0].agentSessionKey;
  const activeSession = sessions.find((session) => session.agentSessionKey === activeKey) ?? sessions[0];
  return {
    agentSessions: sessions,
    activeAgentSessionKey: activeKey,
    agentSessionKey: activeSession.agentSessionKey,
    agentSessionLabel: activeSession.agentSessionLabel,
    agentSessionMode: activeSession.agentSessionMode,
    agentProvider: activeSession.agentProvider,
    activePane: candidate.activePane === "agent" || candidate.activePane === "terminal" ? candidate.activePane : "agent",
    claudeSessionId: activeSession.claudeSessionId ?? undefined,
    codexThreadId: activeSession.codexThreadId
  };
}

function createAgentWorkspaceSessionState(mode: AgentSessionMode): AgentWorkspaceSessionState {
  const sessionKey = createAgentSessionKey();
  const now = Date.now();
  return {
    agentSessionKey: sessionKey,
    agentSessionLabel: createAgentSessionLabel(sessionKey),
    agentSessionMode: mode,
    agentProvider: "claude",
    claudeSessionId: randomUUID(),
    claudeControlSessionId: null,
    codexThreadId: null,
    claudeTranscriptHtml: "",
    codexTranscriptHtml: "",
    claudeScrollTop: 0,
    codexScrollTop: 0,
    inputText: "",
    statusText: "Idle",
    createdAt: now,
    updatedAt: now
  };
}

function normalizeAgentWorkspaceSessionState(value: unknown): AgentWorkspaceSessionState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<AgentWorkspaceSessionState>;
  const key = typeof candidate.agentSessionKey === "string" && candidate.agentSessionKey.trim()
    ? candidate.agentSessionKey.trim()
    : createAgentSessionKey();
  const label = typeof candidate.agentSessionLabel === "string" && candidate.agentSessionLabel.trim()
    ? candidate.agentSessionLabel.trim()
    : createAgentSessionLabel(key);
  const mode = candidate.agentSessionMode === "isolated" || candidate.agentSessionMode === "legacy-latest"
    ? candidate.agentSessionMode
    : "isolated";
  const provider = candidate.agentProvider === "codex" || candidate.agentProvider === "claude"
    ? candidate.agentProvider
    : "claude";
  const now = Date.now();

  return {
    agentSessionKey: key,
    agentSessionLabel: label,
    agentSessionMode: mode,
    agentProvider: provider,
    claudeSessionId: typeof candidate.claudeSessionId === "string" && candidate.claudeSessionId.trim()
      ? candidate.claudeSessionId.trim()
      : randomUUID(),
    claudeControlSessionId: typeof candidate.claudeControlSessionId === "string" && candidate.claudeControlSessionId.trim()
      ? candidate.claudeControlSessionId.trim()
      : null,
    codexThreadId: typeof candidate.codexThreadId === "string" && candidate.codexThreadId.trim()
      ? candidate.codexThreadId.trim()
      : null,
    claudeTranscriptHtml: typeof candidate.claudeTranscriptHtml === "string" ? sanitizeAgentTranscriptHtml(candidate.claudeTranscriptHtml) : "",
    codexTranscriptHtml: typeof candidate.codexTranscriptHtml === "string" ? sanitizeAgentTranscriptHtml(candidate.codexTranscriptHtml) : "",
    claudeScrollTop: typeof candidate.claudeScrollTop === "number" ? candidate.claudeScrollTop : 0,
    codexScrollTop: typeof candidate.codexScrollTop === "number" ? candidate.codexScrollTop : 0,
    inputText: typeof candidate.inputText === "string" ? candidate.inputText : "",
    statusText: typeof candidate.statusText === "string" && candidate.statusText.trim() ? candidate.statusText : "Idle",
    createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : now
  };
}

function backendKindRole(kind: TranscriptItemKind): AgentTranscriptRole {
  switch (kind) {
    case "agentMessage":
    case "plan":
      return "assistant";
    case "userMessage":
      return "user";
    case "commandExecution":
    case "fileChange":
    case "webSearch":
    case "mcpToolCall":
      return "tool";
    default:
      return "system";
  }
}

function backendKindLabel(kind: TranscriptItemKind): string {
  switch (kind) {
    case "agentMessage":
      return "Codex";
    case "reasoning":
      return "Thinking";
    case "plan":
      return "Plan";
    case "commandExecution":
      return "Command";
    case "fileChange":
      return "File change";
    case "webSearch":
      return "Web search";
    case "mcpToolCall":
      return "Tool";
    default:
      return "System";
  }
}

function getTranscriptRoleLabel(role: AgentTranscriptRole): string {
  if (role === "assistant") {
    return "Agent";
  }

  if (role === "user") {
    return "You";
  }

  if (role === "tool") {
    return "Tool";
  }

  return "System";
}

function getAgentPromptModeLabel(mode: AgentPromptMode): string {
  if (mode === "menu") {
    return "Menu input";
  }

  if (mode === "confirmation") {
    return "Confirmation";
  }

  if (mode === "permission") {
    return "Permission prompt";
  }

  if (mode === "auth") {
    return "Login required";
  }

  if (mode === "auth-code") {
    return "Login code required";
  }

  if (mode === "mcp") {
    return "MCP connection";
  }

  if (mode === "continue") {
    return "Continue";
  }

  if (mode === "command") {
    return "Command prompt";
  }

  return "Agent prompt";
}

function isAgentLoadingStatus(text: string): boolean {
  return /checking|starting|fetching|downloading|installing|launching|in progress|waiting for response|receiving output/i.test(text);
}

function formatBackendStatus(state: AgentStatus, detail?: string): string {
  const labels: Record<AgentStatus, string> = {
    idle: "Idle",
    starting: "Starting Codex...",
    "checking-auth": "Checking Codex login...",
    "login-required": "Sign in required",
    "login-in-progress": "Codex login in progress",
    ready: "Codex ready",
    running: "Working...",
    "waiting-approval": "Waiting for approval",
    stopped: "Stopped",
    error: "Error"
  };
  const label = labels[state];
  return detail ? `${label} — ${detail}` : label;
}

async function readGitBranchAsync(cwd: string): Promise<string | null> {
  const result = await runCapturedCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd, process.env, 2000);
  if (result.timedOut || result.error || (result.exitCode !== 0 && result.exitCode !== null)) {
    return null;
  }
  return result.stdout.trim() || null;
}

function formatStatusPath(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/");
  const home = (process.env.USERPROFILE || process.env.HOME || "").replace(/\\/g, "/");
  if (home && (normalized === home || normalized.startsWith(`${home}/`))) {
    return `~${normalized.slice(home.length)}`;
  }
  return normalized;
}

function formatResetTime(value: number | null): string {
  if (value === null) {
    return "";
  }
  const resetMs = value < 10_000_000_000 ? value * 1000 : value;
  const deltaSeconds = Math.floor((resetMs - Date.now()) / 1000);
  if (deltaSeconds <= 0) {
    return "now";
  }
  if (deltaSeconds < 3600) {
    return `${Math.floor(deltaSeconds / 60)}m`;
  }
  if (deltaSeconds < 86400) {
    const hours = Math.floor(deltaSeconds / 3600);
    const minutes = Math.floor((deltaSeconds % 3600) / 60);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(deltaSeconds / 86400);
  const hours = Math.floor((deltaSeconds % 86400) / 3600);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

interface AgentLaunchOptions {
  claudeSessionId?: string;
  sessionName?: string;
}

function getAgentLaunchCommand(provider: AgentProvider, settings: PowerShellSettings, options: AgentLaunchOptions = {}): string {
  if (provider === "claude") {
    const sessionArgs = options.claudeSessionId
      ? ` --session-id ${options.claudeSessionId}${options.sessionName ? ` --name ${quoteShellArg(options.sessionName)}` : ""}`
      : " --continue";
    // --strict-mcp-config: ignore heavy global MCP servers (firebase 30s etc).
    // --permission-mode bypassPermissions: no file/command prompts (vault is the
    //   user's own folder; same trust as Codex full access).
    return `claude${sessionArgs} --strict-mcp-config --permission-mode bypassPermissions`;
  }

  // codex resume --last reopens the most recent interactive session (PTY path).
  return rewriteCodexCommand("codex resume --last", {
    disableResizeReflow: settings.codexDisableResizeReflow,
    noAltScreen: settings.codexNoAltScreen
  }) ?? "codex resume --last";
}

async function getAgentAuthCheck(provider: AgentProvider, cwd: string, env: { [key: string]: string | undefined }): Promise<AgentAuthCheck> {
  if (provider === "claude") {
    const result = await runCapturedCommand("claude", ["auth", "status", "--json"], cwd, env, 8000);
    return parseClaudeAuthCheck(result);
  }

  const result = await runCapturedCommand("codex", ["login", "status"], cwd, env, 8000);
  return parseCodexAuthCheck(result);
}

function parseClaudeAuthCheck(result: CapturedCommandResult): AgentAuthCheck {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const failure = getCapturedCommandFailure(result);
  const parsed = parseJsonObject(result.stdout) as {
    loggedIn?: boolean;
    authMethod?: string;
    email?: string;
    orgName?: string;
    subscriptionType?: string;
  } | null;

  if (parsed && parsed.loggedIn === true) {
    const pieces = [
      parsed.email ? `account ${parsed.email}` : "an authenticated account",
      parsed.subscriptionType ? `${parsed.subscriptionType} subscription` : "",
      parsed.orgName ? `org ${parsed.orgName}` : "",
      parsed.authMethod ? `method ${parsed.authMethod}` : ""
    ].filter(Boolean);
    return {
      checked: true,
      loggedIn: true,
      summary: `Claude Code 로그인 확인: ${pieces.join(", ")}. Claude 준비가 끝나면 대화를 시작할 수 있습니다.`
    };
  }

  if (parsed && parsed.loggedIn === false) {
    return {
      checked: true,
      loggedIn: false,
      summary: "Claude Code is not signed in. The agent console will open Claude and start /login automatically."
    };
  }

  if (/not logged in|login required|please run\s+\/login|invalid authentication/i.test(output)) {
    return {
      checked: true,
      loggedIn: false,
      summary: "Claude Code is not signed in. The agent console will open Claude and start /login automatically."
    };
  }

  return {
    checked: false,
    loggedIn: null,
    summary: `Claude Code login status could not be confirmed before launch.${failure ? ` ${failure}` : ""} The console will watch Claude output and start login if required.`,
    detail: output
  };
}

function parseCodexAuthCheck(result: CapturedCommandResult): AgentAuthCheck {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const failure = getCapturedCommandFailure(result);
  if (/logged in/i.test(output)) {
    return {
      checked: true,
      loggedIn: true,
      summary: `Codex 로그인 확인: ${output.replace(/\s+/g, " ")}. Codex 준비가 끝나면 대화를 시작할 수 있습니다.`
    };
  }

  if (/not logged in|login required|not authenticated|unauthorized/i.test(output) || result.exitCode === 1) {
    return {
      checked: true,
      loggedIn: false,
      summary: "Codex is not signed in. Use the Agent Console Login button or run codex login in an external terminal, then restart the agent console."
    };
  }

  return {
    checked: false,
    loggedIn: null,
    summary: `Codex login status could not be confirmed before launch.${failure ? ` ${failure}` : ""} The console will watch Codex output for login prompts.`,
    detail: output
  };
}

function getCapturedCommandFailure(result: CapturedCommandResult): string {
  if (result.timedOut) {
    return "The status command timed out.";
  }

  if (result.error) {
    return `The status command failed: ${result.error}.`;
  }

  if (result.exitCode !== 0 && result.exitCode !== null) {
    const output = `${result.stderr || result.stdout}`.trim();
    return `The status command exited with code ${result.exitCode}${output ? `: ${truncateStatusOutput(output)}` : "."}`;
  }

  return "";
}

function runClaudePrintCommand(
  prompt: string,
  cwd: string,
  env: { [key: string]: string | undefined },
  timeoutMs: number | null,
  options: { sessionId?: string; sessionName?: string } = {}
): Promise<CapturedCommandResult> {
  const args = [
    ...(options.sessionId ? ["--session-id", options.sessionId] : ["--continue"]),
    ...(options.sessionName ? ["--name", options.sessionName] : []),
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "text",
    "-p"
  ];
  return runCapturedCommand("claude", args, cwd, env, timeoutMs, `${prompt}\n`);
}

function formatClaudePrintOutput(result: CapturedCommandResult): string {
  const output = removeClaudeNoStdinWarning(stripTerminalControlSequences(`${result.stdout}\n${result.stderr}`)).trim();
  if (output) {
    return output;
  }

  if (result.timedOut) {
    return "Claude 응답 대기 시간이 초과되었습니다.";
  }

  if (result.error) {
    return `Claude 실행 실패: ${result.error}`;
  }

  if (result.exitCode !== 0 && result.exitCode !== null) {
    return `Claude가 응답 없이 종료되었습니다 (코드 ${result.exitCode}).`;
  }

  return "Claude가 빈 응답을 반환했습니다.";
}

function removeClaudeNoStdinWarning(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^Warning: no stdin data received in \d+s, proceeding without it\./i.test(line.trim()))
    .join("\n");
}

function parseJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
  }

  return null;
}

function truncateStatusOutput(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function runCapturedCommand(command: string, args: string[], cwd: string, env: { [key: string]: string | undefined }, timeoutMs: number | null, stdinText?: string): Promise<CapturedCommandResult> {
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child: ChildProcessWithoutNullStreams | null = null;
    let timeout: number | null = null;

    const finish = (result: Partial<CapturedCommandResult>) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
      resolvePromise({
        stdout,
        stderr,
        exitCode: result.exitCode ?? null,
        timedOut: result.timedOut ?? false,
        error: result.error
      });
    };

    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      timeout = window.setTimeout(() => {
        killCapturedCommandProcess(child);
        finish({ timedOut: true });
      }, timeoutMs);
    }

    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: process.platform === "win32",
        windowsHide: true
      });
    } catch (error) {
      finish({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    try {
      child.stdin.end(stdinText ?? "");
    } catch {
      // Captured commands in this plugin are non-interactive.
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) => {
      finish({ error: error.message });
    });
    child.on("close", (code: number | null) => {
      finish({ exitCode: code });
    });
  });
}

function killCapturedCommandProcess(child: ChildProcessWithoutNullStreams | null) {
  if (!child) {
    return;
  }

  try {
    if (process.platform === "win32" && child.pid !== undefined) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      return;
    }
  } catch {
    // Fall through to the plain kill path.
  }

  try {
    child.kill();
  } catch {
    // The command may already have exited.
  }
}

function findLatestAgentSessionFile(provider: AgentProvider, cwd: string, startedAt: number, sessionId?: string | null): string | null {
  const root = getAgentSessionRoot(provider);
  if (!root || !existsSync(root)) {
    return null;
  }

  // claude --continue resumes a session file that may be old (yesterday's
  // conversation), so a 30s lookback would miss it — scan the whole store for
  // claude and pick the newest match for this folder. codex keeps the window.
  const sinceMs = provider === "claude" ? 0 : startedAt - AGENT_SESSION_LOOKBACK_MS;
  const files = getRecentJsonlFiles(root, sinceMs);

  // If we launched with an explicit --session-id, read ONLY that file.
  if (sessionId) {
    const suffix = `${sessionId.toLowerCase()}.jsonl`;
    return files.find((file) => file.toLowerCase().endsWith(suffix)) ?? null;
  }

  for (const file of files) {
    if (agentSessionFileMatches(file, cwd)) {
      return file;
    }
  }

  return null;
}

function snapshotAgentSessionOffsets(provider: AgentProvider, cwd: string): Map<string, number> {
  const offsets = new Map<string, number>();
  const root = getAgentSessionRoot(provider);
  if (!root || !existsSync(root)) {
    return offsets;
  }

  const sinceMs = provider === "claude" ? 0 : Date.now() - AGENT_SESSION_LOOKBACK_MS;
  for (const file of getRecentJsonlFiles(root, sinceMs)) {
    if (!agentSessionFileMatches(file, cwd)) {
      continue;
    }

    const size = getFileSize(file);
    if (size !== null) {
      offsets.set(normalizeSessionFileKey(file), size);
    }
  }

  return offsets;
}

function normalizeSessionFileKey(filePath: string): string {
  const resolved = resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function getAgentSessionRoot(provider: AgentProvider): string | null {
  const home = getUserHome();
  if (!home) {
    return null;
  }

  return provider === "claude"
    ? join(home, ".claude", "projects")
    : join(home, ".codex", "sessions");
}

function getRecentJsonlFiles(root: string, sinceMs: number): string[] {
  const files: { path: string; mtimeMs: number }[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        if (stats.mtimeMs >= sinceMs || current === root) {
          stack.push(fullPath);
        }
        continue;
      }

      if (stats.isFile() && entry.toLowerCase().endsWith(".jsonl") && stats.mtimeMs >= sinceMs) {
        files.push({ path: fullPath, mtimeMs: stats.mtimeMs });
      }
    }
  }

  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 50)
    .map((file) => file.path);
}

function agentSessionFileMatches(filePath: string, cwd: string): boolean {
  const expected = normalizeSessionSearchText(cwd);
  const pathText = normalizeSessionSearchText(filePath);
  if (pathText.includes(expected) || pathText.includes(sanitizeSessionPath(cwd))) {
    return true;
  }

  try {
    const prefix = readFilePrefix(filePath, AGENT_SESSION_MATCH_BYTES);
    return normalizeSessionSearchText(prefix).includes(expected);
  } catch {
    return false;
  }
}

function readFilePrefix(filePath: string, maxBytes: number): string {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function readFileTextFromOffset(filePath: string, offset: number): { text: string; nextOffset: number } | null {
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    return null;
  }

  if (stats.size <= offset) {
    return { text: "", nextOffset: stats.size };
  }

  // Always read FORWARD from offset (never rewind to the file tail). Cap each poll to
  // one chunk so a large backlog is caught up over several polls instead of dropping
  // its head. This removes the old `stats.size - MAX_READ_BYTES` sliding window that
  // silently skipped the start of big Codex/Claude session logs.
  const start = offset;
  const length = Math.min(stats.size - start, AGENT_SESSION_MAX_READ_BYTES);
  const reachedEof = start + length >= stats.size;
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, start);
    const chunk = buffer.subarray(0, bytesRead);
    const consumed = computeConsumedBytes(chunk, reachedEof);

    return {
      text: chunk.subarray(0, consumed).toString("utf8"),
      nextOffset: start + consumed
    };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function getFileSize(filePath: string): number | null {
  try {
    return statSync(filePath).size;
  } catch {
    return null;
  }
}

function computeConsumedBytes(chunk: Buffer, reachedEof: boolean): number {
  // At EOF the chunk ends on a complete line, so consume all of it.
  if (reachedEof) {
    return chunk.length;
  }

  // Otherwise the chunk may end mid-line. Stop after the last complete line so the
  // partial tail is re-read on the next poll instead of being parsed as broken JSON.
  const lastNewline = chunk.lastIndexOf(0x0a);
  if (lastNewline === -1) {
    // No newline at all: a single line is larger than the read cap. Consume everything
    // to keep making forward progress; that one oversized line may fail to parse.
    return chunk.length;
  }

  return lastNewline + 1;
}

function isAgentEntryAfterCutoff(entry: AgentTranscriptEntry, cutoffMs: number): boolean {
  if (!entry.timestampMs) {
    return false;
  }

  return entry.timestampMs >= cutoffMs - AGENT_SESSION_TURN_CUTOFF_SLOP_MS;
}

function parseAgentTranscriptEntries(provider: AgentProvider, text: string): AgentTranscriptEntry[] {
  const entries: AgentTranscriptEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      const entry = provider === "claude"
        ? parseClaudeTranscriptEntry(parsed)
        : parseCodexTranscriptEntry(parsed);
      if (entry) {
        entries.push(entry);
      }
    } catch {
      // Session logs are append-only. Ignore a partial final line until the next poll.
    }
  }

  return entries;
}

function extractAgentActionablePrompt(text: string): AgentPromptState | null {
  const normalized = normalizeAgentPromptText(text);
  const rawLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const controlLines = rawLines.filter((line) => isAgentControlPromptLine(line));
  const cueIndex = rawLines.findIndex((line) => isAgentPromptContextCue(line));
  const contextLines = cueIndex >= 0
    ? rawLines.slice(Math.max(0, cueIndex - 6), cueIndex + 12).filter((line) => isAgentPromptContextLine(line))
    : [];
  const promptTextCandidate = uniqueStrings([...contextLines, ...controlLines]).join("\n");
  const urls = extractHttpUrls(promptTextCandidate);
  const promptLines = uniqueStrings([...contextLines, ...controlLines])
    .filter((line) => !isNoisyAgentPromptLine(line) && !isAgentAuthCompletionLine(line) && !isAgentHookWarningLine(line))
    .slice(-16);

  if (promptLines.length === 0 && urls.length === 0) {
    return null;
  }

  const deduped = uniqueStrings(promptLines.length > 0 ? promptLines : urls).slice(-16);
  const promptText = deduped.join("\n");
  const mcpPrompt = isMcpAuthPrompt(promptText) || isMcpManagementPrompt(promptText);
  const requiresAuth = !mcpPrompt && isAgentLoginPromptText(promptText, urls);
  const mode = getAgentPromptMode(promptText, requiresAuth);
  return {
    text: promptText,
    requiresAuth,
    mode,
    allowEmptySubmit: mode === "menu" || /press enter|hit enter|return to continue/i.test(promptText),
    urls,
    actions: getAgentPromptActions(mode, promptText, urls)
  };
}

function getAgentPromptMode(text: string, requiresAuth: boolean): AgentPromptMode {
  if (isMcpAuthPrompt(text) || isMcpManagementPrompt(text)) {
    return "mcp";
  }

  if (isAgentLoginCodePromptText(text)) {
    return "auth-code";
  }

  if (/esc to continue|press esc|hit esc/i.test(text)) {
    return "continue";
  }

  if (/select|choose|method|use .*arrow|arrow keys|↑|↓|❯|navigate/i.test(text)) {
    return "menu";
  }

  if (/allow|deny|approve|permission|trust/i.test(text)) {
    return "permission";
  }

  if (/yes\/no|y\/n|\[y\/n\]|\(y\/n\)|continue\?/i.test(text)) {
    return "confirmation";
  }

  if (/not recognized|not found|command not found/i.test(text)) {
    return "command";
  }

  return requiresAuth ? "auth" : "text";
}

function getAgentPromptActions(mode: AgentPromptMode, text: string, urls: string[]): AgentPromptAction[] {
  const actions: AgentPromptAction[] = [];
  const mcpPrompt = isMcpAuthPrompt(text) || isMcpManagementPrompt(text);
  const mcpNeedsAuth = hasMcpNeedsAuthenticationText(text);
  urls.forEach((url, index) => {
    const loginUrl = isAgentLoginUrl(url);
    const label = index === 0
      ? mcpPrompt
        ? mcpNeedsAuth ? "Open MCP connection link" : "Open MCP link"
        : loginUrl ? "Open login link" : "Open link"
      : `Open link ${index + 1}`;
    actions.push({
      kind: "open-url",
      label,
      url,
      description: url,
      keepPrompt: true
    });
    actions.push({
      kind: "copy-text",
      label: index === 0
        ? mcpPrompt
          ? mcpNeedsAuth ? "Copy MCP connection link" : "Copy MCP link"
          : loginUrl ? "Copy login link" : "Copy link"
        : `Copy link ${index + 1}`,
      text: url,
      description: url,
      keepPrompt: true
    });
  });

  if (mode === "auth-code") {
    actions.push({
      kind: "submit-clipboard",
      label: "Submit copied code",
      description: "Paste the browser login code from the clipboard into Claude."
    });
  }

  if (mode !== "auth-code" && !mcpPrompt && (mode === "auth" || isAgentLoginPromptText(text, urls))) {
    actions.push({ label: "/login", data: "/login\r", description: "Start the agent login flow." });
  }

  if (mcpPrompt) {
    if (isMcpAuthPrompt(text)) {
      actions.push({ label: "/mcp", data: "/mcp\r", description: "Open the MCP connection screen inside the agent." });
    }
    actions.push(
      { label: "Enter", data: "\r", description: "Open or accept the selected MCP connection item." },
      { label: "Down", data: ARROW_DOWN_SEQUENCE, description: "Move the MCP selection down.", keepPrompt: true },
      { label: "Up", data: ARROW_UP_SEQUENCE, description: "Move the MCP selection up.", keepPrompt: true },
      { label: "Esc", data: ESCAPE_SEQUENCE, description: "Close or cancel the MCP prompt if the CLI supports it." }
    );
  } else if (isMcpAuthPrompt(text)) {
    actions.push({ label: "/mcp", data: "/mcp\r", description: "Open the MCP connection screen inside the agent." });
  }

  if (mode === "menu") {
    const optionActions = extractNumberedPromptOptions(text);
    actions.push(
      { label: "Enter", data: "\r", description: "Accept the currently selected menu item." },
      { label: "Down", data: ARROW_DOWN_SEQUENCE, description: "Move the menu selection down.", keepPrompt: true },
      { label: "Up", data: ARROW_UP_SEQUENCE, description: "Move the menu selection up.", keepPrompt: true },
      ...optionActions
    );
  }

  if (mode === "confirmation" || mode === "permission") {
    actions.push(
      { label: "Yes", data: "y\r", description: "Answer yes." },
      { label: "No", data: "n\r", description: "Answer no." }
    );
  }

  if (/press enter|hit enter|return to continue/i.test(text) && !actions.some((action) => action.label === "Enter")) {
    actions.push({ label: "Enter", data: "\r", description: "Continue." });
  }

  if (mode === "continue") {
    actions.push({ label: "Continue", data: ESCAPE_SEQUENCE, description: "Continue past the current agent notice." });
  }

  if (mode === "menu" || mode === "permission" || mode === "confirmation" || mode === "auth-code" || mode === "continue") {
    actions.push({ label: "Esc", data: ESCAPE_SEQUENCE, description: "Cancel or continue the active prompt if the CLI supports it." });
  }

  return dedupeAgentPromptActions(actions);
}

function dedupeAgentPromptActions(actions: AgentPromptAction[]): AgentPromptAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = action.kind === "open-url"
      ? `open-url\u0000${action.url}`
      : action.kind === "copy-text"
        ? `copy-text\u0000${action.text}`
        : action.kind === "submit-clipboard"
          ? "submit-clipboard"
          : `input\u0000${action.label}\u0000${action.data}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractNumberedPromptOptions(text: string): AgentPromptAction[] {
  const actions: AgentPromptAction[] = [];
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^(?:[>❯›»*+-]\s*)?(?:\(?([1-9])\)?[.)]|([1-9])[:：])\s+(.{1,80})$/);
    const option = match?.[1] ?? match?.[2];
    const label = match?.[3]?.trim();
    if (!option || !label || /https?:\/\//i.test(label)) {
      continue;
    }

    actions.push({
      label: `${option}: ${truncatePromptActionLabel(label)}`,
      data: `${option}\r`,
      description: label
    });
  }

  return actions;
}

function truncatePromptActionLabel(value: string): string {
  return value.length > 24 ? `${value.slice(0, 21)}...` : value;
}

function normalizeAgentPromptText(text: string): string {
  return joinWrappedUrls(text)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[─━═]{3,}/g, "").trim())
    .filter(Boolean)
    .join("\n");
}

function joinWrappedUrls(text: string): string {
  let result = text.replace(/\r\n|\r/g, "\n");
  for (let index = 0; index < 5; index += 1) {
    const next = result.replace(/(https?:\/\/[^\s<>"`]+)\n\s*([A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)/g, "$1$2");
    if (next === result) {
      break;
    }
    result = next;
  }

  return result;
}

function isNoisyAgentPromptLine(line: string): boolean {
  return /^[-_*]{2,}$/.test(line) ||
    /^\? for shortcuts/i.test(line);
}

function isAgentControlPromptLine(line: string): boolean {
  const value = line.trim();
  if (!value || isNoisyAgentPromptLine(value) || isAgentAuthCompletionLine(value) || isAgentHookWarningLine(value)) {
    return false;
  }

  const urls = extractHttpUrls(value);
  if (urls.some((url) => isAgentLoginUrl(url) || isAgentAuthUrl(url))) {
    return true;
  }

  return /^>\s*\/login\b/i.test(value) ||
    /^\/login\b/i.test(value) ||
    /^login$/i.test(value) ||
    /^select login method\b/i.test(value) ||
    /^please run\s+\/login\b/i.test(value) ||
    /^api error:\s*401\b/i.test(value) ||
    /\b401 invalid authentication credentials\b/i.test(value) ||
    /^browser didn't open\b/i.test(value) ||
    /^paste code here\b/i.test(value) ||
    /\bpaste code\b/i.test(value) ||
    /^\s*(?:\d+\s+)?mcp servers? need auth\b/i.test(value) ||
    isMcpManagementPrompt(value) ||
    /^status\s*[:：].*\bconnected\b/i.test(value) ||
    /^auth\s*[:：].*\b(?:authenticated|unauthenticated)\b/i.test(value) ||
    /^url\s*[:：].*\/mcp\b/i.test(value) ||
    /^capabilities\s*[:：]/i.test(value) ||
    /^tools\s*[:：]\s*\d+\s+tools?\b/i.test(value) ||
    /^esc to continue$/i.test(value) ||
    /^(allow|deny|approve)\b/i.test(value) ||
    /\b(?:yes\/no|y\/n|\[y\/n\]|\(y\/n\))\b/i.test(value) ||
    isAgentCliCommandFailureLine(value);
}

function isAgentPromptContextCue(line: string): boolean {
  return isAgentControlPromptLine(line) ||
    isAgentLoginFlowText(line);
}

function isAgentPromptContextLine(line: string): boolean {
  const value = line.trim();
  if (!value || isNoisyAgentPromptLine(value) || isAgentAuthCompletionLine(value) || isAgentHookWarningLine(value)) {
    return false;
  }

  return isAgentControlPromptLine(value) ||
    extractHttpUrls(value).some((url) => isAgentLoginUrl(url) || isAgentAuthUrl(url)) ||
    /^(?:\(?[1-9]\)?[.)]|[1-9][:：])\s+/.test(value) ||
    /^manage mcp servers\b/i.test(value) ||
    /\bmcp server\b/i.test(value) ||
    /^user mcps\b/i.test(value) ||
    /^status\s*[:：].*\bconnected\b/i.test(value) ||
    /^auth\s*[:：].*\b(?:authenticated|unauthenticated)\b/i.test(value) ||
    /^url\s*[:：].*\/mcp\b/i.test(value) ||
    /^capabilities\s*[:：]/i.test(value) ||
    /^tools\s*[:：]\s*\d+\s+tools?\b/i.test(value) ||
    /^(?:view tools|re-authenticate|clear authentication|reconnect|disable)\b/i.test(value) ||
    /^claude\.ai\b/i.test(value) ||
    /^claude code can be used\b/i.test(value) ||
    /^use the url below\b/i.test(value);
}

function isAgentCliCommandFailureLine(line: string): boolean {
  if (isAgentHookWarningLine(line)) {
    return false;
  }

  return /(?:claude|codex).*?(?:command not found|not recognized|not found|ENOENT|spawn)/i.test(line);
}

function isAgentHookWarningLine(line: string): boolean {
  return /hook error|non-blocking status code|memrosetta-enforce-claude-code/i.test(line);
}

function hasAgentAuthSuccess(text: string): boolean {
  return /logged in|login successful|already logged in/i.test(text);
}

function hasAgentMcpAuthSuccess(text: string): boolean {
  return /mcp.*(?:authenticated|authorized|connected|login successful)|(?:authenticated|authorized|connected).*mcp/i.test(text);
}

function getMcpStartupFailureText(text: string): string | null {
  const normalized = normalizeAgentPromptText(text);
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const failureLine = lines.find((line) => isMcpStartupFailureLine(line));
  if (!failureLine) {
    return null;
  }

  return failureLine;
}

function isMcpStartupFailureLine(line: string): boolean {
  return /\bmcp\b.*(?:failed to start|startup failed|could not start|exited)/i.test(line) ||
    /environment variable\s+[A-Z_][A-Z0-9_]*\b.*\bmcp\b.*(?:not set|missing)/i.test(line);
}

function formatMcpStartupFailureNotice(text: string, providerLabel: string): string {
  const server = extractMcpServerName(text);
  const envVar = extractMcpEnvVarName(text);
  const target = server ? ` for \`${server}\`` : "";
  const envHelp = envVar
    ? `Set \`${envVar}\` in the environment that starts Obsidian, or disable that MCP server if you do not need it.`
    : "Set the missing environment variable in the environment that starts Obsidian, or disable that MCP server if you do not need it.";

  return `MCP configuration issue${target}:\n${text}\n\nThis is not a ${providerLabel} login problem. ${providerLabel} can continue, but that MCP tool is unavailable until its configuration is fixed.\n\n${envHelp}`;
}

function extractMcpServerName(text: string): string | null {
  return text.match(/MCP server [`'"]?([^`'"\s]+)[`'"]?/i)?.[1] ??
    text.match(/MCP client for [`'"]?([^`'"\s]+)[`'"]?/i)?.[1] ??
    null;
}

function extractMcpEnvVarName(text: string): string | null {
  return text.match(/environment variable\s+([A-Z_][A-Z0-9_]*)\b/i)?.[1] ?? null;
}

function isAgentLoginRequiredText(text: string): boolean {
  return /please run\s+\/login\b|api error:\s*401\b.*invalid authentication credentials|401 invalid authentication credentials/i.test(text);
}

function isAgentLoginFlowText(text: string): boolean {
  const urls = extractHttpUrls(text);
  return urls.some((url) => isAgentLoginUrl(url)) ||
    /^>\s*\/login\b/im.test(text) ||
    /^\/login\b/im.test(text) ||
    /^login$/im.test(text) ||
    /select login method|please run\s+\/login\b/i.test(text) ||
    /browser didn't open.*sign in|use the url below to sign in/i.test(text) ||
    (isAgentLoginCodePromptText(text) && /login|sign in/i.test(text));
}

function isAgentLoginPromptText(text: string, urls = extractHttpUrls(text)): boolean {
  return urls.some((url) => isAgentLoginUrl(url)) ||
    /^>\s*\/login\b/im.test(text) ||
    /^\/login\b/im.test(text) ||
    /^login$/im.test(text) ||
    /select login method|please run\s+\/login\b/i.test(text) ||
    /api error:\s*401\b.*invalid authentication credentials|401 invalid authentication credentials/i.test(text) ||
    /browser didn't open.*sign in|use the url below to sign in/i.test(text);
}

function isAgentLoginCodePromptText(text: string): boolean {
  return /paste code here|paste code|authorization code|verification code/i.test(text) &&
    /login|sign in|browser|claude\.com|claude\.ai|anthropic\.com|oauth|authorize/i.test(text);
}

function isAgentConversationReadyText(text: string): boolean {
  if (isAgentLoginRequiredText(text) || isAgentLoginFlowText(text)) {
    return false;
  }

  return hasAgentAuthSuccess(text) ||
    isMcpAuthPrompt(text) ||
    /\? for shortcuts|bypass permissions|opus .*defaults|claude code\b/i.test(text);
}

function getTextAfterLastAgentAuthSuccess(text: string): string {
  const lines = text.split(/\r?\n/);
  let lastSuccessIndex = -1;
  lines.forEach((line, index) => {
    if (hasAgentAuthSuccess(line)) {
      lastSuccessIndex = index;
    }
  });

  return lastSuccessIndex >= 0 ? lines.slice(lastSuccessIndex + 1).join("\n") : text;
}

function isAgentAuthCompletionLine(line: string): boolean {
  return hasAgentAuthSuccess(line) || /login interrupted|login cancelled|login canceled/i.test(line);
}

function isMcpAuthPrompt(text: string): boolean {
  return text.split(/\r?\n/).some((line) => /^\s*(?:\d+\s+)?mcp servers? need auth\b/i.test(line.trim()));
}

function isMcpManagementPrompt(text: string): boolean {
  return text.split(/\r?\n/).some((line) => {
    const value = line.trim();
    return /^manage mcp servers\b/i.test(value) ||
      /\bmcp server\b/i.test(value) ||
      /^user mcps\b/i.test(value) ||
      /^>\s+.*connected\s+.*tools\b/i.test(value) ||
      /^status\s*[:：].*\bconnected\b/i.test(value) ||
      /^auth\s*[:：].*\b(?:authenticated|unauthenticated)\b/i.test(value) ||
      /^url\s*[:：].*\/mcp\b/i.test(value) ||
      /^capabilities\s*[:：]/i.test(value) ||
      /^tools\s*[:：]\s*\d+\s+tools?\b/i.test(value) ||
      /^(?:view tools|re-authenticate|clear authentication|reconnect|disable)\b/i.test(value) ||
      extractHttpUrls(value).some((url) => isMcpHelpUrl(url)) ||
      /^(?:plugin:[\w.-]+:[\w.-]+|claude\.ai\b.*)\s+[-:·]?\s*.*needs authentication\b/i.test(value) ||
      /\bmcp\b.*needs authentication\b/i.test(value);
  });
}

function hasMcpNeedsAuthenticationText(text: string): boolean {
  return isMcpAuthPrompt(text) ||
    text.split(/\r?\n/).some((line) => {
      const value = line.trim();
      return /^auth\s*[:：].*\bunauthenticated\b/i.test(value) ||
        /needs authentication\b/i.test(value);
    });
}

function looksLikeAgentAuthCode(text: string): boolean {
  const value = text.trim();
  return value.length >= 8 &&
    value.length <= 4096 &&
    !/^https?:\/\//i.test(value) &&
    /^[A-Za-z0-9._~+/=-]+$/.test(value);
}

function isAgentLoginUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if ((host === "platform.claude.com" || host === "console.anthropic.com") && isAuthPath(path)) {
    return true;
  }

  return isClaudeHost(host) && isAuthPath(path);
}

function isAgentAuthUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  return parsed ? isAuthPath(parsed.pathname.toLowerCase()) : false;
}

function isMcpHelpUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  return isClaudeHost(host) && /\/docs\/[^?#]*\/mcp(?:\/|$)/i.test(path);
}

function isClaudeHost(host: string): boolean {
  return host === "claude.ai" ||
    host.endsWith(".claude.ai") ||
    host === "claude.com" ||
    host.endsWith(".claude.com") ||
    host === "anthropic.com" ||
    host.endsWith(".anthropic.com");
}

function isAuthPath(path: string): boolean {
  return /(?:^|\/)(?:api\/)?(?:oauth|login|authorize|authorization|auth|callback|consent)(?:\/|$)/i.test(path);
}

function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function extractHttpUrls(text: string): string[] {
  const joined = joinWrappedUrls(text);
  const matches = joined.match(/https?:\/\/[^\s<>"`]+/gi) ?? [];
  return uniqueStrings(matches.map((url) => trimUrlPunctuation(url)).filter(Boolean));
}

function trimUrlPunctuation(url: string): string {
  return url.replace(/[)\].,;:!?]+$/g, "");
}

function appendTextWithLinks(container: HTMLElement, text: string, openUrl: (url: string) => void) {
  const linkedText = joinWrappedUrls(text);
  const pattern = /https?:\/\/[^\s<>"`]+/gi;
  let cursor = 0;

  for (const match of linkedText.matchAll(pattern)) {
    const index = match.index ?? 0;
    const rawUrl = match[0];
    const url = trimUrlPunctuation(rawUrl);
    if (index > cursor) {
      container.createSpan({ text: linkedText.slice(cursor, index) });
    }

    const trailing = rawUrl.slice(url.length);
    const link = container.createEl("a", {
      cls: "vault-agent-link",
      text: url,
      attr: {
        href: url,
        target: "_blank",
        rel: "noopener"
      }
    });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openUrl(url);
    });

    if (trailing) {
      container.createSpan({ text: trailing });
    }
    cursor = index + rawUrl.length;
  }

  if (cursor < linkedText.length) {
    container.createSpan({ text: linkedText.slice(cursor) });
  }
}

function openExternalUrlWithSystemBrowser(url: string): boolean {
  try {
    const command = getExternalUrlOpenCommand(url);
    if (!command) {
      return false;
    }

    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function getExternalUrlOpenCommand(url: string): { command: string; args: string[] } | null {
  if (process.platform === "win32") {
    return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  }

  if (process.platform === "darwin") {
    return { command: "open", args: [url] };
  }

  if (process.platform === "linux") {
    return { command: "xdg-open", args: [url] };
  }

  return null;
}

function parseClaudeTranscriptEntry(value: unknown): AgentTranscriptEntry | null {
  const entry = value as {
    uuid?: string;
    type?: string;
    isMeta?: boolean;
    message?: {
      id?: string;
      role?: string;
      content?: unknown;
    };
    timestamp?: string;
  };

  if (entry.isMeta || !entry.message || entry.type === "user") {
    return null;
  }

  const role = entry.type === "assistant" || entry.message.role === "assistant" ? "assistant" : "tool";
  const text = extractClaudeContentText(entry.message.content);
  if (!text) {
    return null;
  }

  if (entry.type === "assistant" && text === "No response requested.") {
    return null;
  }

  return {
    id: entry.uuid ?? entry.message.id ?? `${entry.timestamp ?? ""}-${text.slice(0, 32)}`,
    role,
    text,
    timestampMs: parseSessionTimestampMs(entry.timestamp)
  };
}

function parseCodexTranscriptEntry(value: unknown): AgentTranscriptEntry | null {
  const entry = value as {
    timestamp?: string;
    type?: string;
    payload?: {
      type?: string;
      message?: string;
    };
  };

  if (entry.type !== "event_msg" || entry.payload?.type !== "agent_message") {
    return null;
  }

  const text = entry.payload.message?.trim();
  if (!text) {
    return null;
  }

  return {
    id: `${entry.timestamp ?? ""}-${text.slice(0, 32)}`,
    role: "assistant",
    text,
    timestampMs: parseSessionTimestampMs(entry.timestamp)
  };
}

function parseSessionTimestampMs(timestamp?: string): number | undefined {
  if (!timestamp) {
    return undefined;
  }

  const localKorean = timestamp.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(오전|오후)\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (localKorean) {
    const [, year, month, day, meridiem, rawHour, minute, second, millisecond] = localKorean;
    let hour = Number(rawHour);
    if (meridiem === "오전") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
    // Claude writes this localized shape as UTC without an explicit timezone.
    const parsed = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        hour,
        Number(minute),
        Number(second),
        Number((millisecond ?? "0").padEnd(3, "0"))
      )
    ).getTime();
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : undefined;
}

function isAgentSessionLimitText(text: string): boolean {
  return /hit your session limit|session limit.*resets|usage limit.*resets|rate limit.*resets/i.test(text);
}

function extractClaudeContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const pieces: string[] = [];
  for (const item of content) {
    const typed = item as { type?: string; text?: string; name?: string };
    if (typed.type === "text" && typed.text) {
      pieces.push(typed.text);
    } else if (typed.type === "tool_use" && typed.name) {
      // Surface tool activity so a long tool run isn't mistaken for a stall.
      pieces.push(`*🔧 ${typed.name}…*`);
    }
  }

  return pieces.join("\n\n").trim();
}

function normalizeSessionSearchText(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function sanitizeSessionPath(value: string): string {
  return normalizeSessionSearchText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function getUserHome(): string | null {
  return process.env.USERPROFILE ?? process.env.HOME ?? null;
}

function stripTerminalControlSequences(data: string): string {
  return expandTerminalHyperlinks(data)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()][A-Za-z0-9]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function expandTerminalHyperlinks(data: string): string {
  return data.replace(/\x1b]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)([\s\S]*?)\x1b]8;[^;]*;(?:\x07|\x1b\\)/g, (_match, url: string, label: string) => {
    const trimmedUrl = trimUrlPunctuation(url.trim());
    const trimmedLabel = label.trim();
    if (!trimmedUrl) {
      return label;
    }

    if (!trimmedLabel || trimmedLabel.includes(trimmedUrl)) {
      return trimmedUrl;
    }

    return `${trimmedLabel} ${trimmedUrl}`;
  });
}

function isEnterKey(event: KeyboardEvent): boolean {
  return event.key === "Enter" ||
    event.key === "Return" ||
    event.code === "Enter" ||
    event.code === "NumpadEnter";
}

function buildTerminalTheme(colorScheme: TerminalColorScheme): ITheme {
  const normalized = normalizeTerminalColorScheme(colorScheme);
  if (normalized === "light") {
    return { ...LIGHT_TERMINAL_THEME };
  }

  if (normalized === "obsidian") {
    return buildObsidianTerminalTheme();
  }

  return { ...DARK_TERMINAL_THEME };
}

function buildObsidianTerminalTheme(): ITheme {
  const base = isObsidianDarkTheme() ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;

  return {
    ...base,
    background: getCssVar("--background-primary", base.background ?? "#0c1016"),
    foreground: getCssVar("--text-normal", base.foreground ?? "#d8dee9"),
    cursor: getCssVar("--text-accent", base.cursor ?? "#ffffff"),
    selectionBackground: getCssVar("--text-selection", base.selectionBackground ?? "#2f5d7c")
  };
}

function applyTerminalThemeVars(container: HTMLElement, theme: ITheme) {
  container.style.setProperty("--vault-terminal-bg", theme.background ?? "#0c1016");
  container.style.setProperty("--vault-terminal-fg", theme.foreground ?? "#d8dee9");
  container.style.setProperty("--vault-terminal-scrollbar", theme.scrollbarSliderBackground ?? "rgba(216, 222, 233, 0.22)");
  container.style.setProperty("--vault-terminal-scrollbar-hover", theme.scrollbarSliderHoverBackground ?? "rgba(216, 222, 233, 0.36)");
}

function normalizeTerminalColorScheme(value: string | undefined): TerminalColorScheme {
  return value === "light" || value === "dark" || value === "obsidian" ? value : "obsidian";
}

function normalizeShellProfile(value: string | undefined): ShellProfile {
  if (value === "auto" ||
    value === "pwsh" ||
    value === "windows-powershell" ||
    value === "cmd" ||
    value === "wsl" ||
    value === "git-bash" ||
    value === "zsh" ||
    value === "bash" ||
    value === "custom") {
    return value;
  }

  return "auto";
}

function getShellProfileOptions(): Array<{ value: ShellProfile; label: string }> {
  if (process.platform === "win32") {
    return [
      { value: "auto", label: "Auto" },
      { value: "pwsh", label: "PowerShell 7" },
      { value: "windows-powershell", label: "Windows PowerShell" },
      { value: "cmd", label: "Command Prompt" },
      { value: "wsl", label: "WSL" },
      { value: "git-bash", label: "Git Bash" },
      { value: "custom", label: "Custom" }
    ];
  }

  if (process.platform === "darwin") {
    return [
      { value: "auto", label: "Auto" },
      { value: "zsh", label: "zsh" },
      { value: "bash", label: "bash" },
      { value: "pwsh", label: "PowerShell 7" },
      { value: "custom", label: "Custom" }
    ];
  }

  return [
    { value: "auto", label: "Auto" },
    { value: "bash", label: "bash" },
    { value: "zsh", label: "zsh" },
    { value: "pwsh", label: "PowerShell 7" },
    { value: "custom", label: "Custom" }
  ];
}

function normalizeShiftEnterMode(value: string | undefined): ShiftEnterMode {
  if (value === "bracketed-paste" ||
    value === "claude-backslash" ||
    value === "xterm-paste" ||
    value === "modified-enter" ||
    value === "csi-u" ||
    value === "line-feed") {
    return value;
  }

  return "claude-backslash";
}

function normalizeCodexApprovalPolicy(value: string | undefined): CodexApprovalPolicy {
  return value === "untrusted" || value === "on-failure" || value === "never"
    ? value
    : "on-request";
}

function normalizeCodexLoginMethod(value: string | undefined): CodexLoginMethod {
  return value === "device-code" ? "device-code" : "browser";
}

function normalizeWindowsPtyBackend(value: string | undefined): WindowsPtyBackend {
  return value === "winpty" ? "winpty" : "conpty";
}

function clampPtyCols(cols: number | undefined, fallback = MIN_PTY_COLS): number {
  return Math.max(Math.floor(cols || fallback), MIN_PTY_COLS);
}

function clampPtyRows(rows: number | undefined, fallback = MIN_PTY_ROWS): number {
  return Math.max(Math.floor(rows || fallback), MIN_PTY_ROWS);
}

function getRuntimeActionLabel(missingFileCount: number, updateReasonCount: number): string {
  if (missingFileCount > 0) {
    return "Install runtime";
  }

  if (updateReasonCount > 0) {
    return "Update runtime";
  }

  return "Reinstall runtime";
}

function isObsidianDarkTheme(): boolean {
  if (document.body.classList.contains("theme-dark")) {
    return true;
  }

  if (document.body.classList.contains("theme-light")) {
    return false;
  }

  const brightness = getColorBrightness(getCssVar("--background-primary", "#0c1016"));
  return brightness === null ? true : brightness < 128;
}

function getColorBrightness(color: string): number | null {
  const trimmed = color.trim();
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1];
    const parts = value.length === 3
      ? value.split("").map((part) => parseInt(part + part, 16))
      : [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].map((part) => parseInt(part, 16));
    return Math.round((parts[0] * 299 + parts[1] * 587 + parts[2] * 114) / 1000);
  }

  const rgb = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    return Math.round((r * 299 + g * 587 + b * 114) / 1000);
  }

  return null;
}

function getCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

async function writeClipboardText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    clipboard.writeText(text);
  }
}
