const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentAPI", {
  health: () => ipcRenderer.invoke("agent:health"),
  runPrompt: (message, requestId) => ipcRenderer.invoke("agent:run", { message, requestId }),
  onStreamChunk: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:stream:chunk", listener);
    return () => ipcRenderer.removeListener("agent:stream:chunk", listener);
  },
});

contextBridge.exposeInMainWorld("configAPI", {
  get: () => ipcRenderer.invoke("config:get"),
  update: (key, value) => ipcRenderer.invoke("config:update", key, value),
});
