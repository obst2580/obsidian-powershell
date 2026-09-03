// Codex exposes its session store over the app-server RPC. `thread/list`
// already carries title, timestamps, cwd, and where the thread came from, so
// this adapter is a mapping plus a cursor loop.

import { titleFromPrompt } from "./prompt-preamble.ts";
import type { AgentHistoryEntry, HistoryListResult, HistorySource } from "./types.ts";

export type CodexRequest = (method: string, params: unknown) => Promise<unknown>;

const PAGE_SIZE = 50;
const MAX_PAGES = 4;

export function mapCodexThread(raw: unknown): AgentHistoryEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const thread = raw as Record<string, unknown>;
  const id = typeof thread.id === "string" ? thread.id : "";
  if (!id) {
    return null;
  }
  const name = typeof thread.name === "string" ? thread.name.trim() : "";
  const preview = typeof thread.preview === "string" ? thread.preview : "";
  const turns = Array.isArray(thread.turns) ? thread.turns.length : null;
  return {
    provider: "codex",
    id,
    title: name || titleFromPrompt(preview) || "(제목 없음)",
    lastActiveAt: toEpochMs(thread.updatedAt) ?? toEpochMs(thread.createdAt) ?? 0,
    turnCount: turns,
    cwd: typeof thread.cwd === "string" ? thread.cwd : null,
    source: sourceOf(thread.threadSource ?? thread.source)
  };
}

/** Codex reports seconds in some builds and milliseconds in others; normalize. */
function toEpochMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}

function sourceOf(value: unknown): HistorySource {
  const kind = typeof value === "string" ? value : "";
  if (kind === "appServer") {
    return "plugin";
  }
  if (kind === "cli" || kind === "vscode" || kind === "exec") {
    return "external";
  }
  return "unknown";
}

export async function listCodexThreads(request: CodexRequest, cwd: string): Promise<HistoryListResult> {
  const entries: AgentHistoryEntry[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = (await request("thread/list", {
      cwd,
      limit: PAGE_SIZE,
      sortKey: "updated_at",
      sortDirection: "desc",
      cursor
    })) as { data?: unknown[]; nextCursor?: string | null } | null;
    for (const raw of response?.data ?? []) {
      const entry = mapCodexThread(raw);
      if (entry) {
        entries.push(entry);
      }
    }
    cursor = response?.nextCursor ?? null;
    if (!cursor) {
      break;
    }
  }
  return {
    provider: "codex",
    entries,
    notice: cursor ? "더 오래된 Codex 세션이 있습니다." : null
  };
}
