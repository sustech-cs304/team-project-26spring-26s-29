const fs = require("node:fs");
const path = require("node:path");

const { normalizeWorkspacePath } = require("./workspace");

const DEFAULTS = {
  backendHost: "127.0.0.1",
  backendPort: 8765,
  dbPath: null,
  openaiApiKey: null,
  openaiChatModel: null,
  openaiEndpoint: null,
  workspacePath: null,
  mimoWebSearchEnabled: false,
};

function createConfigStore({
  configPath = path.resolve(__dirname, "..", "..", "config.json"),
  appPath = path.resolve(__dirname, "..", ".."),
} = {}) {
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

  function normalizeBoolean(value, defaultValue = false) {
    if (typeof value === "boolean") {
      return value;
    }

    if (value == null) {
      return defaultValue;
    }

    const text = String(value).trim().toLowerCase();
    if (!text) {
      return defaultValue;
    }

    if (["true", "1", "yes", "on"].includes(text)) {
      return true;
    }

    if (["false", "0", "no", "off"].includes(text)) {
      return false;
    }

    return defaultValue;
  }

  function normalizeConfig(raw = {}) {
    const port = Number.parseInt(String(raw.backendPort ?? DEFAULTS.backendPort), 10);

    return {
      backendHost: normalizeOptionalString(raw.backendHost) || DEFAULTS.backendHost,
      backendPort: Number.isInteger(port) ? port : DEFAULTS.backendPort,
      dbPath: normalizeOptionalString(raw.dbPath),
      openaiApiKey: normalizeOptionalString(raw.openaiApiKey),
      openaiChatModel: normalizeOptionalString(raw.openaiChatModel),
      openaiEndpoint: normalizeOptionalString(raw.openaiEndpoint),
      workspacePath: normalizeWorkspacePath(raw.workspacePath ?? DEFAULTS.workspacePath, { configPath }),
      mimoWebSearchEnabled: normalizeBoolean(raw.mimoWebSearchEnabled, DEFAULTS.mimoWebSearchEnabled),
    };
  }

  function persist(config) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return config;
  }

  function getRuntimeConfig(config) {
    return {
      dbPath: config.dbPath,
      openaiApiKey: config.openaiApiKey,
      openaiChatModel: config.openaiChatModel,
      openaiEndpoint: config.openaiEndpoint,
      workspacePath: config.workspacePath,
      mimoWebSearchEnabled: config.mimoWebSearchEnabled,
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

  function read() {
    if (!fs.existsSync(configPath)) {
      return persist(normalizeConfig(DEFAULTS));
    }

    const raw = parseConfigFile();
    const config = normalizeConfig(raw);
    if (JSON.stringify(raw) !== JSON.stringify(config)) {
      persist(config);
    }

    return config;
  }

  return {
    appPath,
    configPath,
    defaults: { ...DEFAULTS },
    getRuntimeConfig,
    normalizeConfig,
    persist,
    read,
    syncRuntimeConfig,
  };
}

module.exports = { createConfigStore };
