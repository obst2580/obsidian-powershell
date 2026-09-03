// Claude Code keeps one JSONL transcript per session under
// ~/.claude/projects/<slug>/, where <slug> is the cwd with every character that
// is not [A-Za-z0-9] replaced by "-" (one replacement per character, so Korean
// path segments collapse one-for-one). Title comes from the CLI's own
// custom-title record when present, else the first user turn.

import { hasPluginPreamble, titleFromPrompt } from "./prompt-preamble.ts";
import type { AgentHistoryEntry, HistoryListResult } from "./types.ts";

export interface ClaudeSessionFileDeps {
  readdir(dir: string): Promise<readonly string[]>;
  readSlices(path: string): Promise<readonly string[]>;
  join(...parts: string[]): string;
}

const GENERIC_SESSION_LABEL = /^(Claude Code|Codex|Gemini CLI|Antigravity CLI|Agent [A-Za-z0-9]{1,16})(?: \d+)?$/;

/** Provider tab labels the plugin generates; they never describe the conversation. */
export function isGenericSessionLabel(title: string): boolean {
  return GENERIC_SESSION_LABEL.test(title.trim());
}

export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

interface ParseAccumulator {
  sessionId: string | null;
  customTitle: string | null;
  firstUserText: string | null;
  lastUserText: string | null;
  maxTimestamp: number;
  assistantCount: number;
  cwd: string | null;
  sawPluginTurn: boolean;
}

/** Fold one transcript's JSONL text (possibly head+tail slices) into a history entry. */
export function parseClaudeSession(slices: readonly string[], fallbackId: string): AgentHistoryEntry | null {
  const acc = slices.reduce<ParseAccumulator>(foldSlice, {
    sessionId: null,
    customTitle: null,
    firstUserText: null,
    lastUserText: null,
    maxTimestamp: 0,
    assistantCount: 0,
    cwd: null,
    sawPluginTurn: false
  });
  const id = acc.sessionId ?? fallbackId;
  if (!id || acc.maxTimestamp === 0) {
    return null;
  }
  const customTitle = acc.customTitle?.trim() ?? "";
  // The plugin passes its tab label as --name, which Claude Code stores as the
  // custom title. "Claude Code 3" says nothing about the conversation, so fall
  // through to the user's first request in that case.
  const usableTitle = customTitle && !isGenericSessionLabel(customTitle) ? customTitle : "";
  // Forked sessions all inherit the same first message, so the latest request
  // is what tells them apart; the first request is only a fallback.
  const title = usableTitle
    || (acc.lastUserText ? titleFromPrompt(acc.lastUserText) : "")
    || (acc.firstUserText ? titleFromPrompt(acc.firstUserText) : "")
    || "(제목 없음)";
  return {
    provider: "claude",
    id,
    title,
    lastActiveAt: acc.maxTimestamp,
    turnCount: acc.assistantCount,
    cwd: acc.cwd,
    source: acc.sawPluginTurn ? "plugin" : "external"
  };
}

function foldSlice(acc: ParseAccumulator, slice: string): ParseAccumulator {
  return slice.split(/\r?\n/).reduce(foldLine, acc);
}

function foldLine(acc: ParseAccumulator, line: string): ParseAccumulator {
  if (!line.trim()) {
    return acc;
  }
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return acc;
  }
  const type = record.type;
  const timestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : NaN;
  const next: ParseAccumulator = {
    ...acc,
    sessionId: acc.sessionId ?? (typeof record.sessionId === "string" ? record.sessionId : null),
    cwd: acc.cwd ?? (typeof record.cwd === "string" ? record.cwd : null),
    maxTimestamp: Number.isFinite(timestamp) ? Math.max(acc.maxTimestamp, timestamp) : acc.maxTimestamp
  };
  if (type === "custom-title" && typeof record.customTitle === "string") {
    return { ...next, customTitle: record.customTitle };
  }
  if (type === "assistant") {
    return { ...next, assistantCount: next.assistantCount + 1 };
  }
  if (type === "user" && record.isSidechain !== true) {
    const text = userText(record.message);
    const isPlugin = record.promptSource === "sdk" || (text !== null && hasPluginPreamble(text));
    // Tool results arrive as user records with no text block; they carry no
    // request and must not displace the real prompts.
    const hasRequest = text !== null && titleFromPrompt(text).length > 0;
    return {
      ...next,
      firstUserText: next.firstUserText ?? (hasRequest ? text : null),
      lastUserText: hasRequest ? text : next.lastUserText,
      sawPluginTurn: next.sawPluginTurn || isPlugin
    };
  }
  return next;
}

function userText(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const block = content.find((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text");
    const text = (block as { text?: unknown } | undefined)?.text;
    return typeof text === "string" ? text : null;
  }
  return null;
}

/** All sessions recorded for exactly this cwd. Missing directory means no sessions, not an error. */
export async function listClaudeSessions(
  projectsRoot: string,
  cwd: string,
  deps: ClaudeSessionFileDeps
): Promise<HistoryListResult> {
  const dir = deps.join(projectsRoot, claudeProjectSlug(cwd));
  let names: readonly string[];
  try {
    names = await deps.readdir(dir);
  } catch {
    return { provider: "claude", entries: [], notice: null };
  }
  const files = names.filter((name) => name.toLowerCase().endsWith(".jsonl"));
  const parsed = await Promise.all(files.map(async (name) => {
    try {
      return parseClaudeSession(await deps.readSlices(deps.join(dir, name)), name.replace(/\.jsonl$/i, ""));
    } catch {
      return null;
    }
  }));
  const entries = parsed.filter((entry): entry is AgentHistoryEntry => entry !== null);
  return { provider: "claude", entries, notice: null };
}
