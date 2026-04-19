const { ipcMain } = require("electron");

const { requestJson } = require("./http");

function registerScheduleIpc({ getApi }) {
  ipcMain.handle("schedule:list", async () => requestJson(getApi(), "/api/schedules"));

  ipcMain.handle("schedule:list-range", async (_event, start, end) => {
    return requestJson(getApi(), `/api/schedules/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  });

  ipcMain.handle("schedule:get", async (_event, id) => {
    return requestJson(getApi(), `/api/schedules/${id}`);
  });

  ipcMain.handle("schedule:create", async (_event, payload) => {
    return requestJson(getApi(), "/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  ipcMain.handle("schedule:update", async (_event, payload) => {
    const { id, ...updates } = payload;

    return requestJson(getApi(), `/api/schedules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  });

  ipcMain.handle("schedule:delete", async (_event, scheduleId) => {
    return requestJson(getApi(), `/api/schedules/${scheduleId}`, {
      method: "DELETE",
    });
  });

  ipcMain.handle("schedule:clear", async (_event, scope) => {
    return requestJson(getApi(), `/api/schedules?scope=${encodeURIComponent(scope)}`, {
      method: "DELETE",
    });
  });
}

module.exports = { registerScheduleIpc };
