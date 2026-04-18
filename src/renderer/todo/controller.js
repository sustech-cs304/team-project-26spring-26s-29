import {
  formatDateTime,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from "../shared/datetime.js";
import { escapeHtml } from "../shared/html.js";

const TODO_ERROR_PREFIX = "TODO_ERROR|";
const TODO_VIEW_STATE_KEY = "todo:view-state:v1";

function createTodoController({
  todoCreateForm,
  todoTitleInput,
  todoDetailInput,
  todoDueInput,
  todoList,
  todoEmpty,
  todoFeedback,
  todoClearCompleted,
  todoClearAll,
  todoSearchInput,
  todoSortSelect,
  todoUndoBar,
  todoUndoText,
  todoUndoButton,
  todoFilterButtons,
}) {
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
      return {
        filter: String(parsed?.filter ?? defaults.filter),
        searchQuery: String(parsed?.searchQuery ?? ""),
        sortMode: String(parsed?.sortMode ?? defaults.sortMode),
      };
    } catch {
      return defaults;
    }
  }

  const initialTodoViewState = readTodoViewState();
  const todoState = {
    items: [],
    filter: initialTodoViewState.filter,
    searchQuery: initialTodoViewState.searchQuery,
    sortMode: initialTodoViewState.sortMode,
    editingId: null,
    isBusy: false,
    undoTodo: null,
  };

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

    todoUndoText.textContent = `Deleted "${todoState.undoTodo.title}". You can undo before your next action.`;
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
    todoState.items = await window.todoAPI.list();
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

    const todoId = Number(toggle.dataset.todoId);
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
    const todoId = Number(actionTarget.dataset.todoId);

    if (action === "delete") {
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
    if (nextFilter === todoState.filter) {
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
    if (nextSort === todoState.sortMode) {
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

        if (snapshot.isDone) {
          await window.todoAPI.update(created.id, { isDone: true });
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

  async function loadOnStartup() {
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

  async function refreshOnForeground() {
    if (todoState.isBusy || todoState.editingId !== null) {
      return;
    }

    setTodoBusy(true);
    try {
      await reloadTodos();
    } catch (error) {
      setTodoFeedback(getTodoErrorMessage(error), "error");
    } finally {
      setTodoBusy(false);
    }
  }

  function init() {
    renderTodoList();
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
  }

  return {
    init,
    loadOnStartup,
    refreshOnForeground,
  };
}

export { createTodoController };
