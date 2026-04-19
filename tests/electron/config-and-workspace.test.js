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

test("config store normalizes workspace defaults", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "config-store-"));
  const configPath = path.join(tempRoot, "config.json");
  const configStore = createConfigStore({
    configPath,
    appPath: tempRoot,
  });

  const normalized = configStore.normalizeConfig({
    backendPort: "9000",
    legacySearchToggle: "true",
    workspacePath: "",
  });

  assert.equal(normalized.backendPort, 9000);
  assert.equal("legacySearchToggle" in normalized, false);
  assert.equal(normalized.workspacePath, resolveDefaultWorkspacePath({ configPath }));
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
