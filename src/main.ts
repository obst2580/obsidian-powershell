import {
  addIcon,
  App,
  FileSystemAdapter,
  ItemView,
  Menu,
  Notice,
  normalizePath,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  TFolder,
  WorkspaceLeaf
} from "obsidian";
import { clipboard } from "electron";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { unzipSync } from "fflate";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { createHash } from "crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

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
const AGENT_READY_DELAY_MS = 2500;
const AGENT_SESSION_POLL_MS = 1200;
const AGENT_SESSION_LOOKBACK_MS = 30000;
const AGENT_SESSION_MATCH_BYTES = 262144;
const AGENT_SESSION_MAX_READ_BYTES = 1024 * 1024;

interface PowerShellSettings {
  settingsSchemaVersion: number;
  executable: string;
  args: string;
  nodeExecutable: string;
  terminalColorScheme: TerminalColorScheme;
  shiftEnterMode: ShiftEnterMode;
  codexDisableResizeReflow: boolean;
  codexNoAltScreen: boolean;
  windowsPtyBackend: WindowsPtyBackend;
  autoInstallRuntime: boolean;
  useSystemCa: boolean;
  extraCaCertPath: string;
  attachmentFolder: string;
}

type TerminalColorScheme = "dark" | "light" | "obsidian";
type ShiftEnterMode = "bracketed-paste" | "claude-backslash" | "xterm-paste" | "modified-enter" | "csi-u" | "line-feed";
type WindowsPtyBackend = "winpty" | "conpty";
type ViewPane = "agent" | "terminal";
type AgentProvider = "claude" | "codex";
type AgentTranscriptRole = "user" | "assistant" | "tool" | "system";
type AgentPromptMode = "auth" | "menu" | "confirmation" | "permission" | "command" | "text";

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
  };

interface AgentPromptState {
  text: string;
  requiresAuth: boolean;
  mode: AgentPromptMode;
  allowEmptySubmit: boolean;
  urls: string[];
  actions: AgentPromptAction[];
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
  executable: "",
  args: "",
  nodeExecutable: "",
  terminalColorScheme: "obsidian",
  shiftEnterMode: "claude-backslash",
  codexDisableResizeReflow: true,
  codexNoAltScreen: true,
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

    this.addRibbonIcon(OBST_TERMINAL_ICON, "Open terminal", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-vault-powershell-view",
      name: "Open terminal",
      callback: () => {
        void this.activateView();
      }
    });
    this.addCommand({
      id: "insert-current-note-reference",
      name: "Insert current note reference",
      callback: () => {
        void this.insertCurrentNoteReference();
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
    this.settings.terminalColorScheme = normalizeTerminalColorScheme(this.settings.terminalColorScheme);
    this.settings.shiftEnterMode = normalizeShiftEnterMode(this.settings.shiftEnterMode);
    this.settings.codexDisableResizeReflow = this.settings.codexDisableResizeReflow !== false;
    this.settings.codexNoAltScreen = needsCodexScrollbackMigration
      ? true
      : this.settings.codexNoAltScreen !== false;
    this.settings.windowsPtyBackend = normalizeWindowsPtyBackend(this.settings.windowsPtyBackend);
    this.settings.autoInstallRuntime = this.settings.autoInstallRuntime === true;
    if (needsCodexScrollbackMigration) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getVaultPath(): string | null {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }

    return null;
  }

  getShellExecutable(): string {
    const configured = this.settings.executable.trim();
    if (!isAutoShellSetting(configured) && !isPlatformIncompatiblePath(configured)) {
      return configured;
    }

    return this.getAutoShellExecutable();
  }

  getShellFallbacks(primaryShell: string): ShellLaunchConfig[] {
    return uniqueStrings(getAutoShellCandidates())
      .filter((shell) => shell !== primaryShell)
      .map((shell) => ({
        shell,
        args: this.getShellArgs(shell)
      }));
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
    const configured = this.settings.args.trim();
    if (!isAutoShellArgsSetting(configured)) {
      return tokenizeArgs(configured);
    }

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
    const text = paths.map((path) => formatVaultFileReference(path)).join(" ");
    if (!text) {
      return;
    }

    const view = await this.getOrCreateTerminalView();
    view.insertTerminalText(`${text} `);
  }

  private async insertCurrentNoteReference() {
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
      active: true
    });
    await this.app.workspace.revealLeaf(leaf);
  }
}

