const fs = require("node:fs");
const path = require("node:path");

const configPath = path.resolve(__dirname, "..", "..", "config.json");
const defaults = {
  backendHost: "127.0.0.1",
  backendPort: 8765,
  openaiApiKey: "",
  openaiChatModel: "gpt-4o-mini",
};

function parseConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid config.json: ${error.message}`);
  }
}

function normalizeConfig(raw = {}) {
  const port = Number.parseInt(String(raw.backendPort ?? defaults.backendPort), 10);

  return {
    backendHost: String(raw.backendHost || defaults.backendHost),
    backendPort: Number.isInteger(port) ? port : defaults.backendPort,
    openaiApiKey: String(raw.openaiApiKey || defaults.openaiApiKey),
    openaiChatModel: String(raw.openaiChatModel || defaults.openaiChatModel),
  };
}

function writeConfig(nextConfig) {
  const current = fs.existsSync(configPath) ? parseConfigFile() : defaults;
  const config = normalizeConfig({ ...current, ...nextConfig });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

function readConfig() {
  if (!fs.existsSync(configPath)) {
    return writeConfig(defaults);
  }

  const raw = parseConfigFile();
  const config = normalizeConfig(raw);
  if (JSON.stringify(raw) !== JSON.stringify(config)) {
    writeConfig(config);
  }

  return config;
}

module.exports = { configPath, readConfig, writeConfig };
