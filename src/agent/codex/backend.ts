// CodexAppServerBackend — drives `codex app-server` and presents the common
// AgentBackend surface.
//
// Phase 1: process spawn, initialize handshake, account/read auth, login flow.
// Phase 2: thread lifecycle + turn send/interrupt + streaming notifications.
// Phase 3: command-execution output streaming + approval round-trip.
// Phase 4: model/effort/access turn options + model discovery.

import type {
  AgentAccessLevel,
  AgentBackend,
  AgentModelInfo,
  AgentStartOptions,
  AgentTurnOptions,
  AgentUiEvent,
  AgentUiListener,
  AgentUserInput,
  ApprovalDecision,
  ApprovalRequest,
  AuthMethod,
} from "../types";
import { CodexProcess } from "./process";
import { mapCodexNotification } from "./events";
import type { InitializeResponse } from "./protocol/InitializeResponse";
import type { GetAccountResponse } from "./protocol/v2/GetAccountResponse";
import type { LoginAccountResponse } from "./protocol/v2/LoginAccountResponse";

export interface CodexBackendDeps {
  configuredExecutable: string;
  env: { [key: string]: string | undefined };
  clientVersion: string;
  /** Initial AskForApproval policy for thread/start (overridable per-turn via access level). */
  approvalPolicy?: string;
}

const NOISY_NOTIFICATIONS = [
  "remoteControl/status/changed",
  "mcpServer/startupStatus/updated",
  "mcpServer/oauthLogin/completed",
  "fuzzyFileSearch/sessionUpdated",
  "fuzzyFileSearch/sessionCompleted",
  "fs/changed",
  "thread/status/changed",
];

const TURN_START_TIMEOUT_MS = 60_000;

export class CodexAppServerBackend implements AgentBackend {
  readonly id = "codex-appserver" as const;

  private proc: CodexProcess | null = null;
  private readonly listeners = new Set<AgentUiListener>();
  private readonly pendingApprovals = new Map<string, number | string>();
  private cwd = "";
  private threadId: string | null = null;
  private currentTurnId: string | null = null;
  private turnOptions: AgentTurnOptions = {};

  constructor(private readonly deps: CodexBackendDeps) {}

  on(listener: AgentUiListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: AgentUiEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  setTurnOptions(options: AgentTurnOptions): void {
    this.turnOptions = { ...this.turnOptions, ...options };
  }

  async listModels(): Promise<AgentModelInfo[]> {
    if (!this.proc) {
      return [];
    }
    try {
      const res = await this.proc.rpc.request<{ data?: unknown[] }>("model/list", {});
      const data = Array.isArray(res.data) ? res.data : [];
      return data
        .map((raw) => raw as Record<string, unknown>)
        .filter((m) => m.hidden !== true)
        .map((m) => ({
          id: String(m.id ?? m.model ?? ""),
          displayName: typeof m.displayName === "string" ? m.displayName : String(m.id ?? ""),
          description: typeof m.description === "string" ? m.description : undefined,
          efforts: Array.isArray(m.supportedReasoningEfforts)
            ? m.supportedReasoningEfforts
                .map((e) => (e as Record<string, unknown>).reasoningEffort)
                .filter((e): e is string => typeof e === "string")
            : [],
          defaultEffort: typeof m.defaultReasoningEffort === "string" ? m.defaultReasoningEffort : undefined,
          supportsImage: Array.isArray(m.inputModalities) && m.inputModalities.includes("image"),
        }))
        .filter((m) => m.id);
    } catch {
      return [];
    }
  }

  async start(options: AgentStartOptions): Promise<void> {
    this.cwd = options.cwd;
    this.threadId = null;
    this.currentTurnId = null;
    if (options.model) {
      this.turnOptions.model = options.model;
    }
    if (options.effort) {
      this.turnOptions.effort = options.effort;
    }
    this.emit({ type: "status", state: "starting" });

    const proc = new CodexProcess({
      configuredExecutable: this.deps.configuredExecutable,
      cwd: options.cwd,
      env: this.deps.env,
      onSpawnError: (message) => this.emit({ type: "fatal", message, canRestart: true }),
      onExit: (code) =>
        this.emit({
          type: "fatal",
          message: `codex app-server exited (code ${code ?? "unknown"}).`,
          canRestart: true,
        }),
    });
    this.proc = proc;
    proc.rpc.onNotification((method, params) => this.handleNotification(method, params));
    proc.rpc.onServerRequest((id, method, params) => this.handleServerRequest(id, method, params));

    if (!proc.start()) {
      return;
    }

    try {
      await proc.rpc.request<InitializeResponse>("initialize", {
        clientInfo: { name: "obst-terminal", version: this.deps.clientVersion },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: NOISY_NOTIFICATIONS,
        },
      });
      proc.rpc.notify("initialized");
      this.emit({ type: "status", state: "checking-auth" });
      await this.refreshAccount();
    } catch (err) {
      this.emit({
        type: "fatal",
        message: `codex app-server handshake failed: ${errorText(err)}. Update the codex CLI (app-server is required).`,
        canRestart: true,
      });
    }
  }

