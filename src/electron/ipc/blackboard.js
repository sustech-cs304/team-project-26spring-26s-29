const { BrowserWindow, ipcMain, session } = require("electron");

const { requestJson } = require("./http");

const BLACKBOARD_URL = "https://bb.sustech.edu.cn";
const BLACKBOARD_PARTITION = "persist:blackboard";
const ALLOWED_COOKIE_NAMES = new Set([
  "s_session_id",
  "JSESSIONID",
  "BbClientCalenderTimeZone",
  "web_client_cache_guid",
  "COOKIE_CONSENT_ACCEPTED",
]);

let loginWindow = null;

function getBlackboardSession() {
  return session.fromPartition(BLACKBOARD_PARTITION);
}

function filterBlackboardCookies(cookies) {
  return cookies
    .filter((cookie) => cookie.domain === "bb.sustech.edu.cn" || cookie.domain === ".bb.sustech.edu.cn")
    .filter((cookie) => ALLOWED_COOKIE_NAMES.has(cookie.name))
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
    }));
}

async function collectBlackboardCookies() {
  const cookies = await getBlackboardSession().cookies.get({ url: BLACKBOARD_URL });
  return filterBlackboardCookies(cookies);
}

async function syncSessionToBackend(api) {
  const cookies = await collectBlackboardCookies();
  return requestJson(api, "/api/blackboard/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookies }),
  });
}

function openLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return { opened: true, reused: true };
  }

  loginWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    title: "Blackboard Login",
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
  ipcMain.handle("blackboard:open-login", async () => openLoginWindow());

  ipcMain.handle("blackboard:get-status", async () => {
    await syncSessionToBackend(getApi());
    return requestJson(getApi(), "/api/blackboard/status");
  });

  ipcMain.handle("blackboard:clear-login", async () => {
    await getBlackboardSession().clearStorageData({
      storages: ["cookies", "localstorage", "sessionstorage", "cachestorage"],
    });
    return requestJson(getApi(), "/api/blackboard/session", {
      method: "DELETE",
    });
  });

  ipcMain.handle("blackboard:sync", async () => {
    await syncSessionToBackend(getApi());
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
  filterBlackboardCookies,
  registerBlackboardIpc,
};
