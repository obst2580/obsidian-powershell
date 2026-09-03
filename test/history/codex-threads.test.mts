import { test } from "node:test";
import assert from "node:assert/strict";
import { listCodexThreads, mapCodexThread } from "../../src/history/codex-threads.ts";

test("name beats preview; preview is preamble-stripped", () => {
  assert.equal(mapCodexThread({ id: "t", name: "이름", preview: "[현재 사용자 요청]\n미리보기", updatedAt: 1 })?.title, "이름");
  assert.equal(mapCodexThread({ id: "t", name: "", preview: "[현재 사용자 요청]\n미리보기", updatedAt: 1 })?.title, "미리보기");
});

test("seconds and milliseconds both normalize to epoch ms", () => {
  assert.equal(mapCodexThread({ id: "t", updatedAt: 1_700_000_000 })?.lastActiveAt, 1_700_000_000_000);
  assert.equal(mapCodexThread({ id: "t", updatedAt: 1_700_000_000_000 })?.lastActiveAt, 1_700_000_000_000);
  assert.equal(mapCodexThread({ id: "t", createdAt: 5 })?.lastActiveAt, 5000);
});

test("source kinds map to plugin / external / unknown", () => {
  assert.equal(mapCodexThread({ id: "t", threadSource: "appServer" })?.source, "plugin");
  assert.equal(mapCodexThread({ id: "t", source: "cli" })?.source, "external");
  assert.equal(mapCodexThread({ id: "t", source: { custom: "x" } })?.source, "unknown");
  assert.equal(mapCodexThread({ noId: true }), null);
});

test("follows nextCursor up to the page cap and reports leftovers", async () => {
  const calls: unknown[] = [];
  const request = async (_m: string, params: unknown) => {
    calls.push(params);
    const page = calls.length;
    return { data: [{ id: `t${page}`, updatedAt: page }], nextCursor: `c${page}` };
  };
  const result = await listCodexThreads(request, "/v");
  assert.equal(calls.length, 4);
  assert.equal(result.entries.length, 4);
  assert.equal((calls[1] as { cursor: string }).cursor, "c1");
  assert.match(result.notice ?? "", /오래된/);
});