class VaultPowerShellView extends ItemView {
  private plugin: VaultPowerShellPlugin;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
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
  private agentProvider: AgentProvider = "claude";
  private agentHost: ChildProcessWithoutNullStreams | null = null;
  private agentHostReady = false;
  private agentReadyForInput = false;
  private agentStdoutBuffer = "";
  private agentStatusEl: HTMLElement | null = null;
  private agentTranscriptEl: HTMLElement | null = null;
  private agentPromptActionsEl: HTMLElement | null = null;
  private agentInputEl: HTMLTextAreaElement | null = null;
  private agentProviderButtons: Record<AgentProvider, HTMLElement | null> = { claude: null, codex: null };
  private agentSessionPollTimer: number | null = null;
  private agentReadyTimer: number | null = null;
  private agentStartedAt = 0;
  private agentSessionPath: string | null = null;
  private agentSessionOffset = 0;
  private agentSeenEntries = new Set<string>();
  private agentLocalMessageCounter = 0;
  private agentLastRawNotice = "";
  private agentNeedsAuth = false;
  private agentPromptState: AgentPromptState | null = null;

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

  onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("vault-powershell-view");

    const tabBar = container.createDiv("vault-terminal-tabbar");
    this.paneTabEls.agent = this.createPaneTab(tabBar, "Agent console", "agent");
    this.paneTabEls.terminal = this.createPaneTab(tabBar, "Raw terminal", "terminal");

    this.agentPaneEl = container.createDiv("vault-agent-console");
    this.createAgentConsole(this.agentPaneEl);

