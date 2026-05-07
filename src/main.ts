import {
  App,
  FileSystemAdapter,
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf
} from "obsidian";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { existsSync } from "fs";
import { isAbsolute, join } from "path";

const VIEW_TYPE_POWERSHELL = "vault-powershell";
const DEFAULT_PWSH_PATH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const WINDOWS_POWERSHELL_PATH = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const DEFAULT_NODE_PATH = "C:\\Program Files\\nodejs\\node.exe";
const MACOS_PWSH_PATHS = ["/opt/homebrew/bin/pwsh", "/usr/local/bin/pwsh", "/opt/local/bin/pwsh"];
const MACOS_NODE_PATHS = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/opt/local/bin/node", "/usr/bin/node"];
const LINUX_PWSH_PATHS = ["/usr/local/bin/pwsh", "/usr/bin/pwsh", "/snap/bin/pwsh"];
const LINUX_NODE_PATHS = ["/usr/local/bin/node", "/usr/bin/node", "/bin/node"];
const SHIFT_ENTER_SEQUENCES: Record<ShiftEnterMode, string> = {
  "modified-enter": "\x1b[27;2;13~",
  "csi-u": "\x1b[13;2u",
  "bracketed-paste": "\x1b[200~\n\x1b[201~",
  "line-feed": "\n"
};

interface PowerShellSettings {
  executable: string;
  args: string;
  nodeExecutable: string;
  terminalColorScheme: TerminalColorScheme;
  shiftEnterMode: ShiftEnterMode;
  windowsPtyBackend: WindowsPtyBackend;
  useSystemCa: boolean;
  extraCaCertPath: string;
}

type TerminalColorScheme = "dark" | "light" | "obsidian";
type ShiftEnterMode = "modified-enter" | "csi-u" | "bracketed-paste" | "line-feed";
type WindowsPtyBackend = "winpty" | "conpty";

interface PtyHostConfig {
  shell: string;
  args: string[];
  cols: number;
  rows: number;
  cwd: string;
  env: { [key: string]: string | undefined };
  windowsPtyBackend: WindowsPtyBackend;
}

type HostInputMessage =
  | { type: "data"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "kill" };

type HostOutputMessage =
  | { type: "data"; data: string }
  | { type: "exit"; exitCode?: number | null; signal?: number }
  | { type: "error"; message: string };

const DEFAULT_SETTINGS: PowerShellSettings = {
  executable: "",
  args: "",
  nodeExecutable: "",
  terminalColorScheme: "obsidian",
  shiftEnterMode: "modified-enter",
  windowsPtyBackend: "winpty",
  useSystemCa: false,
  extraCaCertPath: ""
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

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_POWERSHELL,
      (leaf) => new VaultPowerShellView(leaf, this)
    );

    this.addRibbonIcon("terminal", "Open vault terminal", async () => {
      await this.activateView();
    });

    this.addCommand({
      id: "open-vault-powershell-view",
      name: "Open vault terminal",
      callback: async () => {
        await this.activateView();
      }
    });

    this.addSettingTab(new VaultPowerShellSettingTab(this.app, this));
  }

  async loadSettings() {
    const saved = (await this.loadData()) as Partial<PowerShellSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
    this.settings.terminalColorScheme = normalizeTerminalColorScheme(this.settings.terminalColorScheme);
    this.settings.shiftEnterMode = normalizeShiftEnterMode(this.settings.shiftEnterMode);
    this.settings.windowsPtyBackend = normalizeWindowsPtyBackend(this.settings.windowsPtyBackend);
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
    if (!isAutoShellSetting(configured)) {
      return configured;
    }

    if (process.platform === "win32" && existsSync(DEFAULT_PWSH_PATH)) {
      return DEFAULT_PWSH_PATH;
    }

    if (process.platform === "win32" && existsSync(WINDOWS_POWERSHELL_PATH)) {
      return WINDOWS_POWERSHELL_PATH;
    }

    if (process.platform === "darwin") {
      return firstExistingPath(MACOS_PWSH_PATHS) ?? getUserShell() ?? firstExistingPath(["/bin/zsh", "/bin/bash", "/bin/sh"]) ?? "/bin/zsh";
    }

    if (process.platform === "linux") {
      return firstExistingPath(LINUX_PWSH_PATHS) ?? getUserShell() ?? firstExistingPath(["/bin/bash", "/bin/sh"]) ?? "/bin/sh";
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
      : [join(this.getPluginBasePath(), "certs", "extra-ca.pem")];

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_POWERSHELL)[0];
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: VIEW_TYPE_POWERSHELL,
      active: true
    });
    this.app.workspace.revealLeaf(leaf);
  }
}

