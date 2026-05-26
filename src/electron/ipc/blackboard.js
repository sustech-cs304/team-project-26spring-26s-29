const electron = require("electron");
const { requestJson } = require("./http");
const fs = require("fs");
const path = require("path");

const { BrowserWindow, ipcMain, session } = electron;

const BLACKBOARD_URL = "https://bb.sustech.edu.cn";
const BLACKBOARD_PARTITION = "persist:blackboard";

let loginWindow = null;

async function clearBlackboardSessionCookies() {
  const blackboardSession = session.fromPartition(BLACKBOARD_PARTITION);
  await blackboardSession.clearStorageData({ storages: ["cookies"] });
}

const CREDENTIALS_FILE = (() => {
  try {
    return path.join((electron.app && electron.app.getPath("userData")) || __dirname, "blackboard_credentials.enc");
  } catch {
    return path.join(__dirname, "blackboard_credentials.enc");
  }
})();

async function saveEncryptedCredentials(username, password) {
  try {
    const safeStorage = electron.safeStorage;
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage unavailable");
    }
    const payload = JSON.stringify({ username: String(username || ""), password: String(password || "") });
    const encrypted = safeStorage.encryptString(payload);
    await fs.promises.writeFile(CREDENTIALS_FILE, encrypted);
    return true;
  } catch (err) {
    return false;
  }
}

async function loadEncryptedCredentials() {
  try {
    const safeStorage = electron.safeStorage;
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
      return null;
    }
    const data = await fs.promises.readFile(CREDENTIALS_FILE);
    const decrypted = safeStorage.decryptString(data);
    const parsed = JSON.parse(decrypted);
    return {
      username: typeof parsed.username === "string" ? parsed.username : "",
      password: typeof parsed.password === "string" ? parsed.password : "",
      rememberPassword: Boolean(parsed.password),
    };
  } catch (err) {
    return null;
  }
}

async function deleteEncryptedCredentials() {
  try {
    await fs.promises.unlink(CREDENTIALS_FILE);
  } catch {
    // ignore
  }
}

async function syncBlackboardSessionCookies(getApi) {
  const cookies = await requestJson(getApi(), "/api/blackboard/session-cookies");
  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error("Blackboard session cookies are unavailable.");
  }

  const blackboardSession = session.fromPartition(BLACKBOARD_PARTITION);

  await blackboardSession.clearStorageData({ storages: ["cookies"] });

  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    await blackboardSession.cookies.set({
      url: BLACKBOARD_URL,
      name: String(cookie.name ?? ""),
      value: String(cookie.value ?? ""),
      domain: cookie.domain ? String(cookie.domain) : undefined,
      path: cookie.path ? String(cookie.path) : "/",
    });
  }
}

async function reloadBlackboardWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.loadURL(BLACKBOARD_URL);
    loginWindow.focus();
  }
}

async function openBlackboardWindow(getApi) {
  const status = await requestJson(getApi(), "/api/blackboard/status");
  if (!status.connected) {
    return { opened: false, reused: false, reason: "not-connected" };
  }

  await syncBlackboardSessionCookies(getApi);

  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.loadURL(BLACKBOARD_URL);
    loginWindow.focus();
    return { opened: true, reused: true };
  }

  loginWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    title: "Blackboard",
    webPreferences: {
      partition: BLACKBOARD_PARTITION,
    },
  });

  loginWindow.on("closed", () => {
    loginWindow = null;
  });
  loginWindow.loadURL(BLACKBOARD_URL);
  return { opened: true, reused: false };
}

function registerBlackboardIpc({ getApi }) {
  ipcMain.handle("blackboard:open-login", async () => openBlackboardWindow(getApi));

  ipcMain.handle("blackboard:login", async (_event, payload = {}) => {
    return requestJson(getApi(), "/api/blackboard/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: String(payload.username ?? ""),
        password: String(payload.password ?? ""),
      }),
    });
  });

  ipcMain.handle("blackboard:save-credentials", async (_event, payload = {}) => {
    return saveEncryptedCredentials(payload.username, payload.password);
  });

  ipcMain.handle("blackboard:get-credentials", async () => {
    return loadEncryptedCredentials();
  });

  ipcMain.handle("blackboard:delete-credentials", async () => {
    await deleteEncryptedCredentials();
    return true;
  });

  ipcMain.handle("blackboard:get-status", async () => {
    return requestJson(getApi(), "/api/blackboard/status");
  });

  ipcMain.handle("blackboard:refresh-status", async () => {
    return requestJson(getApi(), "/api/blackboard/refresh", {
      method: "POST",
    });
  });

  ipcMain.handle("blackboard:clear-login", async () => {
    await clearBlackboardSessionCookies();
    await reloadBlackboardWindow();
    return requestJson(getApi(), "/api/blackboard/session", {
      method: "DELETE",
    });
  });

  ipcMain.handle("blackboard:sync", async () => {
    return requestJson(getApi(), "/api/blackboard/sync", {
      method: "POST",
    });
  });

  ipcMain.handle("blackboard:list-suggestions", async () => {
    return requestJson(getApi(), "/api/blackboard/suggestions");
  });

  ipcMain.handle("blackboard:apply-suggestions", async (_event, ids) => {
    return requestJson(getApi(), "/api/blackboard/suggestions/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
    });
  });

  ipcMain.handle("blackboard:dismiss-suggestions", async (_event, ids) => {
    return requestJson(getApi(), "/api/blackboard/suggestions/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
    });
  });
}

module.exports = {
  BLACKBOARD_PARTITION,
  registerBlackboardIpc,
};
