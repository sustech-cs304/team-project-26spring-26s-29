const { spawn } = require("node:child_process");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const {
  normalizeConfig,
  persistConfig,
  readConfig,
  registerConfigIpc,
  syncRuntimeConfig,
} = require("./config");
const { registerAgentIpc, registerTodoIpc, registerScheduleIpc } = require("./ipc");

let config = readConfig();
let python;
let ready;

function getApi(targetConfig = config) {
  return `http://${targetConfig.backendHost}:${targetConfig.backendPort}`;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function spawnBackend(targetConfig) {
  const child = spawn("python", [
    "-m",
    "uvicorn",
    "backend.app:app",
    "--host",
    targetConfig.backendHost,
    "--port",
    String(targetConfig.backendPort),
  ], {
    cwd: app.getAppPath(),
    env: process.env,
    stdio: "inherit",
  });

  child.on("exit", () => {
    if (python === child) {
      python = null;
      ready = null;
    }
  });

  return child;
}

async function waitForBackend(targetConfig, child) {
  const api = getApi(targetConfig);

  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${api}/health`)).ok) {
        return;
      }
    } catch { }

    if (child.exitCode !== null) {
      break;
    }

    await wait(250);
  }

  throw new Error("Backend did not start.");
}

function startBackend() {
  if (python) {
    return ready;
  }

  python = spawnBackend(config);
  ready = waitForBackend(config, python);
  ready.catch(() => { });
  return ready;
}

async function stopBackend() {
  if (!python) {
    return;
  }

  const child = python;
  if (child.exitCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    let settled = false;

    function finish() {
      if (settled) {
        return;
      }

      settled = true;
      child.removeListener("exit", finish);
      resolve();
    }

    child.once("exit", finish);

    try {
      child.kill();
    } catch {
      finish();
      return;
    }

    if (child.exitCode !== null) {
      finish();
    }
  });
}

async function applyConfig(nextConfig, previousConfig = config) {
  const shouldRestart =
    !python ||
    previousConfig.backendHost !== nextConfig.backendHost ||
    previousConfig.backendPort !== nextConfig.backendPort;

  config = nextConfig;

  if (shouldRestart) {
    await stopBackend();
  }

  await startBackend();
  await syncRuntimeConfig(config);
  return config;
}

async function saveConfig(payload) {
  const previousConfig = config;
  const nextConfig = normalizeConfig({ ...readConfig(), ...payload });

  persistConfig(nextConfig);

  try {
    await applyConfig(nextConfig, previousConfig);
    return nextConfig;
  } catch (error) {
    persistConfig(previousConfig);
    config = previousConfig;

    try {
      await applyConfig(previousConfig, nextConfig);
    } catch { }

    throw error;
  }
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
  registerConfigIpc({ onSave: saveConfig });
  registerAgentIpc({ getApi });
  registerTodoIpc({ getApi });
  registerScheduleIpc({ getApi });
  createWindow();
});
app.on("before-quit", () => python?.kill());
app.on("window-all-closed", () => app.quit());
