const { Buffer } = require("node:buffer");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { BrowserWindow, dialog, ipcMain } = require("electron");

const { ping } = require("./http");

const IMAGE_MEDIA_TYPES = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const TEXT_MEDIA_TYPES = {
  ".c": "text/plain",
  ".cc": "text/plain",
  ".cpp": "text/plain",
  ".css": "text/css",
  ".csv": "text/csv",
  ".go": "text/plain",
  ".html": "text/html",
  ".java": "text/plain",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jsx": "text/javascript",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".py": "text/x-python",
  ".rs": "text/plain",
  ".sql": "application/sql",
  ".text": "text/plain",
  ".toml": "application/toml",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
};

function registerAgentIpc({ getApi }) {
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

  ipcMain.handle("agent:pick-attachments", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const selection = await dialog.showOpenDialog(window, {
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Supported Attachments", extensions: supportedExtensions() },
        { name: "Images", extensions: Object.keys(IMAGE_MEDIA_TYPES).map((ext) => ext.slice(1)) },
        { name: "Text Files", extensions: Object.keys(TEXT_MEDIA_TYPES).map((ext) => ext.slice(1)) },
      ],
    });

    if (selection.canceled) {
      return [];
    }

    const attachments = [];
    for (const filePath of selection.filePaths) {
      attachments.push(await loadAttachment(filePath));
    }
    return attachments;
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

    await writeOutputPart(result.filePath, part);
    return { canceled: false, path: result.filePath };
  });
}

async function loadAttachment(filePath) {
  const kind = classifyAttachment(filePath);
  if (!kind) {
    throw new Error(`Unsupported attachment type: ${path.basename(filePath)}`);
  }

  const fileBuffer = await fs.readFile(filePath);
  const name = path.basename(filePath);

  if (kind.type === "image") {
    return {
      type: "image",
      name,
      mediaType: kind.mediaType,
      dataBase64: fileBuffer.toString("base64"),
      sizeBytes: fileBuffer.byteLength,
    };
  }

  return {
    type: "text_file",
    name,
    mediaType: kind.mediaType,
    text: decodeTextBuffer(fileBuffer),
    sizeBytes: fileBuffer.byteLength,
  };
}

function classifyAttachment(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (IMAGE_MEDIA_TYPES[extension]) {
    return { type: "image", mediaType: IMAGE_MEDIA_TYPES[extension] };
  }
  if (TEXT_MEDIA_TYPES[extension]) {
    return { type: "text_file", mediaType: TEXT_MEDIA_TYPES[extension] };
  }
  return null;
}

function supportedExtensions() {
  return [
    ...Object.keys(IMAGE_MEDIA_TYPES).map((ext) => ext.slice(1)),
    ...Object.keys(TEXT_MEDIA_TYPES).map((ext) => ext.slice(1)),
  ];
}

function decodeTextBuffer(buffer) {
  if (buffer.byteLength >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(3));
  }

  if (buffer.byteLength >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le", { fatal: true }).decode(buffer.subarray(2));
  }

  if (buffer.byteLength >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be", { fatal: true }).decode(buffer.subarray(2));
  }

  for (const encoding of ["utf-8", "utf-16le", "utf-16be", "gb18030"]) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch { }
  }

  throw new Error("Could not decode the selected text file.");
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
  const normalized = String(mediaType || "").toLowerCase();
  const matches = [...Object.entries(IMAGE_MEDIA_TYPES), ...Object.entries(TEXT_MEDIA_TYPES)];
  const match = matches.find(([, value]) => value === normalized);
  return match ? match[0] : "";
}

async function writeOutputPart(filePath, part) {
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

module.exports = { registerAgentIpc };
