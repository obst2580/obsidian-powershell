// The plugin wraps every user turn in bracketed context sections before it
// reaches a CLI, so stored transcripts and previews begin with that scaffolding
// rather than with what the user typed. A history title must show the user's
// words, so strip everything up to the request marker.

const REQUEST_MARKER = "[현재 사용자 요청]";

const PREAMBLE_HEADERS = [
  "[현재 실행 설정]",
  "[함께 보고 있는 Obsidian 문서]",
  "[이전 대화 컨텍스트]",
  REQUEST_MARKER
] as const;

/** True when the text carries the plugin's context scaffolding. */
export function hasPluginPreamble(text: string): boolean {
  return PREAMBLE_HEADERS.some((header) => text.includes(header));
}

/** The user's own request, with the plugin's context sections removed. */
export function stripPluginPreamble(text: string): string {
  const index = text.lastIndexOf(REQUEST_MARKER);
  if (index === -1) {
    return text;
  }
  return text.slice(index + REQUEST_MARKER.length).replace(/^\s*\n/, "");
}

/** First non-empty line of the user's request, trimmed to a title length. */
export function titleFromPrompt(text: string, maxLength = 80): string {
  const body = stripPluginPreamble(text);
  const line = body
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0) ?? "";
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}
