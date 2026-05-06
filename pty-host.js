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

try {
  const config = decodeConfig(process.argv[2]);
  const pty = loadPty();

  terminal = pty.spawn(config.shell, config.args || [], {
    name: "xterm-256color",
    cols: Math.max(config.cols || 80, 2),
    rows: Math.max(config.rows || 24, 1),
    cwd: config.cwd,
    env: Object.assign({}, process.env, config.env || {}),
    useConpty: true
  });

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
        terminal.resize(Math.max(message.cols || 80, 2), Math.max(message.rows || 24, 1));
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
