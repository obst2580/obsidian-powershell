import { test } from "node:test";
import assert from "node:assert/strict";
import { filterHistory, mergeHistory } from "../../src/history/merge.ts";
import type { AgentHistoryEntry } from "../../src/history/types.ts";

const e = (provider: AgentHistoryEntry["provider"], id: string, at: number, title = id): AgentHistoryEntry =>
  ({ provider, id, title, lastActiveAt: at, turnCount: null, cwd: null, source: "unknown" });

test("merges newest first, dedupes by provider+id, flags open tabs", () => {
  const merged = mergeHistory(
    [[e("claude", "a", 1), e("claude", "b", 3)], [e("codex", "a", 2), e("claude", "a", 9)]],
    [{ provider: "codex", id: "a" }]
  );
  assert.deepEqual(merged.map((m) => `${m.provider}:${m.id}`), ["claude:b", "codex:a", "claude:a"]);
  assert.equal(merged[1].open, true);
  assert.equal(merged[0].open, false);
});

test("filter narrows by provider set and case-insensitive title", () => {
  const merged = mergeHistory([[e("claude", "1", 1, "결정 로그"), e("codex", "2", 2, "Deck Build")]], []);
  assert.equal(filterHistory(merged, "deck", null).length, 1);
  assert.equal(filterHistory(merged, "", new Set(["claude"])).length, 1);
  assert.equal(filterHistory(merged, "없음", null).length, 0);
});
