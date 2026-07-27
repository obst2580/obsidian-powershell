import {
  addIcon,
  App,
  FileSystemAdapter,
  ItemView,
  MarkdownView,
  MarkdownRenderer,
  Menu,
  Notice,
  normalizePath,
  Plugin,
  PluginSettingTab,
  requestUrl,
  setIcon,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf
} from "obsidian";
import { clipboard } from "electron";
import { unzipSync } from "fflate";
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { CodexAppServerBackend } from "./agent/codex/backend";
import type { AgentAccessLevel, AgentAttachment, AgentBackend, AgentModelInfo, AgentStatus, AgentUiEvent, AgentUsageWindow, ApprovalRequest, TokenUsage, TranscriptItem, TranscriptItemKind } from "./agent/types";
import { CompanyVoiceLexicon } from "./voice/company-lexicon";

type Terminal = any;
type ITheme = Record<string, string>;
type FitAddonLike = {
  proposeDimensions(): { cols: number; rows: number } | undefined;
};

const VIEW_TYPE_POWERSHELL = "vault-powershell";
const GITHUB_REPOSITORY = "obst2580/obsidian-powershell";
const RUNTIME_INFO_FILE = "runtime.json";
const RUNTIME_MANIFEST_FILE = "runtime-manifest.json";
const AGENT_PROCESS_REGISTRY_FILE = "agent-processes.json";
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
const GEMINI_ICON_PATH = "M12 2.25l1.45 5.23a4.6 4.6 0 0 0 3.18 3.18L21.75 12l-5.12 1.34a4.6 4.6 0 0 0-3.18 3.18L12 21.75l-1.45-5.23a4.6 4.6 0 0 0-3.18-3.18L2.25 12l5.12-1.34a4.6 4.6 0 0 0 3.18-3.18L12 2.25Zm6.8-1.05.58 2.08a1.85 1.85 0 0 0 1.28 1.28l2.14.56-2.14.56a1.85 1.85 0 0 0-1.28 1.28l-.58 2.08-.58-2.08a1.85 1.85 0 0 0-1.28-1.28l-2.14-.56 2.14-.56a1.85 1.85 0 0 0 1.28-1.28L18.8 1.2Z";
const CLAUDE_PROVIDER_ICON = "obst-provider-claude";
const CODEX_PROVIDER_ICON = "obst-provider-codex";
const ANTIGRAVITY_PROVIDER_ICON = "obst-provider-antigravity";
const AGENT_PROVIDER_CHOICES: ReadonlyArray<{ provider: AgentProvider; label: string; icon: string }> = [
  { provider: "claude", label: "Claude Code", icon: CLAUDE_PROVIDER_ICON },
  { provider: "codex", label: "Codex", icon: CODEX_PROVIDER_ICON },
  { provider: "gemini", label: "Antigravity", icon: ANTIGRAVITY_PROVIDER_ICON }
];
const DEFAULT_ATTACHMENT_FOLDER = "Obst Terminal Attachments";
const DEFAULT_VOICE_TRANSCRIPTION_API_BASE_URL = (process.env.TRANSCRIBE_API_BASE_URL?.trim() || "http://10.10.101.61:3000").replace(/\/+$/, "");
const VOICE_RECORDING_MAX_MS = 2 * 60 * 60 * 1000;
const VOICE_TRANSCRIPTION_TIMEOUT_MS = 30 * 60 * 1000;
const VOICE_WAV_SAMPLE_RATE = 16_000;
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
const SETTINGS_SCHEMA_VERSION = 12;
const PRIVATE_STATE_FILE = "private-state.json";
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
const ACTIVE_NOTE_SELECTION_MAX_CHARS = 6000;
const CODEX_TURN_COMPLETION_FALLBACK_MS = 15000;
const CODEX_MODEL_ROLE_LABELS: Record<string, string> = {
  "gpt-5.6-sol": "frontier",
  "gpt-5.6-terra": "balanced",
  "gpt-5.6-luna": "fast"
};
const CLAUDE_CUSTOM_MODEL_VALUE = "__custom_model__";
const CLAUDE_LATEST_MODEL_CHOICES = [
  { value: "", label: "Claude default" },
  { value: "best", label: "Best (auto)" },
  { value: "fable", label: "Fable 5 (latest: fable)" },
  { value: "opus", label: "Opus 5 (latest: opus)" },
  { value: "sonnet", label: "Sonnet 5 (latest: sonnet)" },
  { value: "haiku", label: "Haiku 4.5 (latest: haiku)" }
];
const CLAUDE_PINNED_MODEL_CHOICES = [
  { value: "claude-fable-5", label: "Fable 5 (pinned)" },
  { value: "claude-opus-5", label: "Opus 5 (pinned)" },
  { value: "claude-sonnet-5", label: "Sonnet 5 (pinned)" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 (pinned)" },
  { value: "claude-opus-4-7", label: "Opus 4.7 (pinned)" },
  { value: "claude-opus-4-6", label: "Opus 4.6 (pinned)" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6 (pinned)" }
];
const CLAUDE_MODEL_CHOICES = [...CLAUDE_LATEST_MODEL_CHOICES, ...CLAUDE_PINNED_MODEL_CHOICES];
const CLAUDE_EFFORT_CHOICES = [
  { value: "", label: "Effort: default" },
  { value: "low", label: "Effort: low" },
  { value: "medium", label: "Effort: medium" },
  { value: "high", label: "Effort: high" },
  { value: "xhigh", label: "Effort: xhigh" },
  { value: "max", label: "Effort: max" }
];
const CLAUDE_PERMISSION_MODE_CHOICES = [
  { value: "default", label: "Permission: default" },
  { value: "auto", label: "Permission: auto" },
  { value: "acceptEdits", label: "Permission: acceptEdits" },
  { value: "dontAsk", label: "Permission: dontAsk" },
  { value: "plan", label: "Permission: plan" },
  { value: "bypassPermissions", label: "Permission: bypassPermissions" }
];
// Antigravity CLI --model values are display names, verified against
// `agy models` output (agy 1.0.16, 2026-07-06).
const GEMINI_MODEL_CHOICES = [
  { value: "", label: "Antigravity default" },
  { value: "Gemini 3.5 Flash (Low)", label: "Gemini 3.5 Flash (Low)" },
  { value: "Gemini 3.5 Flash (Medium)", label: "Gemini 3.5 Flash (Medium)" },
  { value: "Gemini 3.5 Flash (High)", label: "Gemini 3.5 Flash (High)" },
  { value: "Gemini 3.1 Pro (Low)", label: "Gemini 3.1 Pro (Low)" },
  { value: "Gemini 3.1 Pro (High)", label: "Gemini 3.1 Pro (High)" },
  { value: "Claude Sonnet 4.6 (Thinking)", label: "Claude Sonnet 4.6 (Thinking)" },
  { value: "Claude Opus 4.6 (Thinking)", label: "Claude Opus 4.6 (Thinking)" },
  { value: "GPT-OSS 120B (Medium)", label: "GPT-OSS 120B (Medium)" }
];
const LEGACY_GEMINI_MODEL_CHOICES = [
  { value: "", label: "Gemini default" },
  { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
  { value: "gemini-2.5-flash", label: "gemini-2.5-flash" },
  { value: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite" }
];
const GEMINI_APPROVAL_MODE_CHOICES = [
  { value: "default", label: "Approval: default" },
  { value: "auto_edit", label: "Approval: auto_edit (legacy)" },
  { value: "yolo", label: "Approval: yolo (skip permissions)" },
  { value: "plan", label: "Approval: plan (legacy)" }
];

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
  claudeExecutable: string;
  claudeModel: string;
  claudeEffort: ClaudeEffort;
  claudePermissionMode: ClaudePermissionMode;
  claudeStrictMcpConfig: boolean;
  geminiExecutable: string;
  geminiModel: string;
  geminiApprovalMode: GeminiApprovalMode;
  geminiSkipTrust: boolean;
  geminiSandbox: boolean;
  geminiUseNativeSession: boolean;
  geminiOutputFormat: GeminiOutputFormat;
  geminiExtensions: string;
  geminiAllowedMcpServers: string;
  geminiIncludeDirectories: string;
  geminiPolicyFiles: string;
  windowsPtyBackend: WindowsPtyBackend;
  autoInstallRuntime: boolean;
  useSystemCa: boolean;
  extraCaCertPath: string;
  attachmentFolder: string;
  voiceTranscriptionApiBaseUrl: string;
  voiceTranscriptionLanguage: VoiceTranscriptionLanguage;
  persistAgentTranscriptSnapshots: boolean;
  agentViewState?: AgentViewSessionState;
}

type StoredPowerShellSettings = Partial<PowerShellSettings> & {
  voiceLiveTranscription?: boolean;
  voiceTranscriptionMode?: string;
};

interface PrivatePluginData {
  agentViewState?: AgentViewSessionState;
}

type TerminalColorScheme = "dark" | "light" | "obsidian";
type ShiftEnterMode = "bracketed-paste" | "claude-backslash" | "xterm-paste" | "modified-enter" | "csi-u" | "line-feed";
type WindowsPtyBackend = "winpty" | "conpty";
type CodexApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
type CodexLoginMethod = "browser" | "device-code";
type ClaudePermissionMode = "acceptEdits" | "auto" | "bypassPermissions" | "default" | "dontAsk" | "plan";
type ClaudeEffort = "" | "low" | "medium" | "high" | "xhigh" | "max";
type GeminiApprovalMode = "default" | "auto_edit" | "yolo" | "plan";
type GeminiOutputFormat = "text" | "json" | "stream-json";
type VoiceTranscriptionLanguage = "" | "ko" | "en";
type VoiceCaptureState = "idle" | "requesting" | "recording" | "transcribing";
type ShellProfile = "auto" | "pwsh" | "windows-powershell" | "cmd" | "wsl" | "git-bash" | "zsh" | "bash" | "custom";
type ViewPane = "agent" | "terminal";
type AgentProvider = "claude" | "codex" | "gemini";
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
  geminiSessionId?: string | null;
  geminiNativeSessionStarted?: boolean;
}

interface AgentWorkspaceSessionState extends Record<string, unknown> {
  agentSessionKey: string;
  agentSessionLabel: string;
  agentSessionMode: AgentSessionMode;
  agentProvider: AgentProvider;
  claudeSessionId: string | null;
  claudeControlSessionId?: string | null;
  codexThreadId: string | null;
  geminiSessionId?: string | null;
  geminiNativeSessionStarted?: boolean;
  claudeTranscriptHtml?: string;
  codexTranscriptHtml?: string;
  geminiTranscriptHtml?: string;
  claudeScrollTop?: number;
  codexScrollTop?: number;
  geminiScrollTop?: number;
  inputText?: string;
  statusText?: string;
  deepVaultEnabled?: boolean;
  claudeRequestedModel?: string | null;
  claudeResolvedModel?: string | null;
  agentTokenUsage?: TokenUsage | null;
  agentLastUsageText?: string | null;
  createdAt: number;
  updatedAt: number;
  claudeTranscriptEl?: HTMLElement | null;
  codexTranscriptEl?: HTMLElement | null;
  geminiTranscriptEl?: HTMLElement | null;
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
  codexQueuedInputs?: AgentQueuedTurnInput[];
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
  agentPrintTurnRuntime?: AgentPrintTurnRuntime | null;
  agentPrintQueuedInputs?: AgentQueuedPrintInput[];
  agentClaudeControlSessionId?: string | null;
  agentPostLaunchInput?: string | null;
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
  agentControlCommandInProgress?: boolean;
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

interface GeminiAuthConfiguration {
  authType: string | null;
  authSource: string | null;
  detail: string;
  failure?: AgentAuthCheck;
}

interface GeminiAuthSettings {
  selectedType: string | null;
  selectedSource: string | null;
  enforcedType: string | null;
  enforcedSource: string | null;
  checkedPaths: string[];
}

interface CapturedCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  error?: string;
  cancelled?: boolean;
  cancelReason?: string;
}

interface CapturedCommandHandle {
  child: ChildProcessWithoutNullStreams | null;
  pid?: number;
  promise: Promise<CapturedCommandResult>;
  kill: (reason?: string) => void;
}

interface AgentPrintTurnRuntime {
  provider: AgentProvider;
  turnId: string;
  sessionId: string | null;
  child: ChildProcessWithoutNullStreams;
  pid?: number;
  kill: (reason?: string) => void;
  startedAt: number;
  promptPreview: string;
  settled: boolean;
  cancelReason?: string;
}

interface AgentQueuedPrintInput {
  text: string;
  attachments: AgentAttachment[];
  visibleText: string;
}

interface ActiveNoteContextSnapshot {
  path: string;
  name: string;
  selection: string;
  selectionTruncated: boolean;
  selectionStartLine?: number;
  selectionEndLine?: number;
  cursorLine?: number;
  cursorLineText?: string;
}

interface AgentQueuedTurnInput {
  text: string;
  attachments: AgentAttachment[];
  activeNoteContext: ActiveNoteContextSnapshot | null;
}

interface AgentPrintProcessRecord {
  pid: number;
  provider: "claude" | "gemini";
  sessionId: string | null;
  cwd: string;
  startedAt: number;
  pluginVersion: string;
}

interface ClipboardNativeImage {
  isEmpty(): boolean;
  toPNG(): Buffer;
}

interface VoiceAudioPayload {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
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
  claudeExecutable: "",
  claudeModel: "",
  claudeEffort: "",
  claudePermissionMode: "default",
  claudeStrictMcpConfig: true,
  geminiExecutable: "",
  geminiModel: "",
  geminiApprovalMode: "default",
  geminiSkipTrust: true,
  geminiSandbox: false,
  geminiUseNativeSession: false,
  geminiOutputFormat: "stream-json",
  geminiExtensions: "",
  geminiAllowedMcpServers: "",
  geminiIncludeDirectories: "",
  geminiPolicyFiles: "",
  windowsPtyBackend: "conpty",
  autoInstallRuntime: true,
  useSystemCa: false,
  extraCaCertPath: "",
  attachmentFolder: DEFAULT_ATTACHMENT_FOLDER,
  voiceTranscriptionApiBaseUrl: DEFAULT_VOICE_TRANSCRIPTION_API_BASE_URL,
  voiceTranscriptionLanguage: "ko",
  persistAgentTranscriptSnapshots: false
};

function getSharedSettingsForSave(settings: PowerShellSettings): PowerShellSettings {
  const shared = { ...settings } as PowerShellSettings & {
    voiceLiveTranscription?: boolean;
    voiceTranscriptionMode?: string;
  };
  delete shared.agentViewState;
  delete shared.voiceLiveTranscription;
  delete shared.voiceTranscriptionMode;
  return shared;
}

function normalizePrivatePluginData(value: unknown): PrivatePluginData {
  if (!value || typeof value !== "object") {
    return {};
  }

  const candidate = value as Partial<PrivatePluginData>;
  const agentViewState = normalizeAgentViewSessionState(candidate.agentViewState);
  return agentViewState ? { agentViewState } : {};
}

function getLocalStateRootPath(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || process.env.APPDATA || join(homedir(), "AppData", "Local"), "Obst Terminal");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Obst Terminal");
  }
  return join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "obst-terminal");
}

