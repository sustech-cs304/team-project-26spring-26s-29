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

function loadBlackboardIpcModule(electronMock) {
  const modulePath = require.resolve("../../src/electron/ipc/blackboard");
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

test("filterBlackboardCookies keeps only bb.sustech.edu.cn cookies", () => {
  const { filterBlackboardCookies } = loadBlackboardIpcModule({
    ipcMain: new FakeIpcMain(),
    BrowserWindow: class {},
    session: {},
  });

  const filtered = filterBlackboardCookies([
    { name: "s_session_id", value: "ok", domain: "bb.sustech.edu.cn", path: "/" },
    { name: "JSESSIONID", value: "ok", domain: "bb.sustech.edu.cn", path: "/" },
    { name: "TGC", value: "no", domain: "cas.sustech.edu.cn", path: "/cas/" },
    { name: "unrelated", value: "no", domain: "bb.sustech.edu.cn", path: "/" },
  ]);

  assert.deepEqual(filtered, [
    { name: "s_session_id", value: "ok", domain: "bb.sustech.edu.cn", path: "/" },
    { name: "JSESSIONID", value: "ok", domain: "bb.sustech.edu.cn", path: "/" },
  ]);
});

test("open login window uses the persistent Blackboard partition", async () => {
  const ipcMain = new FakeIpcMain();
  const createdWindows = [];

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.loadedUrl = null;
      createdWindows.push(this);
    }

    isDestroyed() {
      return false;
    }

    focus() {}

    on() {}

    loadURL(url) {
      this.loadedUrl = url;
    }
  }

  const { BLACKBOARD_PARTITION, registerBlackboardIpc } = loadBlackboardIpcModule({
    ipcMain,
    BrowserWindow: FakeBrowserWindow,
    session: {},
  });

  registerBlackboardIpc({ getApi: () => "http://127.0.0.1:8765" });
  const result = await ipcMain.handlers.get("blackboard:open-login")();

  assert.deepEqual(result, { opened: true, reused: false });
  assert.equal(createdWindows[0].options.webPreferences.partition, BLACKBOARD_PARTITION);
  assert.equal(createdWindows[0].loadedUrl, "https://bb.sustech.edu.cn");
});
