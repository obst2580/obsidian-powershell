import { test } from "node:test";
import assert from "node:assert/strict";
import { listCodexSessionFiles, parseCodexSession } from "../../src/history/codex-sessions.ts";
import { titleFromPrompt } from "../../src/history/prompt-preamble.ts";

const line = (o: Record<string, unknown>) => JSON.stringify(o);
const meta = (over: Record<string, unknown> = {}) => line({ type: "session_meta", timestamp: "2026-08-12T04:39:58", payload: { id: "t1", cwd: "/v", source: "vscode", ...over } });
const userMsg = (text: string, ts = "2026-08-12T04:40:00") => line({ type: "response_item", timestamp: ts, payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
const turn = (ts: string) => line({ type: "event_msg", timestamp: ts, payload: { type: "task_started" } });

test("session_meta supplies id, cwd, and source; turns are task_started events", () => {
  const entry = parseCodexSession([[meta(), turn("2026-08-12T04:39:59"), userMsg("결정 로그 정리해줘"), turn("2026-08-12T05:00:00")].join("\n")], "f");
  assert.equal(entry?.id, "t1");
  assert.equal(entry?.cwd, "/v");
  assert.equal(entry?.source, "plugin");
  assert.equal(entry?.turnCount, 2);
  assert.equal(entry?.lastActiveAt, Date.parse("2026-08-12T05:00:00"));
  assert.equal(entry?.title, "결정 로그 정리해줘");
});

test("injected <recommended_plugins> blocks never become the title", () => {
  const injected = "<recommended_plugins>\nHere is a list\n</recommended_plugins>\n\n실제 첫 요청";
  assert.equal(titleFromPrompt(injected), "실제 첫 요청");
  const only = parseCodexSession([[meta(), userMsg("<recommended_plugins>\nx\n</recommended_plugins>\n\n첫 요청 문장입니다")].join("\n")], "f");
  assert.equal(only?.title, "첫 요청 문장입니다");
});

test("files from other cwds are excluded; unreadable files are skipped", async () => {
  const result = await listCodexSessionFiles("/root", "/v", {
    listFiles: async () => ["/root/a.jsonl", "/root/b.jsonl", "/root/c.jsonl"],
    readSlices: async (p) => {
      if (p.endsWith("b.jsonl")) throw new Error("EBUSY");
      if (p.endsWith("c.jsonl")) return [[meta({ id: "t3", cwd: "/elsewhere" }), userMsg("x")].join("\n")];
      return [[meta(), userMsg("이 볼트 세션")].join("\n")];
    }
  });
  assert.deepEqual(result.entries.map((e) => e.id), ["t1"]);
});
