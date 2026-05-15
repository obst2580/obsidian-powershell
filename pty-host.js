const path = require("path");

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function decodeConfig(value) {
  if (!value) {
    throw new Error("Missing PTY host config.");
  }

  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

function loadPty() {
  return require(path.join(
    __dirname,
    "node_modules",
    "@homebridge",
    "node-pty-prebuilt-multiarch",
    "lib",
    "index.js"
  ));
}

let terminal = null;
let stdinBuffer = "";
let lastCols = 0;
let lastRows = 0;

const MIN_PTY_COLS = 80;
const MIN_PTY_ROWS = 5;

function clampCols(cols) {
  return Math.max(Math.floor(cols || 80), MIN_PTY_COLS);
}

function clampRows(rows) {
  return Math.max(Math.floor(rows || 24), MIN_PTY_ROWS);
}

function isResizeFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /pty could not be resized|could not be resized/i.test(message);
}

function isMissingConptyRuntime(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /conpty\.node/i.test(message) && /MODULE_NOT_FOUND|Cannot find module/i.test(message);
}

function resizeTerminal(cols, rows) {
  const nextCols = clampCols(cols);
  const nextRows = clampRows(rows);
  if (!terminal || (nextCols === lastCols && nextRows === lastRows)) {
    return;
  }

  try {
    terminal.resize(nextCols, nextRows);
    lastCols = nextCols;
    lastRows = nextRows;
  } catch (error) {
    if (!isResizeFailure(error)) {
      throw error;
    }
  }
}

try {
  const config = decodeConfig(process.argv[2]);
  const pty = loadPty();
  const useConpty = process.platform === "win32" && config.windowsPtyBackend === "conpty";

  const spawnOptions = {
    name: "xterm-256color",
    cols: clampCols(config.cols),
    rows: clampRows(config.rows),
    cwd: config.cwd,
    env: Object.assign({}, process.env, config.env || {})
  };

  if (process.platform === "win32") {
    spawnOptions.useConpty = useConpty;
  }

  try {
    terminal = pty.spawn(config.shell, config.args || [], spawnOptions);
  } catch (error) {
    if (!useConpty || !isMissingConptyRuntime(error)) {
      throw error;
    }

    terminal = pty.spawn(config.shell, config.args || [], {
      ...spawnOptions,
      useConpty: false
    });
    send({ type: "data", data: "ConPTY runtime file is missing; started with winpty fallback.\r\n" });
  }
  lastCols = spawnOptions.cols;
  lastRows = spawnOptions.rows;

  terminal.onData((data) => {
    send({ type: "data", data });
  });

  terminal.onExit(({ exitCode, signal }) => {
    send({ type: "exit", exitCode, signal });
    process.exit(exitCode || 0);
  });
} catch (error) {
  send({
    type: "error",
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdinBuffer += chunk;

  while (true) {
    const newlineIndex = stdinBuffer.indexOf("\n");
    if (newlineIndex === -1) {
      return;
    }

    const line = stdinBuffer.slice(0, newlineIndex).trim();
    stdinBuffer = stdinBuffer.slice(newlineIndex + 1);

    if (!line || !terminal) {
      continue;
    }

    try {
      const message = JSON.parse(line);
      if (message.type === "data") {
        terminal.write(message.data || "");
      } else if (message.type === "resize") {
        resizeTerminal(message.cols, message.rows);
      } else if (message.type === "kill") {
        terminal.kill();
      }
    } catch (error) {
      send({
        type: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
});

process.on("SIGTERM", () => {
  if (terminal) {
    terminal.kill();
  }
  process.exit(0);
});

process.on("SIGINT", () => {
  if (terminal) {
    terminal.kill();
  }
  process.exit(0);
});
