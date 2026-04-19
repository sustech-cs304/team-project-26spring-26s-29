const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  APP_STORAGE_DIR_NAME,
  resolveConfigPath,
  resolvePackagedStorageRoot,
} = require("../../src/electron/app-paths");

test("resolvePackagedStorageRoot uses the kao-hsiao directory name", () => {
  assert.equal(
    resolvePackagedStorageRoot({
      localAppDataPath: path.join("C:\\", "Users", "me", "AppData", "Local"),
      appDataPath: path.join("C:\\", "Users", "me", "AppData", "Roaming"),
    }),
    path.join("C:\\", "Users", "me", "AppData", "Local", APP_STORAGE_DIR_NAME)
  );
});

test("resolvePackagedStorageRoot falls back to appData when LOCALAPPDATA is unavailable", () => {
  assert.equal(
    resolvePackagedStorageRoot({
      localAppDataPath: "",
      appDataPath: path.join("C:\\", "Users", "me", "AppData", "Roaming"),
    }),
    path.join("C:\\", "Users", "me", "AppData", "Roaming", APP_STORAGE_DIR_NAME)
  );
});

test("resolveConfigPath uses userDataPath in packaged mode", () => {
  assert.equal(
    resolveConfigPath({
      isPackaged: true,
      appPath: path.join("C:\\", "repo"),
      userDataPath: path.join("C:\\", "Users", "me", "AppData", "Local", APP_STORAGE_DIR_NAME),
    }),
    path.join("C:\\", "Users", "me", "AppData", "Local", APP_STORAGE_DIR_NAME, "config.json")
  );
});

test("resolveConfigPath uses the app root in development mode", () => {
  assert.equal(
    resolveConfigPath({
      isPackaged: false,
      appPath: path.join("C:\\", "repo"),
      userDataPath: path.join("C:\\", "ignored"),
    }),
    path.join("C:\\", "repo", "config.json")
  );
});
