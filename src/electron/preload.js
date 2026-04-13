const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentAPI", {
  health: () => ipcRenderer.invoke("agent:health"),
  runPrompt: (message) => ipcRenderer.invoke("agent:run", message),
});
