const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")
);

test("electron-builder only packages runtime files into app.asar", () => {
  const files = packageJson.build.files;

  assert.ok(Array.isArray(files));
  assert.ok(files.includes("src/**/*"));
  assert.ok(files.includes("package.json"));
  assert.ok(!files.includes("backend/**/*"));
  assert.ok(!files.includes("docs/**/*"));
});

test("package scripts build SUSTech manual corpus before Windows packaging", () => {
  const scripts = packageJson.scripts;

  assert.equal(scripts["build:sustech-manual"], "python tools/build_sustech_manual_corpus.py");
  assert.equal(
    scripts["validate:sustech-manual"],
    "python tools/build_sustech_manual_corpus.py --validate-only"
  );
  assert.ok(scripts["package:win"].startsWith("npm run build:sustech-manual && "));
});

test("electron-builder filters out Python cache files from extra resources", () => {
  const extraResources = packageJson.build.extraResources;
  const backendResource = extraResources.find((entry) => entry.to === "backend");
  const pythonResource = extraResources.find((entry) => entry.to === "python");

  assert.ok(backendResource);
  assert.ok(pythonResource);
  assert.ok(backendResource.filter.includes("!**/__pycache__/**"));
  assert.ok(backendResource.filter.includes("!**/*.pyc"));
  assert.ok(pythonResource.filter.includes("!**/__pycache__/**"));
  assert.ok(pythonResource.filter.includes("!**/*.pyc"));
  assert.ok(pythonResource.filter.includes("!**/tests/**"));
});

test("electron-builder packages generated SUSTech corpus but not the full submodule docs", () => {
  const extraResources = packageJson.build.extraResources;
  const backendResource = extraResources.find((entry) => entry.to === "backend");

  assert.ok(backendResource.filter.includes("**/*"));
  assert.ok(!extraResources.some((entry) => String(entry.from).includes("vendor/sustech-online-ng")));
});
