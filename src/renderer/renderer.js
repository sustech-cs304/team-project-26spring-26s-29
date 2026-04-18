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
const todoSearchInput = $("todo-search-input");
const todoSortSelect = $("todo-sort-select");
const todoUndoBar = $("todo-undo-bar");
const todoUndoText = $("todo-undo-text");
const todoUndoButton = $("todo-undo-button");
const todoFilterButtons = Array.from(document.querySelectorAll("[data-todo-filter]"));
const navButtons = Array.from(document.querySelectorAll("[data-page-target]"));
const pages = Array.from(document.querySelectorAll("[data-page]"));

const TODO_ERROR_PREFIX = "TODO_ERROR|";
const TODO_VIEW_STATE_KEY = "todo:view-state:v1";
const TODO_FILTERS = new Set(["all", "active", "done", "overdue"]);
const TODO_SORTS = new Set(["due-asc", "due-desc", "updated-desc", "title-asc"]);

function readTodoViewState() {
  const defaults = {
    filter: "all",
    searchQuery: "",
    sortMode: "due-asc",
  };

  try {
    const raw = localStorage.getItem(TODO_VIEW_STATE_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw);
    const nextFilter = TODO_FILTERS.has(parsed?.filter) ? parsed.filter : defaults.filter;
    const nextSortMode = TODO_SORTS.has(parsed?.sortMode) ? parsed.sortMode : defaults.sortMode;
    const nextSearchQuery = String(parsed?.searchQuery ?? "");

    return {
      filter: nextFilter,
      searchQuery: nextSearchQuery,
      sortMode: nextSortMode,
    };
  } catch {
    return defaults;
  }
}

const initialTodoViewState = readTodoViewState();

let isRunning = false;
let activeRequestId = null;
let savedConfig = null;
let configInputs = {};
let isConfigSaving = false;
let todoState = {
  items: [],
  filter: initialTodoViewState.filter,
  searchQuery: initialTodoViewState.searchQuery,
  sortMode: initialTodoViewState.sortMode,
  editingId: null,
  isBusy: false,
  undoTodo: null,
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

function persistTodoViewState() {
  try {
    localStorage.setItem(
      TODO_VIEW_STATE_KEY,
      JSON.stringify({
        filter: todoState.filter,
        searchQuery: todoState.searchQuery,
        sortMode: todoState.sortMode,
      }),
    );
  } catch {
    // Ignore persistence failures (e.g. storage disabled).
  }
}

function renderTodoUndoBar() {
  const hasUndo = Boolean(todoState.undoTodo);
  todoUndoBar.hidden = !hasUndo;
  todoUndoButton.disabled = todoState.isBusy || !hasUndo;

  if (!hasUndo) {
    todoUndoText.textContent = "Task deleted.";
    return;
  }

  todoUndoText.textContent = `Deleted \"${todoState.undoTodo.title}\". You can undo before your next action.`;
}

function clearTodoUndo() {
  todoState.undoTodo = null;
  renderTodoUndoBar();
}

function armTodoUndo(todo) {
  clearTodoUndo();
  todoState.undoTodo = {
    title: todo.title,
    detail: todo.detail,
    dueAt: todo.dueAt,
    isDone: todo.isDone,
  };
  renderTodoUndoBar();
}

function getComparableDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.getTime();
}

function compareNullableDate(leftValue, rightValue, mode = "asc") {
  const left = getComparableDate(leftValue);
  const right = getComparableDate(rightValue);
  const leftMissing = left == null;
  const rightMissing = right == null;

  if (leftMissing && rightMissing) {
    return 0;
  }
  if (leftMissing) {
    return 1;
  }
  if (rightMissing) {
    return -1;
  }

  return mode === "asc" ? left - right : right - left;
}

function compareTodos(left, right) {
  switch (todoState.sortMode) {
    case "due-desc": {
      const dueCompare = compareNullableDate(left.dueAt, right.dueAt, "desc");
      if (dueCompare !== 0) {
        return dueCompare;
      }
      return compareNullableDate(left.updatedAt, right.updatedAt, "desc");
    }
    case "updated-desc": {
      const updatedCompare = compareNullableDate(left.updatedAt, right.updatedAt, "desc");
      if (updatedCompare !== 0) {
        return updatedCompare;
      }
      return compareNullableDate(left.dueAt, right.dueAt, "asc");
    }
    case "title-asc":
      return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
    case "due-asc":
    default: {
      const dueCompare = compareNullableDate(left.dueAt, right.dueAt, "asc");
      if (dueCompare !== 0) {
        return dueCompare;
      }
      return compareNullableDate(left.updatedAt, right.updatedAt, "desc");
    }
  }
}

