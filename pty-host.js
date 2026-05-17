const path = require("path");
const fs = require("fs");

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
let shuttingDown = false;

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

function isShellSpawnFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /posix_spawnp failed|ENOENT|spawn .*ENOENT|no such file|not found|EACCES|permission denied|operation not permitted/i.test(message);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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

function repairRuntimePermissions() {
  if (process.platform === "win32") {
    return;
  }

  const spawnHelperPath = path.join(
    __dirname,
    "node_modules",
    "@homebridge",
    "node-pty-prebuilt-multiarch",
    "build",
    "Release",
    "spawn-helper"
  );

  if (fs.existsSync(spawnHelperPath)) {
    fs.chmodSync(spawnHelperPath, 0o755);
  }
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  if (terminal) {
    terminal.kill();
  }
  process.exit(code);
}

try {
  const config = decodeConfig(process.argv[2]);
  repairRuntimePermissions();
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

  const shellCandidates = [
    { shell: config.shell, args: config.args || [] },
    ...(Array.isArray(config.fallbackShells) ? config.fallbackShells : [])
  ].filter((candidate) => candidate?.shell);
  let lastSpawnError = null;
  const spawnFailures = [];

  for (const candidate of shellCandidates) {
    try {
      terminal = pty.spawn(candidate.shell, candidate.args || [], spawnOptions);
      if (candidate.shell !== config.shell) {
        send({
          type: "data",
          data: `Could not start configured shell ${config.shell}; started fallback shell ${candidate.shell}.\r\n`
        });
      }
      break;
    } catch (error) {
      if (useConpty && isMissingConptyRuntime(error)) {
        terminal = pty.spawn(candidate.shell, candidate.args || [], {
          ...spawnOptions,
          useConpty: false
        });
        send({ type: "data", data: "ConPTY runtime file is missing; started with winpty fallback.\r\n" });
        break;
      }

      lastSpawnError = error;
      spawnFailures.push(`${candidate.shell}: ${getErrorMessage(error)}`);
      if (!isShellSpawnFailure(error)) {
        throw error;
      }
    }
  }

  if (!terminal) {
    const attemptedShells = shellCandidates.map((candidate) => candidate.shell).join(", ");
    const failureDetails = spawnFailures.length > 0 ? ` Details: ${spawnFailures.join(" | ")}` : "";
    throw new Error(`Could not start any shell (${attemptedShells}): ${getErrorMessage(lastSpawnError)}.${failureDetails}`);
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

  send({ type: "ready" });
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

process.stdin.on("end", () => {
  shutdown(0);
});

process.stdin.on("close", () => {
  shutdown(0);
});

process.on("SIGTERM", () => {
  shutdown(0);
});

process.on("SIGINT", () => {
  shutdown(0);
});
