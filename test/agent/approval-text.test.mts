import { test } from "node:test";
import assert from "node:assert/strict";
import { truncateForApproval } from "../../src/agent/codex/approval-text.ts";

test("short detail passes through untouched", () => {
  const text = "add src/a.ts\n+line1\n+line2";
  assert.equal(truncateForApproval(text), text);
});

test("long diffs are cut at the line cap with an accurate omitted count", () => {
  const lines = Array.from({ length: 500 }, (_, i) => `+line ${i}`);
  const out = truncateForApproval(lines.join("\n"), { maxLines: 120, maxChars: 1_000_000 });
  const outLines = out.split("\n");
  assert.equal(outLines.length, 121);
  assert.equal(outLines[119], "+line 119");
  assert.match(outLines[120], /380줄 생략/);
});

test("the character cap applies even when the line count is small", () => {
  const out = truncateForApproval("x".repeat(20_000), { maxLines: 120, maxChars: 8_000 });
  assert.ok(out.length < 8_100);
  assert.match(out, /생략/);
});
