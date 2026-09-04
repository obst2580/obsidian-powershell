// Approval cards render their detail into the transcript DOM, and that DOM
// stays for the life of the session. An unbounded unified diff there makes
// every later render and snapshot pay for it, so cap what a card shows; the
// full change remains visible on the fileChange item itself.

export interface ApprovalTextLimits {
  readonly maxLines: number;
  readonly maxChars: number;
}

export const DEFAULT_APPROVAL_TEXT_LIMITS: ApprovalTextLimits = { maxLines: 120, maxChars: 8_000 };

/** Trim to the limits and say how much was left out. Short text passes through unchanged. */
export function truncateForApproval(text: string, limits: ApprovalTextLimits = DEFAULT_APPROVAL_TEXT_LIMITS): string {
  const lines = text.split("\n");
  const withinLines = lines.length <= limits.maxLines;
  const withinChars = text.length <= limits.maxChars;
  if (withinLines && withinChars) {
    return text;
  }
  const keptLines = withinLines ? lines : lines.slice(0, limits.maxLines);
  let kept = keptLines.join("\n");
  if (kept.length > limits.maxChars) {
    kept = kept.slice(0, limits.maxChars);
  }
  const shownLineCount = kept.split("\n").length;
  const omittedLines = Math.max(0, lines.length - shownLineCount);
  const trailer = omittedLines > 0
    ? `… (${omittedLines}줄 생략 — 전체 내용은 변경 항목에서 확인)`
    : "… (이하 생략 — 전체 내용은 변경 항목에서 확인)";
  return `${kept.replace(/\s+$/, "")}\n${trailer}`;
}
