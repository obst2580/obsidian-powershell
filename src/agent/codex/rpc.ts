// Minimal JSON-RPC 2.0 client for codex app-server over newline-delimited JSON.
//
// Wire format (verified against codex-cli 0.139.0): one JSON object per line,
// the "jsonrpc":"2.0" field omitted. Three inbound shapes:
//   - response:        { id, result } | { id, error }
//   - notification:    { method, params }            (no id)
//   - server request:  { id, method, params }        (id AND method — e.g. approval)
//
// Transport-agnostic: feed it stdout text and give it a line writer. It knows
// nothing about child_process, so it is unit-testable in isolation.

export type RpcNotificationHandler = (method: string, params: unknown) => void;
export type RpcServerRequestHandler = (id: number | string, method: string, params: unknown) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const OVERLOADED_CODE = -32001;
const MAX_OVERLOAD_RETRIES = 3;

export class RpcError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = "RpcError";
  }
}

export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = "";
  private notificationHandler: RpcNotificationHandler | null = null;
  private serverRequestHandler: RpcServerRequestHandler | null = null;
  private disposed = false;

  constructor(private readonly writeLine: (line: string) => void) {}

  onNotification(handler: RpcNotificationHandler): void {
    this.notificationHandler = handler;
  }

  onServerRequest(handler: RpcServerRequestHandler): void {
    this.serverRequestHandler = handler;
  }

  /**
   * Feed raw stdout text. Splits on newlines, parses complete lines, and holds
   * a partial trailing line until the next chunk (the line-boundary discipline
   * the Agent Console session-log bug taught us to keep).
   */
  feed(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) {
        this.handleLine(line);
      }
    }
  }

  /** Send a request and await its response. Retries -32001 (overloaded) with backoff. */
  async request<T = unknown>(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return (await this.sendOnce(method, params, timeoutMs)) as T;
      } catch (err) {
        if (err instanceof RpcError && err.code === OVERLOADED_CODE && attempt < MAX_OVERLOAD_RETRIES) {
          attempt += 1;
          await delay(backoffMs(attempt));
          continue;
        }
        throw err;
      }
    }
  }

  notify(method: string, params?: unknown): void {
    if (this.disposed) {
      return;
    }
    this.writeLine(JSON.stringify(params === undefined ? { method } : { method, params }));
  }

  /** Answer a server -> client request (e.g. an approval) by its id. */
  respond(id: number | string, result: unknown): void {
    if (this.disposed) {
      return;
    }
    this.writeLine(JSON.stringify({ id, result }));
  }

  respondError(id: number | string, code: number, message: string): void {
    if (this.disposed) {
      return;
    }
    this.writeLine(JSON.stringify({ id, error: { code, message } }));
  }

  /** Reject all in-flight requests; further calls become no-ops. */
  dispose(reason: string): void {
    this.disposed = true;
    for (const p of this.pending.values()) {
      if (p.timer) {
        clearTimeout(p.timer);
      }
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private sendOnce(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error("RPC client disposed"));
    }
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`RPC request "${method}" timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : null;
      this.pending.set(id, { resolve, reject, timer });
      this.writeLine(JSON.stringify(params === undefined ? { method, id } : { method, id, params }));
    });
  }

  private handleLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      // Garbage or a control line; ignore for robustness + forward compat.
      return;
    }
    if (!msg || typeof msg !== "object") {
      return;
    }
    const record = msg as Record<string, unknown>;
    const hasMethod = typeof record.method === "string";
    const hasId = record.id !== undefined && record.id !== null;

    if (hasId && !hasMethod) {
      this.handleResponse(record);
      return;
    }
    if (hasMethod) {
      const method = record.method as string;
      if (hasId) {
        this.serverRequestHandler?.(record.id as number | string, method, record.params);
      } else {
        this.notificationHandler?.(method, record.params);
      }
    }
  }

  private handleResponse(record: Record<string, unknown>): void {
    const id = record.id;
    if (typeof id !== "number") {
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    const error = record.error as { code?: number; message?: string } | undefined;
    if (error) {
      pending.reject(new RpcError(error.code ?? -1, error.message ?? "RPC error"));
    } else {
      pending.resolve(record.result);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
  return base + Math.floor(Math.random() * 250);
}
