const { randomUUID } = require("node:crypto");
const { ipcMain } = require("electron");

const TODO_ERROR_PREFIX = "TODO_ERROR|";

function createTodoError(category, detail) {
  const defaultMsg = "Todo request failed.";
  let normalizedDetail;
  if (detail === undefined || detail === null) {
    normalizedDetail = defaultMsg;
  } else if (typeof detail === "string") {
    normalizedDetail = detail.trim() || defaultMsg;
  } else {
    try {
      normalizedDetail = JSON.stringify(detail);
    } catch {
      normalizedDetail = String(detail).trim() || defaultMsg;
    }
  }
  return new Error(`${TODO_ERROR_PREFIX}${category}|${normalizedDetail}`);
}

const SCHEDULE_ERROR_PREFIX = "SCHEDULE_ERROR|";

function createScheduleError(category, detail) {
  const defaultMsg = "Schedule request failed.";
  let normalizedDetail;
  if (detail === undefined || detail === null) {
    normalizedDetail = defaultMsg;
  } else if (typeof detail === "string") {
    normalizedDetail = detail.trim() || defaultMsg;
  } else {
    try {
      normalizedDetail = JSON.stringify(detail);
    } catch {
      normalizedDetail = String(detail).trim() || defaultMsg;
    }
  }
  return new Error(`${SCHEDULE_ERROR_PREFIX}${category}|${normalizedDetail}`);
}

async function ping(api) {
  try {
    return (await fetch(`${api}/health`)).ok;
  } catch {
    return false;
  }
}

async function requestJson(api, path, options = {}) {
  let response;
  try {
    response = await fetch(`${api}${path}`, options);
  } catch {
    throw createTodoError("network", "Cannot reach backend service.");
  }

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const detail = payload?.detail || text || `Backend request failed with status ${response.status}.`;
    if (response.status === 404) {
      throw createTodoError("not-found", detail);
    }
    if (response.status === 400 || response.status === 422) {
      throw createTodoError("validation", detail);
    }
    throw createTodoError("server", detail);
  }

  return payload;
}

