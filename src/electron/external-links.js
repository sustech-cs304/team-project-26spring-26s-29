const EXTERNAL_LINK_PROTOCOLS = new Set(["http:", "https:"]);

function shouldOpenExternalUrl(url) {
  try {
    return EXTERNAL_LINK_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function openExternalUrl(shell, url) {
  if (!shouldOpenExternalUrl(url)) {
    return false;
  }

  Promise.resolve(shell.openExternal(url)).catch(() => {});
  return true;
}

function registerExternalLinkHandlers(webContents, shell) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (openExternalUrl(shell, url)) {
      return { action: "deny" };
    }

    return { action: "allow" };
  });

  webContents.on("will-navigate", (event, url) => {
    if (!openExternalUrl(shell, url)) {
      return;
    }

    event.preventDefault();
  });
}

module.exports = {
  registerExternalLinkHandlers,
  shouldOpenExternalUrl,
};
