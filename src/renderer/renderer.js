const configFieldDefinitions = [
  {
    key: "backendHost",
    label: "Backend Host",
    hint: "Hostname used when Electron talks to the local Python backend.",
  },
  {
    key: "backendPort",
    label: "Backend Port",
    hint: "Port used for the local Python backend process.",
  },
  {
    key: "openaiApiKey",
    label: "OpenAI API Key",
    hint: "Stored locally and forwarded to the backend runtime config.",
  },
  {
    key: "openaiChatModel",
    label: "OpenAI Chat Model",
    hint: "The model name used for chat requests.",
  },
  {
    key: "openaiEndpoint",
    label: "OpenAI Endpoint",
    hint: "Optional custom base URL for the chat provider.",
  },
];

const $ = (id) => document.getElementById(id);
const prompt = $("prompt");
const send = $("send");
const status = $("status");
const response = $("response");
const configForm = $("config-form");
const configFields = $("config-fields");
const configFeedback = $("config-feedback");
const discard = $("discard");
const saveConfigButton = $("save-config");
const navButtons = Array.from(document.querySelectorAll("[data-page-target]"));
const pages = Array.from(document.querySelectorAll("[data-page]"));

let isRunning = false;
let activeRequestId = null;
let savedConfig = null;
let configInputs = {};
let isConfigSaving = false;

function buildConfigFields() {
  configFields.replaceChildren(
    ...configFieldDefinitions.map(({ key, label, hint }) => {
      const wrapper = document.createElement("label");
      wrapper.className = "config-field";
      wrapper.htmlFor = `config-${key}`;
      wrapper.innerHTML = `
        <span class="config-field__label">${label}</span>
        <span class="config-field__hint">${hint}</span>
        <textarea
          id="config-${key}"
          class="config-field__input"
          data-config-key="${key}"
          rows="3"
          spellcheck="false"
        ></textarea>
      `;
      return wrapper;
    }),
  );

  configInputs = Object.fromEntries(
    configFieldDefinitions.map(({ key }) => [
      key,
      configFields.querySelector(`[data-config-key="${key}"]`),
    ]),
  );
}

function setActivePage(pageName) {
  navButtons.forEach((button) => {
    const isActive = button.dataset.pageTarget === pageName;
    button.classList.toggle("is-active", isActive);
    if (isActive) {
      button.setAttribute("aria-current", "page");
      return;
    }

    button.removeAttribute("aria-current");
  });

  pages.forEach((page) => {
    const isActive = page.dataset.page === pageName;
    page.classList.toggle("is-active", isActive);
    page.hidden = !isActive;
  });
}

function toComparableValue(value) {
  return String(value ?? "").trim();
}

function getConfigDraft() {
  return Object.fromEntries(
    configFieldDefinitions.map(({ key }) => [key, configInputs[key].value]),
  );
}

function hasConfigChanges() {
  if (!savedConfig) {
    return false;
  }

  const draft = getConfigDraft();
  return configFieldDefinitions.some(
    ({ key }) => toComparableValue(draft[key]) !== toComparableValue(savedConfig[key]),
  );
}

function setConfigFeedback(message = "", state = "") {
  configFeedback.textContent = message;

  if (state) {
    configFeedback.dataset.state = state;
    return;
  }

  delete configFeedback.dataset.state;
}

function updateConfigActions() {
  const dirty = hasConfigChanges();
  discard.disabled = !dirty || isConfigSaving;
  saveConfigButton.disabled = !dirty || isConfigSaving;
  saveConfigButton.textContent = isConfigSaving ? "Saving..." : "Save";
}

function populateConfigForm(config) {
  savedConfig = { ...config };

  configFieldDefinitions.forEach(({ key }) => {
    configInputs[key].value = config[key] == null ? "" : String(config[key]);
  });

  updateConfigActions();
}

async function loadConfig() {
  const config = await window.configAPI.get();
  populateConfigForm(config);
  return config;
}

async function refreshStatus() {
  const [{ ok }, config] = await Promise.all([
    window.agentAPI.health().catch(() => ({ ok: false })),
    window.configAPI.get().catch(() => null),
  ]);
  const ready = ok && Boolean(config?.openaiChatModel);

  status.textContent = isRunning ? "running" : !ok ? "starting" : ready ? "ready" : "config needed";
  send.disabled = isRunning || !ready;
}

async function run() {
  const message = prompt.value.trim();
  if (!message || send.disabled) {
    return;
  }

  isRunning = true;
  activeRequestId = crypto.randomUUID();
  send.disabled = true;
  status.textContent = "running";
  response.textContent = "";

  try {
    const result = await window.agentAPI.runPrompt(message, activeRequestId);
    if (!response.textContent) {
      response.textContent = result.reply;
    }
    status.textContent = "ready";
  } catch (error) {
    const errorText = error?.message || String(error);
    response.textContent = response.textContent
      ? `${response.textContent}\n\n[error] ${errorText}`
      : errorText;
    status.textContent = "error";
  } finally {
    isRunning = false;
    activeRequestId = null;
  }

  await refreshStatus();
}

async function handleConfigSave(event) {
  event.preventDefault();

  if (!hasConfigChanges()) {
    return;
  }

  isConfigSaving = true;
  updateConfigActions();
  setConfigFeedback("Saving config...", "pending");

  try {
    const saved = await window.configAPI.save(getConfigDraft());
    populateConfigForm(saved);
    setConfigFeedback("Config saved.", "success");
    await refreshStatus();
  } catch (error) {
    setConfigFeedback(error?.message || String(error), "error");
  } finally {
    isConfigSaving = false;
    updateConfigActions();
  }
}

async function handleConfigDiscard() {
  await loadConfig();
  setConfigFeedback("Discarded local edits.", "success");
}

function handleConfigInput(event) {
  if (!event.target.matches(".config-field__input")) {
    return;
  }

  const dirty = hasConfigChanges();
  setConfigFeedback(dirty ? "Unsaved changes." : "", dirty ? "pending" : "");
  updateConfigActions();
}

window.agentAPI.onStreamChunk(({ requestId, chunk }) => {
  if (requestId !== activeRequestId) {
    return;
  }

  response.textContent += chunk;
});

buildConfigFields();

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActivePage(button.dataset.pageTarget);
  });
});

send.addEventListener("click", run);
prompt.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    run();
  }
});
configForm.addEventListener("submit", handleConfigSave);
configForm.addEventListener("input", handleConfigInput);
discard.addEventListener("click", handleConfigDiscard);

(async function initialize() {
  await loadConfig();
  await refreshStatus();
  setActivePage("chat");
})();

setInterval(refreshStatus, 2000);
