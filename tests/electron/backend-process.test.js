const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { createBackendSpawnOptions } = require("../../src/electron/backend-process");

test("packaged backend launch hides the Windows console window", () => {
  const options = createBackendSpawnOptions({
    env: { PATH: "C:\\Windows\\System32", PYTHONPATH: "existing-path" },
    isPackaged: true,
    pythonPathSegments: ["C:\\app\\resources", "existing-path"],
    workingDirectory: "C:\\app\\resources",
  });

  assert.equal(options.cwd, "C:\\app\\resources");
  assert.equal(options.stdio, "ignore");
  assert.equal(options.windowsHide, true);
  assert.equal(
    options.env.PYTHONPATH,
    ["C:\\app\\resources", "existing-path"].join(path.delimiter)
  );
});

test("development backend launch keeps inherited stdio for local debugging", () => {
  const options = createBackendSpawnOptions({
    env: { PATH: "C:\\Windows\\System32" },
    isPackaged: false,
    pythonPathSegments: ["C:\\repo"],
    workingDirectory: "C:\\repo",
  });

  assert.equal(options.stdio, "inherit");
  assert.equal(options.windowsHide, false);
});
