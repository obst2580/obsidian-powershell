import type { AgentUiEvent, AgentUsageWindow, TranscriptItem, TranscriptItemKind } from "../types";

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

    case "thread/tokenUsage/updated": {
      const usage = p.tokenUsage as { total?: { totalTokens?: number }; modelContextWindow?: number | null } | undefined;
      const used = usage?.total?.totalTokens;
      const contextWindow = usage?.modelContextWindow;
      if (typeof used !== "number" || typeof contextWindow !== "number" || contextWindow <= 0) {
        return { type: "usage-update", contextPercent: null };
      }
      const contextPercent = Math.min(100, Math.max(0, (used / contextWindow) * 100));
      return { type: "usage-update", contextPercent };
    }

    case "account/rateLimits/updated": {
      const rateLimits = rateLimitWindowsFromSnapshot(p.rateLimits);
      return rateLimits.length ? { type: "usage-update", rateLimits } : null;
    }

    case "turn/completed": {
      const turn = p.turn as Record<string, unknown> | undefined;
      return { type: "turn-complete", status: turnStatus(turn?.status) };
    }

    case "warning": {
      const message = typeof p.message === "string" ? p.message : "";
      if (!message || isTransportFallbackNoise(message)) {
        return null;
      }
      return { type: "system-message", text: message };
    }

    case "error": {
      // Suppress transient "Reconnecting... N/5" retries; surface only final errors.
      if (p.willRetry === true) {
        return null;
      }
      const err = p.error as { message?: string } | undefined;
      const message = err?.message;
      if (!message || isTransportFallbackNoise(message)) {
        return null;
      }
      return { type: "system-message", text: `Codex error: ${message}` };
    }

    default:
      return null;
  }
}

export function rateLimitWindowsFromSnapshot(raw: unknown): AgentUsageWindow[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const snapshot = raw as { primary?: unknown; secondary?: unknown };
  return [snapshot.primary, snapshot.secondary]
    .map((window, index) => rateLimitWindowFromRaw(window, index))
    .filter((window): window is AgentUsageWindow => window !== null);
}

function rateLimitWindowFromRaw(raw: unknown, index: number): AgentUsageWindow | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const window = raw as { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown };
  const usedPercent = typeof window.usedPercent === "number"
    ? Math.min(100, Math.max(0, window.usedPercent))
    : null;
  const duration = typeof window.windowDurationMins === "number" ? window.windowDurationMins : null;
  const resetsAt = typeof window.resetsAt === "number" ? window.resetsAt : null;
  return {
    label: rateLimitWindowLabel(duration, index),
    usedPercent,
    resetsAt
  };
}

function rateLimitWindowLabel(durationMins: number | null, index: number): string {
  if (durationMins === 300) {
    return "5h";
  }
  if (durationMins === 10080) {
    return "7d";
  }
  if (durationMins !== null && durationMins > 0) {
    if (durationMins < 60) {
      return `${durationMins}m`;
    }
    if (durationMins % 1440 === 0) {
      return `${durationMins / 1440}d`;
    }
    if (durationMins % 60 === 0) {
      return `${durationMins / 60}h`;
    }
  }
  return index === 0 ? "rate" : `rate${index + 1}`;
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

// The WebSocket -> HTTPS fallback (and its "invalid peer certificate" cause behind
// a corporate CA) is normal: codex still completes the turn over HTTPS. Surfacing
// it as a SYSTEM message only confuses the user, so swallow that specific noise.
function isTransportFallbackNoise(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("falling back from websockets") || m.includes("invalid peer certificate");
}
