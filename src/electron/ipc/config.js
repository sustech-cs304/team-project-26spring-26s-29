const { ipcMain } = require("electron");

function registerConfigIpc({ configStore, onSave }) {
  ipcMain.handle("config:get", async () => configStore.read());

  ipcMain.handle("config:save", async (_event, payload) => onSave(payload));
}

module.exports = { registerConfigIpc };
