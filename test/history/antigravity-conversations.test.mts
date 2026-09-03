import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ANTIGRAVITY_HISTORY_SCRIPT, listAntigravityConversations, mapAntigravityRow } from "../../src/history/antigravity-conversations.ts";

const row = (over: Partial<Parameters<typeof mapAntigravityRow>[0]>) =>
  ({ id: "c1", title: "", preview: "", turns: 3, lastSeconds: 1_700_000_000, ws: "", ...over });

test("plugin-started conversation (empty workspace, preamble in preview) is kept as plugin", () => {
  const entry = mapAntigravityRow(row({ preview: "[현재 실행 설정]\nx\n[현재 사용자 요청]\n질문" }), "/v");
  assert.equal(entry?.source, "plugin");
  assert.equal(entry?.title, "질문");
  assert.equal(entry?.cwd, "/v");
  assert.equal(entry?.lastActiveAt, 1_700_000_000_000);
});

test("external conversation matches the vault through workspace_uris, case and slash insensitive", () => {
  const entry = mapAntigravityRow(row({ ws: JSON.stringify(["file:///Users/obst/Documents/obst/"]), preview: "Designing" }), "/users/obst/documents/obst");
  assert.equal(entry?.source, "external");
  assert.equal(entry?.title, "Designing");
});

test("Windows file URIs decode to a drive path", () => {
  const entry = mapAntigravityRow(row({ ws: JSON.stringify(["file:///C:/Users/jhlee13/Documents/obst"]) }), "C:\\Users\\jhlee13\\Documents\\obst");
  assert.equal(entry?.cwd, "C:/Users/jhlee13/Documents/obst");
});

test("unrelated conversations are dropped; explicit title wins", () => {
  assert.equal(mapAntigravityRow(row({ ws: JSON.stringify(["file:///elsewhere"]), preview: "x" }), "/v"), null);
  assert.equal(mapAntigravityRow(row({ title: "제목", preview: "[현재 사용자 요청]\n다른" }), "/v")?.title, "제목");
});

test("runner failure becomes a notice, never a throw", async () => {
  const result = await listAntigravityConversations(async () => ({ stdout: "", exitCode: 1, error: "boom" }), "/db", "/v");
  assert.equal(result.entries.length, 0);
  assert.match(result.notice ?? "", /Node 22\.13/);
});

const dbPath = join(homedir(), ".gemini", "antigravity-cli", "conversation_summaries.db");
test("the embedded script reads the real database when one is present", { skip: !existsSync(dbPath) }, async () => {
  const run = (script: string, args: readonly string[]) => new Promise<{ stdout: string; exitCode: number | null }>((resolve) => {
    const child = spawn(process.execPath, ["--no-warnings", "--input-type=module", "-", ...args]);
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.on("close", (code) => resolve({ stdout, exitCode: code }));
    child.stdin.end(script);
  });
  const result = await run(ANTIGRAVITY_HISTORY_SCRIPT, [dbPath]);
  assert.equal(result.exitCode, 0);
  const rows = JSON.parse(result.stdout) as Array<{ id: string; lastSeconds: number }>;
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => typeof r.id === "string" && Number.isInteger(r.lastSeconds)));
});
