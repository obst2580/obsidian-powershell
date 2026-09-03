// Provider-agnostic session history. One list across every backend; the
// provider is a property of an entry, never a separate list. Adapters read
// each CLI's own store and map into this shape.

export type HistoryProvider = "claude" | "codex" | "gemini";

/** Where a session was started: inside this plugin, elsewhere, or unknown. */
export type HistorySource = "plugin" | "external" | "unknown";

export interface AgentHistoryEntry {
  readonly provider: HistoryProvider;
  /** claude sessionId | codex threadId | antigravity conversation_id */
  readonly id: string;
  readonly title: string;
  /** Epoch milliseconds of the last activity we could observe. */
  readonly lastActiveAt: number;
  readonly turnCount: number | null;
  readonly cwd: string | null;
  readonly source: HistorySource;
}

export interface AgentHistorySource {
  readonly provider: HistoryProvider;
  list(cwd: string): Promise<readonly AgentHistoryEntry[]>;
}

/** Result of one adapter: entries plus a user-facing note when it could not fully answer. */
export interface HistoryListResult {
  readonly provider: HistoryProvider;
  readonly entries: readonly AgentHistoryEntry[];
  readonly notice: string | null;
}
