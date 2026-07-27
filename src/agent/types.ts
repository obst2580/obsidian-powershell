// Agent Console v2 — backend abstraction layer.
//
// This is the boundary between the shared UI (AgentConsoleView) and the
// concrete backends (Codex app-server, Claude session-log, future Claude
// Agent SDK). The UI only ever sees AgentUiEvent; backends only ever receive
// the small command surface on AgentBackend. See docs/AGENT_CONSOLE_V2_DESIGN.md.

export type AgentBackendId = "codex-appserver" | "claude-sessionlog" | "claude-agent-sdk";

export interface AgentBackend {
  readonly id: AgentBackendId;
  /** Spawn/connect and run the auth handshake. Emits status + auth events. */
  start(options: AgentStartOptions): Promise<void>;
  /** Tear down the backend. Idempotent. */
  stop(): Promise<void>;
  /** Send a user turn. No-op (with a system-message event) if not ready. */
  sendUserMessage(input: AgentUserInput): Promise<void>;
  /** Cancel the in-flight turn, if any. */
  interrupt(): Promise<void>;
  /** Begin an interactive login flow (Codex: Sign in with ChatGPT). */
  beginLogin(method: AuthMethod): Promise<void>;
  /** Answer a pending approval request by its id. */
  respondToApproval(requestId: string, decision: ApprovalDecision): Promise<void>;
  /** List available models (empty array if the backend has no model picker). */
  listModels(): Promise<AgentModelInfo[]>;
  /** Set model/effort/access applied to subsequent turns. */
  setTurnOptions(options: AgentTurnOptions): void;
  /** Subscribe to UI events. Returns an unsubscribe function. */
  on(listener: AgentUiListener): () => void;
}

export interface AgentModelInfo {
  id: string;
  displayName: string;
  description?: string;
  /** Whether the provider currently resolves its unpinned default to this model. */
  isDefault?: boolean;
  /** Supported reasoning-effort values for this model (e.g. low/medium/high/xhigh). */
  efforts: string[];
  defaultEffort?: string;
  /** Whether the model accepts image input (controls the file/image button). */
  supportsImage: boolean;
}

/** Coarse access presets that map to a sandbox + approval policy pair. */
export type AgentAccessLevel = "read-only" | "auto" | "full";

export interface AgentTurnOptions {
  model?: string;
  effort?: string;
  accessLevel?: AgentAccessLevel;
}

export type AgentUiListener = (event: AgentUiEvent) => void;

export interface AgentStartOptions {
  /** Working directory for the agent — the vault path. */
  cwd: string;
  /** Resume a prior thread/conversation when the backend supports it. */
  resumeThreadId?: string;
  /** Compatibility fallback for a legacy single-console pane. */
  resumeLatestThread?: boolean;
  /** Human-readable session name shown by the backend where supported. */
  sessionName?: string;
  /** Model id override (backend default when empty). */
  model?: string;
  /** Reasoning effort override (backend default when empty). */
  effort?: string;
}

/** Interactive auth methods a backend may expose. */
export type AuthMethod = "chatgpt" | "chatgpt-device-code" | "api-key";

export interface AgentUserInput {
  text: string;
  attachments?: AgentAttachment[];
}

export interface AgentAttachment {
  kind: "localImage" | "mention";
  /** Absolute path for localImage; vault-relative or absolute for mention. */
  path: string;
  /** Display name (required by Codex `mention` inputs). */
  name?: string;
  /** Hidden shared context supplied by the host UI rather than a manual attachment. */
  contextRole?: "active-note";
}

// The four plain decisions we surface in the UI. Codex also supports
// policy-amendment variants; those are intentionally not exposed here.
export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

// Subset of Codex ThreadItem kinds we render distinctly, plus "system" for
// our own notices and "other" as a forward-compatible catch-all.
export type TranscriptItemKind =
  | "userMessage"
  | "agentMessage"
  | "reasoning"
  | "commandExecution"
  | "fileChange"
  | "plan"
  | "webSearch"
  | "mcpToolCall"
  | "system"
  | "other";

export interface TranscriptItem {
  /** Stable id from the backend; used to target deltas and completion. */
  id: string;
  kind: TranscriptItemKind;
  /** Accumulated display text, updated by item-delta events. */
  text: string;
  /** Kind-specific extras (command, exitCode, diff, etc.). */
  meta?: Record<string, unknown>;
}

export interface ApprovalRequest {
  /** The server-request id to answer with respondToApproval. */
  id: string;
  kind: "commandExecution" | "fileChange";
  /** One-line summary (the command, or the changed files). */
  summary: string;
  /** Full detail (entire command or unified diff). */
  detail: string;
}

export interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
  cachedInput?: number;
  reasoningOutput?: number;
}

export interface AgentUsageWindow {
  label: string;
  usedPercent: number | null;
  resetsAt?: number | null;
}

export type AgentStatus =
  | "idle"
  | "starting"
  | "checking-auth"
  | "login-required"
  | "login-in-progress"
  | "ready"
  | "running"
  | "waiting-approval"
  | "stopped"
  | "error";

// One-way backend -> UI event stream. Deliberately the minimal common
// denominator: a session-log backend can emit only item-complete, while
// Codex emits item-delta too; the UI renders both identically.
export type AgentUiEvent =
  | { type: "status"; state: AgentStatus; detail?: string }
  | { type: "auth-required"; methods: AuthMethod[] }
  | { type: "auth-url"; url: string; userCode?: string }
  | { type: "item-start"; item: TranscriptItem }
  | { type: "item-delta"; itemId: string; textDelta: string }
  | { type: "item-complete"; item: TranscriptItem }
  | { type: "approval-request"; request: ApprovalRequest }
  | { type: "approval-resolved"; requestId: string }
  | { type: "turn-complete"; status: "completed" | "interrupted" | "failed"; tokenUsage?: TokenUsage }
  | { type: "usage-update"; contextPercent?: number | null; rateLimits?: AgentUsageWindow[]; tokenUsage?: TokenUsage }
  | { type: "thread-ready"; threadId: string }
  | { type: "system-message"; text: string }
  | { type: "fatal"; message: string; canRestart: boolean };