function matchesTodoSearch(todo, normalizedQuery) {
  if (!normalizedQuery) {
    return true;
  }

  const haystack = `${todo.title}\n${todo.detail}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}

function getTodoGroupKey(todo) {
  if (todo.isDone) {
    return "done";
  }

  if (isOverdue(todo)) {
    return "overdue";
  }

  if (!todo.dueAt) {
    return "no-due";
  }

  const dueDate = new Date(todo.dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    return "no-due";
  }

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;

  if (dueDate.getTime() >= todayStart && dueDate.getTime() < tomorrowStart) {
    return "today";
  }

  return "upcoming";
}

function groupTodos(todos) {
  const groupsMap = new Map();

  todos.forEach((todo) => {
    const key = getTodoGroupKey(todo);
    if (!groupsMap.has(key)) {
      groupsMap.set(key, []);
    }
    groupsMap.get(key).push(todo);
  });

  const ordered = ["overdue", "today", "upcoming", "no-due", "done"];
  const labels = {
    overdue: "Overdue",
    today: "Today",
    upcoming: "Upcoming",
    "no-due": "No Due Date",
    done: "Done",
  };

  return ordered
    .filter((key) => groupsMap.has(key))
    .map((key) => ({
      key,
      label: labels[key] || key,
      items: groupsMap.get(key),
    }));
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

async function runTodoMutation(action, pendingMessage, onSuccess, options = {}) {
  const { consumeUndo = true } = options;

  if (todoState.isBusy) {
    return false;
  }

  if (consumeUndo) {
    clearTodoUndo();
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
  let filteredTodos;

  switch (todoState.filter) {
    case "active":
      filteredTodos = todoState.items.filter((todo) => !todo.isDone);
      break;
    case "done":
      filteredTodos = todoState.items.filter((todo) => todo.isDone);
      break;
    case "overdue":
      filteredTodos = todoState.items.filter((todo) => isOverdue(todo));
      break;
    default:
      filteredTodos = todoState.items;
      break;
  }

  const normalizedQuery = todoState.searchQuery.trim().toLowerCase();
  const searchedTodos = filteredTodos.filter((todo) => matchesTodoSearch(todo, normalizedQuery));
  return [...searchedTodos].sort(compareTodos);
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

function createTodoListItem(todo, disabledAttr) {
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
}

function renderTodoList() {
  const visibleTodos = getVisibleTodos();
  const disabledAttr = todoState.isBusy ? "disabled" : "";
  const groups = groupTodos(visibleTodos);

  const groupNodes = groups.map((group) => {
    const section = document.createElement("section");
    section.className = "todo-group";

    const header = document.createElement("header");
    header.className = "todo-group__header";
    header.innerHTML = `
      <h3 class="todo-group__title">${escapeHtml(group.label)}</h3>
      <span class="todo-group__count">${group.items.length}</span>
    `;

    const itemsList = document.createElement("ul");
    itemsList.className = "todo-group__items";
    const itemNodes = group.items.map((todo) => createTodoListItem(todo, disabledAttr));
    itemsList.replaceChildren(...itemNodes);

    section.append(header, itemsList);
    return section;
  });

  todoList.replaceChildren(...groupNodes);
  todoEmpty.hidden = visibleTodos.length !== 0;

  if (todoSearchInput.value !== todoState.searchQuery) {
    todoSearchInput.value = todoState.searchQuery;
  }
  if (todoSortSelect.value !== todoState.sortMode) {
    todoSortSelect.value = todoState.sortMode;
  }
  todoSearchInput.disabled = todoState.isBusy;
  todoSortSelect.disabled = todoState.isBusy;

  renderTodoFilters();
  renderTodoBulkActions();
  renderTodoUndoBar();
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

    const deletedTodo = todoState.items.find((item) => item.id === todoId);

    await runTodoMutation(
      () => window.todoAPI.remove(todoId),
      "Deleting task...",
      () => {
        if (deletedTodo) {
          armTodoUndo(deletedTodo);
        }
        setTodoFeedback("Task deleted. Undo is available until your next action.", "success");
      },
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
  persistTodoViewState();
  renderTodoList();
}

function handleTodoSearchInput(event) {
  if (todoState.isBusy) {
    return;
  }

  todoState.searchQuery = String(event.target.value ?? "");
  persistTodoViewState();
  renderTodoList();
}

function handleTodoSortChange(event) {
  if (todoState.isBusy) {
    return;
  }

  const nextSort = String(event.target.value ?? "");
  if (!TODO_SORTS.has(nextSort) || nextSort === todoState.sortMode) {
    return;
  }

  todoState.sortMode = nextSort;
  persistTodoViewState();
  renderTodoList();
}

async function handleTodoUndo() {
  if (todoState.isBusy || !todoState.undoTodo) {
    return;
  }

  const snapshot = { ...todoState.undoTodo };
  clearTodoUndo();

  const restored = await runTodoMutation(
    async () => {
      const created = await window.todoAPI.create({
        title: snapshot.title,
        detail: snapshot.detail,
        dueAt: snapshot.dueAt,
      });

      const createdId = parseTodoId(created?.id);
      if (snapshot.isDone && createdId !== null) {
        await window.todoAPI.update(createdId, { isDone: true });
      }
    },
    "Restoring task...",
    () => {
      setTodoFeedback("Task restored.", "success");
    },
    { consumeUndo: false },
  );

  if (!restored) {
    armTodoUndo(snapshot);
  }
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

// --- Schedule UI and interactions ---
const scheduleCalendar = $("schedule-calendar");
const scheduleCurrentMonth = $("schedule-current-month");
const schedulePrev = $("schedule-prev");
const scheduleNext = $("schedule-next");
const scheduleCreateForm = $("schedule-create-form");
const scheduleTitleInput = $("schedule-title-input");
const scheduleStartInput = $("schedule-start-input");
const scheduleEndInput = $("schedule-end-input");
const scheduleDetailInput = $("schedule-detail-input");
const scheduleCreateButton = $("schedule-create-button");
const scheduleFeedback = $("schedule-feedback");
const scheduleList = $("schedule-list");

let scheduleState = {
  items: [],
  currentMonth: new Date(),
  selectedDate: null,
  editingId: null,
  isBusy: false,
};

function parseScheduleId(rawId) {
  const parsed = Number.parseInt(String(rawId), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeScheduleItem(raw) {
  const parsedId = parseScheduleId(raw?.id);
  if (parsedId === null) {
    throw new Error("Invalid schedule id returned from backend.");
  }

  return {
    id: parsedId,
    title: String(raw?.title ?? ""),
    detail: String(raw?.detail ?? ""),
    start_at: raw?.startAt ?? raw?.start_at,
    end_at: raw?.endAt ?? raw?.end_at,
    all_day: Boolean(raw?.allDay ?? raw?.all_day),
    is_done: Boolean(raw?.isDone ?? raw?.is_done ?? false),
    completed_at: raw?.completedAt ?? raw?.completed_at ?? null,
    recurrence: raw?.recurrence ?? null,
    location: raw?.location ?? null,
    created_at: String(raw?.createdAt ?? raw?.created_at ?? ""),
    updated_at: String(raw?.updatedAt ?? raw?.updated_at ?? ""),
  };
}

function monthRangeFor(date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

async function loadSchedulesForMonth(date) {
  scheduleState.isBusy = true;
  renderScheduleFeedback("Loading events...", "pending");
  try {
    const range = monthRangeFor(date);
    const payload = await window.scheduleAPI.listRange(range.start, range.end);
    scheduleState.items = Array.isArray(payload) ? payload.map(normalizeScheduleItem) : [];
    scheduleState.currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    renderScheduleCalendar();
    if (scheduleState.selectedDate) {
      renderScheduleDay(scheduleState.selectedDate);
    }
    renderScheduleFeedback("", "");
  } catch (error) {
    renderScheduleFeedback(error?.message || String(error), "error");
  } finally {
    scheduleState.isBusy = false;
  }
}

function renderScheduleFeedback(message = "", state = "") {
  if (!scheduleFeedback) return;
  scheduleFeedback.textContent = message;
  if (state) {
    scheduleFeedback.dataset.state = state;
    return;
  }
  delete scheduleFeedback.dataset.state;
}

function eventsForDay(date) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return scheduleState.items.filter((ev) => {
    const s = new Date(ev.start_at);
    const e = new Date(ev.end_at);
    return e > dayStart && s < dayEnd;
  });
}

function renderScheduleCalendar() {
  if (!scheduleCalendar) return;
  const year = scheduleState.currentMonth.getFullYear();
  const month = scheduleState.currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startIndex = firstDay.getDay();
  const totalCells = 42;

  const cells = [];
  for (let i = 0; i < totalCells; i += 1) {
    const dayNumber = i - startIndex + 1;
    const cellDate = new Date(year, month, dayNumber);
    const inMonth = dayNumber > 0 && cellDate.getMonth() === month;
    const events = inMonth ? eventsForDay(cellDate) : [];

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "calendar-day-btn";
    btn.dataset.day = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, "0")}-${String(cellDate.getDate()).padStart(2, "0")}`;
    btn.setAttribute("aria-label", cellDate.toLocaleDateString());

    if (!inMonth) {
      btn.disabled = true;
      btn.classList.add("is-disabled");
    } else {
      btn.textContent = String(cellDate.getDate());
    }

    if (events.length) {
      const badge = document.createElement("span");
      badge.className = "calendar-badge";
      badge.textContent = String(events.length);
      btn.appendChild(badge);
    }

    if (scheduleState.selectedDate) {
      const sel = scheduleState.selectedDate;
      if (
        sel.getFullYear() === cellDate.getFullYear() &&
        sel.getMonth() === cellDate.getMonth() &&
        sel.getDate() === cellDate.getDate()
      ) {
        btn.classList.add("is-selected");
      }
    }

    btn.addEventListener("click", () => {
      scheduleState.selectedDate = new Date(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
      renderScheduleCalendar();
      renderScheduleDay(scheduleState.selectedDate);
    });

    cells.push(btn);
  }

  scheduleCalendar.replaceChildren(...cells);
  if (scheduleCurrentMonth) {
    scheduleCurrentMonth.textContent = scheduleState.currentMonth.toLocaleString(undefined, { month: "long", year: "numeric" });
  }
}

