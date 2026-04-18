const { ipcMain } = require("electron");

const { requestJson } = require("./http");

function registerTodoIpc({ getApi }) {
  ipcMain.handle("todo:list", async () => requestJson(getApi(), "/api/todos"));

  ipcMain.handle("todo:create", async (_event, payload) => {
    return requestJson(getApi(), "/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  ipcMain.handle("todo:update", async (_event, payload) => {
    const { id, ...updates } = payload;

    return requestJson(getApi(), `/api/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  });

  ipcMain.handle("todo:delete", async (_event, todoId) => {
    return requestJson(getApi(), `/api/todos/${todoId}`, {
      method: "DELETE",
    });
  });

  ipcMain.handle("todo:clear", async (_event, scope) => {
    return requestJson(getApi(), `/api/todos?scope=${encodeURIComponent(scope)}`, {
      method: "DELETE",
    });
  });
}

module.exports = { registerTodoIpc };
