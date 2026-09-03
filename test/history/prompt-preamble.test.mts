import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPluginPreamble, stripPluginPreamble, titleFromPrompt } from "../../src/history/prompt-preamble.ts";

const wrapped = "[현재 실행 설정]\nProvider: Codex\n\n[함께 보고 있는 Obsidian 문서]\nnote.md\n\n[현재 사용자 요청]\n결정 로그 갱신해줘\n둘째 줄";

test("detects the plugin scaffolding", () => {
  assert.equal(hasPluginPreamble(wrapped), true);
  assert.equal(hasPluginPreamble("그냥 질문"), false);
});

test("strips everything up to the request marker", () => {
  assert.equal(stripPluginPreamble(wrapped), "결정 로그 갱신해줘\n둘째 줄");
  assert.equal(stripPluginPreamble("그냥 질문"), "그냥 질문");
});

test("title is the first non-empty request line, truncated", () => {
  assert.equal(titleFromPrompt(wrapped), "결정 로그 갱신해줘");
  assert.equal(titleFromPrompt("\n\n  둘째부터  \n셋째"), "둘째부터");
  assert.equal(titleFromPrompt("a".repeat(100), 10), "aaaaaaaaa…");
  assert.equal(titleFromPrompt(""), "");
});
