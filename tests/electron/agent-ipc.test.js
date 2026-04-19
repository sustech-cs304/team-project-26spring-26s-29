const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, handler) {
    this.handlers.set(channel, handler);
  }
}

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const nextListeners = this.listeners.get(type) || [];
    nextListeners.push(listener);
    this.listeners.set(type, nextListeners);
  }

  send(payload) {
    this.sent.push(payload);
  }

  close() {
    this.emit("close", { reason: "" });
  }

  emit(type, payload = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener(payload);
    }
  }
}

function loadAgentIpcModule(electronMock) {
  const modulePath = require.resolve("../../src/electron/ipc/agent");
  delete require.cache[modulePath];

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") {
      return electronMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("registerAgentIpc interrupts an active run and rejects the pending prompt", async () => {
  FakeWebSocket.instances = [];
  const ipcMain = new FakeIpcMain();
  const senderEvents = [];
  const sender = {
    send(channel, payload) {
      senderEvents.push({ channel, payload });
    },
  };

  const { registerAgentIpc } = loadAgentIpcModule({
    ipcMain,
    BrowserWindow: { fromWebContents: () => null },
    clipboard: {},
    dialog: {},
    nativeImage: {},
  });

  const previousWebSocket = global.WebSocket;
  global.WebSocket = FakeWebSocket;

  try {
    registerAgentIpc({
      getApi: () => "http://127.0.0.1:8765",
      getConfig: () => ({ workspacePath: "workspace" }),
    });

    const runHandler = ipcMain.handlers.get("agent:run");
    const interruptHandler = ipcMain.handlers.get("agent:interrupt");
    const contents = [{ type: "text", text: "Hello" }];

    const runPromise = runHandler({ sender }, { requestId: "req-1", contents });
    const socket = FakeWebSocket.instances[0];
    socket.emit("open");

    assert.deepEqual(JSON.parse(socket.sent[0]), {
      type: "run",
      requestId: "req-1",
      contents,
    });

    const interruptResult = await interruptHandler({}, { requestId: "req-1" });
    assert.deepEqual(interruptResult, { ok: true });

    await assert.rejects(runPromise, /Agent run interrupted\./);

    socket.emit("message", {
      data: JSON.stringify({
        type: "update",
        requestId: "req-1",
        message: { role: "assistant", status: "running", contents: [{ type: "text", text: "ignored" }] },
      }),
    });
    assert.equal(senderEvents.length, 0);
  } finally {
    global.WebSocket = previousWebSocket;
  }
});

test("registerAgentIpc rejects interrupt requests when no active run exists", async () => {
  const ipcMain = new FakeIpcMain();
  const { registerAgentIpc } = loadAgentIpcModule({
    ipcMain,
    BrowserWindow: { fromWebContents: () => null },
    clipboard: {},
    dialog: {},
    nativeImage: {},
  });

  registerAgentIpc({
    getApi: () => "http://127.0.0.1:8765",
    getConfig: () => ({ workspacePath: "workspace" }),
  });

  const interruptHandler = ipcMain.handlers.get("agent:interrupt");
  await assert.rejects(
    interruptHandler({}, { requestId: "missing-run" }),
    /No active agent run can be interrupted\./
  );
});