function renderScheduleDay(date) {
  if (!scheduleList) return;
  const day = date || scheduleState.selectedDate || scheduleState.currentMonth;
  const items = eventsForDay(new Date(day.getFullYear(), day.getMonth(), day.getDate()));

  const nodes = items.map((ev) => {
    const item = document.createElement("li");
    item.className = "todo-item";

    if (scheduleState.editingId === ev.id) {
      item.innerHTML = `
        <div class="todo-edit-grid">
          <input class="todo-input" data-schedule-edit="title" type="text" value="${escapeHtml(ev.title)}" />
          <input class="todo-input" data-schedule-edit="startAt" type="datetime-local" value="${toDateTimeLocalValue(ev.start_at)}" />
          <input class="todo-input" data-schedule-edit="endAt" type="datetime-local" value="${toDateTimeLocalValue(ev.end_at)}" />
          <textarea class="todo-input todo-input--textarea" data-schedule-edit="detail" rows="2">${escapeHtml(ev.detail || "")}</textarea>
          <div class="todo-item__actions">
            <button class="button" data-schedule-action="save-edit" data-schedule-id="${ev.id}" type="button">Save</button>
            <button class="button button--secondary" data-schedule-action="cancel-edit" data-schedule-id="${ev.id}" type="button">Cancel</button>
          </div>
        </div>
      `;
      return item;
    }

    const checked = ev.is_done ? 'checked' : '';
    const doneClass = ev.is_done ? 'is-done' : '';

    item.innerHTML = `
      <div class="todo-item__main">
        <label class="todo-check ${doneClass}" aria-label="Mark done">
          <input data-schedule-action="toggle" data-schedule-id="${ev.id}" type="checkbox" ${checked} />
          <span class="todo-check__text">Done</span>
        </label>
        <div class="todo-item__content">
          <p class="todo-item__title">${escapeHtml(ev.title)}</p>
          <p class="todo-item__detail">${escapeHtml(ev.detail || "No detail")}</p>
          <p class="todo-item__meta">${escapeHtml(formatDateTime(ev.start_at))} — ${escapeHtml(formatDateTime(ev.end_at))}</p>
        </div>
      </div>
      <div class="todo-item__actions todo-item__actions--stacked">
        <button class="button button--secondary" data-schedule-action="edit" data-schedule-id="${ev.id}" type="button">Edit</button>
        <button class="button button--secondary" data-schedule-action="delete" data-schedule-id="${ev.id}" type="button">Delete</button>
      </div>
    `;

    return item;
  });

  scheduleList.replaceChildren(...nodes);
}

