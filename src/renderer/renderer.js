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
const todoCreateForm = $("todo-create-form");
const todoTitleInput = $("todo-title-input");
const todoDetailInput = $("todo-detail-input");
const todoDueInput = $("todo-due-input");
const todoList = $("todo-list");
const todoEmpty = $("todo-empty");
const todoFeedback = $("todo-feedback");
const todoClearCompleted = $("todo-clear-completed");
const todoClearAll = $("todo-clear-all");
const todoFilterButtons = Array.from(document.querySelectorAll("[data-todo-filter]"));
const navButtons = Array.from(document.querySelectorAll("[data-page-target]"));
const pages = Array.from(document.querySelectorAll("[data-page]"));

const TODO_ERROR_PREFIX = "TODO_ERROR|";

let isRunning = false;
let activeRequestId = null;
let savedConfig = null;
let configInputs = {};
let isConfigSaving = false;
let todoState = {
  items: [],
  filter: "all",
  editingId: null,
  isBusy: false,
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return dateFormatter.format(date);
}

function toDateTimeLocalValue(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function isOverdue(todo) {
  if (todo.isDone || !todo.dueAt) {
    return false;
  }

  const dueDate = new Date(todo.dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  return dueDate.getTime() < Date.now();
}

function setTodoFeedback(message = "", state = "") {
  todoFeedback.textContent = message;
  if (state) {
    todoFeedback.dataset.state = state;
    return;
  }

  delete todoFeedback.dataset.state;
}

function parseTodoId(rawId) {
  const parsed = Number.parseInt(String(rawId), 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }

  return parsed;
}

function normalizeTodoItem(rawTodo) {
  const parsedId = parseTodoId(rawTodo?.id);
  if (parsedId === null) {
    throw new Error("Invalid todo id returned from backend.");
  }

  return {
    id: parsedId,
    title: String(rawTodo?.title ?? ""),
    detail: String(rawTodo?.detail ?? ""),
    dueAt: rawTodo?.dueAt ?? null,
    isDone: Boolean(rawTodo?.isDone),
    completedAt: rawTodo?.completedAt ?? null,
    createdAt: String(rawTodo?.createdAt ?? ""),
    updatedAt: String(rawTodo?.updatedAt ?? ""),
  };
}

function getTodoErrorMessage(error) {
  const rawMessage = error?.message || String(error) || "Todo request failed.";

  if (rawMessage.startsWith(TODO_ERROR_PREFIX)) {
    const encoded = rawMessage.slice(TODO_ERROR_PREFIX.length);
    const separatorIndex = encoded.indexOf("|");
    const category = separatorIndex < 0 ? encoded : encoded.slice(0, separatorIndex);
    const detail = separatorIndex < 0 ? "" : encoded.slice(separatorIndex + 1);

    if (category === "network") {
      return "Network error: cannot connect to backend service. Check backend host and port settings.";
    }
    if (category === "not-found") {
      return "Task not found. It may have been deleted in another operation. Please refresh and retry.";
    }
    if (category === "validation") {
      return detail ? `Invalid input: ${detail}` : "Invalid input. Please check required fields and try again.";
    }
    if (category === "server") {
      return detail ? `Server error: ${detail}` : "Server error. Please retry in a moment.";
    }
  }

  if (rawMessage.includes("Cannot reach backend service") || rawMessage.includes("Failed to fetch")) {
    return "Network error: cannot connect to backend service. Check backend host and port settings.";
  }

  if (rawMessage.includes("does not exist")) {
    return "Task not found. It may have been deleted in another operation. Please refresh and retry.";
  }

  return rawMessage;
}

async function reloadTodos() {
  const payload = await window.todoAPI.list();
  if (!Array.isArray(payload)) {
    throw new Error("Invalid todo list response from backend.");
  }

  todoState.items = payload.map(normalizeTodoItem);
}

function setTodoBusy(nextBusy) {
  todoState.isBusy = nextBusy;
  renderTodoList();
}

async function runTodoMutation(action, pendingMessage, onSuccess) {
  if (todoState.isBusy) {
    return false;
  }

  setTodoBusy(true);
  setTodoFeedback(pendingMessage, "pending");

  try {
    const result = await action();
    await reloadTodos();
    todoState.editingId = null;

    if (typeof onSuccess === "function") {
      onSuccess(result);
    } else {
      setTodoFeedback("", "");
    }

    return true;
  } catch (error) {
    setTodoFeedback(getTodoErrorMessage(error), "error");
    return false;
  } finally {
    setTodoBusy(false);
  }
}

async function loadTodosOnStartup() {
  setTodoBusy(true);
  setTodoFeedback("Loading tasks...", "pending");

  try {
    await reloadTodos();
    setTodoFeedback("", "");
  } catch (error) {
    setTodoFeedback(getTodoErrorMessage(error), "error");
  } finally {
    setTodoBusy(false);
  }
}

function getVisibleTodos() {
  switch (todoState.filter) {
    case "active":
      return todoState.items.filter((todo) => !todo.isDone);
    case "done":
      return todoState.items.filter((todo) => todo.isDone);
    case "overdue":
      return todoState.items.filter((todo) => isOverdue(todo));
    default:
      return todoState.items;
  }
}

function renderTodoFilters() {
  todoFilterButtons.forEach((button) => {
    const isActive = button.dataset.todoFilter === todoState.filter;
    button.classList.toggle("is-active", isActive);
    button.disabled = todoState.isBusy;
    if (isActive) {
      button.setAttribute("aria-current", "true");
      return;
    }

    button.removeAttribute("aria-current");
  });
}

function renderTodoBulkActions() {
  const hasItems = todoState.items.length > 0;
  const hasDoneItems = todoState.items.some((item) => item.isDone);

  todoClearAll.disabled = todoState.isBusy || !hasItems;
  todoClearCompleted.disabled = todoState.isBusy || !hasDoneItems;
}

function renderTodoList() {
  const visibleTodos = getVisibleTodos();
  const disabledAttr = todoState.isBusy ? "disabled" : "";

  const nodes = visibleTodos.map((todo) => {
    const item = document.createElement("li");
    item.className = "todo-item";
    item.dataset.todoId = String(todo.id);
    if (todo.isDone) {
      item.classList.add("is-done");
    }
    if (isOverdue(todo)) {
      item.classList.add("is-overdue");
    }

    if (todoState.editingId === todo.id) {
      item.innerHTML = `
        <div class="todo-edit-grid">
          <input class="todo-input" data-todo-edit="title" type="text" value="${escapeHtml(todo.title)}" ${disabledAttr} />
          <input class="todo-input" data-todo-edit="dueAt" type="datetime-local" value="${toDateTimeLocalValue(todo.dueAt)}" ${disabledAttr} />
          <textarea class="todo-input todo-input--textarea" data-todo-edit="detail" rows="2" ${disabledAttr}>${escapeHtml(todo.detail || "")}</textarea>
          <div class="todo-item__actions">
            <button class="button" data-todo-action="save-edit" data-todo-id="${todo.id}" type="button" ${disabledAttr}>Save</button>
            <button class="button button--secondary" data-todo-action="cancel-edit" data-todo-id="${todo.id}" type="button" ${disabledAttr}>Cancel</button>
          </div>
        </div>
      `;
      return item;
    }

    item.innerHTML = `
      <div class="todo-item__main">
        <label class="todo-check ${todo.isDone ? "is-done" : ""}" aria-label="Mark todo done">
          <input data-todo-action="toggle" data-todo-id="${todo.id}" type="checkbox" ${todo.isDone ? "checked" : ""} ${disabledAttr} />
          <span class="todo-check__text">Done</span>
        </label>
        <div class="todo-item__content">
          <p class="todo-item__title">${escapeHtml(todo.title)}</p>
          <p class="todo-item__detail">${escapeHtml(todo.detail || "No detail")}</p>
          <p class="todo-item__meta">Due: ${escapeHtml(formatDateTime(todo.dueAt))} | Updated: ${escapeHtml(formatDateTime(todo.updatedAt))}</p>
        </div>
      </div>
      <div class="todo-item__actions todo-item__actions--stacked">
        <button class="button button--secondary" data-todo-action="edit" data-todo-id="${todo.id}" type="button" ${disabledAttr}>Edit</button>
        <button class="button button--secondary" data-todo-action="delete" data-todo-id="${todo.id}" type="button" ${disabledAttr}>Delete</button>
      </div>
    `;

    return item;
  });

  todoList.replaceChildren(...nodes);
  todoEmpty.hidden = visibleTodos.length !== 0;
  renderTodoFilters();
  renderTodoBulkActions();
}

async function handleTodoCreate(event) {
  event.preventDefault();
  if (todoState.isBusy) {
    return;
  }

  const title = todoTitleInput.value.trim();
  if (!title) {
    setTodoFeedback("Title is required.", "error");
    return;
  }

  const created = await runTodoMutation(
    () =>
      window.todoAPI.create({
        title,
        detail: todoDetailInput.value.trim(),
        dueAt: fromDateTimeLocalValue(todoDueInput.value),
      }),
    "Adding task...",
    () => setTodoFeedback("Task added.", "success"),
  );

  if (created) {
    todoCreateForm.reset();
  }
}

async function handleTodoListChange(event) {
  const toggle = event.target.closest('[data-todo-action="toggle"]');
  if (!toggle || todoState.isBusy) {
    return;
  }

  const todoId = parseTodoId(toggle.dataset.todoId);
  if (todoId === null) {
    setTodoFeedback("Invalid todo id.", "error");
    return;
  }

  const checked = Boolean(toggle.checked);

  await runTodoMutation(
    () => window.todoAPI.update(todoId, { isDone: checked }),
    checked ? "Marking task done..." : "Marking task active...",
    () => setTodoFeedback(checked ? "Task marked done." : "Task marked active.", "success"),
  );
}

async function handleTodoListClick(event) {
  const actionTarget = event.target.closest("[data-todo-action]");
  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.todoAction;
  const todoId = parseTodoId(actionTarget.dataset.todoId);

  if (action === "delete") {
    if (todoId === null) {
      setTodoFeedback("Invalid todo id.", "error");
      return;
    }

    await runTodoMutation(
      () => window.todoAPI.remove(todoId),
      "Deleting task...",
      () => setTodoFeedback("Task deleted.", "success"),
    );
    return;
  }

  if (todoState.isBusy) {
    return;
  }

  if (action === "edit") {
    if (todoId === null) {
      setTodoFeedback("Invalid todo id.", "error");
      return;
    }

    todoState.editingId = todoId;
    setTodoFeedback("Editing task...", "pending");
    renderTodoList();
    return;
  }

  if (action === "cancel-edit") {
    todoState.editingId = null;
    setTodoFeedback("Edit cancelled.", "");
    renderTodoList();
    return;
  }

  if (action === "save-edit") {
    if (todoId === null) {
      setTodoFeedback("Invalid todo id.", "error");
      return;
    }

    const todoItem = actionTarget.closest(".todo-item");
    if (!todoItem) {
      return;
    }

    const titleInput = todoItem.querySelector('[data-todo-edit="title"]');
    const detailInput = todoItem.querySelector('[data-todo-edit="detail"]');
    const dueInput = todoItem.querySelector('[data-todo-edit="dueAt"]');

    const nextTitle = titleInput?.value.trim() || "";
    if (!nextTitle) {
      setTodoFeedback("Title is required.", "error");
      return;
    }

    const nextDetail = detailInput?.value.trim() || "";
    const nextDueAt = fromDateTimeLocalValue(dueInput?.value || "");

    await runTodoMutation(
      () =>
        window.todoAPI.update(todoId, {
          title: nextTitle,
          detail: nextDetail,
          dueAt: nextDueAt,
        }),
      "Updating task...",
      () => setTodoFeedback("Task updated.", "success"),
    );
  }
}

function handleTodoFilterClick(event) {
  if (todoState.isBusy) {
    return;
  }

  const target = event.currentTarget;
  const nextFilter = target.dataset.todoFilter;
  if (!nextFilter || nextFilter === todoState.filter) {
    return;
  }

  todoState.filter = nextFilter;
  todoState.editingId = null;
  renderTodoList();
}

async function clearCompletedTodos() {
  await runTodoMutation(
    () => window.todoAPI.clear("completed"),
    "Clearing completed tasks...",
    (result) => {
      const deletedCount = Number(result?.deletedCount ?? 0);
      setTodoFeedback(deletedCount ? `Cleared ${deletedCount} completed task(s).` : "No completed tasks.", "success");
    },
  );
}

async function clearAllTodos() {
  await runTodoMutation(
    () => window.todoAPI.clear("all"),
    "Clearing all tasks...",
    (result) => {
      const deletedCount = Number(result?.deletedCount ?? 0);
      setTodoFeedback(deletedCount ? "Cleared all tasks." : "Task list is already empty.", "success");
    },
  );
}

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
renderTodoList();

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
todoCreateForm.addEventListener("submit", handleTodoCreate);
todoList.addEventListener("change", handleTodoListChange);
todoList.addEventListener("click", handleTodoListClick);
todoClearCompleted.addEventListener("click", clearCompletedTodos);
todoClearAll.addEventListener("click", clearAllTodos);
todoFilterButtons.forEach((button) => {
  button.addEventListener("click", handleTodoFilterClick);
});

(async function initialize() {
  await loadConfig();
  await refreshStatus();
  await loadTodosOnStartup();
  setActivePage("chat");
})();

setInterval(refreshStatus, 2000);
