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
  save: (config) => ipcRenderer.invoke("config:save", config),
});

contextBridge.exposeInMainWorld("todoAPI", {
  list: () => ipcRenderer.invoke("todo:list"),
  create: (todo) => ipcRenderer.invoke("todo:create", todo),
  update: (id, updates) => ipcRenderer.invoke("todo:update", { id, ...updates }),
  remove: (id) => ipcRenderer.invoke("todo:delete", id),
  clear: (scope) => ipcRenderer.invoke("todo:clear", scope),
});
