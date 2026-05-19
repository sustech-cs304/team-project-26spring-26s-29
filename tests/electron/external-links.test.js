const assert = require("node:assert/strict");
const test = require("node:test");

const {
  registerExternalLinkHandlers,
  shouldOpenExternalUrl,
} = require("../../src/electron/external-links");

class FakeWebContents {
  constructor() {
    this.listeners = new Map();
    this.windowOpenHandler = null;
  }

  on(eventName, listener) {
    this.listeners.set(eventName, listener);
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }

  emit(eventName, ...args) {
    return this.listeners.get(eventName)(...args);
  }
}

test("shouldOpenExternalUrl only accepts http and https URLs", () => {
  assert.equal(shouldOpenExternalUrl("https://www.baidu.com"), true);
  assert.equal(shouldOpenExternalUrl("http://example.test"), true);
  assert.equal(shouldOpenExternalUrl("file:///tmp/index.html"), false);
  assert.equal(shouldOpenExternalUrl("not a url"), false);
});

test("registerExternalLinkHandlers opens new http windows in the default browser", () => {
  const opened = [];
  const webContents = new FakeWebContents();
  const shell = {
    openExternal(url) {
      opened.push(url);
      return Promise.resolve();
    },
  };

  registerExternalLinkHandlers(webContents, shell);

  assert.deepEqual(webContents.windowOpenHandler({ url: "https://www.baidu.com" }), { action: "deny" });
  assert.deepEqual(opened, ["https://www.baidu.com"]);
});

test("registerExternalLinkHandlers opens http navigations in the default browser", () => {
  const opened = [];
  const webContents = new FakeWebContents();
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  const shell = {
    openExternal(url) {
      opened.push(url);
      return Promise.resolve();
    },
  };

  registerExternalLinkHandlers(webContents, shell);
  webContents.emit("will-navigate", event, "https://www.baidu.com");

  assert.equal(event.prevented, true);
  assert.deepEqual(opened, ["https://www.baidu.com"]);
});
