// Codex writes one rollout JSONL per session under
// ~/.codex/sessions/YYYY/MM/DD/rollout-<stamp>-<id>.jsonl. The first record is
// session_meta with the thread id, cwd, and origin, so history can be listed
// without a running app-server. User turns are response_item/message records
// with role "user" and input_text content.

import { isDescriptiveRequest, titleFromPrompt } from "./prompt-preamble.ts";
import type { AgentHistoryEntry, HistoryListResult, HistorySource } from "./types.ts";

export interface CodexSessionFileDeps {
  /** Every rollout file under the sessions root, any depth. */
  listFiles(root: string): Promise<readonly string[]>;
  readSlices(path: string): Promise<readonly string[]>;
}

interface Acc {
  id: string | null;
  cwd: string | null;
  source: HistorySource;
  firstUserText: string | null;
  lastUserText: string | null;
  lastGoodUserText: string | null;
  maxTimestamp: number;
  turnCount: number;
}

export function parseCodexSession(slices: readonly string[], fallbackId: string): AgentHistoryEntry | null {
  const acc = slices.reduce<Acc>((state, slice) => slice.split(/\r?\n/).reduce(foldLine, state), {
    id: null, cwd: null, source: "unknown", firstUserText: null, lastUserText: null, lastGoodUserText: null, maxTimestamp: 0, turnCount: 0
  });
  const id = acc.id ?? fallbackId;
  if (!id || acc.maxTimestamp === 0) {
    return null;
  }
  const title = (acc.lastGoodUserText ? titleFromPrompt(acc.lastGoodUserText) : "")
    || (acc.lastUserText ? titleFromPrompt(acc.lastUserText) : "")
    || (acc.firstUserText ? titleFromPrompt(acc.firstUserText) : "")
    || "(제목 없음)";
  return { provider: "codex", id, title, lastActiveAt: acc.maxTimestamp, turnCount: acc.turnCount, cwd: acc.cwd, source: acc.source };
}

function foldLine(acc: Acc, line: string): Acc {
  if (!line.trim()) {
    return acc;
  }
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return acc;
  }
  const payload = (record.payload && typeof record.payload === "object" ? record.payload : {}) as Record<string, unknown>;
  const timestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : NaN;
  const next: Acc = { ...acc, maxTimestamp: Number.isFinite(timestamp) ? Math.max(acc.maxTimestamp, timestamp) : acc.maxTimestamp };
  if (record.type === "session_meta") {
    return {
      ...next,
      id: typeof payload.id === "string" ? payload.id : next.id,
      cwd: typeof payload.cwd === "string" ? payload.cwd : next.cwd,
      source: sourceOf(payload.source)
    };
  }
  if (record.type === "event_msg" && payload.type === "task_started") {
    return { ...next, turnCount: next.turnCount + 1 };
  }
  if (record.type === "response_item" && payload.type === "message" && payload.role === "user") {
    const text = inputText(payload.content);
    const hasRequest = text !== null && titleFromPrompt(text).length > 0;
    const isGood = hasRequest && isDescriptiveRequest(titleFromPrompt(text as string));
    return {
      ...next,
      firstUserText: next.firstUserText ?? (hasRequest ? text : null),
      lastUserText: hasRequest ? text : next.lastUserText,
      lastGoodUserText: isGood ? text : next.lastGoodUserText
    };
  }
  return next;
}

function inputText(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return typeof content === "string" ? content : null;
  }
  const parts = content
    .filter((part): part is { type?: unknown; text?: unknown } => !!part && typeof part === "object")
    .filter((part) => part.type === "input_text" && typeof part.text === "string")
    .map((part) => part.text as string);
  return parts.length > 0 ? parts.join("\n") : null;
}

function sourceOf(value: unknown): HistorySource {
  if (value === "vscode") {
    return "plugin";
  }
  if (value === "cli" || value === "exec") {
    return "external";
  }
  return "unknown";
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

/** Sessions whose session_meta cwd is exactly this vault. */
export async function listCodexSessionFiles(root: string, cwd: string, deps: CodexSessionFileDeps): Promise<HistoryListResult> {
  let files: readonly string[];
  try {
    files = await deps.listFiles(root);
  } catch {
    return { provider: "codex", entries: [], notice: null };
  }
  const parsed = await Promise.all(files.map(async (path) => {
    try {
      const name = path.replace(/^.*[\\/]/, "").replace(/\.jsonl$/i, "");
      return parseCodexSession(await deps.readSlices(path), name);
    } catch {
      return null;
    }
  }));
  const entries = parsed.filter((entry): entry is AgentHistoryEntry => entry !== null && entry.cwd !== null && samePath(entry.cwd, cwd));
  return { provider: "codex", entries, notice: null };
}