  async stop(): Promise<void> {
    for (const rpcId of this.pendingApprovals.values()) {
      this.proc?.rpc.respond(rpcId, { decision: "cancel" });
    }
    this.pendingApprovals.clear();
    this.proc?.stop();
    this.proc = null;
    this.threadId = null;
    this.currentTurnId = null;
    this.emit({ type: "status", state: "stopped" });
  }

  async beginLogin(method: AuthMethod): Promise<void> {
    if (!this.proc) {
      return;
    }
    this.emit({ type: "status", state: "login-in-progress" });
    const loginType = method === "chatgpt-device-code" ? "chatgptDeviceCode" : "chatgpt";
    try {
      const res = await this.proc.rpc.request<LoginAccountResponse>("account/login/start", { type: loginType });
      if (res.type === "chatgpt") {
        this.emit({ type: "auth-url", url: res.authUrl });
      } else if (res.type === "chatgptDeviceCode") {
        this.emit({ type: "auth-url", url: res.verificationUrl, userCode: res.userCode });
      }
    } catch (err) {
      this.emit({ type: "system-message", text: `Login failed: ${errorText(err)}` });
      this.emit({ type: "status", state: "login-required" });
    }
  }

  async sendUserMessage(input: AgentUserInput): Promise<void> {
    if (!this.proc) {
      this.emit({ type: "system-message", text: "Start Codex first." });
      return;
    }
    try {
      const threadId = await this.ensureThread();
      this.emit({ type: "status", state: "running" });
      await this.proc.rpc.request(
        "turn/start",
        { threadId, input: buildTurnInput(input), ...this.turnParams() },
        TURN_START_TIMEOUT_MS
      );
    } catch (err) {
      this.emit({ type: "system-message", text: `Send failed: ${errorText(err)}` });
      this.emit({ type: "status", state: "ready" });
    }
  }

  async interrupt(): Promise<void> {
    if (!this.proc || !this.threadId || !this.currentTurnId) {
      return;
    }
    try {
      await this.proc.rpc.request("turn/interrupt", {
        threadId: this.threadId,
        turnId: this.currentTurnId,
      });
    } catch (err) {
      this.emit({ type: "system-message", text: `Interrupt failed: ${errorText(err)}` });
    }
  }

  async respondToApproval(requestId: string, decision: ApprovalDecision): Promise<void> {
    const rpcId = this.pendingApprovals.get(requestId);
    if (rpcId === undefined || !this.proc) {
      return;
    }
    this.pendingApprovals.delete(requestId);
    this.proc.rpc.respond(rpcId, { decision });
    this.emit({ type: "approval-resolved", requestId });
  }

