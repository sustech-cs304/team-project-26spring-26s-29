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
const messages = $("messages");
const scrollToBottomButton = $("scroll-to-bottom");
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
const MESSAGE_PREVIEW_MAX_LENGTH = 180;
const MESSAGE_COLLAPSE_THRESHOLD = 140;
const BOTTOM_SCROLL_THRESHOLD = 80;
const PROMPT_MAX_HEIGHT = 220;

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
let activeAssistantMessage = null;
let shouldAutoScroll = true;
let activePage = "chat";
let foregroundRefreshInFlight = null;
let lastForegroundRefreshAt = 0;
const FOREGROUND_REFRESH_COOLDOWN_MS = 300;
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
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function applyInlineMarkdown(text) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderPlainText(text) {
  const paragraphs = escapeHtml(text)
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return "<p></p>";
  }

  return paragraphs.map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`).join("");
}

function renderMarkdown(markdown) {
  const safe = escapeHtml(markdown).replace(/\r\n/g, "\n");
  const codeBlocks = [];
  const withCodePlaceholders = safe.replace(/```([\s\S]*?)```/g, (_match, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
    return placeholder;
  });

  const lines = withCodePlaceholders.split("\n");
  const chunks = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let quoteLines = [];
  let tableHeader = null;
  let tableRows = [];

  function flushParagraph() {
    if (!paragraph.length) {
      return;
    }

    chunks.push(`<p>${applyInlineMarkdown(paragraph.join("<br />"))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!listItems.length || !listType) {
      return;
    }

    const items = listItems.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join("");
    chunks.push(`<${listType}>${items}</${listType}>`);
    listItems = [];
    listType = null;
  }

  function flushQuote() {
    if (!quoteLines.length) {
      return;
    }

    chunks.push(`<blockquote>${quoteLines.map((line) => `<p>${applyInlineMarkdown(line)}</p>`).join("")}</blockquote>`);
    quoteLines = [];
  }

  function flushTable() {
    if (!tableHeader || !tableRows.length) {
      tableHeader = null;
      tableRows = [];
      return;
    }

    const headerCells = tableHeader.map((cell) => `<th>${applyInlineMarkdown(cell)}</th>`).join("");
    const bodyRows = tableRows
      .map((row) => `<tr>${row.map((cell) => `<td>${applyInlineMarkdown(cell)}</td>`).join("")}</tr>`)
      .join("");
    chunks.push(`<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`);
    tableHeader = null;
    tableRows = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      const level = headingMatch[1].length;
      chunks.push(`<h${level}>${applyInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      chunks.push("<hr />");
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      flushTable();
      quoteLines.push(quoteMatch[1]);
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      flushQuote();
      flushTable();
      if (listType && listType !== "ol") {
        flushList();
      }
      listType = "ol";
      listItems.push(orderedMatch[1]);
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      flushQuote();
      flushTable();
      if (listType && listType !== "ul") {
        flushList();
      }
      listType = "ul";
      listItems.push(unorderedMatch[1]);
      continue;
    }

    if (trimmed.startsWith("__CODE_BLOCK_") && trimmed.endsWith("__")) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      chunks.push(trimmed);
      continue;
    }

    const tableCells = trimmed
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell, index, parts) => {
        if (parts.length <= 1) {
          return true;
        }
        if (index === 0 && !cell) {
          return false;
        }
        return !(index === parts.length - 1 && !cell);
      });

    if (trimmed.includes("|") && tableCells.length >= 2) {
      const isSeparator = tableCells.every((cell) => /^:?-{3,}:?$/.test(cell));
      if (isSeparator && tableHeader) {
        continue;
      }

      flushParagraph();
      flushList();
      flushQuote();

      if (!tableHeader) {
        tableHeader = tableCells;
      } else {
        tableRows.push(tableCells);
      }
      continue;
    }

    flushList();
    flushQuote();
    flushTable();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushQuote();
  flushTable();

  return chunks
    .join("")
    .replace(/__CODE_BLOCK_(\d+)__/g, (_match, index) => codeBlocks[Number(index)] || "");
}

function isNearBottom() {
  if (!messages) {
    return true;
  }

  const distance = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
  return distance < BOTTOM_SCROLL_THRESHOLD;
}

function updateScrollButtonVisibility() {
  if (!scrollToBottomButton || !messages) {
    return;
  }

  scrollToBottomButton.hidden = isNearBottom();
}

function scrollMessagesToBottom(force = false) {
  if (!messages) {
    return;
  }

  if (!force && !shouldAutoScroll) {
    updateScrollButtonVisibility();
    return;
  }

  messages.scrollTop = messages.scrollHeight;
  shouldAutoScroll = true;
  updateScrollButtonVisibility();
}

function createMessageElement(role) {
  const article = document.createElement("article");
  article.className = `message message--${role}`;

  const meta = document.createElement("div");
  meta.className = "message__meta";
  meta.textContent = role === "user" ? "You" : "Assistant";

  const bubble = document.createElement("div");
  bubble.className = "message__bubble";

  const content = document.createElement("div");
  content.className = "message__content";

  bubble.append(content);
  article.append(meta, bubble);
  return { article, content };
}

function truncateText(text, maxLength = MESSAGE_PREVIEW_MAX_LENGTH) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function attachUserMessageToggle(article, contentNode, content) {
  const text = String(content ?? "");
  const normalized = text.trim();
  const shouldCollapse =
    normalized.length > MESSAGE_COLLAPSE_THRESHOLD || normalized.includes("\n");

  if (!shouldCollapse) {
    return;
  }

  article.classList.add("message--collapsible", "is-collapsed");

  const bubble = contentNode.parentElement;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "message__toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Expand message");
  toggle.innerHTML = '<span class="message__toggle-icon" aria-hidden="true">▾</span>';

  const preview = document.createElement("div");
  preview.className = "message__preview";
  preview.textContent = truncateText(text);

  bubble.insertBefore(toggle, contentNode);
  bubble.insertBefore(preview, contentNode);

  toggle.addEventListener("click", () => {
    const nextExpanded = article.classList.contains("is-collapsed");
    article.classList.toggle("is-collapsed", !nextExpanded);
    article.classList.toggle("is-expanded", nextExpanded);
    toggle.setAttribute("aria-expanded", String(nextExpanded));
    toggle.setAttribute("aria-label", nextExpanded ? "Collapse message" : "Expand message");
  });
}

function renderMessageContent(content, { contentType = "text", role = "assistant" } = {}) {
  if (role === "user") {
    return renderPlainText(content);
  }

  if (contentType === "json") {
    return `<pre class="message__card message__card--json">${escapeHtml(content)}</pre>`;
  }

  if (contentType === "image") {
    return `<div class="message__card message__card--image">${escapeHtml(content)}</div>`;
  }

  if (contentType === "file") {
    return `<div class="message__card message__card--file">${escapeHtml(content)}</div>`;
  }

  return renderMarkdown(content);
}

function resizePromptToFit() {
  if (!prompt) {
    return;
  }

  prompt.style.height = "auto";
  prompt.style.height = `${Math.min(prompt.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
}

function appendMessage({ role, content, contentType = "text" }) {
  if (!messages) {
    return null;
  }

  const { article, content: contentNode } = createMessageElement(role);
  contentNode.innerHTML = renderMessageContent(content, { contentType, role });

  if (role === "user") {
    attachUserMessageToggle(article, contentNode, content);
  }

  messages.append(article);
  scrollMessagesToBottom();
  return { article, contentNode };
}

function createAssistantPlaceholder() {
  const placeholder = appendMessage({ role: "assistant", content: "" });
  if (!placeholder) {
    activeAssistantMessage = null;
    return null;
  }

  placeholder.contentNode.innerHTML = '<p class="message__placeholder">Thinking...</p>';
  activeAssistantMessage = {
    article: placeholder.article,
    contentNode: placeholder.contentNode,
    rawContent: "",
    contentType: "text",
  };
  return activeAssistantMessage;
}

function updateAssistantMessage() {
  if (!activeAssistantMessage) {
    return;
  }

  activeAssistantMessage.contentNode.innerHTML =
    activeAssistantMessage.rawContent.trim()
      ? renderMessageContent(activeAssistantMessage.rawContent, {
          contentType: activeAssistantMessage.contentType,
          role: "assistant",
        })
      : '<p class="message__placeholder">Thinking...</p>';

  scrollMessagesToBottom();
}

function appendAssistantChunk(chunk) {
  if (!activeAssistantMessage) {
    createAssistantPlaceholder();
  }

  if (!activeAssistantMessage) {
    return;
  }

  activeAssistantMessage.rawContent += chunk;
  updateAssistantMessage();
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

async function refreshTodosOnForeground() {
  if (activePage !== "todo" || document.hidden) {
    return;
  }

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

async function refreshConfigOnForeground() {
  if (activePage !== "config" || document.hidden) {
    return;
  }

  if (isConfigSaving || hasConfigChanges()) {
    return;
  }

  try {
    await loadConfig();
  } catch (error) {
    setConfigFeedback(error?.message || String(error), "error");
  }
}

async function refreshActivePageOnForeground() {
  if (document.hidden) {
    return;
  }

  await refreshStatus();

  if (activePage === "todo") {
    await refreshTodosOnForeground();
    return;
  }

  if (activePage === "config") {
    await refreshConfigOnForeground();
  }
}

function queueForegroundRefresh() {
  if (document.hidden) {
    return;
  }

  const now = Date.now();
  if (foregroundRefreshInFlight || now - lastForegroundRefreshAt < FOREGROUND_REFRESH_COOLDOWN_MS) {
    return;
  }

  foregroundRefreshInFlight = (async () => {
    try {
      await refreshActivePageOnForeground();
    } finally {
      lastForegroundRefreshAt = Date.now();
      foregroundRefreshInFlight = null;
    }
  })();
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
  activePage = pageName;

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

  queueForegroundRefresh();
}

function handleWindowFocus() {
  queueForegroundRefresh();
}

function handleVisibilityChange() {
  if (document.hidden) {
    return;
  }

  queueForegroundRefresh();
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
  activeAssistantMessage = null;
  send.disabled = true;
  status.textContent = "running";
  shouldAutoScroll = true;
  appendMessage({ role: "user", content: message });
  createAssistantPlaceholder();
  prompt.value = "";
  prompt.style.height = "auto";

  try {
    const result = await window.agentAPI.runPrompt(message, activeRequestId);
    if (activeAssistantMessage && !activeAssistantMessage.rawContent.trim()) {
      activeAssistantMessage.rawContent = result.reply || "";
      updateAssistantMessage();
    }
    status.textContent = "ready";
  } catch (error) {
    const errorText = error?.message || String(error);
    if (!activeAssistantMessage) {
      createAssistantPlaceholder();
    }
    if (activeAssistantMessage) {
      activeAssistantMessage.rawContent = `**Error**\n\n${errorText}`;
      updateAssistantMessage();
    }
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

  appendAssistantChunk(chunk);
});

if (messages) {
  messages.addEventListener("scroll", () => {
    shouldAutoScroll = isNearBottom();
    updateScrollButtonVisibility();
  });
}

if (scrollToBottomButton) {
  scrollToBottomButton.addEventListener("click", () => {
    scrollMessagesToBottom(true);
  });
}

buildConfigFields();
renderTodoList();

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActivePage(button.dataset.pageTarget);
  });
});

send.addEventListener("click", run);
window.addEventListener("focus", handleWindowFocus);
document.addEventListener("visibilitychange", handleVisibilityChange);
prompt.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    run();
  }
});
prompt.addEventListener("input", resizePromptToFit);
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
  scrollMessagesToBottom(true);
})();

setInterval(refreshStatus, 2000);
