const path = require("node:path");

const APP_STORAGE_DIR_NAME = "kao-hsiao";

function resolvePackagedStorageRoot({ localAppDataPath, appDataPath }) {
  const basePath = localAppDataPath || appDataPath;
  if (!basePath) {
    throw new Error("Could not resolve a base directory for packaged app storage.");
  }

  return path.join(basePath, APP_STORAGE_DIR_NAME);
}

function resolveConfigPath({ isPackaged, appPath, userDataPath }) {
  return isPackaged
    ? path.join(userDataPath, "config.json")
    : path.join(appPath, "config.json");
}

module.exports = {
  APP_STORAGE_DIR_NAME,
  resolveConfigPath,
  resolvePackagedStorageRoot,
};
