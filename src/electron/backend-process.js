const { spawn } = require("node:child_process");

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function createBackendProcessController({ appPath }) {
  let python = null;
  let ready = null;

  function getApi(targetConfig) {
    return `http://${targetConfig.backendHost}:${targetConfig.backendPort}`;
  }

  function spawnBackend(targetConfig) {
    const child = spawn("python", [
      "-m",
      "uvicorn",
      "backend.app:app",
      "--host",
      targetConfig.backendHost,
      "--port",
      String(targetConfig.backendPort),
    ], {
      cwd: appPath,
      env: process.env,
      stdio: "inherit",
    });

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
      previousConfig.backendHost !== nextConfig.backendHost ||
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

module.exports = { createBackendProcessController };
