// Resolve how to spawn the `codex` CLI for `codex app-server`.
//
// Two concerns, split so the tricky part is pure and testable:
//   - findCodexExecutable: locate the binary (IO: config, which/where, fs).
//   - buildCodexSpawnPlan: turn a path into a (command, args) pair, handling
//     the Windows shim problem — npm installs `codex` as `codex.cmd`, and
//     child_process.spawn(".cmd", ...) fails with ENOENT unless routed through
//     the command interpreter. This function is pure; pass platform/comSpec in.

import { existsSync } from "fs";
import { spawnSync } from "child_process";

export interface CodexSpawnPlan {
  command: string;
  args: string[];
}

/**
 * Build the spawn command/args for a resolved codex executable plus its base
 * args (e.g. ["app-server"]). On Windows, `.cmd`/`.bat`/`.ps1` shims are routed
 * through ComSpec / PowerShell so spawn doesn't ENOENT. Pure — inject platform
 * and comSpec.
 */
export function buildCodexSpawnPlan(
  executable: string,
  baseArgs: string[],
  platform: NodeJS.Platform,
  comSpec: string | undefined
): CodexSpawnPlan {
  const lower = executable.toLowerCase();

  if (platform === "win32") {
    if (lower.endsWith(".ps1")) {
      return {
        command: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", executable, ...baseArgs],
      };
    }
    // npm installs the CLI as an extensionless shell shim alongside a `.cmd`,
    // and `where codex` returns the extensionless one first. Spawning that
    // directly ENOENTs on Windows (PATHEXT is not applied to an absolute path).
    // Route everything except a real `.exe` through the command interpreter,
    // which resolves the right PATHEXT entry. baseArgs are fixed literals
    // ("app-server"), so there is no argument-injection surface.
    // /d skip AutoRun, /s preserve quoting of the next token, /c run-then-exit.
    if (!lower.endsWith(".exe")) {
      const shell = comSpec && comSpec.trim() ? comSpec : "cmd.exe";
      return { command: shell, args: ["/d", "/s", "/c", executable, ...baseArgs] };
    }
  }

  return { command: executable, args: baseArgs };
}

/** Lookup function shape so tests can inject a fake which/where. */
export type ExecutableLookup = (name: string) => string[];

/**
 * Locate the codex executable. Order: explicit config path -> which/where ->
 * bare "codex" (let spawn search PATH). Returns null only if nothing resolves
 * and we have no fallback name to try. Inject `lookup` in tests.
 */
export function findCodexExecutable(
  configured: string,
  lookup: ExecutableLookup = whichCodex,
  exists: (p: string) => boolean = existsSync
): string | null {
  const trimmed = configured.trim();
  if (trimmed) {
    // An explicit path is honored even if existsSync can't confirm it (e.g.
    // a bare command name on PATH); only reject when it's clearly a missing file path.
    if (looksLikePath(trimmed) && !exists(trimmed)) {
      return null;
    }
    return trimmed;
  }

  const candidates = lookup("codex");
  for (const candidate of candidates) {
    if (candidate && (!looksLikePath(candidate) || exists(candidate))) {
      return candidate;
    }
  }

  // Last resort: let the OS resolve "codex" on PATH at spawn time.
  return candidates[0] ?? "codex";
}

function looksLikePath(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function whichCodex(name: string): string[] {
  const cmd = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = spawnSync(cmd, [name], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0 || !result.stdout) {
      return [];
    }
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
