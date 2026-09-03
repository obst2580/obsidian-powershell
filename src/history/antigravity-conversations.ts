// Antigravity keeps conversation summaries in a SQLite file. Rather than bundle
// a wasm SQLite, the plugin runs a tiny script under the same system Node it
// already uses for the PTY host; `node:sqlite` is built in from Node 22.13.
// The script is passed on stdin so no argument quoting is needed on Windows.
//
// Conversations started by this plugin carry an empty workspace_uris, so cwd
// matching alone would drop them. The plugin's own prompt preamble in the
// preview marks those as ours instead.

import { hasPluginPreamble, titleFromPrompt } from "./prompt-preamble.ts";
import type { AgentHistoryEntry, HistoryListResult, HistorySource } from "./types.ts";

export interface NodeScriptResult {
  readonly stdout: string;
  readonly exitCode: number | null;
  readonly error?: string;
}

/** Runs system Node with the script on stdin; args are appended after "-". */
export type NodeScriptRunner = (script: string, args: readonly string[]) => Promise<NodeScriptResult>;

export const ANTIGRAVITY_HISTORY_SCRIPT = `
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = db.prepare(
  "SELECT conversation_id AS id, title, preview, step_count AS turns, " +
  "CAST(strftime('%s', last_modified_time) AS INTEGER) AS lastSeconds, workspace_uris AS ws " +
  "FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 400"
).all();
db.close();
process.stdout.write(JSON.stringify(rows));
`;

export interface AntigravityRow {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly turns: number;
  readonly lastSeconds: number | null;
  readonly ws: string;
}

export function mapAntigravityRow(row: AntigravityRow, vaultCwd: string): AgentHistoryEntry | null {
  if (!row.id) {
    return null;
  }
  const workspaces = parseWorkspaceUris(row.ws);
  const matchedCwd = workspaces.find((path) => samePath(path, vaultCwd)) ?? null;
  const fromPlugin = hasPluginPreamble(row.preview);
  if (!matchedCwd && !fromPlugin) {
    return null;
  }
  const source: HistorySource = fromPlugin ? "plugin" : matchedCwd ? "external" : "unknown";
  return {
    provider: "gemini",
    id: row.id,
    title: row.title.trim() || titleFromPrompt(row.preview) || "(제목 없음)",
    lastActiveAt: row.lastSeconds ? row.lastSeconds * 1000 : 0,
    turnCount: Number.isFinite(row.turns) ? row.turns : null,
    cwd: matchedCwd ?? (fromPlugin ? vaultCwd : null),
    source
  };
}

function parseWorkspaceUris(raw: string): readonly string[] {
  if (!raw.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map(fileUriToPath);
  } catch {
    return [];
  }
}

function fileUriToPath(uri: string): string {
  const withoutScheme = uri.replace(/^file:\/\//, "");
  const decoded = decodeURIComponent(withoutScheme);
  // file:///C:/x arrives as "/C:/x"; drop the leading slash on Windows drives.
  return /^\/[A-Za-z]:/.test(decoded) ? decoded.slice(1) : decoded;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

export async function listAntigravityConversations(
  runNode: NodeScriptRunner,
  dbPath: string,
  vaultCwd: string
): Promise<HistoryListResult> {
  const result = await runNode(ANTIGRAVITY_HISTORY_SCRIPT, [dbPath]);
  if (result.error || result.exitCode !== 0) {
    return {
      provider: "gemini",
      entries: [],
      notice: "Antigravity 기록을 읽지 못했습니다. Node 22.13 이상이 필요합니다."
    };
  }
  let rows: AntigravityRow[];
  try {
    rows = JSON.parse(result.stdout) as AntigravityRow[];
  } catch {
    return { provider: "gemini", entries: [], notice: "Antigravity 기록 형식을 해석하지 못했습니다." };
  }
  const entries = rows
    .map((row) => mapAntigravityRow(row, vaultCwd))
    .filter((entry): entry is AgentHistoryEntry => entry !== null);
  return { provider: "gemini", entries, notice: null };
}
