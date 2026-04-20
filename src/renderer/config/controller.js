const configFieldDefinitions = [
  {
    key: "backendPort",
    label: "Backend Port",
    hint: "Port used for the local Python backend process on 127.0.0.1.",
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
  {
    key: "motdLanguage",
    label: "MOTD Language",
    hint: "Language used for the startup message in Chat.",
    control: "select",
    options: [
      { value: "zh-CN", label: "简体中文" },
      { value: "en", label: "English" },
    ],
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
      ...configFieldDefinitions.map(({ key, label, hint, control }) => {
        const wrapper = document.createElement("label");
        const inputId = `config-${key}`;
        wrapper.className = `config-field${control === "checkbox" ? " config-field--checkbox" : ""}`;
        wrapper.htmlFor = inputId;
        wrapper.innerHTML = control === "checkbox"
          ? `
            <div class="config-field__toggle-row">
              <div>
                <span class="config-field__label">${label}</span>
                <span class="config-field__hint">${hint}</span>
              </div>
              <input
                id="${inputId}"
                class="config-field__checkbox"
                data-config-key="${key}"
                type="checkbox"
              />
            </div>
          `
          : control === "select"
            ? `
            <span class="config-field__label">${label}</span>
            <span class="config-field__hint">${hint}</span>
            <select
              id="${inputId}"
              class="config-field__input config-field__select"
              data-config-key="${key}"
            >
              ${configFieldDefinitions
                .find((field) => field.key === key)
                .options.map(
                  ({ value, label: optionLabel }) =>
                    `<option value="${value}">${optionLabel}</option>`
                )
                .join("")}
            </select>
          `
          : `
            <span class="config-field__label">${label}</span>
            <span class="config-field__hint">${hint}</span>
            <textarea
              id="${inputId}"
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

  function getConfigDraft() {
    return Object.fromEntries(
      configFieldDefinitions.map(({ key, control }) => [
        key,
        control === "checkbox" ? Boolean(configInputs[key].checked) : configInputs[key].value,
      ]),
    );
  }

  function hasConfigChanges() {
    if (!savedConfig) {
      return false;
    }

    const draft = getConfigDraft();
    return configFieldDefinitions.some(
      ({ key }) => String(draft[key] ?? "").trim() !== String(savedConfig[key] ?? "").trim(),
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

    configFieldDefinitions.forEach(({ key, control }) => {
      if (control === "checkbox") {
        configInputs[key].checked = Boolean(config[key]);
        return;
      }

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
    if (!event.target.matches(".config-field__input, .config-field__checkbox")) {
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
    configForm.addEventListener("change", handleConfigInput);
    discard.addEventListener("click", handleConfigDiscard);
  }

  return {
    init,
    loadConfig,
    refreshOnForeground,
  };
}

export { createConfigController };
