const fs = require("node:fs");
const path = require("node:path");

function resolvePythonExecutable({ isPackaged, resourcesPath }) {
  if (!isPackaged) {
    const projectRoot = path.resolve(__dirname, "..", "..");
    const candidates = [
      path.join(projectRoot, ".venv", "Scripts", "python.exe"),
      path.join(projectRoot, ".venv", "bin", "python"),
      process.env.PYTHON,
      "python",
    ].filter(Boolean);

    const resolved = candidates.find((candidate) => fs.existsSync(candidate));
    return resolved || "python";
  }

  const candidates = [
    path.join(resourcesPath, "python", "python.exe"),
    path.join(resourcesPath, "backend-python", "python.exe"),
  ];

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error("Bundled Python runtime was not found in the packaged app resources.");
  }

  return resolved;
}

function resolveBackendWorkingDirectory({ appPath, isPackaged, resourcesPath }) {
  return isPackaged ? resourcesPath : appPath;
}

module.exports = {
  resolveBackendWorkingDirectory,
  resolvePythonExecutable,
};
