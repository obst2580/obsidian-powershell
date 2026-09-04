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

// CLIs inject their own XML-ish blocks (<recommended_plugins>…) ahead of the
// user's words; they are never the subject of the conversation.
const LEADING_TAG_BLOCK = /^\s*<([a-z_][\w-]*)>[\s\S]*?<\/\1>\s*/i;

function stripLeadingTagBlocks(text: string): string {
  let current = text;
  for (let guard = 0; guard < 8; guard += 1) {
    const next = current.replace(LEADING_TAG_BLOCK, "");
    if (next === current) {
      return current;
    }
    current = next;
  }
  return current;
}

// Lines the CLI or the plugin inject as user turns, and bare acknowledgements,
// say nothing about the conversation. Skip them when a better request exists.
const NON_DESCRIPTIVE_REQUEST = /^(\[|<|Base directory for this skill\b|계속|알았어|응$|넵?$|네$|예$|ok(ay)?$|yes$|no$|고마워|감사|thanks?)/i;
const MIN_DESCRIPTIVE_LENGTH = 8;

/** True for a request that can stand as a title. */
export function isDescriptiveRequest(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length >= MIN_DESCRIPTIVE_LENGTH && !NON_DESCRIPTIVE_REQUEST.test(trimmed);
}

const GENERIC_SESSION_LABEL = /^(Claude Code|Codex|Gemini CLI|Antigravity CLI|Agent [A-Za-z0-9]{1,16})(?: \d+)?$/;

/** Provider tab labels the plugin generates; they never describe the conversation. */
export function isGenericSessionLabel(title: string): boolean {
  return GENERIC_SESSION_LABEL.test(title.trim());
}

/** First non-empty line of the user's request, trimmed to a title length. */
export function titleFromPrompt(text: string, maxLength = 80): string {
  const body = stripLeadingTagBlocks(stripPluginPreamble(text));
  const line = body
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0) ?? "";
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}
