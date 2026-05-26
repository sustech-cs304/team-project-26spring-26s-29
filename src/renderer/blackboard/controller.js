import { formatDateTime } from "../shared/datetime.js";
import { escapeHtml } from "../shared/html.js";

function createBlackboardController({
  applyAllButton,
  clearButton,
  dismissAllButton,
  empty,
  loginButton,
  loginFeedback,
  loginForm,
  openPageButton,
  passwordInput,
  meta,
  statusText,
  suggestionList,
  summary,
  usernameInput,
  rememberPasswordInput,
  syncButton,
  syncFeedback,
  i18n,
}) {
  const state = {
    status: null,
    suggestions: [],
    isBusy: false,
    savedCredentials: { username: "", password: "", rememberPassword: false },
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

  function setLoginFeedback(message = "", kind = "") {
    loginFeedback.textContent = message;
    if (kind) {
      loginFeedback.dataset.state = kind;
      return;
    }
    delete loginFeedback.dataset.state;
  }

  async function persistCredentials({ username, password, rememberPassword }) {
    const payload = {
      username: username || "",
      password: rememberPassword ? password || "" : "",
      rememberPassword: Boolean(rememberPassword && password),
    };
    try {
      if (payload.rememberPassword) {
        await window.blackboardAPI.saveCredentials({ username: payload.username, password: payload.password });
      } else {
        await window.blackboardAPI.deleteCredentials();
      }
    } catch {
      // ignore failures to persist
    }
    state.savedCredentials = payload;
  }

  function hydrateLoginForm() {
    const credentials = state.savedCredentials || { username: "", password: "", rememberPassword: false };
    usernameInput.value = credentials.username || "";
    rememberPasswordInput.checked = Boolean(credentials.rememberPassword);
    passwordInput.value = credentials.rememberPassword ? credentials.password || "" : "";
  }

  async function autoLoginIfRemembered() {
    let credentials = state.savedCredentials;
    if (!credentials || !credentials.username) {
      try {
        const remote = await window.blackboardAPI.getCredentials();
        if (remote) {
          credentials = remote;
          state.savedCredentials = remote;
          hydrateLoginForm();
        }
      } catch {
        // ignore
      }
    }
    if (state.status?.connected || !credentials || !credentials.rememberPassword || !credentials.username || !credentials.password || credentials.autoLoginAllowed === false) {
      return false;
    }

    setLoginFeedback(t("blackboard.feedback.loggingIn"), "pending");
    try {
      const result = await window.blackboardAPI.login({
        username: credentials.username,
        password: credentials.password,
      });
      if (result.connected) {
        setLoginFeedback(t("blackboard.feedback.loginSucceeded"), "success");
        try {
          await window.blackboardAPI.syncCookies();
        } catch (e) {
          // best-effort: ignore sync failures but keep UI success
        }
      } else {
        setLoginFeedback(result.lastError || t("blackboard.feedback.loginFailed"), "error");
        // Disable further auto-login attempts until user intervenes
        try {
          await window.blackboardAPI.saveCredentials({ username: credentials.username, password: credentials.password, autoLoginAllowed: false });
          state.savedCredentials = { ...credentials, autoLoginAllowed: false };
        } catch {}
      }
    } catch (error) {
      setLoginFeedback(error?.message || t("blackboard.feedback.loginFailed"), "error");
      try {
        await window.blackboardAPI.saveCredentials({ username: credentials.username, password: credentials.password, autoLoginAllowed: false });
        state.savedCredentials = { ...credentials, autoLoginAllowed: false };
      } catch {}
    }

    return true;
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
    openPageButton.disabled = state.isBusy || !state.status?.connected;
    usernameInput.disabled = state.isBusy;
    passwordInput.disabled = state.isBusy;
    rememberPasswordInput.disabled = state.isBusy;
  }

  async function refreshState() {
    state.status = await window.blackboardAPI.refreshStatus();
    state.suggestions = await window.blackboardAPI.listSuggestions();
    render();
  }

  async function refresh({ autoLogin = false } = {}) {
    try {
      if (autoLogin && !state.status?.connected) {
        await autoLoginIfRemembered();
      }
      await refreshState();
    } catch (error) {
      setFeedback(error?.message || String(error), "error");
    }
  }

  async function openPage() {
    if (!state.status?.connected) {
      setLoginFeedback(t("blackboard.feedback.loginFailed"), "error");
      return;
    }

    try {
      const result = await window.blackboardAPI.openLogin();
      if (result?.opened) {
        setLoginFeedback(t("blackboard.feedback.pageOpened"), "pending");
        return;
      }

      setLoginFeedback(t("blackboard.feedback.loginFailed"), "error");
    } catch (error) {
      setLoginFeedback(error?.message || t("blackboard.feedback.loginFailed"), "error");
    }
  }

  async function login(event) {
    event.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      setLoginFeedback(t("blackboard.feedback.loginFailed"), "error");
      return;
    }

    setBusy(true);
    setLoginFeedback(t("blackboard.feedback.loggingIn"), "pending");
    try {
      const result = await window.blackboardAPI.login({ username, password });
      await persistCredentials({ username, password, rememberPassword: rememberPasswordInput.checked });
      await refresh();
      if (result.connected) {
        setLoginFeedback(t("blackboard.feedback.loginSucceeded"), "success");
        setFeedback("", "");
        render();
        return;
      }
      setLoginFeedback(result.lastError || t("blackboard.feedback.loginFailed"), "error");
      render();
    } catch (error) {
      setLoginFeedback(error?.message || t("blackboard.feedback.loginFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function clearLogin() {
    setBusy(true);
    setFeedback(t("blackboard.feedback.clearing"), "pending");
    try {
      await window.blackboardAPI.clearLogin();
      try {
        await window.blackboardAPI.deleteCredentials();
        state.savedCredentials = { username: "", password: "", rememberPassword: false };
      } catch {}
      await refreshState();
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
      await refreshState();
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
    hydrateLoginForm();
    render();
    (async () => {
      try {
        const creds = await window.blackboardAPI.getCredentials();
        if (creds) {
          state.savedCredentials = creds;
          hydrateLoginForm();
          render();
        }
      } catch (err) {
        // ignore
      }
    })();
    loginForm.addEventListener("submit", login);
    openPageButton.addEventListener("click", openPage);
    clearButton.addEventListener("click", clearLogin);
    syncButton.addEventListener("click", sync);
    applyAllButton.addEventListener("click", () => apply(state.suggestions.map((item) => item.id)));
    dismissAllButton.addEventListener("click", () => dismiss(state.suggestions.map((item) => item.id)));
    suggestionList.addEventListener("click", handleSuggestionClick);
  }

  return {
    init,
    loadOnStartup: refresh,
    refreshOnForeground: () => refresh({ autoLogin: true }),
    refreshTranslations: render,
  };
}

export { createBlackboardController };
