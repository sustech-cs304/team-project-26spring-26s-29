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

function loadBlackboardIpcModule(electronMock, httpMock = {}) {
  const modulePath = require.resolve("../../src/electron/ipc/blackboard");
  delete require.cache[modulePath];

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") {
      return electronMock;
    }
    if (request === "./http") {
      return httpMock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("blackboard login forwards credentials to the backend", async () => {
  const ipcMain = new FakeIpcMain();
  const requests = [];

  const { registerBlackboardIpc } = loadBlackboardIpcModule({
    ipcMain,
    BrowserWindow: class { },
  }, {
    requestJson: async (_api, path, options) => {
      requests.push({ path, options });
      return { connected: true, lastError: null };
    },
  });

  registerBlackboardIpc({ getApi: () => "http://127.0.0.1:8765" });
  const result = await ipcMain.handlers.get("blackboard:login")({}, { username: "alice", password: "secret" });

  assert.deepEqual(result, { connected: true, lastError: null });
  assert.equal(requests[0].path, "/api/blackboard/login");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), { username: "alice", password: "secret" });
});

test("open login window uses the persistent Blackboard partition", async () => {
  const ipcMain = new FakeIpcMain();
  const createdWindows = [];
  const cookieSets = [];
  const requests = [];

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.loadedUrl = null;
      createdWindows.push(this);
    }

    isDestroyed() {
      return false;
    }

    focus() { }

    on() { }

    loadURL(url) {
      this.loadedUrl = url;
    }
  }

  const fakeSession = {
    clearStorageData: async () => {
      cookieSets.push({ cleared: true });
    },
    cookies: {
      set: async (cookie) => {
        cookieSets.push(cookie);
      },
    },
  };

  const { BLACKBOARD_PARTITION, registerBlackboardIpc } = loadBlackboardIpcModule({
    ipcMain,
    BrowserWindow: FakeBrowserWindow,
    session: {
      fromPartition: () => fakeSession,
    },
  }, {
    requestJson: async (_api, path) => {
      requests.push(path);
      if (path === "/api/blackboard/status") {
        return { connected: true };
      }
      if (path === "/api/blackboard/session-cookies") {
        return [
          { name: "s_session_id", value: "cookie", domain: "bb.sustech.edu.cn", path: "/" },
        ];
      }
      return {};
    },
  });

  registerBlackboardIpc({ getApi: () => "http://127.0.0.1:8765" });
  const result = await ipcMain.handlers.get("blackboard:open-login")();

  assert.deepEqual(result, { opened: true, reused: false });
  assert.equal(createdWindows[0].options.webPreferences.partition, BLACKBOARD_PARTITION);
  assert.equal(createdWindows[0].loadedUrl, "https://bb.sustech.edu.cn");
  assert.deepEqual(requests, ["/api/blackboard/status", "/api/blackboard/session-cookies"]);
  assert.deepEqual(cookieSets[0], { cleared: true });
  assert.equal(cookieSets.length > 1, true);
});

test("clear login clears the Electron Blackboard session", async () => {
  const ipcMain = new FakeIpcMain();
  const createdWindows = [];
  const requests = [];
  const calls = [];

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.loadedUrl = null;
      createdWindows.push(this);
    }

    isDestroyed() {
      return false;
    }

    focus() {
      calls.push("focus");
    }

    on() { }

    loadURL(url) {
      this.loadedUrl = url;
      calls.push(url);
    }
  }

  const fakeSession = {
    clearStorageData: async (options) => {
      calls.push(options);
    },
    cookies: {
      set: async () => { },
    },
  };

  const { registerBlackboardIpc } = loadBlackboardIpcModule({
    ipcMain,
    BrowserWindow: FakeBrowserWindow,
    session: {
      fromPartition: () => fakeSession,
    },
  }, {
    requestJson: async (_api, path, options) => {
      requests.push({ path, options });
      if (path === "/api/blackboard/status") {
        return { connected: true };
      }
      if (path === "/api/blackboard/session-cookies") {
        return [
          { name: "s_session_id", value: "cookie", domain: "bb.sustech.edu.cn", path: "/" },
        ];
      }
      if (path === "/api/blackboard/session") {
        return { connected: false, hasSession: false };
      }
      return {};
    },
  });

  registerBlackboardIpc({ getApi: () => "http://127.0.0.1:8765" });
  await ipcMain.handlers.get("blackboard:open-login")();
  await ipcMain.handlers.get("blackboard:clear-login")();

  assert.equal(createdWindows[0].loadedUrl, "https://bb.sustech.edu.cn");
  assert.deepEqual(calls[0], { storages: ["cookies"] });
  assert.equal(calls.includes("focus"), true);
  assert.equal(requests.some((item) => item.path === "/api/blackboard/session"), true);
});