class VaultPowerShellView extends ItemView {
  private plugin: VaultPowerShellPlugin;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private host: ChildProcessWithoutNullStreams | null = null;
  private hostStdoutBuffer = "";
  private terminalContainer: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private pendingFitFrame: number | null = null;
  private windowKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private documentKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private wheelLineAccumulator = 0;

  constructor(leaf: WorkspaceLeaf, plugin: VaultPowerShellPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_POWERSHELL;
  }

  getDisplayText(): string {
    return "Vault Terminal";
  }

  getIcon(): string {
    return "terminal";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("vault-powershell-view");

    const terminalEl = container.createDiv("vault-powershell-terminal");
    this.createTerminal(terminalEl);
    this.startShell();
  }

  async onClose() {
    this.disposeShell();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    if (this.windowKeydownHandler) {
      window.removeEventListener("keydown", this.windowKeydownHandler, { capture: true });
      this.windowKeydownHandler = null;
    }
    if (this.documentKeydownHandler) {
      document.removeEventListener("keydown", this.documentKeydownHandler, { capture: true });
      this.documentKeydownHandler = null;
    }
    if (this.pendingFitFrame !== null) {
      cancelAnimationFrame(this.pendingFitFrame);
      this.pendingFitFrame = null;
    }
    this.terminal?.dispose();
    this.terminal = null;
    this.terminalContainer = null;
    this.fitAddon = null;
  }

