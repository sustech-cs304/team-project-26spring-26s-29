const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentAPI", {
  health: () => ipcRenderer.invoke("agent:health"),
  runPrompt: (message) => ipcRenderer.invoke("agent:run", message),
});

contextBridge.exposeInMainWorld("configAPI", {
  get: () => ipcRenderer.invoke("config:get"),
  update: (key, value) => ipcRenderer.invoke("config:update", key, value),
});
