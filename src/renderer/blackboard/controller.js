import { formatDateTime } from "../shared/datetime.js";
import { escapeHtml } from "../shared/html.js";

function createBlackboardController({
  applyAllButton,
  clearButton,
  dismissAllButton,
  empty,
  loginButton,
  meta,
  statusText,
  suggestionList,
  summary,
  syncButton,
  syncFeedback,
  i18n,
}) {
  const state = {
    status: null,
    suggestions: [],
    isBusy: false,
  };

  function t(key, params) {
    return i18n.t(key, params);
  }

  function setBusy(nextBusy) {
    state.isBusy = nextBusy;
    render();
  }

  function setFeedback(message = "", kind = "") {
    syncFeedback.textContent = message;
    if (kind) {
      syncFeedback.dataset.state = kind;
      return;
    }
    delete syncFeedback.dataset.state;
  }

  function renderStatus() {
    const status = state.status || {};
    const user = status.user || {};
    statusText.textContent = status.connected
      ? t("blackboard.connected", { user: user.displayName || user.userName || "Blackboard" })
      : t("blackboard.notConnected");

    const learn = status.learnVersion;
    const rows = [
      [t("blackboard.loginState"), status.needsLogin ? t("blackboard.needsLogin") : t("blackboard.ready")],
      [t("blackboard.version"), learn ? `${learn.major}.${learn.minor}.${learn.patch}-${learn.build}` : "-"],
      [t("blackboard.lastSync"), formatDateTime(status.lastSyncAt, i18n.locale)],
      [t("blackboard.lastError"), status.lastError || "-"],
    ];
    meta.replaceChildren(...rows.map(([label, value]) => {
      const fragment = document.createDocumentFragment();
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      fragment.append(term, description);
      return fragment;
    }));
  }

  function renderSummary() {
    const data = state.status?.lastSummary || {};
    const cards = [
      [t("blackboard.summary.courses"), data.courses ?? 0],
      [t("blackboard.summary.announcements"), data.announcements ?? 0],
      [t("blackboard.summary.contents"), data.contentItems ?? 0],
      [t("blackboard.summary.grades"), data.gradebookColumns ?? 0],
      [t("blackboard.summary.changed"), data.changedItems ?? 0],
      [t("blackboard.summary.suggestions"), data.newSuggestions ?? 0],
    ];
    summary.innerHTML = cards.map(([label, value]) => `
      <div class="blackboard-summary__item">
        <strong>${escapeHtml(String(value))}</strong>
        <span>${escapeHtml(label)}</span>
      </div>
    `).join("");
  }

  function renderSuggestions() {
    const disabled = state.isBusy ? "disabled" : "";
    suggestionList.innerHTML = state.suggestions.map((suggestion) => `
      <article class="blackboard-suggestion" data-suggestion-id="${suggestion.id}">
        <div class="blackboard-suggestion__main">
          <span class="blackboard-badge">${escapeHtml(labelForAction(suggestion.action))}</span>
          <h4>${escapeHtml(suggestion.title)}</h4>
          <p>${escapeHtml(suggestion.reason || "")}</p>
          <p class="blackboard-muted">${escapeHtml(formatSuggestionTime(suggestion))}</p>
          <details>
            <summary>${escapeHtml(t("blackboard.detail"))}</summary>
            <pre>${escapeHtml(suggestion.detail || "")}</pre>
          </details>
        </div>
        <div class="blackboard-suggestion__actions">
          <button class="button" data-blackboard-action="apply" data-suggestion-id="${suggestion.id}" type="button" ${disabled}>${escapeHtml(t("blackboard.apply"))}</button>
          <button class="button button--secondary" data-blackboard-action="dismiss" data-suggestion-id="${suggestion.id}" type="button" ${disabled}>${escapeHtml(t("blackboard.dismiss"))}</button>
        </div>
      </article>
    `).join("");
    empty.hidden = state.suggestions.length !== 0;
  }

  function labelForAction(action) {
    if (action === "create_schedule") {
      return t("blackboard.action.schedule");
    }
    if (action === "ignore") {
      return t("blackboard.action.ignore");
    }
    return t("blackboard.action.todo");
  }

  function formatSuggestionTime(suggestion) {
    if (suggestion.action === "create_schedule") {
      return `${formatDateTime(suggestion.startAt, i18n.locale)} - ${formatDateTime(suggestion.endAt, i18n.locale)}`;
    }
    return formatDateTime(suggestion.dueAt, i18n.locale);
  }

  function render() {
    renderStatus();
    renderSummary();
    renderSuggestions();
    loginButton.disabled = state.isBusy;
    clearButton.disabled = state.isBusy;
    syncButton.disabled = state.isBusy;
    applyAllButton.disabled = state.isBusy || state.suggestions.length === 0;
    dismissAllButton.disabled = state.isBusy || state.suggestions.length === 0;
  }

  async function refresh() {
    try {
      state.status = await window.blackboardAPI.getStatus();
      state.suggestions = await window.blackboardAPI.listSuggestions();
      render();
    } catch (error) {
      setFeedback(error?.message || String(error), "error");
    }
  }

  async function openLogin() {
    await window.blackboardAPI.openLogin();
    setFeedback(t("blackboard.feedback.loginOpened"), "pending");
  }

  async function clearLogin() {
    setBusy(true);
    setFeedback(t("blackboard.feedback.clearing"), "pending");
    try {
      state.status = await window.blackboardAPI.clearLogin();
      state.suggestions = await window.blackboardAPI.listSuggestions();
      setFeedback(t("blackboard.feedback.cleared"), "success");
    } catch (error) {
      setFeedback(error?.message || String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    setFeedback(t("blackboard.feedback.syncing"), "pending");
    try {
      state.status = await window.blackboardAPI.sync();
      state.suggestions = await window.blackboardAPI.listSuggestions();
      setFeedback(t("blackboard.feedback.synced"), "success");
    } catch (error) {
      setFeedback(error?.message || String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function apply(ids) {
    setBusy(true);
    setFeedback(t("blackboard.feedback.applying"), "pending");
    try {
      await window.blackboardAPI.applySuggestions(ids);
      await refresh();
      setFeedback(t("blackboard.feedback.applied"), "success");
    } catch (error) {
      setFeedback(error?.message || String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(ids) {
    setBusy(true);
    setFeedback(t("blackboard.feedback.dismissing"), "pending");
    try {
      await window.blackboardAPI.dismissSuggestions(ids);
      await refresh();
      setFeedback(t("blackboard.feedback.dismissed"), "success");
    } catch (error) {
      setFeedback(error?.message || String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  function handleSuggestionClick(event) {
    const target = event.target.closest("[data-blackboard-action]");
    if (!target || state.isBusy) {
      return;
    }
    const id = Number(target.dataset.suggestionId);
    if (!Number.isInteger(id)) {
      return;
    }
    if (target.dataset.blackboardAction === "apply") {
      void apply([id]);
      return;
    }
    void dismiss([id]);
  }

  function init() {
    render();
    loginButton.addEventListener("click", openLogin);
    clearButton.addEventListener("click", clearLogin);
    syncButton.addEventListener("click", sync);
    applyAllButton.addEventListener("click", () => apply(state.suggestions.map((item) => item.id)));
    dismissAllButton.addEventListener("click", () => dismiss(state.suggestions.map((item) => item.id)));
    suggestionList.addEventListener("click", handleSuggestionClick);
  }

  return {
    init,
    loadOnStartup: refresh,
    refreshOnForeground: refresh,
    refreshTranslations: render,
  };
}

export { createBlackboardController };