async function handleScheduleCreate(event) {
  event.preventDefault();
  if (scheduleState.isBusy) return;

  const title = scheduleTitleInput.value.trim();
  if (!title) {
    renderScheduleFeedback("Title is required.", "error");
    return;
  }

  const start = fromDateTimeLocalValue(scheduleStartInput.value);
  const end = fromDateTimeLocalValue(scheduleEndInput.value);

  try {
    await window.scheduleAPI.create({
      title,
      detail: scheduleDetailInput.value.trim(),
      startAt: start,
      endAt: end,
      allDay: false,
    });
    scheduleCreateForm.reset();
    await loadSchedulesForMonth(scheduleState.currentMonth);
    renderScheduleFeedback("Event added.", "success");
  } catch (error) {
    renderScheduleFeedback(error?.message || String(error), "error");
  }
}

async function handleScheduleListClick(event) {
  const actionTarget = event.target.closest("[data-schedule-action]");
  if (!actionTarget) return;

  const action = actionTarget.dataset.scheduleAction;
  const id = parseScheduleId(actionTarget.dataset.scheduleId);
  if (action === "delete") {
    if (id === null) {
      renderScheduleFeedback("Invalid schedule id.", "error");
      return;
    }

    try {
      await window.scheduleAPI.remove(id);
      await loadSchedulesForMonth(scheduleState.currentMonth);
      renderScheduleFeedback("Event deleted.", "success");
    } catch (error) {
      renderScheduleFeedback(error?.message || String(error), "error");
    }
    return;
  }

  if (scheduleState.isBusy) return;

  if (action === "edit") {
    if (id === null) {
      renderScheduleFeedback("Invalid schedule id.", "error");
      return;
    }
    scheduleState.editingId = id;
    renderScheduleFeedback("Editing event...", "pending");
    renderScheduleDay(scheduleState.selectedDate || scheduleState.currentMonth);
    return;
  }

  if (action === "cancel-edit") {
    scheduleState.editingId = null;
    renderScheduleFeedback("Edit cancelled.", "");
    renderScheduleDay(scheduleState.selectedDate || scheduleState.currentMonth);
    return;
  }

  if (action === "save-edit") {
    if (id === null) {
      renderScheduleFeedback("Invalid schedule id.", "error");
      return;
    }

    const item = actionTarget.closest(".todo-item");
    if (!item) return;

    const titleInput = item.querySelector('[data-schedule-edit="title"]');
    const detailInput = item.querySelector('[data-schedule-edit="detail"]');
    const startInput = item.querySelector('[data-schedule-edit="startAt"]');
    const endInput = item.querySelector('[data-schedule-edit="endAt"]');

    const nextTitle = titleInput?.value.trim() || "";
    if (!nextTitle) {
      renderScheduleFeedback("Title is required.", "error");
      return;
    }

    const nextDetail = detailInput?.value.trim() || "";
    const nextStart = fromDateTimeLocalValue(startInput?.value || "");
    const nextEnd = fromDateTimeLocalValue(endInput?.value || "");

    try {
      await window.scheduleAPI.update(id, {
        title: nextTitle,
        detail: nextDetail,
        startAt: nextStart,
        endAt: nextEnd,
      });
      scheduleState.editingId = null;
      await loadSchedulesForMonth(scheduleState.currentMonth);
      renderScheduleFeedback("Event updated.", "success");
    } catch (error) {
      renderScheduleFeedback(error?.message || String(error), "error");
    }
    return;
  }
}

