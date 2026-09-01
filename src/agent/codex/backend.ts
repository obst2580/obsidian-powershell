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
import type { GetAccountRateLimitsResponse } from "./protocol/v2/GetAccountRateLimitsResponse";
import type { LoginAccountResponse } from "./protocol/v2/LoginAccountResponse";

export interface CodexBackendDeps {
  configuredExecutable: string;
  env: { [key: string]: string | undefined };
  clientVersion: string;
  /** AskForApproval policy applied at thread/start and on every turn. */
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
  /** itemId -> latest known changes, so a fileChange approval can show its diff. */
  private readonly fileChangeItems = new Map<string, unknown[]>();
  private cwd = "";
  private threadId: string | null = null;
  private resumeThreadId: string | null = null;
  private resumeLatestThread = false;
  private currentTurnId: string | null = null;
  private turnOptions: AgentTurnOptions = {};

  constructor(private readonly deps: CodexBackendDeps) {}

  on(listener: AgentUiListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getProcessId(): number | undefined {
    return this.proc?.pid;
  }

  /** Executable the running app-server was launched from, for orphan matching. */
  getProcessExecutable(): string | null {
    return this.proc?.executable ?? null;
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
          isDefault: m.isDefault === true,
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
    this.threadId = options.resumeThreadId ?? null;
    this.resumeThreadId = options.resumeThreadId ?? null;
    this.resumeLatestThread = options.resumeLatestThread === true;
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
    this.fileChangeItems.clear();
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
    if (!this.proc.rpc.respond(rpcId, { decision })) {
      this.emit({
        type: "system-message",
        text: "Could not send the approval decision to codex — the app-server is no longer accepting input. Restart the session.",
      });
    }
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
      // Access level selects the sandbox only. Approvals stay under the user's
      // configured policy; deriving them from the access level here silently
      // overrode that setting on every turn.
      params.sandboxPolicy = accessSandboxPolicy(this.turnOptions.accessLevel, this.cwd);
      params.approvalPolicy = this.deps.approvalPolicy ?? accessApprovalPolicy(this.turnOptions.accessLevel);
    }
    return params;
  }

  private async ensureThread(): Promise<string> {
    if (this.threadId) {
      if (this.resumeThreadId) {
        const resumedId = await this.resumeThread(this.resumeThreadId);
        if (!resumedId) {
          this.threadId = null;
          this.resumeThreadId = null;
        } else {
          this.threadId = resumedId;
          this.resumeThreadId = null;
        }
      }
      if (this.threadId) {
        return this.threadId;
      }
    }
    if (!this.proc) {
      throw new Error("codex app-server is not running");
    }

    if (this.resumeLatestThread) {
      // Legacy single-console behavior: resume the most recent thread for this
      // folder when the pane has not yet been assigned its own thread id.
      const resumedId = await this.tryResumeRecentThread();
      if (resumedId) {
        this.threadId = resumedId;
        this.resumeLatestThread = false;
        return resumedId;
      }
    }

    const params: Record<string, unknown> = { cwd: this.cwd };
    if (this.deps.approvalPolicy) {
      params.approvalPolicy = this.deps.approvalPolicy;
    }
    const res = await this.proc.rpc.request<{ thread: { id: string } }>("thread/start", params);
    this.threadId = res.thread.id;
    this.emit({ type: "thread-ready", threadId: this.threadId });
    return this.threadId;
  }

  private async resumeThread(threadId: string): Promise<string | null> {
    if (!this.proc) {
      return null;
    }
    try {
      const params: Record<string, unknown> = { threadId, cwd: this.cwd };
      if (this.deps.approvalPolicy) {
        params.approvalPolicy = this.deps.approvalPolicy;
      }
      const res = await this.proc.rpc.request<{ thread?: { id?: string } }>("thread/resume", params);
      return res.thread?.id ?? threadId;
    } catch {
      return null;
    }
  }

