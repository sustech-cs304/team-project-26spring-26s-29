const TODO_ERROR_PREFIX = "TODO_ERROR|";

function createTodoError(category, detail) {
  const normalizedDetail = String(detail || "Todo request failed.").trim();
  return new Error(`${TODO_ERROR_PREFIX}${category}|${normalizedDetail}`);
}

async function ping(api) {
  try {
    return (await fetch(`${api}/health`)).ok;
  } catch {
    return false;
  }
}

async function requestJson(api, path, options = {}) {
  let response;
  try {
    response = await fetch(`${api}${path}`, options);
  } catch {
    throw createTodoError("network", "Cannot reach backend service.");
  }

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const detail = payload?.detail || text || `Backend request failed with status ${response.status}.`;
    if (response.status === 404) {
      throw createTodoError("not-found", detail);
    }
    if (response.status === 400 || response.status === 422) {
      throw createTodoError("validation", detail);
    }
    throw createTodoError("server", detail);
  }

  return payload;
}

module.exports = {
  TODO_ERROR_PREFIX,
  createTodoError,
  ping,
  requestJson,
};
