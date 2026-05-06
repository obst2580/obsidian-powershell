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
import { Terminal } from "@xterm/xterm";
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

interface PowerShellSettings {
  executable: string;
  args: string;
  nodeExecutable: string;
  useSystemCa: boolean;
  extraCaCertPath: string;
}

interface PtyHostConfig {
  shell: string;
  args: string[];
  cols: number;
  rows: number;
  cwd: string;
  env: { [key: string]: string | undefined };
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
  useSystemCa: true,
  extraCaCertPath: ""
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
  private resizeObserver: ResizeObserver | null = null;

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
    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
  }

  private createTerminal(container: HTMLElement) {
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: "Cascadia Mono, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      rightClickSelectsWord: true,
      scrollback: 5000,
      theme: {
        background: getCssVar("--background-primary", "#1e1e1e"),
        foreground: getCssVar("--text-normal", "#d4d4d4"),
        cursor: getCssVar("--text-accent", "#ffffff"),
        selectionBackground: getCssVar("--text-selection", "#264f78")
      }
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

      return true;
    });

    container.addEventListener("contextmenu", (event) => {
      if (!terminal.hasSelection()) {
        return;
      }

      event.preventDefault();
      this.copySelection();
    });

    this.terminal = terminal;
    this.fitAddon = fitAddon;
    this.resizeObserver = new ResizeObserver(() => {
      this.fitTerminal();
    });
    this.resizeObserver.observe(container);

    requestAnimationFrame(() => {
      this.fitTerminal();
    });
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
        env
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
      .setName("Use system certificate store")
      .setDesc("Adds Node's --use-system-ca option for CLI tools such as Claude Code.")
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
      .setDesc("Optional PEM file path. Relative paths are resolved from this plugin folder, for example certs/extra-ca.pem.")
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
