const { spawn } = require("node:child_process");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { readConfig, registerConfigIpc, syncRuntimeConfig } = require("./config");
const { registerAgentIpc } = require("./ipc");

const config = readConfig();
const api = `http://${config.backendHost}:${config.backendPort}`;

let python;
let ready;

function startBackend() {
  if (python) {
    return ready;
  }

  python = spawn("python", [
    "-m",
    "uvicorn",
    "backend.app:app",
    "--host",
    config.backendHost,
    "--port",
    String(config.backendPort),
  ], {
    cwd: app.getAppPath(),
    env: process.env,
    stdio: "inherit",
  });

  python.on("exit", () => {
    python = null;
    ready = null;
  });

  ready = (async () => {
    for (let i = 0; i < 60; i += 1) {
      try {
        if ((await fetch(`${api}/health`)).ok) {
          return;
        }
      } catch {}

      if (python.exitCode !== null) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Backend did not start.");
  })();

  ready.catch(() => {});
  return ready;
}

function createWindow() {
  new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  }).loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(async () => {
  await startBackend();
  await syncRuntimeConfig(config);
  registerConfigIpc();
  registerAgentIpc({ api });
  createWindow();
});
app.on("before-quit", () => python?.kill());
app.on("window-all-closed", () => app.quit());