  private createTerminal(container: HTMLElement) {
    const terminalTheme = buildTerminalTheme(this.plugin.settings.terminalColorScheme);
    applyTerminalThemeVars(container, terminalTheme);

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "block",
      drawBoldTextInBrightColors: true,
      fastScrollSensitivity: 12,
      fontFamily: "Cascadia Mono, JetBrains Mono, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.22,
      minimumContrastRatio: 4.5,
      rightClickSelectsWord: true,
      scrollback: 50000,
      scrollOnEraseInDisplay: true,
      scrollSensitivity: 3,
      smoothScrollDuration: 0,
      theme: terminalTheme
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.focus();

    terminal.onData((data) => {
      this.sendHostMessage({ type: "data", data });
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }

      const key = event.key.toLowerCase();
      const copyShortcut = key === "c" && event.ctrlKey && (event.shiftKey || terminal.hasSelection());
      if (copyShortcut) {
        this.copySelection();
        return false;
      }

      const pasteShortcut = key === "v" && event.ctrlKey;
      if (pasteShortcut) {
        this.pasteClipboard();
        return false;
      }

      if (this.handleShiftEnter(event)) {
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
      this.handleShiftEnter(event);
    }, { passive: false, capture: true });

    this.windowKeydownHandler = (event) => this.handleGlobalShiftEnter(event);
    window.addEventListener("keydown", this.windowKeydownHandler, { capture: true });
    this.documentKeydownHandler = (event) => this.handleGlobalShiftEnter(event);
    document.addEventListener("keydown", this.documentKeydownHandler, { capture: true });

    container.addEventListener("contextmenu", (event) => {
      if (!terminal.hasSelection()) {
        return;
      }

      event.preventDefault();
      this.copySelection();
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

    requestAnimationFrame(() => {
      this.fitTerminal();
    });
  }

  private handleShiftEnter(event: KeyboardEvent): boolean {
    if (!isEnterKey(event) || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }

    this.sendHostMessage({ type: "data", data: SHIFT_ENTER_SEQUENCES[this.plugin.settings.shiftEnterMode] });
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return true;
  }

  private handleGlobalShiftEnter(event: KeyboardEvent) {
    if (this.isTerminalEventTarget(event)) {
      this.handleShiftEnter(event);
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

    return this.app.workspace.activeLeaf === this.leaf;
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
    const pixelsPerLine = 18;
    const rawLines = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
      ? event.deltaY / pixelsPerLine
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * terminal.rows
        : event.deltaY;

    this.wheelLineAccumulator += rawLines;
    const lines = this.wheelLineAccumulator > 0
      ? Math.floor(this.wheelLineAccumulator)
      : Math.ceil(this.wheelLineAccumulator);

    this.wheelLineAccumulator -= lines;
    return lines;
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

    try {
      const env = buildProcessEnv({
        useSystemCa: this.plugin.settings.useSystemCa,
        extraCaCertPath: this.plugin.getExtraCaCertPath()
      });
      const shell = this.plugin.getShellExecutable();
      const host = spawn(this.plugin.getNodeExecutable(), [this.plugin.getPtyHostPath(), encodeConfig({
        shell,
        args: this.plugin.getShellArgs(shell),
        cols: Math.max(terminal.cols, 80),
        rows: Math.max(terminal.rows, 24),
        cwd,
        env,
        windowsPtyBackend: this.plugin.settings.windowsPtyBackend
      })], {
        cwd: this.plugin.getPluginBasePath(),
        env,
        windowsHide: true
      });

      this.host = host;

      host.stdout.on("data", (chunk: Buffer) => {
        this.handleHostStdout(chunk.toString());
      });

      host.stderr.on("data", (chunk: Buffer) => {
        terminal.write(chunk.toString());
      });

      host.on("error", (error: Error) => {
        terminal.writeln(`Failed to start terminal host: ${error.message}`);
      });

      host.on("close", (code: number | null) => {
        terminal.writeln("");
        terminal.writeln(`[terminal host exited with code ${code ?? "unknown"}]`);
        this.host = null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      terminal.writeln(`Failed to start terminal: ${message}`);
      new Notice(`Failed to start terminal: ${message}`);
    }
  }

  private fitTerminal() {
    if (!this.terminal || !this.fitAddon) {
      return;
    }

    try {
      this.fitAddon.fit();
      this.sendHostMessage({
        type: "resize",
        cols: this.terminal.cols,
        rows: this.terminal.rows
      });
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

  private async copySelection() {
    const selection = this.terminal?.getSelection();
    if (!selection) {
      return;
    }

    await writeClipboardText(selection);
    this.terminal?.clearSelection();
  }

  private async pasteClipboard() {
    const text = await readClipboardText();
    if (text) {
      this.sendHostMessage({ type: "data", data: text });
    }
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
    this.hostStdoutBuffer = "";
  }

  private sendHostMessage(message: HostInputMessage) {
    if (!this.host || !this.host.stdin.writable) {
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
          this.terminal?.write(message.data);
        } else if (message.type === "exit") {
          this.terminal?.writeln("");
          this.terminal?.writeln(`[terminal exited with code ${message.exitCode ?? "unknown"}]`);
        } else if (message.type === "error") {
          this.terminal?.writeln(`Failed to start terminal: ${message.message}`);
        }
      } catch {
        this.terminal?.write(line);
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
    containerEl.createEl("h2", { text: "Vault Terminal" });

    new Setting(containerEl)
      .setName("Shell executable")
      .setDesc("Leave empty for automatic selection. Uses PowerShell on Windows, then pwsh/zsh/bash on macOS or Linux.")
      .addText((text) =>
        text
          .setPlaceholder("auto")
          .setValue(this.plugin.settings.executable)
          .onChange(async (value) => {
            this.plugin.settings.executable = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Shell arguments")
      .setDesc("Leave empty for automatic arguments. PowerShell gets -NoLogo; zsh/bash get no startup arguments.")
      .addText((text) =>
        text
          .setPlaceholder("auto")
          .setValue(this.plugin.settings.args)
          .onChange(async (value) => {
            this.plugin.settings.args = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Node executable")
      .setDesc("Used only to run the PTY host process.")
      .addText((text) =>
        text
          .setPlaceholder("auto")
          .setValue(this.plugin.settings.nodeExecutable)
          .onChange(async (value) => {
            this.plugin.settings.nodeExecutable = value.trim();
            await this.plugin.saveSettings();
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
          .onChange(async (value) => {
            this.plugin.settings.terminalColorScheme = normalizeTerminalColorScheme(value);
            await this.plugin.saveSettings();
            new Notice("Reopen Vault Terminal to apply the color scheme.");
          })
      );

    new Setting(containerEl)
      .setName("Shift+Enter behavior")
      .setDesc("Modified Enter is the default for Claude Code and Codex multiline prompts. Reopen Vault Terminal after changing this.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("modified-enter", "Modified Enter")
          .addOption("csi-u", "CSI-u Shift Enter")
          .addOption("bracketed-paste", "Bracketed newline paste")
          .addOption("line-feed", "Line feed")
          .setValue(this.plugin.settings.shiftEnterMode)
          .onChange(async (value) => {
            this.plugin.settings.shiftEnterMode = normalizeShiftEnterMode(value);
            await this.plugin.saveSettings();
            new Notice("Reopen Vault Terminal to apply Shift+Enter behavior.");
          })
      );

    if (process.platform === "win32") {
      new Setting(containerEl)
        .setName("Windows PTY backend")
        .setDesc("winpty preserves raw agent CLI key sequences such as Shift+Enter. ConPTY may filter those sequences before Claude Code/Codex can read them.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("winpty", "winpty")
            .addOption("conpty", "ConPTY")
            .setValue(this.plugin.settings.windowsPtyBackend)
            .onChange(async (value) => {
              this.plugin.settings.windowsPtyBackend = normalizeWindowsPtyBackend(value);
              await this.plugin.saveSettings();
              new Notice("Reopen Vault Terminal to apply the PTY backend.");
            })
        );
    }

    new Setting(containerEl)
      .setName("Use system certificate store")
      .setDesc("Off by default. Enable only when a corporate TLS proxy requires Node CLIs to trust the OS certificate store.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useSystemCa)
          .onChange(async (value) => {
            this.plugin.settings.useSystemCa = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Extra CA certificate")
      .setDesc("Optional PEM file path for corporate TLS inspection. Relative paths are resolved from this plugin folder, for example certs/extra-ca.pem.")
      .addText((text) =>
        text
          .setPlaceholder("certs/extra-ca.pem")
          .setValue(this.plugin.settings.extraCaCertPath)
          .onChange(async (value) => {
            this.plugin.settings.extraCaCertPath = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}

function tokenizeArgs(template: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;

  for (const char of template) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
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

function getUserShell(): string | null {
  const shell = process.env.SHELL?.trim();
  return shell && existsSync(shell) ? shell : null;
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

function isEnterKey(event: KeyboardEvent): boolean {
  return event.key === "Enter" ||
    event.key === "Return" ||
    event.code === "Enter" ||
    event.code === "NumpadEnter" ||
    event.keyCode === 13 ||
    event.which === 13;
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
  if (value === "modified-enter" || value === "csi-u" || value === "bracketed-paste" || value === "line-feed") {
    return value;
  }

  return "modified-enter";
}

function normalizeWindowsPtyBackend(value: string | undefined): WindowsPtyBackend {
  return value === "conpty" ? "conpty" : "winpty";
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
    const electron = require("electron");
    electron.clipboard.writeText(text);
  }
}

async function readClipboardText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    const electron = require("electron");
    return electron.clipboard.readText();
  }
}
