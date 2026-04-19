const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { createBackendProcessController } = require("./backend-process");
const { createConfigStore } = require("./config-store");
const { registerAgentIpc } = require("./ipc/agent");
const { registerConfigIpc } = require("./ipc/config");
const { registerTodoIpc } = require("./ipc/todo");
const { assertSafeWorkspacePath, resetWorkspace } = require("./workspace");

let configStore = null;
let backendProcess = null;
let config = null;

function getApi(targetConfig = config) {
  return backendProcess.getApi(targetConfig);
}

async function applyConfig(nextConfig, previousConfig = config) {
  config = nextConfig;
  await prepareWorkspace(nextConfig);
  await backendProcess.applyConfig({
    nextConfig,
    previousConfig,
    syncRuntimeConfig: configStore.syncRuntimeConfig,
  });
  return config;
}

async function prepareWorkspace(targetConfig) {
  const protectedPaths = [
    configStore.configPath,
    path.dirname(configStore.configPath),
    configStore.appPath,
    process.env.USERPROFILE,
  ].filter(Boolean);

  assertSafeWorkspacePath(targetConfig.workspacePath, { protectedPaths });
  await resetWorkspace(targetConfig.workspacePath);
}

async function saveConfig(payload) {
  const previousConfig = config;
  const nextConfig = configStore.normalizeConfig({ ...configStore.read(), ...payload });

  configStore.persist(nextConfig);

  try {
    await applyConfig(nextConfig, previousConfig);
    return nextConfig;
  } catch (error) {
    configStore.persist(previousConfig);
    config = previousConfig;

    try {
      await applyConfig(previousConfig, nextConfig);
    } catch { }

    throw error;
  }
}

function isZoomInShortcut(input) {
  if (!input.control && !input.meta) {
    return false;
  }

  return (
    input.code === "Equal" ||
    input.key === "=" ||
    input.key === "+" ||
    input.code === "NumpadAdd"
  );
}

function isZoomOutShortcut(input) {
  if (!input.control && !input.meta) {
    return false;
  }

  return input.code === "Minus" || input.key === "-";
}

function isResetZoomShortcut(input) {
  if (!input.control && !input.meta) {
    return false;
  }

  return input.code === "Digit0" || input.key === "0";
}

function adjustZoom(webContents, delta) {
  const nextFactor = Math.min(3, Math.max(0.5, webContents.getZoomFactor() + delta));
  webContents.setZoomFactor(nextFactor);
}

function createWindow() {
  const window = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  window.webContents.on("before-input-event", (event, input) => {
    if (isZoomInShortcut(input)) {
      event.preventDefault();
      adjustZoom(window.webContents, 0.1);
      return;
    }

    if (isZoomOutShortcut(input)) {
      event.preventDefault();
      adjustZoom(window.webContents, -0.1);
      return;
    }

    if (isResetZoomShortcut(input)) {
      event.preventDefault();
      window.webContents.setZoomFactor(1);
    }
  });

  window.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(async () => {
  const configPath = app.isPackaged
    ? path.join(process.env.LOCALAPPDATA || app.getPath("userData"), app.getName(), "config.json")
    : path.join(app.getAppPath(), "config.json");

  configStore = createConfigStore({
    appPath: app.getAppPath(),
    configPath,
  });
  config = configStore.read();
  backendProcess = createBackendProcessController({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });

  await prepareWorkspace(config);
  await backendProcess.start(config);
  await configStore.syncRuntimeConfig(config);

  registerConfigIpc({ configStore, onSave: saveConfig });
  registerAgentIpc({
    getApi,
    getConfig: () => config,
  });
  registerTodoIpc({ getApi });
  createWindow();
});
app.on("before-quit", () => backendProcess?.shutdown());
app.on("window-all-closed", () => app.quit());
