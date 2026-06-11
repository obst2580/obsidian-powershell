import type { AgentUiEvent, TranscriptItem, TranscriptItemKind } from "../types";

// Maps codex app-server notifications to UI events. Structures verified against
// codex-cli 0.139.0 (Phase 2 wire probe). Unknown notifications return null and
// are ignored (forward compatibility).
//
// Note: thread/started, turn/started, turn/completed also carry thread/turn IDs
// that the backend must track; the backend intercepts those first and then calls
// this for the display translation.
export function mapCodexNotification(method: string, params: unknown): AgentUiEvent | null {
  const p = (params ?? {}) as Record<string, unknown>;
  switch (method) {
    case "turn/started":
      return { type: "status", state: "running" };

    case "item/started": {
      const item = toTranscriptItem(p.item);
      return item ? { type: "item-start", item } : null;
    }
    case "item/completed": {
      const item = toTranscriptItem(p.item);
      return item ? { type: "item-complete", item } : null;
    }

    case "item/agentMessage/delta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta": {
      const itemId = p.itemId;
      const delta = p.delta;
      return typeof itemId === "string" && typeof delta === "string"
        ? { type: "item-delta", itemId, textDelta: delta }
        : null;
    }

    case "thread/tokenUsage/updated":
      return { type: "status", state: "running", detail: tokenDetail(p.tokenUsage) };

    case "turn/completed": {
      const turn = p.turn as Record<string, unknown> | undefined;
      return { type: "turn-complete", status: turnStatus(turn?.status) };
    }

    case "warning":
      return typeof p.message === "string" ? { type: "system-message", text: p.message } : null;

    case "error": {
      // Suppress transient "Reconnecting... N/5" retries; surface only final errors.
      if (p.willRetry === true) {
        return null;
      }
      const err = p.error as { message?: string } | undefined;
      return err?.message ? { type: "system-message", text: `Codex error: ${err.message}` } : null;
    }

    default:
      return null;
  }
}

const KIND_MAP: Record<string, TranscriptItemKind> = {
  agentMessage: "agentMessage",
  reasoning: "reasoning",
  plan: "plan",
  commandExecution: "commandExecution",
  fileChange: "fileChange",
  webSearch: "webSearch",
  mcpToolCall: "mcpToolCall",
};

function toTranscriptItem(raw: unknown): TranscriptItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const item = raw as Record<string, unknown>;
  const id = item.id;
  const type = item.type;
  if (typeof id !== "string" || typeof type !== "string") {
    return null;
  }
  // userMessage is our own input echoed back — the client already rendered it.
  if (type === "userMessage") {
    return null;
  }
  return {
    id,
    kind: KIND_MAP[type] ?? "other",
    text: extractItemText(type, item),
    meta: extractItemMeta(type, item),
  };
}

function extractItemText(type: string, item: Record<string, unknown>): string {
  switch (type) {
    case "agentMessage":
    case "plan":
      return typeof item.text === "string" ? item.text : "";
    case "reasoning": {
      const summary = asStringArray(item.summary).join("\n");
      return summary || asStringArray(item.content).join("\n");
    }
    case "commandExecution":
      return typeof item.command === "string" ? `$ ${item.command}\n` : "";
    case "webSearch":
      return typeof item.query === "string" ? `Searching: ${item.query}` : "Web search";
    case "mcpToolCall":
      return `${item.server ?? "mcp"} / ${item.tool ?? ""}`;
    default:
      return "";
  }
}

function extractItemMeta(type: string, item: Record<string, unknown>): Record<string, unknown> | undefined {
  if (type === "commandExecution") {
    return {
      command: item.command,
      exitCode: item.exitCode,
      status: item.status,
      output: item.aggregatedOutput,
    };
  }
  if (type === "fileChange") {
    return { changes: item.changes, status: item.status };
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function turnStatus(status: unknown): "completed" | "interrupted" | "failed" {
  if (status === "interrupted") {
    return "interrupted";
  }
  if (status === "failed") {
    return "failed";
  }
  return "completed";
}

function tokenDetail(usage: unknown): string | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }
  const total = (usage as Record<string, unknown>).total as Record<string, unknown> | undefined;
  const totalTokens = total?.totalTokens;
  return typeof totalTokens === "number" ? `${totalTokens.toLocaleString()} tokens` : undefined;
}
