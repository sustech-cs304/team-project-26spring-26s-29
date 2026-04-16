const { randomUUID } = require("node:crypto");
const { ipcMain } = require("electron");

async function ping(api) {
  try {
    return (await fetch(`${api}/health`)).ok;
  } catch {
    return false;
  }
}

function registerAgentIpc({ api }) {
  const websocketApi = api.replace(/^http/, "ws");

  ipcMain.handle("agent:health", async () => ({ ok: await ping(api) }));

  ipcMain.handle("agent:run", async (event, payload) => {
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
        } catch {}
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

module.exports = { registerAgentIpc };
