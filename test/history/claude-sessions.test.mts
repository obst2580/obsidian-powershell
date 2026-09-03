import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeProjectSlug, isGenericSessionLabel, listClaudeSessions, parseClaudeSession } from "../../src/history/claude-sessions.ts";

const line = (record: Record<string, unknown>) => JSON.stringify(record);
const user = (text: string, extra: Record<string, unknown> = {}) =>
  line({ type: "user", timestamp: "2026-09-01T00:00:00.000Z", sessionId: "s1", cwd: "/v", message: { content: text }, ...extra });

test("slug replaces each non-alphanumeric character with a hyphen, Korean included", () => {
  assert.equal(claudeProjectSlug("/Users/obst/personal_project/obsidian-powershell"), "-Users-obst-personal-project-obsidian-powershell");
  assert.equal(claudeProjectSlug("/Users/obst/Documents/obst/개인프로젝트/앱 기회 탐색기"), "-Users-obst-Documents-obst" + "-".repeat(16));
  assert.equal(claudeProjectSlug("C:\\Users\\jhlee13\\Documents\\obst"), "C--Users-jhlee13-Documents-obst");
});

test("custom-title wins over the first user message", () => {
  const entry = parseClaudeSession([[user("첫 질문"), line({ type: "custom-title", customTitle: "붙인 제목", sessionId: "s1" })].join("\n")], "f");
  assert.equal(entry?.title, "붙인 제목");
});

test("a tab-label custom-title is ignored in favour of the first request", () => {
  const text = [user("[현재 사용자 요청]\n진짜 제목"), line({ type: "custom-title", customTitle: "Claude Code 3", sessionId: "s1" })].join("\n");
  assert.equal(parseClaudeSession([text], "f")?.title, "진짜 제목");
  assert.equal(isGenericSessionLabel("Antigravity CLI"), true);
  assert.equal(isGenericSessionLabel("Agent ab12"), true);
  assert.equal(isGenericSessionLabel("결정 로그 정리"), false);
});

test("falls back to the first user line with the preamble stripped", () => {
  const entry = parseClaudeSession([user("[현재 실행 설정]\nx\n\n[현재 사용자 요청]\n실제 요청\n더")], "f");
  assert.equal(entry?.title, "실제 요청");
  assert.equal(entry?.source, "plugin");
});

test("last activity is the max timestamp, not the last line", () => {
  const text = [
    user("q"),
    line({ type: "assistant", timestamp: "2026-09-02T00:00:00.000Z", sessionId: "s1" }),
    line({ type: "last-prompt", sessionId: "s1" })
  ].join("\n");
  const entry = parseClaudeSession([text], "f");
  assert.equal(entry?.lastActiveAt, Date.parse("2026-09-02T00:00:00.000Z"));
  assert.equal(entry?.turnCount, 1);
});

test("sidechain user turns never supply the title; sdk promptSource marks plugin", () => {
  const text = [user("서브에이전트", { isSidechain: true }), user("진짜", { promptSource: "sdk" })].join("\n");
  const entry = parseClaudeSession([text], "f");
  assert.equal(entry?.title, "진짜");
  assert.equal(entry?.source, "plugin");
});

test("terminal sessions are external; garbage and empty files yield null", () => {
  assert.equal(parseClaudeSession([user("터미널")], "f")?.source, "external");
  assert.equal(parseClaudeSession(["not json\n{\"type\":\"x\"}"], "f"), null);
  assert.equal(parseClaudeSession([""], "f"), null);
});

test("missing project directory is an empty list, not an error", async () => {
  const result = await listClaudeSessions("/root", "/v", {
    readdir: async () => { throw new Error("ENOENT"); },
    readSlices: async () => [""],
    join: (...p) => p.join("/")
  });
  assert.deepEqual(result, { provider: "claude", entries: [], notice: null });
});

test("lists only jsonl files and survives one unreadable file", async () => {
  const result = await listClaudeSessions("/root", "/v", {
    readdir: async () => ["a.jsonl", "b.jsonl", "notes.txt"],
    readSlices: async (path) => { if (path.endsWith("b.jsonl")) throw new Error("EBUSY"); return [user("hi")]; },
    join: (...p) => p.join("/")
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, "s1");
});
