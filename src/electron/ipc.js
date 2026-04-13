const { ipcMain } = require("electron");

async function ping(api) {
  try {
    return (await fetch(`${api}/health`)).ok;
  } catch {
    return false;
  }
}

function registerAgentIpc({ api }) {
  ipcMain.handle("agent:health", async () => ({ ok: await ping(api) }));

  ipcMain.handle("agent:run", async (_event, message) => {
    message = String(message || "").trim();
    if (!message) {
      throw new Error("Message is empty.");
    }

    const response = await fetch(`${api}/api/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json();
  });
}

module.exports = { registerAgentIpc };