  private async tryResumeRecentThread(): Promise<string | null> {
    if (!this.proc) {
      return null;
    }
    try {
      // thread/list defaults to newest-first; filter to this cwd and take one.
      const list = await this.proc.rpc.request<{ data?: Array<{ id?: string }> }>("thread/list", {
        cwd: this.cwd,
        limit: 1
      });
      const recentId = list.data?.[0]?.id;
      if (!recentId) {
        return null;
      }
      return await this.resumeThread(recentId);
    } catch {
      // No resumable thread, or list/resume unsupported — caller starts fresh.
      return null;
    }
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
      void this.refreshRateLimits();
    } else {
      this.emit({ type: "status", state: "login-required" });
      this.emit({ type: "auth-required", methods: ["chatgpt", "chatgpt-device-code"] });
    }
  }

  private async refreshRateLimits(): Promise<void> {
    if (!this.proc) {
      return;
    }
    try {
      const res = await this.proc.rpc.request<GetAccountRateLimitsResponse>("account/rateLimits/read");
      const snapshot = res.rateLimitsByLimitId?.codex ?? res.rateLimits;
      const event = mapCodexNotification("account/rateLimits/updated", { rateLimits: snapshot });
      if (event) {
        this.emit(event);
      }
    } catch {
      // Rate-limit data is optional UI metadata; absence should not block chat.
    }
  }

  private handleNotification(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;

    if (method === "account/login/completed") {
      // Fire-and-forget, so it needs its own handler: an unhandled rejection
      // here used to leave the UI stuck in login-in-progress forever.
      void this.refreshAccount().catch((err) => {
        this.emit({
          type: "system-message",
          text: `Signed in, but reading the codex account failed: ${errorText(err)}`,
        });
        this.emit({ type: "status", state: "login-required" });
      });
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
      this.fileChangeItems.clear();
      // Any card still open belongs to a turn that is over; its buttons would
      // answer request ids the server has already forgotten.
      this.discardPendingApprovals();
    } else if (method === "serverRequest/resolved") {
      // Codex can resolve an approval on its own (timeout, guardian auto-review).
      this.discardPendingApproval(p.requestId);
    } else if (method === "item/started" || method === "item/completed") {
      this.rememberFileChangeItem(p.item);
    } else if (method === "item/fileChange/patchUpdated" && typeof p.itemId === "string") {
      this.rememberFileChange(p.itemId, p.changes);
    }

    const event = mapCodexNotification(method, params);
    if (event) {
      this.emit(event);
    }
  }

  private discardPendingApproval(requestId: unknown): void {
    if (typeof requestId !== "string" && typeof requestId !== "number") {
      return;
    }
    const key = String(requestId);
    if (this.pendingApprovals.delete(key)) {
      this.emit({ type: "approval-resolved", requestId: key });
    }
  }

  private discardPendingApprovals(): void {
    for (const requestId of [...this.pendingApprovals.keys()]) {
      this.pendingApprovals.delete(requestId);
      this.emit({ type: "approval-resolved", requestId });
    }
  }

  private rememberFileChangeItem(raw: unknown): void {
    if (!raw || typeof raw !== "object") {
      return;
    }
    const item = raw as Record<string, unknown>;
    if (item.type === "fileChange" && typeof item.id === "string") {
      this.rememberFileChange(item.id, item.changes);
    }
  }

  private rememberFileChange(itemId: string, changes: unknown): void {
    if (Array.isArray(changes) && changes.length > 0) {
      this.fileChangeItems.set(itemId, changes);
    }
  }

  private handleServerRequest(id: number | string, method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;

    let kind: ApprovalRequest["kind"] | null = null;
    if (method.endsWith("commandExecution/requestApproval")) {
      kind = "commandExecution";
    } else if (method.endsWith("fileChange/requestApproval")) {
      kind = "fileChange";
    }

    if (!kind) {
      // A decision is the wrong response shape for most other server requests,
      // and cancelling silently leaves the user with an unexplained failure.
      // Reject explicitly and say which request was refused.
      this.proc?.rpc.respondError(id, -32601, `Unsupported server request: ${method}`);
      this.emit({
        type: "system-message",
        text: `Codex sent "${method}", which this console cannot answer yet. It was declined.`,
      });
      return;
    }

    const requestId = String(id);
    this.pendingApprovals.set(requestId, id);

    const reason = typeof p.reason === "string" ? p.reason : "";
    let summary: string;
    let detail: string;

    if (kind === "commandExecution") {
      const command = typeof p.command === "string" ? p.command : "";
      summary = command || "Run command";
      detail = [command, reason].filter(Boolean).join("\n\n") || summary;
    } else {
      // The approval request itself carries no diff, only the item it belongs
      // to, so pair it with the changes seen on that item. Without this the user
      // approves a patch they cannot see.
      const itemId = typeof p.itemId === "string" ? p.itemId : "";
      const changes = itemId ? this.fileChangeItems.get(itemId) : undefined;
      const grantRoot = typeof p.grantRoot === "string" && p.grantRoot
        ? `Requests write access under: ${p.grantRoot}`
        : "";
      summary = fileChangeSummary(changes) ?? "Apply file change";
      detail = [reason, grantRoot, formatFileChanges(changes)].filter(Boolean).join("\n\n") ||
        "Apply file change. Codex did not include a diff with this request.";
    }

    this.emit({ type: "status", state: "waiting-approval" });
    this.emit({ type: "approval-request", request: { id: requestId, kind, summary, detail } });
  }
}

function fileChangePaths(changes: unknown[] | undefined): string[] {
  if (!changes) {
    return [];
  }
  return changes
    .map((raw) => (raw && typeof raw === "object" ? (raw as Record<string, unknown>).path : null))
    .filter((path): path is string => typeof path === "string" && path.length > 0);
}

function fileChangeSummary(changes: unknown[] | undefined): string | null {
  const paths = fileChangePaths(changes);
  if (paths.length === 0) {
    return null;
  }
  return paths.length === 1
    ? `Apply file change: ${paths[0]}`
    : `Apply file changes to ${paths.length} files: ${paths.join(", ")}`;
}

function formatFileChanges(changes: unknown[] | undefined): string {
  if (!changes) {
    return "";
  }
  return changes
    .map((raw) => {
      if (!raw || typeof raw !== "object") {
        return "";
      }
      const change = raw as Record<string, unknown>;
      const path = typeof change.path === "string" ? change.path : "";
      const kind = typeof change.kind === "string" ? change.kind : "";
      const diff = typeof change.diff === "string" ? change.diff : "";
      const header = [kind, path].filter(Boolean).join(" ");
      return [header, diff].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
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
