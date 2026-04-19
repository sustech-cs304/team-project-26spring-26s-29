const fs = require("node:fs");
const path = require("node:path");

const { resolveDefaultWorkspacePath } = require("./workspace");

const LOCAL_BACKEND_HOST = "127.0.0.1";

const DEFAULTS = {
  backendPort: 8765,
  openaiApiKey: null,
  openaiChatModel: null,
  openaiEndpoint: null,
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

  function normalizeConfig(raw = {}) {
    const port = Number.parseInt(String(raw.backendPort ?? DEFAULTS.backendPort), 10);

    return {
      backendPort: Number.isInteger(port) ? port : DEFAULTS.backendPort,
      openaiApiKey: normalizeOptionalString(raw.openaiApiKey),
      openaiChatModel: normalizeOptionalString(raw.openaiChatModel),
      openaiEndpoint: normalizeOptionalString(raw.openaiEndpoint),
    };
  }

  function persist(config) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return config;
  }

  function getRuntimeConfig(config) {
    return {
      dbPath: path.resolve(path.dirname(configPath), "db.json"),
      openaiApiKey: config.openaiApiKey,
      openaiChatModel: config.openaiChatModel,
      openaiEndpoint: config.openaiEndpoint,
      workspacePath: resolveDefaultWorkspacePath({ configPath }),
    };
  }

  async function syncRuntimeConfig(config) {
    const api = `http://${LOCAL_BACKEND_HOST}:${config.backendPort}`;
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
