const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createConfigStore } = require("../../src/electron/config-store");
const {
  assertSafeWorkspacePath,
  resetWorkspace,
  resolveDefaultWorkspacePath,
} = require("../../src/electron/workspace");

test("config store strips removed config fields and keeps supported values", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "config-store-"));
  const configPath = path.join(tempRoot, "config.json");
  const configStore = createConfigStore({
    configPath,
    appPath: tempRoot,
  });

  const normalized = configStore.normalizeConfig({
    backendHost: "0.0.0.0",
    backendPort: "9000",
    dbPath: "custom-db.json",
    legacySearchToggle: "true",
    workspacePath: "custom-workspace",
  });

  assert.equal(normalized.backendPort, 9000);
  assert.equal(normalized.motdLanguage, "zh-CN");
  assert.equal("backendHost" in normalized, false);
  assert.equal("dbPath" in normalized, false);
  assert.equal("legacySearchToggle" in normalized, false);
  assert.equal("workspacePath" in normalized, false);
});

test("config store derives runtime db and workspace paths beside config.json", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "config-store-runtime-"));
  const configPath = path.join(tempRoot, "config.json");
  const configStore = createConfigStore({
    configPath,
    appPath: tempRoot,
  });

  const normalized = configStore.normalizeConfig({});
  const runtimeConfig = configStore.getRuntimeConfig(normalized);

  assert.equal(runtimeConfig.dbPath, path.join(tempRoot, "db.json"));
  assert.equal(runtimeConfig.motdLanguage, "zh-CN");
  assert.equal(runtimeConfig.workspacePath, path.join(tempRoot, "workspace"));
});

test("config store read rewrites legacy config.json keys", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "config-store-legacy-"));
  const configPath = path.join(tempRoot, "config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      backendHost: "0.0.0.0",
      backendPort: 9001,
      dbPath: "legacy-db.json",
      openaiApiKey: "demo-key",
      workspacePath: "legacy-workspace",
    }),
  );
  const configStore = createConfigStore({
    configPath,
    appPath: tempRoot,
  });

  const config = configStore.read();
  const saved = JSON.parse(await fs.readFile(configPath, "utf8"));

  assert.deepEqual(config, {
    backendPort: 9001,
    openaiApiKey: "demo-key",
    openaiChatModel: null,
    openaiEndpoint: null,
    motdLanguage: "zh-CN",
  });
  assert.deepEqual(saved, config);
});

test("resolveDefaultWorkspacePath resolves the default workspace next to config.json", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-default-"));
  const configPath = path.join(tempRoot, "config.json");

  assert.equal(
    resolveDefaultWorkspacePath({ configPath }),
    path.join(tempRoot, "workspace")
  );
});

test("resetWorkspace clears existing contents and recreates inputs plus outputs", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-reset-"));
  const workspacePath = path.join(tempRoot, "workspace");
  await fs.mkdir(path.join(workspacePath, "nested"), { recursive: true });
  await fs.writeFile(path.join(workspacePath, "nested", "old.txt"), "obsolete");

  await resetWorkspace(workspacePath);

  const entries = await fs.readdir(workspacePath);
  assert.deepEqual(entries.sort(), ["inputs", "outputs"]);
});

test("assertSafeWorkspacePath rejects protected ancestors", () => {
  const workspacePath = path.join("C:\\", "Users", "me", "project");
  assert.throws(
    () => assertSafeWorkspacePath(workspacePath, { protectedPaths: [workspacePath] }),
    /protected path/i
  );
});
