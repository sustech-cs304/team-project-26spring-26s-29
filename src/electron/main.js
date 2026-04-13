const { spawn } = require("node:child_process");
const path = require("node:path");

if (process.env.ELECTRON_RUN_AS_NODE === "1") {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(process.execPath, [path.resolve(__dirname, "..", "..")], {
    cwd: path.resolve(__dirname, "..", ".."),
    env,
    stdio: "inherit",
  }).on("exit", (code) => process.exit(code ?? 0));
  return;
}

const { app, BrowserWindow, ipcMain } = require("electron");
const root = app.getAppPath();
const host = process.env.BACKEND_HOST || "127.0.0.1";
const port = process.env.BACKEND_PORT || "8765";
const api = `http://${host}:${port}`;

let python;
let ready;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ping = async () => {
  try {
    return (await fetch(`${api}/health`)).ok;
  } catch {
    return false;
  }
};

function startBackend() {
  if (python) {
    return ready;
  }

  python = spawn("python", ["-m", "backend.app"], {
    cwd: root,
    env: { ...process.env, BACKEND_HOST: host, BACKEND_PORT: port },
    stdio: "inherit",
  });

  python.on("exit", () => {
    python = null;
    ready = null;
  });

  ready = (async () => {
    for (let i = 0; i < 60; i += 1) {
      if (await ping()) {
        return;
      }
      if (python.exitCode !== null) {
        break;
      }
      await wait(250);
    }
    throw new Error("Backend did not start.");
  })();

  ready.catch(() => {});
  return ready;
}

function createWindow() {
  new BrowserWindow({
    width: 960,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  }).loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

ipcMain.handle("agent:health", async () => ({ ok: await ping() }));

ipcMain.handle("agent:run", async (_event, message) => {
  message = String(message || "").trim();
  if (!message) {
    throw new Error("Message is empty.");
  }

  await startBackend();

  const response = await fetch(`${api}/api/agent/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
});

app.whenReady().then(() => {
  startBackend();
  createWindow();
});
app.on("before-quit", () => python?.kill());
app.on("window-all-closed", () => app.quit());
