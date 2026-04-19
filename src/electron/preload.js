const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentAPI", {
  health: () => ipcRenderer.invoke("agent:health"),
  pickAttachments: (payload) => ipcRenderer.invoke("agent:pick-attachments", payload),
  runPrompt: (payload) => ipcRenderer.invoke("agent:run", payload),
  respondApproval: (payload) => ipcRenderer.invoke("agent:approval", payload),
  saveOutputPart: (part) => ipcRenderer.invoke("agent:save-output-part", part),
  loadPreview: (payload) => ipcRenderer.invoke("agent:load-preview", payload),
  onStreamEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:stream:event", listener);
    return () => ipcRenderer.removeListener("agent:stream:event", listener);
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