async function handleScheduleListChange(event) {
  const toggle = event.target.closest('[data-schedule-action="toggle"]');
  if (!toggle || scheduleState.isBusy) return;

  const id = parseScheduleId(toggle.dataset.scheduleId);
  if (id === null) {
    renderScheduleFeedback("Invalid schedule id.", "error");
    return;
  }

  const checked = Boolean(toggle.checked);

  try {
    await window.scheduleAPI.update(id, { isDone: checked });
    await loadSchedulesForMonth(scheduleState.currentMonth);
    renderScheduleFeedback(checked ? "Event marked done." : "Event marked active.", "success");
  } catch (error) {
    renderScheduleFeedback(error?.message || String(error), "error");
  }
}

schedulePrev?.addEventListener("click", async () => {
  scheduleState.currentMonth = new Date(scheduleState.currentMonth.getFullYear(), scheduleState.currentMonth.getMonth() - 1, 1);
  await loadSchedulesForMonth(scheduleState.currentMonth);
});

scheduleNext?.addEventListener("click", async () => {
  scheduleState.currentMonth = new Date(scheduleState.currentMonth.getFullYear(), scheduleState.currentMonth.getMonth() + 1, 1);
  await loadSchedulesForMonth(scheduleState.currentMonth);
});

scheduleCreateForm?.addEventListener("submit", handleScheduleCreate);
scheduleList?.addEventListener("click", handleScheduleListClick);
scheduleList?.addEventListener("change", handleScheduleListChange);

// Initial load for schedule month
loadSchedulesForMonth(scheduleState.currentMonth).catch(() => {});

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
todoSearchInput.addEventListener("input", handleTodoSearchInput);
todoSortSelect.addEventListener("change", handleTodoSortChange);
todoUndoButton.addEventListener("click", handleTodoUndo);
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
