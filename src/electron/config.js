const fs = require("node:fs");
const path = require("node:path");
const { ipcMain } = require("electron");

const configPath = path.resolve(__dirname, "..", "..", "config.json");
const defaults = {
  backendHost: "127.0.0.1",
  backendPort: 8765,
  openaiApiKey: null,
  openaiChatModel: null,
  openaiEndpoint: null,
};
const runtimeConfigKeys = ["openaiApiKey", "openaiChatModel", "openaiEndpoint"];

function parseConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid config.json: ${error.message}`);
  }
}

function normalizeOptionalString(value) {
  if (value == null) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function normalizeConfig(raw = {}) {
  const port = Number.parseInt(String(raw.backendPort ?? defaults.backendPort), 10);

  return {
    backendHost: normalizeOptionalString(raw.backendHost) || defaults.backendHost,
    backendPort: Number.isInteger(port) ? port : defaults.backendPort,
    openaiApiKey: normalizeOptionalString(raw.openaiApiKey),
    openaiChatModel: normalizeOptionalString(raw.openaiChatModel),
    openaiEndpoint: normalizeOptionalString(raw.openaiEndpoint),
  };
}

function persistConfig(config) {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

function getRuntimeConfig(config) {
  return {
    openaiApiKey: config.openaiApiKey,
    openaiChatModel: config.openaiChatModel,
    openaiEndpoint: config.openaiEndpoint,
  };
}

async function syncRuntimeConfig(config) {
  const api = `http://${config.backendHost}:${config.backendPort}`;
  const response = await fetch(`${api}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getRuntimeConfig(config)),
  });

  if (!response.ok) {
    throw new Error(`Failed to sync Python config: ${await response.text()}`);
  }
}

async function writeConfig(nextConfig) {
  const current = fs.existsSync(configPath) ? parseConfigFile() : defaults;
  const config = normalizeConfig({ ...current, ...nextConfig });

  persistConfig(config);
  await syncRuntimeConfig(config);
  return config;
}

function readConfig() {
  if (!fs.existsSync(configPath)) {
    return persistConfig(normalizeConfig(defaults));
  }

  const raw = parseConfigFile();
  const config = normalizeConfig(raw);
  if (JSON.stringify(raw) !== JSON.stringify(config)) {
    persistConfig(config);
  }

  return config;
}

function registerConfigIpc() {
  ipcMain.handle("config:get", async () => readConfig());

  ipcMain.handle("config:update", async (_event, key, value) => {
    if (!runtimeConfigKeys.includes(key)) {
      throw new Error(`Unsupported config key: ${key}`);
    }

    const config = await writeConfig({ [key]: value });
    return { key, value: config[key] };
  });
}

module.exports = {
  configPath,
  getRuntimeConfig,
  readConfig,
  registerConfigIpc,
  syncRuntimeConfig,
  writeConfig,
};