    this.terminalPaneEl = container.createDiv("vault-powershell-terminal vault-terminal-pane-hidden");
    this.showPane("agent");
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.disposeAgent();
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
    this.agentStatusEl = null;
    this.agentTranscriptEl = null;
    this.agentPromptActionsEl = null;
    this.agentInputEl = null;
    this.paneTabEls = { agent: null, terminal: null };
    this.agentProviderButtons = { claude: null, codex: null };
    return Promise.resolve();
  }

  private createPaneTab(container: Element, label: string, pane: ViewPane): HTMLElement {
    const button = container.createEl("button", {
      cls: "vault-terminal-tab",
      text: label
    });
    button.addEventListener("click", () => {
      this.showPane(pane);
    });
    return button;
  }

  private showPane(pane: ViewPane) {
    this.activePane = pane;
    this.agentPaneEl?.toggleClass("vault-terminal-pane-hidden", pane !== "agent");
    this.terminalPaneEl?.toggleClass("vault-terminal-pane-hidden", pane !== "terminal");
    this.paneTabEls.agent?.toggleClass("is-active", pane === "agent");
    this.paneTabEls.terminal?.toggleClass("is-active", pane === "terminal");

    if (pane === "terminal") {
      this.ensureRawTerminal();
      this.terminal?.focus();
      this.scheduleTerminalFitStabilization();
    } else {
      this.agentInputEl?.focus();
    }
  }

  private ensureRawTerminal() {
    if (this.terminalStarted || !this.terminalPaneEl) {
      return;
    }

    this.terminalStarted = true;
    this.createTerminal(this.terminalPaneEl);
    this.startShell();
  }

  private createAgentConsole(container: HTMLElement) {
    container.empty();

    const header = container.createDiv("vault-agent-header");
    const titleWrap = header.createDiv("vault-agent-title-wrap");
    titleWrap.createEl("div", { cls: "vault-agent-title", text: "Agent console" });
    titleWrap.createEl("div", {
      cls: "vault-agent-subtitle",
      text: this.plugin.getVaultPath() ?? "No local vault path"
    });

    this.agentStatusEl = header.createDiv("vault-agent-status");
    this.setAgentStatus("Idle");

    const toolbar = container.createDiv("vault-agent-toolbar");
    const providerGroup = toolbar.createDiv("vault-agent-provider-group");
    this.agentProviderButtons.claude = this.createAgentProviderButton(providerGroup, "Claude", "claude");
    this.agentProviderButtons.codex = this.createAgentProviderButton(providerGroup, "Codex", "codex");
    this.refreshAgentProviderButtons();

    const actions = toolbar.createDiv("vault-agent-actions");
    const startButton = actions.createEl("button", { text: "Start" });
    startButton.addEventListener("click", () => {
      void this.startAgent(this.agentProvider);
    });
    const stopButton = actions.createEl("button", { text: "Stop" });
    stopButton.addEventListener("click", () => {
      this.disposeAgent();
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: "Agent stopped."
      });
    });
    const rawButton = actions.createEl("button", { text: "Raw" });
    rawButton.addEventListener("click", () => {
      this.showPane("terminal");
    });
    const loginButton = actions.createEl("button", { text: "Login" });
    loginButton.addEventListener("click", () => {
      this.sendAgentControlInput("/login");
    });

    this.agentTranscriptEl = container.createDiv("vault-agent-transcript");
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("system"),
      role: "system",
      text: "Start Claude or Codex. The CLI runs in interactive subscription mode behind this pane; the transcript is rendered from local session logs when available."
    });

    const composer = container.createDiv("vault-agent-composer");
    this.agentPromptActionsEl = composer.createDiv("vault-agent-prompt-actions");
    this.refreshAgentPromptActions();
    this.agentInputEl = composer.createEl("textarea", {
      cls: "vault-agent-input",
      attr: {
        rows: "4",
        placeholder: "Message to the selected agent. Shift+Enter inserts a new line."
      }
    });
    this.agentInputEl.addEventListener("keydown", (event) => {
      if (isEnterKey(event) && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        void this.sendAgentInput();
      }
    });

    const composerActions = composer.createDiv("vault-agent-composer-actions");
    const noteButton = composerActions.createEl("button", { text: "Add current note" });
    noteButton.addEventListener("click", () => {
      void this.insertCurrentNoteReferenceIntoAgent();
    });
    const sendButton = composerActions.createEl("button", {
      cls: "mod-cta",
      text: "Send"
    });
    sendButton.addEventListener("click", () => {
      void this.sendAgentInput();
    });
  }

  private createAgentProviderButton(container: HTMLElement, label: string, provider: AgentProvider): HTMLElement {
    const button = container.createEl("button", {
      cls: "vault-agent-provider",
      text: label
    });
    button.addEventListener("click", () => {
      if (this.agentHost) {
        new Notice("Stop the current agent before switching providers.");
        return;
      }

      this.agentProvider = provider;
      this.refreshAgentProviderButtons();
      this.agentInputEl?.focus();
    });
    return button;
  }

  private refreshAgentProviderButtons() {
    this.agentProviderButtons.claude?.toggleClass("is-active", this.agentProvider === "claude");
    this.agentProviderButtons.codex?.toggleClass("is-active", this.agentProvider === "codex");
  }

  private async startAgent(provider: AgentProvider) {
    const cwd = this.plugin.getVaultPath();
    if (!cwd) {
      new Notice("This vault does not expose a local file-system path.");
      return;
    }

    this.disposeAgent();
    this.agentProvider = provider;
    this.refreshAgentProviderButtons();
    this.agentStartedAt = Date.now();
    this.agentSessionPath = null;
    this.agentSessionOffset = 0;
    this.agentSeenEntries.clear();
    this.agentNeedsAuth = false;
    this.agentPromptState = null;
    this.refreshAgentPromptActions();
    this.agentReadyForInput = false;
    this.setAgentStatus(`Starting ${getAgentProviderLabel(provider)}...`);
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("system"),
      role: "system",
      text: `Starting ${getAgentProviderLabel(provider)} in ${cwd}`
    });

    try {
      const missingRuntimeFiles = this.plugin.getRuntimeMissingFiles();
      if (missingRuntimeFiles.length > 0) {
        if (!this.plugin.settings.autoInstallRuntime) {
          throw new Error("Runtime files are missing. Use Settings > Obst Terminal > Runtime files first.");
        }

        await this.plugin.installRuntimeIfNeeded((message) => {
          this.setAgentStatus(message);
        });
      }

      const env = buildProcessEnv({
        useSystemCa: this.plugin.settings.useSystemCa,
        extraCaCertPath: this.plugin.getExtraCaCertPath()
      });
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

      this.agentHost = host;
      this.agentHostReady = false;
      this.startAgentSessionPolling();

      host.stdout.on("data", (chunk: Buffer) => {
        this.handleAgentHostStdout(chunk.toString());
      });

      host.stderr.on("data", (chunk: Buffer) => {
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: stripTerminalControlSequences(chunk.toString()).trim() || chunk.toString()
        });
      });

      host.on("error", (error: Error) => {
        const message = formatTerminalHostError(error, this.plugin);
        this.setAgentStatus("Failed");
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `Failed to start agent host: ${message}`
        });
      });

      host.on("close", (code: number | null) => {
        this.setAgentStatus(`Exited ${code ?? "unknown"}`);
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `Agent host exited with code ${code ?? "unknown"}.`
        });
        this.agentHost = null;
        this.agentHostReady = false;
        this.agentReadyForInput = false;
        this.stopAgentSessionPolling();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setAgentStatus("Failed");
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: `Failed to start ${getAgentProviderLabel(provider)}: ${message}`
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
            text: `${getAgentProviderLabel(this.agentProvider)} exited with code ${message.exitCode ?? "unknown"}.`
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
    const command = getAgentLaunchCommand(this.agentProvider, this.plugin.settings);
    this.sendAgentHostMessage({ type: "data", data: `${command}\r` });
    this.setAgentStatus(`Launching ${getAgentProviderLabel(this.agentProvider)}...`);

    if (this.agentReadyTimer !== null) {
      window.clearTimeout(this.agentReadyTimer);
    }

    this.agentReadyTimer = window.setTimeout(() => {
      this.agentReadyTimer = null;
      if (!this.agentHost) {
        return;
      }

      this.agentReadyForInput = true;
      this.setAgentStatus(`${getAgentProviderLabel(this.agentProvider)} running`);
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: `${getAgentProviderLabel(this.agentProvider)} is running. If it asks for login, use the Login button or send /login in this console. The top Raw terminal tab is a separate fallback shell.`
      });
    }, AGENT_READY_DELAY_MS);
  }

  private async sendAgentInput() {
    const inputEl = this.agentInputEl;
    if (!inputEl) {
      return;
    }

    const text = inputEl.value.trim();
    if (!text && !this.agentPromptState?.allowEmptySubmit) {
      return;
    }

    if (!this.agentHost || !this.agentHostReady || !this.agentReadyForInput) {
      new Notice("Start the selected agent first, then send after it is running.");
      return;
    }

    if (this.agentNeedsAuth && !this.isAgentInteractiveReplyAllowed(text)) {
      new Notice("The agent is asking for authentication. Send /login first.");
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: "Authentication is required before normal messages can be sent. Click Login, type /login, or answer the active login prompt."
      });
      return;
    }

    inputEl.value = "";
    const visibleText = text || "[Enter]";
    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("user"),
      role: "user",
      text: visibleText
    });
    const data = this.agentPromptState
      ? formatAgentInteractiveInput(text)
      : `${formatTerminalPasteData(text)}\r`;
    this.clearAgentPromptState();
    this.sendAgentHostMessage({ type: "data", data });
    this.setAgentStatus(`${getAgentProviderLabel(this.agentProvider)} working...`);
  }

  private sendAgentControlInput(text: string) {
    if (!this.agentHost || !this.agentHostReady || !this.agentReadyForInput) {
      new Notice("Start the selected agent first.");
      return;
    }

    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("user"),
      role: "user",
      text
    });
    this.sendAgentHostMessage({ type: "data", data: `${text}\r` });
    this.clearAgentPromptState();
    this.setAgentStatus(`${getAgentProviderLabel(this.agentProvider)} waiting`);
  }

  private sendAgentControlData(data: string, label: string, keepPrompt = false) {
    if (!this.agentHost || !this.agentHostReady || !this.agentReadyForInput) {
      new Notice("Start the selected agent first.");
      return;
    }

    this.appendAgentTranscript({
      id: this.nextLocalAgentEntryId("user"),
      role: "user",
      text: label
    });
    this.sendAgentHostMessage({ type: "data", data });
    if (!keepPrompt) {
      this.clearAgentPromptState();
    }
    this.setAgentStatus(`${getAgentProviderLabel(this.agentProvider)} waiting`);
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

  private setAgentPromptState(prompt: AgentPromptState) {
    this.agentPromptState = prompt;
    this.agentNeedsAuth = this.agentNeedsAuth || prompt.requiresAuth;
    this.refreshAgentPromptActions();
    this.agentInputEl?.focus();
  }

  private clearAgentPromptState(clearAuth = false) {
    this.agentPromptState = null;
    if (clearAuth) {
      this.agentNeedsAuth = false;
    }
    this.refreshAgentPromptActions();
  }

  private refreshAgentPromptActions() {
    const container = this.agentPromptActionsEl;
    if (!container) {
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
            new Notice("Copied login link.");
          }).catch((error: Error) => {
            new Notice(`Could not copy login link: ${error.message}`);
          });
          return;
        }

        this.sendAgentControlData(action.data, action.label, action.keepPrompt ?? false);
      });
    }
  }

  private openAgentExternalUrl(url: string) {
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    if (!popup) {
      void writeClipboardText(url).then(() => {
        new Notice("Could not open the login link, so it was copied instead.");
      }).catch((error: Error) => {
        new Notice(`Could not open or copy login link: ${error.message}`);
      });
    }
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

    if (/logged in|login successful|authentication complete|successfully authenticated/i.test(plainText)) {
      this.clearAgentPromptState(true);
    }

    const actionablePrompt = extractAgentActionablePrompt(plainText);
    if (actionablePrompt) {
      this.setAgentPromptState(actionablePrompt);
    }

    if (actionablePrompt || (!this.agentSessionPath && /login|auth|permission|trust|press|continue|select|choose|not recognized|not found|command not found/i.test(plainText))) {
      this.setAgentStatus("Agent prompt needs input");
    }

    if (actionablePrompt || /login|auth|permission|trust|press|continue|select|choose|allow|deny|approve|yes|no|y\/n|not recognized|not found|command not found/i.test(plainText)) {
      const notice = actionablePrompt?.text ?? plainText.slice(-1200);
      if (notice !== this.agentLastRawNotice) {
        this.agentLastRawNotice = notice;
        this.appendAgentTranscript({
          id: this.nextLocalAgentEntryId("system"),
          role: "system",
          text: `Agent prompt:\n${notice}\n\nReply in the message box or use the quick actions below. Login menus and yes/no prompts are handled inside this console.`
        });
      }
    }
  }

  private startAgentSessionPolling() {
    this.stopAgentSessionPolling();
    this.agentSessionPollTimer = window.setInterval(() => {
      this.pollAgentSessionLog();
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
      const sessionPath = findLatestAgentSessionFile(this.agentProvider, cwd, this.agentStartedAt);
      if (!sessionPath) {
        return;
      }

      this.agentSessionPath = sessionPath;
      this.agentSessionOffset = 0;
      this.appendAgentTranscript({
        id: this.nextLocalAgentEntryId("system"),
        role: "system",
        text: `Reading session log: ${sessionPath}`
      });
    }

    const chunk = readFileTextFromOffset(this.agentSessionPath, this.agentSessionOffset);
    if (!chunk || !chunk.text) {
      return;
    }

    this.agentSessionOffset = chunk.nextOffset;
    for (const entry of parseAgentTranscriptEntries(this.agentProvider, chunk.text)) {
      if (this.agentSeenEntries.has(entry.id)) {
        continue;
      }

      this.agentSeenEntries.add(entry.id);
      if (entry.role === "user") {
        continue;
      }

      this.appendAgentTranscript(entry);
      this.clearAgentPromptState(true);
      this.setAgentStatus(`${getAgentProviderLabel(this.agentProvider)} running`);
    }
  }

  private appendAgentTranscript(entry: AgentTranscriptEntry) {
    if (!entry.text.trim() || !this.agentTranscriptEl) {
      return;
    }

    const item = this.agentTranscriptEl.createDiv(`vault-agent-message vault-agent-message-${entry.role}`);
    item.createDiv("vault-agent-message-role").setText(getTranscriptRoleLabel(entry.role));
    this.renderAgentMessageBody(item.createDiv("vault-agent-message-body"), entry.text.trim());
    this.agentTranscriptEl.scrollTop = this.agentTranscriptEl.scrollHeight;
  }

  private renderAgentMessageBody(container: HTMLElement, text: string) {
    appendTextWithLinks(container, text, (url) => {
      this.openAgentExternalUrl(url);
    });
  }

  private setAgentStatus(text: string) {
    this.agentStatusEl?.setText(text);
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
    const terminalTheme = buildTerminalTheme(this.plugin.settings.terminalColorScheme);
    applyTerminalThemeVars(container, terminalTheme);

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      drawBoldTextInBrightColors: true,
      fastScrollSensitivity: 12,
      fontFamily: "D2Coding, NanumGothicCoding, GulimChe, 'MS Gothic', 'Cascadia Mono', 'JetBrains Mono', Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      letterSpacing: 0,
      lineHeight: 1.22,
      minimumContrastRatio: 4.5,
      rightClickSelectsWord: false,
      scrollback: 50000,
      scrollOnEraseInDisplay: true,
      scrollSensitivity: 3,
      smoothScrollDuration: 0,
      theme: terminalTheme,
      windowsPty: process.platform === "win32"
        ? { backend: this.plugin.settings.windowsPtyBackend }
        : undefined
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.focus();

    terminal.onData((data) => {
      this.clearCachedClaudeSuggestion(true);
      this.sendHostMessage({ type: "data", data: this.rewriteTerminalInput(data) });
    });
    terminal.onWriteParsed(() => {
      this.scheduleTerminalRefresh();
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }

      if (this.handleCopyPasteShortcut(event, terminal)) {
        return false;
      }

      if (this.handleShiftEnter(event)) {
        return false;
      }

      if (this.handleClaudeSuggestionEnter(event)) {
        return false;
      }

      if (this.handleScrollKey(event, terminal)) {
        return false;
      }

      return true;
    });

    container.addEventListener("wheel", (event) => {
      this.handleTerminalWheel(event, terminal);
    }, { passive: false, capture: true });

    container.addEventListener("keydown", (event) => {
      if (this.handleCopyPasteShortcut(event, terminal)) {
        return;
      }

      this.handleShiftEnter(event);
      this.handleClaudeSuggestionEnter(event);
    }, { passive: false, capture: true });

    container.addEventListener("paste", (event) => {
      this.handleTerminalPaste(event);
    }, { capture: true });

    container.addEventListener("dragover", (event) => {
      this.handleTerminalDragOver(event);
    });
    container.addEventListener("dragleave", () => {
      container.removeClass("vault-terminal-drop-target");
    });
    container.addEventListener("drop", (event) => {
      void this.handleTerminalDrop(event);
    });

    this.windowKeydownHandler = (event) => this.handleGlobalTerminalKeydown(event);
    window.addEventListener("keydown", this.windowKeydownHandler, { capture: true });

    container.addEventListener("contextmenu", (event) => {
      this.showTerminalContextMenu(event, terminal);
    });

    this.terminal = terminal;
    this.terminalContainer = container;
    this.fitAddon = fitAddon;
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleFitTerminal();
    });
    this.resizeObserver.observe(container);
    this.themeObserver = new MutationObserver(() => {
      this.refreshTerminalTheme();
    });
    this.themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"]
    });

    this.scheduleTerminalFitStabilization();
    if (document.fonts) {
      void document.fonts.ready.then(() => {
        if (this.terminal) {
          this.scheduleTerminalFitStabilization();
        }
      }).catch(() => {
        // Font readiness is only a layout hint; the terminal can continue without it.
      });
    }
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
      const shell = this.plugin.getShellExecutable();
      const host = spawn(this.plugin.getNodeExecutable(), [this.plugin.getPtyHostPath(), encodeConfig({
        shell,
        args: this.plugin.getShellArgs(shell),
        fallbackShells: this.plugin.getShellFallbacks(shell),
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

    const shouldFollowOutput = isTerminalScrolledToBottom(terminal);
    terminal.write(data, () => {
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
    if (this.activePane === "agent") {
      this.insertAgentInputText(text);
      return;
    }

    this.ensureRawTerminal();
    this.sendTerminalInput(text);
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
    this.stopAgentSessionPolling();

    if (this.agentHost && kill) {
      this.sendAgentHostMessage({ type: "kill" });
      this.agentHost.kill();
    }

    this.agentHost = null;
    this.agentHostReady = false;
    this.agentReadyForInput = false;
    this.agentStdoutBuffer = "";
    this.agentSessionPath = null;
    this.agentSessionOffset = 0;
    this.agentSeenEntries.clear();
    this.agentLastRawNotice = "";
    this.agentNeedsAuth = false;
    this.agentPromptState = null;
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
      .setName("Shell executable")
      .setDesc("Leave empty for automatic selection. Uses PowerShell on Windows, zsh/bash on macOS, and the local user shell on Linux.")
      .addText((text) =>
        text
          .setPlaceholder("auto")
          .setValue(this.plugin.settings.executable)
          .onChange((value) => {
            this.plugin.settings.executable = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Shell arguments")
      .setDesc("Leave empty for automatic arguments. PowerShell gets -NoLogo; zsh/bash get no startup arguments.")
      .addText((text) =>
        text
          .setPlaceholder("auto")
          .setValue(this.plugin.settings.args)
          .onChange((value) => {
            this.plugin.settings.args = value.trim();
            void this.plugin.saveSettings();
          })
      );

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
      .setDesc("Optional. Downloads the verified OS-specific runtime package when the native terminal runtime is missing or out of date.")
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
      .setDesc("Clipboard images and dropped image data without a local path are saved here before their @path is inserted into the terminal.")
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
      .setName("Terminal color scheme")
      .setDesc("Follows Obsidian by default while keeping a readable ANSI palette for agent CLIs such as Codex and Claude Code.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("obsidian", "Follow Obsidian")
          .addOption("light", "Light terminal")
          .addOption("dark", "Dark terminal")
          .setValue(this.plugin.settings.terminalColorScheme)
          .onChange((value) => {
            this.plugin.settings.terminalColorScheme = normalizeTerminalColorScheme(value);
            void this.plugin.saveSettings();
            new Notice("Reopen the terminal to apply the color scheme.");
          })
      );

    new Setting(containerEl)
      .setName("Shift+Enter behavior")
      .setDesc("Claude backslash newline is the default because it uses Claude Code's built-in multiline path. Reopen the terminal after changing this.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("claude-backslash", "Claude backslash newline")
          .addOption("bracketed-paste", "Bracketed newline paste")
          .addOption("xterm-paste", "xterm paste newline")
          .addOption("modified-enter", "Modified Enter")
          .addOption("csi-u", "CSI-u Shift Enter")
          .addOption("line-feed", "Line feed")
          .setValue(this.plugin.settings.shiftEnterMode)
          .onChange((value) => {
            this.plugin.settings.shiftEnterMode = normalizeShiftEnterMode(value);
            void this.plugin.saveSettings();
            new Notice("Reopen the terminal to apply Shift+Enter behavior.");
          })
      );

    new Setting(containerEl)
      .setName("Run Codex without alternate screen")
      .setDesc("On by default. Obst Terminal submits codex as codex --no-alt-screen so long conversations stay in normal terminal scrollback instead of being redrawn in a fullscreen TUI buffer.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.codexNoAltScreen)
          .onChange((value) => {
            this.plugin.settings.codexNoAltScreen = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Stabilize Codex resize rendering")
      .setDesc("On by default. When you run codex, Obst Terminal adds -c tui.terminal_resize_reflow=false to reduce stale text and overwritten lines after pane resize or TUI redraw.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.codexDisableResizeReflow)
          .onChange((value) => {
            this.plugin.settings.codexDisableResizeReflow = value;
            void this.plugin.saveSettings();
          })
      );

    if (process.platform === "win32") {
      new Setting(containerEl)
        .setName("Windows PTY backend")
        .setDesc("ConPTY is the default because it handles fullscreen TUI rendering and resizing better on modern Windows. Try winpty only if a CLI has input compatibility issues.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("conpty", "ConPTY")
            .addOption("winpty", "winpty")
            .setValue(this.plugin.settings.windowsPtyBackend)
            .onChange((value) => {
              this.plugin.settings.windowsPtyBackend = normalizeWindowsPtyBackend(value);
              void this.plugin.saveSettings();
              new Notice("Reopen the terminal to apply the PTY backend.");
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
    return [DEFAULT_PWSH_PATH, WINDOWS_POWERSHELL_PATH].filter((candidate) => existsSync(candidate));
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

function getAgentProviderLabel(provider: AgentProvider): string {
  return provider === "claude" ? "Claude Code" : "Codex";
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
    return "Authentication";
  }

  if (mode === "command") {
    return "Command prompt";
  }

  return "Agent prompt";
}

function getAgentLaunchCommand(provider: AgentProvider, settings: PowerShellSettings): string {
  if (provider === "claude") {
    return "claude";
  }

  return rewriteCodexCommand("codex", {
    disableResizeReflow: settings.codexDisableResizeReflow,
    noAltScreen: settings.codexNoAltScreen
  }) ?? "codex";
}

function findLatestAgentSessionFile(provider: AgentProvider, cwd: string, startedAt: number): string | null {
  const root = getAgentSessionRoot(provider);
  if (!root || !existsSync(root)) {
    return null;
  }

  const files = getRecentJsonlFiles(root, startedAt - AGENT_SESSION_LOOKBACK_MS);
  for (const file of files) {
    if (agentSessionFileMatches(file, cwd)) {
      return file;
    }
  }

  return null;
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

  const start = Math.max(offset, stats.size - AGENT_SESSION_MAX_READ_BYTES);
  const length = stats.size - start;
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, start);
    return {
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      nextOffset: stats.size
    };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
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
  const urls = extractHttpUrls(normalized);
  const hasMenuCue = rawLines.some((line) => /select|choose|method|use .*arrow|arrow keys|navigate/i.test(line));
  const menuCueIndex = rawLines.findIndex((line) => /select|choose|method|login/i.test(line));
  const contextLines = hasMenuCue && menuCueIndex >= 0
    ? rawLines.slice(Math.max(0, menuCueIndex - 2), menuCueIndex + 12)
    : [];
  const interestingLines = rawLines.filter((line) => {
    return extractHttpUrls(line).length > 0 ||
      /\/login|api error|401|mcp servers need auth|need auth|authentication|login|browser|url|link|select|choose|method|permission|trust|allow|deny|approve|yes|no|y\/n|continue|press|not recognized|not found|command not found/i.test(line);
  });
  const promptLines = uniqueStrings([...contextLines, ...interestingLines])
    .filter((line) => !isNoisyAgentPromptLine(line))
    .slice(-16);

  if (promptLines.length === 0 && urls.length === 0) {
    return null;
  }

  const deduped = uniqueStrings(promptLines.length > 0 ? promptLines : urls).slice(-16);
  const promptText = deduped.join("\n");
  const requiresAuth = /\/login|api error|401|mcp servers need auth|need auth|authentication|login/i.test(promptText) ||
    urls.some((url) => /claude|anthropic|oauth|login|auth/i.test(url));
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
  const mcpAuth = /mcp servers need auth|\/mcp/i.test(text);
  urls.forEach((url, index) => {
    const label = index === 0 ? "Open login link" : `Open link ${index + 1}`;
    actions.push({
      kind: "open-url",
      label,
      url,
      description: url,
      keepPrompt: true
    });
    actions.push({
      kind: "copy-text",
      label: index === 0 ? "Copy login link" : `Copy link ${index + 1}`,
      text: url,
      description: url,
      keepPrompt: true
    });
  });

  if (/\/login|api error|401|authentication|login/i.test(text) || (mode === "auth" && !mcpAuth)) {
    actions.push({ label: "/login", data: "/login\r", description: "Start the agent login flow." });
  }

  if (mcpAuth) {
    actions.push({ label: "/mcp", data: "/mcp\r", description: "Open MCP authentication inside the agent." });
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

  if (mode === "menu" || mode === "permission" || mode === "confirmation") {
    actions.push({ label: "Esc", data: ESCAPE_SEQUENCE, description: "Cancel the active prompt if the CLI supports it." });
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
    /^\? for shortcuts/i.test(line) ||
    /^esc to /i.test(line);
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

  return {
    id: entry.uuid ?? entry.message.id ?? `${entry.timestamp ?? ""}-${text.slice(0, 32)}`,
    role,
    text
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
    text
  };
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
    const typed = item as { type?: string; text?: string; name?: string; input?: unknown; content?: unknown };
    if (typed.type === "text" && typed.text) {
      pieces.push(typed.text);
    } else if (typed.type === "tool_use" && typed.name) {
      pieces.push(`[tool] ${typed.name}`);
    } else if (typed.type === "tool_result") {
      const resultText = typeof typed.content === "string" ? typed.content : "";
      if (resultText) {
        pieces.push(`[tool result]\n${resultText}`);
      }
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
