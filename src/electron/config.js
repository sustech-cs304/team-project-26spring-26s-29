const fs = require("node:fs");
const path = require("node:path");
const { ipcMain } = require("electron");

const configPath = path.resolve(__dirname, "..", "..", "config.json");
const defaults = {
  backendHost: "127.0.0.1",
  backendPort: 8765,
  dbPath: null,
  openaiApiKey: null,
  openaiChatModel: null,
  openaiEndpoint: null,
};
const configKeys = Object.keys(defaults);

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
    dbPath: normalizeOptionalString(raw.dbPath),
    openaiApiKey: normalizeOptionalString(raw.openaiApiKey),
    openaiChatModel: normalizeOptionalString(raw.openaiChatModel),
    openaiEndpoint: normalizeOptionalString(raw.openaiEndpoint),
  };
}

function persistConfig(config) {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

function validateConfigPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Config payload must be an object.");
  }

  const unsupportedKeys = Object.keys(payload).filter((key) => !configKeys.includes(key));
  if (unsupportedKeys.length) {
    throw new Error(`Unsupported config keys: ${unsupportedKeys.join(", ")}`);
  }

  return payload;
}

function getRuntimeConfig(config) {
  return {
    dbPath: config.dbPath,
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

function registerConfigIpc({ onSave }) {
  ipcMain.handle("config:get", async () => readConfig());

  ipcMain.handle("config:save", async (_event, payload) => onSave(validateConfigPayload(payload)));
}

module.exports = {
  configKeys,
  configPath,
  defaults,
  getRuntimeConfig,
  normalizeConfig,
  persistConfig,
  readConfig,
  registerConfigIpc,
  syncRuntimeConfig,
};
