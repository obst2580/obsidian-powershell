// Argument quoting for `child_process.spawn(..., { shell: true })` on Windows.
//
// Node joins the command and its arguments with single spaces and hands the
// result to `cmd.exe /d /s /c` without escaping anything -- Node's own DEP0190
// deprecation warning says as much. Two consequences: an unquoted `&` or `|` in
// any value runs as a separate command, and a path containing a space is split
// into two arguments.
//
// cmd treats metacharacters inside double quotes as literal text, so quoting
// each token is enough. A literal double quote cannot be represented that way --
// it would close the quote and expose the remainder to cmd -- so reject it,
// along with control characters, rather than emit something cmd would reparse.
//
// Node wraps the joined string in one more pair of quotes and passes `/s`, which
// strips exactly that outer pair, so per-token quotes survive intact.

const CHARACTERS_REQUIRING_QUOTES = /[\s&|<>^()%!,;=]/;
const DELETE_CHARACTER_CODE = 127;
const FIRST_PRINTABLE_CHARACTER_CODE = 32;

/** A value cmd.exe cannot receive as one literal token no matter how it is quoted. */
function hasUnquotableCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (value[index] === '"' || code < FIRST_PRINTABLE_CHARACTER_CODE || code === DELETE_CHARACTER_CODE) {
      return true;
    }
  }
  return false;
}

/** Quote one command or argument so cmd.exe passes it through as a single literal token. */
export function quoteWindowsShellToken(value: string): string {
  if (hasUnquotableCharacter(value)) {
    throw new Error(`Cannot pass this value to a Windows command safely: ${JSON.stringify(value)}`);
  }
  if (!CHARACTERS_REQUIRING_QUOTES.test(value)) {
    return value;
  }

  // Double a trailing backslash run so the closing quote is not swallowed as an
  // escaped quote by the target program's argv parser.
  return `"${value.replace(/(\\+)$/, "$1$1")}"`;
}

/** Quote a whole command line for `spawn(command, args, { shell: true })` on Windows. */
export function quoteWindowsShellCommand(
  command: string,
  args: readonly string[]
): { command: string; args: string[] } {
  return {
    command: quoteWindowsShellToken(command),
    args: args.map(quoteWindowsShellToken)
  };
}