  // Per-turn overrides built from the current turn options. Applied on every
  // turn/start so model/effort/access changes take effect immediately.
  private turnParams(): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    if (this.turnOptions.model) {
      params.model = this.turnOptions.model;
    }
    if (this.turnOptions.effort) {
      params.effort = this.turnOptions.effort;
    }
    if (this.turnOptions.accessLevel) {
      params.approvalPolicy = accessApprovalPolicy(this.turnOptions.accessLevel);
      params.sandboxPolicy = accessSandboxPolicy(this.turnOptions.accessLevel, this.cwd);
    }
    return params;
  }

  private async ensureThread(): Promise<string> {
    if (this.threadId) {
      return this.threadId;
    }
    if (!this.proc) {
      throw new Error("codex app-server is not running");
    }
    const params: Record<string, unknown> = { cwd: this.cwd };
    if (this.deps.approvalPolicy) {
      params.approvalPolicy = this.deps.approvalPolicy;
    }
    const res = await this.proc.rpc.request<{ thread: { id: string } }>("thread/start", params);
    this.threadId = res.thread.id;
    return this.threadId;
  }

  private async refreshAccount(): Promise<void> {
    if (!this.proc) {
      return;
    }
    const res = await this.proc.rpc.request<GetAccountResponse>("account/read", {});
    const account = res.account as { email?: string; planType?: string } | null;
    if (account) {
      const plan = account.planType ? ` (${account.planType})` : "";
      const label = account.email ? `${account.email}${plan}` : "signed in";
      this.emit({ type: "status", state: "ready", detail: label });
    } else {
      this.emit({ type: "status", state: "login-required" });
      this.emit({ type: "auth-required", methods: ["chatgpt", "chatgpt-device-code"] });
    }
  }

  private handleNotification(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;

    if (method === "account/login/completed") {
      void this.refreshAccount();
      return;
    }
    if (method === "thread/started") {
      const id = (p.thread as { id?: unknown } | undefined)?.id;
      if (typeof id === "string") {
        this.threadId = id;
        this.emit({ type: "thread-ready", threadId: id });
      }
      return;
    }
    if (method === "turn/started") {
      const id = (p.turn as { id?: unknown } | undefined)?.id;
      this.currentTurnId = typeof id === "string" ? id : null;
    } else if (method === "turn/completed") {
      this.currentTurnId = null;
    }

    const event = mapCodexNotification(method, params);
    if (event) {
      this.emit(event);
    }
  }

  private handleServerRequest(id: number | string, method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;

    let kind: ApprovalRequest["kind"] | null = null;
    if (method.includes("commandExecution/requestApproval")) {
      kind = "commandExecution";
    } else if (method.includes("fileChange/requestApproval")) {
      kind = "fileChange";
    }

    if (!kind) {
      this.proc?.rpc.respond(id, { decision: "cancel" });
      return;
    }

    const requestId = String(id);
    this.pendingApprovals.set(requestId, id);

    const command = typeof p.command === "string" ? p.command : "";
    const reason = typeof p.reason === "string" ? p.reason : "";
    const summary = kind === "commandExecution" ? command || "Run command" : "Apply file change";
    const detail = [command, reason].filter(Boolean).join("\n\n") || summary;

    this.emit({ type: "status", state: "waiting-approval" });
    this.emit({ type: "approval-request", request: { id: requestId, kind, summary, detail } });
  }
}

function buildTurnInput(input: AgentUserInput): unknown[] {
  const items: unknown[] = [{ type: "text", text: input.text, text_elements: [] }];
  for (const attachment of input.attachments ?? []) {
    if (attachment.kind === "localImage") {
      items.push({ type: "localImage", path: attachment.path });
    } else {
      items.push({ type: "mention", name: attachment.name ?? attachment.path, path: attachment.path });
    }
  }
  return items;
}

function accessApprovalPolicy(level: AgentAccessLevel): string {
  switch (level) {
    case "read-only":
    case "auto":
      return "on-request";
    case "full":
      return "never";
  }
}

function accessSandboxPolicy(level: AgentAccessLevel, cwd: string): Record<string, unknown> {
  switch (level) {
    case "read-only":
      return { type: "readOnly", networkAccess: false };
    case "auto":
      return {
        type: "workspaceWrite",
        writableRoots: cwd ? [cwd] : [],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
    case "full":
      return { type: "dangerFullAccess" };
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
