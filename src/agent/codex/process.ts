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

export class CodexProcess {
  readonly rpc: JsonRpcClient;
  private child: ChildProcessWithoutNullStreams | null = null;
  private exited = false;

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
      // ignore
    }
    // Grace period, then force-kill if still alive.
    setTimeout(() => {
      if (!this.exited) {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }
    }, 500);
  }

  private writeLine(line: string): void {
    if (this.child && !this.exited && this.child.stdin.writable) {
      this.child.stdin.write(`${line}\n`);
    }
  }
}