function registerTodoIpc({ getApi }) {
  ipcMain.handle("todo:list", async () => requestJson(getApi(), "/api/todos"));

  ipcMain.handle("todo:create", async (_event, payload) => {
    const body = {
      title: payload?.title,
      detail: payload?.detail ?? "",
      dueAt: payload?.dueAt ?? null,
    };

    return requestJson(getApi(), "/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  ipcMain.handle("todo:update", async (_event, payload) => {
    const todoId = Number(payload?.id);
    if (!Number.isInteger(todoId)) {
      throw new Error("Todo id is required.");
    }

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(payload, "title")) {
      updates.title = payload.title;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "detail")) {
      updates.detail = payload.detail;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "dueAt")) {
      updates.dueAt = payload.dueAt;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "isDone")) {
      updates.isDone = payload.isDone;
    }

    return requestJson(getApi(), `/api/todos/${todoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  });

  ipcMain.handle("todo:delete", async (_event, todoIdPayload) => {
    const todoId = Number(todoIdPayload);
    if (!Number.isInteger(todoId)) {
      throw new Error("Todo id is required.");
    }

    return requestJson(getApi(), `/api/todos/${todoId}`, {
      method: "DELETE",
    });
  });

  ipcMain.handle("todo:clear", async (_event, scopePayload) => {
    const scope = scopePayload === "completed" ? "completed" : "all";
    return requestJson(getApi(), `/api/todos?scope=${encodeURIComponent(scope)}`, {
      method: "DELETE",
    });
  });
}


function registerScheduleIpc({ getApi }) {
  ipcMain.handle("schedule:list", async () => requestJson(getApi(), "/api/schedules"));

  ipcMain.handle("schedule:listRange", async (_event, payload) => {
    const start = payload?.start;
    const end = payload?.end;
    if (!start || !end) {
      throw new Error("range start and end are required.");
    }

    const path = `/api/schedules/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    try {
      return await requestJson(getApi(), path);
    } catch (error) {
        const msg = error?.message || String(error);
        const detail = msg.startsWith(SCHEDULE_ERROR_PREFIX) ? msg.slice(SCHEDULE_ERROR_PREFIX.length) : msg;
        throw createScheduleError("server", detail);
    }
  });

  ipcMain.handle("schedule:get", async (_event, eventIdPayload) => {
    const id = Number(eventIdPayload);
    if (!Number.isInteger(id)) {
      throw new Error("Schedule id is required.");
    }

    try {
      return await requestJson(getApi(), `/api/schedules/${id}`);
    } catch (error) {
      const msg = error?.message || String(error);
      const detail = msg.startsWith(SCHEDULE_ERROR_PREFIX) ? msg.slice(SCHEDULE_ERROR_PREFIX.length) : msg;
      throw createScheduleError("server", detail);
    }
  });

  ipcMain.handle("schedule:create", async (_event, payload) => {
    const body = {
      title: payload?.title,
      detail: payload?.detail ?? "",
      startAt: payload?.startAt,
      endAt: payload?.endAt,
      allDay: payload?.allDay ?? false,
      timezone: payload?.timezone ?? null,
      location: payload?.location ?? null,
      reminderOffsets: payload?.reminderOffsets ?? null,
      recurrence: payload?.recurrence ?? null,
      recurrenceEnd: payload?.recurrenceEnd ?? null,
    };

    try {
      return await requestJson(getApi(), "/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const msg = error?.message || String(error);
      const detail = msg.startsWith(SCHEDULE_ERROR_PREFIX) ? msg.slice(SCHEDULE_ERROR_PREFIX.length) : msg;
      throw createScheduleError("server", detail);
    }
  });

  ipcMain.handle("schedule:update", async (_event, payload) => {
    const eventId = Number(payload?.id);
    if (!Number.isInteger(eventId)) {
      throw new Error("Schedule id is required.");
    }

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(payload, "title")) {
      updates.title = payload.title;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "detail")) {
      updates.detail = payload.detail;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "startAt")) {
      updates.startAt = payload.startAt;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "endAt")) {
      updates.endAt = payload.endAt;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "allDay")) {
      updates.allDay = payload.allDay;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "timezone")) {
      updates.timezone = payload.timezone;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "location")) {
      updates.location = payload.location;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "reminderOffsets")) {
      updates.reminderOffsets = payload.reminderOffsets;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "recurrence")) {
      updates.recurrence = payload.recurrence;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "recurrenceEnd")) {
      updates.recurrenceEnd = payload.recurrenceEnd;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "isDone")) {
      updates.isDone = payload.isDone;
    }

    try {
      return await requestJson(getApi(), `/api/schedules/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } catch (error) {
      const msg = error?.message || String(error);
      const detail = msg.startsWith(SCHEDULE_ERROR_PREFIX) ? msg.slice(SCHEDULE_ERROR_PREFIX.length) : msg;
      throw createScheduleError("server", detail);
    }
  });

  ipcMain.handle("schedule:delete", async (_event, idPayload) => {
    const eventId = Number(idPayload);
    if (!Number.isInteger(eventId)) {
      throw new Error("Schedule id is required.");
    }

    try {
      return await requestJson(getApi(), `/api/schedules/${eventId}`, { method: "DELETE" });
    } catch (error) {
      const msg = error?.message || String(error);
      const detail = msg.startsWith(SCHEDULE_ERROR_PREFIX) ? msg.slice(SCHEDULE_ERROR_PREFIX.length) : msg;
      throw createScheduleError("server", detail);
    }
  });

  ipcMain.handle("schedule:clear", async (_event, scopePayload) => {
    const scope = scopePayload === "all" ? "all" : "all";
    try {
      return await requestJson(getApi(), `/api/schedules?scope=${encodeURIComponent(scope)}`, { method: "DELETE" });
    } catch (error) {
      const msg = error?.message || String(error);
      const detail = msg.startsWith(SCHEDULE_ERROR_PREFIX) ? msg.slice(SCHEDULE_ERROR_PREFIX.length) : msg;
      throw createScheduleError("server", detail);
    }
  });
}

function registerAgentIpc({ getApi }) {
  ipcMain.handle("agent:health", async () => ({ ok: await ping(getApi()) }));

  ipcMain.handle("agent:run", async (event, payload) => {
    const api = getApi();
    const websocketApi = api.replace(/^http/, "ws");
    const message = typeof payload === "string" ? payload : payload?.message;
    const requestId = payload?.requestId || randomUUID();

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${websocketApi}/api/agent/run`);
      let settled = false;
      let streamedReply = "";

      function finish(callback, value) {
        if (settled) {
          return;
        }

        settled = true;
        try {
          socket.close();
        } catch { }
        callback(value);
      }

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ message }));
      });

      socket.addEventListener("message", ({ data }) => {
        let payloadText;
        try {
          payloadText = typeof data === "string" ? data : data.toString();
          const streamEvent = JSON.parse(payloadText);

          if (streamEvent.type === "chunk") {
            const chunk = String(streamEvent.chunk || "");
            streamedReply += chunk;
            event.sender.send("agent:stream:chunk", { requestId, chunk });
            return;
          }

          if (streamEvent.type === "done") {
            finish(resolve, {
              reply: streamEvent.reply || streamedReply,
              agent: streamEvent.agent || "openai-chat",
            });
            return;
          }

          if (streamEvent.type === "error") {
            finish(reject, new Error(streamEvent.error || "Agent request failed."));
          }
        } catch (error) {
          finish(reject, new Error(`Invalid streaming response: ${payloadText || error.message}`));
        }
      });

      socket.addEventListener("error", () => {
        finish(reject, new Error("Streaming connection to backend failed."));
      });

      socket.addEventListener("close", ({ reason }) => {
        if (!settled) {
          finish(reject, new Error(reason || "Streaming connection closed before completion."));
        }
      });
    });
  });
}

module.exports = { registerAgentIpc, registerTodoIpc, registerScheduleIpc };