function getVaultLocalStateDirectoryName(vaultIdentity: string, pluginId: string): string {
  const normalizedIdentity = process.platform === "win32"
    ? vaultIdentity.replace(/\//g, "\\").toLowerCase()
    : vaultIdentity;
  const hash = createHash("sha256")
    .update(`${pluginId}\0${normalizedIdentity}`)
    .digest("hex")
    .slice(0, 16);
  const label = sanitizeFileStem(vaultIdentity.replace(/\\/g, "/").split("/").pop() || "vault").slice(0, 40) || "vault";
  return `${label}-${hash}`;
}

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
  private privateState: PrivatePluginData = {};
  private runtimeInstallPromise: Promise<void> | null = null;
  private companyVoiceLexicon: CompanyVoiceLexicon | null = null;

  async onload() {
    await this.loadSettings();
    cleanupAgentPrintProcessRegistry(this.getAgentProcessRegistryPath());
    this.cleanupLegacySharedPersonalState();
    addIcon(OBST_TERMINAL_ICON, OBST_TERMINAL_ICON_SVG);
    addIcon(CLAUDE_PROVIDER_ICON, providerMenuIconSvg(CLAUDE_ICON_PATH));
    addIcon(CODEX_PROVIDER_ICON, providerMenuIconSvg(CODEX_ICON_PATH));
    addIcon(ANTIGRAVITY_PROVIDER_ICON, providerMenuIconSvg(GEMINI_ICON_PATH));

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

  onunload() {
    this.companyVoiceLexicon = null;
  }

  async loadSettings() {
    const saved = (await this.loadData()) as StoredPowerShellSettings | null;
    const previousSchemaVersion = saved?.settingsSchemaVersion ?? 0;
    const needsCodexScrollbackMigration = previousSchemaVersion < 2;
    const needsGeminiStableModelMigration = previousSchemaVersion < 4;
    const needsAntigravityMigration = previousSchemaVersion < 6;
    const needsPrivateStateMigration = previousSchemaVersion < 7;
    // v8: the Gemini provider slot moved back to Antigravity CLI (agy) after the
    // 2026-06-18 consumer Gemini CLI shutdown. Clear explicit legacy defaults so
    // executable auto-detection and Antigravity model names take over.
    const needsAntigravityRestoreMigration = previousSchemaVersion < 8;
    const sharedAgentViewState = normalizeAgentViewSessionState(saved?.agentViewState);
    let shouldSaveSettings = needsCodexScrollbackMigration ||
      needsGeminiStableModelMigration ||
      needsAntigravityMigration ||
      needsPrivateStateMigration ||
      needsAntigravityRestoreMigration ||
      saved?.voiceTranscriptionMode !== undefined ||
      saved?.voiceLiveTranscription !== undefined ||
      saved?.agentViewState !== undefined;
    let shouldSavePrivateState = false;
    this.privateState = this.loadPrivateState();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
    delete this.settings.agentViewState;
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
    this.settings.claudeExecutable = this.settings.claudeExecutable?.trim() ?? "";
    this.settings.claudeModel = this.settings.claudeModel?.trim() ?? "";
    this.settings.claudeEffort = normalizeClaudeEffort(this.settings.claudeEffort);
    this.settings.claudePermissionMode = normalizeClaudePermissionMode(this.settings.claudePermissionMode);
    if (needsPrivateStateMigration && this.settings.claudePermissionMode === "bypassPermissions") {
      this.settings.claudePermissionMode = "default";
      shouldSaveSettings = true;
    }
    this.settings.claudeStrictMcpConfig = this.settings.claudeStrictMcpConfig !== false;
    this.settings.geminiExecutable = this.settings.geminiExecutable?.trim() ?? "";
    if ((needsAntigravityMigration || needsAntigravityRestoreMigration) && /^gemini(?:\.cmd|\.exe)?$/i.test(this.settings.geminiExecutable)) {
      this.settings.geminiExecutable = "";
    }
    const savedGeminiModel = this.settings.geminiModel?.trim() ?? "";
    this.settings.geminiModel = normalizeGeminiModelInput(savedGeminiModel);
    if (needsGeminiStableModelMigration) {
      this.settings.geminiModel = migrateGeminiModelAliasToStable(this.settings.geminiModel);
    }
    if (needsAntigravityMigration && !this.settings.geminiExecutable) {
      this.settings.geminiModel = "";
    }
    if (needsAntigravityRestoreMigration &&
        isAntigravityCli(this.settings) &&
        (["auto", "pro", "flash", "flash-lite"].includes(this.settings.geminiModel) || /^gemini-\d/.test(this.settings.geminiModel))) {
      // Legacy Gemini CLI aliases and slug-style model ids have no Antigravity
      // equivalent (agy --model takes display names such as "Gemini 3.5 Flash (Low)").
      this.settings.geminiModel = "";
    }
    if (savedGeminiModel !== this.settings.geminiModel) {
      shouldSaveSettings = true;
    }
    this.settings.geminiApprovalMode = normalizeGeminiApprovalMode(this.settings.geminiApprovalMode);
    if (needsPrivateStateMigration && this.settings.geminiApprovalMode === "yolo") {
      this.settings.geminiApprovalMode = "default";
      shouldSaveSettings = true;
    }
    this.settings.geminiSkipTrust = this.settings.geminiSkipTrust !== false;
    this.settings.geminiSandbox = this.settings.geminiSandbox === true;
    this.settings.geminiUseNativeSession = false;
    this.settings.geminiOutputFormat = normalizeGeminiOutputFormat(this.settings.geminiOutputFormat);
    this.settings.geminiExtensions = normalizeDelimitedSetting(this.settings.geminiExtensions);
    this.settings.geminiAllowedMcpServers = normalizeDelimitedSetting(this.settings.geminiAllowedMcpServers);
    this.settings.geminiIncludeDirectories = normalizeDelimitedSetting(this.settings.geminiIncludeDirectories);
    this.settings.geminiPolicyFiles = normalizeDelimitedSetting(this.settings.geminiPolicyFiles);
    if (previousSchemaVersion < SETTINGS_SCHEMA_VERSION) {
      shouldSaveSettings = true;
    }
    this.settings.windowsPtyBackend = normalizeWindowsPtyBackend(this.settings.windowsPtyBackend);
    this.settings.autoInstallRuntime = this.settings.autoInstallRuntime === true;
    this.settings.voiceTranscriptionApiBaseUrl = normalizeVoiceTranscriptionApiBaseUrl(this.settings.voiceTranscriptionApiBaseUrl);
    this.settings.voiceTranscriptionLanguage = normalizeVoiceTranscriptionLanguage(this.settings.voiceTranscriptionLanguage);
    delete (this.settings as PowerShellSettings & {
      voiceLiveTranscription?: boolean;
      voiceTranscriptionMode?: string;
    }).voiceLiveTranscription;
    delete (this.settings as PowerShellSettings & {
      voiceLiveTranscription?: boolean;
      voiceTranscriptionMode?: string;
    }).voiceTranscriptionMode;
    this.settings.persistAgentTranscriptSnapshots = this.settings.persistAgentTranscriptSnapshots === true;
    const localAgentViewState = normalizeAgentViewSessionState(this.privateState.agentViewState);
    if (localAgentViewState) {
      this.privateState.agentViewState = this.settings.persistAgentTranscriptSnapshots
        ? localAgentViewState
        : stripAgentViewTranscriptSnapshots(localAgentViewState);
      shouldSavePrivateState = !this.settings.persistAgentTranscriptSnapshots;
    } else if (sharedAgentViewState) {
      this.privateState.agentViewState = this.settings.persistAgentTranscriptSnapshots
        ? sharedAgentViewState
        : stripAgentViewTranscriptSnapshots(sharedAgentViewState);
      shouldSavePrivateState = true;
    } else {
      this.privateState.agentViewState = undefined;
    }
    if (shouldSaveSettings) {
      await this.saveSettings();
    }
    if (shouldSavePrivateState) {
      await this.savePrivateState();
    }
  }

  async saveSettings() {
    await this.saveData(getSharedSettingsForSave(this.settings));
  }

  getSavedAgentViewState(): AgentViewSessionState | null {
    const state = normalizeAgentViewSessionState(this.privateState.agentViewState);
    return state ?? null;
  }

  async saveAgentViewStateSnapshot(state: AgentViewSessionState) {
    const normalized = normalizeAgentViewSessionState(state);
    if (!normalized) {
      return;
    }
    this.privateState.agentViewState = this.settings.persistAgentTranscriptSnapshots
      ? normalized
      : stripAgentViewTranscriptSnapshots(normalized);
    await this.savePrivateState();
  }

  async setPersistAgentTranscriptSnapshots(value: boolean) {
    this.settings.persistAgentTranscriptSnapshots = value === true;
    if (!this.settings.persistAgentTranscriptSnapshots && this.privateState.agentViewState) {
      this.privateState.agentViewState = stripAgentViewTranscriptSnapshots(this.privateState.agentViewState);
      await this.savePrivateState();
    }
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

  getAgentProcessRegistryPath(): string {
    return join(this.getPrivateDataDirPath(), AGENT_PROCESS_REGISTRY_FILE);
  }

  buildVoiceTranscriptionPrompt(noteContext: string): string {
    return this.getCompanyVoiceLexicon().buildTranscriptionPrompt(noteContext);
  }

  normalizeVoiceTranscript(transcript: string) {
    return this.getCompanyVoiceLexicon().normalizeTranscript(transcript);
  }

  private getCompanyVoiceLexicon(): CompanyVoiceLexicon {
    if (!this.companyVoiceLexicon) {
      this.companyVoiceLexicon = new CompanyVoiceLexicon(this.getVaultPath());
    }
    return this.companyVoiceLexicon;
  }

  private getPrivateDataDirPath(): string {
    const vaultIdentity = this.getVaultPath() ?? this.app.vault.getName();
    return join(getLocalStateRootPath(), this.manifest.id, getVaultLocalStateDirectoryName(vaultIdentity, this.manifest.id));
  }

  private getPrivateStatePath(): string {
    return join(this.getPrivateDataDirPath(), PRIVATE_STATE_FILE);
  }

  private loadPrivateState(): PrivatePluginData {
    const path = this.getPrivateStatePath();
    if (!existsSync(path)) {
      return {};
    }

    try {
      return normalizePrivatePluginData(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      return {};
    }
  }

  private async savePrivateState() {
    const path = this.getPrivateStatePath();
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(normalizePrivatePluginData(this.privateState), null, 2), "utf8");
    } catch (error) {
      new Notice(`Could not save local Obst Terminal state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private cleanupLegacySharedPersonalState() {
    try {
      const legacyRegistryPath = join(this.getPluginBasePath(), AGENT_PROCESS_REGISTRY_FILE);
      if (legacyRegistryPath !== this.getAgentProcessRegistryPath() && existsSync(legacyRegistryPath)) {
        rmSync(legacyRegistryPath, { force: true });
      }
    } catch {
      // Best-effort cleanup only. The new registry path is already local.
    }
  }

  registerAgentPrintProcess(record: AgentPrintProcessRecord) {
    updateAgentPrintProcessRegistry(this.getAgentProcessRegistryPath(), (records) => {
      const next = records.filter((candidate) => candidate.pid !== record.pid);
      next.push(record);
      return next;
    });
  }

  unregisterAgentPrintProcess(pid: number | undefined) {
    if (pid === undefined) {
      return;
    }
    updateAgentPrintProcessRegistry(this.getAgentProcessRegistryPath(), (records) =>
      records.filter((record) => record.pid !== pid)
    );
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
    view.openNewAgentSessionMenu();
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
  private terminalStarted = false;
  private agentSessions: AgentWorkspaceSessionState[] = [];
  private activeAgentSessionKey: string | null = null;
  private visibleAgentSessionKey: string | null = null;
  private agentSessionTabsEl: HTMLElement | null = null;
  private agentSessionAddButton: HTMLButtonElement | null = null;
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
  private codexQueuedInputs: AgentQueuedTurnInput[] = [];
  private agentSendButton: HTMLButtonElement | null = null;
  private codexStatusLineEl: HTMLElement | null = null;
  private codexStatusLineFrame: number | null = null;
  private codexContextPercent: number | null = null;
  private codexRateLimitWindows: AgentUsageWindow[] = [];
  private codexGitBranch: string | null | undefined = undefined;
  private codexOptionsRow: HTMLElement | null = null;
  private claudeModelSelect: HTMLSelectElement | null = null;
  private claudeCustomModelInput: HTMLInputElement | null = null;
  private claudeResolvedModelEl: HTMLElement | null = null;
  private claudeEffortSelect: HTMLSelectElement | null = null;
  private claudePermissionSelect: HTMLSelectElement | null = null;
  private codexModelSelect: HTMLSelectElement | null = null;
  private codexEffortSelect: HTMLSelectElement | null = null;
  private codexAccessSelect: HTMLSelectElement | null = null;
  private geminiModelSelect: HTMLSelectElement | null = null;
  private geminiApprovalSelect: HTMLSelectElement | null = null;
  private deepVaultButton: HTMLButtonElement | null = null;
  private agentTokenUsageEl: HTMLElement | null = null;
  private agentTokenInputValueEl: HTMLElement | null = null;
  private agentTokenOutputValueEl: HTMLElement | null = null;
  private codexModels: AgentModelInfo[] = [];
  private codexPendingAttachments: AgentAttachment[] = [];
  private codexAttachmentsEl: HTMLElement | null = null;
  private agentAttachButton: HTMLButtonElement | null = null;
  private voiceButton: HTMLButtonElement | null = null;
  private voiceStatusEl: HTMLElement | null = null;
  private voiceCaptureState: VoiceCaptureState = "idle";
  private voiceMediaRecorder: MediaRecorder | null = null;
  private voiceMediaStream: MediaStream | null = null;
  private voicePreparationStatus = "";
  private voiceStartedAt = 0;
  private voiceTimer: number | null = null;
  private voiceTargetSessionKey: string | null = null;
  private voiceOperationId = 0;
  private activeNoteContextEl: HTMLElement | null = null;
  private activeNoteFile: TFile | null = null;
  private activeNoteView: MarkdownView | null = null;
  private activeNoteSharingEnabled = true;
  private activeNoteRefreshFrame: number | null = null;
  private agentHost: ChildProcessWithoutNullStreams | null = null;
  private agentHostReady = false;
  private agentReadyForInput = false;
  private agentStdoutBuffer = "";
  private agentStatusEl: HTMLElement | null = null;
  private agentStatusText = "Idle";
  private agentTokenUsage: TokenUsage | null = null;
  private agentLastUsageText: string | null = null;
  private agentTranscriptEl: HTMLElement | null = null;
  private claudeTranscriptEl: HTMLElement | null = null;
  private codexTranscriptEl: HTMLElement | null = null;
  private geminiTranscriptEl: HTMLElement | null = null;
  private suppressAgentTranscriptScrollMemory = false;
  private agentLoadingEl: HTMLElement | null = null;
  private agentLoadingTextEl: HTMLElement | null = null;
  private agentProgressTimer: number | null = null;
  private agentPromptActionsEl: HTMLElement | null = null;
  private agentInputEl: HTMLTextAreaElement | null = null;
  private agentStartButton: HTMLButtonElement | null = null;
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
  private agentGeminiSessionId: string | null = randomUUID();
  private agentGeminiNativeSessionStarted = false;
  private agentPrintTurnRuntime: AgentPrintTurnRuntime | null = null;
  private agentPrintQueuedInputs: AgentQueuedPrintInput[] = [];
  private agentPostLaunchInput: string | null = null;
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
  private agentControlCommandInProgress = false;
  private agentNeedsAuth = false;
  private agentPromptState: AgentPromptState | null = null;
  private agentOpenedExternalUrls = new Set<string>();
  private agentStartRequestIds = new Map<string, number>();
  private agentStartRequestCounter = 0;

  constructor(leaf: WorkspaceLeaf, plugin: VaultPowerShellPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_POWERSHELL;
  }

  getDisplayText(): string {
    return "Obst Terminal";
  }

  getIcon(): string {
    return OBST_TERMINAL_ICON;
  }

  getState(): Record<string, unknown> {
    this.captureActiveAgentSessionState();
    return {
      agentSessions: this.cloneAgentSessionsForState(this.plugin.settings.persistAgentTranscriptSnapshots),
      activeAgentSessionKey: this.activeAgentSessionKey,
      agentSessionKey: this.agentSessionKey,
      agentSessionLabel: this.agentSessionLabel,
      agentSessionMode: this.agentSessionMode,
      agentProvider: this.agentProvider,
      activePane: this.activePane,
      claudeSessionId: this.agentClaudeSessionId,
      claudeControlSessionId: this.agentClaudeControlSessionId,
      codexThreadId: this.agentCodexThreadId,
      geminiSessionId: this.agentGeminiSessionId
    };
  }

  setState(state: unknown): Promise<void> {
    this.applyAgentViewState(state);
    this.renderAgentSessionTabs();
    this.restoreActiveAgentSessionDom();
    this.refreshAgentSessionChrome();
    this.autoStartActiveAgent();
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
    this.initializeActiveNoteTracking();
    this.scrollVisibleAgentTranscriptToBottomAfterLayout();

    this.showPane(this.activePane, false);
    // Do NOT auto-start here. Obsidian always calls setState() right after
    // onOpen() with the persisted view state; auto-starting now would launch
    // the placeholder session's default provider (claude) and race the real
    // restored provider (e.g. codex), tangling both starts.
    return Promise.resolve();
  }

  async onClose(): Promise<void> {
    this.cancelVoiceCapture();
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
    if (this.activeNoteRefreshFrame !== null) {
      cancelAnimationFrame(this.activeNoteRefreshFrame);
      this.activeNoteRefreshFrame = null;
    }
    this.pendingShiftEnterTimers.forEach((timer) => window.clearTimeout(timer));
    this.pendingShiftEnterTimers.clear();
    this.stopTurnProgressTimer();
    this.pendingInsertTexts = [];
    this.terminal?.dispose();
    this.terminal = null;
    this.terminalContainer = null;
    this.fitAddon = null;
    this.terminalStarted = false;
    this.agentPaneEl = null;
    this.terminalPaneEl = null;
    this.agentStatusEl = null;
    this.agentSessionTabsEl = null;
    this.agentSessionAddButton = null;
    this.agentSessionTabEls.clear();
    this.agentTranscriptMountEl = null;
    this.agentSessionTitleInputEl = null;
    this.agentSessionSubtitleEl = null;
    this.agentTranscriptEl = null;
    this.claudeTranscriptEl = null;
    this.codexTranscriptEl = null;
    this.geminiTranscriptEl = null;
    this.agentLoadingEl = null;
    this.agentLoadingTextEl = null;
    this.agentPromptActionsEl = null;
    this.agentInputEl = null;
    this.agentStartButton = null;
    this.agentAttachButton = null;
    this.voiceButton = null;
    this.voiceStatusEl = null;
    this.activeNoteContextEl = null;
    this.activeNoteFile = null;
    this.activeNoteView = null;
    this.codexStatusLineEl = null;
    this.codexOptionsRow = null;
    this.claudeModelSelect = null;
    this.claudeCustomModelInput = null;
    this.claudeResolvedModelEl = null;
    this.claudeEffortSelect = null;
    this.claudePermissionSelect = null;
    this.codexModelSelect = null;
    this.codexEffortSelect = null;
    this.codexAccessSelect = null;
    this.geminiModelSelect = null;
    this.geminiApprovalSelect = null;
    this.deepVaultButton = null;
    this.agentTokenUsageEl = null;
    this.agentTokenInputValueEl = null;
    this.agentTokenOutputValueEl = null;
    this.paneTabEls = { agent: null, terminal: null };
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
      if (isAgentProvider(value.agentProvider)) {
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
      if (typeof value.geminiSessionId === "string" && value.geminiSessionId.trim()) {
        this.agentGeminiSessionId = value.geminiSessionId.trim();
      }
      this.agentGeminiNativeSessionStarted = value.geminiNativeSessionStarted === true;
      this.agentSessions = [this.createSessionStateFromActiveFields()];
      this.activeAgentSessionKey = this.agentSessionKey;
      this.visibleAgentSessionKey = this.agentSessionKey;
    }

    this.activePane = "agent";

    this.ensureInternalAgentSessions();
    this.applyAgentSessionFields(this.getActiveAgentSessionState());
  }

  private saveAgentViewState() {
    void this.plugin.saveAgentViewStateSnapshot(this.getState() as AgentViewSessionState);
    this.app.workspace.requestSaveLayout();
  }

  private refreshAgentSessionChrome() {
    // The console header was intentionally removed; session labels now live in tabs only.
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

  private ensureGeminiSessionId(): string {
    if (!this.agentGeminiSessionId) {
      this.agentGeminiSessionId = randomUUID();
      this.saveAgentViewState();
      this.refreshAgentSessionChrome();
    }
    return this.agentGeminiSessionId;
  }

  createInternalAgentSession(provider: AgentProvider) {
    this.ensureInternalAgentSessions();
    this.captureActiveAgentSessionState();

    const session = createAgentWorkspaceSessionState("isolated", provider);
    this.ensureAgentSessionRuntime(session);
    this.agentSessions.push(session);
    session.agentSessionLabel = getUniqueProviderAgentSessionLabel(this.agentSessions, session.agentProvider, session.agentSessionKey);
    this.activeAgentSessionKey = session.agentSessionKey;
    this.visibleAgentSessionKey = session.agentSessionKey;
    this.applyAgentSessionRuntime(session);
    this.restoreActiveAgentSessionDom();
    this.scrollVisibleAgentTranscriptToBottomAfterLayout();
    this.renderAgentSessionTabs();
    this.showPane("agent");
    this.saveAgentViewState();
    this.autoStartActiveAgent();
  }

  private ensureInternalAgentSessions() {
    if (this.agentSessions.length === 0) {
      const session = this.createSessionStateFromActiveFields();
      this.ensureAgentSessionRuntime(session);
      this.agentSessions = [session];
      ensureProviderAgentSessionLabels(this.agentSessions);
      this.activeAgentSessionKey = session.agentSessionKey;
      this.visibleAgentSessionKey = session.agentSessionKey;
      return;
    }

    ensureProviderAgentSessionLabels(this.agentSessions);
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
      geminiSessionId: this.agentGeminiSessionId,
      geminiNativeSessionStarted: this.agentGeminiNativeSessionStarted,
      claudeTranscriptHtml: sanitizeAgentTranscriptHtml(this.claudeTranscriptEl?.innerHTML ?? ""),
      codexTranscriptHtml: sanitizeAgentTranscriptHtml(this.codexTranscriptEl?.innerHTML ?? ""),
      geminiTranscriptHtml: sanitizeAgentTranscriptHtml(this.geminiTranscriptEl?.innerHTML ?? ""),
      claudeScrollTop: this.getReadableAgentTranscriptScrollTop(this.claudeTranscriptEl, 0),
      codexScrollTop: this.getReadableAgentTranscriptScrollTop(this.codexTranscriptEl, 0),
      geminiScrollTop: this.getReadableAgentTranscriptScrollTop(this.geminiTranscriptEl, 0),
      inputText: this.agentInputEl?.value ?? "",
      statusText: this.agentStatusText,
      deepVaultEnabled: false,
      claudeRequestedModel: null,
      claudeResolvedModel: null,
      agentTokenUsage: null,
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
    this.agentGeminiSessionId = session.geminiSessionId ?? null;
    this.agentGeminiNativeSessionStarted = session.geminiNativeSessionStarted === true;
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
    session.geminiTranscriptEl ??= this.createDetachedAgentTranscriptEl();
    if (session.claudeTranscriptHtml && !session.claudeTranscriptEl.innerHTML.trim()) {
      session.claudeTranscriptEl.innerHTML = session.claudeTranscriptHtml;
    }
    if (session.codexTranscriptHtml && !session.codexTranscriptEl.innerHTML.trim()) {
      session.codexTranscriptEl.innerHTML = session.codexTranscriptHtml;
    }
    if (session.geminiTranscriptHtml && !session.geminiTranscriptEl.innerHTML.trim()) {
      session.geminiTranscriptEl.innerHTML = session.geminiTranscriptHtml;
    }
    session.claudeScrollTop ??= 0;
    session.codexScrollTop ??= 0;
    session.geminiScrollTop ??= 0;
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
    session.agentPrintTurnRuntime ??= null;
    session.agentPrintQueuedInputs ??= [];
    session.agentClaudeControlSessionId ??= session.claudeControlSessionId ?? null;
    session.agentPostLaunchInput ??= null;
    session.lastAgentLaunchCommand ??= "";
    session.agentSeenEntries ??= new Set<string>();
    session.agentLocalMessageCounter ??= 0;
    session.agentLastRawNotice ??= "";
    session.deepVaultEnabled = session.deepVaultEnabled === true;
    session.claudeRequestedModel = typeof session.claudeRequestedModel === "string"
      ? session.claudeRequestedModel.trim()
      : null;
    session.claudeResolvedModel = typeof session.claudeResolvedModel === "string" && session.claudeResolvedModel.trim()
      ? session.claudeResolvedModel.trim()
      : null;
    session.agentTokenUsage = normalizeTokenUsage(session.agentTokenUsage);
    session.agentLastUsageText ??= null;
    session.agentAuthState ??= "idle";
    session.agentConversationReady ??= false;
    session.agentReadyNoticeShown ??= false;
    session.agentAutoLoginAttempted ??= false;
    session.agentAutoLoginPending ??= false;
    session.agentAutoMcpAttempted ??= false;
    session.agentMcpAuthInProgress ??= false;
    session.agentControlCommandInProgress ??= false;
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
    el.addEventListener("copy", (event) => {
      const text = getTranscriptSelectionText(el);
      if (!text) {
        return;
      }
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
      if (!event.clipboardData) {
        clipboard.writeText(text);
      }
    });
    return el;
  }

  private applyAgentSessionRuntime(session: AgentWorkspaceSessionState) {
    this.ensureAgentSessionRuntime(session);
    this.applyAgentSessionFields(session);
    this.claudeTranscriptEl = session.claudeTranscriptEl ?? null;
    this.codexTranscriptEl = session.codexTranscriptEl ?? null;
    this.geminiTranscriptEl = session.geminiTranscriptEl ?? null;
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
    // A settled runtime must never resurface as a live "Waiting..." state.
    this.agentPrintTurnRuntime = session.agentPrintTurnRuntime && !session.agentPrintTurnRuntime.settled
      ? session.agentPrintTurnRuntime
      : null;
    this.agentPrintQueuedInputs = session.agentPrintQueuedInputs ?? [];
    this.agentClaudeControlSessionId = session.agentClaudeControlSessionId ?? session.claudeControlSessionId ?? null;
    this.agentPostLaunchInput = session.agentPostLaunchInput ?? null;
    this.lastAgentLaunchCommand = session.lastAgentLaunchCommand ?? "";
    this.agentSeenEntries = session.agentSeenEntries ?? new Set<string>();
    this.agentLocalMessageCounter = session.agentLocalMessageCounter ?? 0;
    this.agentLastRawNotice = session.agentLastRawNotice ?? "";
    this.agentTokenUsage = normalizeTokenUsage(session.agentTokenUsage);
    this.agentLastUsageText = typeof session.agentLastUsageText === "string" && session.agentLastUsageText.trim()
      ? session.agentLastUsageText.trim()
      : null;
    this.agentAuthState = session.agentAuthState ?? "idle";
    this.agentConversationReady = session.agentConversationReady ?? false;
    this.agentReadyNoticeShown = session.agentReadyNoticeShown ?? false;
    this.agentAutoLoginAttempted = session.agentAutoLoginAttempted ?? false;
    this.agentAutoLoginPending = session.agentAutoLoginPending ?? false;
    this.agentAutoMcpAttempted = session.agentAutoMcpAttempted ?? false;
    this.agentMcpAuthInProgress = session.agentMcpAuthInProgress ?? false;
    this.agentControlCommandInProgress = session.agentControlCommandInProgress ?? false;
    this.agentNeedsAuth = session.agentNeedsAuth ?? false;
    this.agentPromptState = session.agentPromptState ?? null;
    this.agentOpenedExternalUrls = session.agentOpenedExternalUrls ?? new Set<string>();
    this.agentStatusText = session.statusText ?? "Idle";
    this.agentTranscriptEl = this.getProviderTranscriptEl(this.agentProvider);
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
    session.geminiSessionId = this.agentGeminiSessionId;
    session.geminiNativeSessionStarted = this.agentGeminiNativeSessionStarted;
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
    if (this.geminiTranscriptEl) {
      session.geminiTranscriptHtml = sanitizeAgentTranscriptHtml(this.geminiTranscriptEl.innerHTML);
      if (this.isVisibleAgentSessionContext() && this.isAgentTranscriptScrollReadable(this.geminiTranscriptEl)) {
        session.geminiScrollTop = this.geminiTranscriptEl.scrollTop;
      }
    }
    if (this.agentInputEl) {
      session.inputText = this.agentInputEl.value;
    }
    session.statusText = this.agentStatusText;
    session.claudeTranscriptEl = this.claudeTranscriptEl;
    session.codexTranscriptEl = this.codexTranscriptEl;
    session.geminiTranscriptEl = this.geminiTranscriptEl;
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
    session.agentPrintTurnRuntime = this.agentPrintTurnRuntime;
    session.agentPrintQueuedInputs = this.agentPrintQueuedInputs;
    session.agentClaudeControlSessionId = this.agentClaudeControlSessionId;
    session.agentPostLaunchInput = this.agentPostLaunchInput;
    session.lastAgentLaunchCommand = this.lastAgentLaunchCommand;
    session.agentSeenEntries = this.agentSeenEntries;
    session.agentLocalMessageCounter = this.agentLocalMessageCounter;
    session.agentLastRawNotice = this.agentLastRawNotice;
    session.agentTokenUsage = this.agentTokenUsage;
    session.agentLastUsageText = this.agentLastUsageText;
    session.agentAuthState = this.agentAuthState;
    session.agentConversationReady = this.agentConversationReady;
    session.agentReadyNoticeShown = this.agentReadyNoticeShown;
    session.agentAutoLoginAttempted = this.agentAutoLoginAttempted;
    session.agentAutoLoginPending = this.agentAutoLoginPending;
    session.agentAutoMcpAttempted = this.agentAutoMcpAttempted;
    session.agentMcpAuthInProgress = this.agentMcpAuthInProgress;
    session.agentControlCommandInProgress = this.agentControlCommandInProgress;
    session.agentNeedsAuth = this.agentNeedsAuth;
    session.agentPromptState = this.agentPromptState;
    session.agentOpenedExternalUrls = this.agentOpenedExternalUrls;
    session.updatedAt = Date.now();
  }

  private cloneAgentSessionsForState(includeTranscriptSnapshots: boolean): AgentWorkspaceSessionState[] {
    this.ensureInternalAgentSessions();
    return this.agentSessions.map((session) => ({
      agentSessionKey: session.agentSessionKey,
      agentSessionLabel: session.agentSessionLabel,
      agentSessionMode: session.agentSessionMode,
      agentProvider: session.agentProvider,
      claudeSessionId: session.claudeSessionId,
      claudeControlSessionId: session.claudeControlSessionId ?? null,
      codexThreadId: session.codexThreadId,
      geminiSessionId: session.geminiSessionId ?? null,
      geminiNativeSessionStarted: session.geminiNativeSessionStarted === true,
      claudeTranscriptHtml: includeTranscriptSnapshots ? sanitizeAgentTranscriptHtml(session.claudeTranscriptHtml ?? "") : "",
      codexTranscriptHtml: includeTranscriptSnapshots ? sanitizeAgentTranscriptHtml(session.codexTranscriptHtml ?? "") : "",
      geminiTranscriptHtml: includeTranscriptSnapshots ? sanitizeAgentTranscriptHtml(session.geminiTranscriptHtml ?? "") : "",
      claudeScrollTop: includeTranscriptSnapshots ? session.claudeScrollTop ?? 0 : 0,
      codexScrollTop: includeTranscriptSnapshots ? session.codexScrollTop ?? 0 : 0,
      geminiScrollTop: includeTranscriptSnapshots ? session.geminiScrollTop ?? 0 : 0,
      inputText: session.inputText ?? "",
      statusText: session.statusText ?? "Idle",
      deepVaultEnabled: session.deepVaultEnabled === true,
      claudeRequestedModel: typeof session.claudeRequestedModel === "string" ? session.claudeRequestedModel : null,
      claudeResolvedModel: typeof session.claudeResolvedModel === "string" ? session.claudeResolvedModel : null,
      agentTokenUsage: normalizeTokenUsage(session.agentTokenUsage),
      agentLastUsageText: session.agentLastUsageText ?? null,
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
    this.refreshAgentProviderUi();
    this.switchAgentTranscript(this.agentProvider);
    // Only a session with genuinely running work may surface a waiting/loading
    // status; anything else is a stale capture and renders as Idle.
    const savedStatus = session.statusText ?? "Idle";
    const hasLiveTurn = (!!session.agentPrintTurnRuntime && !session.agentPrintTurnRuntime.settled) || session.codexTurnActive === true;
    this.setAgentStatus(hasLiveTurn || !isStaleRestoredAgentStatus(savedStatus) ? savedStatus : "Idle");
    this.updateSendButtonMode();
    this.renderAttachmentChips();
    this.refreshAgentPromptActions();

    if (!this.claudeTranscriptEl?.innerHTML.trim() && !this.codexTranscriptEl?.innerHTML.trim() && !this.geminiTranscriptEl?.innerHTML.trim()) {
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: `${this.agentSessionLabel} 세션입니다. Claude 또는 Codex 중 하나를 시작하세요. 이 플러그인 안의 각 탭은 고유 Claude sessionId / Codex threadId를 유지합니다.`
      });
      this.captureActiveAgentSessionState();
    }
  }

  private mountVisibleAgentSessionTranscript() {
    if (!this.agentTranscriptMountEl || !this.claudeTranscriptEl || !this.codexTranscriptEl || !this.geminiTranscriptEl) {
      return;
    }

    const session = this.getActiveAgentSessionState();
    const claudeScrollTop = this.getReadableAgentTranscriptScrollTop(this.claudeTranscriptEl, session.claudeScrollTop ?? 0);
    const codexScrollTop = this.getReadableAgentTranscriptScrollTop(this.codexTranscriptEl, session.codexScrollTop ?? 0);
    const geminiScrollTop = this.getReadableAgentTranscriptScrollTop(this.geminiTranscriptEl, session.geminiScrollTop ?? 0);

    this.suppressAgentTranscriptScrollMemory = true;
    try {
      this.agentTranscriptMountEl.empty();
      this.agentTranscriptMountEl.appendChild(this.claudeTranscriptEl);
      this.agentTranscriptMountEl.appendChild(this.codexTranscriptEl);
      this.agentTranscriptMountEl.appendChild(this.geminiTranscriptEl);
      this.switchAgentTranscript(this.agentProvider);
      this.restoreAgentTranscriptScrollPositions(claudeScrollTop, codexScrollTop, geminiScrollTop);
    } finally {
      this.suppressAgentTranscriptScrollMemory = false;
    }
    this.syncTurnProgressTimer();
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
    } else if (el === this.geminiTranscriptEl) {
      if (this.isAgentTranscriptScrollReadable(el)) {
        session.geminiScrollTop = el.scrollTop;
      }
    }
  }

  private restoreAgentTranscriptScrollPositions(claudeScrollTop: number, codexScrollTop: number, geminiScrollTop: number) {
    this.withSuppressedAgentTranscriptScrollMemory(() => {
      this.setTranscriptScrollTop(this.claudeTranscriptEl, claudeScrollTop);
      this.setTranscriptScrollTop(this.codexTranscriptEl, codexScrollTop);
      this.setTranscriptScrollTop(this.geminiTranscriptEl, geminiScrollTop);
    });
    window.requestAnimationFrame(() => {
      this.withSuppressedAgentTranscriptScrollMemory(() => {
        this.setTranscriptScrollTop(this.claudeTranscriptEl, claudeScrollTop);
        this.setTranscriptScrollTop(this.codexTranscriptEl, codexScrollTop);
        this.setTranscriptScrollTop(this.geminiTranscriptEl, geminiScrollTop);
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
    const el = this.getProviderTranscriptEl(provider);
    const scrollTop = provider === "codex"
      ? session.codexScrollTop ?? el?.scrollTop ?? 0
      : provider === "gemini"
        ? session.geminiScrollTop ?? el?.scrollTop ?? 0
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
        this.remountVisibleAgentSessionTranscriptIfNeeded();
      }
    }
  }

  /**
   * Remount only when the mounted DOM actually diverged. Background sessions
   * bounce through withAgentSession every poll tick / stdout chunk, and an
   * unconditional remount here destroyed the user's text selection (and
   * nudged scroll) in the visible transcript every ~1.2s.
   */
  private remountVisibleAgentSessionTranscriptIfNeeded() {
    if (!this.isVisibleAgentSessionContext()) {
      return;
    }
    const mount = this.agentTranscriptMountEl;
    if (!mount) {
      return;
    }
    const els = [this.claudeTranscriptEl, this.codexTranscriptEl, this.geminiTranscriptEl];
    const inSync = mount.childElementCount === 3 && els.every((el) => !!el && el.parentElement === mount);
    if (!inSync) {
      this.mountVisibleAgentSessionTranscript();
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
        this.remountVisibleAgentSessionTranscriptIfNeeded();
      }
    }
  }

  private switchInternalAgentSession(sessionKey: string) {
    this.ensureInternalAgentSessions();
    if (sessionKey === this.activeAgentSessionKey) {
      this.autoStartActiveAgent();
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
    this.autoStartActiveAgent();
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
    if (closingActive) {
      this.autoStartActiveAgent();
    }
  }

  private isActiveAgentRunningOrReady(): boolean {
    return !!this.agentBackend ||
      !!this.agentHost ||
      (!!this.agentPrintTurnRuntime && !this.agentPrintTurnRuntime.settled) ||
      this.agentReadyForInput;
  }

  private autoStartActiveAgent() {
    const sessionKey = this.activeAgentSessionKey;
    if (!this.agentPaneEl || !sessionKey || this.agentStartRequestIds.has(sessionKey) || this.isActiveAgentRunningOrReady()) {
      return;
    }
    void this.startAgent(this.agentProvider);
  }

  private beginAgentStartRequest(sessionKey: string | null): number {
    const requestId = ++this.agentStartRequestCounter;
    if (sessionKey) {
      this.agentStartRequestIds.set(sessionKey, requestId);
    }
    return requestId;
  }

  private isAgentStartRequestCurrent(sessionKey: string | null, requestId: number): boolean {
    return !sessionKey || this.agentStartRequestIds.get(sessionKey) === requestId;
  }

  private completeAgentStartRequest(sessionKey: string | null, requestId: number) {
    if (sessionKey && this.agentStartRequestIds.get(sessionKey) === requestId) {
      this.agentStartRequestIds.delete(sessionKey);
    }
  }

  private cancelActiveAgentStartRequest() {
    if (this.activeAgentSessionKey) {
      this.agentStartRequestIds.delete(this.activeAgentSessionKey);
    }
  }

  openNewAgentSessionMenu(event?: MouseEvent) {
    const menu = new Menu();
    for (const choice of AGENT_PROVIDER_CHOICES) {
      menu.addItem((item) => {
        item
          .setTitle(choice.label)
          .setIcon(choice.icon)
          .onClick(() => this.createInternalAgentSession(choice.provider));
      });
    }

    if (event) {
      menu.showAtMouseEvent(event);
      return;
    }

    const rect = this.agentSessionAddButton?.getBoundingClientRect();
    menu.showAtPosition(rect
      ? { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
      : { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) });
  }

  private renderAgentSessionTabs() {
    if (!this.agentSessionTabsEl) {
      return;
    }

    this.ensureInternalAgentSessions();
    this.agentSessionTabsEl.empty();
    this.agentSessionAddButton = null;
    this.agentSessionTabEls.clear();

    const list = this.agentSessionTabsEl.createDiv({
      cls: "vault-agent-session-tab-list",
      attr: { role: "tablist", "aria-label": "AI sessions" }
    });
    for (const session of this.agentSessions) {
      const item = list.createDiv("vault-agent-session-tab-item");
      item.addClass(`vault-agent-session-tab-item-${session.agentProvider}`);
      item.toggleClass("is-active", session.agentSessionKey === this.activeAgentSessionKey);
      const tab = item.createEl("button", {
        cls: "vault-agent-session-tab",
        attr: {
          "aria-label": `AI session: ${session.agentSessionLabel}`,
          "aria-selected": String(session.agentSessionKey === this.activeAgentSessionKey),
          role: "tab",
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

    const add = list.createEl("button", {
      cls: "vault-agent-session-add",
      attr: {
        "aria-label": "New AI session",
        title: "New AI session"
      }
    });
    this.agentSessionAddButton = add;
    setIcon(add, "plus");
    add.addEventListener("click", (event) => {
      this.openNewAgentSessionMenu(event);
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

    this.agentSessionTitleInputEl = null;
    this.agentSessionSubtitleEl = null;
    this.agentStatusEl = null;

    const toolbar = container.createDiv("vault-agent-toolbar");
    const actions = toolbar.createDiv("vault-agent-actions");
    const startButton = actions.createEl("button", {
      cls: "vault-agent-action vault-agent-action-start",
      attr: { "aria-label": "Start", title: "Start" }
    });
    setIcon(startButton, "play");
    this.agentStartButton = startButton;
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
    this.codexStatusLineEl = null;
    this.agentPromptActionsEl = composer.createDiv("vault-agent-prompt-actions");
    this.refreshAgentPromptActions();
    this.activeNoteContextEl = composer.createDiv("vault-agent-active-note");
    this.renderActiveNoteContext();

    const inputShell = composer.createDiv("vault-agent-input-shell");
    this.agentInputEl = inputShell.createEl("textarea", {
      cls: "vault-agent-input",
      attr: {
        rows: "1",
        placeholder: "Message..."
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
    this.agentInputEl.addEventListener("focus", () => this.scheduleActiveNoteContextRefresh());
    this.refreshAgentProviderUi();

    this.codexAttachmentsEl = inputShell.createDiv("vault-agent-attachments is-hidden");

    // Provider options live inside the console, directly under the input box.
    // Model selection is intentionally list-based so users do not need to type
    // provider-specific model ids by hand.
    const optionsRow = composer.createDiv("vault-agent-options is-hidden");
    this.codexOptionsRow = optionsRow;
    this.claudeModelSelect = optionsRow.createEl("select", { cls: "vault-agent-option-select", attr: { "aria-label": "Claude model" } });
    this.claudeCustomModelInput = optionsRow.createEl("input", {
      cls: "vault-agent-custom-model-input is-hidden",
      attr: {
        type: "text",
        "aria-label": "Custom Claude model ID",
        placeholder: "claude-opus-5",
        autocomplete: "off",
        spellcheck: "false"
      }
    });
    this.claudeResolvedModelEl = optionsRow.createSpan("vault-agent-resolved-model is-hidden");
    this.claudeEffortSelect = optionsRow.createEl("select", { cls: "vault-agent-option-select", attr: { "aria-label": "Claude effort" } });
    for (const opt of CLAUDE_EFFORT_CHOICES) {
      this.claudeEffortSelect.createEl("option", { value: opt.value, text: opt.label });
    }
    this.claudePermissionSelect = optionsRow.createEl("select", { cls: "vault-agent-option-select", attr: { "aria-label": "Claude permission mode" } });
    for (const opt of CLAUDE_PERMISSION_MODE_CHOICES) {
      this.claudePermissionSelect.createEl("option", { value: opt.value, text: opt.label });
    }
    this.codexModelSelect = optionsRow.createEl("select", { cls: "vault-agent-option-select", attr: { "aria-label": "Model" } });
    this.codexEffortSelect = optionsRow.createEl("select", { cls: "vault-agent-option-select", attr: { "aria-label": "Reasoning effort" } });
    this.codexAccessSelect = optionsRow.createEl("select", { cls: "vault-agent-option-select", attr: { "aria-label": "Access level" } });
    this.geminiModelSelect = optionsRow.createEl("select", { cls: "vault-agent-option-select", attr: { "aria-label": "Antigravity model" } });
    this.geminiApprovalSelect = optionsRow.createEl("select", { cls: "vault-agent-option-select", attr: { "aria-label": "Antigravity approval mode" } });
    this.deepVaultButton = optionsRow.createEl("button", {
      cls: "vault-agent-deep-vault-toggle",
      attr: {
        type: "button",
        "aria-label": "Enable Deep Vault",
        "aria-pressed": "false",
        title: "Search the indexed vault thoroughly before answering"
      }
    });
    setIcon(this.deepVaultButton, "database");
    this.deepVaultButton.createSpan({ text: "Deep Vault" });
    this.agentTokenUsageEl = optionsRow.createDiv("vault-agent-token-usage");
    this.agentTokenUsageEl.createSpan({ cls: "vault-agent-token-label", text: "IN" });
    this.agentTokenInputValueEl = this.agentTokenUsageEl.createSpan({ cls: "vault-agent-token-value", text: "—" });
    this.agentTokenUsageEl.createSpan({ cls: "vault-agent-token-separator", text: "·" });
    this.agentTokenUsageEl.createSpan({ cls: "vault-agent-token-label", text: "OUT" });
    this.agentTokenOutputValueEl = this.agentTokenUsageEl.createSpan({ cls: "vault-agent-token-value", text: "—" });
    this.codexModelSelect.createEl("option", { value: "", text: "Codex default" });
    this.codexEffortSelect.createEl("option", { value: "", text: "Effort default" });
    for (const opt of [{ v: "read-only", t: "Read-only" }, { v: "auto", t: "Auto (write)" }, { v: "full", t: "Full access" }]) {
      this.codexAccessSelect.createEl("option", { value: opt.v, text: opt.t });
    }
    for (const opt of getGeminiModelChoices(this.plugin.settings)) {
      this.geminiModelSelect.createEl("option", { value: opt.value, text: opt.label });
    }
    for (const opt of GEMINI_APPROVAL_MODE_CHOICES) {
      this.geminiApprovalSelect.createEl("option", { value: opt.value, text: opt.label });
    }
    this.codexAccessSelect.value = "full";
    this.claudeModelSelect.addEventListener("change", () => this.onClaudeModelChange());
    this.claudeCustomModelInput.addEventListener("input", () => this.onClaudeCustomModelInput());
    this.claudeCustomModelInput.addEventListener("change", () => {
      void this.plugin.saveSettings();
      this.refreshClaudeModelControl();
      this.saveAgentViewState();
    });
    this.claudeCustomModelInput.addEventListener("keydown", (event) => {
      if (isEnterKey(event) && !event.isComposing) {
        event.preventDefault();
        this.claudeCustomModelInput?.blur();
        this.agentInputEl?.focus();
      }
    });
    this.claudeEffortSelect.addEventListener("change", () => this.onClaudeEffortChange());
    this.claudePermissionSelect.addEventListener("change", () => this.onClaudePermissionModeChange());
    this.codexModelSelect.addEventListener("change", () => this.onCodexModelChange());
    this.codexEffortSelect.addEventListener("change", () => this.applyCodexTurnOptions());
    this.codexAccessSelect.addEventListener("change", () => this.applyCodexTurnOptions());
    this.geminiModelSelect.addEventListener("change", () => this.onGeminiModelChange());
    this.geminiApprovalSelect.addEventListener("change", () => this.onGeminiApprovalModeChange());
    this.deepVaultButton.addEventListener("click", () => this.toggleDeepVault());
    this.refreshAgentOptionsRow();

    const inputActions = inputShell.createDiv("vault-agent-input-actions");
    const fileInput = inputActions.createEl("input", { cls: "vault-agent-file-input", attr: { type: "file", multiple: "true" } });
    const attachButton = inputActions.createEl("button", {
      cls: "vault-agent-input-icon vault-agent-attach-button",
      attr: { "aria-label": "Attach files", title: "Attach files", type: "button" }
    });
    setIcon(attachButton, "paperclip");
    this.agentAttachButton = attachButton;
    attachButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const files = Array.from(fileInput.files ?? []);
      fileInput.value = "";
      void this.addAgentAttachments(files);
    });
    const voiceButton = inputActions.createEl("button", {
      cls: "vault-agent-input-icon vault-agent-voice-button",
      attr: { "aria-label": "Start voice recording", title: "Start voice recording", type: "button" }
    });
    setIcon(voiceButton, "mic");
    this.voiceButton = voiceButton;
    voiceButton.addEventListener("click", () => {
      if (this.voiceCaptureState === "recording") {
        this.stopVoiceRecording();
      } else if (this.voiceCaptureState === "idle") {
        void this.startVoiceRecording();
      }
    });
    this.voiceStatusEl = inputActions.createSpan("vault-agent-voice-status is-hidden");
    this.refreshVoiceCaptureUi();
    inputActions.createDiv("vault-agent-input-actions-spacer");
    const sendButton = inputActions.createEl("button", {
      cls: "vault-agent-input-icon vault-agent-send-button mod-cta",
      attr: { "aria-label": "Send message", title: "Send message", type: "button" }
    });
    setIcon(sendButton, "arrow-up");
    this.agentSendButton = sendButton;
    sendButton.addEventListener("click", () => {
      // While an agent is answering, Send acts as Stop.
      if (this.agentPrintTurnRuntime) {
        this.killActivePrintTurn("stopped");
      } else if (this.agentBackend && this.codexTurnActive) {
        void this.agentBackend.interrupt();
      } else {
        void this.sendAgentInput();
      }
    });

    this.restoreActiveAgentSessionDom();
    this.renderAgentSessionTabs();
  }

  private refreshAgentProviderUi() {
    if (!this.isVisibleAgentSessionContext()) {
      return;
    }
    this.agentInputEl?.setAttr("placeholder", `Message ${getAgentProviderLabel(this.agentProvider)}...`);
    this.refreshAgentStartButton();
    this.refreshAgentOptionsRow();
    this.refreshCodexStatusLine();
  }

  private refreshAgentStartButton() {
    const button = this.agentStartButton;
    if (!button || !this.isVisibleAgentSessionContext()) {
      return;
    }
    const status = this.agentStatusText.trim();
    const unavailable = this.agentNeedsAuth || /^(?:Idle|Failed|Exited\b)/i.test(status);
    const active = !unavailable && (
      this.agentReadyForInput ||
      this.agentConversationReady ||
      this.agentAuthState === "authenticated" ||
      this.agentAuthState === "ready"
    );
    const sessionKey = this.activeAgentSessionKey;
    const starting = !active && !this.agentNeedsAuth && (
      (!!sessionKey && this.agentStartRequestIds.has(sessionKey)) ||
      this.agentAuthState === "checking" ||
      this.agentAuthState === "login-in-progress" ||
      (!!this.agentHost && !this.agentReadyForInput) ||
      (!!this.agentBackend && !this.agentReadyForInput)
    );
    const label = getAgentProviderLabel(this.agentProvider);
    const stateLabel = active ? `${label} ready` : starting ? `Starting ${label}` : `Start ${label}`;
    button.toggleClass("is-active", active);
    button.toggleClass("is-starting", starting);
    button.setAttr("aria-pressed", String(active));
    button.setAttr("aria-label", stateLabel);
    button.setAttr("title", stateLabel);
  }

  private refreshAgentOptionsRow() {
    if (!this.codexOptionsRow) {
      return;
    }
    this.refreshAgentModelControls();
    this.codexOptionsRow.toggleClass("is-hidden", false);
    const isClaude = this.agentProvider === "claude";
    const isCodex = this.agentProvider === "codex";
    const isGemini = this.agentProvider === "gemini";
    this.claudeModelSelect?.toggleClass("is-hidden", !isClaude);
    this.claudeEffortSelect?.toggleClass("is-hidden", !isClaude);
    this.claudePermissionSelect?.toggleClass("is-hidden", !isClaude);
    this.codexModelSelect?.toggleClass("is-hidden", !isCodex);
    this.codexEffortSelect?.toggleClass("is-hidden", !isCodex);
    this.codexAccessSelect?.toggleClass("is-hidden", !isCodex);
    this.geminiModelSelect?.toggleClass("is-hidden", !isGemini);
    this.geminiApprovalSelect?.toggleClass("is-hidden", !isGemini);
    const customClaudeModel = this.claudeModelSelect?.value === CLAUDE_CUSTOM_MODEL_VALUE;
    this.claudeCustomModelInput?.toggleClass("is-hidden", !isClaude || !customClaudeModel);
    this.claudeResolvedModelEl?.toggleClass("is-hidden", !isClaude || !this.getCurrentClaudeResolvedModel());
    const supportsDeepVault = isClaude || isCodex;
    this.deepVaultButton?.toggleClass("is-hidden", !supportsDeepVault);
    this.agentTokenUsageEl?.toggleClass("is-hidden", !supportsDeepVault);
    this.refreshDeepVaultButton();
    this.refreshAgentTokenUsage();
  }

  private toggleDeepVault() {
    if (this.agentProvider !== "claude" && this.agentProvider !== "codex") {
      return;
    }
    const session = this.getActiveAgentSessionState();
    session.deepVaultEnabled = session.deepVaultEnabled !== true;
    session.updatedAt = Date.now();
    this.refreshDeepVaultButton();
    this.captureActiveAgentSessionState();
    this.saveAgentViewState();
  }

  private refreshDeepVaultButton() {
    const button = this.deepVaultButton;
    if (!button || !this.isVisibleAgentSessionContext()) {
      return;
    }
    const supported = this.agentProvider === "claude" || this.agentProvider === "codex";
    const enabled = supported && this.getActiveAgentSessionState().deepVaultEnabled === true;
    const stateLabel = enabled ? "Deep Vault on" : "Deep Vault off";
    button.toggleClass("is-active", enabled);
    button.setAttr("aria-pressed", String(enabled));
    button.setAttr("aria-label", stateLabel);
    button.setAttr(
      "title",
      enabled
        ? "Deep Vault on: iterative vault retrieval is added to this tab's prompts"
        : "Deep Vault off: enable thorough indexed-vault retrieval for this tab"
    );
  }

  private setAgentTokenUsage(value: TokenUsage | null) {
    this.agentTokenUsage = normalizeTokenUsage(value);
    this.refreshAgentTokenUsage();
  }

  private refreshAgentTokenUsage() {
    const container = this.agentTokenUsageEl;
    if (!container || !this.isVisibleAgentSessionContext()) {
      return;
    }
    const supported = this.agentProvider === "claude" || this.agentProvider === "codex";
    container.toggleClass("is-hidden", !supported);
    if (!supported) {
      return;
    }

    const usage = this.agentTokenUsage;
    if (this.agentTokenInputValueEl) {
      this.agentTokenInputValueEl.textContent = formatCompactTokenValue(usage?.input);
    }
    if (this.agentTokenOutputValueEl) {
      this.agentTokenOutputValueEl.textContent = formatCompactTokenValue(usage?.output);
    }

    const live = this.codexTurnActive ||
      this.agentClaudePrintTurnActive ||
      (this.agentPrintTurnRuntime?.provider === "claude" && !this.agentPrintTurnRuntime.settled);
    container.toggleClass("is-live", live);
    container.setAttr("aria-live", live ? "polite" : "off");
    container.setAttr("title", formatTokenUsageTitle(usage, live));
  }

  private refreshAgentModelControls() {
    this.refreshClaudeModelControl();
    setSelectChoices(this.claudeEffortSelect, CLAUDE_EFFORT_CHOICES, this.plugin.settings.claudeEffort, "Saved");
    setSelectChoices(this.claudePermissionSelect, CLAUDE_PERMISSION_MODE_CHOICES, this.plugin.settings.claudePermissionMode, "Saved");
    setSelectChoices(this.geminiModelSelect, getGeminiModelChoices(this.plugin.settings), this.plugin.settings.geminiModel, "Saved");
    setSelectChoices(this.geminiApprovalSelect, GEMINI_APPROVAL_MODE_CHOICES, this.plugin.settings.geminiApprovalMode, "Saved");
    this.refreshCodexModelSelect();
  }

  private refreshClaudeModelControl() {
    const select = this.claudeModelSelect;
    if (!select || !this.isVisibleAgentSessionContext()) {
      return;
    }
    const configured = this.plugin.settings.claudeModel.trim();
    const custom = !isKnownClaudeModelChoice(configured);
    const resolved = this.getCurrentClaudeResolvedModel();
    select.empty();

    const latestGroup = select.createEl("optgroup", { attr: { label: "Latest aliases" } });
    for (const choice of CLAUDE_LATEST_MODEL_CHOICES) {
      latestGroup.createEl("option", {
        value: choice.value,
        text: getClaudeModelChoiceLabel(choice, configured, resolved)
      });
    }
    const pinnedGroup = select.createEl("optgroup", { attr: { label: "Pinned versions" } });
    for (const choice of CLAUDE_PINNED_MODEL_CHOICES) {
      pinnedGroup.createEl("option", { value: choice.value, text: choice.label });
    }
    select.createEl("option", { value: CLAUDE_CUSTOM_MODEL_VALUE, text: "Custom model ID..." });
    select.value = custom ? CLAUDE_CUSTOM_MODEL_VALUE : configured;

    if (this.claudeCustomModelInput) {
      if (custom && this.claudeCustomModelInput.value !== configured) {
        this.claudeCustomModelInput.value = configured;
      }
      this.claudeCustomModelInput.toggleClass("is-hidden", this.agentProvider !== "claude" || !custom);
    }
    this.refreshClaudeResolvedModel();
  }

  private getCurrentClaudeResolvedModel(): string | null {
    const session = this.getActiveAgentSessionState();
    const requested = this.plugin.settings.claudeModel.trim();
    return session.claudeRequestedModel === requested && typeof session.claudeResolvedModel === "string"
      ? session.claudeResolvedModel
      : null;
  }

  private setClaudeResolvedModel(requestedModel: string, resolvedModel: string) {
    const resolved = resolvedModel.trim();
    if (!resolved) {
      return;
    }
    const session = this.getActiveAgentSessionState();
    const requested = requestedModel.trim();
    if (session.claudeRequestedModel === requested && session.claudeResolvedModel === resolved) {
      return;
    }
    session.claudeRequestedModel = requested;
    session.claudeResolvedModel = resolved;
    session.updatedAt = Date.now();
    if (this.isVisibleAgentSessionContext()) {
      this.refreshClaudeModelControl();
    }
  }

  private refreshClaudeResolvedModel() {
    const element = this.claudeResolvedModelEl;
    if (!element || !this.isVisibleAgentSessionContext()) {
      return;
    }
    const resolved = this.agentProvider === "claude" ? this.getCurrentClaudeResolvedModel() : null;
    element.toggleClass("is-hidden", !resolved);
    if (!resolved) {
      element.textContent = "";
      element.removeAttribute("title");
      return;
    }
    const requested = this.plugin.settings.claudeModel.trim() || "default";
    element.textContent = `Using ${formatClaudeModelDisplayName(resolved)}`;
    element.setAttr("title", `Requested ${requested} | resolved ${resolved}`);
  }

  private getDefaultCodexModel(): AgentModelInfo | undefined {
    return this.codexModels.find((model) => model.isDefault) ?? this.codexModels[0];
  }

  private refreshCodexModelSelect() {
    if (!this.codexModelSelect) {
      return;
    }
    const configured = this.plugin.settings.codexModel.trim();
    const defaultModel = this.getDefaultCodexModel();
    this.codexModelSelect.empty();
    this.codexModelSelect.createEl("option", {
      value: "",
      text: defaultModel ? `${defaultModel.displayName} (default)` : "Codex default"
    });
    for (const model of this.codexModels) {
      const role = CODEX_MODEL_ROLE_LABELS[model.id.toLowerCase()];
      const label = role ? `${model.displayName} (${role})` : model.displayName;
      this.codexModelSelect.createEl("option", { value: model.id, text: label });
    }
    if (configured && !selectHasOption(this.codexModelSelect, configured)) {
      this.codexModelSelect.createEl("option", { value: configured, text: `Saved: ${configured}` });
    }
    this.codexModelSelect.value = configured;
  }

  private onClaudeModelChange() {
    const selected = this.claudeModelSelect?.value ?? "";
    if (selected === CLAUDE_CUSTOM_MODEL_VALUE) {
      if (this.claudeCustomModelInput) {
        this.claudeCustomModelInput.value = isKnownClaudeModelChoice(this.plugin.settings.claudeModel)
          ? ""
          : this.plugin.settings.claudeModel;
        this.claudeCustomModelInput.removeClass("is-hidden");
        this.claudeCustomModelInput.focus();
        this.claudeCustomModelInput.select();
      }
      this.claudeResolvedModelEl?.addClass("is-hidden");
      return;
    }
    this.plugin.settings.claudeModel = selected;
    this.claudeCustomModelInput?.addClass("is-hidden");
    void this.plugin.saveSettings();
    this.refreshClaudeModelControl();
    this.refreshCodexStatusLine();
    this.saveAgentViewState();
  }

  private onClaudeCustomModelInput() {
    const value = this.claudeCustomModelInput?.value.trim() ?? "";
    this.plugin.settings.claudeModel = value;
    this.refreshClaudeResolvedModel();
    this.refreshCodexStatusLine();
  }

  private onClaudeEffortChange() {
    this.plugin.settings.claudeEffort = normalizeClaudeEffort(this.claudeEffortSelect?.value);
    if (this.claudeEffortSelect) {
      this.claudeEffortSelect.value = this.plugin.settings.claudeEffort;
    }
    void this.plugin.saveSettings();
    this.refreshCodexStatusLine();
    this.saveAgentViewState();
  }

  private onClaudePermissionModeChange() {
    this.plugin.settings.claudePermissionMode = normalizeClaudePermissionMode(this.claudePermissionSelect?.value);
    if (this.claudePermissionSelect) {
      this.claudePermissionSelect.value = this.plugin.settings.claudePermissionMode;
    }
    void this.plugin.saveSettings();
    this.refreshCodexStatusLine();
    this.saveAgentViewState();
  }

  private onGeminiModelChange() {
    this.plugin.settings.geminiModel = normalizeGeminiModelInput(this.geminiModelSelect?.value) || DEFAULT_SETTINGS.geminiModel;
    if (this.geminiModelSelect) {
      this.geminiModelSelect.value = this.plugin.settings.geminiModel;
    }
    void this.plugin.saveSettings();
    this.refreshCodexStatusLine();
    this.saveAgentViewState();
  }

  private onGeminiApprovalModeChange() {
    this.plugin.settings.geminiApprovalMode = normalizeGeminiApprovalMode(this.geminiApprovalSelect?.value);
    if (this.geminiApprovalSelect) {
      this.geminiApprovalSelect.value = this.plugin.settings.geminiApprovalMode;
    }
    void this.plugin.saveSettings();
    this.refreshCodexStatusLine();
    this.saveAgentViewState();
  }

  private getProviderTranscriptEl(provider: AgentProvider): HTMLElement | null {
    if (provider === "codex") {
      return this.codexTranscriptEl;
    }
    if (provider === "gemini") {
      return this.geminiTranscriptEl;
    }
    return this.claudeTranscriptEl;
  }

  // Show only the active provider's transcript; each keeps its own conversation.
  private switchAgentTranscript(provider: AgentProvider) {
    const previousProvider = this.agentTranscriptEl === this.codexTranscriptEl
      ? "codex"
      : this.agentTranscriptEl === this.geminiTranscriptEl
        ? "gemini"
        : this.agentTranscriptEl === this.claudeTranscriptEl
          ? "claude"
          : null;
    if (this.agentTranscriptEl) {
      this.rememberAgentTranscriptScrollPosition(this.agentTranscriptEl);
    }
    this.claudeTranscriptEl?.toggleClass("is-hidden", provider !== "claude");
    this.codexTranscriptEl?.toggleClass("is-hidden", provider !== "codex");
    this.geminiTranscriptEl?.toggleClass("is-hidden", provider !== "gemini");
    this.agentTranscriptEl = this.getProviderTranscriptEl(provider);
    this.restoreVisibleAgentTranscriptScrollPosition(provider);
    // Restore/render paths can call this with the same provider while a Codex
    // turn is still streaming. Preserve the current turn in that case; otherwise
    // later system/tool events lose their parent card and render as top-level
    // boxes.
    if (previousProvider !== provider) {
      this.codexCurrentTurnEl = null;
      this.codexCurrentAnswerEl = null;
      this.codexTurnLoadingEl = null;
      this.stopTurnProgressTimer();
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
      case "status": {
        const statusText = formatBackendStatus(event.state, event.detail);
        if (event.state === "ready") {
          this.agentReadyForInput = true;
          this.agentNeedsAuth = false;
          this.agentAuthState = "ready";
          this.agentConversationReady = true;
          if (this.codexTurnActive) {
            this.finishCodexTurn("Codex ready", true);
          }
        } else if (event.state === "stopped" || event.state === "error" || event.state === "idle") {
          this.agentReadyForInput = false;
          this.agentConversationReady = false;
          this.agentNeedsAuth = false;
          this.agentAuthState = "idle";
          if (this.codexTurnActive || this.codexTurnLoadingEl) {
            this.finishCodexTurn(statusText, false);
          }
        }
        this.setAgentStatus(statusText);
        break;
      }
      case "auth-required":
        this.agentReadyForInput = false;
        this.agentConversationReady = false;
        this.agentNeedsAuth = true;
        this.agentAuthState = "login-required";
        this.setAgentStatus("Codex login required");
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: "Codex is not signed in. Run `codex login` in an external terminal, then press Start again."
        });
        break;
      case "auth-url":
        this.agentReadyForInput = false;
        this.agentConversationReady = false;
        this.agentNeedsAuth = true;
        this.agentAuthState = "login-in-progress";
        this.setAgentStatus("Codex login in progress");
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
        if (event.tokenUsage) {
          this.setAgentTokenUsage(event.tokenUsage);
        }
        this.finishCodexTurn("Codex ready", true);
        break;
      case "usage-update":
        if ("contextPercent" in event) {
          this.codexContextPercent = event.contextPercent ?? null;
        }
        if (event.rateLimits) {
          this.codexRateLimitWindows = event.rateLimits;
        }
        if (event.tokenUsage) {
          this.setAgentTokenUsage(event.tokenUsage);
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
  private startCodexTurn(question: string, forceScrollToBottom = false): HTMLElement | null {
    if (!this.agentTranscriptEl) {
      return null;
    }
    const shouldStickToBottom = forceScrollToBottom || this.shouldAutoScrollAgentTranscript();
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
    if (forceScrollToBottom) {
      this.scrollVisibleAgentTranscriptToBottomAfterLayout();
    } else if (shouldStickToBottom) {
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

  private scrollVisibleAgentTranscriptToBottomAfterLayout() {
    const transcript = this.agentTranscriptEl;
    if (!transcript) {
      return;
    }
    const scroll = () => {
      if (this.agentTranscriptEl !== transcript || !transcript.isConnected || transcript.hasClass("is-hidden")) {
        return;
      }
      this.scrollAgentTranscriptToBottom(transcript);
    };
    scroll();
    window.requestAnimationFrame(scroll);
  }

  private initializeActiveNoteTracking() {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView?.file) {
      this.activeNoteView = activeView;
      this.activeNoteFile = activeView.file;
    } else {
      this.activeNoteFile = this.app.workspace.getActiveFile();
    }

    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof MarkdownView && leaf.view.file) {
        this.activeNoteView = leaf.view;
        this.activeNoteFile = leaf.view.file;
      }
      this.scheduleActiveNoteContextRefresh();
    }));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file) {
        this.activeNoteFile = file;
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        this.activeNoteView = markdownView?.file?.path === file.path ? markdownView : null;
      }
      this.scheduleActiveNoteContextRefresh();
    }));
    this.registerEvent(this.app.workspace.on("editor-change", (editor, info) => {
      if (info instanceof MarkdownView && info.file && info.editor === editor) {
        this.activeNoteView = info;
        this.activeNoteFile = info.file;
      }
      this.scheduleActiveNoteContextRefresh();
    }));
    this.registerEvent(this.app.vault.on("rename", (file) => {
      if (file === this.activeNoteFile) {
        this.scheduleActiveNoteContextRefresh();
      }
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file === this.activeNoteFile) {
        this.activeNoteFile = null;
        this.activeNoteView = null;
        this.scheduleActiveNoteContextRefresh();
      }
    }));
    this.registerDomEvent(document, "selectionchange", () => this.scheduleActiveNoteContextRefresh());
    this.scheduleActiveNoteContextRefresh();
  }

  private scheduleActiveNoteContextRefresh() {
    if (this.activeNoteRefreshFrame !== null) {
      return;
    }
    this.activeNoteRefreshFrame = window.requestAnimationFrame(() => {
      this.activeNoteRefreshFrame = null;
      this.renderActiveNoteContext();
    });
  }

  private readActiveNoteContextSnapshot(): ActiveNoteContextSnapshot | null {
    const file = this.activeNoteFile ?? this.app.workspace.getActiveFile();
    if (!file || !(this.app.vault.getAbstractFileByPath(file.path) instanceof TFile)) {
      return null;
    }

    let selection = "";
    let selectionTruncated = false;
    let selectionStartLine: number | undefined;
    let selectionEndLine: number | undefined;
    let cursorLine: number | undefined;
    let cursorLineText: string | undefined;
    const view = this.activeNoteView;
    if (view?.file?.path === file.path) {
      try {
        const rawSelection = view.editor.getSelection().trim();
        selectionTruncated = rawSelection.length > ACTIVE_NOTE_SELECTION_MAX_CHARS;
        selection = selectionTruncated
          ? `${rawSelection.slice(0, ACTIVE_NOTE_SELECTION_MAX_CHARS).trimEnd()}\n[selection truncated]`
          : rawSelection;
        const from = view.editor.getCursor("from");
        const to = view.editor.getCursor("to");
        const cursor = view.editor.getCursor("head");
        selectionStartLine = rawSelection ? from.line + 1 : undefined;
        selectionEndLine = rawSelection ? to.line + 1 : undefined;
        cursorLine = cursor.line + 1;
        cursorLineText = view.editor.getLine(cursor.line).trim();
      } catch {
        // Preview and non-editor views still share the active file path.
      }
    }

    return {
      path: normalizePath(file.path),
      name: file.name,
      selection,
      selectionTruncated,
      selectionStartLine,
      selectionEndLine,
      cursorLine,
      cursorLineText
    };
  }

  private getSharedActiveNoteContextSnapshot(): ActiveNoteContextSnapshot | null {
    return this.activeNoteSharingEnabled ? this.readActiveNoteContextSnapshot() : null;
  }

  private renderActiveNoteContext() {
    const container = this.activeNoteContextEl;
    if (!container) {
      return;
    }

    const snapshot = this.readActiveNoteContextSnapshot();
    container.empty();
    container.removeAttribute("title");
    container.toggleClass("is-empty", !snapshot);
    container.toggleClass("is-unlinked", !!snapshot && !this.activeNoteSharingEnabled);

    const fileIcon = container.createDiv("vault-agent-active-note-icon");
    setIcon(fileIcon, snapshot ? "file-text" : "file-question");
    const text = container.createDiv("vault-agent-active-note-text");
    if (!snapshot) {
      text.createDiv({ cls: "vault-agent-active-note-name", text: "No note open" });
      return;
    }

    text.createDiv({ cls: "vault-agent-active-note-name", text: snapshot.name });
    text.createDiv({ cls: "vault-agent-active-note-path", text: snapshot.path });
    container.setAttr("title", snapshot.path);

    if (snapshot.selection) {
      const selectedLines = Math.max(1, (snapshot.selectionEndLine ?? 1) - (snapshot.selectionStartLine ?? 1) + 1);
      const selection = container.createDiv("vault-agent-active-note-selection");
      setIcon(selection.createSpan(), "text-select");
      selection.createSpan({ text: `${selectedLines} line${selectedLines === 1 ? "" : "s"}` });
    } else if (snapshot.cursorLine) {
      const cursor = container.createDiv("vault-agent-active-note-selection");
      setIcon(cursor.createSpan(), "hash");
      cursor.createSpan({ text: String(snapshot.cursorLine) });
    }

    const toggle = container.createEl("button", {
      cls: "vault-agent-active-note-toggle",
      attr: {
        type: "button",
        "aria-label": this.activeNoteSharingEnabled ? "Stop sharing current note" : "Share current note with messages",
        title: this.activeNoteSharingEnabled ? "Current note is shared with messages" : "Current note is not shared"
      }
    });
    setIcon(toggle, this.activeNoteSharingEnabled ? "link-2" : "unlink");
    toggle.addEventListener("click", () => {
      this.activeNoteSharingEnabled = !this.activeNoteSharingEnabled;
      this.renderActiveNoteContext();
      this.agentInputEl?.focus();
    });
  }

  private withActiveNoteAttachment(
    attachments: AgentAttachment[],
    activeNoteContext: ActiveNoteContextSnapshot | null
  ): AgentAttachment[] {
    if (!activeNoteContext) {
      return attachments;
    }
    const vaultRoot = this.plugin.getVaultPath();
    const notePath = vaultRoot
      ? join(vaultRoot, ...activeNoteContext.path.split("/"))
      : activeNoteContext.path;
    const normalizeForComparison = (value: string) => {
      const normalized = value.replace(/\\/g, "/");
      return process.platform === "win32" ? normalized.toLowerCase() : normalized;
    };
    const comparableNotePath = normalizeForComparison(notePath);
    if (attachments.some((attachment) => normalizeForComparison(attachment.path) === comparableNotePath)) {
      return attachments;
    }
    return [...attachments, {
      kind: /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(activeNoteContext.path) ? "localImage" : "mention",
      path: notePath,
      name: activeNoteContext.name,
      contextRole: "active-note"
    }];
  }

  private buildContextualAgentPrompt(
    text: string,
    activeNoteContext: ActiveNoteContextSnapshot | null = this.getSharedActiveNoteContextSnapshot()
  ): string {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith("/")) {
      return text;
    }

    const runtimeContext = this.getAgentRuntimeContextText();
    const activeNoteContextText = this.getActiveNoteReferenceContextText(activeNoteContext);
    const context = this.shouldAttachTranscriptContextToPrompt()
      ? this.getAgentTranscriptContextText()
      : "";
    if (!runtimeContext && !activeNoteContextText && !context) {
      return text;
    }

    const sections: string[] = [];
    if (runtimeContext) {
      sections.push("[현재 실행 설정]", runtimeContext, "");
    }
    if (activeNoteContextText) {
      sections.push("[함께 보고 있는 Obsidian 문서]", activeNoteContextText, "");
    }
    if (context) {
      sections.push(
        "[이전 대화 컨텍스트]",
        "아래는 같은 Obst Terminal AI 세션의 이전 transcript입니다. 이 내용을 현재 대화의 맥락으로 간주하고 이어서 답하세요.",
        context,
        ""
      );
    }
    sections.push("[현재 사용자 요청]", text);
    return sections.join("\n");
  }

  private getActiveNoteReferenceContextText(activeNoteContext: ActiveNoteContextSnapshot | null): string {
    if (!activeNoteContext) {
      return "";
    }
    const lines = [
      "이 문서는 사용자가 현재 Obsidian에서 열어 두고 에이전트와 함께 보고 있는 문서입니다.",
      "사용자는 문서명을 명시하지 않고도 ‘이거’, ‘이게’, ‘여기’, ‘이 부분’, ‘보니까’처럼 암시적으로 이 문서나 선택 영역을 지칭할 수 있습니다.",
      "요청이 이 문서와 관련되어 있으면 선택 영역을 우선하고, 선택 영역이 없으면 현재 문서를 읽은 뒤 답하세요. 관련 없는 요청에서는 문서를 억지로 끌어오지 마세요.",
      `현재 문서 경로: ${activeNoteContext.path}`,
      `문서 참조: ${formatVaultFileReference(activeNoteContext.path)}`
    ];
    if (activeNoteContext.selection) {
      const range = activeNoteContext.selectionStartLine
        ? ` (${activeNoteContext.selectionStartLine}-${activeNoteContext.selectionEndLine ?? activeNoteContext.selectionStartLine}행)`
        : "";
      lines.push(
        `사용자가 선택한 문서 영역${range}:`,
        "---",
        activeNoteContext.selection,
        "---"
      );
    } else if (activeNoteContext.cursorLine && activeNoteContext.cursorLineText) {
      lines.push(
        `현재 커서 위치: ${activeNoteContext.cursorLine}행`,
        `현재 커서 줄: ${activeNoteContext.cursorLineText}`
      );
    }
    return lines.join("\n");
  }

  private getAgentRuntimeContextText(): string {
    if (this.agentProvider === "gemini") {
      const antigravity = isAntigravityCli(this.plugin.settings);
      const configuredModel = this.plugin.settings.geminiModel || DEFAULT_SETTINGS.geminiModel;
      const resolvedModel = getGeminiModelResolutionLabel(configuredModel);
      return [
        antigravity ? "Provider: Antigravity CLI" : "Provider: Gemini CLI (legacy)",
        `Configured --model: ${configuredModel || "default"}`,
        resolvedModel !== configuredModel ? `Model alias resolution: ${configuredModel} -> ${resolvedModel}` : "",
        antigravity
          ? "Session mode: plugin transcript context"
          : `Session mode: ${this.plugin.settings.geminiUseNativeSession ? `native ${this.agentGeminiNativeSessionStarted ? "resume" : "new"}` : "plugin transcript context"}`,
        antigravity ? "" : `Output format: ${this.plugin.settings.geminiOutputFormat}`,
        `Approval mode: ${this.plugin.settings.geminiApprovalMode}`,
        "If the user asks which LLM/model is in use, answer from this runtime setting rather than from model self-introspection."
      ].filter(Boolean).join("\n");
    }

    if (this.agentProvider === "claude") {
      const deepVaultContext = this.getDeepVaultRuntimeContextText();
      const resolvedModel = this.getCurrentClaudeResolvedModel();
      return [
        "Provider: Claude Code",
        `Configured --model: ${this.plugin.settings.claudeModel || "Claude Code default"}`,
        resolvedModel ? `Resolved model: ${resolvedModel} (${formatClaudeModelDisplayName(resolvedModel)})` : "",
        `Effort: ${this.plugin.settings.claudeEffort || "default"}`,
        `Permission mode: ${this.plugin.settings.claudePermissionMode}`,
        "If the user asks which LLM/model is in use, answer from this runtime setting rather than from model self-introspection.",
        deepVaultContext
      ].filter(Boolean).join("\n");
    }

    if (this.agentProvider === "codex") {
      const deepVaultContext = this.getDeepVaultRuntimeContextText();
      return [
        "Provider: Codex",
        `Configured model: ${this.codexModelSelect?.value || this.plugin.settings.codexModel || "Codex default"}`,
        `Access level: ${this.codexAccessSelect?.value || "default"}`,
        deepVaultContext
      ].filter(Boolean).join("\n");
    }

    return "";
  }

  private getDeepVaultRuntimeContextText(): string {
    const supported = this.agentProvider === "claude" || this.agentProvider === "codex";
    if (!supported || this.getActiveAgentSessionState().deepVaultEnabled !== true) {
      return "";
    }
    return [
      "Deep Vault workflow profile: enabled. This is a plugin retrieval workflow, not a native model or reasoning tier.",
      "Before drafting the answer, investigate the indexed vault for relevant evidence.",
      "Use the seegene-vault-context skill when available. Otherwise run `obst-indexer status`, then use focused `obst-indexer search \"<query>\" --limit 8` queries.",
      "Refresh the index only when it is missing or stale; do not rescan the vault on every turn.",
      "Derive several searches from key entities, aliases, dates, decisions, products, and technical terms in the request.",
      "Open and verify the strongest source documents. Repeat retrieval with refined queries until another pass adds no material evidence.",
      "Resolve conflicts by source authority and recency. Cite vault paths, and separate confirmed facts, inference, and unresolved gaps.",
      "Do not claim complete vault coverage when the index is unavailable or stale, and do not read every file blindly."
    ].join("\n");
  }

  private getAgentTranscriptContextText(): string {
    return this.getAgentTranscriptContextSnapshot().text;
  }

  private shouldAttachTranscriptContextToPrompt(): boolean {
    return true;
  }

  private getAgentTranscriptContextSnapshot(): { text: string; originalChars: number; usedChars: number; percent: number } {
    if (!this.agentTranscriptEl) {
      return { text: "", originalChars: 0, usedChars: 0, percent: 0 };
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
    const text = truncateStart(context, AGENT_TRANSCRIPT_CONTEXT_MAX_CHARS);
    const usedChars = Math.min(context.length, AGENT_TRANSCRIPT_CONTEXT_MAX_CHARS);
    const percent = AGENT_TRANSCRIPT_CONTEXT_MAX_CHARS > 0
      ? Math.min(100, Math.max(0, (usedChars / AGENT_TRANSCRIPT_CONTEXT_MAX_CHARS) * 100))
      : 0;
    return { text, originalChars: context.length, usedChars, percent };
  }

  // Start one Codex turn and mark it active so further input queues instead of
  // opening a second concurrent turn.
  private beginCodexTurn(
    text: string,
    attachments: AgentAttachment[],
    activeNoteContext: ActiveNoteContextSnapshot | null
  ) {
    if (!this.agentBackend) {
      return;
    }
    this.codexTurnActive = true;
    this.setAgentTokenUsage(null);
    this.agentCurrentTurnStartedAt = Date.now();
    this.updateSendButtonMode();
    const userAttachmentCount = attachments.filter((attachment) => attachment.contextRole !== "active-note").length;
    const noteSuffix = userAttachmentCount ? `\n\n[${userAttachmentCount} file(s) attached]` : "";
    const sendText = this.buildContextualAgentPrompt(text, activeNoteContext);
    this.startCodexTurn((text || "(attachments)") + noteSuffix, true);
    void this.agentBackend.sendUserMessage({ text: sendText, attachments });
  }

  private flushQueuedInput() {
    if (this.codexTurnActive || !this.agentBackend) {
      return;
    }
    const next = this.codexQueuedInputs.shift();
    if (next) {
      this.beginCodexTurn(next.text, next.attachments, next.activeNoteContext);
    }
  }

  private updateSendButtonMode() {
    if (!this.agentSendButton || !this.isVisibleAgentSessionContext()) {
      return;
    }
    const active = this.codexTurnActive || !!this.agentPrintTurnRuntime;
    this.agentSendButton.empty();
    setIcon(this.agentSendButton, active ? "square" : "arrow-up");
    this.agentSendButton.setAttr("aria-label", active ? "Stop response" : "Send message");
    this.agentSendButton.setAttr("title", active ? "Stop response" : "Send message");
    this.agentSendButton.toggleClass("mod-warning", active);
    this.agentSendButton.toggleClass("mod-cta", !active);
    this.agentSendButton.toggleClass("is-stop", active);
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
    this.stopTurnProgressTimer();
    removeAgentThinkingIndicators(root);
  }

  private finishCodexTurn(statusText = "Codex ready", flushQueued = true) {
    this.cancelCodexTurnCompletionFallback();
    this.codexTurnActive = false;
    this.updateSendButtonMode();
    this.refreshAgentTokenUsage();
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
    const startedAt = this.agentCurrentTurnStartedAt || Date.now();
    this.agentCurrentTurnStartedAt = startedAt;
    thinking.dataset.startedAt = String(startedAt);
    const dots = thinking.createDiv("vault-agent-thinking-dots");
    dots.createSpan();
    dots.createSpan();
    dots.createSpan();
    thinking.createSpan({ cls: "vault-agent-thinking-text", text: "생각 중" });
    this.codexTurnLoadingEl = thinking;
    this.updateTurnProgressIndicator();
    this.startTurnProgressTimer();
  }

  private syncTurnProgressTimer() {
    if (this.codexTurnLoadingEl?.isConnected && this.isVisibleAgentSessionContext()) {
      this.updateTurnProgressIndicator();
      this.startTurnProgressTimer();
      return;
    }
    this.stopTurnProgressTimer();
  }

  private startTurnProgressTimer() {
    if (this.agentProgressTimer !== null) {
      return;
    }
    this.agentProgressTimer = window.setInterval(() => {
      this.updateTurnProgressIndicator();
    }, 1000);
  }

  private stopTurnProgressTimer() {
    if (this.agentProgressTimer === null) {
      return;
    }
    window.clearInterval(this.agentProgressTimer);
    this.agentProgressTimer = null;
  }

  private updateTurnProgressIndicator() {
    const thinking = this.codexTurnLoadingEl;
    if (!thinking?.isConnected) {
      this.stopTurnProgressTimer();
      return;
    }
    const textEl = thinking.querySelector(".vault-agent-thinking-text");
    if (!(textEl instanceof HTMLElement)) {
      return;
    }
    textEl.setText(this.getTurnProgressText(thinking));
  }

  private getTurnProgressText(thinking: HTMLElement): string {
    const provider = getAgentProviderLabel(this.agentProvider);
    const status = this.getTurnProgressStatusText();
    const startedAt = Number(thinking.dataset.startedAt) || this.agentCurrentTurnStartedAt || Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    return `${provider} · ${status} · ${formatElapsedSeconds(elapsedSeconds)}`;
  }

  private getTurnProgressStatusText(): string {
    const activePrintTurn = this.agentPrintTurnRuntime && !this.agentPrintTurnRuntime.settled
      ? this.agentPrintTurnRuntime
      : null;
    const text = this.agentStatusText.trim();
    if (activePrintTurn && !isAgentLoadingStatus(text)) {
      return `Waiting for ${getAgentProviderLabel(activePrintTurn.provider)} response...`;
    }
    if (text && text !== "Idle") {
      return text;
    }
    if (this.codexTurnActive || activePrintTurn) {
      return "Working...";
    }
    return "Waiting...";
  }

  private refreshCodexStatusLine() {
    // Status/path chrome was intentionally removed from the composer.
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

  private async refreshCodexGitBranch(cwd: string, sessionKey: string | null = this.activeAgentSessionKey) {
    const branch = await readGitBranchAsync(cwd);
    this.withAgentSession(sessionKey, () => {
      if (this.plugin.getVaultPath() !== cwd) {
        return;
      }
      this.codexGitBranch = branch;
      this.refreshCodexStatusLine();
    });
  }

  private getSelectedAgentModelLabel(): string {
    if (this.agentProvider === "codex") {
      return this.getSelectedCodexModelLabel();
    }
    if (this.agentProvider === "claude") {
      const pieces = [this.plugin.settings.claudeModel || "Claude", this.plugin.settings.claudeEffort].filter(Boolean);
      return pieces.join(" · ");
    }
    const pieces = [
      formatGeminiStatusModelLabel(this.plugin.settings.geminiModel),
      "ctx",
      this.plugin.settings.geminiApprovalMode
    ].filter(Boolean);
    return pieces.join(" · ");
  }

  private getAgentContextPercent(): number | null {
    if (this.agentProvider === "codex") {
      return this.codexContextPercent;
    }
    if (this.agentProvider === "gemini" && this.plugin.settings.geminiUseNativeSession) {
      return null;
    }
    return this.getAgentTranscriptContextSnapshot().percent;
  }

  private getSelectedCodexModelLabel(): string {
    const selected = this.codexModelSelect?.value || this.plugin.settings.codexModel;
    const model = selected
      ? this.codexModels.find((candidate) => candidate.id === selected)
      : this.getDefaultCodexModel();
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
        this.refreshCodexModelSelect();
        this.refreshAgentOptionsRow();
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
    this.plugin.settings.codexModel = this.codexModelSelect.value;
    void this.plugin.saveSettings();
    const model = this.codexModelSelect.value
      ? this.codexModels.find((candidate) => candidate.id === this.codexModelSelect?.value)
      : this.getDefaultCodexModel();
    this.codexEffortSelect.empty();
    for (const effort of model?.efforts ?? []) {
      this.codexEffortSelect.createEl("option", { value: effort, text: effort });
    }
    if (model?.defaultEffort) {
      this.codexEffortSelect.value = model.defaultEffort;
    } else if ((model?.efforts ?? []).length === 0) {
      this.codexEffortSelect.createEl("option", { value: "", text: "Effort default" });
      this.codexEffortSelect.value = "";
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

  private async startVoiceRecording() {
    if (this.voiceCaptureState !== "idle") {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      new Notice("이 Obsidian 환경에서는 마이크 녹음을 지원하지 않습니다.");
      return;
    }

    const operationId = ++this.voiceOperationId;
    this.voiceTargetSessionKey = this.activeAgentSessionKey;
    this.voicePreparationStatus = "";

    this.voiceCaptureState = "requesting";
    this.refreshVoiceCaptureUi();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      if (operationId !== this.voiceOperationId) {
        stopMediaStream(stream);
        return;
      }

      this.voiceMediaStream = stream;
      this.startBatchVoiceRecorder(stream, operationId);
      if (operationId !== this.voiceOperationId) {
        stopMediaStream(stream);
        return;
      }

      this.voiceStartedAt = Date.now();
      this.voiceCaptureState = "recording";
      this.startVoiceTimer();
      this.refreshVoiceCaptureUi();
    } catch (error) {
      this.failVoiceCapture(operationId, error);
    }
  }

  private startVoiceMediaRecorder(stream: MediaStream, operationId: number): Promise<Blob> {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("이 Obsidian 환경에서는 녹음 파일 생성을 지원하지 않습니다.");
    }
    const mimeType = getPreferredVoiceRecordingMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 })
      : new MediaRecorder(stream, { audioBitsPerSecond: 64_000 });
    this.voiceMediaRecorder = recorder;
    const chunks: Blob[] = [];
    return new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (operationId === this.voiceOperationId && event.data.size > 0) {
          chunks.push(event.data);
        }
      });
      recorder.addEventListener("error", (event) => {
        reject(new Error(getMediaRecorderErrorMessage(event)));
      }, { once: true });
      recorder.addEventListener("stop", () => {
        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
      }, { once: true });
      try {
        recorder.start(1_000);
      } catch (error) {
        reject(error);
      }
    });
  }

  private startBatchVoiceRecorder(stream: MediaStream, operationId: number) {
    const targetSessionKey = this.voiceTargetSessionKey;
    const recordingPromise = this.startVoiceMediaRecorder(stream, operationId);
    void recordingPromise
      .then((recording) => this.finishBatchVoiceRecording(operationId, recording, targetSessionKey))
      .catch((error) => this.failVoiceCapture(operationId, error));
  }

  private stopVoiceRecording() {
    if (this.voiceCaptureState !== "recording") {
      return;
    }

    this.voiceCaptureState = "transcribing";
    this.voicePreparationStatus = "전사 서버 처리 중";
    this.stopVoiceTimer();
    this.refreshVoiceCaptureUi();

    const recorder = this.voiceMediaRecorder;
    if (!recorder || recorder.state === "inactive") {
      this.failVoiceCapture(this.voiceOperationId, new Error("녹음 데이터를 완료하지 못했습니다."));
      return;
    }

    try {
      recorder.requestData();
      recorder.stop();
      stopMediaStream(this.voiceMediaStream);
      this.voiceMediaStream = null;
    } catch (error) {
      this.failVoiceCapture(this.voiceOperationId, error);
    }
  }

  private async finishBatchVoiceRecording(operationId: number, recording: Blob, targetSessionKey: string | null) {
    this.voiceMediaRecorder = null;
    if (operationId !== this.voiceOperationId) {
      return;
    }
    if (recording.size === 0) {
      this.failVoiceCapture(operationId, new Error("녹음된 음성이 없습니다."));
      return;
    }

    try {
      const payload = await prepareVoiceAudioPayload(recording);
      if (operationId !== this.voiceOperationId) {
        return;
      }
      const snapshot = this.readActiveNoteContextSnapshot();
      const noteContext = [
        snapshot?.name.replace(/\.md$/i, "") ?? "",
        snapshot?.selection || snapshot?.cursorLineText || ""
      ].filter(Boolean).join("\n");
      const terminologyPrompt = this.plugin.buildVoiceTranscriptionPrompt(noteContext);
      const transcript = await transcribeVoiceAudio(payload, this.plugin.settings, terminologyPrompt);
      if (operationId !== this.voiceOperationId) {
        return;
      }
      const normalization = this.plugin.normalizeVoiceTranscript(transcript);
      if (!normalization.text) {
        throw new Error("전사 서버가 빈 텍스트를 반환했습니다.");
      }
      this.insertVoiceTranscript(normalization.text, targetSessionKey);
      const terminologyMessage = normalization.replacementCount > 0
        ? ` 회사 표준 표기 ${normalization.replacementCount}건을 반영했습니다.`
        : normalization.referenceDirectory
          ? ""
          : " 회사 용어 기준 자료를 찾지 못해 전사 원문을 사용했습니다.";
      new Notice(`음성을 텍스트로 변환했습니다.${terminologyMessage}`);
      this.completeVoiceCapture(operationId);
    } catch (error) {
      this.failVoiceCapture(operationId, error);
    }
  }

  private insertVoiceTranscript(transcript: string, targetSessionKey: string | null) {
    const target = targetSessionKey
      ? this.agentSessions.find((session) => session.agentSessionKey === targetSessionKey) ?? null
      : null;
    if (!target || target.agentSessionKey === this.activeAgentSessionKey) {
      const input = this.agentInputEl;
      if (!input) {
        return;
      }
      insertTextIntoTextarea(input, transcript);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
      this.captureActiveAgentSessionState();
      this.saveAgentViewState();
      return;
    }

    target.inputText = appendComposerText(target.inputText ?? "", transcript);
    target.updatedAt = Date.now();
    this.saveAgentViewState();
    new Notice(`${target.agentSessionLabel} 탭의 입력창에 전사문을 넣었습니다.`);
  }

  private startVoiceTimer() {
    this.stopVoiceTimer();
    this.voiceTimer = window.setInterval(() => {
      if (this.voiceCaptureState !== "recording") {
        return;
      }
      if (Date.now() - this.voiceStartedAt >= VOICE_RECORDING_MAX_MS) {
        new Notice("최대 녹음 시간에 도달해 전사를 시작합니다.");
        this.stopVoiceRecording();
        return;
      }
      this.refreshVoiceCaptureUi();
    }, 250);
  }

  private stopVoiceTimer() {
    if (this.voiceTimer !== null) {
      window.clearInterval(this.voiceTimer);
      this.voiceTimer = null;
    }
  }

  private refreshVoiceCaptureUi() {
    const button = this.voiceButton;
    const status = this.voiceStatusEl;
    if (!button || !status) {
      return;
    }

    const state = this.voiceCaptureState;
    const icon = state === "recording"
      ? "square"
      : state === "requesting" || state === "transcribing"
        ? "loader-circle"
        : "mic";
    if (button.dataset.voiceIcon !== icon) {
      setIcon(button, icon);
      button.dataset.voiceIcon = icon;
    }
    const label = state === "recording"
      ? "Stop voice recording"
      : state === "requesting"
        ? "Requesting microphone access"
        : state === "transcribing"
          ? "Transcribing voice"
          : "Start voice recording";
    button.disabled = state === "requesting" || state === "transcribing";
    button.toggleClass("is-recording", state === "recording");
    button.toggleClass("is-transcribing", state === "transcribing" || state === "requesting");
    button.setAttr("aria-label", label);
    button.setAttr("title", label);

    status.toggleClass("is-hidden", state === "idle");
    status.setText(state === "recording"
      ? formatVoiceDuration(Date.now() - this.voiceStartedAt)
      : state === "requesting"
          ? "마이크 연결 중"
          : state === "transcribing"
            ? this.voicePreparationStatus || "전사 중"
            : "");
  }

  private failVoiceCapture(operationId: number, error: unknown) {
    if (operationId !== this.voiceOperationId) {
      return;
    }
    const message = formatVoiceCaptureError(error);
    this.cancelVoiceCapture();
    new Notice(message);
  }

  private completeVoiceCapture(operationId: number) {
    if (operationId !== this.voiceOperationId) {
      return;
    }
    this.stopVoiceTimer();
    stopMediaStream(this.voiceMediaStream);
    this.voiceMediaStream = null;
    this.voiceMediaRecorder = null;
    this.voicePreparationStatus = "";
    this.voiceTargetSessionKey = null;
    this.voiceCaptureState = "idle";
    this.voiceOperationId += 1;
    this.refreshVoiceCaptureUi();
  }

  private cancelVoiceCapture() {
    this.voiceOperationId += 1;
    this.stopVoiceTimer();
    const recorder = this.voiceMediaRecorder;
    this.voiceMediaRecorder = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Best-effort cleanup during view close or a recorder failure.
      }
    }
    stopMediaStream(this.voiceMediaStream);
    this.voiceMediaStream = null;
    this.voicePreparationStatus = "";
    this.voiceTargetSessionKey = null;
    this.voiceCaptureState = "idle";
    this.refreshVoiceCaptureUi();
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
    const vaultPath = this.plugin.getVaultPath();
    if (localPath && (!vaultPath || isPathInsideDirectory(localPath, vaultPath))) {
      return {
        kind: isImageAttachmentFile(file) ? "localImage" : "mention",
        path: localPath,
        name
      };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const savedVaultPath = await this.plugin.saveAttachmentBytes(bytes, getGeneralFileExtension(file), sanitizeFileStem(name));
    const absolutePath = vaultPath
      ? join(vaultPath, ...savedVaultPath.split("/"))
      : savedVaultPath;
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
      this.agentAttachButton.toggleClass("has-attachments", count > 0);
      this.agentAttachButton.setAttr("title", count > 0 ? `${count} file(s) attached` : "Attach files");
      this.agentAttachButton.setAttr("aria-label", count > 0 ? `Attach files, ${count} currently attached` : "Attach files");
      this.agentAttachButton.setAttr("data-count", count > 0 ? String(count) : "");
    }
    if (count === 0) {
      return;
    }
    this.codexPendingAttachments.forEach((attachment, index) => {
      const chip = this.codexAttachmentsEl!.createDiv("vault-agent-attachment-chip");
      chip.toggleClass("is-image", attachment.kind === "localImage");
      const kind = chip.createSpan("vault-agent-attachment-kind");
      setIcon(kind, attachment.kind === "localImage" ? "image" : "file");
      chip.createSpan({ cls: "vault-agent-attachment-name", text: attachment.name ?? attachment.path });
      chip.setAttr("title", attachment.path);
      const remove = chip.createEl("button", {
        attr: { "aria-label": `Remove ${attachment.name ?? "attachment"}`, title: "Remove attachment", type: "button" }
      });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        this.codexPendingAttachments.splice(index, 1);
        this.renderAttachmentChips();
      });
    });
  }

  // Paste an image from the clipboard (Ctrl/Cmd+V) as an attachment for the selected provider.
  private handleAgentPaste(event: ClipboardEvent) {
    const imageFile = getClipboardImageFile(event.clipboardData);
    if (imageFile) {
      event.preventDefault();
      void this.addAgentAttachments([imageFile]);
      return;
    }

    const imageBytes = readSystemClipboardImageBytes();
    if (!imageBytes) {
      return; // not an image — let the textarea paste text normally
    }

    event.preventDefault();
    void this.addClipboardImageAttachment(imageBytes);
  }

  private async addClipboardImageAttachment(imageBytes: Uint8Array) {
    try {
      const vaultPath = await this.plugin.saveAttachmentBytes(imageBytes, "png", "pasted-image");
      const absolutePath = this.plugin.getVaultPath()
        ? join(this.plugin.getVaultPath()!, ...vaultPath.split("/"))
        : vaultPath;
      this.codexPendingAttachments.push({
        kind: "localImage",
        path: absolutePath,
        name: "Pasted image"
      });
      this.renderAttachmentChips();
      new Notice("이미지를 첨부했습니다.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`이미지 첨부 실패: ${message}`);
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
    const startRequestId = this.beginAgentStartRequest(sessionKey);
    this.agentProvider = provider;
    this.saveAgentViewState();
    this.refreshAgentProviderUi();
    this.scrollVisibleAgentTranscriptToBottomAfterLayout();
    this.codexGitBranch = null;
    this.refreshCodexStatusLine();
    void this.refreshCodexGitBranch(cwd, sessionKey);

    if (provider === "codex" && this.plugin.settings.codexUseAppServer) {
      try {
        await this.startCodexBackend(cwd);
      } finally {
        this.completeAgentStartRequest(sessionKey, startRequestId);
      }
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
    this.agentPostLaunchInput = null;
    if (provider === "claude") {
      this.ensureClaudeSessionId();
    } else if (provider === "gemini") {
      this.ensureGeminiSessionId();
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
      const env = buildProcessEnv({
        useSystemCa: this.plugin.settings.useSystemCa,
        extraCaCertPath: this.plugin.getExtraCaCertPath()
      });
      if (provider === "gemini") {
        const status = await this.checkAgentLoginStatus(provider, cwd, env, startRequestId);
        if (!this.isAgentStartRequestCurrent(sessionKey, startRequestId)) {
          return;
        }
        this.withAgentSession(sessionKey, () => {
          if (status.loggedIn !== true) {
            this.agentReadyForInput = false;
            this.refreshAgentPromptActions();
            return;
          }
          this.agentReadyForInput = true;
          this.markAgentConversationReady(`${getAgentProviderLabel(provider)} CLI가 확인되었습니다. 이제 대화를 시작할 수 있습니다.`);
          this.refreshAgentPromptActions();
        });
        this.completeAgentStartRequest(sessionKey, startRequestId);
        return;
      }

      const missingRuntimeFiles = this.plugin.getRuntimeMissingFiles();
      if (missingRuntimeFiles.length > 0) {
        if (!this.plugin.settings.autoInstallRuntime) {
          throw new Error("Runtime files are missing. Use Settings > Obst Terminal > Runtime files first.");
        }

        await this.plugin.installRuntimeIfNeeded((message) => {
          if (this.isAgentStartRequestCurrent(sessionKey, startRequestId)) {
            this.withAgentSession(sessionKey, () => this.setAgentStatus(message));
          }
        });
      }

      await this.checkAgentLoginStatus(provider, cwd, env, startRequestId);
      if (!this.isAgentStartRequestCurrent(sessionKey, startRequestId)) {
        return;
      }
      this.startAgentHost(sessionKey, cwd, env, provider);
      this.completeAgentStartRequest(sessionKey, startRequestId);
    } catch (error) {
      if (!this.isAgentStartRequestCurrent(sessionKey, startRequestId)) {
        return;
      }
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
      this.completeAgentStartRequest(sessionKey, startRequestId);
    }
  }

  private startAgentHost(sessionKey: string | null, cwd: string, env: { [key: string]: string | undefined }, provider: AgentProvider = this.agentProvider) {
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
      this.agentProvider = provider;
      this.agentHost = host;
      this.agentHostReady = false;
      this.startAgentSessionPolling();
    });

    host.stdout.on("data", (chunk: Buffer) => {
      this.withAgentSession(sessionKey, () => {
        if (this.agentHost !== host) {
          return;
        }
        this.handleAgentHostStdout(chunk.toString(), provider);
      });
    });

    host.stderr.on("data", (chunk: Buffer) => {
      this.withAgentSession(sessionKey, () => {
        if (this.agentHost !== host) {
          return;
        }
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: stripTerminalControlSequences(chunk.toString()).trim() || chunk.toString()
        });
      });
    });

    host.on("error", (error: Error) => {
      this.withAgentSession(sessionKey, () => {
        if (this.agentHost !== host) {
          return;
        }
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
        if (this.agentHost !== host) {
          return;
        }
        // Flush any answer already written to the session log before teardown,
        // so a response that landed right before the PTY died still appears.
        this.pollAgentSessionLog();
        // Host is gone: clear the "thinking" spinner so the turn is not stuck.
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
  }

  private handleAgentHostStdout(chunk: string, provider: AgentProvider = this.agentProvider) {
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
          this.launchAgentCli(provider);
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

  private launchAgentCli(provider: AgentProvider = this.agentProvider) {
    const sessionKey = this.activeAgentSessionKey;
    this.agentProvider = provider;
    // Keep Claude's background control PTY out of the normal conversation
    // session. Claude Code locks a sessionId per running process, so the
    // persistent PTY and one-shot `claude -p` turns must not share the same id.
    const claudeSessionId = provider === "claude" ? this.ensureClaudeControlSessionId() : undefined;
    let command = getAgentLaunchCommand(provider, this.plugin.settings, {
      claudeSessionId,
      sessionName: this.agentSessionLabel
    });
    this.saveAgentViewState();
    this.refreshAgentSessionChrome();
    this.lastAgentLaunchCommand = command;
    this.sendAgentHostMessage({ type: "data", data: `${command}\r` });
    this.setAgentStatus(this.agentControlCommandInProgress && provider === "gemini"
      ? "Antigravity CLI control console"
      : `Launching ${getAgentProviderLabel(provider)}...`);

    const postLaunchInput = this.agentPostLaunchInput;
    this.agentPostLaunchInput = null;
    if (postLaunchInput) {
      window.setTimeout(() => {
        this.withAgentSession(sessionKey, () => {
          if (!this.agentHost || !this.agentHostReady) {
            return;
          }
          this.noteAgentControlFlow(postLaunchInput);
          this.sendAgentHostMessage({ type: "data", data: postLaunchInput });
        });
      }, AGENT_READY_DELAY_MS + 350);
    }

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
          text: `${getAgentProviderLabel(this.agentProvider)} is running. If login is required, complete the CLI login in an external terminal, then return to Agent and press Start again. MCP connection screens are handled separately with /mcp when the CLI reports them.`
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

    if (target === "gemini" || target === "geminicli" || target === "제미나이" || target === "구글제미나이" ||
        target === "agy" || target === "antigravity" || target === "안티그래비티") {
      return otherSessions.filter((session) => session.agentProvider === "gemini");
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

  private isAgentReadyForTextInput(provider: AgentProvider): boolean {
    if (provider === "gemini") {
      return this.agentReadyForInput && !this.agentNeedsAuth;
    }
    return !!this.agentHost && this.agentHostReady && this.agentReadyForInput;
  }

  private deliverAgentDelegation(message: string, attachments: AgentAttachment[], sourceLabel: string): AgentDelegationDeliveryResult {
    const sessionLabel = this.agentSessionLabel || createAgentSessionLabel(this.agentSessionKey);
    const provider = this.agentProvider;
    const routedText = formatDelegatedAgentPrompt(sourceLabel, message);
    const activeNoteContext = this.getSharedActiveNoteContextSnapshot();
    const turnAttachments = this.withActiveNoteAttachment(attachments, activeNoteContext);
    const userAttachmentCount = attachments.filter((attachment) => attachment.contextRole !== "active-note").length;
    const visibleText = routedText + (userAttachmentCount ? `\n\n[${userAttachmentCount} file(s) attached]` : "");

    if (this.agentBackend) {
      if (this.codexTurnActive) {
        this.codexQueuedInputs.push({ text: routedText, attachments: turnAttachments, activeNoteContext });
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `${sourceLabel}에서 전달된 지시를 Codex 대기열에 추가했습니다.`
        });
        return { sessionLabel, provider, status: "queued", reason: "Codex is answering" };
      }

      this.beginCodexTurn(routedText, turnAttachments, activeNoteContext);
      return { sessionLabel, provider, status: "sent" };
    }

    if (!this.isAgentReadyForTextInput(provider)) {
      const reason = `${getAgentProviderLabel(provider)} is not running`;
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

    const usePrintMode = isPrintCommandProvider(this.agentProvider) && (!this.agentPromptState || promptMode === "text");
    const contextualRoutedText = this.buildContextualAgentPrompt(routedText, activeNoteContext);
    const textWithAttachments = appendAgentAttachmentPrompt(
      contextualRoutedText,
      turnAttachments,
      provider,
      this.plugin.getVaultPath()
    );
    if (usePrintMode && textWithAttachments) {
      const status = this.queueOrStartPrintTurn(this.agentProvider, textWithAttachments, turnAttachments, visibleText);
      return { sessionLabel, provider, status };
    }

    this.agentCurrentTurnStartedAt = Date.now();
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("user"),
      role: "user",
      text: visibleText
    });

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

    let text = inputEl.value.trim();
    const attachments = this.codexPendingAttachments.slice();
    if (!text && attachments.length === 0 && !this.agentPromptState?.allowEmptySubmit) {
      return;
    }

    const activeNoteContext = !text.startsWith("/") &&
      (!this.agentPromptState || this.agentPromptState.mode === "text")
      ? this.getSharedActiveNoteContextSnapshot()
      : null;
    const turnAttachments = this.withActiveNoteAttachment(attachments, activeNoteContext);

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
      this.dispatchAgentDelegation(delegation, turnAttachments);
      return;
    }

    if (isAgentDelegationAttempt(text)) {
      new Notice("Use @all, @codex, @claude, or @\"session title\" followed by a message.");
      return;
    }

    if (this.agentProvider === "gemini" && isSlashCommandText(text)) {
      inputEl.value = "";
      this.codexPendingAttachments = [];
      this.renderAttachmentChips();
      await this.sendGeminiSlashCommand(text, attachments);
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
        this.codexQueuedInputs.push({ text, attachments: turnAttachments, activeNoteContext });
        new Notice(`응답 중 — 메시지를 큐에 추가했습니다 (${this.codexQueuedInputs.length}개 대기). Stop을 누르면 즉시 넘어갑니다.`);
        return;
      }
      this.beginCodexTurn(text, turnAttachments, activeNoteContext);
      return;
    }

    if (!this.isAgentReadyForTextInput(this.agentProvider)) {
      new Notice("Start the selected agent first, then send after it is running.");
      return;
    }

    if (this.agentNeedsAuth && !this.isAgentInteractiveReplyAllowed(text)) {
      const label = getAgentProviderLabel(this.agentProvider);
      const loginStarted = this.agentProvider === "gemini"
        ? await this.startGeminiLoginFlow(`${label} login is required before normal messages can be sent.`)
        : this.startAgentLoginFlow(`${label} login is required before normal messages can be sent.`);
      new Notice(loginStarted ? `Use an external terminal for ${label} login.` : `${label} is asking for login.`);
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: loginStarted
          ? `${label} login is required before normal messages can be sent. Complete login in an external terminal, then return to Agent and press Start again.`
          : `${label} login is required before normal messages can be sent. Complete the CLI login in an external terminal, then press Start again.`
      });
      return;
    }

    const promptMode = this.agentPromptState?.mode;
    if (promptMode === "auth-code" && !text.startsWith("/") && !looksLikeAgentAuthCode(text)) {
      new Notice("Claude is waiting for the login code. Open the login link, copy the code, then paste only the code here.");
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: "Claude is waiting for a browser login code. Use Open login link, then paste only the returned code into this box."
      });
      return;
    }
    if ((this.agentNeedsAuth || promptMode === "auth-code") && !text.startsWith("/") && looksLikeAgentAuthCode(text)) {
      text = text.replace(/\s+/g, "");
    }

    const contextualText = this.buildContextualAgentPrompt(text, activeNoteContext);
    const textWithAttachments = appendAgentAttachmentPrompt(
      contextualText,
      turnAttachments,
      this.agentProvider,
      this.plugin.getVaultPath()
    );
    const usePrintMode = isPrintCommandProvider(this.agentProvider) &&
      !!textWithAttachments &&
      !text.startsWith("/") &&
      (!this.agentPromptState || promptMode === "text");

    inputEl.value = "";
    this.codexPendingAttachments = [];
    this.renderAttachmentChips();
    const visibleText = text || (attachments.length ? "(attachments)" : "[Enter]");
    if (usePrintMode) {
      this.queueOrStartPrintTurn(
        this.agentProvider,
        textWithAttachments,
        turnAttachments,
        visibleText + (attachments.length ? `\n\n[${attachments.length} file(s) attached]` : "")
      );
      return;
    }

    this.agentCurrentTurnStartedAt = Date.now();
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("user"),
      role: "user",
      text: visibleText + (attachments.length ? `\n\n[${attachments.length} file(s) attached]` : "")
    });

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

  private async sendGeminiSlashCommand(text: string, attachments: AgentAttachment[]) {
    const command = text.trim();
    if (!command) {
      return;
    }

    this.agentCurrentTurnStartedAt = Date.now();
    this.clearCodexTurnLoadingIndicators(this.agentTranscriptEl);
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("system"),
      role: "system",
      text: `Antigravity CLI control command: ${command}`
    });

    if (attachments.length > 0) {
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: `Antigravity CLI control commands do not accept Agent Console attachments. Ignored ${attachments.length} attachment(s).`
      });
    }

    const data = `${command}\r`;
    if (this.agentHost && this.agentHostReady) {
      this.agentControlCommandInProgress = true;
      this.sendAgentHostMessage({ type: "data", data });
      this.noteAgentControlFlow(data);
      this.clearAgentPromptState();
      this.refreshAgentAuthStatus("Antigravity CLI control command sent");
      return;
    }

    if (this.agentHost) {
      this.agentControlCommandInProgress = true;
      this.agentPostLaunchInput = data;
      this.noteAgentControlFlow(data);
      this.clearAgentPromptState();
      this.setAgentStatus("Antigravity CLI control command queued");
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: `Antigravity CLI control console is still starting. Queued command: ${command}`
      });
      this.saveAgentViewState();
      return;
    }

    const started = await this.startGeminiControlHostForCommand(command, data);
    if (!started) {
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: `Antigravity CLI control command was not sent: ${command}`
      });
    }
  }

  private async startGeminiControlHostForCommand(command: string, data: string): Promise<boolean> {
    if (this.agentProvider !== "gemini") {
      return false;
    }

    const sessionKey = this.activeAgentSessionKey;
    const cwd = this.plugin.getVaultPath();
    if (!cwd) {
      new Notice("This vault does not expose a local file-system path.");
      return false;
    }

    const isLoginCommand = /^\/(?:auth|login)\b/i.test(command);
    const wasConversationReady = this.agentConversationReady;
    try {
      const env = buildProcessEnv({
        useSystemCa: this.plugin.settings.useSystemCa,
        extraCaCertPath: this.plugin.getExtraCaCertPath()
      });
      const availabilityFailure = await getGeminiCliAvailabilityFailure(cwd, env, this.plugin.settings);
      if (availabilityFailure) {
        this.withAgentSession(sessionKey, () => {
          this.agentAuthState = "login-required";
          this.agentNeedsAuth = true;
          this.setAgentStatus("Antigravity CLI missing");
          this.appendAgentTranscript({
            id: this.nextLocalAgentEntryId("system"),
            role: "system",
            text: availabilityFailure.summary
          });
        });
        return false;
      }

      const missingRuntimeFiles = this.plugin.getRuntimeMissingFiles();
      if (missingRuntimeFiles.length > 0) {
        if (!this.plugin.settings.autoInstallRuntime) {
          throw new Error("Runtime files are missing. Use Settings > Obst Terminal > Runtime files first.");
        }

        await this.plugin.installRuntimeIfNeeded((message) => {
          this.withAgentSession(sessionKey, () => this.setAgentStatus(message));
        });
      }

      this.withAgentSession(sessionKey, () => {
        this.agentProvider = "gemini";
        this.agentStartedAt = Date.now();
        this.agentSessionPath = null;
        this.agentSessionOffset = 0;
        this.agentSessionBaselineOffsets = snapshotAgentSessionOffsets("gemini", cwd);
        this.agentSeenEntries.clear();
        this.agentAuthState = isLoginCommand ? "login-in-progress" : "ready";
        this.agentConversationReady = isLoginCommand ? false : wasConversationReady;
        this.agentReadyNoticeShown = wasConversationReady;
        this.agentAutoLoginAttempted = isLoginCommand;
        this.agentAutoLoginPending = false;
        this.agentAutoMcpAttempted = /^\/mcp\b/i.test(command);
        this.agentMcpAuthInProgress = /^\/mcp\b/i.test(command);
        this.agentControlCommandInProgress = true;
        this.agentNeedsAuth = isLoginCommand ? true : this.agentNeedsAuth && !wasConversationReady;
        this.agentPromptState = null;
        this.agentOpenedExternalUrls.clear();
        this.agentPostLaunchInput = data;
        this.lastAgentLaunchCommand = "";
        this.agentReadyForInput = false;
        this.setAgentStatus("Antigravity CLI control console opening");
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `Starting Antigravity CLI control console for slash command: ${command}`
        });
        this.startAgentHost(sessionKey, cwd, env, "gemini");
        this.saveAgentViewState();
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.withAgentSession(sessionKey, () => {
        this.setAgentStatus("Failed");
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `Failed to start Antigravity CLI control console: ${message}`
        });
      });
      new Notice(`Failed to start Antigravity CLI control console: ${message}`);
      return false;
    }
  }

  private async sendClaudePrintTurn(text: string) {
    await this.sendPrintCommandTurn("claude", text, text.slice(0, 160));
  }

  private async sendGeminiPrintTurn(text: string) {
    await this.sendPrintCommandTurn("gemini", text, text.slice(0, 160));
  }

  private queueOrStartPrintTurn(provider: AgentProvider, text: string, attachments: AgentAttachment[], visibleText: string): "sent" | "queued" {
    if (!isPrintCommandProvider(provider)) {
      return "sent";
    }

    if (this.agentPrintTurnRuntime) {
      this.agentPrintQueuedInputs.push({ text, attachments, visibleText });
      this.setAgentStatus(`${getAgentProviderLabel(provider)} 응답 중 · ${this.agentPrintQueuedInputs.length}개 대기`);
      new Notice(`응답 중 — 메시지를 큐에 추가했습니다 (${this.agentPrintQueuedInputs.length}개 대기).`);
      this.saveAgentViewState();
      return "queued";
    }

    void this.sendPrintCommandTurn(provider, text, visibleText);
    return "sent";
  }

  private drainQueuedPrintTurn(provider: AgentProvider) {
    if (this.agentPrintTurnRuntime || this.agentPrintQueuedInputs.length === 0) {
      return;
    }

    const next = this.agentPrintQueuedInputs.shift();
    if (!next) {
      return;
    }

    this.setAgentStatus(`${getAgentProviderLabel(provider)} queued message starting...`);
    void this.sendPrintCommandTurn(provider, next.text, next.visibleText);
  }

  private async sendPrintCommandTurn(provider: AgentProvider, text: string, visibleText = "") {
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

    if (!isPrintCommandProvider(provider)) {
      return;
    }

    if (this.agentPrintTurnRuntime) {
      this.agentPrintQueuedInputs.push({ text, attachments: [], visibleText: text.slice(0, 160) });
      this.setAgentStatus(`${getAgentProviderLabel(provider)} 응답 중 · ${this.agentPrintQueuedInputs.length}개 대기`);
      return;
    }

    const turnId = randomUUID();
    if (provider === "claude") {
      this.agentClaudePrintTurnActive = true;
    }
    this.agentCurrentTurnStartedAt = Date.now();
    this.startCodexTurn(visibleText || text.slice(0, 160), true);
    if (provider === "claude") {
      this.setAgentTokenUsage(null);
    }
    this.agentLastUsageText = null;
    this.clearAgentPromptState();
    this.setAgentStatus(`Waiting for ${getAgentProviderLabel(provider)} response...`);
    this.refreshCodexStatusLine();
    try {
      const env = buildProcessEnv({
        useSystemCa: this.plugin.settings.useSystemCa,
        extraCaCertPath: this.plugin.getExtraCaCertPath()
      });
      let sessionId = provider === "claude" ? this.ensureClaudeSessionId() : this.ensureGeminiSessionId();
      let result = await this.runTrackedPrintCommand(sessionKey, provider, text, cwd, env, sessionId, turnId, {
        geminiResumeNativeSession: this.agentGeminiNativeSessionStarted
      });
      if (
        provider === "gemini" &&
        this.plugin.settings.geminiUseNativeSession &&
        this.agentGeminiNativeSessionStarted &&
        isGeminiNativeSessionResumeMissingResult(result)
      ) {
        this.withAgentSession(sessionKey, () => {
          this.agentGeminiNativeSessionStarted = false;
          this.setAgentStatus("Starting new Gemini native session...");
          this.appendAgentTranscript({
            id: this.nextLocalAgentEntryId("system"),
            role: "system",
          text: "Gemini CLI native session could not be resumed. Retrying with plugin transcript context."
          });
        });
        result = await this.runTrackedPrintCommand(sessionKey, provider, text, cwd, env, sessionId, turnId, {
          geminiResumeNativeSession: false
        });
      }
      if (provider === "gemini" && isGeminiModelUnavailableResult(result)) {
        const initialModel = this.plugin.settings.geminiModel || DEFAULT_SETTINGS.geminiModel;
        for (const fallbackModel of getGeminiModelFallbackCandidates(initialModel, this.plugin.settings)) {
          this.withAgentSession(sessionKey, () => {
            this.setAgentStatus(`Retrying Gemini with ${fallbackModel}...`);
            this.appendAgentTranscript({
              id: this.nextLocalAgentEntryId("system"),
              role: "system",
              text: `Gemini model ${initialModel || "default"} is not available for the current account/server. Retrying with ${fallbackModel || "default"}.`
            });
          });
          result = await this.runTrackedPrintCommand(sessionKey, provider, text, cwd, env, sessionId, turnId, {
            settings: { ...this.plugin.settings, geminiModel: fallbackModel },
            geminiResumeNativeSession: this.agentGeminiNativeSessionStarted
          });
          if (!isGeminiModelUnavailableResult(result)) {
            if (result.exitCode === 0 && !result.cancelled && !result.timedOut && !result.error) {
              this.withAgentSession(sessionKey, () => {
                this.plugin.settings.geminiModel = fallbackModel;
                void this.plugin.saveSettings();
                this.refreshAgentModelControls();
                this.refreshCodexStatusLine();
                this.appendAgentTranscript({
                  id: this.nextLocalAgentEntryId("system"),
                  role: "system",
                  text: `Gemini model changed to ${fallbackModel || "default"}. Future messages will use this model.`
                });
              });
            }
            break;
          }
        }
      }
      if (provider === "claude" && isClaudeSessionInUseResult(result)) {
        const resumeSessionId = sessionId;
        this.withAgentSession(sessionKey, () => {
          this.agentSessionPath = null;
          this.agentSessionOffset = 0;
          this.refreshAgentSessionChrome();
          this.setAgentStatus("Forking locked Claude session...");
          this.saveAgentViewState();
        });
        result = await this.runTrackedPrintCommand(sessionKey, provider, text, cwd, env, resumeSessionId, turnId, {
          resumeFork: true
        });
        if (isClaudeSessionInUseResult(result)) {
          this.withAgentSession(sessionKey, () => {
            this.appendAgentTranscript({
              id: this.nextLocalAgentEntryId("system"),
              role: "system",
              text: "Claude Code sessionId가 계속 사용 중입니다. 다른 Claude Code 프로세스가 같은 세션을 잡고 있을 수 있습니다. 실행 중인 Claude Code 작업을 종료한 뒤 다시 시도하세요."
            });
          });
        } else {
          const forkedSessionId = getClaudeSessionIdFromPrintResult(result) ?? findLatestAgentSessionIdExcluding(provider, cwd, [resumeSessionId]);
          if (forkedSessionId) {
            sessionId = forkedSessionId;
            this.withAgentSession(sessionKey, () => {
              this.agentClaudeSessionId = forkedSessionId;
              this.refreshAgentSessionChrome();
              this.saveAgentViewState();
            });
          }
        }
      }
      const resultSessionId = provider === "claude" ? getClaudeSessionIdFromPrintResult(result) : null;
      if (resultSessionId) {
        this.withAgentSession(sessionKey, () => {
          this.agentClaudeSessionId = resultSessionId;
          this.refreshAgentSessionChrome();
          this.saveAgentViewState();
        });
      }
      if (provider === "gemini" && this.plugin.settings.geminiUseNativeSession && isSuccessfulPrintCommandResult(result)) {
        this.withAgentSession(sessionKey, () => {
          this.agentGeminiNativeSessionStarted = true;
          this.refreshAgentSessionChrome();
          this.saveAgentViewState();
        });
      }
      this.withAgentSession(sessionKey, () => {
        const output = provider === "gemini" ? formatGeminiPrintOutput(result, this.plugin.settings) : formatClaudePrintOutput(result);
        const tokenUsage = getPrintCommandTokenUsage(provider, result);
        if (tokenUsage) {
          this.setAgentTokenUsage(tokenUsage);
        }
        this.agentLastUsageText = getPrintCommandUsageSummary(provider, result);
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("assistant"),
          role: "assistant",
          text: output
        });
        if (result.cancelled) {
          this.setAgentStatus("Stopped");
        } else if (isAgentSessionLimitText(output)) {
          this.setAgentStatus("Claude session limit");
        } else {
          this.markAgentConversationReady();
        }
        this.syncAgentSessionOffsetToLatestEnd();
        this.refreshCodexStatusLine();
      });
    } finally {
      this.withAgentSession(sessionKey, () => {
        if (this.agentPrintTurnRuntime?.turnId === turnId) {
          this.agentPrintTurnRuntime = null;
        }
        if (provider === "claude") {
          this.agentClaudePrintTurnActive = false;
        }
        this.updateSendButtonMode();
        this.refreshAgentTokenUsage();
        this.captureActiveAgentSessionState();
        this.saveAgentViewState();
        this.drainQueuedPrintTurn(provider);
      });
    }
  }

  private async runTrackedPrintCommand(
    sessionKey: string | null,
    provider: AgentProvider,
    text: string,
    cwd: string,
    env: { [key: string]: string | undefined },
    sessionId: string,
    turnId: string,
    options: { resumeFork?: boolean; settings?: PowerShellSettings; geminiResumeNativeSession?: boolean } = {}
  ): Promise<CapturedCommandResult> {
    const settings = options.settings ?? this.plugin.settings;
    const handle = provider === "gemini"
      ? spawnGeminiPrintCommand(text, cwd, env, CLAUDE_PRINT_TIMEOUT_MS, settings, this.plugin, {
        sessionId,
        resumeNativeSession: options.geminiResumeNativeSession === true
      })
      : spawnClaudePrintCommand(text, cwd, env, CLAUDE_PRINT_TIMEOUT_MS, {
        ...(options.resumeFork ? { resumeSessionId: sessionId, forkSession: true } : { sessionId }),
        sessionName: this.agentSessionLabel,
        settings,
        onUsage: (usage) => {
          this.withAgentSession(sessionKey, () => this.setAgentTokenUsage(usage));
        },
        onModel: (modelId) => {
          this.withAgentSession(sessionKey, () => this.setClaudeResolvedModel(settings.claudeModel, modelId));
        }
      });

    if (handle.child) {
      const child = handle.child;
      // Pin the runtime mutation to the owning session. Retry calls resume
      // from an await and may otherwise run while ANOTHER tab is active,
      // leaking this turn's "Waiting..." state into that tab.
      this.withAgentSession(sessionKey, () => {
        this.agentPrintTurnRuntime = {
          provider,
          turnId,
          sessionId,
          child,
          pid: handle.pid,
          kill: handle.kill,
          startedAt: Date.now(),
          promptPreview: text.slice(0, 160),
          settled: false
        };
        this.updateSendButtonMode();
        this.saveAgentViewState();
      });
      if (handle.pid !== undefined && (provider === "claude" || provider === "gemini")) {
        this.plugin.registerAgentPrintProcess({
          pid: handle.pid,
          provider,
          sessionId: provider === "claude" ? sessionId : null,
          cwd,
          startedAt: Date.now(),
          pluginVersion: this.plugin.manifest.version
        });
      }
    }

    const result = await handle.promise;
    this.plugin.unregisterAgentPrintProcess(handle.pid);
    this.withAgentSession(sessionKey, () => {
      if (this.agentPrintTurnRuntime?.turnId === turnId) {
        this.agentPrintTurnRuntime.settled = true;
        this.agentPrintTurnRuntime.cancelReason = result.cancelReason;
      }
      this.updateSendButtonMode();
    });
    return result;
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

    if (looksLikeAgentAuthCode(text)) {
      return true;
    }

    if (!this.agentPromptState) {
      return false;
    }

    if (this.agentPromptState.mode === "auth") {
      return /^\d+$/.test(text) || /^(?:login|auth)$/i.test(text);
    }

    return true;
  }

  private async checkAgentLoginStatus(
    provider: AgentProvider,
    cwd: string,
    env: { [key: string]: string | undefined },
    startRequestId: number
  ): Promise<AgentAuthCheck> {
    const sessionKey = this.activeAgentSessionKey;
    this.setAgentStatus(provider === "gemini" ? "Checking Antigravity CLI..." : `Checking ${getAgentProviderLabel(provider)} login...`);
    const status = await getAgentAuthCheck(provider, cwd, env, this.plugin.settings, this.plugin);
    if (!this.isAgentStartRequestCurrent(sessionKey, startRequestId)) {
      return status;
    }
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
        this.setAgentStatus(provider === "gemini" ? "Antigravity CLI ready" : `${getAgentProviderLabel(provider)} login confirmed`);
        return;
      }

      if (status.loggedIn === false) {
        this.agentAuthState = "login-required";
        this.agentConversationReady = false;
        this.agentNeedsAuth = provider === "claude" || provider === "gemini";
        this.agentAutoLoginPending = provider === "claude";
        this.refreshAgentAuthStatus();
        return;
      }

      this.agentAuthState = "checking";
      this.agentConversationReady = false;
      this.agentAutoLoginPending = false;
      this.refreshAgentAuthStatus();
    });
    return status;
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
      if (this.agentProvider === "claude") {
        this.agentPromptState = null;
        this.refreshAgentPromptActions();
        this.startAgentLoginFlow("Claude Code login is required.");
        return;
      }

      const loginUrl = prompt.urls.find((url) => isAgentLoginUrl(url));
      if (loginUrl && !this.agentOpenedExternalUrls.has(loginUrl)) {
        this.agentOpenedExternalUrls.add(loginUrl);
        this.openAgentExternalUrl(loginUrl);
      }

      this.refreshAgentAuthStatus();
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

  private getExternalLoginHint(provider: AgentProvider): string {
    if (provider === "codex") {
      return "Run `codex login` in an external terminal, then return to Agent and press Start.";
    }
    if (provider === "claude") {
      return "Run `claude` in an external terminal, complete `/login` if prompted, then return to Agent and press Start.";
    }
    if (provider === "gemini") {
      return isAntigravityCli(this.plugin.settings)
        ? "Run `agy` in an external terminal, complete the Google OAuth sign-in, then return to Agent and press Start."
        : "Run `gemini` in an external terminal, complete `/auth`, then return to Agent and press Start.";
    }
    return "Complete the CLI login in an external terminal, then return to Agent and press Start.";
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
    let plainText = stripTerminalControlSequences(data).trim();
    if (!plainText) {
      return;
    }
    if (this.agentProvider === "gemini") {
      plainText = removeGeminiCliNoise(plainText).trim();
      if (!plainText) {
        return;
      }
    }

    // Ignore the shell echo of our own launch command (truncated or full). Its
    // "--permission-mode" etc. would otherwise be misread as an interactive prompt.
    const launch = this.lastAgentLaunchCommand;
    if (launch) {
      plainText = removeAgentLaunchEchoText(plainText, launch);
      if (!plainText) {
        return;
      }
    }

    this.markAgentOutputActive();

    const authCompleted = hasAgentAuthSuccess(plainText);
    if (authCompleted) {
      this.markAgentConversationReady(`로그인이 완료되었습니다. ${getAgentProviderLabel(this.agentProvider)}가 준비되었습니다.`);
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
    // Gemini slash/control commands are different: their only visible output is
    // the control PTY, so keep prompt extraction enabled for that command.
    const actionablePrompt = this.agentConversationReady && !this.agentControlCommandInProgress
      ? null
      : extractAgentActionablePrompt(promptSource);
    if (actionablePrompt) {
      this.agentControlCommandInProgress = false;
      this.setAgentPromptState(actionablePrompt);
    }

    if (!actionablePrompt && loginRequired) {
      this.agentConversationReady = false;
      this.agentAuthState = "login-required";
      this.agentNeedsAuth = true;
      if (this.agentProvider === "claude") {
        this.startAgentLoginFlow("Claude Code에 로그인이 필요합니다.");
      } else {
        this.refreshAgentAuthStatus();
      }
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

    const controlOutput = this.agentControlCommandInProgress && !actionablePrompt
      ? promptSource.slice(-1200).trim()
      : "";
    if (controlOutput && controlOutput !== this.agentLastRawNotice) {
      this.agentLastRawNotice = controlOutput;
      this.agentControlCommandInProgress = false;
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: `Antigravity CLI control output:\n${controlOutput}`
      });
      this.markAgentConversationReady();
      return;
    }

    if (actionablePrompt || (!this.agentConversationReady && /\b(login|sign[- ]?in|authenticate|permission|trust|press enter|\(y\/n\)|not recognized|command not found)\b/i.test(promptSource))) {
      const notice = actionablePrompt?.text ?? promptSource.slice(-1200);
      if (notice !== this.agentLastRawNotice) {
        this.agentLastRawNotice = notice;
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `Agent prompt:\n${notice}\n\nReply in the message box or use the quick actions below. For login prompts, complete CLI login in an external terminal, then return to Agent and press Start again.`
        });
      }
      if (actionablePrompt) {
        this.agentControlCommandInProgress = false;
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
    if (this.agentProvider !== "claude") {
      this.refreshAgentAuthStatus();
      return false;
    }

    this.agentConversationReady = false;
    this.agentAuthState = "login-required";
    this.agentAutoLoginPending = false;
    this.agentNeedsAuth = true;
    this.setAgentStatus("Claude Code login required");
    if (!this.agentAutoLoginAttempted) {
      this.agentAutoLoginAttempted = true;
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: `${reason} Run Claude Code login in an external terminal, then press Start again.`
      });
    }
    new Notice(this.getExternalLoginHint(this.agentProvider));
    return true;
  }

  private async startGeminiLoginFlow(reason: string): Promise<boolean> {
    if (this.agentProvider !== "gemini") {
      this.refreshAgentAuthStatus();
      return false;
    }

    const sessionKey = this.activeAgentSessionKey;
    const cwd = this.plugin.getVaultPath();
    if (!cwd) {
      new Notice("This vault does not expose a local file-system path.");
      return false;
    }

    if (this.agentHost) {
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: "기존 Antigravity/Gemini 로그인 세션을 정리하고 다시 시작합니다."
      });
    }

    this.disposeAgent();
    this.agentProvider = "gemini";
    this.captureActiveAgentSessionState();
    this.saveAgentViewState();
    this.refreshAgentProviderUi();

    this.agentStartedAt = Date.now();
    this.agentSessionPath = null;
    this.agentSessionOffset = 0;
    this.agentCurrentTurnStartedAt = 0;
    this.agentSessionBaselineOffsets = snapshotAgentSessionOffsets("gemini", cwd);
    this.agentSeenEntries.clear();
    this.agentAuthState = "login-in-progress";
    this.agentConversationReady = false;
    this.agentReadyNoticeShown = false;
    this.agentAutoLoginAttempted = false;
    this.agentAutoLoginPending = false;
    this.agentAutoMcpAttempted = false;
    this.agentMcpAuthInProgress = false;
    this.agentNeedsAuth = true;
    this.agentPromptState = null;
    this.agentOpenedExternalUrls.clear();
    this.agentPostLaunchInput = null;
    this.lastAgentLaunchCommand = "";
    this.ensureGeminiSessionId();
    this.refreshAgentPromptActions();
    this.codexGitBranch = null;
    this.refreshCodexStatusLine();
    void this.refreshCodexGitBranch(cwd, sessionKey);
    const antigravity = isAntigravityCli(this.plugin.settings);
    this.agentReadyForInput = false;
    this.setAgentStatus(antigravity ? "Starting Antigravity CLI login..." : "Starting Gemini CLI login...");
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("system"),
      role: "system",
      text: `${reason} ${antigravity ? "Antigravity CLI" : "Gemini CLI"} 로그인 화면을 플러그인 안에서 시작합니다 · ${cwd}`
    });

    try {
      const env = buildProcessEnv({
        useSystemCa: this.plugin.settings.useSystemCa,
        extraCaCertPath: this.plugin.getExtraCaCertPath()
      });
      // agy shows its sign-in menu automatically when logged out; Enter selects
      // the highlighted "Google OAuth" entry. Legacy Gemini CLI needs /auth.
      this.agentPostLaunchInput = antigravity ? "\r" : "/auth\r";
      const availabilityFailure = await getGeminiCliAvailabilityFailure(cwd, env, this.plugin.settings);
      if (availabilityFailure) {
        this.withAgentSession(sessionKey, () => {
          this.agentAuthState = "login-required";
          this.agentNeedsAuth = true;
          this.setAgentStatus("Antigravity CLI missing");
          this.appendAgentTranscript({
            id: this.nextLocalAgentEntryId("system"),
            role: "system",
            text: availabilityFailure.summary
          });
        });
        return false;
      }

      const missingRuntimeFiles = this.plugin.getRuntimeMissingFiles();
      if (missingRuntimeFiles.length > 0) {
        if (!this.plugin.settings.autoInstallRuntime) {
          throw new Error("Runtime files are missing. Use Settings > Obst Terminal > Runtime files first.");
        }

        await this.plugin.installRuntimeIfNeeded((message) => {
          this.withAgentSession(sessionKey, () => this.setAgentStatus(message));
        });
      }

      this.withAgentSession(sessionKey, () => {
        this.agentProvider = "gemini";
        this.agentAuthState = "login-in-progress";
        this.agentNeedsAuth = true;
        this.setAgentStatus("Antigravity CLI login in progress");
        this.startAgentHost(sessionKey, cwd, env, "gemini");
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.withAgentSession(sessionKey, () => {
        this.setAgentStatus("Failed");
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `Failed to start Antigravity CLI login: ${message}`
        });
      });
      new Notice(`Failed to start Antigravity CLI login: ${message}`);
      return false;
    }
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
    if (this.agentProvider === "gemini" && /^\/\S*/.test(text.trim())) {
      this.agentControlCommandInProgress = true;
      this.agentConversationReady = false;
      this.agentAuthState = "ready";
    }

    if (/\/(?:login|auth)\b/i.test(text)) {
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
      this.startCodexTurn(text, true);
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
      this.stopTurnProgressTimer();
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
    this.refreshAgentStartButton();
    if (!this.isVisibleAgentSessionContext()) {
      return;
    }
    const activePrintTurn = this.agentPrintTurnRuntime && !this.agentPrintTurnRuntime.settled
      ? this.agentPrintTurnRuntime
      : null;
    const displayText = activePrintTurn && !isAgentLoadingStatus(text)
      ? `Waiting for ${getAgentProviderLabel(activePrintTurn.provider)} response...`
      : text;
    const loading = !!activePrintTurn || this.codexTurnActive || isAgentLoadingStatus(displayText);
    this.agentStatusEl?.setText(displayText);
    this.agentStatusEl?.toggleClass("is-loading", loading);
    this.agentLoadingEl?.toggleClass("is-hidden", !loading);
    if (this.agentLoadingTextEl) {
      this.agentLoadingTextEl.setText(displayText);
    }
    this.updateTurnProgressIndicator();
    if (loading && this.codexTurnLoadingEl?.isConnected) {
      this.startTurnProgressTimer();
    }
  }

  private nextLocalAgentEntryId(role: AgentTranscriptRole): string {
    this.agentLocalMessageCounter += 1;
    return `local-${role}-${Date.now()}-${this.agentLocalMessageCounter}`;
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
    this.cancelActiveAgentStartRequest();
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
    if (kill) {
      this.killActivePrintTurn("stopped");
    }
    this.agentPrintQueuedInputs = [];

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
    this.agentPrintTurnRuntime = null;
    this.agentPrintQueuedInputs = [];
    this.agentSeenEntries.clear();
    this.agentLastRawNotice = "";
    this.agentAuthState = "idle";
    this.agentConversationReady = false;
    this.agentReadyNoticeShown = false;
    this.agentAutoLoginAttempted = false;
    this.agentAutoLoginPending = false;
    this.agentAutoMcpAttempted = false;
    this.agentMcpAuthInProgress = false;
    this.agentControlCommandInProgress = false;
    this.agentNeedsAuth = false;
    this.agentPromptState = null;
    this.agentOpenedExternalUrls.clear();
    this.agentPostLaunchInput = null;
    this.refreshAgentPromptActions();
    this.setAgentStatus("Idle");
  }

  private killActivePrintTurn(reason: string) {
    const runtime = this.agentPrintTurnRuntime;
    if (!runtime || runtime.settled) {
      return;
    }

    try {
      runtime.kill(reason);
    } catch {
      // best-effort cleanup
    }
    runtime.cancelReason = reason;
    runtime.settled = true;
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

    new Setting(containerEl)
      .setName("Voice transcription server")
      .setDesc("Whisper-compatible server that receives the complete in-memory recording once after Stop.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_VOICE_TRANSCRIPTION_API_BASE_URL)
          .setValue(this.plugin.settings.voiceTranscriptionApiBaseUrl)
          .onChange((value) => {
            this.plugin.settings.voiceTranscriptionApiBaseUrl = normalizeVoiceTranscriptionApiBaseUrl(value);
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Voice transcription language")
      .setDesc("Language hint used by the transcription server.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ko", "Korean")
          .addOption("en", "English")
          .addOption("", "Auto detect")
          .setValue(this.plugin.settings.voiceTranscriptionLanguage)
          .onChange((value) => {
            this.plugin.settings.voiceTranscriptionLanguage = normalizeVoiceTranscriptionLanguage(value);
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Persist Agent transcript snapshots")
      .setDesc("Off by default. When enabled, visible Claude/Codex transcript HTML is saved only in the current user's local Obst Terminal state, outside the shared vault.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.persistAgentTranscriptSnapshots)
          .onChange((value) => {
            void this.plugin.setPersistAgentTranscriptSnapshots(value);
          })
      );

    const agentDetails = containerEl.createEl("details", { cls: "vault-terminal-advanced-settings" });
    agentDetails.createEl("summary", { text: "Agent CLI settings" });
    const agentEl = agentDetails.createDiv("vault-terminal-advanced-settings-body");

    new Setting(agentEl)
      .setName("Codex executable")
      .setDesc("Optional command or absolute path. Leave empty to use codex from PATH.")
      .addText((text) =>
        text
          .setPlaceholder("codex")
          .setValue(this.plugin.settings.codexExecutable)
          .onChange((value) => {
            this.plugin.settings.codexExecutable = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(agentEl)
      .setName("Codex app-server")
      .setDesc("Use Codex app-server with model/context/rate-limit statusline support.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.codexUseAppServer)
          .onChange((value) => {
            this.plugin.settings.codexUseAppServer = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(agentEl)
      .setName("Codex approval policy")
      .setDesc("Default approval policy for Codex app-server sessions.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("on-request", "on-request")
          .addOption("on-failure", "on-failure")
          .addOption("untrusted", "untrusted")
          .addOption("never", "never")
          .setValue(this.plugin.settings.codexApprovalPolicy)
          .onChange((value) => {
            this.plugin.settings.codexApprovalPolicy = normalizeCodexApprovalPolicy(value);
            void this.plugin.saveSettings();
          })
      );

    new Setting(agentEl)
      .setName("Claude executable")
      .setDesc("Optional command or absolute path. Leave empty to use claude from PATH.")
      .addText((text) =>
        text
          .setPlaceholder("claude")
          .setValue(this.plugin.settings.claudeExecutable)
          .onChange((value) => {
            this.plugin.settings.claudeExecutable = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(agentEl)
      .setName("Claude effort")
      .setDesc("Optional --effort value for Claude Code.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("", "Default")
          .addOption("low", "low")
          .addOption("medium", "medium")
          .addOption("high", "high")
          .addOption("xhigh", "xhigh")
          .addOption("max", "max")
          .setValue(this.plugin.settings.claudeEffort)
          .onChange((value) => {
            this.plugin.settings.claudeEffort = normalizeClaudeEffort(value);
            void this.plugin.saveSettings();
          })
      );

    new Setting(agentEl)
      .setName("Claude permission mode")
      .setDesc("Claude Code --permission-mode for interactive and print turns.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("default", "default")
          .addOption("auto", "auto")
          .addOption("acceptEdits", "acceptEdits")
          .addOption("dontAsk", "dontAsk")
          .addOption("plan", "plan")
          .addOption("bypassPermissions", "bypassPermissions")
          .setValue(this.plugin.settings.claudePermissionMode)
          .onChange((value) => {
            this.plugin.settings.claudePermissionMode = normalizeClaudePermissionMode(value);
            void this.plugin.saveSettings();
          })
      );

    new Setting(agentEl)
      .setName("Claude strict MCP config")
      .setDesc("Pass --strict-mcp-config to avoid loading heavy global MCP servers.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.claudeStrictMcpConfig)
          .onChange((value) => {
            this.plugin.settings.claudeStrictMcpConfig = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(agentEl)
      .setName("Antigravity executable")
      .setDesc("Optional command or absolute path. Leave empty to use agy from PATH or %LOCALAPPDATA%\\agy\\bin\\agy.exe. Point this to gemini only for legacy Gemini Code Assist enterprise licenses.")
      .addText((text) =>
        text
          .setPlaceholder("agy")
          .setValue(this.plugin.settings.geminiExecutable)
          .onChange((value) => {
            this.plugin.settings.geminiExecutable = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(agentEl)
      .setName("Antigravity sandbox")
      .setDesc("Pass --sandbox to Antigravity CLI turns.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.geminiSandbox)
          .onChange((value) => {
            this.plugin.settings.geminiSandbox = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(agentEl)
      .setName("Antigravity add directories")
      .setDesc("Optional comma/newline list passed as repeated --add-dir values.")
      .addText((text) =>
        text
          .setPlaceholder("C:\\path\\to\\project")
          .setValue(this.plugin.settings.geminiIncludeDirectories)
          .onChange((value) => {
            this.plugin.settings.geminiIncludeDirectories = normalizeDelimitedSetting(value);
            void this.plugin.saveSettings();
          })
      );

    const advancedDetails = containerEl.createEl("details", { cls: "vault-terminal-advanced-settings" });
    advancedDetails.createEl("summary", { text: "Advanced runtime and network settings" });
    const advancedEl = advancedDetails.createDiv("vault-terminal-advanced-settings-body");

    new Setting(advancedEl)
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
    new Setting(advancedEl)
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

    new Setting(advancedEl)
      .setName("Install runtime automatically")
      .setDesc("Optional. Downloads the verified OS-specific runtime package when the interactive agent control runtime is missing or out of date.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoInstallRuntime)
          .onChange((value) => {
            this.plugin.settings.autoInstallRuntime = value;
            void this.plugin.saveSettings();
          })
      );

    if (process.platform === "win32") {
      new Setting(advancedEl)
        .setName("Windows PTY backend")
        .setDesc("Used only for background interactive agent control processes. ConPTY is the default on modern Windows.")
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

    new Setting(advancedEl)
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

    new Setting(advancedEl)
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
  env.CURL_CA_BUNDLE = extraCaCertPath;
  env.GIT_SSL_CAINFO = extraCaCertPath;
  env.GRPC_DEFAULT_SSL_ROOTS_FILE_PATH = extraCaCertPath;
  env.AWS_CA_BUNDLE = extraCaCertPath;
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

function normalizeVoiceTranscriptionApiBaseUrl(value: string | undefined): string {
  return ((value ?? "").trim() || DEFAULT_VOICE_TRANSCRIPTION_API_BASE_URL).replace(/\/+$/, "");
}

function normalizeVoiceTranscriptionLanguage(value: string | undefined): VoiceTranscriptionLanguage {
  return value === "" || value === "en" ? value : "ko";
}

function getPreferredVoiceRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4"
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function getMediaRecorderErrorMessage(event: Event): string {
  const error = (event as Event & { error?: DOMException }).error;
  return error?.message || "마이크 녹음 중 오류가 발생했습니다.";
}

async function prepareVoiceAudioPayload(recording: Blob): Promise<VoiceAudioPayload> {
  const timestamp = formatAttachmentTimestamp(new Date());
  try {
    return {
      bytes: await convertVoiceRecordingToWav(recording),
      filename: `${timestamp}-voice.wav`,
      contentType: "audio/wav"
    };
  } catch {
    const contentType = recording.type || "application/octet-stream";
    return {
      bytes: new Uint8Array(await recording.arrayBuffer()),
      filename: `${timestamp}-voice.${getVoiceRecordingExtension(contentType)}`,
      contentType
    };
  }
}

async function convertVoiceRecordingToWav(recording: Blob): Promise<Uint8Array> {
  type AudioContextClass = new (options?: AudioContextOptions) => AudioContext;
  const AudioContextConstructor = window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("AudioContext is unavailable.");
  }

  const context = new AudioContextConstructor();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    return encodeAudioBufferAsMonoWav(decoded, VOICE_WAV_SAMPLE_RATE);
  } finally {
    await context.close().catch(() => undefined);
  }
}

function encodeAudioBufferAsMonoWav(audio: AudioBuffer, targetSampleRate: number): Uint8Array {
  if (audio.length === 0 || audio.numberOfChannels === 0 || audio.sampleRate <= 0) {
    throw new Error("Decoded recording is empty.");
  }

  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  const outputLength = Math.max(1, Math.round(audio.length * targetSampleRate / audio.sampleRate));
  const dataLength = outputLength * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  const sourceStep = audio.sampleRate / targetSampleRate;
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourcePosition = Math.min(audio.length - 1, outputIndex * sourceStep);
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(audio.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    let sample = 0;
    for (const channel of channels) {
      sample += channel[leftIndex] + (channel[rightIndex] - channel[leftIndex]) * fraction;
    }
    sample = Math.max(-1, Math.min(1, sample / channels.length));
    view.setInt16(44 + outputIndex * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function getVoiceRecordingExtension(contentType: string): string {
  if (/mp4|m4a/i.test(contentType)) {
    return "m4a";
  }
  if (/ogg/i.test(contentType)) {
    return "ogg";
  }
  if (/wav/i.test(contentType)) {
    return "wav";
  }
  return "webm";
}

async function transcribeVoiceAudio(
  payload: VoiceAudioPayload,
  settings: PowerShellSettings,
  prompt = ""
): Promise<string> {
  const endpoint = getVoiceTranscriptionEndpoint(settings.voiceTranscriptionApiBaseUrl);
  const multipart = buildVoiceTranscriptionMultipart(payload, settings.voiceTranscriptionLanguage, prompt);
  const response = await withTimeout(requestUrl({
    url: endpoint,
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${multipart.boundary}`
    },
    body: toArrayBuffer(multipart.body),
    throw: false
  }), VOICE_TRANSCRIPTION_TIMEOUT_MS, "음성 전사 요청 시간이 초과되었습니다.");

  if (response.status < 200 || response.status >= 300) {
    const detail = getVoiceTranscriptionResponseText(response.text).slice(0, 1_000);
    throw new Error(`전사 서버 오류 (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return getVoiceTranscriptionResponseText(response.text);
}

function getVoiceTranscriptionEndpoint(baseUrl: string): string {
  const normalized = normalizeVoiceTranscriptionApiBaseUrl(baseUrl);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`전사 서버 주소가 올바르지 않습니다: ${normalized}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("전사 서버 주소는 http 또는 https여야 합니다.");
  }
  if (!/\/v1\/audio\/transcriptions\/?$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/audio/transcriptions`;
  }
  return url.toString().replace(/\/$/, "");
}

function buildVoiceTranscriptionMultipart(
  payload: VoiceAudioPayload,
  language: VoiceTranscriptionLanguage,
  prompt: string
): { boundary: string; body: Uint8Array } {
  const boundary = `----ObstTerminal${randomUUID().replace(/-/g, "")}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const pushTextField = (name: string, value: string) => {
    chunks.push(encoder.encode(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      `${value}\r\n`
    ));
  };
  if (language) {
    pushTextField("language", language);
  }
  if (prompt.trim()) {
    pushTextField("prompt", prompt.trim().slice(0, 1_800));
  }
  pushTextField("response_format", "text");
  pushTextField("diarize", "false");
  chunks.push(encoder.encode(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${payload.filename.replace(/"/g, "")}"\r\n` +
    `Content-Type: ${payload.contentType}\r\n\r\n`
  ));
  chunks.push(payload.bytes);
  chunks.push(encoder.encode(`\r\n--${boundary}--\r\n`));
  return { boundary, body: concatenateBytes(chunks) };
}

function concatenateBytes(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function getVoiceTranscriptionResponseText(responseText: string): string {
  const text = responseText.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) {
    return text.slice(0, 500_000);
  }
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const candidate = value.text ?? value.transcript ?? value.detail ?? value.error;
    if (typeof candidate === "string") {
      return candidate.trim().slice(0, 500_000);
    }
    if (candidate && typeof candidate === "object" && "message" in candidate && typeof candidate.message === "string") {
      return candidate.message.trim().slice(0, 500_000);
    }
  } catch {
    // Return the raw response below when it is not valid JSON.
  }
  return text.slice(0, 500_000);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  }
}

function formatVoiceDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatVoiceCaptureError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "마이크 권한이 거부되었습니다. 운영체제 설정에서 Obsidian의 마이크 접근을 허용하세요.";
    }
    if (error.name === "NotFoundError") {
      return "사용 가능한 마이크를 찾지 못했습니다.";
    }
    if (error.name === "NotReadableError") {
      return "마이크를 열 수 없습니다. 다른 앱이 마이크를 사용 중인지 확인하세요.";
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|ERR_CONNECTION|Failed to fetch|Network Error/i.test(message)) {
    return "음성 전사 서버에 연결하지 못했습니다. 사내망 또는 VPN 연결과 서버 주소를 확인하세요.";
  }
  return `음성 전사 실패: ${message}`;
}

function insertTextIntoTextarea(input: HTMLTextAreaElement, text: string) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const leading = before && !/\s$/.test(before) ? (start === input.value.length ? "\n" : " ") : "";
  const trailing = after && !/^\s/.test(after) ? " " : "";
  input.setRangeText(`${leading}${text}${trailing}`, start, end, "end");
}

function appendComposerText(existing: string, text: string): string {
  const current = existing.trimEnd();
  return current ? `${current}\n${text}` : text;
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

function appendAgentAttachmentPrompt(
  text: string,
  attachments: AgentAttachment[],
  provider: AgentProvider,
  cwd: string | null
): string {
  if (attachments.length === 0) {
    return text;
  }

  const hasImage = attachments.some((attachment) => attachment.kind === "localImage");
  const instruction = provider === "gemini"
    ? hasImage
      ? "다음 @ 파일 참조를 실제 멀티모달 이미지로 불러와 픽셀 내용을 확인한 뒤 답변하세요."
      : "다음 @ 파일 참조의 실제 내용을 불러온 뒤 답변하세요."
    : provider === "claude"
      ? hasImage
        ? "아래 이미지 경로를 Read 도구로 열어 실제 픽셀 내용을 확인한 뒤 답변하세요. 경로 문자열만 보고 추측하지 마세요."
        : "아래 파일 경로를 Read 도구로 열어 실제 내용을 확인한 뒤 답변하세요."
      : hasImage
        ? "아래 첨부 이미지를 실제 이미지 입력으로 확인한 뒤 답변하세요."
        : "아래 첨부 파일의 실제 내용을 확인한 뒤 답변하세요.";
  const attachmentText = attachments.map((attachment) => {
    const name = attachment.name ?? "attachment";
    const path = provider === "gemini"
      ? formatGeminiAttachmentReference(attachment.path, cwd)
      : `"${attachment.path.replace(/"/g, '\\"')}"`;
    const kind = attachment.kind === "localImage" ? "image" : "file";
    return `- ${kind} ${name}: ${path}`;
  }).join("\n");
  const prefix = text.trim() ? `${text.trim()}\n\n` : "";
  return `${prefix}${instruction}\n첨부 파일:\n${attachmentText}`;
}

function formatGeminiAttachmentReference(path: string, cwd: string | null): string {
  const referencePath = cwd && isPathInsideDirectory(path, cwd)
    ? relative(cwd, path)
    : path;
  const normalized = referencePath.replace(/\\/g, "/").replace(/ /g, "\\ ");
  return `@${normalized}`;
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  const relativePath = relative(resolve(directory), resolve(path));
  return relativePath === "" || (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
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

function findExecutableOnPath(command: string): string | null {
  if (!command || command.includes("/") || command.includes("\\")) {
    return null;
  }

  const pathKey = getPathKey(process.env);
  const pathValue = process.env[pathKey] ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const names = process.platform === "win32" && !/\.[a-z0-9]+$/i.test(command)
    ? extensions.map((extension) => `${command}${extension.toLowerCase()}`)
    : [command];

  for (const entry of pathValue.split(separator).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(entry, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
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
  if (provider === "claude") {
    return "Claude Code";
  }
  if (provider === "gemini") {
    return "Antigravity CLI";
  }
  return "Codex";
}

function providerMenuIconSvg(path: string): string {
  return `<path d="${path}" fill="currentColor" transform="scale(4.1666667)"/>`;
}

function isAgentProvider(value: unknown): value is AgentProvider {
  return value === "claude" || value === "codex" || value === "gemini";
}

function isPrintCommandProvider(provider: AgentProvider): boolean {
  return provider === "claude" || provider === "gemini";
}

function isSlashCommandText(text: string): boolean {
  return /^\/\S*/.test(text.trim());
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
    target === "gemini" ||
    target === "geminicli" ||
    target === "agy" ||
    target === "antigravity" ||
    target === "클로드" ||
    target === "클로드코드" ||
    target === "제미나이" ||
    target === "구글제미나이" ||
    target === "안티그래비티";
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
    session.codexThreadId ? shortSessionId(session.codexThreadId) : "",
    session.geminiSessionId ? shortSessionId(session.geminiSessionId) : ""
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
  return "Claude Code";
}

function isGeneratedAgentSessionLabel(label: string): boolean {
  return /^Agent [a-zA-Z0-9]{1,16}$/.test(label.trim());
}

function isProviderAgentSessionLabel(label: string): boolean {
  return /^(Claude Code|Codex|Gemini CLI|Antigravity CLI)(?: \d+)?$/.test(label.trim());
}

function getUniqueProviderAgentSessionLabel(
  sessions: AgentWorkspaceSessionState[],
  provider: AgentProvider,
  sessionKey: string
): string {
  const base = getAgentProviderLabel(provider);
  const used = new Set(
    sessions
      .filter((session) => session.agentSessionKey !== sessionKey)
      .map((session) => session.agentSessionLabel.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!used.has(base.toLowerCase())) {
    return base;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${base} ${Date.now()}`;
}

function ensureProviderAgentSessionLabels(sessions: AgentWorkspaceSessionState[]) {
  const used = new Set(
    sessions
      .filter((session) => {
        const label = session.agentSessionLabel.trim();
        return label && !isGeneratedAgentSessionLabel(label) && !isProviderAgentSessionLabel(label);
      })
      .map((session) => session.agentSessionLabel.trim().toLowerCase())
  );
  for (const session of sessions) {
    const label = session.agentSessionLabel.trim();
    if (!label || isGeneratedAgentSessionLabel(label) || isProviderAgentSessionLabel(label)) {
      const base = getAgentProviderLabel(session.agentProvider);
      let next = base;
      for (let index = 2; used.has(next.toLowerCase()); index += 1) {
        next = `${base} ${index}`;
      }
      session.agentSessionLabel = next;
      used.add(next.toLowerCase());
    }
  }
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
    codexThreadId: session.codexThreadId,
    geminiSessionId: session.geminiSessionId ?? undefined
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
  ensureUniqueAgentWorkspaceSessionIds(sessions);
  ensureProviderAgentSessionLabels(sessions);

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
    codexThreadId: activeSession.codexThreadId,
    geminiSessionId: activeSession.geminiSessionId ?? undefined
  };
}

function ensureUniqueAgentWorkspaceSessionIds(sessions: AgentWorkspaceSessionState[]) {
  const usedClaudeIds = new Set<string>();
  const usedGeminiIds = new Set<string>();

  for (const session of sessions) {
    if (!session.claudeSessionId || usedClaudeIds.has(session.claudeSessionId.toLowerCase())) {
      session.claudeSessionId = createUniqueSessionUuid(usedClaudeIds);
    }
    usedClaudeIds.add(session.claudeSessionId.toLowerCase());

    if (session.claudeControlSessionId) {
      const controlKey = session.claudeControlSessionId.toLowerCase();
      if (usedClaudeIds.has(controlKey)) {
        session.claudeControlSessionId = null;
      } else {
        usedClaudeIds.add(controlKey);
      }
    }

    if (!session.geminiSessionId || usedGeminiIds.has(session.geminiSessionId.toLowerCase())) {
      session.geminiSessionId = createUniqueSessionUuid(usedGeminiIds);
      session.geminiNativeSessionStarted = false;
    }
    usedGeminiIds.add(session.geminiSessionId.toLowerCase());
  }
}

function createUniqueSessionUuid(used: Set<string>): string {
  while (true) {
    const id = randomUUID();
    if (!used.has(id.toLowerCase())) {
      return id;
    }
  }
}

function stripAgentViewTranscriptSnapshots(value: unknown): AgentViewSessionState | undefined {
  const normalized = normalizeAgentViewSessionState(value);
  if (!normalized) {
    return undefined;
  }

  return {
    ...normalized,
    agentSessions: normalized.agentSessions?.map((session) => ({
      ...session,
      claudeTranscriptHtml: "",
      codexTranscriptHtml: "",
      geminiTranscriptHtml: "",
      claudeScrollTop: 0,
      codexScrollTop: 0,
      geminiScrollTop: 0
    }))
  };
}

function createAgentWorkspaceSessionState(mode: AgentSessionMode, provider: AgentProvider = "claude"): AgentWorkspaceSessionState {
  const sessionKey = createAgentSessionKey();
  const now = Date.now();
  return {
    agentSessionKey: sessionKey,
    agentSessionLabel: createAgentSessionLabel(sessionKey),
    agentSessionMode: mode,
    agentProvider: provider,
    claudeSessionId: randomUUID(),
    claudeControlSessionId: null,
    codexThreadId: null,
    geminiSessionId: randomUUID(),
    geminiNativeSessionStarted: false,
    claudeTranscriptHtml: "",
    codexTranscriptHtml: "",
    geminiTranscriptHtml: "",
    claudeScrollTop: 0,
    codexScrollTop: 0,
    geminiScrollTop: 0,
    inputText: "",
    statusText: "Idle",
    deepVaultEnabled: false,
    claudeRequestedModel: null,
    claudeResolvedModel: null,
    agentTokenUsage: null,
    agentLastUsageText: null,
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
  const provider = isAgentProvider(candidate.agentProvider)
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
    geminiSessionId: typeof candidate.geminiSessionId === "string" && candidate.geminiSessionId.trim()
      ? candidate.geminiSessionId.trim()
      : randomUUID(),
    geminiNativeSessionStarted: candidate.geminiNativeSessionStarted === true,
    claudeTranscriptHtml: typeof candidate.claudeTranscriptHtml === "string" ? sanitizeAgentTranscriptHtml(candidate.claudeTranscriptHtml) : "",
    codexTranscriptHtml: typeof candidate.codexTranscriptHtml === "string" ? sanitizeAgentTranscriptHtml(candidate.codexTranscriptHtml) : "",
    geminiTranscriptHtml: typeof candidate.geminiTranscriptHtml === "string" ? sanitizeAgentTranscriptHtml(candidate.geminiTranscriptHtml) : "",
    claudeScrollTop: typeof candidate.claudeScrollTop === "number" ? candidate.claudeScrollTop : 0,
    codexScrollTop: typeof candidate.codexScrollTop === "number" ? candidate.codexScrollTop : 0,
    geminiScrollTop: typeof candidate.geminiScrollTop === "number" ? candidate.geminiScrollTop : 0,
    inputText: typeof candidate.inputText === "string" ? candidate.inputText : "",
    // Restored sessions have no live process, so a persisted loading status
    // ("Waiting for ... response...", "... in progress") is stale by
    // definition and must not resurrect the loading indicator.
    statusText: typeof candidate.statusText === "string" && candidate.statusText.trim() && !isStaleRestoredAgentStatus(candidate.statusText)
      ? candidate.statusText
      : "Idle",
    deepVaultEnabled: candidate.deepVaultEnabled === true,
    claudeRequestedModel: typeof candidate.claudeRequestedModel === "string"
      ? candidate.claudeRequestedModel.trim()
      : null,
    claudeResolvedModel: typeof candidate.claudeResolvedModel === "string" && candidate.claudeResolvedModel.trim()
      ? candidate.claudeResolvedModel.trim()
      : null,
    agentTokenUsage: normalizeTokenUsage(candidate.agentTokenUsage),
    agentLastUsageText: typeof candidate.agentLastUsageText === "string" && candidate.agentLastUsageText.trim()
      ? candidate.agentLastUsageText.trim()
      : null,
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

/** Status texts that only make sense while a process is actually running. */
function isStaleRestoredAgentStatus(text: string): boolean {
  return isAgentLoadingStatus(text) || /waiting for .{1,60} response|응답 중/i.test(text);
}

function formatElapsedSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`;
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

interface ClaudePrintOptions {
  sessionId?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  sessionName?: string;
  settings?: PowerShellSettings;
  onUsage?: (usage: TokenUsage) => void;
  onModel?: (modelId: string) => void;
}

function getClaudeExecutable(settings: PowerShellSettings): string {
  return settings.claudeExecutable?.trim() || "claude";
}

function getCodexExecutable(settings: PowerShellSettings): string {
  return settings.codexExecutable?.trim() || "codex";
}

function getGeminiExecutable(settings: PowerShellSettings): string {
  const configured = settings.geminiExecutable?.trim();
  if (configured) {
    return configured;
  }

  const pathAgy = findExecutableOnPath("agy");
  if (pathAgy) {
    return pathAgy;
  }

  const localAppData = process.env.LOCALAPPDATA;
  const localAgy = localAppData ? join(localAppData, "agy", "bin", process.platform === "win32" ? "agy.exe" : "agy") : "";
  if (localAgy && existsSync(localAgy)) {
    return localAgy;
  }

  // Legacy Gemini CLI still serves Gemini Code Assist Standard/Enterprise licenses.
  const pathGemini = findExecutableOnPath("gemini");
  if (pathGemini) {
    return pathGemini;
  }

  return "agy";
}

function isAntigravityExecutablePath(executable: string): boolean {
  const base = executable.trim().replace(/\\/g, "/").split("/").pop() ?? "";
  return /^(?:agy|antigravity)(?:\.exe|\.cmd|\.ps1)?$/i.test(base);
}

function isAntigravityCli(settings: PowerShellSettings): boolean {
  return isAntigravityExecutablePath(getGeminiExecutable(settings));
}

function getGeminiLoginHintCommand(settings: PowerShellSettings): string {
  return isAntigravityCli(settings) ? "agy" : "gemini";
}

function getGeminiModelChoices(settings: PowerShellSettings): Array<{ value: string; label: string }> {
  return isAntigravityCli(settings) ? GEMINI_MODEL_CHOICES : LEGACY_GEMINI_MODEL_CHOICES;
}

function getAgentLaunchCommand(provider: AgentProvider, settings: PowerShellSettings, options: AgentLaunchOptions = {}): string {
  if (provider === "claude") {
    const executable = quoteShellArg(getClaudeExecutable(settings));
    const sessionArgs = options.claudeSessionId
      ? ` --session-id ${options.claudeSessionId}${options.sessionName ? ` --name ${quoteShellArg(options.sessionName)}` : ""}`
      : " --continue";
    const args = [
      sessionArgs.trim(),
      settings.claudeStrictMcpConfig ? "--strict-mcp-config" : "",
      "--permission-mode",
      settings.claudePermissionMode,
      settings.claudeModel ? `--model ${quoteShellArg(settings.claudeModel)}` : "",
      settings.claudeEffort ? `--effort ${settings.claudeEffort}` : ""
    ].filter(Boolean);
    return `${executable} ${args.join(" ")}`;
  }
  if (provider === "gemini") {
    const executable = getGeminiExecutable(settings);
    if (isAntigravityExecutablePath(executable)) {
      // Antigravity CLI (agy): no --approval-mode/--skip-trust/--include-directories.
      // A plain interactive launch shows the sign-in menu when logged out.
      const args = [
        settings.geminiModel ? `--model ${quoteShellArg(settings.geminiModel)}` : "",
        settings.geminiApprovalMode === "yolo" ? "--dangerously-skip-permissions" : "",
        settings.geminiSandbox ? "--sandbox" : "",
        ...getRepeatedGeminiShellArgs("--add-dir", settings.geminiIncludeDirectories)
      ].filter(Boolean);
      return `${quoteShellArg(executable)} ${args.join(" ")}`.trim();
    }
    const args = [
      settings.geminiModel ? `--model ${quoteShellArg(settings.geminiModel)}` : "",
      settings.geminiApprovalMode !== "default" ? `--approval-mode ${quoteShellArg(settings.geminiApprovalMode)}` : "",
      settings.geminiSkipTrust ? "--skip-trust" : "",
      settings.geminiSandbox ? "--sandbox" : "",
      ...getRepeatedGeminiShellArgs("--include-directories", settings.geminiIncludeDirectories)
    ].filter(Boolean);
    return `${quoteShellArg(executable)} ${args.join(" ")}`;
  }

  // codex resume --last reopens the most recent interactive session (PTY path).
  return rewriteCodexCommand("codex resume --last", {
    disableResizeReflow: settings.codexDisableResizeReflow,
    noAltScreen: settings.codexNoAltScreen
  }) ?? "codex resume --last";
}

async function getAgentAuthCheck(provider: AgentProvider, cwd: string, env: { [key: string]: string | undefined }, settings: PowerShellSettings, plugin?: VaultPowerShellPlugin): Promise<AgentAuthCheck> {
  if (provider === "claude") {
    const result = await runCapturedCommand(getClaudeExecutable(settings), ["auth", "status", "--json"], cwd, env, 8000);
    return parseClaudeAuthCheck(result);
  }
  if (provider === "gemini") {
    const executable = getGeminiExecutable(settings);
    const result = await runCapturedCommand(executable, ["--version"], cwd, env, 8000);
    if (isMissingGeminiCliResult(result)) {
      return createMissingGeminiCliAuthCheck(`${result.stdout}\n${result.stderr}\n${result.error ?? ""}`.trim());
    }
    // agy blocks forever on captured (non-TTY) stdio when logged out, but fails
    // fast inside a PTY ("Please sign in..."), so the login probe must run
    // through the PTY host. Skip it when the PTY runtime is unavailable.
    if (isAntigravityExecutablePath(executable) && plugin && plugin.hasRuntime()) {
      try {
        const modelsResult = await spawnPtyCapturedCommand(executable, ["models"], cwd, env, 15000, plugin).promise;
        return parseGeminiAuthCheck(result, modelsResult, settings);
      } catch {
        return parseGeminiAuthCheck(result, null, settings);
      }
    }
    return parseGeminiAuthCheck(result, null, settings);
  }

  const result = await runCapturedCommand(getCodexExecutable(settings), ["login", "status"], cwd, env, 8000);
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
      summary: "Claude Code is not signed in. Run `claude` in an external terminal, complete `/login` if prompted, then press Start again."
    };
  }

  if (/not logged in|login required|please run\s+\/login|invalid authentication/i.test(output)) {
    return {
      checked: true,
      loggedIn: false,
      summary: "Claude Code is not signed in. Run `claude` in an external terminal, complete `/login` if prompted, then press Start again."
    };
  }

  return {
    checked: false,
    loggedIn: null,
    summary: `Claude Code login status could not be confirmed before launch.${failure ? ` ${failure}` : ""} If login is needed, complete Claude login in an external terminal.`,
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
      summary: "Codex is not signed in. Run `codex login` in an external terminal, then press Start again."
    };
  }

  return {
    checked: false,
    loggedIn: null,
    summary: `Codex login status could not be confirmed before launch.${failure ? ` ${failure}` : ""} If login is needed, run \`codex login\` in an external terminal.`,
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
  options: ClaudePrintOptions = {}
): Promise<CapturedCommandResult> {
  return spawnClaudePrintCommand(prompt, cwd, env, timeoutMs, options).promise;
}

function parseGeminiAuthCheck(versionResult: CapturedCommandResult, modelsResult: CapturedCommandResult | null, settings: PowerShellSettings): AgentAuthCheck {
  const antigravity = isAntigravityCli(settings);
  const cliLabel = antigravity ? "Antigravity CLI" : "Gemini CLI";
  const output = `${versionResult.stdout}\n${versionResult.stderr}`.trim();
  const failure = getCapturedCommandFailure(versionResult);
  if (!failure) {
    if (modelsResult) {
      const modelsOutput = stripTerminalControlSequences(`${modelsResult.stdout}\n${modelsResult.stderr}`).trim();
      if (/Please sign in/i.test(modelsOutput) || getCapturedCommandFailure(modelsResult)) {
        return {
          checked: true,
          loggedIn: false,
          summary: "Antigravity CLI 로그인이 필요합니다. Agent Console에서 Login을 누르거나 일반 터미널에서 `agy`를 실행해 Google OAuth 로그인을 완료하세요.",
          detail: modelsOutput
        };
      }
    }
    return {
      checked: true,
      loggedIn: true,
      summary: `${cliLabel} 확인: ${output || "command is available"}.`
    };
  }

  if (isMissingGeminiCliResult(versionResult)) {
    return createMissingGeminiCliAuthCheck(output);
  }

  return {
    checked: false,
    loggedIn: null,
    summary: `${cliLabel} status could not be confirmed before launch.${failure ? ` ${failure}` : ""}`,
    detail: output
  };
}

async function getGeminiCliAvailabilityFailure(cwd: string, env: { [key: string]: string | undefined }, settings: PowerShellSettings): Promise<AgentAuthCheck | null> {
  const result = await runCapturedCommand(getGeminiExecutable(settings), ["--version"], cwd, env, 8000);
  if (!getCapturedCommandFailure(result)) {
    return null;
  }
  return createMissingGeminiCliAuthCheck(`${result.stdout}\n${result.stderr}`.trim());
}

function createMissingGeminiCliAuthCheck(detail = ""): AgentAuthCheck {
  return {
    checked: true,
    loggedIn: false,
    summary: "Antigravity CLI(agy)가 설치되어 있지 않거나 Obsidian의 PATH에서 보이지 않습니다. PowerShell에서 `irm https://antigravity.google/cli/install.ps1 | iex` 실행 후 Obsidian을 완전히 재시작하세요. (구형 Gemini CLI는 기업 라이선스에서만 동작합니다.)",
    detail
  };
}

function getGeminiAuthConfiguration(cwd: string, env: { [key: string]: string | undefined }): GeminiAuthConfiguration {
  const envFilePath = findGeminiEnvFile(cwd);
  const envFileValues = envFilePath ? readEnvFileValues(envFilePath) : {};
  const effectiveEnv = getEffectiveGeminiEnv(env, envFileValues);
  const envAuthType = getGeminiAuthTypeFromEnv(effectiveEnv);
  const settings = getGeminiAuthSettings(cwd, env);
  const authType = envAuthType ?? settings.selectedType;
  const authSource = envAuthType ? getGeminiAuthEnvSource(effectiveEnv) : settings.selectedSource;
  const detail = buildGeminiAuthDetail(settings, envFilePath, envFileValues, effectiveEnv);

  if (settings.enforcedType && authType !== settings.enforcedType) {
    const current = authType ? describeGeminiAuthType(authType) : "not configured";
    return {
      authType,
      authSource,
      detail,
      failure: {
        checked: true,
        loggedIn: false,
        summary: `Gemini CLI 인증 정책이 현재 설정과 맞지 않습니다. 강제 인증 방식은 ${describeGeminiAuthType(settings.enforcedType)}${settings.enforcedSource ? ` (${settings.enforcedSource})` : ""}인데, 현재 방식은 ${current}입니다. Agent Console에서 Gemini를 선택한 뒤 Login을 눌러 같은 인증 방식으로 다시 설정하세요.`,
        detail
      }
    };
  }

  if (!authType) {
    return {
      authType: null,
      authSource: null,
      detail,
      failure: createMissingGeminiAuthMethodCheck(detail)
    };
  }

  const validationFailure = getGeminiAuthValidationFailure(authType, effectiveEnv, detail);
  if (validationFailure) {
    return {
      authType,
      authSource,
      detail,
      failure: validationFailure
    };
  }

  if (authType === "oauth-personal") {
    const accountFailure = getGeminiOAuthPersonalAccountFailure(detail);
    if (accountFailure) {
      return {
        authType,
        authSource,
        detail: accountFailure.detail ?? detail,
        failure: accountFailure
      };
    }
  }

  return {
    authType,
    authSource,
    detail
  };
}

function createMissingGeminiAuthMethodCheck(detail = ""): AgentAuthCheck {
  const home = getUserHome();
  const settingsPath = home ? join(home, ".gemini", "settings.json") : "~/.gemini/settings.json";
  return {
    checked: true,
    loggedIn: false,
    summary: `Gemini CLI 인증 방식이 설정되어 있지 않습니다. Agent Console에서 Gemini를 선택한 뒤 Login을 눌러 Sign in with Google 구독 로그인을 진행하거나 ${settingsPath}의 security.auth.selectedType을 설정하세요. API 방식이면 GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA 중 하나를 환경변수나 .env에 설정한 뒤 Obsidian을 완전히 재시작하세요.`,
    detail
  };
}

function getGeminiOAuthPersonalAccountFailure(detail = ""): AgentAuthCheck | null {
  const home = getUserHome();
  const accountsPath = home ? join(home, ".gemini", "google_accounts.json") : null;
  const accountDetail = [
    detail,
    `Checked Gemini Google account: ${accountsPath ?? "~/.gemini/google_accounts.json"}`
  ].filter(Boolean).join("\n");

  if (!accountsPath || !existsSync(accountsPath)) {
    return {
      checked: true,
      loggedIn: false,
      summary: "Gemini CLI가 Sign in with Google 방식으로 설정되어 있지만 로그인된 Google 계정 파일이 없습니다. Agent Console에서 Gemini를 선택한 뒤 Login을 눌러 구독 계정 로그인을 완료하세요.",
      detail: `${accountDetail}\nGoogle account file is missing.`
    };
  }

  const accounts = readJsonObjectFile(accountsPath);
  if (!accounts || !hasActiveGeminiGoogleAccount(accounts.active)) {
    return {
      checked: true,
      loggedIn: false,
      summary: "Gemini CLI가 Sign in with Google 방식으로 설정되어 있지만 현재 활성 Google 계정이 없습니다. Agent Console에서 Gemini를 선택한 뒤 Login을 눌러 구독 계정 로그인을 완료하세요.",
      detail: `${accountDetail}\nGoogle account file has no active account.`
    };
  }

  return null;
}

function hasActiveGeminiGoogleAccount(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length > 0;
}

function getGeminiAuthValidationFailure(authType: string, env: Record<string, string | undefined>, detail: string): AgentAuthCheck | null {
  if (!isSupportedGeminiAuthType(authType)) {
    return {
      checked: true,
      loggedIn: false,
      summary: `Gemini CLI 인증 방식 ${authType}은 현재 플러그인에서 유효한 실행 방식으로 확인되지 않았습니다. Agent Console에서 Gemini를 선택한 뒤 Login을 눌러 인증 방식을 다시 선택하세요.`,
      detail
    };
  }

  if (authType === "vertex-ai") {
    const hasExpressApiKey = hasGeminiEnvValue(env.GOOGLE_API_KEY);
    const hasProject = hasGeminiEnvValue(env.GOOGLE_CLOUD_PROJECT) || hasGeminiEnvValue(env.GOOGLE_CLOUD_PROJECT_ID);
    const hasLocation = hasGeminiEnvValue(env.GOOGLE_CLOUD_LOCATION);
    if (!hasExpressApiKey && (!hasProject || !hasLocation)) {
      return {
        checked: true,
        loggedIn: false,
        summary: "Gemini CLI가 Vertex AI 인증 방식으로 설정되어 있지만 GOOGLE_API_KEY 또는 GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION 환경변수가 보이지 않습니다. 필요한 값을 환경변수나 .env에 설정한 뒤 Obsidian을 완전히 재시작하세요.",
        detail
      };
    }
  }

  return null;
}

function getGeminiAuthSettings(cwd: string, env: { [key: string]: string | undefined }): GeminiAuthSettings {
  const candidates = getGeminiSettingsCandidates(cwd, env);
  let selectedType: string | null = null;
  let selectedSource: string | null = null;
  let enforcedType: string | null = null;
  let enforcedSource: string | null = null;
  const checkedPaths: string[] = [];

  for (const candidate of candidates) {
    checkedPaths.push(`${candidate.label}: ${candidate.path}${existsSync(candidate.path) ? "" : " (missing)"}`);
    const settings = readJsonObjectFile(candidate.path);
    if (!settings) {
      continue;
    }

    const candidateSelectedType = getNestedString(settings, ["security", "auth", "selectedType"]);
    if (candidateSelectedType) {
      selectedType = candidateSelectedType;
      selectedSource = `${candidate.label} settings`;
    }

    const candidateEnforcedType = getNestedString(settings, ["security", "auth", "enforcedType"]);
    if (candidateEnforcedType) {
      enforcedType = candidateEnforcedType;
      enforcedSource = `${candidate.label} settings`;
    }
  }

  return {
    selectedType,
    selectedSource,
    enforcedType,
    enforcedSource,
    checkedPaths
  };
}

function getGeminiSettingsCandidates(cwd: string, env: { [key: string]: string | undefined }): Array<{ label: string; path: string }> {
  const candidates: Array<{ label: string; path: string }> = [];
  const home = getUserHome();
  const systemSettingsPath = getGeminiSystemSettingsPath(env);
  candidates.push({ label: "system defaults", path: join(dirname(systemSettingsPath), "system-defaults.json") });
  if (home) {
    candidates.push({ label: "user", path: join(home, ".gemini", "settings.json") });
  }
  candidates.push({ label: "workspace", path: join(resolve(cwd), ".gemini", "settings.json") });
  candidates.push({ label: "system", path: systemSettingsPath });
  return candidates;
}

function getGeminiSystemSettingsPath(env: { [key: string]: string | undefined }): string {
  const override = env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
  if (override) {
    return override;
  }
  if (process.platform === "win32") {
    return "C:\\ProgramData\\gemini-cli\\settings.json";
  }
  if (process.platform === "darwin") {
    return "/Library/Application Support/GeminiCli/settings.json";
  }
  return "/etc/gemini-cli/settings.json";
}

function findGeminiEnvFile(cwd: string): string | null {
  const home = getUserHome();
  let current = resolve(cwd);
  while (true) {
    const geminiEnvPath = join(current, ".gemini", ".env");
    if (existsSync(geminiEnvPath)) {
      return geminiEnvPath;
    }

    const envPath = join(current, ".env");
    if (existsSync(envPath)) {
      return envPath;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  if (home) {
    const homeGeminiEnvPath = join(home, ".gemini", ".env");
    if (existsSync(homeGeminiEnvPath)) {
      return homeGeminiEnvPath;
    }

    const homeEnvPath = join(home, ".env");
    if (existsSync(homeEnvPath)) {
      return homeEnvPath;
    }
  }

  return null;
}

function readEnvFileValues(filePath: string): Record<string, string> {
  try {
    const values: Record<string, string> = {};
    const text = readFileSync(filePath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const rawKey = line.slice(0, separatorIndex).trim().replace(/^export\s+/i, "");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rawKey)) {
        continue;
      }
      values[rawKey] = stripEnvFileQuotes(line.slice(separatorIndex + 1).trim());
    }
    return values;
  } catch {
    return {};
  }
}

function stripEnvFileQuotes(value: string): string {
  if (value.length >= 2) {
    const quote = value[0];
    if ((quote === "\"" || quote === "'") && value[value.length - 1] === quote) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function getEffectiveGeminiEnv(env: { [key: string]: string | undefined }, envFileValues: Record<string, string>): Record<string, string | undefined> {
  const keys = [
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_USE_GCA",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_GEMINI_BASE_URL",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT_ID",
    "GOOGLE_CLOUD_LOCATION",
    "CLOUD_SHELL",
    "GEMINI_CLI_USE_COMPUTE_ADC"
  ];
  const effective: Record<string, string | undefined> = {};
  for (const key of keys) {
    effective[key] = Object.prototype.hasOwnProperty.call(env, key) ? env[key] : envFileValues[key];
  }
  return effective;
}

function getGeminiAuthTypeFromEnv(env: Record<string, string | undefined>): string | null {
  if (env.GOOGLE_GENAI_USE_GCA === "true") {
    return "oauth-personal";
  }
  if (env.GOOGLE_GENAI_USE_VERTEXAI === "true") {
    return "vertex-ai";
  }
  if (hasGeminiEnvValue(env.GOOGLE_GEMINI_BASE_URL)) {
    return "gateway";
  }
  if (hasGeminiEnvValue(env.GEMINI_API_KEY)) {
    return "gemini-api-key";
  }
  if (env.CLOUD_SHELL === "true" || env.GEMINI_CLI_USE_COMPUTE_ADC === "true") {
    return "compute-default-credentials";
  }
  return null;
}

function getGeminiAuthEnvSource(env: Record<string, string | undefined>): string {
  if (env.GOOGLE_GENAI_USE_GCA === "true") {
    return "GOOGLE_GENAI_USE_GCA";
  }
  if (env.GOOGLE_GENAI_USE_VERTEXAI === "true") {
    return "GOOGLE_GENAI_USE_VERTEXAI";
  }
  if (hasGeminiEnvValue(env.GOOGLE_GEMINI_BASE_URL)) {
    return "GOOGLE_GEMINI_BASE_URL";
  }
  if (hasGeminiEnvValue(env.GEMINI_API_KEY)) {
    return "GEMINI_API_KEY";
  }
  if (env.CLOUD_SHELL === "true") {
    return "CLOUD_SHELL";
  }
  if (env.GEMINI_CLI_USE_COMPUTE_ADC === "true") {
    return "GEMINI_CLI_USE_COMPUTE_ADC";
  }
  return "environment";
}

function buildGeminiAuthDetail(
  settings: GeminiAuthSettings,
  envFilePath: string | null,
  envFileValues: Record<string, string>,
  effectiveEnv: Record<string, string | undefined>
): string {
  const configuredEnvVars = Object.keys(effectiveEnv).filter((key) => hasGeminiEnvValue(effectiveEnv[key]));
  const envFileConfiguredVars = Object.keys(envFileValues).filter((key) => hasGeminiEnvValue(envFileValues[key]));
  return [
    "Checked Gemini auth settings:",
    ...settings.checkedPaths.map((path) => `- ${path}`),
    `Env file: ${envFilePath ?? "none"}`,
    `Auth env vars visible: ${configuredEnvVars.length ? configuredEnvVars.join(", ") : "none"}`,
    `Env vars in detected env file: ${envFileConfiguredVars.length ? envFileConfiguredVars.join(", ") : "none"}`
  ].join("\n");
}

function readJsonObjectFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = parseJsonObject(readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function getNestedString(value: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function isSupportedGeminiAuthType(authType: string): boolean {
  return ["oauth-personal", "gemini-api-key", "vertex-ai", "gateway", "compute-default-credentials"].includes(authType);
}

function hasGeminiEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function describeGeminiAuthType(authType: string): string {
  switch (authType) {
    case "oauth-personal":
      return "Sign in with Google";
    case "gemini-api-key":
      return "Gemini API key";
    case "vertex-ai":
      return "Vertex AI";
    case "gateway":
      return "Gemini gateway";
    case "compute-default-credentials":
      return "Compute ADC";
    default:
      return authType;
  }
}

function isMissingGeminiCliResult(result: CapturedCommandResult): boolean {
  const output = `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`;
  if (!/(?:agy|antigravity|gemini)/i.test(output)) {
    return false;
  }
  if (/(?:command not found|not recognized|not found|enoent|spawn)/i.test(output)) {
    return true;
  }
  if (result.exitCode === 1 && /[\uFFFD]|내부|외부|명령|실행|프로그램|배치/.test(output)) {
    return true;
  }
  return false;
}

function spawnClaudePrintCommand(
  prompt: string,
  cwd: string,
  env: { [key: string]: string | undefined },
  timeoutMs: number | null,
  options: ClaudePrintOptions = {}
): CapturedCommandHandle {
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const args = [
    ...getClaudePrintSessionArgs(options),
    ...(options.sessionName ? ["--name", options.sessionName] : []),
    ...(settings.claudeStrictMcpConfig ? ["--strict-mcp-config"] : []),
    "--permission-mode",
    settings.claudePermissionMode,
    ...(settings.claudeModel ? ["--model", settings.claudeModel] : []),
    ...(settings.claudeEffort ? ["--effort", settings.claudeEffort] : []),
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "-p"
  ];
  return spawnCapturedCommand(
    getClaudeExecutable(settings),
    args,
    cwd,
    env,
    timeoutMs,
    `${prompt}\n`,
    createClaudeStreamObserver(options.onUsage, options.onModel)
  );
}

function createClaudeStreamObserver(
  onUsage?: (usage: TokenUsage) => void,
  onModel?: (modelId: string) => void
): ((chunk: string) => void) | undefined {
  if (!onUsage && !onModel) {
    return undefined;
  }

  let buffer = "";
  let currentMessageId = "";
  let lastEmitted = "";
  let lastReportedModel = "";
  const messageUsages = new Map<string, TokenUsage>();

  const emitUsage = (usage: TokenUsage | null) => {
    const normalized = normalizeTokenUsage(usage);
    if (!normalized) {
      return;
    }
    const signature = JSON.stringify(normalized);
    if (signature === lastEmitted) {
      return;
    }
    lastEmitted = signature;
    onUsage?.(normalized);
  };

  const emitModel = (value: unknown) => {
    const modelId = typeof value === "string" ? value.trim() : "";
    if (!modelId || modelId === lastReportedModel) {
      return;
    }
    lastReportedModel = modelId;
    onModel?.(modelId);
  };

  const updateMessageUsage = (messageId: string, usage: TokenUsage | null) => {
    if (!messageId || !usage) {
      return;
    }
    messageUsages.set(messageId, mergeTokenUsage(messageUsages.get(messageId), usage));
    emitUsage(sumTokenUsages(messageUsages.values()));
  };

  const handleRecord = (record: Record<string, unknown>) => {
    if (record.type === "result") {
      emitUsage(tokenUsageFromClaudeUsage(record.usage));
      if (!lastReportedModel) {
        const modelUsage = asRecord(record.modelUsage) ?? asRecord(record.model_usage);
        const modelIds = modelUsage ? Object.keys(modelUsage).filter(Boolean) : [];
        if (modelIds.length === 1) {
          emitModel(modelIds[0]);
        }
      }
      return;
    }

    if (record.type === "assistant") {
      const message = asRecord(record.message);
      emitModel(message?.model);
      const messageId = typeof message?.id === "string" ? message.id : "";
      updateMessageUsage(messageId, tokenUsageFromClaudeUsage(message?.usage));
      return;
    }

    if (record.type !== "stream_event") {
      return;
    }
    const event = asRecord(record.event);
    if (event?.type === "message_start") {
      const message = asRecord(event.message);
      emitModel(message?.model);
      currentMessageId = typeof message?.id === "string" ? message.id : currentMessageId;
      updateMessageUsage(currentMessageId, tokenUsageFromClaudeUsage(message?.usage));
    } else if (event?.type === "message_delta") {
      updateMessageUsage(currentMessageId, tokenUsageFromClaudeUsage(event.usage));
    }
  };

  return (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (
        line.includes("\"usage\"") ||
        line.includes("\"model\"") ||
        line.includes("\"modelUsage\"") ||
        line.includes("\"model_usage\"")
      ) {
        const record = parseJsonRecord(line);
        if (record) {
          handleRecord(record);
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  };
}

function getClaudePrintSessionArgs(options: ClaudePrintOptions): string[] {
  if (options.resumeSessionId) {
    return [
      "--resume",
      options.resumeSessionId,
      ...(options.forkSession ? ["--fork-session"] : [])
    ];
  }
  if (options.sessionId) {
    return ["--session-id", options.sessionId];
  }
  return ["--continue"];
}

function spawnGeminiPrintCommand(
  prompt: string,
  cwd: string,
  env: { [key: string]: string | undefined },
  timeoutMs: number | null,
  settings: PowerShellSettings,
  plugin: VaultPowerShellPlugin,
  options: { sessionId?: string | null; resumeNativeSession?: boolean } = {}
): CapturedCommandHandle {
  const executable = getGeminiExecutable(settings);
  if (isAntigravityExecutablePath(executable)) {
    // Antigravity CLI: --print takes the prompt; the built-in print timeout
    // defaults to 5m, so raise it for long-running agent turns. There is no
    // --output-format/--approval-mode/--skip-trust; yolo maps to
    // --dangerously-skip-permissions.
    const model = settings.geminiModel?.trim() ?? "";
    const args = [
      "--print",
      prompt,
      "--print-timeout",
      "12h",
      ...(model && !["auto", "pro", "flash", "flash-lite"].includes(model) ? ["--model", model] : []),
      ...(settings.geminiApprovalMode === "yolo" ? ["--dangerously-skip-permissions"] : []),
      ...(settings.geminiSandbox ? ["--sandbox"] : []),
      ...getRepeatedGeminiArgs("--add-dir", settings.geminiIncludeDirectories)
    ];
    return spawnPtyCapturedCommand(executable, args, cwd, env, timeoutMs, plugin);
  }
  const args = [
    ...getGeminiNativeSessionArgs(settings, options.sessionId, options.resumeNativeSession === true),
    "--prompt",
    prompt,
    "--output-format",
    settings.geminiOutputFormat,
    ...(settings.geminiModel ? ["--model", settings.geminiModel] : []),
    ...(settings.geminiApprovalMode !== "default" ? ["--approval-mode", settings.geminiApprovalMode] : []),
    ...(settings.geminiSkipTrust ? ["--skip-trust"] : []),
    ...(settings.geminiSandbox ? ["--sandbox"] : []),
    ...getRepeatedGeminiArgs("--include-directories", settings.geminiIncludeDirectories)
  ];
  return spawnPtyCapturedCommand(executable, args, cwd, env, timeoutMs, plugin);
}

function getGeminiNativeSessionArgs(settings: PowerShellSettings, sessionId: string | null | undefined, resumeNativeSession: boolean): string[] {
  if (!settings.geminiUseNativeSession || !sessionId || !isUuidString(sessionId)) {
    return [];
  }
  return resumeNativeSession ? ["--resume", sessionId] : [];
}

function getRepeatedGeminiArgs(flag: string, value: string | undefined): string[] {
  return splitDelimitedSetting(value).flatMap((item) => [flag, item]);
}

function getRepeatedGeminiShellArgs(flag: string, value: string | undefined): string[] {
  return splitDelimitedSetting(value).flatMap((item) => [flag, quoteShellArg(item)]);
}

function formatClaudePrintOutput(result: CapturedCommandResult): string {
  if (result.cancelled) {
    return `Claude 작업이 취소되었습니다${result.cancelReason ? `: ${result.cancelReason}` : ""}.`;
  }
  const output = removeClaudeNoStdinWarning(stripTerminalControlSequences(`${result.stdout}\n${result.stderr}`)).trim();
  if (output) {
    if (isClaudeSessionInUseResult(result)) {
      return "Claude Code sessionId가 사용 중입니다. 다른 Claude Code 프로세스가 같은 세션을 잡고 있을 수 있습니다. 실행 중인 Claude Code 작업을 종료한 뒤 다시 시도하세요.";
    }
    return getClaudeResultTextFromPrintOutput(output) ?? output;
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

function getClaudeResultTextFromPrintOutput(output: string): string | null {
  const parsed = parseClaudePrintJsonOutput(output);
  if (!parsed) {
    return null;
  }
  const result = typeof parsed.result === "string" ? parsed.result.trim() : "";
  if (result) {
    return result;
  }
  const error = typeof parsed.error === "string" ? parsed.error.trim() : "";
  return error || null;
}

function getPrintCommandUsageSummary(provider: AgentProvider, result: CapturedCommandResult): string | null {
  if (provider !== "claude" || result.cancelled) {
    return null;
  }
  const tokenUsage = getPrintCommandTokenUsage(provider, result);
  const output = removeClaudeNoStdinWarning(stripTerminalControlSequences(`${result.stdout}\n${result.stderr}`)).trim();
  const parsed = parseClaudePrintJsonOutput(output);
  if (!parsed) {
    return null;
  }
  const pieces: string[] = [];
  if (tokenUsage) {
    pieces.push(`IN ${formatCompactTokenValue(tokenUsage.input)} · OUT ${formatCompactTokenValue(tokenUsage.output)}`);
  }
  const cost = getNumericField(parsed, "total_cost_usd") ?? getNumericField(parsed, "totalCostUsd");
  if (typeof cost === "number" && Number.isFinite(cost)) {
    pieces.push(`$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`);
  }
  const turns = getNumericField(parsed, "num_turns") ?? getNumericField(parsed, "numTurns");
  if (typeof turns === "number" && Number.isFinite(turns)) {
    pieces.push(`${Math.round(turns)}t`);
  }
  return pieces.length ? pieces.join(" / ") : null;
}

function getPrintCommandTokenUsage(provider: AgentProvider, result: CapturedCommandResult): TokenUsage | null {
  if (provider !== "claude") {
    return null;
  }
  const output = removeClaudeNoStdinWarning(stripTerminalControlSequences(`${result.stdout}\n${result.stderr}`)).trim();
  const parsed = parseClaudePrintJsonOutput(output);
  return tokenUsageFromClaudeUsage(parsed?.usage);
}

function tokenUsageFromClaudeUsage(value: unknown): TokenUsage | null {
  const usage = asRecord(value);
  if (!usage) {
    return null;
  }
  const directInput = getNumericField(usage, "input_tokens") ?? getNumericField(usage, "inputTokens");
  const output = getNumericField(usage, "output_tokens") ?? getNumericField(usage, "outputTokens");
  const cacheCreation = getNumericField(usage, "cache_creation_input_tokens") ?? 0;
  const cacheRead = getNumericField(usage, "cache_read_input_tokens") ?? 0;
  const hasInput = directInput !== null ||
    Object.prototype.hasOwnProperty.call(usage, "cache_creation_input_tokens") ||
    Object.prototype.hasOwnProperty.call(usage, "cache_read_input_tokens");
  const input = hasInput ? Math.max(0, directInput ?? 0) + Math.max(0, cacheCreation) + Math.max(0, cacheRead) : undefined;
  const normalizedOutput = output !== null ? Math.max(0, output) : undefined;
  const tokenUsage: TokenUsage = {
    ...(input !== undefined ? { input } : {}),
    ...(normalizedOutput !== undefined ? { output: normalizedOutput } : {}),
    ...(cacheCreation + cacheRead > 0 ? { cachedInput: cacheCreation + cacheRead } : {})
  };
  if (input !== undefined || normalizedOutput !== undefined) {
    tokenUsage.total = (input ?? 0) + (normalizedOutput ?? 0);
  }
  return normalizeTokenUsage(tokenUsage);
}

function mergeTokenUsage(current: TokenUsage | undefined, next: TokenUsage): TokenUsage {
  const merged: TokenUsage = {
    input: next.input ?? current?.input,
    output: next.output ?? current?.output,
    cachedInput: next.cachedInput ?? current?.cachedInput,
    reasoningOutput: next.reasoningOutput ?? current?.reasoningOutput
  };
  if (merged.input !== undefined || merged.output !== undefined) {
    merged.total = (merged.input ?? 0) + (merged.output ?? 0);
  } else {
    merged.total = next.total ?? current?.total;
  }
  return merged;
}

function sumTokenUsages(values: Iterable<TokenUsage>): TokenUsage | null {
  let found = false;
  let hasInput = false;
  let hasOutput = false;
  let hasCachedInput = false;
  let hasReasoningOutput = false;
  const total: Required<TokenUsage> = {
    input: 0,
    output: 0,
    total: 0,
    cachedInput: 0,
    reasoningOutput: 0
  };
  for (const usage of values) {
    found = true;
    if (usage.input !== undefined) {
      hasInput = true;
      total.input += usage.input;
    }
    if (usage.output !== undefined) {
      hasOutput = true;
      total.output += usage.output;
    }
    if (usage.cachedInput !== undefined) {
      hasCachedInput = true;
      total.cachedInput += usage.cachedInput;
    }
    if (usage.reasoningOutput !== undefined) {
      hasReasoningOutput = true;
      total.reasoningOutput += usage.reasoningOutput;
    }
  }
  if (!found) {
    return null;
  }
  const result: TokenUsage = {
    ...(hasInput ? { input: total.input } : {}),
    ...(hasOutput ? { output: total.output } : {}),
    ...(hasCachedInput ? { cachedInput: total.cachedInput } : {}),
    ...(hasReasoningOutput ? { reasoningOutput: total.reasoningOutput } : {})
  };
  if (hasInput || hasOutput) {
    result.total = total.input + total.output;
  }
  return normalizeTokenUsage(result);
}

function normalizeTokenUsage(value: unknown): TokenUsage | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const normalized: TokenUsage = {};
  const fields: Array<[keyof TokenUsage, string]> = [
    ["input", "input"],
    ["output", "output"],
    ["total", "total"],
    ["cachedInput", "cachedInput"],
    ["reasoningOutput", "reasoningOutput"]
  ];
  for (const [target, source] of fields) {
    const amount = getNumericField(record, source);
    if (amount !== null && amount >= 0) {
      normalized[target] = amount;
    }
  }
  if (normalized.total === undefined && (normalized.input !== undefined || normalized.output !== undefined)) {
    normalized.total = (normalized.input ?? 0) + (normalized.output ?? 0);
  }
  return Object.keys(normalized).length ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getNumericField(value: Record<string, unknown> | null, key: string): number | null {
  const raw = value?.[key];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatCompactTokenValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return "—";
  }
  const rounded = Math.max(0, Math.round(value));
  if (rounded >= 1_000_000_000) {
    return `${(rounded / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}b`;
  }
  if (rounded >= 1_000_000) {
    return `${(rounded / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (rounded >= 1_000) {
    return `${(rounded / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(rounded);
}

function formatTokenUsageTitle(usage: TokenUsage | null, live: boolean): string {
  if (!usage) {
    return live ? "Waiting for exact provider-reported token usage" : "No exact token usage for this turn";
  }
  const pieces = [
    usage.input !== undefined ? `Input ${formatTokenInteger(usage.input)}` : "",
    usage.output !== undefined ? `Output ${formatTokenInteger(usage.output)}` : "",
    usage.cachedInput !== undefined ? `Cache-related input ${formatTokenInteger(usage.cachedInput)}` : "",
    usage.reasoningOutput !== undefined ? `Reasoning output ${formatTokenInteger(usage.reasoningOutput)}` : ""
  ].filter(Boolean);
  if (pieces.length === 0 && usage.total !== undefined) {
    pieces.push(`Total ${formatTokenInteger(usage.total)}`);
  }
  return `${live ? "Live provider usage" : "Provider-reported usage"} | ${pieces.join(" | ")}`;
}

function formatTokenInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function getClaudeSessionIdFromPrintResult(result: CapturedCommandResult): string | null {
  const output = removeClaudeNoStdinWarning(stripTerminalControlSequences(`${result.stdout}\n${result.stderr}`)).trim();
  const parsed = parseClaudePrintJsonOutput(output);
  const sessionId = parsed && typeof parsed.session_id === "string" ? parsed.session_id.trim() : "";
  return isUuidString(sessionId) ? sessionId : null;
}

function parseClaudePrintJsonOutput(output: string): Record<string, unknown> | null {
  const parsed = parseJsonObject(output);
  const singleRecord = asRecord(parsed);
  if (singleRecord) {
    return singleRecord;
  }
  const lines = output.split(/\r?\n/);
  let lastRecord: Record<string, unknown> | null = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const record = parseJsonRecord(lines[index].trim());
    if (!record) {
      continue;
    }
    lastRecord ??= record;
    if (record.type === "result") {
      return record;
    }
  }
  return lastRecord;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function isUuidString(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function formatGeminiPrintOutput(result: CapturedCommandResult, settings: PowerShellSettings): string {
  const antigravity = isAntigravityCli(settings);
  const cliLabel = antigravity ? "Antigravity" : "Gemini";
  if (result.cancelled) {
    return `${cliLabel} task was cancelled${result.cancelReason ? `: ${result.cancelReason}` : ""}.`;
  }
  const output = removeGeminiCliNoise(stripTerminalControlSequences(`${result.stdout}\n${result.stderr}`)).trim();
  if (output) {
    return formatGeminiAuthErrorOutput(output, settings) ?? getGeminiResultTextFromPrintOutput(output) ?? output;
  }

  if (result.timedOut) {
    return `${cliLabel} response timed out.`;
  }

  if (result.error) {
    return `${cliLabel} failed to run: ${result.error}`;
  }

  if (result.exitCode !== 0 && result.exitCode !== null) {
    return `${cliLabel} exited without a response (code ${result.exitCode}).`;
  }

  return antigravity
    ? "Antigravity가 빈 응답을 반환했습니다. 일반 PowerShell에서 `agy`를 실행해 로그인 상태를 확인한 뒤 Agent Console에서 다시 시도하세요."
    : "Gemini returned an empty response. Run `gemini -p \"hello\"` in PowerShell to confirm the CLI can answer, then use Agent Console Login again if needed.";
}

function getGeminiResultTextFromPrintOutput(output: string): string | null {
  const parsedObject = parseJsonObject(output);
  if (parsedObject) {
    const text = extractGeminiJsonText(parsedObject);
    if (text) {
      return text;
    }
  }

  const pieces: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const parsedLine = parseJsonObject(line);
    if (!parsedLine) {
      continue;
    }
    const text = extractGeminiJsonText(parsedLine);
    if (text) {
      pieces.push(text);
    }
  }
  const joined = pieces.join("").trim();
  return joined || null;
}

function extractGeminiJsonText(value: unknown): string {
  const pieces: string[] = [];
  collectGeminiJsonText(value, pieces);
  return pieces.join("").trim();
}

function collectGeminiJsonText(value: unknown, pieces: string[], keyHint = ""): void {
  if (typeof value === "string") {
    if (/^(?:text|delta|content|response|result|answer|output)$/i.test(keyHint)) {
      pieces.push(value);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectGeminiJsonText(item, pieces, keyHint);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:error|stack|debug|usage|metadata|role|type|id)$/i.test(key)) {
      continue;
    }
    collectGeminiJsonText(child, pieces, key);
  }
}

function formatGeminiAuthErrorOutput(output: string, settings: PowerShellSettings): string | null {
  const antigravity = isAntigravityCli(settings);
  const cliLabel = antigravity ? "Antigravity CLI" : "Gemini CLI";
  const loginHint = antigravity
    ? "일반 PowerShell에서 `agy`를 실행해 Google OAuth 로그인을 완료하세요"
    : "run `gemini -p \"hello\"` in PowerShell and complete authentication";

  if (/Please sign in|not logged into Antigravity|not authenticated|OAuth.*timed out|auth(?:entication)? timed out|Authentication required|paste the authorization code/i.test(output)) {
    return `${cliLabel} 로그인이 필요합니다. Agent Console의 Login을 누르거나 ${loginHint}.`;
  }

  if (/ModelNotFoundError|Requested entity was not found/i.test(output)) {
    return antigravity
      ? "Antigravity 모델을 찾을 수 없습니다. Agent Console의 모델 드롭다운에서 Antigravity default 또는 현재 계정에서 접근 가능한 모델로 바꾼 뒤 다시 시도하세요."
      : "Gemini model was not found. Choose Gemini default, auto, pro, flash, flash-lite, or another model available to this account and try again.";
  }

  if (/RetryableQuotaError|No capacity available for model/i.test(output)) {
    return antigravity
      ? "Antigravity 모델 서버 capacity가 현재 없습니다. Agent Console의 모델 드롭다운에서 Antigravity default 또는 다른 모델로 바꾼 뒤 다시 시도하세요."
      : "Gemini model capacity is currently unavailable. Choose Gemini default or another accessible model and try again.";
  }

  if (/Please set an Auth method/i.test(output)) {
    const home = getUserHome();
    const settingsPath = home ? join(home, ".gemini", "settings.json") : "~/.gemini/settings.json";
    return `${cliLabel} 인증이 설정되어 있지 않습니다. Agent Console에서 Login을 누르거나 ${loginHint}. 이전 Gemini CLI 설정 파일 위치: ${settingsPath}`;
  }

  if (/When using Gemini API[\s\S]*GEMINI_API_KEY/i.test(output)) {
    return `${cliLabel}가 인증되지 않았습니다. Agent Console의 Login을 누르거나 ${loginHint}. 완료 후 Obsidian을 재시작하세요.`;
  }

  if (/When using Vertex AI/i.test(output)) {
    return `${cliLabel} is not authenticated for Vertex AI. Set the required Google Cloud environment variables, then restart Obsidian.`;
  }

  if (/Invalid auth method selected/i.test(output) || /enforced authentication type|auth type .* is enforced/i.test(output)) {
    return `${cliLabel} 인증 설정이 현재 실행 방식과 맞지 않습니다. Agent Console에서 Login을 누르거나 ${loginHint}.\n\n${output}`;
  }

  return null;
}

function isClaudeSessionInUseResult(result: CapturedCommandResult): boolean {
  const output = stripTerminalControlSequences(`${result.stdout}\n${result.stderr}`);
  return /Session ID\s+[0-9a-f-]+\s+is already in use/i.test(output);
}

function isGeminiModelUnavailableResult(result: CapturedCommandResult): boolean {
  const output = stripTerminalControlSequences(`${result.stdout}\n${result.stderr}\n${result.error ?? ""}`);
  return /ModelNotFoundError|Requested entity was not found|RetryableQuotaError|No capacity available for model/i.test(output);
}

function isGeminiNativeSessionResumeMissingResult(result: CapturedCommandResult): boolean {
  const output = stripTerminalControlSequences(`${result.stdout}\n${result.stderr}\n${result.error ?? ""}`);
  return /No previous sessions found|session(?:\s+id)?\s+.*(?:not found|does not exist|missing)|could not find.*session|failed to resume/i.test(output);
}

function isSuccessfulPrintCommandResult(result: CapturedCommandResult): boolean {
  return !result.cancelled && !result.timedOut && !result.error && result.exitCode === 0;
}

function getGeminiModelFallbackCandidates(configuredModel: string | undefined, settings: PowerShellSettings): string[] {
  const normalized = normalizeGeminiModelInput(configuredModel) || DEFAULT_SETTINGS.geminiModel;
  const candidates = isAntigravityCli(settings)
    ? ["", "Gemini 3.5 Flash (Medium)", "Gemini 3.1 Pro (High)"]
    : ["", "auto", "pro", "flash", "flash-lite", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
  return candidates.filter((candidate) => candidate !== normalized);
}

function removeClaudeNoStdinWarning(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^Warning: no stdin data received in \d+s, proceeding without it\./i.test(line.trim()))
    .join("\n");
}

function removeGeminiCliNoise(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !isGeminiCliNoiseLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function isGeminiCliNoiseLine(line: string): boolean {
  const value = line.trim();
  return /^Warning:\s+Windows 10 detected\b/i.test(value) ||
    /^Warning:\s+256-color support not detected\b/i.test(value) ||
    /^YOLO mode is enabled\. All tool calls will be automatically approved\./i.test(value) ||
    /^Ripgrep is not available\. Falling back to GrepTool\./i.test(value) ||
    /^GrepLogic:\s+Error in performGrepSearch\b/i.test(value) ||
    /^Error during GrepLogic execution:\s+Error:\s+Operation timed out\b/i.test(value) ||
    /^Error executing tool grep_search:\s+Error:\s+Operation timed out\b/i.test(value);
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
  return spawnCapturedCommand(command, args, cwd, env, timeoutMs, stdinText).promise;
}

function spawnPtyCapturedCommand(
  command: string,
  args: string[],
  cwd: string,
  env: { [key: string]: string | undefined },
  timeoutMs: number | null,
  plugin: VaultPowerShellPlugin
): CapturedCommandHandle {
  let child: ChildProcessWithoutNullStreams | null = null;
  let childPid: number | undefined;
  let killHandle: (reason?: string) => void = () => {
    // Replaced once the host exists.
  };

  const promise = new Promise<CapturedCommandResult>((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let jsonBuffer = "";
    let settled = false;
    let sawHostExit = false;
    let hostExitCode: number | null = null;
    let timeout: number | null = null;
    let exitDrainTimeout: number | null = null;

    const finish = (result: Partial<CapturedCommandResult>) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
      if (exitDrainTimeout !== null) {
        window.clearTimeout(exitDrainTimeout);
      }
      resolvePromise({
        stdout,
        stderr,
        exitCode: result.exitCode ?? null,
        timedOut: result.timedOut ?? false,
        error: result.error,
        cancelled: result.cancelled ?? false,
        cancelReason: result.cancelReason
      });
    };

    const handleHostLine = (line: string) => {
      if (!line) {
        return;
      }

      try {
        const message = JSON.parse(line) as HostOutputMessage;
        if (message.type === "data") {
          stdout += message.data;
        } else if (message.type === "exit") {
          sawHostExit = true;
          hostExitCode = message.exitCode ?? null;
          if (exitDrainTimeout !== null) {
            window.clearTimeout(exitDrainTimeout);
          }
          exitDrainTimeout = window.setTimeout(() => {
            finish({ exitCode: hostExitCode });
          }, 300);
        } else if (message.type === "error") {
          stderr += `${message.message}\n`;
          finish({ error: message.message });
        }
      } catch {
        stdout += `${line}\n`;
      }
    };

    const flushJsonBuffer = () => {
      const line = jsonBuffer.trim();
      if (!line) {
        return;
      }

      jsonBuffer = "";
      handleHostLine(line);
    };

    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      timeout = window.setTimeout(() => {
        killCapturedCommandProcess(child);
        finish({ timedOut: true });
      }, timeoutMs);
    }

    try {
      child = spawn(plugin.getNodeExecutable(), [plugin.getPtyHostPath(), encodeConfig({
        shell: command,
        args,
        fallbackShells: [],
        cols: AGENT_CONSOLE_COLS,
        rows: AGENT_CONSOLE_ROWS,
        cwd,
        env,
        windowsPtyBackend: plugin.settings.windowsPtyBackend
      })], {
        cwd: plugin.getPluginBasePath(),
        env,
        windowsHide: true
      });
    } catch (error) {
      finish({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const spawned = child;
    if (!spawned) {
      finish({ error: "Failed to spawn PTY command." });
      return;
    }
    childPid = spawned.pid;

    killHandle = (reason = "cancelled") => {
      try {
        if (spawned.stdin.writable) {
          spawned.stdin.write(`${JSON.stringify({ type: "kill" })}\n`);
        }
      } catch {
        // best-effort graceful PTY shutdown
      }
      killCapturedCommandProcess(spawned);
      finish({ cancelled: true, cancelReason: reason });
    };

    spawned.stdout.on("data", (chunk: Buffer) => {
      jsonBuffer += chunk.toString();
      while (true) {
        const newlineIndex = jsonBuffer.indexOf("\n");
        if (newlineIndex === -1) {
          return;
        }

        const line = jsonBuffer.slice(0, newlineIndex).trim();
        jsonBuffer = jsonBuffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        handleHostLine(line);
      }
    });

    spawned.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    spawned.on("error", (error: Error) => {
      finish({ error: error.message });
    });

    spawned.on("close", (code: number | null) => {
      flushJsonBuffer();
      finish({ exitCode: sawHostExit ? hostExitCode : code });
    });
  });

  return {
    child,
    pid: childPid,
    promise,
    kill: (reason?: string) => killHandle(reason)
  };
}

function spawnCapturedCommand(
  command: string,
  args: string[],
  cwd: string,
  env: { [key: string]: string | undefined },
  timeoutMs: number | null,
  stdinText?: string,
  onStdout?: (chunk: string) => void
): CapturedCommandHandle {
  let child: ChildProcessWithoutNullStreams | null = null;
  let killHandle: (reason?: string) => void = () => {
    // Replaced once the child exists.
  };

  const promise = new Promise<CapturedCommandResult>((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
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
        error: result.error,
        cancelled: result.cancelled ?? false,
        cancelReason: result.cancelReason
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
    const spawned = child;
    if (!spawned) {
      finish({ error: "Failed to spawn command." });
      return;
    }
    killHandle = (reason = "cancelled") => {
      killCapturedCommandProcess(spawned);
      finish({ cancelled: true, cancelReason: reason });
    };

    try {
      spawned.stdin.end(stdinText ?? "");
    } catch {
      // Captured commands in this plugin are non-interactive.
    }

    spawned.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      try {
        onStdout?.(text);
      } catch {
        // Streaming observers must never interrupt the captured command.
      }
    });
    spawned.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    spawned.on("error", (error: Error) => {
      finish({ error: error.message });
    });
    spawned.on("close", (code: number | null) => {
      finish({ exitCode: code });
    });
  });

  return {
    child,
    pid: (child as ChildProcessWithoutNullStreams | null)?.pid,
    promise,
    kill: (reason?: string) => killHandle(reason)
  };
}

function killCapturedCommandProcess(child: ChildProcessWithoutNullStreams | null) {
  if (!child) {
    return;
  }

  try {
    if (process.platform === "win32" && child.pid !== undefined) {
      killProcessTreeByPid(child.pid);
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

function killProcessTreeByPid(pid: number) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The process may already be gone.
  }
}

function readAgentPrintProcessRegistry(path: string): AgentPrintProcessRecord[] {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isAgentPrintProcessRecord);
  } catch {
    return [];
  }
}

function writeAgentPrintProcessRegistry(path: string, records: AgentPrintProcessRecord[]) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(records, null, 2), "utf8");
  } catch {
    // best-effort registry
  }
}

function updateAgentPrintProcessRegistry(path: string, update: (records: AgentPrintProcessRecord[]) => AgentPrintProcessRecord[]) {
  writeAgentPrintProcessRegistry(path, update(readAgentPrintProcessRegistry(path)));
}

function cleanupAgentPrintProcessRegistry(path: string) {
  const records = readAgentPrintProcessRegistry(path);
  if (records.length === 0) {
    return;
  }

  const keep: AgentPrintProcessRecord[] = [];
  for (const record of records) {
    if (!isAgentPrintProcessAlive(record)) {
      continue;
    }
    try {
      killProcessTreeByPid(record.pid);
    } catch {
      keep.push(record);
    }
  }
  writeAgentPrintProcessRegistry(path, keep);
}

function isAgentPrintProcessRecord(value: unknown): value is AgentPrintProcessRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AgentPrintProcessRecord>;
  return typeof candidate.pid === "number" &&
    (candidate.provider === "claude" || candidate.provider === "gemini") &&
    (candidate.sessionId === null || typeof candidate.sessionId === "string") &&
    typeof candidate.cwd === "string" &&
    typeof candidate.startedAt === "number" &&
    typeof candidate.pluginVersion === "string";
}

function isAgentPrintProcessAlive(record: AgentPrintProcessRecord): boolean {
  const commandLine = getProcessCommandLine(record.pid);
  if (!commandLine) {
    return false;
  }
  const lower = commandLine.toLowerCase();
  return matchesAgentPrintCommandLine(record, lower);
}

function matchesAgentPrintCommandLine(record: AgentPrintProcessRecord, lowerCommandLine: string): boolean {
  if (record.provider === "claude") {
    return lowerCommandLine.includes("claude") &&
      !!record.sessionId &&
      (
        lowerCommandLine.includes("--session-id") ||
        lowerCommandLine.includes("--resume")
      ) &&
      lowerCommandLine.includes(record.sessionId.toLowerCase()) &&
      lowerCommandLine.includes("--output-format");
  }

  return lowerCommandLine.includes("gemini") &&
    lowerCommandLine.includes("--output-format");
}

function getProcessCommandLine(pid: number): string | null {
  try {
    if (process.platform === "win32") {
      const result = spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($p) { $p.CommandLine }`
      ], { encoding: "utf8", windowsHide: true });
      return result.stdout?.trim() || null;
    }
    const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
    return result.stdout?.trim() || null;
  } catch {
    return null;
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

function findLatestAgentSessionIdExcluding(provider: AgentProvider, cwd: string, excludedSessionIds: string[]): string | null {
  const root = getAgentSessionRoot(provider);
  if (!root || !existsSync(root)) {
    return null;
  }

  const excluded = new Set(excludedSessionIds.map((id) => id.toLowerCase()));
  const sinceMs = provider === "claude" ? 0 : Date.now() - AGENT_SESSION_LOOKBACK_MS;
  for (const file of getRecentJsonlFiles(root, sinceMs)) {
    const sessionId = getAgentSessionIdFromFilePath(file);
    if (!sessionId || excluded.has(sessionId.toLowerCase())) {
      continue;
    }
    if (agentSessionFileMatches(file, cwd)) {
      return sessionId;
    }
  }

  return null;
}

function getAgentSessionIdFromFilePath(filePath: string): string | null {
  const fileName = filePath.split(/[\\/]/).pop() ?? "";
  const match = fileName.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1] ?? null;
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

  if (provider === "claude") {
    return join(home, ".claude", "projects");
  }
  if (provider === "codex") {
    return join(home, ".codex", "sessions");
  }
  return null;
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
  if (provider === "gemini") {
    return [];
  }

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

  if (/select|choose|method|how would you like to authenticate|authenticate for this project|use .*arrow|arrow keys|↑|↓|❯|navigate/i.test(text)) {
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
    const loginCommand = isGeminiAuthPromptText(text) ? "/auth" : "/login";
    actions.push({ label: loginCommand, data: `${loginCommand}\r`, description: "Start the agent login flow." });
  }

  if (!mcpPrompt && mode !== "menu" && isGeminiAuthPromptText(text)) {
    actions.push(...extractNumberedPromptOptions(text));
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
    /^>\s*\/auth\b/i.test(value) ||
    /^\/auth\b/i.test(value) ||
    /^login$/i.test(value) ||
    /^auth$/i.test(value) ||
    /^select login method\b/i.test(value) ||
    isGeminiAuthPromptText(value) ||
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
    isGeminiAuthPromptText(value) ||
    /^use the url below\b/i.test(value);
}

function isAgentCliCommandFailureLine(line: string): boolean {
  if (isAgentHookWarningLine(line)) {
    return false;
  }

  return /(?:claude|codex|gemini).*?(?:command not found|not recognized|not found|ENOENT|spawn)/i.test(line);
}

function isAgentHookWarningLine(line: string): boolean {
  return /hook error|non-blocking status code|memrosetta-enforce-claude-code/i.test(line);
}

function removeAgentLaunchEchoText(text: string, launchCommand: string): string {
  const launch = launchCommand.trim();
  if (!launch) {
    return text.trim();
  }

  const compactLaunch = launch.replace(/\s+/g, "");
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const value = line.trim();
      if (!value) {
        return false;
      }

      const compactValue = value.replace(/\s+/g, "");
      return !(launch.startsWith(value) ||
        value.startsWith(launch.slice(0, 24)) ||
        value.includes(launch) ||
        compactValue.includes(compactLaunch));
    })
    .join("\n")
    .trim();
}

function hasAgentAuthSuccess(text: string): boolean {
  return /logged in|login successful|already logged in|signed in|sign[- ]?in successful|authenticated successfully|successfully authenticated|authentication successful/i.test(text);
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
  return /please run\s+\/login\b|api error:\s*401\b.*invalid authentication credentials|401 invalid authentication credentials|please set an auth method|auth method .*not configured|not authenticated|sign in required/i.test(text);
}

function isAgentLoginFlowText(text: string): boolean {
  const urls = extractHttpUrls(text);
  return urls.some((url) => isAgentLoginUrl(url)) ||
    /^>\s*\/login\b/im.test(text) ||
    /^\/login\b/im.test(text) ||
    /^>\s*\/auth\b/im.test(text) ||
    /^\/auth\b/im.test(text) ||
    /^login$/im.test(text) ||
    /^auth$/im.test(text) ||
    isGeminiAuthPromptText(text) ||
    /select login method|please run\s+\/login\b/i.test(text) ||
    /browser didn't open.*sign in|use the url below to sign in/i.test(text) ||
    (isAgentLoginCodePromptText(text) && /login|sign in/i.test(text));
}

function isAgentLoginPromptText(text: string, urls = extractHttpUrls(text)): boolean {
  return urls.some((url) => isAgentLoginUrl(url)) ||
    /^>\s*\/login\b/im.test(text) ||
    /^\/login\b/im.test(text) ||
    /^>\s*\/auth\b/im.test(text) ||
    /^\/auth\b/im.test(text) ||
    /^login$/im.test(text) ||
    /^auth$/im.test(text) ||
    isGeminiAuthPromptText(text) ||
    /select login method|please run\s+\/login\b/i.test(text) ||
    /api error:\s*401\b.*invalid authentication credentials|401 invalid authentication credentials/i.test(text) ||
    /browser didn't open.*sign in|use the url below to sign in/i.test(text);
}

function isAgentLoginCodePromptText(text: string): boolean {
  return /paste code here|paste code|authorization code|verification code/i.test(text) &&
    /login|sign in|browser|claude\.com|claude\.ai|anthropic\.com|google|gemini|oauth|authorize/i.test(text);
}

function isGeminiAuthPromptText(text: string): boolean {
  return /gemini cli.*auth|how would you like to authenticate|select.*auth(?:entication)? method|sign in with google|google login|google account|google auth|oauth-personal|login with google|use.*google account|no_browser=true|manual authentication/i.test(text);
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
  const value = text.trim().replace(/\s+/g, "");
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

  if (isGoogleAuthHost(host) && isGoogleAuthPath(path)) {
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

function isGoogleAuthHost(host: string): boolean {
  return host === "accounts.google.com" ||
    host === "oauth2.googleapis.com" ||
    host.endsWith(".accounts.google.com");
}

function isGoogleAuthPath(path: string): boolean {
  return isAuthPath(path) || /(?:^|\/)(?:signin|servicelogin|o\/oauth2|device)(?:\/|$)/i.test(path);
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

function normalizeClaudePermissionMode(value: string | undefined): ClaudePermissionMode {
  return value === "acceptEdits" ||
    value === "auto" ||
    value === "default" ||
    value === "dontAsk" ||
    value === "plan" ||
    value === "bypassPermissions"
    ? value
    : "default";
}

function normalizeClaudeEffort(value: string | undefined): ClaudeEffort {
  return value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
    ? value
    : "";
}

function normalizeGeminiApprovalMode(value: string | undefined): GeminiApprovalMode {
  return value === "default" || value === "auto_edit" || value === "plan" || value === "yolo"
    ? value
    : "default";
}

function normalizeGeminiOutputFormat(value: string | undefined): GeminiOutputFormat {
  return value === "text" || value === "json" || value === "stream-json"
    ? value
    : "stream-json";
}

function normalizeDelimitedSetting(value: string | undefined): string {
  return splitDelimitedSetting(value).join(", ");
}

function splitDelimitedSetting(value: string | undefined): string[] {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return [];
  }
  return raw
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isKnownClaudeModelChoice(value: string | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return CLAUDE_MODEL_CHOICES.some((choice) => choice.value === normalized);
}

function getClaudeModelChoiceLabel(
  choice: { value: string; label: string },
  requestedModel: string,
  resolvedModel: string | null
): string {
  if (!resolvedModel || choice.value !== requestedModel) {
    return choice.label;
  }
  const resolvedLabel = formatClaudeModelDisplayName(resolvedModel);
  if (!choice.value) {
    return `Claude default (${resolvedLabel})`;
  }
  if (choice.value === "best") {
    return `Best auto (${resolvedLabel})`;
  }
  return `${resolvedLabel} (latest: ${choice.value})`;
}

function formatClaudeModelDisplayName(modelId: string): string {
  const normalized = modelId.trim();
  const match = normalized.toLowerCase().match(/claude-(fable|opus|sonnet|haiku)-(\d+)(?:-(\d+))?/);
  if (match) {
    const family = `${match[1].charAt(0).toUpperCase()}${match[1].slice(1)}`;
    const minor = match[3] && match[3].length <= 2 ? `.${Number(match[3])}` : "";
    return `${family} ${Number(match[2])}${minor}`;
  }
  const alias = CLAUDE_LATEST_MODEL_CHOICES.find((choice) => choice.value === normalized.toLowerCase());
  if (alias) {
    return alias.label.replace(/\s+\(.+$/, "");
  }
  return normalized || "Claude";
}

function setSelectChoices(
  select: HTMLSelectElement | null,
  choices: { value: string; label: string }[],
  value: string | undefined,
  preservedLabel: string
) {
  if (!select) {
    return;
  }
  const selected = value?.trim() ?? "";
  select.empty();
  for (const choice of choices) {
    select.createEl("option", { value: choice.value, text: choice.label });
  }
  if (selected && !selectHasOption(select, selected)) {
    select.createEl("option", { value: selected, text: `${preservedLabel}: ${selected}` });
  }
  select.value = selected && selectHasOption(select, selected) ? selected : choices[0]?.value ?? "";
}

function selectHasOption(select: HTMLSelectElement, value: string): boolean {
  return Array.from(select.options).some((option) => option.value === value);
}

function normalizeGeminiModelInput(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }

  const compact = trimmed
    .replace(/\s+/g, "-")
    .replace(/^gemini[-_\s]+/i, "gemini-")
    .toLowerCase();
  const aliases: Record<string, string> = {
    auto: "auto",
    pro: "pro",
    flash: "flash",
    "flash-lite": "flash-lite",
    "2.5-pro": "gemini-2.5-pro",
    "2.5-flash": "gemini-2.5-flash",
    "2.5-flash-lite": "gemini-2.5-flash-lite",
    "3-pro": "gemini-3-pro",
    "3-flash": "gemini-3-flash",
    "3-flash-preview": "gemini-3-flash-preview",
    "3.1-pro": "gemini-3.1-pro-preview",
    "3.1-flash-lite": "gemini-3.1-flash-lite",
    "3.5-flash": "gemini-3.5-flash"
  };
  if (aliases[compact]) {
    return aliases[compact];
  }
  if (/^\d(?:\.\d+)?-(?:pro|flash|flash-lite)(?:-.+)?$/.test(compact)) {
    return `gemini-${compact}`;
  }
  return trimmed;
}

function migrateGeminiModelAliasToStable(value: string | undefined): string {
  const normalized = normalizeGeminiModelInput(value);
  if (normalized === "flash") {
    return "gemini-2.5-flash";
  }
  if (normalized === "pro") {
    return "gemini-2.5-pro";
  }
  if (normalized === "flash-lite") {
    return "gemini-2.5-flash-lite";
  }
  return normalized;
}

function formatGeminiStatusModelLabel(value: string | undefined): string {
  const configured = normalizeGeminiModelInput(value) || DEFAULT_SETTINGS.geminiModel;
  if (!configured) {
    return "Antigravity default";
  }
  if (configured === "flash" || configured === "pro" || configured === "flash-lite") {
    return `${configured} alias`;
  }
  if (configured === "auto") {
    return "auto router";
  }
  const resolved = getGeminiModelResolutionLabel(configured);
  return resolved === configured ? configured : `${configured} -> ${resolved}`;
}

function getGeminiModelResolutionLabel(value: string | undefined): string {
  const configured = normalizeGeminiModelInput(value) || DEFAULT_SETTINGS.geminiModel;
  switch (configured) {
    case "":
      return "Antigravity default";
    case "flash":
      return "legacy Gemini flash alias";
    case "flash-lite":
      return "legacy Gemini flash-lite alias";
    case "pro":
      return "legacy Gemini pro alias";
    case "auto":
      return "Antigravity default";
    default:
      return configured;
  }
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

function getTranscriptSelectionText(root: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return "";
  }

  const parts: string[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (!rangeIntersectsElement(range, root)) {
      continue;
    }
    const fragment = range.cloneContents();
    const wrapper = document.createElement("div");
    wrapper.appendChild(fragment);
    wrapper
      .querySelectorAll(".vault-agent-message-role, .vault-agent-block-label, .vault-agent-thinking, button, .copy-code-button, .svg-icon")
      .forEach((el) => el.remove());
    const text = (wrapper.innerText || wrapper.textContent || "").trim();
    if (text) {
      parts.push(text);
    }
  }

  return parts.join("\n").trim();
}

function rangeIntersectsElement(range: Range, element: HTMLElement): boolean {
  try {
    return range.intersectsNode(element);
  } catch {
    const selection = window.getSelection()?.toString().trim() ?? "";
    return !!selection && element.contains(document.activeElement);
  }
}
