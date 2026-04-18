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

function createConfigController({
  configForm,
  configFields,
  configFeedback,
  discard,
  saveConfigButton,
  onSaved,
}) {
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

  async function refreshOnForeground() {
    if (isConfigSaving || hasConfigChanges()) {
      return;
    }

    try {
      await loadConfig();
    } catch (error) {
      setConfigFeedback(error?.message || String(error), "error");
    }
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
      if (typeof onSaved === "function") {
        await onSaved(saved);
      }
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

  function init() {
    buildConfigFields();
    configForm.addEventListener("submit", handleConfigSave);
    configForm.addEventListener("input", handleConfigInput);
    discard.addEventListener("click", handleConfigDiscard);
  }

  return {
    init,
    loadConfig,
    refreshOnForeground,
  };
}

export { createConfigController };
