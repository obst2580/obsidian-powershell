// Spawn and supervise a `codex app-server` child process, bridging its stdio to
// a JsonRpcClient. This module owns child_process; the RPC layer does not.

import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { JsonRpcClient } from "./rpc";
import { buildCodexSpawnPlan, findCodexExecutable } from "./resolve-executable";

export interface CodexProcessOptions {
  configuredExecutable: string;
  cwd: string;
  env: { [key: string]: string | undefined };
  onStderr?: (text: string) => void;
  onExit?: (code: number | null) => void;
  onSpawnError?: (message: string) => void;
}

/** Wait after stdin closes before signalling, and again before SIGKILL. */
const GRACE_PERIOD_MS = 500;
const FORCE_KILL_DELAY_MS = 2_000;

export class CodexProcess {
  readonly rpc: JsonRpcClient;
  private child: ChildProcessWithoutNullStreams | null = null;
  private exited = false;
  private resolvedExecutable: string | null = null;

  constructor(private readonly options: CodexProcessOptions) {
    this.rpc = new JsonRpcClient((line) => this.writeLine(line));
  }

  start(): boolean {
    const executable = findCodexExecutable(this.options.configuredExecutable);
    if (!executable) {
      this.options.onSpawnError?.(
        "codex CLI not found. Install it, or set the Codex executable path in settings."
      );
      return false;
    }

    this.resolvedExecutable = executable;
    const plan = buildCodexSpawnPlan(executable, ["app-server"], process.platform, process.env.ComSpec);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(plan.command, plan.args, {
        cwd: this.options.cwd,
        env: this.options.env,
        windowsHide: true,
      });
    } catch (err) {
      this.options.onSpawnError?.(err instanceof Error ? err.message : String(err));
      return false;
    }
    this.child = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.rpc.feed(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.options.onStderr?.(chunk));
    child.on("error", (err: Error) => this.options.onSpawnError?.(err.message));
    child.on("exit", (code: number | null) => {
      this.exited = true;
      this.rpc.dispose("codex app-server exited");
      this.options.onExit?.(code);
    });
    return true;
  }

  /** The live child's pid, or undefined once stopped. Read it before stop(). */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** The executable path this process was actually launched from. */
  get executable(): string | null {
    return this.resolvedExecutable;
  }

  stop(): void {
    this.rpc.dispose("stopped");
    const child = this.child;
    this.child = null;
    if (!child || this.exited) {
      return;
    }
    try {
      child.stdin.end();
    } catch {
      // Already closed; the escalation below still applies.
    }
    // EOF on stdin should be enough. Escalate to SIGTERM, then SIGKILL, so a
    // wedged app-server does not survive as an orphan.
    setTimeout(() => {
      if (this.exited) {
        return;
      }
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      setTimeout(() => {
        if (this.exited) {
          return;
        }
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
      }, FORCE_KILL_DELAY_MS);
    }, GRACE_PERIOD_MS);
  }

  /**
   * Hand one line to the child. Returns false when it could not be written --
   * callers must surface that, because a dropped `respond` leaves codex waiting
   * forever for an approval decision that will never arrive.
   */
  private writeLine(line: string): boolean {
    const child = this.child;
    if (!child || this.exited || !child.stdin.writable) {
      return false;
    }
    try {
      child.stdin.write(`${line}\n`);
      return true;
    } catch {
      // EPIPE when app-server died between the writable check and the write.
      return false;
    }
  }
}
