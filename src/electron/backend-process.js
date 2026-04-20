const { spawn } = require("node:child_process");
const path = require("node:path");

const { resolveBackendWorkingDirectory, resolvePythonExecutable } = require("./python-runtime");

const LOCAL_BACKEND_HOST = "127.0.0.1";

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function createBackendSpawnOptions({
  isPackaged = false,
  workingDirectory,
  pythonPathSegments,
  env = process.env,
}) {
  return {
    cwd: workingDirectory,
    env: {
      ...env,
      PYTHONPATH: pythonPathSegments.join(path.delimiter),
    },
    stdio: isPackaged ? "ignore" : "inherit",
    // Prevent the bundled python.exe from creating a console window for end users.
    windowsHide: isPackaged,
  };
}

function createBackendProcessController({ appPath, isPackaged = false, resourcesPath = process.resourcesPath }) {
  let python = null;
  let ready = null;

  function getApi(targetConfig) {
    return `http://${LOCAL_BACKEND_HOST}:${targetConfig.backendPort}`;
  }

  function spawnBackend(targetConfig) {
    const workingDirectory = resolveBackendWorkingDirectory({ appPath, isPackaged, resourcesPath });
    const pythonExecutable = resolvePythonExecutable({ isPackaged, resourcesPath });
    const pythonPathSegments = [workingDirectory, process.env.PYTHONPATH].filter(Boolean);

    const child = spawn(pythonExecutable, [
      "-m",
      "uvicorn",
      "backend.app:app",
      "--host",
      LOCAL_BACKEND_HOST,
      "--port",
      String(targetConfig.backendPort),
    ], createBackendSpawnOptions({
      env: process.env,
      isPackaged,
      pythonPathSegments,
      workingDirectory,
    }));

    child.on("exit", () => {
      if (python === child) {
        python = null;
        ready = null;
      }
    });

    return child;
  }

  async function waitForBackend(targetConfig, child) {
    const api = getApi(targetConfig);

    for (let i = 0; i < 60; i += 1) {
      try {
        if ((await fetch(`${api}/health`)).ok) {
          return;
        }
      } catch { }

      if (child.exitCode !== null) {
        break;
      }

      await wait(250);
    }

    throw new Error("Backend did not start.");
  }

  function start(targetConfig) {
    if (python) {
      return ready;
    }

    python = spawnBackend(targetConfig);
    ready = waitForBackend(targetConfig, python);
    ready.catch(() => { });
    return ready;
  }

  async function stop() {
    if (!python) {
      return;
    }

    const child = python;
    if (child.exitCode !== null) {
      return;
    }

    await new Promise((resolve) => {
      let settled = false;

      function finish() {
        if (settled) {
          return;
        }

        settled = true;
        child.removeListener("exit", finish);
        resolve();
      }

      child.once("exit", finish);

      try {
        child.kill();
      } catch {
        finish();
        return;
      }

      if (child.exitCode !== null) {
        finish();
      }
    });
  }

  async function applyConfig({ nextConfig, previousConfig, syncRuntimeConfig }) {
    const shouldRestart =
      !python ||
      previousConfig.backendPort !== nextConfig.backendPort;

    if (shouldRestart) {
      await stop();
    }

    await start(nextConfig);
    await syncRuntimeConfig(nextConfig);
  }

  function shutdown() {
    try {
      python?.kill();
    } catch { }
  }

  return {
    applyConfig,
    getApi,
    shutdown,
    start,
    stop,
  };
}

module.exports = {
  createBackendProcessController,
  createBackendSpawnOptions,
};
