const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Buffer } = require("node:buffer");
const { BrowserWindow, clipboard, dialog, ipcMain, nativeImage } = require("electron");

const {
  extensionFromMediaType: lookupExtensionFromMediaType,
  loadWorkspacePreview,
  stageAttachments,
} = require("../attachment-staging");
const { ping } = require("./http");

function registerAgentIpc({ getApi, getConfig }) {
  const activeRuns = new Map();

  ipcMain.handle("agent:health", async () => ({ ok: await ping(getApi()) }));

  ipcMain.handle("agent:run", async (event, payload) => {
    const api = getApi();
    const websocketApi = api.replace(/^http/, "ws");
    const requestId = payload?.requestId || randomUUID();
    const contents = Array.isArray(payload?.contents) ? payload.contents : [];

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${websocketApi}/api/agent/run`);
      const state = {
        requestId,
        sender: event.sender,
        socket,
        settled: false,
      };
      activeRuns.set(requestId, state);

      function finish(callback, value) {
        if (state.settled) {
          return;
        }

        state.settled = true;
        activeRuns.delete(requestId);
        try {
          socket.close();
        } catch { }
        callback(value);
      }

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "run", requestId, contents }));
      });

      socket.addEventListener("message", ({ data }) => {
        let payloadText;
        try {
          payloadText = typeof data === "string" ? data : data.toString();
          const streamEvent = JSON.parse(payloadText);
          const forwardedEvent = {
            ...streamEvent,
            requestId: streamEvent.requestId || requestId,
          };

          state.sender.send("agent:stream:event", forwardedEvent);

          if (streamEvent.type === "update") {
            return;
          }

          if (streamEvent.type === "done") {
            finish(resolve, {
              requestId,
              message: streamEvent.message,
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
        if (!state.settled) {
          activeRuns.delete(requestId);
          finish(reject, new Error(reason || "Streaming connection closed before completion."));
        }
      });
    });
  });

  ipcMain.handle("agent:approval", async (_event, payload) => {
    const requestId = String(payload?.requestId || "").trim();
    const approvalId = String(payload?.approvalId || "").trim();
    const approved = Boolean(payload?.approved);

    if (!requestId || !approvalId) {
      throw new Error("Approval requestId and approvalId are required.");
    }

    const run = activeRuns.get(requestId);
    if (!run || run.settled) {
      throw new Error("No active agent run is waiting for approval.");
    }

    run.socket.send(
      JSON.stringify({
        type: "approval_response",
        requestId,
        approvalId,
        approved,
      })
    );

    return { ok: true };
  });

  ipcMain.handle("agent:pick-attachments", async (event, payload) => {
    const requestId = String(payload?.requestId || "").trim();
    if (!requestId) {
      throw new Error("Attachment staging requires a requestId.");
    }

    const window = BrowserWindow.fromWebContents(event.sender);
    const selection = await dialog.showOpenDialog(window, {
      properties: ["openFile", "multiSelections"],
    });

    if (selection.canceled) {
      return [];
    }

    return stageAttachments({
      filePaths: selection.filePaths,
      requestId,
      workspacePath: getConfig().workspacePath,
    });
  });

  ipcMain.handle("agent:save-output-part", async (event, payload) => {
    const part = payload || {};
    const window = BrowserWindow.fromWebContents(event.sender);
    const defaultPath = path.join(
      process.env.USERPROFILE || process.cwd(),
      "Downloads",
      resolveOutputName(part)
    );

    const result = await dialog.showSaveDialog(window, { defaultPath });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    await writeOutputPart(result.filePath, part, { workspacePath: getConfig().workspacePath });
    return { canceled: false, path: result.filePath };
  });

  ipcMain.handle("agent:copy-preview-part", async (_event, payload) => {
    await copyOutputPart(payload || {}, { workspacePath: getConfig().workspacePath });
    return { ok: true };
  });

  ipcMain.handle("agent:load-preview", async (_event, payload) => {
    const relativePath = String(payload?.relativePath || "").trim();
    if (!relativePath) {
      throw new Error("Preview loading requires a workspace-relative path.");
    }

    return loadWorkspacePreview({
      workspacePath: getConfig().workspacePath,
      relativePath,
      mediaType: payload?.mediaType,
    });
  });
}

function resolveOutputName(part) {
  const explicitName = typeof part?.name === "string" ? part.name.trim() : "";
  if (explicitName) {
    return explicitName;
  }

  if (typeof part?.fileId === "string" && part.fileId) {
    return `file-${part.fileId}${extensionFromMediaType(part.mediaType)}`;
  }

  return `download${extensionFromMediaType(part?.mediaType)}`;
}

function extensionFromMediaType(mediaType) {
  return lookupExtensionFromMediaType(mediaType);
}

async function writeOutputPart(filePath, part, options = {}) {
  const sourcePath = await resolveWorkspaceSourcePath(part, options.workspacePath);
  if (sourcePath) {
    await fs.copyFile(sourcePath, filePath);
    return;
  }

  const textContent = typeof part?.textContent === "string" ? part.textContent : "";
  if (textContent) {
    await fs.writeFile(filePath, textContent, "utf8");
    return;
  }

  const encoded = typeof part?.dataBase64 === "string" ? part.dataBase64.trim() : "";
  if (encoded) {
    await fs.writeFile(filePath, Buffer.from(encoded, "base64"));
    return;
  }

  const uri = typeof part?.uri === "string" ? part.uri : "";
  if (uri.startsWith("data:")) {
    const [, data] = uri.split(",", 2);
    await fs.writeFile(filePath, Buffer.from(data || "", "base64"));
    return;
  }

  if (/^https?:\/\//i.test(uri)) {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(filePath, bytes);
    return;
  }

  throw new Error("This output does not include downloadable bytes.");
}

async function copyOutputPart(part, options = {}) {
  const sourcePath = await resolveWorkspaceSourcePath(part, options.workspacePath);
  const mediaType = String(part?.mediaType || "").toLowerCase();

  if (sourcePath && mediaType.startsWith("image/")) {
    const image = nativeImage.createFromPath(sourcePath);
    if (!image.isEmpty()) {
      clipboard.writeImage(image);
      return;
    }
  }

  if (typeof part?.dataBase64 === "string" && part.dataBase64 && mediaType.startsWith("image/")) {
    const image = nativeImage.createFromBuffer(Buffer.from(part.dataBase64, "base64"));
    if (!image.isEmpty()) {
      clipboard.writeImage(image);
      return;
    }
  }

  const uri = typeof part?.uri === "string" ? part.uri : "";
  if (uri.startsWith("data:image/")) {
    const image = nativeImage.createFromDataURL(uri);
    if (!image.isEmpty()) {
      clipboard.writeImage(image);
      return;
    }
  }

  const textContent = typeof part?.textContent === "string" ? part.textContent : "";
  if (textContent) {
    clipboard.writeText(textContent);
    return;
  }

  if (sourcePath) {
    clipboard.writeText(sourcePath);
    return;
  }

  const fallbackText = String(part?.relativePath || part?.name || "").trim();
  if (fallbackText) {
    clipboard.writeText(fallbackText);
    return;
  }

  throw new Error("This preview does not include copyable content.");
}

async function resolveWorkspaceSourcePath(part, workspacePath) {
  const relativePath = String(part?.relativePath || "").trim();
  if (!relativePath || !workspacePath) {
    return null;
  }

  const root = path.resolve(workspacePath);
  const candidate = path.resolve(root, relativePath);
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (candidate !== root && !candidate.startsWith(normalizedRoot)) {
    throw new Error("Output path escapes the workspace root.");
  }

  const stat = await fs.stat(candidate).catch(() => null);
  return stat?.isFile() ? candidate : null;
}

module.exports = { registerAgentIpc };
