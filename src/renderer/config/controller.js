const configFieldDefinitions = [
  {
    key: "backendPort",
    labelKey: "config.field.backendPort.label",
    hintKey: "config.field.backendPort.hint",
  },
  {
    key: "openaiApiKey",
    labelKey: "config.field.openaiApiKey.label",
    hintKey: "config.field.openaiApiKey.hint",
  },
  {
    key: "openaiChatModel",
    labelKey: "config.field.openaiChatModel.label",
    hintKey: "config.field.openaiChatModel.hint",
  },
  {
    key: "openaiEndpoint",
    labelKey: "config.field.openaiEndpoint.label",
    hintKey: "config.field.openaiEndpoint.hint",
  },
  {
    key: "appLanguage",
    labelKey: "config.field.appLanguage.label",
    hintKey: "config.field.appLanguage.hint",
    control: "select",
    options: [
      { value: "zh-CN", labelKey: "config.language.zhCN" },
      { value: "en", labelKey: "config.language.en" },
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
  i18n,
}) {
  let savedConfig = null;
  let configInputs = {};
  let isConfigSaving = false;

  function t(key, params) {
    return i18n.t(key, params);
  }

  function buildConfigFields() {
    configFields.replaceChildren(
      ...configFieldDefinitions.map(({ key, labelKey, hintKey, control }) => {
        const wrapper = document.createElement("label");
        const inputId = `config-${key}`;
        wrapper.className = `config-field${control === "checkbox" ? " config-field--checkbox" : ""}`;
        wrapper.htmlFor = inputId;
        wrapper.innerHTML = control === "checkbox"
          ? `
            <div class="config-field__toggle-row">
              <div>
                <span class="config-field__label">${t(labelKey)}</span>
                <span class="config-field__hint">${t(hintKey)}</span>
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
            <span class="config-field__label">${t(labelKey)}</span>
            <span class="config-field__hint">${t(hintKey)}</span>
            <select
              id="${inputId}"
              class="config-field__input config-field__select"
              data-config-key="${key}"
            >
              ${configFieldDefinitions
                .find((field) => field.key === key)
                .options.map(
                  ({ value, labelKey: optionLabelKey }) =>
                    `<option value="${value}">${t(optionLabelKey)}</option>`
                )
                .join("")}
            </select>
          `
          : `
            <span class="config-field__label">${t(labelKey)}</span>
            <span class="config-field__hint">${t(hintKey)}</span>
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
    saveConfigButton.textContent = isConfigSaving ? t("config.saving") : t("config.save");
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
    setConfigFeedback(t("config.feedback.saving"), "pending");

    try {
      const saved = await window.configAPI.save(getConfigDraft());
      populateConfigForm(saved);
      setConfigFeedback(t("config.feedback.saved"), "success");
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
    setConfigFeedback(t("config.feedback.discarded"), "success");
  }

  function handleConfigInput(event) {
    if (!event.target.matches(".config-field__input, .config-field__checkbox")) {
      return;
    }

    const dirty = hasConfigChanges();
    setConfigFeedback(dirty ? t("config.feedback.unsaved") : "", dirty ? "pending" : "");
    updateConfigActions();
  }

  function refreshTranslations() {
    const draft = savedConfig ? getConfigDraft() : null;
    const baseline = savedConfig ? { ...savedConfig } : null;
    buildConfigFields();
    if (baseline) {
      populateConfigForm(baseline);
      if (draft) {
        configFieldDefinitions.forEach(({ key, control }) => {
          if (control === "checkbox") {
            configInputs[key].checked = Boolean(draft[key]);
            return;
          }
          configInputs[key].value = draft[key] == null ? "" : String(draft[key]);
        });
      }
      savedConfig = baseline;
    }
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
    refreshTranslations,
  };
}

export { createConfigController };
