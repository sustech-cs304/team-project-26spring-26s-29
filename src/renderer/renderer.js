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
const navButtons = Array.from(document.querySelectorAll("[data-page-target]"));
const pages = Array.from(document.querySelectorAll("[data-page]"));

const MESSAGE_PREVIEW_MAX_LENGTH = 180;
const MESSAGE_COLLAPSE_THRESHOLD = 140;
const BOTTOM_SCROLL_THRESHOLD = 80;
const PROMPT_MAX_HEIGHT = 220;

let isRunning = false;
let activeRequestId = null;
let savedConfig = null;
let configInputs = {};
let isConfigSaving = false;
let activeAssistantMessage = null;
let shouldAutoScroll = true;

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
  const distance = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
  return distance < BOTTOM_SCROLL_THRESHOLD;
}

function updateScrollButtonVisibility() {
  if (!scrollToBottomButton) {
    return;
  }

  scrollToBottomButton.hidden = isNearBottom();
}

function scrollMessagesToBottom(force = false) {
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
  prompt.style.height = "auto";
  prompt.style.height = `${Math.min(prompt.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
}

function appendMessage({ role, content, contentType = "text" }) {
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

  activeAssistantMessage.rawContent += chunk;
  updateAssistantMessage();
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
    activeAssistantMessage.rawContent = `**Error**\n\n${errorText}`;
    updateAssistantMessage();
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

messages.addEventListener("scroll", () => {
  shouldAutoScroll = isNearBottom();
  updateScrollButtonVisibility();
});

if (scrollToBottomButton) {
  scrollToBottomButton.addEventListener("click", () => {
    scrollMessagesToBottom(true);
  });
}

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
prompt.addEventListener("input", resizePromptToFit);
configForm.addEventListener("submit", handleConfigSave);
configForm.addEventListener("input", handleConfigInput);
discard.addEventListener("click", handleConfigDiscard);

(async function initialize() {
  await loadConfig();
  await refreshStatus();
  setActivePage("chat");
  scrollMessagesToBottom(true);
})();

setInterval(refreshStatus, 2000);
